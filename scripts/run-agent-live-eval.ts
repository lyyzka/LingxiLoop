#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { trace } from '@opentelemetry/api'
import { usingAttributes } from 'openlit'
import { OpenAIChatDriver } from '../server/src/agent-os/model-driver.js'
import type { EvalCaseInput, EvalObservation, EvalRunInput } from '../server/src/eval/contracts.js'
import { sanitizeEvalObservation } from '../server/src/eval/trace.js'
import { evaluateRun } from '../server/src/eval/evaluator.js'
import {
  expandLiveProfile,
  finalizeLiveReport,
  judgeLiveObservation,
  type LiveCaseReference,
  type LiveEvalProfile,
} from '../server/src/eval/live.js'
import { createOpenAIClient } from '../server/src/llm-client.js'
import { executeRuntimeCase } from './run-agent-runtime-eval.js'

function option(name: string, fallback = ''): string {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function required(name: string, fallback = ''): string {
  const value = process.env[name]?.trim() || fallback
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function callback(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.EVAL_CALLBACK_URL?.trim()
  if (!url) return {}
  const secret = required('EVAL_CI_HMAC_SECRET')
  const timestamp = String(Date.now())
  const nonce = randomUUID()
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('base64url')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eval-timestamp': timestamp, 'x-eval-nonce': nonce, 'x-eval-signature': signature },
    body,
  })
  // ponytail: one-release bootstrap for the new callback; remove after every production region runs migration 0006.
  if (response.status === 404 && payload.action === 'create' && process.argv.includes('--enforce-only')) {
    return { gatePolicy: { mode: 'monitor' }, bootstrap: true }
  }
  if (!response.ok) throw new Error(`Eval callback returned ${response.status}: ${(await response.text()).slice(0, 500)}`)
  return await response.json() as Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const profile = (option('--profile', process.env.EVAL_PROFILE || 'core')) as LiveEvalProfile
if (profile !== 'core' && profile !== 'full') throw new Error('--profile must be core or full')
const suitePath = resolve(option('--suite', 'eval/suites/runtime-smoke.v1.json'))
const referencesPath = resolve(option('--references', 'eval/live-runtime.v1.json'))
const reportPath = resolve(option('--report', 'artifacts/eval-live-report.json'))
const candidateModel = required('EVAL_CANDIDATE_MODEL', process.env.OPENAI_MODEL)
const candidateKey = required('EVAL_CANDIDATE_API_KEY', process.env.OPENAI_API_KEY)
const candidateBaseUrl = required('EVAL_CANDIDATE_BASE_URL', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
const judgeModel = required('EVAL_JUDGE_MODEL')
if (judgeModel === candidateModel) throw new Error('EVAL_JUDGE_MODEL must differ from EVAL_CANDIDATE_MODEL')
const judgeKey = required('EVAL_JUDGE_API_KEY')
const judgeBaseUrl = required('EVAL_JUDGE_BASE_URL', 'https://api.openai.com/v1')
const commitSha = required('EVAL_COMMIT_SHA', process.env.GITHUB_SHA || '0000000000000000000000000000000000000000')
let jobId = option('--job-id', process.env.EVAL_JOB_ID || `eval-job-${randomUUID()}`)
const suiteSource = JSON.parse(await readFile(suitePath, 'utf8')) as EvalRunInput
const referenceSource = JSON.parse(await readFile(referencesPath, 'utf8')) as {
  version: string
  scorerThreshold: number
  references: Record<string, LiveCaseReference>
}
const basePayload = {
  jobId, profile, suiteKey: 'agent-runtime-live', suiteVersion: referenceSource.version,
  commitSha, promptVersion: 'prompt-v7', candidateModel, judgeModel,
}

let started = false
try {
  const created = await callback({ action: 'create', ...basePayload })
  const createdJob = record(created.job)
  if (typeof createdJob.id === 'string') {
    jobId = createdJob.id
    basePayload.jobId = jobId
  }
  const gatePolicy = record(created.gatePolicy)
  if (process.argv.includes('--enforce-only') && gatePolicy.mode !== 'enforce') process.exit(0)
  if (createdJob.status === 'completed') {
    const existingRun = record(created.existingRun)
    const baselineScore = typeof gatePolicy.baseline_score === 'number' ? gatePolicy.baseline_score : null
    const score = typeof existingRun.score === 'number' ? existingRun.score : 0
    if (existingRun.status !== 'pass' || (baselineScore !== null && baselineScore - score > 0.05)) process.exitCode = 1
    process.exit(process.exitCode ?? 0)
  }
  if (createdJob.status === 'running') throw new Error(`Eval job ${jobId} is already running`)
  await callback({ action: 'start', ...basePayload })
  started = true

  const cases = expandLiveProfile(suiteSource.cases, profile)
  const candidate = new OpenAIChatDriver(candidateModel, { apiKey: candidateKey, baseURL: candidateBaseUrl })
  const judge = createOpenAIClient({ apiKey: judgeKey, baseURL: judgeBaseUrl })
  const homesRoot = await mkdtemp(join(tmpdir(), 'lingxiloop-live-eval-'))
  const observations = new Map<string, EvalObservation>()
  try {
    for (const testCase of cases) {
      const scenario = testCase.runtimeScenario ?? ''
      const reference = referenceSource.references[scenario]
      if (!reference) throw new Error(`missing live reference for ${scenario}`)
      const attributes = {
        'eval.job.id': jobId,
        'eval.suite': 'agent-runtime-live',
        'eval.scenario': testCase.scenarioKey ?? testCase.caseId,
        'eval.sample': testCase.sampleIndex ?? 0,
        'eval.commit': commitSha,
      }
      try {
        const observation = await usingAttributes(attributes, () =>
          trace.getTracer('lingxiloop-live-eval').startActiveSpan('lingxiloop.eval.sample', async (span) => {
            try {
              const value = await usingAttributes({ 'eval.model.role': 'candidate' }, () =>
                executeRuntimeCase(testCase, { model: candidate, realKernel: true, homesRoot }))
              value.judgments = await usingAttributes({ 'eval.model.role': 'judge' }, () => judgeLiveObservation({
                input: value.input ?? '', observation: value, reference, model: judgeModel, client: judge,
                threshold: referenceSource.scorerThreshold,
              }))
              value.metadata = { ...(value.metadata ?? {}), traceId: span.spanContext().traceId }
              return value
            } finally { span.end() }
          }))
        observations.set(testCase.caseId, observation)
      } catch (error) {
        observations.set(testCase.caseId, { error: error instanceof Error ? error.message : String(error), metadata: { executionMode: 'agent-os-runtime', realKernel: true } })
      }
    }
  } finally {
    await rm(homesRoot, { recursive: true, force: true })
  }

  const run: EvalRunInput = {
    ...suiteSource,
    suiteKey: 'agent-runtime-live', suiteName: 'Agent OS Live Runtime Eval', version: referenceSource.version,
    target: { commitSha, promptVersion: 'prompt-v7', model: candidateModel },
    passThreshold: referenceSource.scorerThreshold,
    metadata: { liveProfile: profile, jobId, judgeModel, referenceVersion: referenceSource.version },
    cases: cases.map((testCase) => ({ ...testCase, observation: observations.get(testCase.caseId), runtimeScenario: undefined })),
  }
  const report = finalizeLiveReport(evaluateRun(run, observations), profile)
  const artifact = { schemaVersion: 'lingxiloop.eval-live-artifact.v1', profile, jobId, report: {
    ...report,
    cases: report.cases.map((item) => ({ ...item, observation: sanitizeEvalObservation(item.observation) })),
  } }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await callback({ action: 'complete', ...basePayload, run })
  const baselineScore = typeof gatePolicy.baseline_score === 'number' ? gatePolicy.baseline_score : null
  const regressed = baselineScore !== null && baselineScore - report.score > 0.05
  process.stdout.write(`Live Eval ${profile}: ${report.status.toUpperCase()} ${(report.score * 100).toFixed(1)}% (${report.cases.length} samples)\n`)
  if (report.status !== 'pass' || (gatePolicy.mode === 'enforce' && regressed)) process.exitCode = 1
} catch (error) {
  if (started) await callback({ action: 'fail', ...basePayload, error: error instanceof Error ? error.message : String(error) }).catch(() => undefined)
  throw error
}
