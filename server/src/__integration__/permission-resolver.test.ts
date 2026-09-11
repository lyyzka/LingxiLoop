import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { pool } from '../db/pool.js'
import { withTransaction } from '../db/transaction.js'
import { permissionService } from '../modules/access/public.js'
import { seedEducationWorkspace, seedMembershipPeriod } from './_helpers.js'
import { ensureSchemaOnce, resetAllTables, teardownAll } from './_helpers.js'

interface EducationContext {
  userId: string
  companyId: string
  projectId: string
}

async function education(userId: string): Promise<EducationContext> {
  await pool.query(
    `INSERT INTO users (id,email,display_name,email_verified_at) VALUES ($1,$2,$3,NOW())`,
    [userId, `${userId}@test.local`, userId],
  )
  const workspace = await withTransaction(pool, (db) => seedEducationWorkspace(db, userId))
  return { userId, companyId: workspace.companyId, projectId: workspace.projectId }
}

before(async () => { await ensureSchemaOnce() })
beforeEach(async () => { await resetAllTables() })
after(async () => { await teardownAll() })

test('[integration] resolver derives tenant scope and hides every A/B IDOR combination', async () => {
  const a = await education('permission-a')
  const b = await education('permission-b')

  const ownA = await permissionService.can({ actorUserId: a.userId, action: 'project:read', projectId: a.projectId })
  const ownB = await permissionService.can({ actorUserId: b.userId, action: 'project:read', projectId: b.projectId })
  assert.equal(ownA.allowed, true)
  assert.equal(ownB.allowed, true)
  assert.equal(ownA.context?.company.id, a.companyId)
  assert.equal(ownA.context?.effectivePlan.code, 'EDUCATION')

  const crossA = await permissionService.can({ actorUserId: a.userId, action: 'project:read', projectId: b.projectId })
  const crossB = await permissionService.can({ actorUserId: b.userId, action: 'project:read', projectId: a.projectId })
  assert.deepEqual([crossA.allowed, crossA.reason, crossA.context], [false, 'COMPANY_MEMBERSHIP_REQUIRED', null])
  assert.deepEqual([crossB.allowed, crossB.reason, crossB.context], [false, 'COMPANY_MEMBERSHIP_REQUIRED', null])

  const forged = await permissionService.can({
    actorUserId: a.userId,
    action: 'project:read',
    companyId: a.companyId,
    projectId: b.projectId,
  })
  assert.deepEqual([forged.allowed, forged.reason, forged.context], [false, 'RESOURCE_SCOPE_MISMATCH', null])

  await pool.query(
    `INSERT INTO documents (id,company_id,project_id,title,created_by) VALUES ('permission-document',$1,$2,'Doc',$3)`,
    [a.companyId, a.projectId, a.userId],
  )
  const nestedMismatch = await permissionService.can({
    actorUserId: a.userId,
    action: 'document:read',
    projectId: b.projectId,
    resource: { type: 'document', id: 'permission-document' },
  })
  assert.deepEqual([nestedMismatch.allowed, nestedMismatch.reason], [false, 'RESOURCE_SCOPE_MISMATCH'])
})

test('[integration] company administrator access does not require a course grant', async () => {
  const owner = await education('permission-admin')
  await pool.query(`DELETE FROM project_memberships WHERE project_id=$1 AND user_id=$2`, [owner.projectId,owner.userId])
  assert.equal((await permissionService.can({ actorUserId: owner.userId,action: 'project:read',projectId: owner.projectId })).allowed,true)
  await pool.query(`UPDATE company_memberships SET is_admin=FALSE WHERE company_id=$1 AND user_id=$2`, [owner.companyId,owner.userId])
  assert.equal((await permissionService.can({ actorUserId: owner.userId,action: 'project:read',projectId: owner.projectId })).reason,'PROJECT_MEMBERSHIP_REQUIRED')
})

test('[integration] inactive memberships and deleted Companies fail closed', async () => {
  const context = await education('permission-inactive')
  await pool.query(
    `UPDATE company_memberships SET status='SUSPENDED' WHERE company_id=$1 AND user_id=$2`,
    [context.companyId, context.userId],
  )
  const companyMembershipInactive = await permissionService.can({
    actorUserId: context.userId,
    action: 'project:read',
    projectId: context.projectId,
  })
  assert.equal(companyMembershipInactive.reason, 'COMPANY_MEMBERSHIP_INACTIVE')
  await pool.query(
    `UPDATE company_memberships SET status='ACTIVE',is_admin=FALSE WHERE company_id=$1 AND user_id=$2`,
    [context.companyId, context.userId],
  )
  await pool.query(
    `UPDATE project_memberships SET status='SUSPENDED' WHERE project_id=$1 AND user_id=$2`,
    [context.projectId, context.userId],
  )
  const projectInactive = await permissionService.can({
    actorUserId: context.userId,
    action: 'project:read',
    projectId: context.projectId,
  })
  assert.equal(projectInactive.reason, 'PROJECT_MEMBERSHIP_INACTIVE')

  await pool.query(
    `UPDATE project_memberships SET status='ACTIVE' WHERE project_id=$1 AND user_id=$2`,
    [context.projectId, context.userId],
  )
  await pool.query(`UPDATE companies SET status='DELETED' WHERE id=$1`, [context.companyId])
  const companyDeleted = await permissionService.can({
    actorUserId: context.userId,
    action: 'project:read',
    projectId: context.projectId,
  })
  assert.equal(companyDeleted.reason, 'COMPANY_STATE_DENIED')
})

