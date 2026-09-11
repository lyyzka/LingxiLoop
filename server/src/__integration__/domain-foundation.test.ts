import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { pool } from '../db/pool.js'
import { EDUCATION_PLAN } from '../domain/entitlement/public.js'
import { seedMembershipPeriod, ensureSchemaOnce, resetAllTables, teardownAll } from './_helpers.js'

const USER = 'u-domain-foundation'
const SECOND_USER = 'u-domain-foundation-second'
const COMPANY_A = 'co-domain-a'
const COMPANY_B = 'co-domain-b'
const PROJECT_A_STUDENT = 'project-domain-a-student'
const PROJECT_A_TEACHER = 'project-domain-a-teacher'
const PROJECT_B = 'project-domain-b'

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

before(async () => { await ensureSchemaOnce() })
beforeEach(async () => {
  await resetAllTables()
  await pool.query(
    `INSERT INTO users (id,email,display_name) VALUES
       ($1,'domain-user@example.com','Domain User'),
       ($2,'domain-second@example.com','Domain Second')`,
    [USER, SECOND_USER],
  )
  await pool.query(
    `INSERT INTO companies (id,name,slug,type,plan_id) VALUES
       ($1,'Domain A','domain-a','EDUCATION','plan-education'),
       ($2,'Domain B','domain-b','EDUCATION','plan-education')`,
    [COMPANY_A, COMPANY_B],
  )
  await pool.query(
    `INSERT INTO company_memberships (company_id,user_id,role) VALUES
       ($1,$3,'STUDENT'),($2,$4,'TEACHER')`,
    [COMPANY_A, COMPANY_B, USER, SECOND_USER],
  )
  await seedMembershipPeriod(pool,COMPANY_A,USER)
  await seedMembershipPeriod(pool,COMPANY_B,SECOND_USER)
  await pool.query(
    `INSERT INTO projects (id,company_id,kind,name,created_by) VALUES
       ($1,$4,'INSTITUTIONAL_COURSE','Student Project',$6),
       ($2,$4,'INSTITUTIONAL_COURSE','Teacher Project',$6),
       ($3,$5,'INSTITUTIONAL_COURSE','Other Company Project',$7)`,
    [PROJECT_A_STUDENT, PROJECT_A_TEACHER, PROJECT_B, COMPANY_A, COMPANY_B, USER, SECOND_USER],
  )
})
after(async () => { await teardownAll() })

test('[integration] fixed identity and one company are database constraints', async () => {
  await assert.rejects(pool.query(`INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,'STUDENT')`, [COMPANY_B,USER]), error => pgCode(error)==='23505')
  await assert.rejects(pool.query(`INSERT INTO project_memberships(company_id,project_id,user_id,role) VALUES($1,$2,$3,'TEACHER')`, [COMPANY_A,PROJECT_A_TEACHER,USER]), /matching active company identity/)
})

test('[integration] duplicate and cross-company project memberships fail closed', async () => {
  await pool.query(
    `INSERT INTO project_memberships (company_id,project_id,user_id,role)
     VALUES ($1,$2,$3,'STUDENT')`,
    [COMPANY_A, PROJECT_A_STUDENT, USER],
  )

  await assert.rejects(
    pool.query(
      `INSERT INTO project_memberships (company_id,project_id,user_id,role)
       VALUES ($1,$2,$3,'STUDENT')`,
      [COMPANY_A, PROJECT_A_STUDENT, USER],
    ),
    (error) => pgCode(error) === '23505',
  )
  await assert.rejects(
    pool.query(
      `INSERT INTO project_memberships (company_id,project_id,user_id,role)
       VALUES ($1,$2,$3,'STUDENT')`,
      [COMPANY_B, PROJECT_A_TEACHER, USER],
    ),
    (error) => pgCode(error) === '23503' || pgCode(error) === 'P0001',
  )
})

