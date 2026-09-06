import { Router, type Request, type Response, type NextFunction } from 'express'
import type { ZodType } from 'zod'
import type { AuthedRequest } from '../auth.js'
import type { LingxiMessageV1 } from './message-types.js'
import { assertTeacherRoomAccessible } from '../modules/learning/public.js'
import type { PermissionAction } from '../modules/access/public.js'
import { permissionService } from '../modules/access/public.js'
import { imAccessApplication } from './access-facade.js'
import { imChannelsApplication } from './channels-facade.js'
import { imMessagesApplication } from './messages-facade.js'
import { imSessionApplication } from './session-facade.js'
import {
  approvalResolutionRequestSchema,
  imHistoryQuerySchema,
  imReactionRequestSchema,
  imReadReceiptsQuerySchema,
  imReadRequestSchema,
  imSendAcceptanceRequestSchema,
  lingxiOSRunCancelSchema,
  lingxiOSRunQuerySchema,
} from './contracts.js'
import { lingxiOSControl } from '../agent-runtime/runtime.js'
import {
  isReadReceiptChannelMember,
  listReadReceiptAdvances,
} from './read-receipts.js'

export const imRouter = Router()

function safe(handler: (req: Request & AuthedRequest, res: Response) => Promise<void>): (req: Request & AuthedRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => { void handler(req, res).catch(next) }
}

function requestInput<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message ?? 'invalid request'), { status: 400 })
  }
  return parsed.data
}

async function identity(req: Request & AuthedRequest): Promise<{ userId: string; companyId: string }> {
  const userId = req.authUserId
  const companyId = String(req.headers['x-company-id'] ?? '').trim()
  if (!userId) throw Object.assign(new Error('authentication required'), { status: 401 })
  if (!companyId) throw Object.assign(new Error('x-company-id required'), { status: 400 })
  if (!await imAccessApplication.authorize({ userId, companyId })) {
    throw Object.assign(new Error('not a company member'), { status: 403 })
  }
  return { userId, companyId }
}

async function assertChannelPermission(
  userId: string,
  companyId: string,
  channelId: string,
  action: PermissionAction,
): Promise<void> {
  await permissionService.assertCan({
    actorUserId: userId,
    action,
    companyId,
    resource: { type: 'conversation', id: channelId },
  })
}

imRouter.get('/bootstrap', safe(async (req, res) => {
  const { userId } = await identity(req)
  res.json(await imSessionApplication.bootstrap(userId))
}))

imRouter.get('/approvals/:id', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  res.json(await (await lingxiOSControl()).inspectApproval({ companyId, userId, approvalId: String(req.params.id) }))
}))

imRouter.post('/approvals/:id/resolve', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const approvalId = String(req.params.id)
  const { approved } = requestInput(approvalResolutionRequestSchema, req.body)
  const app = await lingxiOSControl()
  if (!approved) { res.json(await app.rejectApproval({ companyId, userId, approvalId })); return }
  const review = await app.inspectApproval({ companyId, userId, approvalId })
  const action = review.action.action
  const resolve = action.startsWith('calendar.') ? app.approveCalendar
    : action.startsWith('documents.') ? app.approveDocument
    : action.startsWith('email.') ? app.approveEmail
    : action.startsWith('presentations.') ? app.approvePresentation
    : action.startsWith('knowledge.') ? app.approveKnowledge
    : action.startsWith('teacher.') ? app.approveTeacher
    : action.startsWith('routines.') ? app.approveRoutine
    : undefined
  if (!resolve) throw new Error(`unsupported LingxiOS approval action: ${action}`)
  res.json(await resolve({ companyId, userId, approvalId }))
}))

imRouter.post('/approvals/:id/reconcile', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  res.json(await (await lingxiOSControl()).reconcileKnowledgeApproval({
    companyId, userId, approvalId: String(req.params.id),
  }))
}))

imRouter.get('/channels/:id/agents/:agentId/runs/:runId', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const sessionId = String(req.params.id)
  await assertChannelPermission(userId, companyId, sessionId, 'conversation:read')
  const runIdentity = { tenantId: companyId, sessionId, agentId: String(req.params.agentId), runId: String(req.params.runId) }
  const app = await lingxiOSControl()
  const { afterSeq } = requestInput(lingxiOSRunQuerySchema, req.query)
  const [outcome, message, delivery, events] = await Promise.all([
    app.readOutcome(runIdentity), app.readMessage(runIdentity), app.readDelivery(runIdentity), app.readEvents(runIdentity, afterSeq),
  ])
  if (!outcome && !message && delivery === null && events.events.length === 0) { res.status(404).json({ error: 'run not found' }); return }
  res.json({ outcome, message, delivery, ...events })
}))

imRouter.delete('/channels/:id/agents/:agentId/runs/:runId', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const sessionId = String(req.params.id)
  await permissionService.assertCan({ actorUserId: userId, companyId, action: 'agent_run:control',
    resource: { type: 'conversation', id: sessionId } })
  const { threadId } = requestInput(lingxiOSRunCancelSchema, req.body ?? {})
  const cancelled = await (await lingxiOSControl()).cancel({ tenantId: companyId, principalId: userId, sessionId,
    agentId: String(req.params.agentId), runId: String(req.params.runId), ...(threadId ? { threadId } : {}) })
  res.json({ cancelled })
}))

