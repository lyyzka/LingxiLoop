import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { register } from 'tsx/esm/api'
import { createLingxiOS } from 'lingxios'
import { createWorker } from 'lingxios/worker'

// Public package installation plus the product's actual schema, permissions and Yjs editor.
const connectionString = process.env.LINGXIOS_NATIVE_TEST_DATABASE_URL
assert.ok(connectionString && /^native_/.test(new URL(connectionString).pathname.slice(1)), 'requires an empty disposable database named native_*')
Object.assign(process.env, { DATABASE_URL: connectionString, OPENAI_API_KEY: 'native-check', WUKONG_USER_TOKEN_SECRET: 'native-check-wukong-token',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small', REDIS_URL: process.env.LINGXIOS_NATIVE_TEST_REDIS_URL ?? 'redis://127.0.0.1:56063', R2_ENDPOINT: 'http://127.0.0.1:1', R2_BUCKET: 'native-check',
  R2_ACCESS_KEY_ID: 'native-check', R2_SECRET_ACCESS_KEY: 'native-check', R2_PUBLIC_BASE: 'https://assets.test.invalid',
  R2_URL_SIGNING_SECRET: 'native-check-signing-secret', LINGXILOOP_INVITE_BASE_URL: 'https://app.test.invalid' })
const database = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 })
const loader = register({ namespace: 'native-document-check' })
const { createDocumentTools } = await loader.import('../server/src/modules/documents/agent-tools.ts', import.meta.url)
const { readDocumentSnapshot } = await loader.import('../server/src/modules/documents/collaboration-application.ts', import.meta.url)
const { calendarTools } = await loader.import('../server/src/modules/calendar/agent-tools.ts', import.meta.url)
const { CalendarApplication } = await loader.import('../server/src/modules/calendar/application.ts', import.meta.url)
const { pollTools } = await loader.import('../server/src/modules/polls/agent-tools.ts', import.meta.url)
const { PollApplication } = await loader.import('../server/src/modules/polls/application.ts', import.meta.url)
const { flushNativeEvents } = await loader.import('../server/src/agents/native-events.ts', import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'lingxios-native-document-'))
const imageStorage = { normalizeKey: () => null, keyFromPublicUrl: () => null, signedUrlExpiresSoon: () => false,
  publicUrl: async () => { throw new Error('this text document has no images') } }
