-- Native product effects remain in their owning product schema.
-- The migration runner commits this file and its migration record together.
CREATE TABLE agent_native_event_outbox (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  event JSONB NOT NULL CHECK (jsonb_typeof(event)='object' AND event->>'type' IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claim_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX agent_native_event_pending ON agent_native_event_outbox(available_at) WHERE delivered_at IS NULL AND failed_at IS NULL;

ALTER TABLE agent_handoffs ADD COLUMN principal_id TEXT;
ALTER TABLE agent_handoffs ADD COLUMN parent_work_id TEXT;
ALTER TABLE agent_handoffs ADD COLUMN child_work_id TEXT;
ALTER TABLE agent_handoffs ADD COLUMN request_version INTEGER;
ALTER TABLE agent_handoffs ADD COLUMN thread_id TEXT;
CREATE UNIQUE INDEX agent_handoff_child ON agent_handoffs(child_work_id) WHERE child_work_id IS NOT NULL;

ALTER TABLE lingxios_ingress_outbox ADD COLUMN failed_at TIMESTAMPTZ;

ALTER TABLE email_messages ADD COLUMN native_action_id TEXT;

CREATE TABLE canvas_agent_runs (
  work_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES canvas_agent_assignments(id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  thread_id TEXT,
  request_version INTEGER NOT NULL CHECK (request_version>0),
  execution_role TEXT NOT NULL CHECK (execution_role IN ('specialist','verifier','reporter')),
  PRIMARY KEY(work_id,canvas_id)
);
CREATE INDEX canvas_agent_runs_canvas ON canvas_agent_runs(canvas_id);
ALTER TABLE canvas_assignment_reports ADD COLUMN work_id TEXT;
ALTER TABLE canvas_assignment_reports ADD COLUMN request_version INTEGER;

ALTER TABLE agent_routines ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE agent_routines ADD COLUMN thread_id TEXT;
ALTER TABLE agent_routines ADD COLUMN operator_id TEXT;
ALTER TABLE agent_routines ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_routines ADD COLUMN pause_reason TEXT;
ALTER TABLE agent_routine_runs DROP CONSTRAINT agent_routine_runs_work_id_fkey;
ALTER TABLE agent_routine_runs DROP CONSTRAINT agent_routine_runs_routine_id_scheduled_at_key;
ALTER TABLE agent_routine_runs ALTER COLUMN work_id SET NOT NULL;
ALTER TABLE agent_routine_runs ADD COLUMN routine_version INTEGER NOT NULL;
ALTER TABLE agent_routine_runs ADD COLUMN company_id TEXT NOT NULL;
ALTER TABLE agent_routine_runs ADD COLUMN agent_id TEXT NOT NULL;
ALTER TABLE agent_routine_runs ADD COLUMN channel_id TEXT NOT NULL;
ALTER TABLE agent_routine_runs ADD COLUMN principal_id TEXT NOT NULL;
ALTER TABLE agent_routine_runs ADD COLUMN thread_id TEXT;
ALTER TABLE agent_routine_runs ADD COLUMN settled_at TIMESTAMPTZ;
CREATE UNIQUE INDEX agent_routine_run_schedule ON agent_routine_runs(routine_id,routine_version,scheduled_at);
CREATE UNIQUE INDEX agent_routine_run_work ON agent_routine_runs(work_id);
