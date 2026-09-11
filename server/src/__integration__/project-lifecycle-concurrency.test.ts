import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { pool } from '../db/pool.js'
import { withTransaction } from '../db/transaction.js'
import { ProjectLifecycleError } from '../modules/projects/public.js'
import { projectLifecycleApplication } from '../modules/projects/facade.js'
import { ensureSchemaOnce, resetAllTables, teardownAll, seedEducationWorkspace } from './_helpers.js'
const OWNER = 'lifecycle-teacher'
let COMPANY: string, PROJECT: string
before(async () => { await ensureSchemaOnce() })
beforeEach(async () => {
  await resetAllTables()
  await pool.query(`INSERT INTO users(id,email,display_name) VALUES($1,'lifecycle@test.local',$1)`, [OWNER])
  const workspace = await withTransaction(pool, db => seedEducationWorkspace(db,OWNER))
  COMPANY=workspace.companyId; PROJECT=workspace.projectId
})
after(async () => { await teardownAll() })

test('[integration] concurrent course endings apply once and audit once', async () => {
  const endCourse = {
    actorUserId: OWNER,
    companyId: COMPANY,
    projectId: PROJECT,
    command: 'END' as const,
  }
  const results = await Promise.all([
    projectLifecycleApplication.execute(endCourse),
    projectLifecycleApplication.execute(endCourse),
  ])

  assert.deepEqual(
    [...results].sort((left, right) => Number(right.applied) - Number(left.applied)),
    [
      { ok: true, status: 'COURSE_ENDED', applied: true },
      { ok: true, status: 'COURSE_ENDED', applied: false },
    ],
  )

  const persistedState = async () => {
    const project = await pool.query<{ status: string; updated_at: Date }>(
      `SELECT status,updated_at FROM projects WHERE id=$1 AND company_id=$2`,
      [PROJECT, COMPANY],
    )
    const audits = await pool.query<{
      user_id: string | null
      company_id: string | null
      kind: string
      detail: Record<string, unknown> | null
    }>(
      `SELECT user_id,company_id,kind,detail
         FROM audit_events
        WHERE company_id=$1 AND kind='project_lifecycle_transition'
        ORDER BY id`,
      [COMPANY],
    )
    return { project: project.rows, audits: audits.rows }
  }
  const afterEnd = await persistedState()
  assert.deepEqual(afterEnd.project.map(({ status }) => ({ status })), [{ status: 'COURSE_ENDED' }])
  assert.deepEqual(afterEnd.audits, [{
    user_id: OWNER,
    company_id: COMPANY,
    kind: 'project_lifecycle_transition',
    detail: {
      projectId: PROJECT,
      projectKind: 'TEACHING',
      command: 'END',
      from: 'ACTIVE',
      to: 'COURSE_ENDED',
    },
  }])

  await assert.rejects(
    projectLifecycleApplication.execute({
      actorUserId: OWNER,
      companyId: COMPANY,
      projectId: PROJECT,
      command: 'ENTER_RETENTION',
    }),
    (error: unknown) => error instanceof ProjectLifecycleError && error.code === 'invalid_transition',
  )
  assert.deepEqual(await persistedState(), afterEnd)
})
