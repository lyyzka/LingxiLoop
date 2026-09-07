import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { register } from 'tsx/esm/api'
import { createLingxiOS } from 'lingxios'
import { createWorker } from 'lingxios/worker'

const url = process.env.LINGXIOS_NATIVE_TEST_DATABASE_URL
assert.ok(url && /^native_/.test(new URL(url).pathname.slice(1)), 'requires an empty disposable database named native_*')
Object.assign(process.env, { DATABASE_URL: url, OPENAI_API_KEY: 'native-check', WUKONG_USER_TOKEN_SECRET: 'native-check-wukong-token',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small', REDIS_URL: process.env.LINGXIOS_NATIVE_TEST_REDIS_URL ?? 'redis://127.0.0.1:56063', R2_ENDPOINT: 'http://127.0.0.1:1', R2_BUCKET: 'native-check',
  R2_ACCESS_KEY_ID: 'native-check', R2_SECRET_ACCESS_KEY: 'native-check', R2_PUBLIC_BASE: 'https://assets.test.invalid',
  R2_URL_SIGNING_SECRET: 'native-check-signing-secret', LINGXILOOP_INVITE_BASE_URL: 'https://app.test.invalid' })
const db = new Pool({ connectionString: url, max: 8 }), loader = register({ namespace: 'native-canvas-check' })
const root = await mkdtemp(join(tmpdir(), 'lingxios-native-canvas-'))
let control, host, worker, cell = 0, failure = false
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
  const { createCanvasTools } = await loader.import('../server/src/modules/canvas/agent-tools.ts', import.meta.url)
  const { createCanvasRuntime } = await loader.import('../server/src/modules/canvas/runtime.ts', import.meta.url)
  const { createCanvasApplication } = await loader.import('../server/src/modules/canvas/application.ts', import.meta.url)
  const { createCanvasExecution } = await loader.import('../server/src/modules/canvas/execution.ts', import.meta.url)
  const { createRoutineTools, scheduleRoutines } = await loader.import('../server/src/modules/routines/public.ts', import.meta.url)
  const { createMemoryTools, resolveMemoryScopes } = await loader.import('../server/src/modules/memory/public.ts', import.meta.url)
  await db.query(`INSERT INTO participants(id,company_id,kind,name,initial,avatar_bg,status,capabilities)
    VALUES('verifier','t','agent','Verifier','V','#667085','avail','["canvas"]');
    UPDATE participants SET capabilities=capabilities||'["routines"]'::jsonb WHERE kind='agent';
    UPDATE conversations SET members=members||'["verifier"]'::jsonb WHERE id='study';
    UPDATE im_channel_bindings SET profile=jsonb_set(profile,'{members}',profile->'members'||'["verifier"]'::jsonb) WHERE channel_id='study'`)
  const lifecycle = createCanvasRuntime(async () => control)
  control = await createLingxiOS({ database: actionPool, tools: [...createCanvasTools(async () => control),...createRoutineTools(async () => control),...createMemoryTools()],
    verifyRun: lifecycle.verify, memory: { resolveScopes: resolveMemoryScopes }, homesRoot: root, capabilityResolver: { resolve: async () => [{ name: 'canvas' },{ name: 'routines' },{ name: 'memory' }] } })
  host = control.connectWorker({ workerId: 'native-canvas', workKinds: ['turn','canvas_worker'] })
  worker = createWorker({ controlPlane: control, kernel: { homesRoot: root }, processors: { canvas_worker: 'conversation', canvas_summary: 'conversation' },
    model: { modelId: 'native-canvas-check', contextWindowTokens: 200_000,
      async run() { const text='Persisted and checked Canvas results.'; return { output: [{ role: 'assistant', content: text }], text, model: 'native-canvas-check', usage: { available: true, inputTokens: 100, outputTokens: 20 } } },
      async structured() { return { value: { missing: [] }, model: 'native-canvas-check', usage: { available: true, inputTokens: 100, outputTokens: 20 } } },
      async compact() { throw new Error('bounded native check must not compact') },
    } })
  const transaction = async run => { const client=await db.connect(); try { await client.query('BEGIN'); const result=await run(client); await client.query('COMMIT'); return result }
    catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }
  const app = createCanvasApplication({ db, execution: createCanvasExecution(async () => control), transaction,
    withCanvasFence: async (_id,run) => run(db), missingChannelMessageIds: async () => [], publishEvent: async () => {} })
  const identity = work => ({ runId: work.id, tenantId: work.tenantId, agentId: work.agentId, principalId: work.principalId,
    sessionId: work.sessionId, ...(work.threadId ? { threadId: work.threadId } : {}) })
  async function save(work) {
    const key=JSON.stringify(['t',work.agentId,work.sessionId,work.threadId ?? null])
    const existing=await host.loadSession(work,key)
    if (existing?.request?.workId === work.id) return
    await host.saveSession(work,{ key, tenantId:'t',agentId:work.agentId,sessionId:work.sessionId,
      ...(work.threadId ? { threadId:work.threadId } : {}), revision: existing?.revision ?? 0,compactionEpoch:0,history:[],appliedWorkIds:[work.id],
      request:{ version:1,workId:work.id,tenantId:'t',sessionId:work.sessionId,authorId:work.principalId,sourceRef:work.triggerRef,
        originalText:work.meta.delegation?.parentRequest.originalText ?? work.meta.text,
        ...(work.meta.delegation ? { delegatedAssignment: work.meta.text } : {}),
        revisions:[],attachments:[],evidence:{version:1,id:work.id+':evidence',items:[]} } })
  }
  async function call(work,action,args={}) {
    await host.heartbeat(work)
    const cellId=String(++cell)
    return host.executeAction(work,{runId:work.id,cellId,callIndex:0,action,args,idempotencyKey:JSON.stringify([work.id,cellId,0])})
  }
  async function ok(work,action,args) { const value=await call(work,action,args); assert.equal(value.ok,true,JSON.stringify(value)); return value }
  async function checks(work) { return host.verifyCandidate(work,{body:'Persisted and checked Canvas results.',requestVersion:1,artifacts:[]}) }
  async function commit(work) {
    const checked=await checks(work)
    assert.ok(checked.records.every(record=>record.status==='passed'),JSON.stringify(checked))
    // Crash after native receipts: a different Worker must recover and review the result.
    await transaction(async db => {
      await db.query("UPDATE lingxios.agent_work_items SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[work.id])
      await db.query("UPDATE lingxios.agent_os_session_leases SET expires_at=NOW()-INTERVAL '1 second' WHERE work_id=$1",[work.id])
    })
    assert.equal(await worker.runNext(),true)
    const state = await control.readRun(identity(work))
    assert.equal(state.status,'succeeded',JSON.stringify(state))
  }
  await control.enqueue({id:'canvas-parent',tenantId:'t',agentId:'coordinator',principalId:'learner',sessionId:'study',sourceRef:'source',text:'Build and independently verify the Canvas result.'})
  let parent=await host.claimWork(); assert.equal(parent.id,'canvas-parent'); await save(parent)
  const input={title:'Canvas verification',goal:'Build and verify fencing',members:[
    {agentId:'agent',assignment:'Build a frame'},
    {agentId:'verifier',assignment:'Verify the frame',executionRole:'verifier',verifiesAgentId:'agent'}]}
  assert.equal((await call(parent,'canvas.start_workspace',{...input,members:[{agentId:'agent',assignment:42}]})).executionState,'rejected')
  failure=true
  assert.equal((await call(parent,'canvas.start_workspace',input)).executionState,'no_effect')
  assert.equal((await db.query('SELECT 1 FROM canvases')).rows.length,0)
  assert.equal((await db.query("SELECT 1 FROM lingxios.agent_work_items WHERE id<>'canvas-parent'")).rows.length,0)
  const started=await ok(parent,'canvas.start_workspace',input), canvasId=started.value.canvasId
  await host.waitWork(parent,{status:'delegated',verification:'not_run',requestVersion:1,taskRef:started.directive.data.taskRef})
  const builder=await host.claimWork(); assert.equal(builder.agentId,'agent'); await save(builder)
  const frame=(await ok(builder,'canvas.create_frame',{frame:{type:'markdown',title:'Fencing',content:'A stale lease cannot write.'}})).value.result
  failure=true
  assert.equal((await call(builder,'canvas.append_content',{frameId:frame.id,content:' Rolled back.'})).executionState,'no_effect')
  assert.equal((await db.query('SELECT content FROM canvas_frames WHERE id=$1',[frame.id])).rows[0].content,frame.content)
  assert.ok((await checks(builder)).records.some(record=>record.checker.startsWith('product:')&&record.status==='failed'))
  const reportInput={finding:'The frame describes fenced writes.',evidenceRefs:[{kind:'frame',id:frame.id}],confidence:0.9}
  await ok(builder,'canvas.submit_report',reportInput)
  await ok(builder,'canvas.append_content',{frameId:frame.id,content:' Cancellation revokes descendants.'})
  assert.ok((await checks(builder)).records.some(record=>record.checker.startsWith('product:')&&record.status==='failed'),'old source versions must fail')
  const builderReport=(await ok(builder,'canvas.submit_report',reportInput)).value.result
  await commit(builder)
  assert.equal((await control.readRun(identity(parent))).status,'waiting')
  const verifier=await host.claimWork(); assert.equal(verifier.agentId,'verifier'); await save(verifier)
  assert.equal((await call(verifier,'canvas.submit_report',reportInput)).executionState,'no_effect')
  const verifierReport=(await ok(verifier,'canvas.submit_report',{...reportInput,finding:'The builder is supported.',verifiesReportId:builderReport.id,
    disconfirmingChecks:['Checked whether stale epochs could write.'],verdict:'supported'})).value.result
  await commit(verifier)
  const deadline=Date.now()+5000
  while ((await control.readRun(identity(parent))).status==='waiting'&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20))
  parent=await host.claimWork(); assert.equal(parent.id,'canvas-parent'); await save(parent)
  await ok(parent,'canvas.submit_report',{finding:'Builder and independent verifier agree.',confidence:0.9,evidenceRefs:[],consumedReportIds:[builderReport.id,verifierReport.id]})
  await commit(parent)
  await lifecycle.reconcile(db,app.completeCanvasWork,AbortSignal.timeout(10000))
  assert.equal((await app.getCanvasSnapshot('t','learner',canvasId)).status,'completed')
  assert.equal((await db.query("SELECT to_regclass('public.agent_work_items') AS old_queue")).rows[0].old_queue,null)
  await control.enqueue({id:'routine-control',tenantId:'t',agentId:'coordinator',principalId:'learner',sessionId:'study',text:'Schedule a practice reminder.'})
  const routineWork=await host.claimWork(); assert.equal(routineWork.id,'routine-control'); await save(routineWork)
  assert.equal((await call(routineWork,'memory.note',{scope:'learner',learnerId:'learner',body:42})).executionState,'rejected')
  failure=true
  assert.equal((await call(routineWork,'memory.note',{body:'This write rolls back.'})).executionState,'no_effect')
  assert.equal((await db.query('SELECT 1 FROM lingxios.agent_memories')).rows.length,0)
  const remembered=(await ok(routineWork,'memory.note',{scope:'learner',learnerId:'learner',body:'Prefers diagrams.'})).value
  assert.equal(remembered.source_refs[0].authorId,'learner')
  assert.equal(remembered.source_refs[0].requestVersion,1)
  assert.equal((await ok(routineWork,'memory.recall',{scope:'learner',learnerId:'learner',query:'DIAGRAMS'})).value[0].id,remembered.id)
  const pinned=(await ok(routineWork,'memory.pin',{scope:'learner',learnerId:'learner',id:remembered.id,expectedVersion:1,pinned:true})).value
  assert.equal(pinned.version,2)
  assert.equal((await call(routineWork,'memory.verify',{scope:'course',id:remembered.id,expectedVersion:2})).executionState,'no_effect')
  assert.equal((await call(routineWork,'memory.list',{scope:'learner',learnerId:'outsider'})).executionState,'rejected')
  assert.equal((await call(routineWork,'memory.delete',{scope:'learner',learnerId:'learner',id:remembered.id,expectedVersion:1})).executionState,'no_effect')
  await ok(routineWork,'memory.delete',{scope:'learner',learnerId:'learner',id:remembered.id,expectedVersion:2})
  assert.deepEqual((await ok(routineWork,'memory.list',{scope:'learner',learnerId:'learner'})).value,[])
  async function approved(action,args) {
    const cellId=String(++cell), envelope={runId:routineWork.id,cellId,callIndex:0,action,args,idempotencyKey:JSON.stringify([routineWork.id,cellId,0])}
    const pending=await host.executeAction(routineWork,envelope)
    assert.equal(pending.executionState,'awaiting_approval',JSON.stringify(pending))
    await control.decideApproval({...identity(routineWork),approvalId:pending.approval.id,approved:true})
    const result=await host.executeAction(routineWork,envelope); assert.equal(result.ok,true,JSON.stringify(result)); return result.value
  }
  const routine=await approved('routines.create',{kind:'practice',title:'Practice',instructions:'Review fencing.',schedule:{everyMinutes:5},timezone:'Asia/Shanghai'})
  assert.equal(routine.status,'paused')
  await approved('routines.activate',{routineId:routine.id})
  await db.query("UPDATE agent_routines SET next_run_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[routine.id])
  assert.equal((await Promise.all([scheduleRoutines(transaction,async()=>control),scheduleRoutines(transaction,async()=>control)])).reduce((a,b)=>a+b),1)
  const scheduled=(await db.query('SELECT * FROM agent_routine_runs WHERE routine_id=$1',[routine.id])).rows[0]
  const scheduledIdentity={runId:scheduled.work_id,tenantId:'t',agentId:'coordinator',sessionId:'study',principalId:'learner'}
  assert.equal((await control.readRun(scheduledIdentity)).kind,'routine')
  await ok(routineWork,'routines.pause',{routineId:routine.id})
  assert.equal((await control.readRun(scheduledIdentity)).status,'cancelled')
  const memoryHost=control.connectWorker({workerId:'native-memory',workKinds:['memory_synthesis']})
  const memoryWork=await memoryHost.claimWork(); assert.ok(memoryWork)
  const memoryAction=(method,args,index)=>memoryHost.executeAction(memoryWork,{runId:memoryWork.id,cellId:'synthesis',callIndex:index,
    action:`memory_synthesis.${method}`,args,idempotencyKey:JSON.stringify([memoryWork.id,'synthesis',index])})
  const batch=await memoryAction('load',{},0); assert.equal(batch.ok,true,JSON.stringify(batch))
  assert.deepEqual(batch.value.scopes.map(scope=>scope.scopeType),['learner','course','agent_role'])
  const applied=await memoryAction('apply',{changes:[],approved:true,confidence:0.9},1)
  assert.equal(applied.ok,true,JSON.stringify(applied)); assert.equal(applied.value.outcome,'committed')
  await db.query("UPDATE project_memberships SET status='SUSPENDED' WHERE user_id='learner'")
  await control.enqueue({id:'revoked',tenantId:'t',agentId:'agent',principalId:'learner',sessionId:'study',text:'Read Canvas'})
  const revoked=await host.claimWork(); await save(revoked)
  assert.equal((await call(revoked,'canvas.current')).executionState,'rejected')
  console.log('Native Canvas/Routines: real PostgreSQL, rollback, dependency ordering, sibling wait, observed source versions, independent verification, parent report, projection, approval, concurrent scheduling, pause cancellation and authorization passed.')
} finally {
  await worker?.stop()
  await control?.stop()
  const { closeDatabasePools } = await loader.import('../server/src/db/pool.ts', import.meta.url)
  await closeDatabasePools()
  const { redis, sub } = await loader.import('../server/src/redis.ts', import.meta.url)
  redis.disconnect(); sub.disconnect()
  await db.end(); await new Promise(resolve => im.close(resolve)); loader.unregister()
  await rm(root,{ recursive: true, force: true })
}
