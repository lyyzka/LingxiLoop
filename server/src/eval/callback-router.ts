import { json, Router, type Request } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { withTransaction } from '../db/transaction.js'
import { env } from '../env.js'
import { safe } from '../http/async-handler.js'
import { HttpError } from '../http/errors.js'
import { validateEvalRunInput } from './contracts.js'
import { createEvalJob, getEvalJob, verifyEvalCallbackSignature } from './jobs.js'
import { persistEvalRun } from './repository.js'
import { prepareEvalRun } from './service.js'

type RawRequest = Request & { rawBody?: Buffer }

const callbackSchema = z.object({
  action: z.enum(['create', 'start', 'complete', 'fail']),
  jobId: z.string().min(1).max(160),
  profile: z.enum(['core', 'full']),
  suiteKey: z.string().min(1).max(120),
  suiteVersion: z.string().min(1).max(120),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  promptVersion: z.string().min(1).max(120),
  candidateModel: z.string().min(1).max(256),
  judgeModel: z.string().min(1).max(256),
  run: z.unknown().optional(),
  error: z.string().max(2000).optional(),
}).strict()

export const evalCallbackRouter = Router()

evalCallbackRouter.use(json({
  limit: '20mb',
  verify: (request: RawRequest, _response: unknown, buffer: Buffer) => { request.rawBody = Buffer.from(buffer) },
}))

evalCallbackRouter.post('/jobs', safe(async (request: RawRequest, response) => {
  if (!verifyEvalCallbackSignature({
    rawBody: request.rawBody ?? Buffer.alloc(0),
    timestamp: request.header('x-eval-timestamp'), nonce: request.header('x-eval-nonce'),
    signature: request.header('x-eval-signature'), secret: env.EVAL_CI_HMAC_SECRET,
  })) throw new HttpError(401, 'invalid eval callback signature')
  const parsed = callbackSchema.safeParse(request.body)
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'invalid eval callback')
  const input = parsed.data
  if (input.candidateModel === input.judgeModel) throw new HttpError(400, 'judge model must differ from candidate model')
  const prepared = input.action === 'complete'
    ? await prepareEvalRun(validateEvalRunInput(input.run), 'ci-live-eval')
    : null
  const result = await withTransaction(pool, async (db) => {
    const nonce = request.header('x-eval-nonce')!
    await db.query('DELETE FROM eval_callback_nonces WHERE expires_at<NOW()')
    const claimed = await db.query(
      `INSERT INTO eval_callback_nonces(nonce,expires_at) VALUES($1,NOW()+INTERVAL '10 minutes') ON CONFLICT DO NOTHING RETURNING nonce`,
      [nonce],
    )
    if (!claimed.rows[0]) throw new HttpError(409, 'eval callback replayed')
    if (input.action === 'create') {
      const job = (await createEvalJob(db, {
        id: input.jobId, profile: input.profile, suiteKey: input.suiteKey, suiteVersion: input.suiteVersion,
        commitSha: input.commitSha, promptVersion: input.promptVersion, candidateModel: input.candidateModel,
        judgeModel: input.judgeModel, requestedBy: 'ci', reason: 'scheduled or dispatched live eval',
      })).job
      const policy = await db.query<{ mode: 'monitor' | 'enforce'; baseline_run_id: string | null; baseline_score: number | null }>(
        `SELECT p.mode,p.baseline_run_id,r.score AS baseline_score FROM eval_gate_policies p
         LEFT JOIN eval_runs r ON r.id=p.baseline_run_id
         WHERE p.suite_key=$1 AND p.candidate_model=$2 AND p.prompt_version=$3`,
        [input.suiteKey, input.candidateModel, input.promptVersion],
      )
      const existingRun = job.evalRunId ? await db.query<{ status: string; score: number }>(
        'SELECT status,score FROM eval_runs WHERE id=$1', [job.evalRunId],
      ) : null
      return {
        job,
        gatePolicy: policy.rows[0] ?? { mode: 'monitor', baseline_run_id: null, baseline_score: null },
        existingRun: existingRun?.rows[0] ?? null,
      }
    }
    const current = await getEvalJob(db, input.jobId)
    if (!current) throw new HttpError(404, 'eval job not found')
    if (current.profile !== input.profile || current.suiteKey !== input.suiteKey || current.suiteVersion !== input.suiteVersion ||
        current.commitSha !== input.commitSha || current.promptVersion !== input.promptVersion ||
        current.candidateModel !== input.candidateModel || current.judgeModel !== input.judgeModel) {
      throw new HttpError(409, 'eval callback does not match job')
    }
    if (input.action === 'start') {
      const updated = await db.query(`UPDATE eval_jobs SET status='running',started_at=COALESCE(started_at,NOW()),updated_at=NOW()
        WHERE id=$1 AND status IN ('queued','running') AND timeout_at>NOW() RETURNING *`, [input.jobId])
      if (!updated.rows[0]) throw new HttpError(409, 'eval job cannot start')
    } else if (input.action === 'fail') {
      await db.query(`UPDATE eval_jobs SET status='failed',error=$2,finished_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND status IN ('queued','running')`, [input.jobId, input.error ?? 'live eval failed'])
    } else {
      if (!prepared) throw new HttpError(400, 'completed eval requires run')
      if (prepared.input.suiteKey !== input.suiteKey || prepared.input.version !== input.suiteVersion ||
          prepared.input.target?.commitSha !== input.commitSha || prepared.input.target?.model !== input.candidateModel ||
          prepared.input.metadata?.judgeModel !== input.judgeModel || prepared.input.metadata?.liveProfile !== input.profile ||
          prepared.input.cases.length !== (input.profile === 'core' ? 15 : 13)) {
        throw new HttpError(409, 'eval run does not match job')
      }
      await persistEvalRun(async (work) => work(db), prepared)
      const updated = await db.query(`UPDATE eval_jobs SET status='completed',eval_run_id=$2,error=NULL,finished_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND status='running' AND timeout_at>NOW() RETURNING id`, [input.jobId, prepared.id])
      if (!updated.rows[0]) throw new HttpError(409, 'eval job cannot complete')
    }
    return await getEvalJob(db, input.jobId)
  })
  response.status(input.action === 'create' ? 201 : 200).json(result)
}))
