import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeRunEvent, consumeRunState, type ResponseEnvelope } from 'lingxios/ui'
import type { ImEnvelope } from '@/lib/im/wukong'
import type { Participant } from '@/types'
import { convertEnvelope } from './converter'
import { harnessParts, harnessStatus, readHarness, readHarnessEvent } from './harness'
import { getLingxiMessageMetadata } from './model'
import { mergeCanonicalMessages } from './store'

const participants = { agent: { id: 'agent', kind: 'agent', name: '助手' } as Participant }
function envelope(version: number, fence: number, outcome: ResponseEnvelope['goalOutcome']['status'] = 'partial'): ImEnvelope {
  const body = '查看[原文](#cite-S1)'
  const harness: ResponseEnvelope = { version: 1, requestVersion: version, body, evidenceSnapshotId: 'evidence',
    goalOutcome: outcome === 'awaiting_approval'
      ? { status: outcome, approvalId: 'approval', requestVersion: version, verification: 'not_run' }
      : outcome === 'delegated' ? { status: outcome, taskRef: 'child', requestVersion: version, verification: 'not_run' }
        : { status: outcome, requestVersion: version, verification: 'inconclusive' },
    citations: [{ start: 2, end: body.length, text: '原文', markers: ['S1'], support: 'not_assessed',
      sources: [{ sourceId: 'doc', sourceVersion: 'revision-7', chunkIds: ['chunk'] }] }],
    artifacts: [{ path: 'output/report.txt', mime: 'text/plain', size: 4, sha256: 'a'.repeat(64), source: { ref: 'document:doc', version: '7' } }],
  }
  return { channelId: 'room', channelType: 2, fromUid: 'agent', messageId: `result-${fence}`, clientMsgNo: `result-${fence}`,
    messageSeq: fence, timestamp: 1_767_225_600 + fence,
    payload: { version: 1, kind: 'text', clientMsgNo: `result-${fence}`, body, replyToClientMsgNo: 'thread',
      refs: { runId: 'run', agentId: 'agent' }, data: { harness, harnessCommit: { resultId: `result-${fence}`, fence } } } }
}

test('native committed partial answers retain artifact hashes and provenance without appearing complete', () => {
  const native = envelope(1,1), message = convertEnvelope(native,{ participants, meId: 'human' })
  const meta = getLingxiMessageMetadata(message)
  assert.deepEqual(message.status,{ type: 'incomplete', reason: 'other' })
  assert.deepEqual(message.content,[{ type: 'text', text: '查看原文' }])
  assert.deepEqual(meta.harness?.message?.envelope,native.payload.data?.harness)
  assert.equal(meta.harness?.delivery,'delivered')
  for (const status of ['awaiting_input','awaiting_approval','delegated'] as const) {
    assert.deepEqual(harnessStatus(readHarness(envelope(1,1,status))!),{ type: 'requires-action', reason: 'tool-calls' })
  }
  assert.throws(() => readHarness({ ...native, payload: { ...native.payload, refs: { runId: 'run', agentId: 'other' } } }),/身份/)
})

test('history, API snapshots and later attempts converge to one current message without restoring an old wait', () => {
  const waiting = convertEnvelope(envelope(1,1,'awaiting_approval'),{ participants, meId: 'human' })
  const committed = convertEnvelope(envelope(2,2),{ participants, meId: 'human' })
  for (const rows of [[waiting,committed],[committed,waiting]]) {
    const messages = mergeCanonicalMessages([],rows)
    assert.equal(messages.length,1)
    assert.equal(messages[0].id,committed.id)
    assert.equal(getLingxiMessageMetadata(messages[0]).harness?.goalOutcome?.status,'partial')
  }
  const meta = getLingxiMessageMetadata(committed), result = meta.harness!
  assert.ok(committed.role === 'assistant')
  let view = consumeRunState(result,{ run: { id: 'run', fence: 2, resultId: result.resultId, resultFence: 2,
    requestVersion: 3, status: 'queued', kind: 'turn', attempts: 2, createdAt: '', availableAt: '', heartbeatAt: null,
    lastProgressAt: null, goalOutcome: null, error: null }, message: result.message, delivery: 'delivered' })
  const updated = { ...committed, status: harnessStatus(view), metadata: { ...committed.metadata, custom: { ...meta, harness: view, harnessControl: true } } }
  const merged = mergeCanonicalMessages([updated],[waiting,committed])
  assert.equal(getLingxiMessageMetadata(merged[0]).harness?.requestVersion,3)
  assert.equal(merged[0].status?.type,'running')
  assert.equal(getLingxiMessageMetadata(merged[0]).harnessControl,true)
  const event = { runId: 'run', seq: 200_001, kind: 'run.started', stage: 'started' as const, visibility: 'user' as const, data: {} }
  view = consumeRunEvent(view,event)
  view = consumeRunEvent(view,{ ...event, seq: 200_002, kind: 'model.delta', data: { partType: 'text', delta: '新版内容' } })
  assert.equal(consumeRunEvent(view,event),view)
  assert.deepEqual(harnessParts(view),[{ type: 'text', text: '新版内容' }])
  assert.equal(view.message?.envelope.artifacts[0].source?.version,'7')
  assert.deepEqual(readHarnessEvent([{ type: 'data', path: [], data: [{ kind: 'harness_event', event, threadId: 'thread' }] }],'run'),{ event, threadId: 'thread' })
  assert.throws(() => readHarnessEvent([{ type: 'data', path: [], data: [{ kind: 'harness_event', event, threadId: 'thread' }] }],'other'),/不一致/)
})
