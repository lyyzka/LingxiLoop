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
  lingxiOSArtifactQuerySchema,
  lingxiOSRunInputSchema,
  lingxiOSRunRevisionSchema,
  lingxiOSReconcileSchema,
} from './contracts.js'
import { lingxiOSControl } from '../agent-runtime/runtime.js'
import { receiveAgentRequest } from '../agent-runtime/receive.js'
import { approvalView } from '../agent-runtime/delivery.js'
import { loadRuntimeBinding } from '../agent-runtime/context.js'
import { presentationsApplication } from '../modules/presentations/public.js'
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
  res.json(approvalView(await approvalForCaller(req, false)))
}))

async function approvalForCaller(req: Request & AuthedRequest, control: boolean) {
  const { userId, companyId } = await identity(req)
  const approval = await (await lingxiOSControl()).readApproval({ tenantId: companyId, principalId: userId, approvalId: String(req.params.id) })
  if (!approval) throw Object.assign(new Error('approval not found'), { status: 404 })
  await loadRuntimeBinding(approval)
  await assertChannelPermission(userId, companyId, approval.sessionId, control ? 'agent_run:control' : 'conversation:read')
  return approval
}

imRouter.post('/approvals/:id/resolve', safe(async (req, res) => {
  const { approved } = requestInput(approvalResolutionRequestSchema, req.body)
  const app = await lingxiOSControl()
  const approval = await approvalForCaller(req, true)
  res.json({ ok: true, ...await app.decideApproval({ ...approval, approved }) })
}))

imRouter.post('/approvals/:id/reconcile', safe(async (req, res) => {
  const approval = await approvalForCaller(req, true)
  res.json(await (await lingxiOSControl()).reconcileAction(approval))
}))

imRouter.get('/channels/:id/agents/:agentId/runs/:runId', safe(async (req, res) => {
  const { userId, companyId } = await identity(req)
  const sessionId = String(req.params.id)
  await assertChannelPermission(userId, companyId, sessionId, 'conversation:read')
  const { afterSeq, threadId } = requestInput(lingxiOSRunQuerySchema, req.query)
  const runIdentity = { tenantId: companyId, sessionId, agentId: String(req.params.agentId), runId: String(req.params.runId), principalId: userId,
    ...(threadId ? { threadId } : {}) }
  const app = await lingxiOSControl()
  const state = await app.readRunState(runIdentity)
  if (!state) { res.status(404).json({ error: 'run not found' }); return }
  const [events, diagnostics, permission] = await Promise.all([app.readEvents(runIdentity,afterSeq),app.readDiagnostics(runIdentity),
    permissionService.can({ actorUserId: userId, companyId, action: 'agent_run:control', resource: { type: 'conversation', id: sessionId } })])
  res.json({ ...state, outcome: state.run.goalOutcome, ...events, diagnostics, canControl: permission.allowed })
}))

imRouter.post('/channels/:id/agents/:agentId/runs/:runId/reconcile', safe(async (req, res) => {
  const { userId, companyId } = await identity(req), sessionId = String(req.params.id)
  await assertChannelPermission(userId,companyId,sessionId,'agent_run:control')
  const { actionKey, threadId } = requestInput(lingxiOSReconcileSchema,req.body)
  res.json(await (await lingxiOSControl()).reconcileAction({ tenantId: companyId, sessionId, principalId: userId,
    agentId: String(req.params.agentId), runId: String(req.params.runId), actionKey,...threadId ? { threadId } : {} }))
}))

imRouter.get('/channels/:id/agents/:agentId/runs/:runId/artifact', safe(async (req, res) => {
  const { userId, companyId } = await identity(req), sessionId = String(req.params.id)
  await assertChannelPermission(userId, companyId, sessionId, 'conversation:read')
  const { path, threadId } = requestInput(lingxiOSArtifactQuerySchema, req.query)
  const run = { tenantId: companyId, sessionId, agentId: String(req.params.agentId), runId: String(req.params.runId), principalId: userId,
    ...(threadId ? { threadId } : {}) }
  const api = await lingxiOSControl(), manifest = (await api.readMessage(run))?.envelope.artifacts.find(item => item.path === path)
  if (!manifest) { res.status(404).json({ error: 'artifact not found' }); return }
  if (manifest.source?.ref.startsWith('document:')) await permissionService.assertCan({ actorUserId: userId, companyId,
    action: 'document:read', resource: { type: 'document', id: manifest.source.ref.slice(9) } })
  if (manifest.source?.ref.startsWith('presentation:')) await presentationsApplication.get(companyId, userId, manifest.source.ref.slice(13))
  const file = await api.readArtifact(run, path)
  if (!file) { res.status(404).json({ error: 'artifact not found' }); return }
  res.set({ 'Content-Type': file.artifact.mime, 'Content-Length': String(file.bytes.length), 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, no-store', ETag: `"${file.artifact.sha256}"`,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1) ?? 'artifact')}` })
  res.send(file.bytes)
}))

imRouter.post('/channels/:id/agents/:agentId/runs/:runId/input', safe(async (req, res) => {
  const { userId, companyId } = await identity(req), channelId = String(req.params.id)
  await assertChannelPermission(userId, companyId, channelId, 'agent_run:control')
  const { requestVersion, ...input } = requestInput(lingxiOSRunInputSchema, req.body)
  res.json(await receiveAgentRequest({ ...input, companyId, channelId, agentId: String(req.params.agentId), authenticatedUserId: userId,
    continuation: { runId: String(req.params.runId), requestVersion } }))
}))

imRouter.patch('/channels/:id/agents/:agentId/runs/:runId', safe(async (req, res) => {
  const { userId, companyId } = await identity(req), sessionId = String(req.params.id)
  await assertChannelPermission(userId, companyId, sessionId, 'agent_run:control')
  const { text, threadId } = requestInput(lingxiOSRunRevisionSchema, req.body)
  res.json({ revised: await (await lingxiOSControl()).revise({ tenantId: companyId, sessionId, principalId: userId,
    agentId: String(req.params.agentId), runId: String(req.params.runId), ...(threadId ? { threadId } : {}) }, text) })
}))

imRouter.post('/channels/:id/agents/:agentId/runs/:runId/delivery/retry', safe(async (req, res) => {
  const { userId, companyId } = await identity(req), sessionId = String(req.params.id)
  await assertChannelPermission(userId, companyId, sessionId, 'agent_run:control')
  const { threadId } = requestInput(lingxiOSRunCancelSchema, req.body ?? {})
  res.json({ retried: await (await lingxiOSControl()).retryDelivery({ tenantId: companyId, sessionId, principalId: userId,
    agentId: String(req.params.agentId), runId: String(req.params.runId), ...(threadId ? { threadId } : {}) }) })
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
