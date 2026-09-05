import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Queryable } from '../db/queryable.js'

export type EvalJobProfile = 'core' | 'full'
export type EvalJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface EvalJob {
  id: string
  profile: EvalJobProfile
  suiteKey: string
  suiteVersion: string
  commitSha: string
  promptVersion: string
  candidateModel: string
  judgeModel: string
  requestedBy: string
  reason: string
  status: EvalJobStatus
  evalRunId: string | null
  error: string | null
  timeoutAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

interface EvalJobRow {
  id: string
  profile: EvalJobProfile
  suite_key: string
  suite_version: string
  commit_sha: string
  prompt_version: string
  candidate_model: string
  judge_model: string
  requested_by: string
  reason: string
  status: EvalJobStatus
  eval_run_id: string | null
  error: string | null
  timeout_at: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

function mapJob(row: EvalJobRow): EvalJob {
  return {
    id: row.id, profile: row.profile, suiteKey: row.suite_key, suiteVersion: row.suite_version,
    commitSha: row.commit_sha, promptVersion: row.prompt_version, candidateModel: row.candidate_model,
    judgeModel: row.judge_model, requestedBy: row.requested_by, reason: row.reason, status: row.status,
    evalRunId: row.eval_run_id, error: row.error, timeoutAt: row.timeout_at, startedAt: row.started_at,
    finishedAt: row.finished_at, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export async function createEvalJob(db: Queryable, input: {
  id?: string
  profile: EvalJobProfile
  suiteKey: string
  suiteVersion: string
  commitSha: string
  promptVersion: string
  candidateModel: string
  judgeModel: string
  requestedBy: string
  reason: string
}): Promise<{ job: EvalJob; created: boolean }> {
  if (input.candidateModel === input.judgeModel) throw Object.assign(new Error('judge model must differ from candidate model'), { status: 400 })
  const idempotencyKey = [input.commitSha, input.profile, input.suiteKey, input.suiteVersion, input.promptVersion, input.candidateModel, input.judgeModel].join(':')
  const id = input.id ?? `eval-job-${randomUUID()}`
  const minutes = input.profile === 'core' ? 30 : 60
  const { rows } = await db.query<EvalJobRow>(
    `INSERT INTO eval_jobs
       (id,idempotency_key,profile,suite_key,suite_version,commit_sha,prompt_version,candidate_model,judge_model,requested_by,reason,timeout_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()+($12::int*INTERVAL '1 minute'))
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [id, idempotencyKey, input.profile, input.suiteKey, input.suiteVersion, input.commitSha, input.promptVersion,
      input.candidateModel, input.judgeModel, input.requestedBy, input.reason, minutes],
  )
  if (rows[0]) return { job: mapJob(rows[0]), created: true }
  const existing = await db.query<EvalJobRow>('SELECT * FROM eval_jobs WHERE idempotency_key=$1', [idempotencyKey])
  const prior = existing.rows[0]
  if (!prior) throw new Error('eval job idempotency lookup failed')
  if (prior.status === 'failed') {
    const retried = await db.query<EvalJobRow>(`UPDATE eval_jobs SET status='queued',requested_by=$2,reason=$3,error=NULL,
      timeout_at=NOW()+($4::int*INTERVAL '1 minute'),started_at=NULL,finished_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [prior.id, input.requestedBy, input.reason, minutes])
    return { job: mapJob(retried.rows[0]), created: true }
  }
  return { job: mapJob(prior), created: prior.status === 'queued' }
}

export async function getEvalJob(db: Queryable, id: string): Promise<EvalJob | null> {
  await db.query(`UPDATE eval_jobs SET status='failed',error='eval job timed out',finished_at=NOW(),updated_at=NOW()
    WHERE id=$1 AND status IN ('queued','running') AND timeout_at<=NOW()`, [id])
  const { rows } = await db.query<EvalJobRow>('SELECT * FROM eval_jobs WHERE id=$1', [id])
  return rows[0] ? mapJob(rows[0]) : null
}

export async function listEvalJobs(db: Queryable, limit = 50): Promise<EvalJob[]> {
  await db.query(`UPDATE eval_jobs SET status='failed',error='eval job timed out',finished_at=NOW(),updated_at=NOW()
    WHERE status IN ('queued','running') AND timeout_at<=NOW()`)
  const { rows } = await db.query<EvalJobRow>('SELECT * FROM eval_jobs ORDER BY created_at DESC LIMIT $1', [limit])
  return rows.map(mapJob)
}

export function verifyEvalCallbackSignature(args: {
  rawBody: Buffer
  timestamp: string | undefined
  nonce: string | undefined
  signature: string | undefined
  secret: string
  now?: number
}): boolean {
  const timestamp = Number(args.timestamp)
  if (!args.secret || !Number.isInteger(timestamp) || Math.abs((args.now ?? Date.now()) - timestamp) > 5 * 60_000 ||
      !args.nonce || !/^[0-9a-f-]{36}$/i.test(args.nonce) || !args.signature) return false
  const expected = createHmac('sha256', args.secret).update(`${timestamp}.${args.nonce}.`).update(args.rawBody).digest()
  let actual: Buffer
  try { actual = Buffer.from(args.signature, 'base64url') } catch { return false }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
