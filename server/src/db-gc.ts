/** Bounded retention for product logs and expired WebSocket tickets. Runtime retention is owned by LingxiOS. */
import { pool } from './db/pool.js'
import { env } from './env.js'
import type { WorkerTaskHandle } from './runtime/lifecycle.js'
import { inc } from './metrics.js'

interface SweepTarget {
  table: string
  /** Primary-key column used to address the delete batch. */
  pkCol: string
  /** Column the retention window applies to. */
  timeCol: string
  /** Retention in days; 0 disables the sweep for this table. */
  days: number
}

function targets(): SweepTarget[] {
  return [
    // ws_tickets keys off expires_at: a ticket is garbage once expired,
    // the extra day is just diagnostic slack.
    { table: 'ws_tickets',   pkCol: 'token_hash', timeCol: 'expires_at', days: env.DB_GC_WS_TICKETS_DAYS },
    { table: 'agent_log',    pkCol: 'id',         timeCol: 'created_at', days: env.DB_GC_AGENT_LOG_DAYS },
  ]
}

/** Delete one batch of expired rows. Returns rows deleted (0 = table clean).
 *
 *  Two statements, both index-driven: the victim SELECT walks the bare
 *  time-column index (see the database migrations' idx_*_created), the DELETE walks the
 *  PK index via `= ANY($ids)`. The earlier single-statement form —
 *  `DELETE WHERE ctid IN (subquery)` — planned the outer side as a seq
 *  scan of the whole heap, which on a 31GB table blew the 55s timeout
 *  every tick and deleted nothing. */
async function deleteBatch(t: SweepTarget, batchSize: number): Promise<{ picked: number; deleted: number }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // SET LOCAL: bounds both statements, auto-resets at COMMIT/ROLLBACK so
    // the pooled connection isn't left with a lowered timeout.
    await client.query(`SET LOCAL statement_timeout = '55s'`)
    const victims = await client.query<Record<string, string>>(
      `SELECT ${t.pkCol} AS pk FROM ${t.table}
        WHERE ${t.timeCol} < NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY ${t.timeCol} ASC
        LIMIT $2`,
      [t.days, batchSize],
    )
    let deleted = 0
    if (victims.rows.length > 0) {
      const res = await client.query(
        `DELETE FROM ${t.table} WHERE ${t.pkCol} = ANY($1)`,
        [victims.rows.map((r) => r.pk)],
      )
      deleted = res.rowCount ?? 0
    }
    await client.query('COMMIT')
    return { picked: victims.rows.length, deleted }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Run one sweep across all tables. Bounded by maxBatchesPerTable so a
 *  huge backlog burns down across many ticks instead of one marathon. */
export async function runDbGcTick(opts?: { batchSize?: number; maxBatchesPerTable?: number }): Promise<Record<string, number>> {
  const batchSize = opts?.batchSize ?? env.DB_GC_BATCH
  const maxBatches = opts?.maxBatchesPerTable ?? 10
  const deleted: Record<string, number> = {}
  for (const t of targets()) {
    if (t.days <= 0) continue
    let total = 0
    try {
      for (let i = 0; i < maxBatches; i++) {
        const { picked, deleted: n } = await deleteBatch(t, batchSize)
        total += n
        // Break on a short PICK (backlog for this table is drained), not a
        // short DELETE: with two replicas racing on the same oldest rows, a
        // batch can pick 10k live rows and delete few — the peer got there
        // first — while plenty of backlog remains.
        if (picked < batchSize) break
      }
    } catch (e) {
      console.error(`[db-gc] ${t.table} sweep failed:`, e instanceof Error ? e.message : String(e))
      inc('db.gc.failed', { table: t.table })
    }
    if (total > 0) {
      deleted[t.table] = total
      inc('db.gc.deleted', { table: t.table }, total)
    }
  }
  if (Object.keys(deleted).length > 0) {
    console.log(JSON.stringify({ evt: 'db.gc.tick', deleted }))
  }
  return deleted
}

let timer: NodeJS.Timeout | null = null

/** Start the periodic GC loop. Idempotent — re-calling is a no-op. */
export function startDbGcWorker(): WorkerTaskHandle | null {
  if (timer) return { stop: stopDbGcWorker }
  const intervalMs = env.DB_GC_INTERVAL_MS
  if (intervalMs <= 0) {
    console.log('[db-gc] disabled (DB_GC_INTERVAL_MS=0)')
    return null
  }
  const windows = targets().map((t) => `${t.table}=${t.days}d`).join(' ')
  console.log(`[db-gc] starting · interval=${intervalMs}ms · batch=${env.DB_GC_BATCH} · ${windows}`)
  const tick = async () => {
    try { await runDbGcTick() }
    catch (e) { console.error('[db-gc] tick failed:', e instanceof Error ? e.message : String(e)) }
  }
  timer = setInterval(() => { void tick() }, intervalMs)
  return { stop: stopDbGcWorker }
}

export function stopDbGcWorker(): void {
  if (timer) { clearInterval(timer); timer = null }
}
