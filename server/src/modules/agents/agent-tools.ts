import { z } from 'zod'
import type { ActionContext, ToolDefinition } from 'lingxios'
import type { Queryable } from '../../db/queryable.js'
import { nativeTool } from '../../agents/tools.js'
import { createPermissionService } from '../access/public.js'
import { AgentDirectoryApplication } from './directory-application.js'

const empty = z.object({}).strict()
const participants = z.object({ kind: z.enum(['agent','human']).optional() }).strict()
const application = (context: ActionContext) => new AgentDirectoryApplication(context.database as Queryable)
const authorize = async (context: ActionContext) => { await createPermissionService(context.database as Queryable, { lockDependencies: true }).assertCan({
  actorUserId: context.work.principalId!, companyId: context.work.tenantId, action: 'agent:read', resource: { type: 'agent', id: context.work.agentId } }) }

export const directoryTools: ToolDefinition[] = [
  nativeTool('directory.self', empty, { description: 'Read this agent’s identity and authorized conversations.', effect: 'read', approval: false, authorize,
    async execute(context) {
      const value = await application(context).identity(context.work.agentId)
      for (const conversation of value.conversations) await createPermissionService(context.database as Queryable).assertCan({
        actorUserId: context.work.principalId!, companyId: context.work.tenantId, action: 'conversation:read', resource: { type: 'conversation', id: conversation.id } })
      return { ok: true, value }
    } }),
  nativeTool('directory.participants', participants, { description: 'List active workspace participants.', effect: 'read', approval: false, authorize,
    async execute(context, input) { return { ok: true, value: await application(context).participants(context.work.agentId, input.kind ?? null) } } }),
  nativeTool('directory.statuses', empty, { description: 'List active workspace agent statuses.', effect: 'read', approval: false, authorize,
    async execute(context) { return { ok: true, value: await application(context).statuses(context.work.agentId) } } }),
]
