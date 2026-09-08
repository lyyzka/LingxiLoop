import type { Queryable } from '../../db/queryable.js'
import type { CompanyStatus, ProjectKind, ProjectStatus } from '../../domain/public.js'
import type { CreateEducationCompanyInput } from './contracts.js'

export interface EducationCoreIds { companyId: string; contractId: string }

interface DueContractRow {
  id: string
  company_id: string
  company_status: CompanyStatus
  ends_at: Date
}

export interface ExpiredEducationContract {
  contractId: string
  companyId: string
  previousCompanyStatus: CompanyStatus
  projects: Array<{ id: string; kind: ProjectKind; status: ProjectStatus }>
  endsAt: Date
}

export async function insertEducationCore(db: Queryable, input: CreateEducationCompanyInput & EducationCoreIds & { creatorUserId: string }): Promise<boolean> {
  const { rows: users } = await db.query<{ display_name: string; avatar_url: string | null }>(
    `SELECT display_name,avatar_url FROM users WHERE id=$1 AND deleted_at IS NULL AND suspended_at IS NULL FOR UPDATE`, [input.creatorUserId],
  )
  if (!users[0]) throw new Error('active creator user required')
  const { rows: plans } = await db.query(`SELECT 1 FROM plans WHERE id=$1 AND status='ACTIVE'`, [input.planId])
  if (!plans[0]) throw new Error('active Education Plan required')
  const company = await db.query(
    `INSERT INTO companies(id,name,slug,type,status,plan_id)
     VALUES ($1,$2,$3,'EDUCATION','TRIAL',$4) ON CONFLICT (id) DO NOTHING`,
    [input.companyId, input.name, input.slug, input.planId],
  )
  if (company.rowCount === 0) {
    const { rows } = await db.query<{ name: string; slug: string; plan_id: string; type: string }>(
      `SELECT name,slug,plan_id,type FROM companies WHERE id=$1 FOR UPDATE`, [input.companyId],
    )
    if (!rows[0] || rows[0].type !== 'EDUCATION' || rows[0].name !== input.name || rows[0].slug !== input.slug || rows[0].plan_id !== input.planId) {
      throw new Error('Education Company idempotency identity was reused')
    }
  }
  await db.query(
    `INSERT INTO education_contracts(id,company_id,plan_id,status,starts_at,ends_at,seat_limit,config)
     VALUES ($1,$2,$3,'TRIAL',$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING`,
    [input.contractId, input.companyId, input.planId, input.contract.startsAt, input.contract.endsAt, input.contract.seatLimit, JSON.stringify(input.contract.config)],
  )
  return company.rowCount === 1
}

export async function expireNextDueEducationContract(
  db: Queryable,
  now: Date,
): Promise<ExpiredEducationContract | null> {
  const { rows } = await db.query<DueContractRow>(
    `SELECT contract.id,contract.company_id,contract.ends_at,company.status AS company_status
       FROM education_contracts contract
       JOIN companies company ON company.id=contract.company_id AND company.type='EDUCATION'
      WHERE contract.status IN ('TRIAL','ACTIVE') AND contract.ends_at <= $1
        AND company.status<>'DELETED'
      ORDER BY contract.ends_at,contract.id
      LIMIT 1 FOR UPDATE OF contract,company SKIP LOCKED`,
    [now],
  )
  const contract = rows[0]
  if (!contract) return null

  const contractUpdate = await db.query(
    `UPDATE education_contracts SET status='EXPIRED',version=version+1,updated_at=$2
      WHERE id=$1 AND company_id=$3 AND status IN ('TRIAL','ACTIVE') AND ends_at <= $2`,
    [contract.id, now, contract.company_id],
  )
  if (contractUpdate.rowCount !== 1) {
    throw new Error('Education Contract expiry changed concurrently')
  }

  const { rows: projects } = await db.query<{ id: string; kind: ProjectKind; status: ProjectStatus }>(
    `SELECT id,kind,status FROM projects
      WHERE company_id=$1 AND kind='INSTITUTIONAL_COURSE' AND status='ACTIVE'
      ORDER BY id FOR UPDATE`,
    [contract.company_id],
  )
  return {
    contractId: contract.id,
    companyId: contract.company_id,
    previousCompanyStatus: contract.company_status,
    projects,
    endsAt: contract.ends_at,
  }
}
