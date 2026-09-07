import type { ActionContext, RunIdentity, RunSnapshot, createLingxiOS } from 'lingxios'
import type { Queryable } from '../../db/queryable.js'
import type { AssignmentRow, CanvasRow } from './repository-types.js'

type Control = Pick<Awaited<ReturnType<typeof createLingxiOS>>, 'enqueueJob' | 'readRun' | 'readMessage' | 'revise' | 'cancel'>
export interface CanvasRunRow {
  work_id: string; company_id: string; canvas_id: string; assignment_id: string | null
  agent_id: string; principal_id: string; session_id: string; thread_id: string | null; request_version: number
  execution_role: 'specialist' | 'verifier' | 'reporter'
}
export const canvasRunIdentity = (run: CanvasRunRow): RunIdentity => ({ runId: run.work_id, tenantId: run.company_id,
  agentId: run.agent_id, principalId: run.principal_id, sessionId: run.session_id,
  ...(run.thread_id ? { threadId: run.thread_id } : {}) })

export async function bindCanvasRun(db: Queryable, run: CanvasRunRow) {
  await db.query(`INSERT INTO canvas_agent_runs(work_id,company_id,canvas_id,assignment_id,agent_id,principal_id,
    session_id,thread_id,request_version,execution_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(work_id,canvas_id) DO NOTHING`, [run.work_id,run.company_id,run.canvas_id,run.assignment_id,
    run.agent_id,run.principal_id,run.session_id,run.thread_id,run.request_version,run.execution_role])
}

/** Canvas owns its associations; only the public runtime API changes execution state. */
export function createCanvasExecution(control: () => Promise<Control>, action?: ActionContext) {
  async function find(db: Queryable, canvas: CanvasRow, workId: string | null) {
    const { rows } = await db.query<CanvasRunRow>('SELECT * FROM canvas_agent_runs WHERE work_id=$1 AND canvas_id=$2 AND company_id=$3',
      [workId,canvas.id,canvas.company_id])
    if (!rows[0]) throw new Error('Canvas execution binding not found')
    return rows[0]
  }
  return {
    async enqueue(db: Queryable, canvas: CanvasRow, assignment: AssignmentRow, dependsOn: string[]) {
      const principalId = action?.work.principalId ?? canvas.authorization_user_id
      if (!principalId || !canvas.conversation_id || !assignment.work_id) throw new Error('Canvas execution requires a persisted human and conversation')
      const member = await db.query(`SELECT 1 FROM im_channel_bindings channel JOIN participants agent ON agent.company_id=channel.company_id
        WHERE channel.channel_id=$1 AND agent.id=$2 AND agent.company_id=$3 AND agent.kind='agent'
          AND channel.profile->'members' ? agent.id AND agent.departed_at IS NULL AND agent.capabilities @> '["canvas"]'::jsonb
          AND NOT EXISTS(SELECT 1 FROM learning_project_teacher_agents teacher WHERE teacher.company_id=agent.company_id AND teacher.agent_id=agent.id)`,
      [canvas.conversation_id,assignment.agent_id,canvas.company_id])
      if (!member.rows.length) throw new Error('Canvas agent must be an active member of the conversation')
      const meta = { canvasId: canvas.id, assignmentId: assignment.id, executionRole: assignment.execution_role, dependsOn }
      const text = `${canvas.goal}\n\nAssignment: ${assignment.assignment}\nPersist a canvas.submit_report with observed evidence before completing.`
      const threadId = action?.work.threadId ?? canvas.trigger_client_msg_no
      if (action) await action.enqueueChild({ id: assignment.work_id, agentId: assignment.agent_id, text,
        kind: 'canvas_worker', sessionId: canvas.conversation_id, ...(threadId ? { threadId } : {}), dependsOn, meta })
      else await (await control()).enqueueJob({ id: assignment.work_id, tenantId: canvas.company_id, principalId,
        agentId: assignment.agent_id, sessionId: canvas.conversation_id, ...(threadId ? { threadId } : {}),
        sourceRef: assignment.work_id, text, kind: 'canvas_worker', lane: 'collaboration', meta }, db)
      await bindCanvasRun(db, { work_id: assignment.work_id, company_id: canvas.company_id, canvas_id: canvas.id,
        assignment_id: assignment.id, agent_id: assignment.agent_id, principal_id: principalId,
        session_id: canvas.conversation_id, thread_id: threadId ?? null, request_version: 1, execution_role: assignment.execution_role })
    },
    async revise(db: Queryable, canvas: CanvasRow, assignment: AssignmentRow, text: string) {
      const run = await find(db, canvas, assignment.work_id)
      const changed = await (await control()).revise(canvasRunIdentity(run), text, db,
        action ? { id: action.work.agentId, kind: 'agent' } : { id: run.principal_id, kind: 'human' })
      if (changed) await db.query('UPDATE canvas_agent_runs SET request_version=request_version+1 WHERE work_id=$1 AND canvas_id=$2', [run.work_id,canvas.id])
      return changed
    },
    async cancel(db: Queryable, canvas: CanvasRow, workId: string | null) {
      if (action?.work.id === workId) return false
      return (await control()).cancel(canvasRunIdentity(await find(db, canvas, workId)), db)
    },
    async read(db: Queryable, canvas: CanvasRow, workId: string): Promise<RunSnapshot | null> {
      return (await control()).readRun(canvasRunIdentity(await find(db, canvas, workId)), db)
    },
  }
}
export type CanvasExecution = ReturnType<typeof createCanvasExecution>
