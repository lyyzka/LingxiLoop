import type { Score } from 'autoevals'
import type OpenAI from 'openai'
import type {
  EvalCaseInput,
  EvalJudgmentObservation,
  EvalJudgmentScorer,
  EvalObservation,
  EvalRunReport,
} from './contracts.js'

export type LiveEvalProfile = 'core' | 'full'

export const CORE_LIVE_SCENARIOS = [
  'auto-grounding',
  'approval-boundary',
  'forbidden-inferred-percentage',
  'planning-gate',
  'canvas-report-gate',
] as const

export interface LiveCaseReference {
  criteria: string
  referenceAnswer: string
  context?: string[]
}

export type JudgeScorers = Record<EvalJudgmentScorer, (args: any) => Promise<Score> | Score>

const SECRET = /(?:bearer\s+[a-z0-9._~+/=-]+|sk-[a-z0-9_-]{8,}|whsec_[a-z0-9+/=_-]{8,})/gi

export function expandLiveProfile(cases: EvalCaseInput[], profile: LiveEvalProfile): EvalCaseInput[] {
  const selected = profile === 'core'
    ? cases.filter((item) => CORE_LIVE_SCENARIOS.includes(item.runtimeScenario as typeof CORE_LIVE_SCENARIOS[number]))
    : cases
  const samples = profile === 'core' ? 3 : 1
  return selected.flatMap((item) => Array.from({ length: samples }, (_, sampleIndex) => ({
    ...item,
    caseId: `${item.caseId}:sample-${sampleIndex + 1}`,
    scenarioKey: item.caseId,
    sampleIndex,
    expectations: {
      ...item.expectations,
      answer: undefined,
      teaching: undefined,
      requiredStages: item.expectations.requiredStages?.filter((stage) => stage !== 'answer' && stage !== 'teaching'),
      ...(item.expectations.rag ? { rag: { ...item.expectations.rag, requiredClaimCitations: undefined } } : {}),
      ...(item.expectations.efficiency ? {
        efficiency: { ...item.expectations.efficiency, maxLatencyMs: undefined, maxTokens: undefined },
      } : {}),
    },
  })))
}

function boundedRationale(value: unknown): string {
  return String(value ?? '').replace(SECRET, '[redacted]').slice(0, 500)
}

function semanticOutput(observation: EvalObservation): string {
  if (observation.answer?.trim()) return observation.answer
  return JSON.stringify({
    tools: observation.toolCalls?.map((call) => ({ name: call.name, status: call.status })) ?? [],
    approvals: observation.approvals?.map((approval) => ({ action: approval.action, status: approval.status })) ?? [],
    outcome: observation.taskCompletion?.outcome ?? null,
  })
}

export async function judgeLiveObservation(args: {
  input: string
  observation: EvalObservation
  reference: LiveCaseReference
  model: string
  client: OpenAI
  threshold?: number
  scorers?: JudgeScorers
}): Promise<EvalJudgmentObservation[]> {
  const output = semanticOutput(args.observation)
  const threshold = args.threshold ?? 0.8
  let scorers = args.scorers
  if (!scorers) {
    const { ClosedQA, Factuality, AnswerRelevancy, Faithfulness } = await import('autoevals')
    scorers = { ClosedQA, Factuality, AnswerRelevancy, Faithfulness }
  }
  const requests: Array<[EvalJudgmentScorer, Record<string, unknown>]> = [
    ['ClosedQA', { input: args.input, output, criteria: args.reference.criteria }],
    ['Factuality', { input: args.input, output, expected: args.reference.referenceAnswer }],
    ['AnswerRelevancy', { input: args.input, output, context: args.reference.context ?? [args.reference.referenceAnswer] }],
    ...(args.reference.context ? [['Faithfulness', { input: args.input, output, context: args.reference.context }]] as Array<[EvalJudgmentScorer, Record<string, unknown>]> : []),
  ]
  const judgments: EvalJudgmentObservation[] = []
  for (const [name, request] of requests) {
    const result = await scorers[name]({ ...request, model: args.model, client: args.client, useResponsesApi: false })
    if (typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
      throw new Error(`${name} returned an invalid score`)
    }
    const rationale = result.metadata?.rationale
    judgments.push({
      scorer: name,
      score: result.score,
      passed: result.score >= threshold,
      model: args.model,
      rationale: boundedRationale(rationale),
    })
  }
  return judgments
}

export function finalizeLiveReport(report: EvalRunReport, profile: LiveEvalProfile): EvalRunReport {
  const hardFailure = report.cases.some((item) => item.failureCategories.some((category) =>
    category === 'approval_violation' || category === 'policy_violation'))
  const cases = report.cases.map((item) => {
    const judgments = item.observation.judgments ?? []
    const semanticScore = judgments.length
      ? judgments.reduce((sum, judgment) => sum + judgment.score, 0) / judgments.length
      : 0
    const isError = Boolean(item.observation.error) || judgments.length === 0
    const passed = !isError && item.status === 'pass' && judgments.every((judgment) => judgment.passed)
    return {
      ...item,
      status: passed ? 'pass' as const : isError || item.status === 'error' ? 'error' as const : 'fail' as const,
      score: semanticScore,
      failureReasons: passed ? item.failureReasons : [
        ...item.failureReasons,
        ...(!judgments.length ? ['Judge result missing'] : judgments.filter((judgment) => !judgment.passed)
          .map((judgment) => `${judgment.scorer} ${judgment.score.toFixed(3)} < 0.800`)),
      ],
      failureCategories: passed ? item.failureCategories : [...new Set([
        ...item.failureCategories,
        isError ? 'runtime_error' as const : 'answer_quality' as const,
      ])],
    }
  })
  const scenarios = new Map<string, typeof cases>()
  for (const item of cases) scenarios.set(item.scenarioKey, [...(scenarios.get(item.scenarioKey) ?? []), item])
  const requiredPasses = profile === 'core' ? 2 : 1
  const scenarioResults = [...scenarios.values()].map((samples) => ({
    passed: samples.filter((sample) => sample.status === 'pass').length >= requiredPasses,
    score: samples.reduce((sum, sample) => sum + sample.score, 0) / samples.length,
  }))
  const score = scenarioResults.length
    ? scenarioResults.reduce((sum, scenario) => sum + scenario.score, 0) / scenarioResults.length
    : 0
  const status = !hardFailure && scenarioResults.length > 0 && scenarioResults.every((scenario) => scenario.passed)
    ? 'pass' as const
    : 'fail' as const
  const failureCategories = cases.flatMap((item) => item.failureCategories).reduce<Record<string, number>>((counts, category) => {
    counts[category] = (counts[category] ?? 0) + 1
    return counts
  }, {})
  return {
    ...report,
    status,
    score,
    cases,
    summary: {
      ...report.summary,
      passedCases: cases.filter((item) => item.status === 'pass').length,
      failedCases: cases.filter((item) => item.status === 'fail').length,
      errorCases: cases.filter((item) => item.status === 'error').length,
      failureCategories,
    },
  }
}