test('[integration] Project Role and effective Entitlement must both allow the action', async () => {
  const owner = await education('permission-plan-owner')
  await pool.query(
    `INSERT INTO users (id,email,display_name) VALUES ('permission-student','permission-student@test.local','Student')`,
  )
  await pool.query(
    `INSERT INTO company_memberships (company_id,user_id,role) VALUES ($1,'permission-student','STUDENT')`,
    [owner.companyId],
  )
  await seedMembershipPeriod(pool,owner.companyId,'permission-student')
  await pool.query(`INSERT INTO organization_seats(id,company_id,contract_id,user_id,status) VALUES('permission-student-seat',$1,$1,'permission-student','ACTIVE')`, [owner.companyId])
  await pool.query(
    `INSERT INTO project_memberships (company_id,project_id,user_id,role)
     VALUES ($1,$2,'permission-student','STUDENT')`,
    [owner.companyId, owner.projectId],
  )

  const roleDenied = await permissionService.can({
    actorUserId: 'permission-student',
    action: 'project:update',
    projectId: owner.projectId,
  })
  assert.equal(roleDenied.reason, 'ROLE_NOT_ALLOWED')
  const learnerAllowed = await permissionService.can({
    actorUserId: 'permission-student',
    action: 'learning:submit',
    projectId: owner.projectId,
  })
  assert.equal(learnerAllowed.allowed, true)

  await pool.query(`INSERT INTO plans (id,code,name,status) VALUES ('plan-empty','EMPTY','Empty','ACTIVE')`)
  const projectCore = await pool.query<{ id: string }>(`SELECT id FROM entitlements WHERE code='project.core'`)
  await pool.query(
    `INSERT INTO plan_entitlements (plan_id,entitlement_id,value) VALUES ('plan-empty',$1,'"true"'::jsonb)`,
    [projectCore.rows[0]!.id],
  )
  await pool.query(`UPDATE projects SET plan_id='plan-empty' WHERE id=$1`, [owner.projectId])
  const entitlementDenied = await permissionService.can({
    actorUserId: owner.userId,
    action: 'project:update',
    projectId: owner.projectId,
  })
  assert.equal(entitlementDenied.reason, 'ENTITLEMENT_MISSING')

  await pool.query(
    `UPDATE plan_entitlements SET value='true'::jsonb WHERE plan_id='plan-empty' AND entitlement_id=$1`,
    [projectCore.rows[0]!.id],
  )
  const overridden = await permissionService.can({
    actorUserId: owner.userId,
    action: 'project:update',
    projectId: owner.projectId,
  })
  assert.equal(overridden.context?.effectivePlan.code, 'EMPTY')

  await pool.query(`UPDATE plans SET status='ARCHIVED' WHERE id='plan-empty'`)
  const inactivePlan = await permissionService.can({
    actorUserId: owner.userId,
    action: 'project:update',
    projectId: owner.projectId,
  })
  assert.equal(inactivePlan.reason, 'PLAN_INACTIVE')

  await pool.query(`UPDATE projects SET plan_id=NULL WHERE id=$1`, [owner.projectId])
  const inherited = await permissionService.can({
    actorUserId: owner.userId,
    action: 'project:update',
    projectId: owner.projectId,
  })
  assert.equal(inherited.context?.effectivePlan.code, 'EDUCATION')
})

test('[integration] archived Projects remain readable and deny writes', async () => {
  const context = await education('permission-archived')
  await pool.query(`UPDATE projects SET status='ARCHIVED' WHERE id=$1`, [context.projectId])
  const read = await permissionService.can({
    actorUserId: context.userId,
    action: 'project:read',
    projectId: context.projectId,
  })
  const write = await permissionService.can({
    actorUserId: context.userId,
    action: 'project:update',
    projectId: context.projectId,
  })
  assert.equal(read.allowed, true)
  assert.equal(write.reason, 'PROJECT_STATE_DENIED')
})
