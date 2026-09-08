import { applyD1Migrations, env, fetchMock, SELF } from 'cloudflare:test'
import { hashPassword } from 'better-auth/crypto'
import { beforeAll, describe, expect, it } from 'vitest'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers/config').D1Migration[]
  }
}

beforeAll(async () => applyD1Migrations(env.DB, env.TEST_MIGRATIONS))

describe('control-plane trust boundaries', () => {
  async function mcp(method: string, params?: Record<string, unknown>, id = 1) {
    return SELF.fetch('https://admin.example.com/api/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-mcp-service-token',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
    })
  }

  it('proxies public health without initializing auth', async () => {
    await env.DB.prepare(`DELETE FROM auth_settings WHERE id=1`).run()
    fetchMock.activate()
    fetchMock.disableNetConnect()
    fetchMock.get('https://origin.example.com').intercept({ path: '/api/health' }).reply(200, { ok: true })
    try {
      const response = await SELF.fetch('https://admin.example.com/api/health')
      expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { ok: true } })
      fetchMock.assertNoPendingInterceptors()
    } finally {
      fetchMock.deactivate()
      await env.DB.prepare(`INSERT INTO auth_settings(id,session_expires_in,otp_expires_in,rate_limit_window,rate_limit_max,updated_at) VALUES(1,604800,300,60,60,0)`).run()
    }
  })

  it('applies auth/control schema and rejects unauthenticated administration', async () => {
    const tables = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all<{ name: string }>()
    expect(tables.results.map((row) => row.name)).toEqual(expect.arrayContaining(['user', 'session', 'app_user_links', 'registration_claims', 'control_audit', 'auth_settings']))
    expect(tables.results.map((row) => row.name)).not.toContain('release_requests')
    const accountColumns = await env.DB.prepare(`PRAGMA table_info(account)`).all<{ name: string; notnull: number }>()
    expect(accountColumns.results).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'issuer', notnull: 1 })]))
    const authSettings = await env.DB.prepare(`SELECT session_expires_in,otp_expires_in,rate_limit_window,rate_limit_max FROM auth_settings WHERE id=1`).first()
    expect(authSettings).toEqual({ session_expires_in: 604800, otp_expires_in: 300, rate_limit_window: 60, rate_limit_max: 60 })
    expect((await SELF.fetch('https://admin.example.com/api/control/eval/jobs', { method: 'POST' })).status).toBe(403)
    const authSettingsResponse = await SELF.fetch('https://lingxiloop-control-plane.yangyangli0426.workers.dev/api/control/auth-settings')
    expect(authSettingsResponse.status).toBe(401)
  })

  it('keeps bootstrap locked behind its secret', async () => {
    const response = await SELF.fetch('https://lingxiloop-control-plane.yangyangli0426.workers.dev/api/internal/bootstrap-admin', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'wrong', email: 'admin@example.com' }),
    })
    expect(response.status).toBe(401)
  })

  it('signs in after an OTP verifies a password account', async () => {
    const email = 'otp-signup@example.com'
    const now = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,0,?,?)`)
        .bind('otp-signup-user', 'OTP Signup', email, now, now),
      env.DB.prepare(`INSERT INTO account(id,accountId,providerId,issuer,userId,password,createdAt,updatedAt) VALUES(?,?,'credential','local:credential',?,?,?,?)`)
        .bind('otp-signup-account', 'otp-signup-user', 'otp-signup-user', await hashPassword('password123'), now, now),
      env.DB.prepare(`INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)`)
        .bind('otp-signup-verification', `email-verification-otp-${email}`, '123456:0', now + 300, now, now),
    ])
    fetchMock.activate()
    fetchMock.disableNetConnect()
    fetchMock.get('https://challenges.cloudflare.com').intercept({ path: '/turnstile/v0/siteverify', method: 'POST' }).reply(200, { success: true })
    fetchMock.get('https://origin.example.com').intercept({ path: '/api/internal/registration/provision', method: 'POST' }).reply(200, { appUserId: 'otp-app-user' })
    try {
      const verified = await SELF.fetch('https://admin.example.com/api/auth/email-otp/verify-email', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://admin.example.com' }, body: JSON.stringify({ email, otp: '123456' }),
      })
      expect(verified.status).toBe(200)
      const signIn = await SELF.fetch('https://admin.example.com/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://admin.example.com', 'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX' }, body: JSON.stringify({ email, password: 'password123' }),
      })
      expect(signIn.status).toBe(200)
      fetchMock.assertNoPendingInterceptors()
    } finally { fetchMock.deactivate() }
  })

  it('issues a one-time Sigillo SSO code only for the approved provider', async () => {
    const now = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)`)
        .bind('sigillo-user', 'Sigillo User', 'sigillo@example.com', now, now),
      env.DB.prepare(`INSERT INTO account(id,accountId,providerId,issuer,userId,password,createdAt,updatedAt) VALUES(?,?,'credential','local:credential',?,?,?,?)`)
        .bind('sigillo-account', 'sigillo-user', 'sigillo-user', await hashPassword('password123'), now, now),
    ])
    fetchMock.activate()
    fetchMock.disableNetConnect()
    fetchMock.get('https://challenges.cloudflare.com').intercept({ path: '/turnstile/v0/siteverify', method: 'POST' }).reply(200, { success: true })
    try {
      const signIn = await SELF.fetch('https://admin.example.com/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://admin.example.com', 'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX' },
        body: JSON.stringify({ email: 'sigillo@example.com', password: 'password123' }),
      })
      const returnTo = 'https://sigillo-provider.example/sign-in/sso?return_to=https%3A%2F%2Fsigillo-provider.example%2Fsign-in'
      const issued = await SELF.fetch(`https://admin.example.com/api/auth/sso/sigillo?return_to=${encodeURIComponent(returnTo)}`, {
        headers: { cookie: signIn.headers.get('set-cookie') ?? '' }, redirect: 'manual',
      })
      expect(issued.status).toBe(302)
      const code = new URL(issued.headers.get('location')!).searchParams.get('code')
      expect(code).toBeTruthy()
      const exchanged = await SELF.fetch('https://admin.example.com/api/auth/sso/sigillo/exchange', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-sigillo-sso-secret': 'test-sigillo-sso-secret' }, body: JSON.stringify({ code }),
      })
      expect(await exchanged.json()).toEqual({ userId: 'sigillo-user', email: 'sigillo@example.com', name: 'Sigillo User', returnTo })
      const replay = await SELF.fetch('https://admin.example.com/api/auth/sso/sigillo/exchange', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-sigillo-sso-secret': 'test-sigillo-sso-secret' }, body: JSON.stringify({ code }),
      })
      expect(replay.status).toBe(401)
      fetchMock.assertNoPendingInterceptors()
    } finally { fetchMock.deactivate() }
  })

  it('proxies websocket tickets instead of sending them to Better Auth', async () => {
    const now = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)`)
        .bind('ws-user', 'WebSocket User', 'ws@example.com', now, now),
      env.DB.prepare(`INSERT INTO account(id,accountId,providerId,issuer,userId,password,createdAt,updatedAt) VALUES(?,?,'credential','local:credential',?,?,?,?)`)
        .bind('ws-account', 'ws-user', 'ws-user', await hashPassword('password123'), now, now),
    ])
    fetchMock.activate()
    fetchMock.disableNetConnect()
    fetchMock.get('https://challenges.cloudflare.com').intercept({ path: '/turnstile/v0/siteverify', method: 'POST' }).reply(200, { success: true })
    fetchMock.get('https://origin.example.com').intercept({ path: '/api/auth/ws-ticket', method: 'POST' }).reply(200, { ticket: 'ticket-1' })
    let registrationAssertion: Record<string, unknown> | undefined
    fetchMock.get('https://origin.example.com').intercept({ path: '/api/internal/registration/provision', method: 'POST' }).reply((request) => {
      const header = new Headers(request.headers).get('x-lingxiloop-gateway')!
      registrationAssertion = JSON.parse(atob(header.split('.')[0]!.replaceAll('-', '+').replaceAll('_', '/'))) as Record<string, unknown>
      expect(JSON.parse(String(request.body))).toEqual({ authUserId: 'ws-user', email: 'ws@example.com', name: 'WebSocket User' })
      return { statusCode: 200, data: { appUserId: 'app-ws-user' } }
    })
    try {
      const signIn = await SELF.fetch('https://admin.example.com/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://admin.example.com', 'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX' },
        body: JSON.stringify({ email: 'ws@example.com', password: 'password123' }),
      })
      const response = await SELF.fetch('https://admin.example.com/api/auth/ws-ticket', {
        method: 'POST', headers: { cookie: signIn.headers.get('set-cookie') ?? '' },
      })
      expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: { ticket: 'ticket-1' } })
      expect(registrationAssertion).toMatchObject({ appUserId: null, authUserId: 'ws-user', method: 'POST', path: '/api/internal/registration/provision',
        service: { audience: 'registration', capability: 'registration-provision', emailVerified: true, bodyHash: expect.any(String) } })
      for (const path of ['/api/internal/registration/provision', '/api/internal/registration/invitation']) {
        const denied = await SELF.fetch(`https://admin.example.com${path}`, {
          method: 'POST', headers: { cookie: signIn.headers.get('set-cookie') ?? '' },
        })
        expect(denied.status).toBe(403)
      }
      fetchMock.assertNoPendingInterceptors()
    } finally { fetchMock.deactivate() }
  })

  it('rejects cross-site authentication writes and registration without CAPTCHA', async () => {
    const crossSite = await SELF.fetch('https://lingxiloop-control-plane.yangyangli0426.workers.dev/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example', 'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    })
    expect(crossSite.status).toBe(403)

    const noInvite = await SELF.fetch('https://lingxiloop-control-plane.yangyangli0426.workers.dev/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://lingxiloop-control-plane.yangyangli0426.workers.dev' },
      body: JSON.stringify({ email: 'user@example.com', name: 'User', password: 'password123' }),
    })
    expect(noInvite.status).toBe(400)
  })

  it('proxies Kuma status for an authenticated administrator', async () => {
    const now = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,role) VALUES(?,?,?,1,?,?,'admin')`)
        .bind('status-admin', 'Admin', 'status-admin@example.com', now, now),
      env.DB.prepare(`INSERT INTO account(id,accountId,providerId,issuer,userId,password,createdAt,updatedAt) VALUES(?,?,'credential','local:credential',?,?,?,?)`)
        .bind('status-admin-account', 'status-admin', 'status-admin', await hashPassword('password123'), now, now),
    ])
    fetchMock.activate()
    fetchMock.disableNetConnect()
    fetchMock.get('https://challenges.cloudflare.com')
      .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
      .reply(200, { success: true })
    const upstream = fetchMock.get('https://uptime.example.com')
    upstream.intercept({ path: '/api/status-page/lingxiloop' })
      .reply(200, { config: { title: 'LingxiLoop 服务状态' }, incident: null, publicGroupList: [{ id: 1, name: '公共入口', monitorList: [{ id: 11, name: 'Web' }] }], maintenanceList: [] })
    upstream.intercept({ path: '/api/status-page/heartbeat/lingxiloop' })
      .reply(200, { heartbeatList: { 11: [{ status: 0 }, { status: 1, ping: 26 }] }, uptimeList: { '11_24': 1 } })
    try {
      const signIn = await SELF.fetch('https://admin.example.com/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://admin.example.com', 'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX' },
        body: JSON.stringify({ email: 'status-admin@example.com', password: 'password123' }),
      })
      expect(signIn.status).toBe(200)
      const response = await SELF.fetch('https://admin.example.com/api/control/status-page', { headers: { cookie: signIn.headers.get('set-cookie') ?? '' } })
      expect(await response.json()).toEqual({
        config: { title: 'LingxiLoop 服务状态' },
        incident: null,
        groups: [{ id: 1, name: '公共入口', monitorList: [{ id: 11, name: 'Web' }] }],
        maintenanceList: [],
        history: { 11: [{ status: 0 }, { status: 1, ping: 26 }] },
        latest: { 11: { status: 1, ping: 26 } },
        uptime: { '11_24': 1 },
      })
      fetchMock.assertNoPendingInterceptors()
    } finally { fetchMock.deactivate() }
  })

  it('authenticates MCP, exposes operations, and replays commands idempotently', async () => {
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare(`INSERT OR REPLACE INTO user(id,name,email,emailVerified,createdAt,updatedAt,role,banned) VALUES('mcp-admin','MCP Admin','mcp@example.com',1,?,?, 'admin',0)`).bind(now, now),
      env.DB.prepare(`INSERT OR REPLACE INTO app_user_links(auth_user_id,app_user_id,provisioned_at,suspended_at) VALUES('mcp-admin','app-mcp-admin',?,NULL)`).bind(now),
    ])
    expect((await SELF.fetch('https://admin.example.com/api/mcp', { method: 'POST' })).status).toBe(401)
    expect((await SELF.fetch('https://admin.example.com/api/mcp', {
      method: 'POST', headers: { authorization: 'Bearer test-mcp-service-token', origin: 'https://attacker.example' },
    })).status).toBe(403)

    const initialized = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect((await initialized.json() as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('lingxiloop-production-operations')
    const listed = await mcp('tools/list')
    const toolNames = ((await listed.json() as { result: { tools: Array<{ name: string }> } }).result.tools).map((tool) => tool.name)
    expect(toolNames).toEqual(expect.arrayContaining(['lingxiloop_admin_resource_list', 'lingxiloop_agent_run_cancel', 'lingxiloop_arcane_logs']))
    const targets = await mcp('tools/call', { name: 'lingxiloop_arcane_targets', arguments: {} }, 2)
    const targetsBody = await targets.json() as { result: { content: Array<{ text: string }> } }
    expect(Object.keys(JSON.parse(targetsBody.result.content[0]!.text))).toEqual([
      'lingxiloop-core-state', 'lingxiloop-app-a', 'server-b-ingress', 'lingxiloop-app-b', 'lingxiloop-knowledge-agent', 'uptime',
    ])

    fetchMock.activate()
    fetchMock.disableNetConnect()
    fetchMock.get('https://origin.example.com').intercept({ path: '/api/admin/resources/users/user-1', method: 'GET' })
      .reply(200, { name: 'visible', token: 'upstream-token', nested: { prompt: 'private prompt', environment: ['PASSWORD=private'] } })
    fetchMock.get('https://origin.example.com').intercept({ path: '/api/admin/agent-runs/run-1/cancel', method: 'POST' }).reply(200, { cancelled: true })
    fetchMock.get('https://ops.example.com').intercept({ path: '/api/environments/b/projects/app-b/runtime', method: 'GET' })
      .reply(200, { data: { runtimeServices: [{ containerId: 'container-1', containerName: 'lingxiloop-app-b-server-1' }] } })
    fetchMock.get('https://ops.example.com').intercept({ path: '/api/events/environment/b?search=lingxiloop-app-b&sort=createdAt&order=desc&limit=100', method: 'GET' })
      .reply(200, { data: [{ resourceId: 'container-1', title: 'allowed' }, { resourceId: 'other-project', title: 'blocked' }] })
    try {
      const record = await mcp('tools/call', { name: 'lingxiloop_admin_resource_get', arguments: { resource: 'users', id: 'user-1' } }, 3)
      const recordBody = await record.json() as { result: { content: Array<{ text: string }> } }
      expect(JSON.parse(recordBody.result.content[0]!.text)).toEqual({ name: 'visible', token: '[REDACTED]', nested: { prompt: '[REDACTED]', environment: '[REDACTED]' } })
      const events = await mcp('tools/call', { name: 'lingxiloop_arcane_events', arguments: { target: 'lingxiloop-app-b', limit: 10 } }, 6)
      const eventsBody = await events.json() as { result: { content: Array<{ text: string }> } }
      expect(JSON.parse(eventsBody.result.content[0]!.text)).toEqual({ data: [{ resourceId: 'container-1', title: 'allowed' }] })
      const args = { requestId: '11111111-1111-4111-8111-111111111111', reason: 'test recovery', runId: 'run-1' }
      const first = await mcp('tools/call', { name: 'lingxiloop_agent_run_cancel', arguments: args }, 4)
      const firstBody = await first.json() as { result: { content: Array<{ text: string }> } }
      expect(JSON.parse(firstBody.result.content[0]!.text)).toEqual({ cancelled: true })
      const replay = await mcp('tools/call', { name: 'lingxiloop_agent_run_cancel', arguments: args }, 5)
      const replayBody = await replay.json() as { result: { content: Array<{ text: string }> } }
      expect(JSON.parse(replayBody.result.content[0]!.text)).toEqual({ replayed: true, status: 'succeeded' })
      fetchMock.assertNoPendingInterceptors()
    } finally { fetchMock.deactivate() }
  })
})
