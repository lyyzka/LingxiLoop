import assert from 'node:assert/strict'
import test from 'node:test'
import type { Score } from 'autoevals'
import type { EvalRunReport } from '../eval/contracts.js'
import { createHmac } from 'node:crypto'
import { verifyEvalCallbackSignature } from '../eval/jobs.js'
import { expandLiveProfile, finalizeLiveReport, judgeLiveObservation, type JudgeScorers } from '../eval/live.js'

test('live core expands five scenarios to fifteen samples', () => {
  const cases = ['auto-grounding', 'approval-boundary', 'forbidden-inferred-percentage', 'planning-gate', 'canvas-report-gate', 'other']
    .map((runtimeScenario) => ({ caseId: runtimeScenario, runtimeScenario, expectations: {} }))
  const expanded = expandLiveProfile(cases, 'core')
  assert.equal(expanded.length, 15)
  assert.deepEqual(expanded.slice(0, 3).map((item) => item.sampleIndex), [0, 1, 2])
})

test('judge adapter maps scores and redacts rationale', async () => {
  const result = (name: string): Score => ({ name, score: 0.9, metadata: { rationale: `ok sk-secret12345678 ${'x'.repeat(600)}` } })
  const scorers = Object.fromEntries(['ClosedQA', 'Factuality', 'AnswerRelevancy', 'Faithfulness']
    .map((name) => [name, async () => result(name)])) as unknown as JudgeScorers
  const judgments = await judgeLiveObservation({
    input: 'question', observation: { answer: 'answer' },
    reference: { criteria: 'correct', referenceAnswer: 'answer', context: ['evidence'] },
    model: 'judge', client: {} as never, scorers,
  })
  assert.equal(judgments.length, 4)
  assert.equal(judgments.every((item) => item.passed), true)
  assert.equal(judgments[0].rationale.includes('sk-secret'), false)
  assert.equal(judgments[0].rationale.length, 500)
})

test('judge adapter treats missing scores as case errors', async () => {
  const scorers = Object.fromEntries(['ClosedQA', 'Factuality', 'AnswerRelevancy', 'Faithfulness']
    .map((name) => [name, async () => ({ name, score: null })])) as unknown as JudgeScorers
  await assert.rejects(judgeLiveObservation({
    input: 'question', observation: { answer: 'answer' },
    reference: { criteria: 'correct', referenceAnswer: 'answer' },
    model: 'judge', client: {} as never, scorers,
  }), /invalid score/)
})

test('core aggregation accepts two of three but hard approval failure wins', () => {
  const cases: EvalRunReport['cases'] = [0, 1, 2].map((sampleIndex) => ({
    caseId: `case:${sampleIndex}`, scenarioKey: 'case', sampleIndex, name: 'case', sourceAgentRunId: null,
    status: sampleIndex === 2 ? 'fail' as const : 'pass' as const, score: 1,
    observation: { judgments: [{ scorer: 'ClosedQA' as const, score: sampleIndex === 2 ? 0.7 : 0.9, passed: sampleIndex !== 2, model: 'judge', rationale: '' }] },
    expectations: {}, stages: [], failureReasons: [], failureCategories: [],
  }))
  const report = { status: 'fail', score: 0, cases, summary: { passedCases: 2, failedCases: 1, errorCases: 0 } } as unknown as EvalRunReport
  assert.equal(finalizeLiveReport(report, 'core').status, 'pass')
  cases[0].failureCategories = ['approval_violation']
  assert.equal(finalizeLiveReport(report, 'core').status, 'fail')
})

test('callback HMAC rejects replay variants and stale timestamps', () => {
  const rawBody = Buffer.from('{"action":"start"}')
  const timestamp = String(Date.now())
  const nonce = '1c706f12-850d-4984-bd4a-3b5be106d8bb'
  const secret = 'eval-test-secret'
  const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.`).update(rawBody).digest('base64url')
  assert.equal(verifyEvalCallbackSignature({ rawBody, timestamp, nonce, signature, secret }), true)
  assert.equal(verifyEvalCallbackSignature({ rawBody: Buffer.from('{}'), timestamp, nonce, signature, secret }), false)
  assert.equal(verifyEvalCallbackSignature({ rawBody, timestamp: String(Date.now() - 600_000), nonce, signature, secret }), false)
})
