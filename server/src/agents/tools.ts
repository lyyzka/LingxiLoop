import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { NoEffectError, type ActionContext, type ToolDefinition } from 'lingxios'
import type { Queryable } from '../db/queryable.js'
import { createPermissionService } from '../modules/access/public.js'
import type { AgentActionContext } from './contracts.js'
import { assignedHandoff } from '../modules/agents/handoff-repository.js'

export function compareResource(resource: string, expected: Record<string, unknown>, actual: object) {
  // Receipts cross a JSON boundary; PostgreSQL Date values must compare in that same representation.
  const json = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown
  const fields = Object.keys(expected), observed = Object.fromEntries(fields.map(field => [field, json(Reflect.get(actual, field))]))
  const mismatches = fields.filter(field => !isDeepStrictEqual(observed[field], json(expected[field])))
  return { status: mismatches.length ? 'failed' as const : 'passed' as const,
    evidence: { resource, fields, mismatches, observed } }
}

export function nativeContext(context: Pick<ActionContext, 'work'>): AgentActionContext {
  const work = context.work
  return { id: work.id, companyId: work.tenantId, authorizationUserId: work.principalId,
    agentId: work.agentId, channelId: work.sessionId, triggerClientMsgNo: work.triggerRef,
    ...(work.threadId ? { threadRootClientMsgNo: work.threadId } : {}),
    reason: work.kind === 'teacher_digest' ? 'routine' : ['handoff', 'routine', 'resume', 'canvas_worker', 'canvas_summary'].includes(work.kind)
      ? work.kind as AgentActionContext['reason'] : 'message' }
}

export async function authorizeAgent(context: ActionContext): Promise<void> {
  context.signal.throwIfAborted()
  const { work } = context
  if (!work.principalId) throw new NoEffectError('original human principal is required', 'forbidden')
  const db = context.database as Queryable
  const { rows } = await db.query<{ capabilities: string[]; teacher_managed: boolean }>(`SELECT p.capabilities,
      EXISTS(SELECT 1 FROM learning_project_teacher_agents teacher WHERE teacher.company_id=p.company_id AND teacher.agent_id=p.id) AS teacher_managed
    FROM participants p JOIN im_channel_bindings b ON b.company_id=p.company_id AND b.channel_id=$3
    WHERE p.id=$2 AND p.company_id=$1 AND p.kind='agent' AND p.departed_at IS NULL
      AND b.profile->'members' ? p.id FOR SHARE OF p,b`, [work.tenantId,work.agentId,work.sessionId])
  const agent = rows[0], namespace = context.action.action.split('.')[0]
  const capability = namespace === 'research' ? 'web' : namespace === 'presentations' ? 'knowledge' : namespace
  const assigned = ['handoffs.list','handoffs.update'].includes(context.action.action) && !!await assignedHandoff(db,work)
  if (!agent || agent.teacher_managed !== (namespace === 'teacher')
    || !['teacher', 'memory', 'chat', 'polls', 'directory'].includes(namespace) && !agent.capabilities.includes(capability) && !assigned) {
    throw new NoEffectError('agent capability or membership was revoked', 'forbidden')
  }
  await createPermissionService(db, { lockDependencies: true }).assertCan({ actorUserId: work.principalId,
    companyId: work.tenantId, action: 'conversation:read', resource: { type: 'conversation', id: work.sessionId } })
}

/** Both model JSON Schema and native parsing come from this same schema. */
export function nativeTool<S extends z.ZodObject>(action: string, schema: S,
  definition: Omit<ToolDefinition<z.output<S>>, 'action' | 'name' | 'parameters' | 'parse'>): ToolDefinition<z.output<S>> {
  const parameters = z.toJSONSchema(schema, { io: 'input' })
  if (parameters.type !== 'object' || !parameters.properties || parameters.additionalProperties !== false) throw new Error(`${action} requires a strict object schema`)
  return { ...definition, action, name: action.replace('.', '__'), parameters: parameters as ToolDefinition['parameters'],
    parse: input => schema.parse(input),
    async authorize(context, input) {
      try { await authorizeAgent(context); await definition.authorize(context, input) }
      catch (error) { if (error instanceof Error && 'reason' in error) throw new NoEffectError(error.message, 'forbidden'); throw error }
    },
    ...(definition.verify ? { async verify(context: ActionContext, input: z.output<S>, value: unknown) {
      await authorizeAgent(context)
      return definition.verify!(context, input, value)
    } } : {}),
  }
}
