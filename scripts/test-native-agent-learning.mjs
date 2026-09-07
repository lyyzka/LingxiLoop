import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { register } from 'tsx/esm/api'
import { createLingxiOS } from 'lingxios'

const url = process.env.LINGXIOS_NATIVE_TEST_DATABASE_URL
assert.ok(url && /^native_/.test(new URL(url).pathname.slice(1)), 'requires an empty disposable database named native_*')
Object.assign(process.env, { DATABASE_URL: url, OPENAI_API_KEY: 'native-check', WUKONG_USER_TOKEN_SECRET: 'native-check-wukong-token',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small', REDIS_URL: process.env.LINGXIOS_NATIVE_TEST_REDIS_URL ?? 'redis://127.0.0.1:56063', R2_ENDPOINT: 'http://127.0.0.1:1', R2_BUCKET: 'native-check',
  R2_ACCESS_KEY_ID: 'native-check', R2_SECRET_ACCESS_KEY: 'native-check', R2_PUBLIC_BASE: 'https://assets.test.invalid',
  R2_URL_SIGNING_SECRET: 'native-check-signing-secret', LINGXILOOP_INVITE_BASE_URL: 'https://app.test.invalid' })
const db = new Pool({ connectionString: url, max: 8 }), loader = register({ namespace: 'native-learning-check' })
const root = await mkdtemp(join(tmpdir(), 'lingxios-native-learning-'))
let control, host, cell = 0, failure = false
const actionPool = { query: (...args) => db.query(...args), async connect() {
  const client = await db.connect()
  return { release: error => client.release(error), async query(sql, params) {
    if (failure && sql.includes('INSERT INTO lingxios.agent_action_ledger')) { failure = false; throw new Error('receipt interruption') }
    return client.query(sql, params)
  } }
} }
const messages = [{ message_id: 'native-message-1', message_seq: 1, client_msg_no: 'source', from_uid: 'learner', channel_id: 'study', channel_type: 2,
  payload: Buffer.from(JSON.stringify({ version: 1, kind: 'text', clientMsgNo: 'source', body: 'Learn to verify leases.' })).toString('base64') }]
