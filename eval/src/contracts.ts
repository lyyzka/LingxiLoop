import { createHash } from 'node:crypto'
import { z } from 'zod'

export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/)
const text = z.string().min(1).max(64_000)
const score = z.number().finite().min(0).max(1)
const groups = z.array(z.array(id).min(1).max(16)).max(16)
const fragments = z.record(z.string().min(1).max(100), z.array(z.array(z.string().min(1).max(2000)).min(1).max(20)).min(1).max(20))
export const scenarioSchema = z.object({
  context: text.optional(),
  tools: z.array(id).min(1).max(24),
  fixtures: z.array(z.object({
    id, tool: id, arguments: z.record(z.string(), z.json()), contains: fragments.optional(),
    after: groups, once: z.boolean().optional(), result: z.json(), outcome: z.enum(['ok', 'pending', 'denied', 'error']),
  }).strict()).max(32),
}).strict().superRefine((v, ctx) => {
  const ids = new Set(v.fixtures.map(f => f.id))
  if (ids.size !== v.fixtures.length || new Set(v.tools).size !== v.tools.length
    || v.fixtures.some(f => !v.tools.includes(f.tool) || f.after.flat().some(ref => !ids.has(ref) || ref === f.id))
    || JSON.stringify(v).length > 64_000) ctx.addIssue({ code: 'custom', message: 'invalid tool scenario' })
})
export const behaviorSchema = z.object({
  required: groups, forbiddenTools: z.array(id).max(24),
  answer: z.array(z.array(z.string().min(1).max(2000)).min(1).max(20)).max(20),
  maxToolCalls: z.number().int().min(0).max(16),
}).strict()
export const toolBudgetSchema = z.object({
  maxModelCalls: z.number().int().min(1).max(16), maxToolCalls: z.number().int().min(1).max(16),
  maxOutputTokens: z.number().int().min(1).max(4096), maxSampleCostCny: z.number().positive().finite(),
}).strict()
export const toolTraceSchema = z.object({
  modelCalls: z.number().int().min(0).max(16),
  stop: z.enum(['completed', 'model_call_limit', 'tool_call_limit', 'cost_limit', 'context_limit', 'error']),
  calls: z.array(z.object({ tool: id, fixtureId: id.optional(),
    status: z.enum(['ok', 'pending', 'denied', 'error', 'invalid_arguments', 'unavailable']),
  }).strict()).max(16),
}).strict()
export type Scenario = z.infer<typeof scenarioSchema>
export type Behavior = z.infer<typeof behaviorSchema>
export type ToolBudget = z.infer<typeof toolBudgetSchema>
export type ToolTrace = z.infer<typeof toolTraceSchema>
export const graderSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('exact'), threshold: score }).strict(),
  z.object({ id, kind: z.literal('contains'), value: text, threshold: score }).strict(),
  z.object({ id, kind: z.literal('json'), threshold: score }).strict(),
  z.object({ id, kind: z.literal('factuality'), threshold: score }).strict(),
  z.object({ id, kind: z.literal('task_success'), threshold: score }).strict(),
  z.object({ id, kind: z.literal('tool_behavior'), dimension: z.enum(['initiative', 'completion', 'restraint', 'efficiency']), threshold: score, diagnostic: z.boolean().optional() }).strict(),
])
export const datasetSchema = z.object({
  schemaVersion: z.literal(1), id, version: id,
  cases: z.array(z.object({ id, input: text, expected: text, tags: z.array(id).max(20).default([]),
    scenario: scenarioSchema.optional(), behavior: behaviorSchema.optional(),
  }).strict()).min(1).max(10_000),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.cases.map(c => c.id)).size !== v.cases.length) ctx.addIssue({ code: 'custom', message: 'duplicate case id' })
  for (const c of v.cases) {
    if (!!c.scenario !== !!c.behavior || c.behavior && (c.behavior.required.flat().some(ref => !c.scenario?.fixtures.some(f => f.id === ref))
      || c.behavior.forbiddenTools.some(tool => !c.scenario?.tools.includes(tool)))) ctx.addIssue({ code: 'custom', message: 'invalid behavior references' })
  }
})
export const suiteSchema = z.object({
  schemaVersion: z.literal(2), id, version: id,
  dataset: z.object({ id, version: id }).strict(),
  samples: z.number().int().min(1).max(100),
  concurrency: z.number().int().min(1).max(32),
  timeoutMs: z.number().int().min(100).max(600_000),
  graders: z.array(graderSchema).min(1).max(20),
  toolBudget: toolBudgetSchema.optional(),
  gate: z.object({
    minScore: score, minPassRate: score, maxScoreDrop: score, maxCaseDrop: score,
    maxP95LatencyMs: z.number().positive().finite(), maxCandidateCostCny: z.number().nonnegative().finite(),
    maxJudgeCostCny: z.number().nonnegative().finite(), requireBaseline: z.boolean(),
    requiredGraders: z.array(id).max(20).optional(),
  }).strict(),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.graders.map(g => g.id)).size !== v.graders.length) ctx.addIssue({ code: 'custom', message: 'duplicate grader id' })
  if (!!v.toolBudget !== v.graders.some(g => g.kind === 'tool_behavior') || v.toolBudget && v.concurrency !== 1)
    ctx.addIssue({ code: 'custom', message: 'tool suites require behavior grading and serial cost control' })
  if (v.graders.some(g => g.kind === 'tool_behavior' && g.diagnostic && g.dimension !== 'efficiency')
    || v.graders.every(isDiagnostic) || v.gate.requiredGraders?.some(id => !v.graders.some(g => g.id === id && !isDiagnostic(g)))
    || v.graders.some(g => g.kind === 'task_success') && !v.toolBudget)
    ctx.addIssue({ code: 'custom', message: 'invalid diagnostic or required graders' })
})
export type Dataset = z.infer<typeof datasetSchema>
export type Suite = z.infer<typeof suiteSchema>
export type Grader = z.infer<typeof graderSchema>
export const isDiagnostic = (g: Grader) => g.kind === 'tool_behavior' && g.diagnostic === true
export const usageSchema = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), costCny: z.number().finite().nonnegative() }).strict()
export type Usage = z.infer<typeof usageSchema>
export interface TargetRequest {
  input: string
  requestId: string
  seed: number
  signal: AbortSignal
  scenario?: Scenario
  toolBudget?: ToolBudget
}
// Transient Judge input only. Never copy this evidence into Sample or telemetry.
const evidenceSchema = z.array(z.object({ tool: id, arguments: z.json(), result: z.json() }).strict()).max(16)
  .refine(value => JSON.stringify(value).length <= 64_000, 'tool evidence too large')
