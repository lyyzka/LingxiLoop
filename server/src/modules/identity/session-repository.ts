import type { Queryable } from '../../db/queryable.js'

export async function insertAuditEvent(
  db: Queryable,
  input: {
    kind: string
    userId: string | null
    companyId: string | null
    ip: string | null
    userAgent: string | null
    detail: Record<string, unknown> | null
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (user_id, company_id, ip, user_agent, kind, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.userId,
      input.companyId,
      input.ip,
      input.userAgent,
      input.kind,
      input.detail ? JSON.stringify(input.detail) : null,
    ],
  )
}

export async function insertWsTicket(
  db: Queryable,
  input: { tokenHash: string; userId: string; expiresAt: Date },
): Promise<void> {
  await db.query(
    `INSERT INTO ws_tickets (token_hash, user_id, expires_at, company_period_id)
     SELECT $1,$2,$3,m.period_id FROM company_memberships m JOIN users u ON u.id=m.user_id
     WHERE m.user_id=$2 AND m.ended_at IS NULL AND m.status='ACTIVE'
       AND u.departed_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL`,
    [input.tokenHash, input.userId, input.expiresAt],
  )
}

export async function consumeWsTicketByHash(db: Queryable, tokenHash: string): Promise<{ userId: string; periodId: string } | null> {
  const result = await db.query<{ userId: string; periodId: string }>(
    `UPDATE ws_tickets t SET used_at=NOW() FROM company_memberships m JOIN users u ON u.id=m.user_id
      WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>NOW()
        AND m.user_id=t.user_id AND m.period_id=t.company_period_id AND m.ended_at IS NULL
        AND m.status='ACTIVE' AND u.departed_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL
      RETURNING t.user_id AS "userId",t.company_period_id AS "periodId"`,
    [tokenHash],
  )
  return (result.rowCount ?? 0) > 0 ? result.rows[0] ?? null : null
}

export async function isGatewaySessionActive(db: Queryable, userId: string, issuedAt: number | undefined): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL
    AND suspended_at IS NULL AND departed_at IS NULL
    AND (access_revoked_at IS NULL OR access_revoked_at < to_timestamp($2 / 1000.0))`,
  [userId, Number.isFinite(issuedAt) ? issuedAt : 0])
  return Boolean(rows[0])
}