test('[integration] company types and project kinds reject statuses from other lifecycles', async () => {
  for (const invalid of [
    {
      id: 'co-domain-invalid-personal', slug: 'domain-invalid-personal',
      type: 'PERSONAL', status: 'TRIAL', personalOwnerUserId: USER,
    },
    {
      id: 'co-domain-invalid-education', slug: 'domain-invalid-education',
      type: 'EDUCATION', status: 'USER_DELETION_PENDING', personalOwnerUserId: null,
    },
  ]) {
    await assert.rejects(
      pool.query(
        `INSERT INTO companies (id,name,slug,type,status,plan_id)
         VALUES ($1,'Invalid lifecycle',$2,$3,$4,$5)`,
        [
          invalid.id, invalid.slug, invalid.type, invalid.status,
          EDUCATION_PLAN.id,
        ],
      ),
      (error) => pgCode(error) === '23514',
    )
  }

  for (const invalid of [
    { id: 'project-domain-invalid-personal', kind: 'PERSONAL_LEARNING', status: 'DRAFT' },
    { id: 'project-domain-invalid-teaching', kind: 'TEACHING', status: 'RETENTION' },
    { id: 'project-domain-invalid-institutional', kind: 'INSTITUTIONAL_COURSE', status: 'TRANSFER_PENDING' },
  ]) {
    await assert.rejects(
      pool.query(
        `INSERT INTO projects (id,company_id,kind,name,status,created_by)
         VALUES ($1,$2,$3,'Invalid lifecycle',$4,$5)`,
        [invalid.id, COMPANY_A, invalid.kind, invalid.status, USER],
      ),
      (error) => pgCode(error) === '23514',
    )
  }
})

test('[integration] plans support inheritance and only scalar entitlement values', async () => {
  const company = await pool.query<{ plan_id: string }>(
    `SELECT plan_id FROM companies WHERE id=$1`,
    [COMPANY_A],
  )
  assert.equal(company.rows[0]?.plan_id, EDUCATION_PLAN.id)

  await pool.query(`UPDATE projects SET plan_id=$1 WHERE id=$2`, [EDUCATION_PLAN.id, PROJECT_A_TEACHER])
  const projects = await pool.query<{ id: string; plan_id: string | null }>(
    `SELECT id,plan_id FROM projects WHERE id IN ($1,$2) ORDER BY id`,
    [PROJECT_A_STUDENT, PROJECT_A_TEACHER],
  )
  assert.deepEqual(projects.rows, [
    { id: PROJECT_A_STUDENT, plan_id: null },
    { id: PROJECT_A_TEACHER, plan_id: EDUCATION_PLAN.id },
  ])

  await pool.query(
    `INSERT INTO entitlements (id,code,description) VALUES
       ('ent-domain-enabled','domain.enabled','Boolean ability'),
       ('ent-domain-limit','domain.limit','Numeric limit')`,
  )
  await pool.query(
    `INSERT INTO plan_entitlements (plan_id,entitlement_id,value) VALUES
       ($1,'ent-domain-enabled','true'::jsonb),
       ($1,'ent-domain-limit','20'::jsonb)`,
    [EDUCATION_PLAN.id],
  )
  const values = await pool.query<{ code: string; kind: string }>(
    `SELECT entitlement.code,jsonb_typeof(link.value) AS kind
       FROM plan_entitlements link
       JOIN entitlements entitlement ON entitlement.id=link.entitlement_id
      WHERE link.plan_id=$1 AND entitlement.code LIKE 'domain.%' ORDER BY entitlement.code`,
    [EDUCATION_PLAN.id],
  )
  assert.deepEqual(values.rows, [
    { code: 'domain.enabled', kind: 'boolean' },
    { code: 'domain.limit', kind: 'number' },
  ])

  await pool.query(
    `INSERT INTO entitlements (id,code,description)
     VALUES ('ent-domain-invalid','domain.invalid','Invalid object')`,
  )
  await assert.rejects(
    pool.query(
      `INSERT INTO plan_entitlements (plan_id,entitlement_id,value)
       VALUES ($1,'ent-domain-invalid',$2::jsonb)`,
      [EDUCATION_PLAN.id, JSON.stringify({ enabled: true })],
    ),
    (error) => pgCode(error) === '23514',
  )
})
