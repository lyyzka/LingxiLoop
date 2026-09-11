import { createHmac } from 'node:crypto'
import { pool } from '../../db/pool.js'
import { env } from '../../env.js'
import { wukongClient } from '../../im/wukong.js'
import { redis } from '../../redis.js'
import { listCompanyChannels } from './repository.js'

export const COMPANY_ACCESS_REVOKED = 'lingxiloop:company.access.revoked'

export async function revokeCompanyAccess(companyId: string, userId: string, revokedAt: Date): Promise<void> {
  await redis.publish(COMPANY_ACCESS_REVOKED, JSON.stringify({ companyId, userId }))
  await wukongClient().revokeUser(userId)
  const { lingxiOSControl } = await import('../../agent-runtime/runtime.js')
  const runtime = await lingxiOSControl()
  for (const status of ['queued', 'leased', 'waiting'] as const) {
    const runs = await runtime.listRuns({ tenantId: companyId, principalId: userId, status, limit: 100 })
    for (const run of runs.items) await runtime.cancel(run.identity)
    if (runs.nextCursor) throw new Error('remaining revoked jobs will be cancelled on retry')
  }
  const timestamp = Date.now()
  const body = JSON.stringify({ appUserId: userId, revokedAt: new Date(revokedAt).getTime() })
  const signature = createHmac('sha256', env.GATEWAY_HMAC_SECRET).update(`revoke-sessions:${timestamp}:${body}`).digest('base64url')
  const response = await fetch(new URL('/api/internal/revoke-sessions', env.CONTROL_PLANE_BASE_URL), {
    method: 'POST', body, signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', 'x-lingxi-timestamp': String(timestamp), 'x-lingxi-signature': signature },
  })
  if (!response.ok) throw new Error(`session revocation failed (${response.status})`)
  for (const channel of await listCompanyChannels(pool, companyId)) {
    await wukongClient().upsertChannel({ channelId: channel.channel_id, channelType: 2, title: channel.title, members: channel.members })
  }
}
