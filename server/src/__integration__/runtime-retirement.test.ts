import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, before, beforeEach, test } from 'node:test'
import { pool } from '../db/pool.js'
import { withTransaction } from '../db/transaction.js'
import { WukongWebhookApplication } from '../im/webhook-application.js'
import {
  buildApiTestApp, ensureSchemaOnce, installFakeWukong, resetAllTables,
  seedCompanyWithAgent, seedUserMembership, teardownAll,
} from './_helpers.js'

let server: Server
let baseUrl: string
before(async () => {
  await ensureSchemaOnce()
  server = createServer(await buildApiTestApp('test-owner'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  baseUrl = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => { installFakeWukong(); await resetAllTables() })
after(async () => { await teardownAll(server) })

test('committed messages remain idempotent and attachments ingest without old Agent work', async () => {
  const { companyId, projectId, agentId } = await seedCompanyWithAgent()
  await seedUserMembership('test-owner', companyId)
  await pool.query(
    `INSERT INTO conversations(id,company_id,project_id,kind,title,members)
     VALUES('retirement-room',$1,$2,'group','Room',$3::jsonb)`,
    [companyId, projectId, JSON.stringify(['test-owner', agentId])],
  )
  await pool.query(
    `INSERT INTO im_channel_bindings(channel_id,company_id,profile,leader_agent_id)
     VALUES('retirement-room',$1,$2::jsonb,$3)`,
    [companyId, JSON.stringify({ members: ['test-owner', agentId], channelType: 2 }), agentId],
  )
  const ingestions: unknown[] = []
  const application = new WukongWebhookApplication({
    transaction: (work) => withTransaction(pool, work),
    verify: () => true,
    isKnowledgeAttachment: () => true,
    createKnowledgeJob: async (_db, input) => {
      ingestions.push(input)
      return { sourceId: 'attachment-source', deferAgentWake: false }
    },
  })
  const event = {
    raw: Buffer.from('committed attachment'), eventId: 'retirement-event', eventType: 'msg.notify',
    channelId: 'retirement-room', clientMsgNo: 'retirement-message', fromUid: 'test-owner',
    payload: {
      version: 1 as const, kind: 'attachment' as const, clientMsgNo: 'retirement-message',
      data: { key: `attachments/${companyId}/notes.pdf`, mime: 'application/pdf', size: 128, name: 'notes.pdf' },
    },
  }
  assert.deepEqual(await application.process(event), {
    ok: true, recipients: [agentId], deferAgentWake: false,
    agentRuntimeAvailable: false, knowledgeSourceId: 'attachment-source',
  })
  assert.deepEqual(await application.process(event), { ok: true, duplicate: true })
  assert.deepEqual(ingestions, [{
    companyId, projectId, conversationId: 'retirement-room', clientMsgNo: 'retirement-message',
    createdBy: 'test-owner', title: 'notes.pdf', mime: 'application/pdf', size: 128,
    storageKey: `attachments/${companyId}/notes.pdf`, recipients: [],
  }])
  assert.deepEqual((await pool.query(`SELECT COUNT(*)::int AS count FROM agent_work_items`)).rows, [{ count: 0 }])
  await assert.rejects(application.process({ ...event, raw: Buffer.from('different') }), /different payload/)
  await assert.rejects(application.process({ ...event, eventId: 'outsider', fromUid: 'outsider' }), /not a bound channel member/)

  const headers = { 'content-type': 'application/json', 'x-company-id': companyId, 'x-project-id': projectId }
  const canvas = await fetch(`${baseUrl}/api/conversations/retirement-room/canvas`, { method: 'POST', headers })
  assert.equal(canvas.status, 201)
  const { id } = await canvas.json() as { id: string }
  const assignment = await fetch(`${baseUrl}/api/canvases/${id}/assignments`, {
    method: 'POST', headers, body: JSON.stringify({ agentId, assignment: 'Do not queue retired work' }),
  })
  assert.equal(assignment.status, 503)
  assert.deepEqual((await pool.query(`SELECT COUNT(*)::int AS count FROM agent_work_items`)).rows, [{ count: 0 }])
  const meta = await fetch(`${baseUrl}/api/meta`)
  assert.equal((await meta.json() as { reasoningRuntime: unknown }).reasoningRuntime, null)
})
