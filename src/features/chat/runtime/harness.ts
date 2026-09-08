import type { MessageStatus, ThreadAssistantMessagePart } from '@assistant-ui/react'
import { consumeAssistantMessage, createRunView, responseSegments, type AssistantMessage, type RunView } from 'lingxios/ui'
import type { ImEnvelope } from '@/lib/im/wukong'
import type { AssistantStreamChunk } from 'assistant-stream'
import type { RunEvent } from 'lingxios/ui'

export function readHarnessEvent(chunks: readonly AssistantStreamChunk[], runId: string): { event: RunEvent; threadId: string | null } | undefined {
  const values = chunks.flatMap(chunk => chunk.type === 'data' && chunk.path.length === 0 && Array.isArray(chunk.data) ? chunk.data : [])
    .filter(value => value && typeof value === 'object' && !Array.isArray(value) && 'kind' in value && value.kind === 'harness_event')
  if (!values.length) return undefined
  if (values.length !== 1) throw new Error('重复运行事件')
  const value = values[0] as { event?: Partial<RunEvent>; threadId?: unknown }, event = value.event
  if (!event || event.runId !== runId || !Number.isSafeInteger(event.seq) || Number(event.seq) < 1
    || event.visibility !== 'user' || typeof event.kind !== 'string' || typeof event.stage !== 'string'
    || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)
    || value.threadId !== null && typeof value.threadId !== 'string') throw new Error('运行事件身份或格式不一致')
  return { event: event as RunEvent, threadId: value.threadId as string | null }
}

export function mergeHarness(current: RunView, incoming: RunView): RunView {
  if (current.runId !== incoming.runId) throw new Error('运行身份不一致')
  const newer = incoming.requestVersion > current.requestVersion || incoming.requestVersion === current.requestVersion
    && (incoming.fence > current.fence || incoming.fence === current.fence && incoming.lastSeq > current.lastSeq)
  let view = newer ? incoming : current
  const other = newer ? current : incoming
  if (other.message && other.resultId && other.resultId !== view.resultId) {
    view = consumeAssistantMessage(view,other.message,{ resultId: other.resultId, fence: other.messageFence })
  }
  return { ...view, lastSeq: Math.max(current.lastSeq,incoming.lastSeq),
    ...(incoming.delivery === 'delivered' && incoming.resultId === view.resultId ? { delivery: 'delivered' } : {}) }
}

export function readHarness(envelope: ImEnvelope): RunView | undefined {
  const data = envelope.payload.data
  if (!data?.harness) return undefined
  const runId = envelope.payload.refs?.runId
  if (typeof runId !== 'string' || envelope.payload.refs?.agentId !== envelope.fromUid) throw new Error('运行结果身份不一致')
  const message: AssistantMessage = { version: 2, runId, agentId: envelope.fromUid, sessionId: envelope.channelId,
    ...(envelope.payload.replyToClientMsgNo ? { threadId: envelope.payload.replyToClientMsgNo } : {}),
    body: envelope.payload.body ?? '', envelope: data.harness as AssistantMessage['envelope'] }
  return { ...consumeAssistantMessage(createRunView(runId),message,data.harnessCommit as { resultId: string; fence: number }), delivery: 'delivered' }
}

export function harnessParts(view: RunView): ThreadAssistantMessagePart[] {
  if (view.draft && (view.lifecycle === 'leased' || view.lifecycle === 'queued')) return [{ type: 'text', text: view.draft }]
  if (!view.message) return view.draft ? [{ type: 'text', text: view.draft }] : []
  // Citation provenance is displayed alongside the answer, without inventing a confidence score.
  return [{ type: 'text', text: responseSegments(view.message.envelope).flatMap(segment => segment.type === 'presentation' ? [] : [segment.text]).join('') }]
}

export function harnessStatus(view: RunView): MessageStatus {
  if (view.lifecycle === 'queued' || view.lifecycle === 'leased') return { type: 'running' }
  if (view.lifecycle === 'cancelled') return { type: 'incomplete', reason: 'cancelled' }
  if (view.lifecycle === 'failed') return { type: 'incomplete', reason: 'error' }
  switch (view.goalOutcome?.status) {
    case 'awaiting_input': case 'awaiting_approval': case 'delegated': return { type: 'requires-action', reason: 'tool-calls' }
    case 'partial': case 'blocked': return { type: 'incomplete', reason: 'other' }
    case 'satisfied': return { type: 'complete', reason: 'stop' }
    default: return { type: 'running' }
  }
}

export function harnessLabel(view: RunView): string {
  if (view.lifecycle === 'cancelled') return '已取消'
  if (view.lifecycle === 'failed') return '执行失败'
  if (view.lifecycle === 'queued') return '排队中'
  if (view.lifecycle === 'leased') return '执行中'
  switch (view.goalOutcome?.status) {
    case 'satisfied': return '已完成'
    case 'partial': return '部分完成'
    case 'blocked': return '需要处理'
    case 'awaiting_input': return '等待补充信息'
    case 'awaiting_approval': return '等待审批'
    case 'delegated': return '等待协作任务'
    default: return '正在读取状态'
  }
}
