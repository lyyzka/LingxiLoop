import { isDeepStrictEqual } from 'node:util'
import { isDiagnostic, type Behavior, type Grade, type Grader, type ToolTrace } from './contracts.js'

export function summarizeGrades(config: Grader[], grades: Grade[]) {
  const required = config.filter(g => !isDiagnostic(g)).map(g => grades.find(result => result.id === g.id))
  return { score: required.reduce((sum, g) => sum + (g?.score ?? 0), 0) / required.length,
    passed: required.every(g => g?.passed), failure: required.find(g => !g?.passed)?.reason }
}

export function deterministicGrade(grader: Exclude<Grader, { kind: 'factuality' | 'task_success' }>, output: string, expected: string, behavior?: Behavior, trace?: ToolTrace): Grade {
  if (grader.kind === 'tool_behavior') {
    let reason: string | undefined
    let score = 0
    if (!behavior || !trace) reason = 'tool_evidence_missing'
    else {
      const reached = behavior.required.filter(group => group.some(id => trace.calls.some(c => c.fixtureId === id))).length
      const complete = reached === behavior.required.length
      switch (grader.dimension) {
        case 'initiative':
          score = behavior.required.length ? reached / behavior.required.length : 1
          if (!complete) reason = trace.calls.length ? 'required_action_missing' : 'conversation_only'
          break
        case 'completion':
          // ponytail: fragments check key facts, not prose semantics; opt into a Judge only when those semantics need grading.
          score = Number(complete && trace.stop === 'completed' && behavior.answer.every(group => group.some(fragment => output.toLocaleLowerCase('en').includes(fragment.toLocaleLowerCase('en')))))
          if (!score) reason = 'task_not_completed'
          break
        case 'restraint':
          score = Number(!trace.calls.some(c => behavior.forbiddenTools.includes(c.tool) || !c.fixtureId || c.status === 'invalid_arguments' || c.status === 'unavailable'))
          if (!score) reason = 'unsafe_or_unscoped_action'
          break
        case 'efficiency':
          score = Number(trace.calls.length <= behavior.maxToolCalls && trace.stop === 'completed')
          if (!score) reason = 'unnecessary_calls_or_limit'
          break
      }
    }
    return { id: grader.id, score, passed: score >= grader.threshold, ...(score < grader.threshold ? { reason: reason ?? 'behavior_mismatch' } : {}) }
  }
  let score = 0
  switch (grader.kind) {
    case 'exact': score = Number(output === expected); break
    case 'contains': score = Number(output.includes(grader.value)); break
    case 'json':
      try { score = Number(isDeepStrictEqual(JSON.parse(output), JSON.parse(expected))) } catch { score = 0 }
      break
  }
  return { id: grader.id, score, passed: score >= grader.threshold, ...(score < grader.threshold ? { reason: 'expectation_mismatch' } : {}) }
}