const im = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(req.url === '/channel/messagesync' ? { messages: input.start_message_seq ? [] : messages } : {}))
})
await new Promise(resolve => im.listen(0, '127.0.0.1', resolve))
try {
  assert.equal((await db.query("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows.length, 0)
  const { migrateDatabase, assertMigrationsCurrent } = await loader.import('../server/src/db/migrate.ts', import.meta.url)
  await migrateDatabase(db)
  await assertMigrationsCurrent(db)
  const { learningTools } = await loader.import('../server/src/modules/learning/agent-tools.ts', import.meta.url)
  const { teacherTools } = await loader.import('../server/src/modules/learning/teacher-agent-tools.ts', import.meta.url)
  const { scheduleRoutines } = await loader.import('../server/src/modules/routines/public.ts', import.meta.url)
  const { withTransaction } = await loader.import('../server/src/db/transaction.ts', import.meta.url)
  const { ensureTeacherAgentForCourse } = await loader.import('../server/src/modules/learning/teacher-agent-application.ts', import.meta.url)
  const { ensurePersonalFreePlan } = await loader.import('../server/src/modules/entitlements/public.ts', import.meta.url)
  const { WukongClient, _setWukongClientForTests } = await loader.import('../server/src/im/wukong.ts', import.meta.url)
  _setWukongClientForTests(new WukongClient({ apiUrl: `http://127.0.0.1:${im.address().port}`, wsUrl: 'ws://unused', apiToken: 'test', webhookSecret: 'test' }))
  await ensurePersonalFreePlan(db)
  await db.query(`INSERT INTO users(id,email,display_name) VALUES('teacher','teacher@test.invalid','Teacher'),('learner','learner@test.invalid','Learner');
    INSERT INTO companies(id,name,slug,type,plan_id) VALUES('t','Native tools','native-tools','EDUCATION','plan-personal-free');
    INSERT INTO company_memberships(company_id,user_id,role) VALUES('t','teacher','OWNER'),('t','learner','MEMBER');
    INSERT INTO education_contracts(id,company_id,plan_id,status,starts_at,ends_at,seat_limit)
      VALUES('contract','t','plan-personal-free','ACTIVE',NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 year',10);
    INSERT INTO organization_seats(id,company_id,contract_id,user_id,status)
      VALUES('seat-teacher','t','contract','teacher','ACTIVE'),('seat-learner','t','contract','learner','ACTIVE');
    INSERT INTO participants(id,company_id,kind,name,initial,avatar_bg,status,capabilities)
      VALUES('teacher','t','human','Teacher','T','#667085','avail','[]'),('learner','t','human','Learner','L','#667085','avail','[]'),
      ('agent','t','agent','Agent','A','#667085','avail','["learning","canvas"]'),('coordinator','t','agent','Coordinator','C','#667085','avail','["learning","canvas"]');
    UPDATE participants SET preset_key='nova' WHERE id='coordinator';
    INSERT INTO projects(id,company_id,kind,name,created_by) VALUES('p','t','INSTITUTIONAL_COURSE','Leases','teacher');
    INSERT INTO courses(id,company_id,project_id,created_by) VALUES('course','t','p','teacher');
    INSERT INTO project_memberships(company_id,project_id,user_id,role) VALUES('t','p','teacher','TEACHER'),('t','p','learner','STUDENT');
    INSERT INTO conversations(id,kind,title,members,company_id,project_id) VALUES('study','group','Study','["teacher","learner","agent","coordinator"]','t','p');
    UPDATE courses SET study_room_conversation_id='study' WHERE id='course';
    INSERT INTO im_channel_bindings(channel_id,company_id,profile) VALUES('study','t','{"channelId":"study","channelType":2,"members":["teacher","learner","agent","coordinator"]}');
    INSERT INTO documents(id,company_id,project_id,title,created_by) VALUES('evidence-document','t','p','Learner evidence','learner');`)
  const client = await db.connect()
  let teacher
  try { await client.query('BEGIN'); teacher = await ensureTeacherAgentForCourse('t','course',client, run => run(client)); await client.query('COMMIT') }
  catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  control = await createLingxiOS({ database: actionPool, tools: [...learningTools,...teacherTools], homesRoot: root,
    capabilityResolver: { resolve: async work => [{ name: work.agentId === teacher.agentId ? 'teacher' : 'learning' }] } })
  host = control.connectWorker({ workerId: 'native-learning', workKinds: ['turn'] })
  async function run(id, agentId, principalId, sessionId) {
    await control.enqueue({ id, tenantId: 't', agentId, principalId, sessionId, sourceRef: 'source', text: 'Verify native learning and teaching operations.' })
    const work = await host.claimWork(); assert.equal(work?.id, id)
    await host.saveSession(work, { key: JSON.stringify(['t',agentId,sessionId,null]), tenantId: 't', agentId, sessionId,
      revision: 0, compactionEpoch: 0, history: [], appliedWorkIds: [id], request: { version: 1, workId: id, tenantId: 't', sessionId,
        authorId: principalId, sourceRef: 'source', originalText: 'Verify native learning and teaching operations.', revisions: [], attachments: [], evidence: { version: 1, id: `${id}:evidence`, items: [] } } })
    return work
  }
  async function call(work, action, args = {}, approve = false) {
    await host.heartbeat(work)
    const cellId = String(++cell), envelope = { runId: work.id, cellId, callIndex: 0, action, args, idempotencyKey: JSON.stringify([work.id,cellId,0]) }
    let result = await host.executeAction(work, envelope)
    if (approve) {
      assert.equal(result.executionState, 'awaiting_approval', JSON.stringify(result))
      await control.decideApproval({ approvalId: result.approval.id, approved: true, tenantId: 't', agentId: work.agentId, sessionId: work.sessionId, principalId: work.principalId })
      result = await host.executeAction(work, envelope)
    }
    return result
  }
  async function ok(work, action, args, approve = false) { const result = await call(work, action, args, approve); assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`); return result.value }
  const teacherWork = await run('teacher-run',teacher.agentId,'teacher',teacher.roomId)
  assert.equal((await call(teacherWork,'teacher.draft_objectives',{ objectives: [{ title: 42 }] })).executionState, 'rejected')
  failure = true
  assert.equal((await call(teacherWork,'teacher.draft_objectives',{ objectives: [{ title: 'Leases', successCriteria: 'Explain fencing' }] })).executionState, 'no_effect')
  assert.equal((await db.query('SELECT 1 FROM learning_knowledge_units')).rows.length, 0)
  const objectives = await ok(teacherWork,'teacher.draft_objectives',{ objectives: [{ title: 'Leases', successCriteria: 'Explain fencing' }] })
  const objectiveId = objectives.result[0].id
  assert.equal((await db.query('SELECT created_by FROM learning_knowledge_units')).rows[0].created_by,teacher.agentId)
  await ok(teacherWork,'teacher.publish_objective',{ objectiveId },true)
  const activity = await ok(teacherWork,'teacher.draft_activity',{ title: 'Lease exercise', instructions: 'Show a fenced write', type: 'PRACTICE', objectiveIds: [objectiveId] })
  await ok(teacherWork,'teacher.publish_activity',{ activityId: activity.result.id },true)
  await ok(teacherWork,'teacher.configure_digest',{ frequency: 'daily', localTime: '09:00', timezone: 'Asia/Shanghai' })
  await db.query("UPDATE agent_routines SET next_run_at=NOW()-INTERVAL '1 minute'")
  assert.equal(await scheduleRoutines(run => withTransaction(db,run),async()=>control),1)
  const digest=(await db.query('SELECT work_id,principal_id FROM agent_routine_runs')).rows[0]
  assert.equal(digest.principal_id,'teacher')
  assert.equal((await control.readRun({runId:digest.work_id,tenantId:'t',agentId:teacher.agentId,principalId:'teacher',sessionId:teacher.roomId})).kind,'teacher_digest')
  for (const method of ['current','overview','list_learners','list_objectives','list_activities','list_reviews','list_rooms','get_digest_schedule']) await ok(teacherWork,`teacher.${method}`,{})
  const learnerWork = await run('learner-run','agent','learner','study')
  const recorded = await ok(learnerWork,'learning.record_attempt',{ activityId: activity.result.id, documentIds: ['evidence-document'] })
  const evaluated = await ok(learnerWork,'learning.propose_evaluation',{ attemptId: recorded.result.id, demonstratedLevel: 2, confidence: 0.9, rubricResults: [{ label: 'Fencing', score: 2, weight: 1 }] })
  assert.equal(evaluated.result.status,'PENDING')
  for (const method of ['current','get_learner_state','list_knowledge_units','list_due','list_attempts']) await ok(learnerWork,`learning.${method}`,{})
  await ok(learnerWork,'learning.get_attempt',{ attemptId: recorded.result.id })
  const check = await host.verifyCandidate(learnerWork, { body: 'Attempt recorded and proposed for review.', requestVersion: 1, artifacts: [] })
  assert.ok(check.records.every(record => record.status === 'passed'), JSON.stringify(check))
  await ok(teacherWork,'teacher.review_evaluation',{ evaluationId: evaluated.result.evaluationId, decision: 'accept', reason: 'The persisted evidence supports level 2.' },true)
  await ok(teacherWork,'teacher.get_attempt',{ attemptId: recorded.result.id })
  const created = await call(learnerWork,'learning.start_mission',{ goal: 'Understand leases', successCriteria: 'Explain fencing', sourceClientMsgNo: 'source' })
  assert.equal(created.ok,true,JSON.stringify(created)); assert.equal(created.directive?.reason,'child')
  const child = await control.readRun({ runId: created.directive.data.taskRef, tenantId: 't', agentId: 'coordinator', sessionId: 'study', principalId: 'learner' })
  assert.equal(child?.kind,'mission_coordinator')
  assert.equal((await db.query("SELECT to_regclass('public.agent_work_items') AS old_queue")).rows[0].old_queue,null,'native tools never write the retired work table')
  await db.query("UPDATE project_memberships SET status='SUSPENDED' WHERE user_id='teacher'")
  assert.equal((await call(teacherWork,'teacher.update_course',{ title: 'Forbidden' })).executionState,'rejected')
  assert.equal((await db.query("SELECT name FROM projects WHERE id='p'")).rows[0].name,'Leases')
  console.log('Native Learning/Teacher: full PostgreSQL schema, transaction rollback, attribution, approval, evidence readback, original principal and coordinator child passed.')
} finally {
  await control?.stop()
  const { closeDatabasePools } = await loader.import('../server/src/db/pool.ts', import.meta.url)
  await closeDatabasePools()
  const { redis, sub } = await loader.import('../server/src/redis.ts', import.meta.url)
  redis.disconnect(); sub.disconnect()
  await db.end(); await new Promise(resolve => im.close(resolve)); loader.unregister()
  await rm(root,{ recursive: true, force: true })
}
