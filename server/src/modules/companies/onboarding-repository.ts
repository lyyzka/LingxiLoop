import { randomUUID } from 'node:crypto'
import type { Queryable } from '../../db/queryable.js'
import {
  STARTER_ROOMS as CANONICAL_STARTER_ROOMS,
  STARTER_TEAM as CANONICAL_STARTER_TEAM,
} from '../learning/contracts.js'


export const STARTER_TEAM = CANONICAL_STARTER_TEAM
export const STARTER_ROOMS = CANONICAL_STARTER_ROOMS

async function uniqueId(db: Queryable, preferredId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT 1 FROM participants WHERE id = $1 LIMIT 1`,
    [preferredId],
  )
  if (rows.length === 0) return preferredId
  // Suffix with a short random tail. Re-check (super unlikely to collide twice).
  for (let i = 0; i < 5; i++) {
    const candidate = `${preferredId}-${randomUUID().slice(0, 4)}`
    const { rows: r2 } = await db.query(
      `SELECT 1 FROM participants WHERE id = $1 LIMIT 1`,
      [candidate],
    )
    if (r2.length === 0) return candidate
  }
  // Worst case, full uuid suffix.
  return `${preferredId}-${randomUUID().slice(0, 12)}`
}


/** Install company-scoped agent definitions; conversations are created by courses. */
export async function installStarterAgents(db: Queryable, companyId: string): Promise<boolean> {
  const company = await db.query(`SELECT id FROM companies WHERE id=$1 FOR UPDATE`, [companyId])
  if (!company.rows[0]) throw new Error('company not found')
  const existing = await db.query<{ preset_key: string }>(`SELECT preset_key FROM participants
    WHERE company_id=$1 AND kind='agent' AND preset_key=ANY($2::text[])`, [companyId, STARTER_TEAM.map((agent) => agent.presetKey)])
  const installed = new Set(existing.rows.map((row) => row.preset_key))
  for (const agent of STARTER_TEAM) {
    if (installed.has(agent.presetKey)) continue
    const id = await uniqueId(db, agent.id)
    await db.query(`INSERT INTO participants(id,preset_key,kind,name,role,initial,avatar_bg,status,bio,tools,capabilities,system_prompt,company_id)
      VALUES($1,$2,'agent',$3,$4,$5,'transparent','avail',$6,$7::jsonb,$8::jsonb,$9,$10)`,
    [id,agent.presetKey,agent.name,agent.role,agent.initial,agent.bio,JSON.stringify(agent.tools),JSON.stringify(agent.capabilities),agent.systemPrompt,companyId])
  }
  return installed.size < STARTER_TEAM.length
}
