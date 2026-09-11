import type { Queryable } from '../../db/queryable.js'
import { ENTITLEMENT_CODES } from '../../domain/access/public.js'
import {
  EDUCATION_PLAN,
  type EntitlementValue,
  type Plan,
} from '../../domain/entitlement/public.js'

const CAPABILITY_CODES = ENTITLEMENT_CODES.filter((code) => !code.startsWith('teacher.'))

const EDUCATION_VALUES = new Map<string, EntitlementValue>([
  ...CAPABILITY_CODES.map((code) => [code, true] as const),
  ['teacher.expensive_compute', true],
  ['teacher.compute_tier', 'pro'],
])

async function ensurePlan(
  db: Queryable,
  plan: Plan,
  values: ReadonlyMap<string, EntitlementValue>,
): Promise<string> {
  await db.query(
    `INSERT INTO plans (id,code,name,status) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET
       code=EXCLUDED.code,name=EXCLUDED.name,status=EXCLUDED.status`,
    [plan.id, plan.code, plan.name, plan.status],
  )
  for (const [code, value] of values) {
    const entitlementId = `entitlement-${code.replaceAll('.', '-')}`
    await db.query(
      `INSERT INTO entitlements (id,code,description) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,description=EXCLUDED.description`,
      [entitlementId, code, `Defines ${code} in the current access context`],
    )
    await db.query(
      `INSERT INTO plan_entitlements (plan_id,entitlement_id,value) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (plan_id,entitlement_id) DO UPDATE SET value=EXCLUDED.value`,
      [plan.id, entitlementId, JSON.stringify(value)],
    )
  }
  return plan.id
}

export async function ensureEducationPlan(db: Queryable): Promise<string> {
  return ensurePlan(db, EDUCATION_PLAN, EDUCATION_VALUES)
}

export async function setCompanyPlan(db: Queryable, companyId: string, planId: string, now: string): Promise<void> {
  await db.query(`UPDATE companies SET plan_id=$2,updated_at=$3 WHERE id=$1`, [companyId, planId, now])
}

