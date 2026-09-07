import { createHash } from 'node:crypto'
import type { createLingxiOS, ApprovalSnapshot, DeliveryPort, MessageIdentity } from 'lingxios'
import type { AssistantStreamChunk } from 'assistant-stream'
import { CH_ASSISTANT_STREAM, publish } from '../redis.js'
import { sendAgentChannelMessage, sendSystemChannelMessage } from '../im/public.js'
import { loadRuntimeBinding } from './context.js'

export function approvalView(approval: ApprovalSnapshot) {
  const status = approval.decision === null ? 'PENDING' : approval.decision === false ? 'REJECTED'
    : approval.result?.executionState === 'unknown' ? 'UNKNOWN' : approval.result?.ok ? 'EXECUTED'
    : approval.result?.executionState === 'awaiting_approval' ? 'APPROVED' : 'FAILED'
  return { id: approval.approvalId, runId: approval.runId, agentId: approval.agentId, status,
    summary: String(approval.preview.summary ?? approval.preview.title ?? approval.action),
    action: { action: approval.action, args: approval.args }, preview: approval.preview,
    requestedBy: approval.principalId, requestedAt: approval.createdAt, resolvedAt: approval.decidedAt,
    scope: { requestVersion: approval.requestVersion }, ...(approval.result ? { result: approval.result } : {}) }
}

const index = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

export function createProductDelivery(control: () => ReturnType<typeof createLingxiOS>): DeliveryPort {
  return {
    async onEvent(work, event, context) {
      if (event.visibility !== 'user' || ['memory_synthesis','memory_index','memory_evaluation'].includes(work.kind)) return
      await loadRuntimeBinding(work)
      const messageId = `preview-${work.id}`
      const chunks: AssistantStreamChunk[] = [{ type: 'data', path: [], data: [JSON.parse(JSON.stringify({
        kind: 'harness_event', event, threadId: work.threadId ?? null,
      }))] }]
      if (event.kind === 'run.started' || event.kind === 'model.started') chunks.push({ type: 'step-start', path: [], messageId })
      else if (event.kind === 'model.delta') {
        const { partIndex, partType, delta } = event.data
        if (!index(partIndex) || (partType !== 'text' && partType !== 'reasoning') || typeof delta !== 'string') throw new Error('invalid model delta')
        if (event.data.partStart === true) chunks.push({ type: 'part-start', path: [partIndex], part: { type: partType } })
        chunks.push({ type: 'text-delta', path: [partIndex], textDelta: delta })
      } else if (event.kind === 'model.completed' && index(event.data.finishPartIndex)) {
        chunks.push({ type: 'part-finish', path: [event.data.finishPartIndex] })
      } else if (event.kind === 'tool.started') {
        const { partIndex, toolCallId, name } = event.data
        if (!index(partIndex) || typeof toolCallId !== 'string' || typeof name !== 'string') throw new Error('invalid tool start')
        chunks.push({ type: 'part-start', path: [partIndex], part: { type: 'tool-call', toolCallId, toolName: name } },
          { type: 'text-delta', path: [partIndex], textDelta: '{}' }, { type: 'tool-call-args-text-finish', path: [partIndex] })
      } else if (event.kind === 'tool.completed') {
        const { partIndex, result, isError } = event.data
        if (!index(partIndex) || typeof isError !== 'boolean') throw new Error('invalid tool completion')
        chunks.push({ type: 'result', path: [partIndex], result: JSON.parse(JSON.stringify(result)) as Extract<AssistantStreamChunk, { type: 'result' }>['result'], isError },
          { type: 'part-finish', path: [partIndex] })
      } else if (event.kind === 'run.failed' || event.kind === 'run.cancelled') {
        chunks.push({ type: 'error', path: [], error: String(event.data.error ?? event.kind) })
      } else if (event.kind === 'approval.pending') {
        const approval = await (await control()).readApproval({ approvalId: String(event.data.approvalId), tenantId: work.tenantId, principalId: work.principalId! })
        if (!approval) throw new Error('approval is unavailable')
        const view = approvalView(approval), clientNonce = `approval-${approval.approvalId}`
        const sent = await sendSystemChannelMessage({ companyId: work.tenantId, actorId: work.agentId, channelId: work.sessionId,
          clientNonce, ...(context ? { signal: context.signal } : {}), payload: { version: 1, kind: 'approval', clientMsgNo: clientNonce,
            body: view.summary, refs: { approvalId: approval.approvalId, runId: work.id, agentId: work.agentId },
            data: { ...view, payload: view.action, suppressAgentWake: true } } })
        if (sent.kind !== 'accepted') throw new Error(`approval delivery ${sent.kind}`)
      }
      if (chunks.length) await publish(CH_ASSISTANT_STREAM, { type: 'assistant.stream', companyId: work.tenantId,
        conversationId: work.sessionId, messageId, authorId: work.agentId, sequence: event.seq * 2, chunks })
    },
    async deliverMessage(work, message, context) {
      if (!context?.commit) throw new Error('committed result identity is required for native delivery')
      await loadRuntimeBinding(work)
      const clientNonce = `agent-${createHash('sha256').update(context.commit.resultId).digest('hex')}`
      const result = await sendAgentChannelMessage({ companyId: work.tenantId, agentId: work.agentId, channelId: work.sessionId,
        clientNonce, ...(context ? { signal: context.signal } : {}), payload: { version: 1, kind: 'text', clientMsgNo: clientNonce,
          body: message.body, ...(work.threadId ? { replyToClientMsgNo: work.threadId } : {}),
          refs: { runId: work.id, agentId: work.agentId }, data: { harness: message.envelope, harnessCommit: context.commit, suppressAgentWake: true } } })
      if (result.kind !== 'accepted') throw new Error(`assistant delivery ${result.kind}`)
      const identity: MessageIdentity = { runId: work.id, tenantId: work.tenantId, agentId: work.agentId, sessionId: work.sessionId }
      const usage = await (await control()).readUsage(identity)
      if (!usage) throw new Error('committed run usage is unavailable')
      await publish(CH_ASSISTANT_STREAM, { type: 'assistant.stream', companyId: work.tenantId, conversationId: work.sessionId,
        messageId: `preview-${work.id}`, authorId: work.agentId, sequence: usage.lastSeq * 2 + 1,
        chunks: [{ type: 'data', path: [], data: [{ kind: 'usage', pendingCalls: usage.pendingCalls, estimatedCalls: usage.estimatedCalls, costMicros: usage.costMicros }] },
          { type: 'message-finish', path: [], finishReason: ['awaiting_input','awaiting_approval','delegated'].includes(message.envelope.goalOutcome.status) ? 'tool-calls' : 'stop',
            usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } }] })
    },
  }
}
