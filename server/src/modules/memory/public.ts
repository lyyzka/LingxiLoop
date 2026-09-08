import { NoEffectError, type MemoryOptions } from 'lingxios'
import { createPermissionService } from '../access/public.js'
import type { Queryable } from '../../db/queryable.js'

/** LingxiOS v3 sees only the scopes currently authorized by this product. */
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
    action: 'agent_memory:write', resource: { type: 'conversation', id: work.sessionId } })
  return [{ tenantId: work.tenantId, scopeType: 'learner', scopeId: work.principalId },
    { tenantId: work.tenantId, scopeType: 'course', scopeId: work.sessionId },
    { tenantId: work.tenantId, scopeType: 'agent_role', scopeId: work.agentId }]
}
