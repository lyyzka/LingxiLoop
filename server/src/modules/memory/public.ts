import { z } from 'zod'
import { NoEffectError, recallMemories, readMemory, writeMemory, type ActionContext, type MemoryScope,
  type MemoryMutation, type MemoryOptions, type ToolDefinition } from 'lingxios'
import { nativeTool, compareResource } from '../../agents/tools.js'
import { createPermissionService } from '../access/public.js'
import type { Queryable } from '../../db/queryable.js'

const identity = { scope: z.enum(['learner','course','agent_role']).default('course'), learnerId: z.string().trim().min(1).max(200).optional() }
const version = { id: z.string().min(1).max(200), expectedVersion: z.number().int().positive() }
const expiry = z.iso.datetime({ offset: true }).refine(value => Date.parse(value) > Date.now(), 'Expiry must be in the future').optional()
export const agentMemorySchemas = {
  list: z.strictObject({ ...identity, limit: z.number().int().min(1).max(12).default(12) }),
  recall: z.strictObject({ ...identity, query: z.string().max(2000).default(''), limit: z.number().int().min(1).max(12).default(12) }),
  note: z.strictObject({ ...identity, body: z.string().trim().min(1).max(2000), kind: z.string().regex(/^[a-z_]{1,32}$/).default('observation'), validUntil: expiry }),
  verify: z.strictObject({ ...identity, ...version, validUntil: expiry }),
  pin: z.strictObject({ ...identity, ...version, pinned: z.boolean() }),
  delete: z.strictObject({ ...identity, ...version }),
}

async function scope(context: ActionContext, input: z.output<typeof agentMemorySchemas.list>, write: boolean): Promise<MemoryScope> {
  const { work } = context, db = context.database as Queryable
  if (!work.principalId) throw new NoEffectError('Original human is required', 'forbidden')
  await createPermissionService(db, { lockDependencies: true }).assertCan({ actorUserId: work.principalId,
    companyId: work.tenantId, action: write ? 'agent_memory:write' : 'agent_memory:read', resource: { type: 'conversation', id: work.sessionId } })
  if (input.scope === 'learner') {
    if (!input.learnerId) throw new NoEffectError('learnerId is required for learner memory', 'invalid_arguments')
    const member = await db.query(`SELECT 1 FROM participants p JOIN im_channel_bindings b ON b.company_id=p.company_id AND b.channel_id=$3
      WHERE p.id=$2 AND p.company_id=$1 AND p.kind='human' AND p.departed_at IS NULL AND b.profile->'members' ? p.id FOR SHARE OF p,b`,
    [work.tenantId,input.learnerId,work.sessionId])
    if (!member.rows.length) throw new NoEffectError('Learner is not an active conversation member', 'forbidden')
  } else if (input.learnerId) throw new NoEffectError('learnerId requires learner scope', 'invalid_arguments')
  return { tenantId: work.tenantId, scopeType: input.scope,
    scopeId: input.scope === 'learner' ? input.learnerId! : input.scope === 'course' ? work.sessionId : work.agentId }
}

/** Core sees only the scopes currently authorized by this product. */
export const resolveMemoryScopes: MemoryOptions['resolveScopes'] = async (work, database) => {
  if (!work.principalId) throw new NoEffectError('Original human is required', 'forbidden')
  const db = database as Queryable
  const membership = await db.query(`SELECT 1 FROM participants human JOIN participants agent ON agent.company_id=human.company_id
    JOIN im_channel_bindings binding ON binding.company_id=human.company_id AND binding.channel_id=$4
    WHERE human.company_id=$1 AND human.id=$2 AND human.kind='human' AND human.departed_at IS NULL
      AND agent.id=$3 AND agent.kind='agent' AND agent.departed_at IS NULL
      AND binding.profile->'members' ? human.id AND binding.profile->'members' ? agent.id
      AND NOT EXISTS(SELECT 1 FROM learning_project_teacher_agents t WHERE t.company_id=agent.company_id AND t.agent_id=agent.id)
    FOR SHARE OF human,agent,binding`, [work.tenantId,work.principalId,work.agentId,work.sessionId])
  if (!membership.rows.length) return []
  const permissions = createPermissionService(db, { lockDependencies: true })
  await permissions.assertCan({ actorUserId: work.principalId, companyId: work.tenantId,
    action: work.kind === 'memory_synthesis' ? 'agent_memory:write' : 'agent_memory:read', resource: { type: 'conversation', id: work.sessionId } })
  return [{ tenantId: work.tenantId, scopeType: 'learner', scopeId: work.principalId },
    { tenantId: work.tenantId, scopeType: 'course', scopeId: work.sessionId },
    { tenantId: work.tenantId, scopeType: 'agent_role', scopeId: work.agentId }]
}

type Recall = (context: ActionContext, scope: MemoryScope, query: string, limit: number) => Promise<Array<Record<string, unknown>>>
export function createMemoryTools(recall: Recall = (context, scope, query, limit) => recallMemories(context.database,scope,query,limit)): ToolDefinition[] {
  return Object.entries(agentMemorySchemas).map(([method, schema]) => nativeTool(`memory.${method}`,schema, {
    description: 'Read or maintain versioned conversation, learner, or agent memory. Learner memory requires an active human learnerId.',
    effect: method === 'list' || method === 'recall' ? 'read' : 'transaction', approval: false,
    async authorize(context, input) { await scope(context,{ ...input, limit: 12 },method !== 'list' && method !== 'recall') },
    async execute(context, input) {
      const resolved = await scope(context,{ ...input, limit: 12 },method !== 'list' && method !== 'recall')
      if (method === 'list' || method === 'recall') return { ok: true, executionState: 'succeeded',
        value: await recall(context,resolved,'query' in input ? String(input.query) : '', 'limit' in input ? Number(input.limit) : 12) }
      return { ok: true, executionState: 'succeeded', value: await writeMemory(context.database,resolved,
        { ...input, method } as MemoryMutation, { actionId: context.action.idempotencyKey, workId: context.work.id, request: await context.requestSnapshot() }) }
    },
    ...(method === 'list' || method === 'recall' ? {} : { async verify(context: ActionContext, input: z.output<typeof schema>, value: unknown) {
      const resolved = await scope(context,{ ...input, limit: 12 },false), expected = value as Record<string, unknown>
      const current = await readMemory(context.database,resolved,String(expected.id))
      return compareResource(`memory:${resolved.scopeType}:${resolved.scopeId}:${expected.id}`,
        method === 'delete' ? { deleted: true } : expected, current ?? { deleted: true })
    } }),
  })) as ToolDefinition[]
}
