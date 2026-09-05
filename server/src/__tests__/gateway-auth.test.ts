import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import test from 'node:test'
import { env } from '../env.js'
import { type AuthedRequest, authMiddleware, type GatewayAssertion, validRegistrationService, verifyGatewayAssertion } from '../auth.js'
import { redis } from '../redis.js'

test('gateway assertion binds identity, method, path and freshness', () => {
  const now = Date.now()
  const assertion = { appUserId: 'u-1', authUserId: 'auth-1', method: 'POST', path: '/api/messages', timestamp: now, nonce: '11111111-1111-4111-8111-111111111111' }
  const payload = Buffer.from(JSON.stringify(assertion)).toString('base64url')
  const signature = createHmac('sha256', env.GATEWAY_HMAC_SECRET).update(payload).digest('base64url')
  const header = `${payload}.${signature}`
  assert.deepEqual(verifyGatewayAssertion(header, 'POST', '/api/messages', now), assertion)
  assert.equal(verifyGatewayAssertion(header, 'GET', '/api/messages', now), null)
  assert.equal(verifyGatewayAssertion(header, 'POST', '/api/messages', now + 30_001), null)
})

test('gateway middleware consumes a signed nonce only once', async (t) => {
  const seen = new Set<string>()
  t.mock.method(redis, 'set', async (key: string) => {
    if (seen.has(key)) return null
    seen.add(key)
    return 'OK'
  })
  const assertion = { appUserId: 'u-1', authUserId: 'auth-1', method: 'POST', path: '/api/messages', timestamp: Date.now(), nonce: '11111111-1111-4111-8111-111111111111' }
  const payload = Buffer.from(JSON.stringify(assertion)).toString('base64url')
  const header = `${payload}.${createHmac('sha256', env.GATEWAY_HMAC_SECRET).update(payload).digest('base64url')}`
  const request = (): { headers: Record<string, string>; method: string; originalUrl: string } & AuthedRequest => ({ headers: { 'x-lingxiloop-gateway': header }, method: 'POST', originalUrl: '/api/messages' })
  const first = request(), replay = request()
  await authMiddleware(first, {}, () => {})
  await authMiddleware(replay, {}, () => {})
  assert.equal(first.gatewayAuthenticated, true)
  assert.equal(replay.gatewayAuthenticated, undefined)
})

test('registration service binds capability, verified subject and all business input', () => {
  const body = { authUserId: 'auth-1', email: 'verified@example.com', name: 'Verified', inviteToken: 'invite' }
  const assertion: GatewayAssertion = {
    appUserId: null, authUserId: 'auth-1', method: 'POST', path: '/api/internal/registration/provision',
    timestamp: Date.now(), nonce: '11111111-1111-4111-8111-111111111111',
    service: { audience: 'registration', capability: 'registration-provision', emailVerified: true,
      bodyHash: createHash('sha256').update(JSON.stringify(body)).digest('base64url') },
  }
  assert.equal(validRegistrationService(assertion, body), true)
  for (const changed of [
    { ...assertion, service: undefined }, { ...assertion, authUserId: 'another' },
    { ...assertion, appUserId: 'ordinary-user' }, { ...assertion, method: 'GET' },
    { ...assertion, path: '/api/internal/registration/invitation' },
    { ...assertion, service: { ...assertion.service!, emailVerified: false } },
  ]) assert.equal(validRegistrationService(changed, body), false)
  for (const field of ['authUserId', 'email', 'name', 'inviteToken']) {
    assert.equal(validRegistrationService(assertion, { ...body, [field]: 'changed' }), false)
  }
})