imRouter.post('/refresh', safe(async (req, res) => {
  const { userId } = await identity(req)
  res.json(await imSessionApplication.bootstrap(userId))
}))

imRouter.get('/channels', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const projectId = String(req.headers['x-project-id'] ?? '').trim()
  if (!projectId) { res.status(400).json({ error: 'x-project-id required' }); return }
  await permissionService.assertCan({ actorUserId: userId, action: 'project:read', companyId, projectId })
  res.json(await imChannelsApplication.list({ companyId, userId, projectId }))
}))

imRouter.get('/channels/:id/messages', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const channelId = String(req.params.id)
  await assertChannelPermission(userId, companyId, channelId, 'conversation:read')
  await assertTeacherRoomAccessible(channelId,companyId,userId)
  const { limit, beforeSeq } = requestInput(imHistoryQuerySchema, req.query)
  const messages = await imMessagesApplication.history({ companyId, userId, channelId, limit, beforeSequence: beforeSeq })
  if (!messages) { res.status(404).json({ error: 'channel not found' }); return }
  res.json(messages)
}))

imRouter.post('/channels/:id/reactions', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const channelId = String(req.params.id)
  await assertChannelPermission(userId, companyId, channelId, 'conversation:write')
  await assertTeacherRoomAccessible(channelId, companyId, userId)
  const { messageId, messageSeq, emoji } = requestInput(imReactionRequestSchema, req.body)
  const result = await imMessagesApplication.toggleReaction({
    companyId, userId, channelId, messageId, messageSeq, emoji,
  })
  if (!result) { res.status(404).json({ error: 'message not found in the authoritative channel history' }); return }
  res.json(result)
}))

imRouter.post('/channels/:id/messages/accept', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const channelId = String(req.params.id)
  await assertChannelPermission(userId, companyId, channelId, 'conversation:write')
  await assertTeacherRoomAccessible(channelId,companyId,userId)
  const { clientNonce, payload: parsedPayload } = requestInput(imSendAcceptanceRequestSchema, req.body)
  if (parsedPayload.clientMsgNo !== clientNonce) {
    res.status(400).json({ error: 'valid clientNonce and matching LingxiMessageV1 payload required' }); return
  }
  const rawData = parsedPayload.data ?? {}
  const { suppressAgentWake: _suppressAgentWake, ...safeData } = rawData
  const payload: LingxiMessageV1 = {
    version: 1, kind: parsedPayload.kind, clientMsgNo: clientNonce,
    ...(parsedPayload.body ? { body: parsedPayload.body } : {}),
    ...(parsedPayload.replyToClientMsgNo ? { replyToClientMsgNo: parsedPayload.replyToClientMsgNo } : {}),
    data: safeData,
  }
  const result = await imMessagesApplication.acceptUserMessage({
    companyId, userId, channelId, clientNonce, payload,
  })
  if (result.kind === 'channel_not_found') { res.status(404).json({ error: 'channel not found' }); return }
  if (result.kind === 'nonce_conflict') { res.status(409).json({ error: 'clientNonce was reused with different input' }); return }
  res.status(result.duplicate ? 200 : 202).json({ status: 'accepted', echo: result.echo, ...(result.duplicate ? { duplicate: true } : {}) })
}))

imRouter.get('/sends/:clientNonce', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const status = await imMessagesApplication.sendStatus({
    companyId, userId, clientNonce: String(req.params.clientNonce),
  })
  if (!status) { res.status(404).json({ error: 'send acceptance not found' }); return }
  res.json(status)
}))

imRouter.post('/channels/:id/read', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const channelId = String(req.params.id)
  await assertChannelPermission(userId, companyId, channelId, 'conversation:read')
  await assertTeacherRoomAccessible(channelId,companyId,userId)
  const { readThroughSeq } = requestInput(imReadRequestSchema, req.body)
  const result = await imMessagesApplication.markRead({ companyId, userId, channelId, readThroughSeq })
  if (result.kind === 'channel_not_found') { res.status(404).json({ error: 'channel not found' }); return }
  if (result.kind === 'cursor_ahead') {
    res.status(400).json({ error: 'readThroughSeq exceeds latest channel sequence', latestSeq: result.latestSeq })
    return
  }
  res.json({ ok: true, latestSeq: result.latestSeq, receipt: result.receipt })
}))

imRouter.get('/channels/:id/read-receipts', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const channelId = String(req.params.id)
  await assertChannelPermission(userId, companyId, channelId, 'conversation:read')
  await assertTeacherRoomAccessible(channelId, companyId, userId)
  if (!await isReadReceiptChannelMember({ companyId, channelId, userId })) {
    res.status(404).json({ error: 'channel not found' }); return
  }
  const { fromSeq, toSeq } = requestInput(imReadReceiptsQuerySchema, req.query)
  const receipts = await listReadReceiptAdvances({ companyId, channelId, fromSeq, toSeq })
  res.json({ channelId, fromSeq, toSeq, receipts })
}))
