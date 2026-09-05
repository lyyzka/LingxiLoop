/**
 * Integration tests for conversation list/search shaping.
 *
 * Direct conversation rows are shared by both participants, so the stored
 * `conversations.title` can only ever be correct for one viewer. The API must
 * return a viewer-specific title based on the other member instead.
 */
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import {
  buildApiTestApp, ensureSchemaOnce, resetAllTables, seedUserMembership, teardownAll,
  installFakeWukong,
} from './_helpers.js'
import { pool } from '../db/pool.js'

const ME_USER_ID = 'u-me'
const OTHER_USER_ID = 'u-ada'
let server: Server
let baseUrl = ''

before(async () => {
  await ensureSchemaOnce()
  installFakeWukong()
  const app = await buildApiTestApp(ME_USER_ID)
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})
beforeEach(async () => {
  await resetAllTables()
})

after(async () => {
  await teardownAll(server)
})

async function seedHumanDirectWithSelfStoredTitle(): Promise<{ companyId: string; projectId: string; conversationId: string }> {
  const companyId = 'c-direct-title'
  const conversationId = 'direct-ada-yetone'
  const projectId = 'general-c-direct-title'
  await pool.query(
    `INSERT INTO companies (id, name, slug, type, plan_id)
     VALUES ($1, 'Direct Title Co', 'direct-title-co', 'EDUCATION', 'plan-personal-free')`,
    [companyId],
  )
  await seedUserMembership(ME_USER_ID, companyId, {
    email: 'yetone@test.local',
    displayName: 'Yetone',
  })
  await seedUserMembership(OTHER_USER_ID, companyId, {
    email: 'ada@test.local',
    displayName: 'Ada',
  })
  await pool.query(
    `INSERT INTO projects (id, company_id, kind, name, color, created_by, is_default)
     VALUES ($1, $2, 'INSTITUTIONAL_COURSE', 'Course', '#667085', $3, TRUE)`,
    [projectId, companyId, ME_USER_ID],
  )
  await pool.query(
    `INSERT INTO project_memberships(company_id,project_id,user_id,role) VALUES
       ($1,$2,$3,'OWNER'),($1,$2,$4,'STUDENT')`,
    [companyId, projectId, ME_USER_ID, OTHER_USER_ID],
  )
  await pool.query(
    `INSERT INTO conversations (id, kind, title, members, tag, company_id, project_id)
     VALUES ($1, 'direct', 'Yetone', $2::jsonb, 'human', $3, $4)`,
    [conversationId, JSON.stringify([OTHER_USER_ID, ME_USER_ID]), companyId, projectId],
  )
  return { companyId, projectId, conversationId }
}

test('[integration] retired GET /conversations has no compatibility data plane', async () => {
  const { companyId, projectId, conversationId } = await seedHumanDirectWithSelfStoredTitle()

  const res = await fetch(`${baseUrl}/api/conversations`, {
    headers: { 'x-company-id': companyId, 'x-project-id': projectId },
  })
  const raw = await res.text()
  assert.equal(res.status, 404, `${conversationId}: ${raw}`)
})

test('[integration] GET /search uses the same perspective-specific direct title', async () => {
  const { companyId, projectId, conversationId } = await seedHumanDirectWithSelfStoredTitle()

  const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent('Ada')}`, {
    headers: { 'x-company-id': companyId, 'x-project-id': projectId },
  })
  const raw = await res.text()
  assert.equal(res.status, 200, raw)
  const body = JSON.parse(raw) as { rooms: Array<{ id: string; title: string }> }
  const direct = body.rooms.find((r) => r.id === conversationId)

  assert.equal(direct?.title, 'Ada')
})