let control, worker, failReceipt = false, mode = 'edit', hop = 0, documentId, firstRevision
const delivered = [], events = []
const query = async (client, sql, params) => {
  if (failReceipt && /INSERT INTO lingxios\.agent_action_ledger/.test(sql)) { failReceipt = false; throw new Error('injected receipt failure') }
  return client.query(sql, params)
}
const pool = { query: (sql, params) => query(database, sql, params), connect: async () => {
  const client = await database.connect()
  return { query: (sql, params) => query(client, sql, params), release: error => client.release(error) }
} }
const usage = { available: true, inputTokens: 100, outputTokens: 50 }
function call(name, args) { return { output: [{ type: 'function_call', callId: `${mode}-${hop}`, name, arguments: JSON.stringify(args) }], text: '', model: 'deterministic-native-check', usage } }
function answer(text) { return { output: [{ role: 'assistant', content: text }], text, model: 'deterministic-native-check', usage } }
const model = {
  modelId: 'deterministic-native-check', contextWindowTokens: 200_000,
  async run() {
    hop++
    if (mode === 'poll') {
      if (hop === 1) return call('polls__create', { question: 'Which lesson?', options: ['Algebra','Geometry'] })
      const row = (await database.query('SELECT poll_client_msg_no,poll FROM im_polls')).rows[0]
      if (hop === 2) return call('polls__vote', { messageId: row.poll_client_msg_no, optionIds: [row.poll.options[0].id] })
      if (hop === 3) return call('ipython', { code: `print(host.polls.show(messageId=${JSON.stringify(row.poll_client_msg_no)}))` })
      return answer('The poll is created and I voted for Algebra.')
    }
    if (mode === 'calendar') {
      const input = { title: 'Lesson', startAt: '2027-01-02T10:00:00Z' }
      if (hop === 1) return call('calendar__create', { ...input, startAt: 'invalid-date' })
      if (hop === 2) return call('calendar__create', input)
      const eventId = (await database.query('SELECT id FROM calendar_events')).rows[0].id
      const app = new CalendarApplication(database, { publish: async () => {} }, { dispatch: async () => { throw new Error('not dispatched by fixture') } })
      if (hop === 3) return call('calendar__update', { eventId, expected: await app.get({ companyId: 't', projectId: 'p', userId: 'human' }, eventId), patch: { title: 'Updated lesson' } })
      if (hop === 4) return call('ipython', { code: `print(host.calendar.get(eventId=${JSON.stringify(eventId)}))` })
      return answer('The approved calendar event is created and renamed Updated lesson.')
    }
    if (mode === 'delete') {
      if (hop === 1) return call('documents__delete', { documentId, expectedRevision: (await readDocumentSnapshot(database, documentId, 't')).revision })
      return answer('The approved document was deleted.')
    }
    if (hop === 1) return call('documents__create', { title: 42, body: 'Invalid.' })
    if (hop === 2) {
      assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM lingxios.agent_action_intents')).rows[0].n, 0)
      return call('documents__create', { title: 'Lesson', body: 'Original paragraph.' })
    }
    const document = (await database.query('SELECT id,created_by FROM documents')).rows[0]
    assert.equal(document.created_by, 'agent')
    documentId = document.id
    const snapshot = await readDocumentSnapshot(database, documentId, 't')
    if (hop === 3) { firstRevision = snapshot.revision; failReceipt = true }
    if (hop === 4) { assert.match(snapshot.body, /Original paragraph/); assert.equal(snapshot.revision, firstRevision) }
    if (hop === 3 || hop === 4) return call('documents__edit', { documentId, expectedRevision: firstRevision,
      operations: [{ kind: 'replace', find: 'Original', replace: 'Updated' }, { kind: 'append', text: 'Second paragraph.' }] })
    if (hop === 5) {
      await database.query("UPDATE project_memberships SET status='SUSPENDED'")
      return call('documents__edit', { documentId, expectedRevision: snapshot.revision, operations: [{ kind: 'append', text: 'Forbidden.' }] })
    }
    if (hop === 6) {
      await database.query("UPDATE project_memberships SET status='ACTIVE'")
      assert.doesNotMatch(snapshot.body, /Forbidden/)
      // The other tool channel reaches exactly the same executor and native read path.
      return call('ipython', { code: `print(host.documents.read(documentId=${JSON.stringify(documentId)}))` })
    }
    assert.ok(hop < 12, 'completion must not loop')
    return answer('Created Lesson and updated its two paragraphs. The current document is attached.')
  },
  async structured(request) {
    assert.match(request.instructions, /Check a candidate delivery/)
    assert.ok(request.input.fileObservations.every(item => item.status === 'passed'), JSON.stringify(request.input.fileObservations))
    return { value: { missing: [] }, model: 'deterministic-content-check', usage }
  },
  async compact() { throw new Error('this bounded fixture must not compact') },
}
try {
  assert.equal((await database.query("SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows.length, 0, 'requires an empty disposable database')
  const { migrateDatabase, assertMigrationsCurrent } = await loader.import('../server/src/db/migrate.ts', import.meta.url)
  await migrateDatabase(database)
  await assertMigrationsCurrent(database)
  await database.query(`
    INSERT INTO users(id,email,display_name) VALUES('human','human@test.invalid','Human');
    INSERT INTO companies(id,name,slug,type,plan_id,personal_owner_user_id) VALUES('t','Native tools','native-tools','PERSONAL','plan-personal-free','human');
    INSERT INTO company_memberships(company_id,user_id,role,status) VALUES('t','human','OWNER','ACTIVE');
    INSERT INTO projects(id,company_id,kind,name,created_by) VALUES('p','t','PERSONAL_LEARNING','Docs','human');
    INSERT INTO project_memberships(company_id,project_id,user_id,role,status) VALUES('t','p','human','OWNER','ACTIVE');
    INSERT INTO participants(id,company_id,kind,name,initial,avatar_bg,status,capabilities)
      VALUES('agent','t','agent','Agent','A','blue','avail','["documents","calendar"]'),('human','t','human','Human','H','blue','avail','[]');
    INSERT INTO conversations(id,kind,title,company_id,project_id,members,leader_id) VALUES('room','group','Room','t','p','["human","agent"]','human');
    INSERT INTO im_channel_bindings(company_id,channel_id,profile) VALUES('t','room','{"channelId":"room","channelType":2,"members":["human","agent"]}');
  `)
  const options = { database: pool, tools: [...createDocumentTools(imageStorage), ...calendarTools, ...pollTools], homesRoot: directory,
    modelBudget: { maxModelCalls: 24 }, delivery: { onEvent: async (_work, event, context) => { context.signal.throwIfAborted(); events.push(event) },
      deliverMessage: async (_work, message, context) => { context.signal.throwIfAborted(); delivered.push(message) } } }
  control = await createLingxiOS(options)
  assert.equal('runNext' in control, false)
  worker = createWorker({ controlPlane: control, model, kernel: { homesRoot: directory }, worker: { id: 'native-document-one' } })
  const identity = { runId: 'document-edit', tenantId: 't', agentId: 'agent', sessionId: 'room', principalId: 'human' }
  await control.enqueue({ ...identity, id: identity.runId, text: 'Create Lesson, change Original to Updated, append Second paragraph, and attach its current contents.' })
  assert.equal(await worker.runNext(), true)
  const message = await control.readMessage(identity)
  assert.ok(message, JSON.stringify((await database.query('SELECT status,error,goal_outcome FROM lingxios.agent_work_items')).rows))
  assert.equal(message.envelope.goalOutcome.status, 'satisfied', JSON.stringify(message.envelope))
  const artifact = message.envelope.artifacts[0]
  assert.ok(artifact.source.version)
  const download = await control.readArtifact(identity, artifact.path)
  assert.ok(download)
  assert.match(download.bytes.toString(), /Updated paragraph\./)
  assert.match(download.bytes.toString(), /Second paragraph\./)
  assert.equal(createHash('sha256').update(download.bytes).digest('hex'), artifact.sha256)
  assert.equal(await control.readArtifact({ ...identity, principalId: 'foreign' }, artifact.path), null)
  assert.equal(await control.readArtifact({ ...identity, tenantId: 'foreign' }, artifact.path), null)
  assert.equal(await control.readArtifact(identity, '../document.md'), null)
  const deadline = Date.now() + 10_000
  while (await control.readDelivery(identity) !== 'delivered' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(await control.readDelivery(identity), 'delivered')
  assert.equal(delivered.length, 1)
  assert.deepEqual(delivered[0].envelope.artifacts, message.envelope.artifacts)
  const receipts = (await database.query("SELECT intent.intent->'action'->>'action' AS action,result FROM lingxios.agent_action_intents intent JOIN lingxios.agent_action_ledger USING(idempotency_key) WHERE intent.intent->'action'->>'action' LIKE 'documents.%' ORDER BY intent.recorded_at")).rows
  assert.equal(receipts.filter(row => row.result.executionState === 'no_effect').length, 1)
  assert.equal(receipts.filter(row => row.action === 'documents.create').length, 1)
  assert.ok(receipts.some(row => row.action === 'documents.read' && row.result.ok))

  mode = 'delete'; hop = 0
  const deletion = { ...identity, runId: 'document-delete' }
  await control.enqueue({ ...deletion, id: deletion.runId, text: 'Delete the Lesson document after my approval.' })
  assert.equal(await worker.runNext(), true)
  const waiting = await control.readOutcome(deletion)
  assert.equal(waiting?.status, 'awaiting_approval')
  const decision = { ...identity, approvalId: waiting.approvalId, approved: true }
  assert.ok((await control.readApproval(decision)).preview.bodySha256)
  await assert.rejects(control.decideApproval({ ...decision, principalId: 'foreign' }), /outside this principal/)
  await worker.stop()
  await control.decideApproval(decision)
  worker = createWorker({ controlPlane: control, model, kernel: { homesRoot: directory }, worker: { id: 'native-document-two' } })
  assert.equal(await worker.runNext(), true)
  assert.equal((await database.query('SELECT id FROM documents')).rows.length, 0)
  assert.equal((await database.query('SELECT id FROM document_updates')).rows.length, 0)
  assert.equal((await control.readOutcome(deletion))?.status, 'satisfied')
  assert.ok((await database.query("SELECT id FROM agent_native_event_outbox WHERE event->>'kind'='document.deleted'")).rows.length)

  mode = 'poll'; hop = 0
  await control.enqueue({ ...identity, id: 'native-poll', text: 'Create a poll with Algebra and Geometry, and vote for Algebra.' })
  assert.equal(await worker.runNext(), true)
  assert.equal((await control.readOutcome({ ...identity, runId: 'native-poll' }))?.status, 'satisfied')
  assert.equal((await database.query('SELECT voter_participant_id FROM im_poll_votes')).rows[0].voter_participant_id, 'agent')
  const publications = []
  const polls = new PollApplication(database, { transaction: work => work(database), publishSnapshot: async row => { publications.push(row); return 1 } })
  assert.equal(await polls.reconcilePendingPublications(), 1)
  assert.equal(await polls.reconcilePendingPublications(), 0)
  assert.equal(publications.length, 1)

  mode = 'calendar'; hop = 0
  const calendarIdentity = { ...identity, runId: 'native-calendar' }
  await control.enqueue({ ...identity, id: calendarIdentity.runId, text: 'Create a Lesson calendar event on January 2, 2027 at 10:00 UTC after approval, then rename it Updated lesson.' })
  assert.equal(await worker.runNext(), true)
  const calendarWaiting = await control.readOutcome(calendarIdentity)
  assert.equal(calendarWaiting.status, 'awaiting_approval')
  await control.decideApproval({ ...identity, approvalId: calendarWaiting.approvalId, approved: true })
  assert.equal(await worker.runNext(), true)
  assert.equal((await control.readOutcome(calendarIdentity))?.status, 'satisfied')
  assert.deepEqual((await database.query('SELECT title,created_by FROM calendar_events')).rows, [{ title: 'Updated lesson', created_by: 'human' }])
  const nativeEvents = []
  await flushNativeEvents(database, async event => { nativeEvents.push(event) }, new AbortController().signal)
  assert.ok(nativeEvents.some(event => event.type === 'calendar.changed' && event.actorId === 'agent'))
  assert.equal((await database.query('SELECT id FROM agent_native_event_outbox WHERE delivered_at IS NULL')).rows.length, 0)
  console.log('Public tarball + real PostgreSQL: document, calendar and poll tools; both channels; atomic receipts; permission revocation; cross-worker approval; downloaded bytes; native event and message delivery receipts passed.')
} finally {
  await worker?.stop()
  await control?.stop()
  await database.end()
  const { pool: productPool } = await loader.import('../server/src/db/pool.ts', import.meta.url)
  await productPool.end()
  const { redis, sub } = await loader.import('../server/src/redis.ts', import.meta.url)
  redis.disconnect(); sub.disconnect()
  await loader.unregister()
  await rm(directory, { recursive: true, force: true })
}