export type ToolEvidence = z.infer<typeof evidenceSchema>
export const targetResponseSchema = z.object({ output: z.string().max(64_000), usage: usageSchema.optional(), tools: toolTraceSchema.optional(), evidence: evidenceSchema.optional() }).strict()
export interface EvalTarget {
  readonly identity: { id: string; version: string; fingerprint: string; environment?: string }
  execute(request: TargetRequest): Promise<z.infer<typeof targetResponseSchema>>
}
export interface Grade { id: string; score: number; passed: boolean; reason?: string }
export interface Judge {
  readonly fingerprint: string
  grade(input: string, output: string, expected: string, signal: AbortSignal, requestId: string,
    options?: { taskSuccess?: boolean; evidence?: ToolEvidence; maxCostCny?: number }): Promise<{ score: number; usage: Usage; reason?: string }>
}
export const sampleSchema = z.object({
  caseId: id, index: z.number().int().nonnegative(), status: z.enum(['pass', 'fail', 'error']), score,
  latencyMs: z.number().finite().nonnegative(),
  grades: z.array(z.object({ id, score, passed: z.boolean(), reason: id.optional() }).strict()).max(20),
  candidate: usageSchema.optional(), judge: usageSchema, failure: id.optional(),
  outputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), tools: toolTraceSchema.optional(),
}).strict()
export type Sample = z.infer<typeof sampleSchema>
export const manifestSchema = z.object({
  schemaVersion: z.literal(2), engine: z.literal('black-box-eval/2'), suite: suiteSchema, dataset: datasetSchema,
  target: z.object({ id, version: id, fingerprint: z.string().min(1).max(200), environment: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  judge: z.string().min(1).max(200).nullable(), seed: z.number().int().min(0).max(2147483647),
  provenance: z.object({ revision: z.string().min(1).max(200) }).strict(), baseline: id.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.suite.dataset.id !== v.dataset.id || v.suite.dataset.version !== v.dataset.version
    || v.suite.samples * v.dataset.cases.length > 100_000
    || v.dataset.cases.some(c => !!c.scenario !== !!v.suite.toolBudget)
    || (v.suite.graders.some(g => g.kind === 'factuality' || g.kind === 'task_success') && !v.judge)) ctx.addIssue({ code: 'custom', message: 'inconsistent manifest' })
})
export type Manifest = z.infer<typeof manifestSchema>
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}
export function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }
export const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, costCny: 0 })
export function addUsage(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, costCny: a.costCny + b.costCny }
}
export class EvaluationError extends Error {
  constructor(readonly code: string) { super(code) }
}
export function failureCode(error: unknown): string {
  return error instanceof EvaluationError ? error.code : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout_or_cancelled' : 'unexpected_error'
}

export class ModelError extends EvaluationError {
  constructor(code: string, readonly usage: Usage, readonly tools?: ToolTrace) { super(code) }
}
