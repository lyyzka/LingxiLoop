import { createHash } from 'node:crypto'
import { decodeSourceText, extractDocumentText, type RequestAttachment } from 'lingxios'
import { pool } from '../db/pool.js'
import { readAgentChannelMessages, agentContinuationSchema } from '../im/public.js'
import type { ImMessageEnvelope } from '../im/messages-application.js'
import { storage } from '../storage.js'
import { resolveCalendarAgentRequest } from '../modules/calendar/index.js'
import { resolveAgentHandoffWake } from '../modules/agents/index.js'
import { lingxiOSControl } from './runtime.js'
import { loadRuntimeBinding } from './context.js'

export interface AgentRequest {
  companyId: string; agentId: string; channelId: string; clientMsgNo: string
  attachmentClientMsgNos?: string[]
  kind?: 'message' | 'calendar' | 'handoff'
  continuation?: { runId: string; requestVersion: number }
  /** Required when a human invokes the HTTP continuation endpoint. */
  authenticatedUserId?: string
  signal?: AbortSignal
}

async function attachments(messages: ImMessageEnvelope[], ids: string[], companyId: string, signal: AbortSignal): Promise<RequestAttachment[]> {
  if (ids.length > 20) throw new Error('request supports at most 20 attachments')
  const result: RequestAttachment[] = []
  for (const id of ids) {
    const message = messages.find(item => item.clientMsgNo === id), data = message?.payload.data
    if (message?.payload.kind !== 'attachment' || typeof data?.key !== 'string' || !data.key.startsWith(`attachments/${companyId}/`)
      || typeof data.name !== 'string' || !data.name.trim() || typeof data.mime !== 'string' || !Number.isSafeInteger(data.size)
      || Number(data.size) < 0 || Number(data.size) > 16 * 1024 * 1024) throw new Error('invalid committed attachment')
    const bytes = Uint8Array.from(await storage.readObjectBounded(data.key, 16 * 1024 * 1024, signal))
    if (bytes.length !== data.size) throw new Error('attachment bytes differ from the committed size')
    const mime = data.mime.split(';')[0].trim().toLowerCase()
    const text = mime.startsWith('text/') || ['application/json','application/xml'].includes(mime) ? decodeSourceText(bytes)
      : mime === 'application/pdf' ? await extractDocumentText(bytes, 'pdf', signal)
      : mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? await extractDocumentText(bytes, 'docx', signal) : undefined
    result.push({ id, sourceVersion: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      name: data.name, mimeType: data.mime, size: bytes.length, ...(text === undefined ? {} : { text }) })
  }
  return result
}

/** Recover the author and payload from committed IM, including messages outside recent history. */
export async function receiveAgentRequest(input: AgentRequest) {
  const signal = AbortSignal.any([AbortSignal.timeout(30_000),...input.signal ? [input.signal] : []])
  const messages = await readAgentChannelMessages({ ...input, messageIds: [...new Set([input.clientMsgNo,...input.attachmentClientMsgNos ?? []])], signal })
  const message = messages?.find(item => item.clientMsgNo === input.clientMsgNo)
  if (!message || message.payload.version !== 1) throw new Error('committed request is unavailable')
  const api = await lingxiOSControl()
  if (input.kind === 'handoff') {
    const identity = await resolveAgentHandoffWake(input, message)
    await loadRuntimeBinding(identity)
    if (!await api.readRun(identity)) throw new Error('handoff child is unavailable')
    signal.throwIfAborted()
    return { id: identity.runId, deduplicated: true }
  }
  if (input.kind === 'calendar') {
    const request = await resolveCalendarAgentRequest(input, message)
    const identity = { tenantId: input.companyId, agentId: input.agentId, sessionId: input.channelId, principalId: request.principalId }
    const profile = await loadRuntimeBinding(identity)
    if (profile.teacher_managed || !profile.capabilities.includes('calendar')) throw new Error('calendar capability was revoked')
    const id = createHash('sha256').update(JSON.stringify(['calendar', input.companyId,input.agentId,input.channelId,input.clientMsgNo])).digest('hex')
    signal.throwIfAborted()
    return api.enqueue({ ...identity, ...request, id, sourceRef: input.clientMsgNo, threadId: input.clientMsgNo })
  }
  if (!['text','attachment'].includes(message.payload.kind) || message.payload.refs?.agentId
    || input.authenticatedUserId && input.authenticatedUserId !== message.fromUid) throw new Error('request must be committed by the authenticated human')
  const identity = { tenantId: input.companyId, agentId: input.agentId, sessionId: input.channelId, principalId: message.fromUid }
  await loadRuntimeBinding({ ...identity, createdAt: new Date(message.timestamp * 1000).toISOString() })
  const human = (await pool.query<{ name: string }>("SELECT name FROM participants WHERE company_id=$1 AND id=$2 AND kind='human' AND departed_at IS NULL",
    [input.companyId,message.fromUid])).rows[0]
  if (!human) throw new Error('request author is not an active human')
  const attachmentIds = [...new Set([...(input.attachmentClientMsgNos ?? []), ...(message.payload.kind === 'attachment' ? [input.clientMsgNo] : [])])]
  const files = await attachments(messages!, attachmentIds, input.companyId, signal)
  const text = message.payload.kind === 'text' ? message.payload.body?.trim()
    : `Use the committed attachment "${String(message.payload.data?.name)}" to help with the current conversation.`
  if (!text) throw new Error('request text is empty')
  const threadId = message.payload.replyToClientMsgNo
  const savedContinuation = message.payload.data?.agentContinuation === undefined ? undefined : agentContinuationSchema.parse(message.payload.data.agentContinuation)
  if (savedContinuation && (savedContinuation.agentId !== input.agentId || input.continuation
    && (input.continuation.runId !== savedContinuation.runId || input.continuation.requestVersion !== savedContinuation.requestVersion))) {
    throw new Error('continuation must match the committed reply')
  }
  const continuation = input.continuation ?? (savedContinuation ? { runId: savedContinuation.runId, requestVersion: savedContinuation.requestVersion } : undefined)
  signal.throwIfAborted()
  if (continuation) {
    if (message.payload.kind !== 'text') throw new Error('continuation requires a committed text reply')
    const result = await api.continueInput({ ...identity, ...continuation, ...(threadId ? { threadId } : {}),
      inputId: input.clientMsgNo, text, attachments: files })
    return { id: result.workId, deduplicated: result.status === 'already_resumed' }
  }
  const id = createHash('sha256').update(JSON.stringify([input.companyId,input.agentId,input.channelId,input.clientMsgNo])).digest('hex')
  return api.enqueue({ ...identity, id, sourceRef: input.clientMsgNo, authorName: human.name, text, attachments: files,
    ...(threadId ? { threadId } : {}) })
}
