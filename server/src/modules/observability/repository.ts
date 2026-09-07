import type { Queryable } from '../../db/queryable.js'

export async function activityAgentNames(db: Queryable, companyId: string, agentIds: string[]) {
  const { rows } = await db.query<{ id: string; name: string }>(
    'SELECT id,name FROM participants WHERE company_id=$1 AND id=ANY($2::text[])', [companyId, agentIds],
  )
  return new Map(rows.map(row => [row.id, row.name]))
}
