-- Protocol v4 requires draining old workers before this migration.
-- The product migration runner wraps this file and its version record in one transaction.
-- Rollback is a database backup restore plus the previous package; no runtime DDL is used.
SET LOCAL lock_timeout='5s';
LOCK TABLE lingxios.agent_work_items IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM lingxios.agent_work_items WHERE status='leased' AND lease_expires_at>NOW()) THEN
    RAISE EXCEPTION 'Drain LingxiOS workers before migrating protocol v4';
  END IF;
END $$;
ALTER TABLE lingxios.agent_work_items DROP CONSTRAINT agent_work_items_status_check;
UPDATE lingxios.agent_work_items SET status=CASE
  WHEN goal_outcome->>'status' IN ('awaiting_input','awaiting_approval','delegated') THEN 'waiting'
  WHEN goal_outcome->>'status'='partial' THEN 'partial'
  WHEN goal_outcome->>'status'='blocked' THEN 'blocked'
  ELSE 'succeeded' END WHERE status='completed';
UPDATE lingxios.agent_work_items SET finished_at=NULL WHERE status='waiting';
ALTER TABLE lingxios.agent_work_items ADD CONSTRAINT agent_work_items_status_check
  CHECK(status IN ('queued','leased','waiting','succeeded','partial','blocked','failed','cancelled'));


ALTER TABLE lingxios.agent_work_items ADD COLUMN started_at           TIMESTAMPTZ;

ALTER TABLE lingxios.agent_work_items ADD COLUMN heartbeat_at         TIMESTAMPTZ;

ALTER TABLE lingxios.agent_work_items ADD COLUMN last_progress_at     TIMESTAMPTZ;

CREATE TABLE lingxios.agent_attempts (
  work_id TEXT NOT NULL REFERENCES lingxios.agent_work_items(id) ON DELETE CASCADE,
  fence BIGINT NOT NULL,
  lease_token_hash TEXT,
  worker_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  reason TEXT,
  PRIMARY KEY(work_id,fence)
);

CREATE TABLE lingxios.agent_steps (
  step_seq BIGINT GENERATED ALWAYS AS IDENTITY,
  work_id TEXT NOT NULL REFERENCES lingxios.agent_work_items(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  request_version INT NOT NULL CHECK(request_version>0),
  kind TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  artifacts JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(work_id,step_id)
);

CREATE TABLE lingxios.agent_verifications (
  work_id TEXT NOT NULL REFERENCES lingxios.agent_work_items(id) ON DELETE CASCADE,
  request_version INT NOT NULL,
  candidate_hash TEXT NOT NULL,
  checker TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('passed','failed','inconclusive')),
  evidence JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(work_id,request_version,candidate_hash,checker)
);

ALTER TABLE lingxios.agent_model_budgets ADD COLUMN max_execution_ms   BIGINT NOT NULL DEFAULT 1800000 CHECK(max_execution_ms>0);

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN work_id TEXT REFERENCES lingxios.agent_work_items(id);

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN fence BIGINT;

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN lease_token_hash TEXT;

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN observation JSONB;

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN delivered_at TIMESTAMPTZ;

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN claim_token TEXT;

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN attempts INT NOT NULL DEFAULT 0;

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN reserved_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0);

ALTER TABLE lingxios.agent_model_budget_calls ADD COLUMN reserved_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (reserved_cost_micros >= 0);

ALTER TABLE lingxios.agent_claim_requests ADD COLUMN work_kinds JSONB NOT NULL DEFAULT 'null'::jsonb;

CREATE TABLE lingxios.agent_results (
  work_id TEXT NOT NULL REFERENCES lingxios.agent_work_items(id),
  candidate_hash TEXT NOT NULL,
  request_version INT NOT NULL,
  fence BIGINT NOT NULL,
  message JSONB NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(work_id,candidate_hash)
);

ALTER TABLE lingxios.agent_claim_requests ALTER COLUMN work_kinds DROP DEFAULT;

CREATE OR REPLACE FUNCTION lingxios.track_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='leased' AND (NEW.status<>'leased' OR NEW.fence<>OLD.fence) THEN
    UPDATE lingxios.agent_attempts SET ended_at=LEAST(NOW(),COALESCE(OLD.lease_expires_at,NOW())),
      reason=CASE WHEN NEW.status='leased' THEN 'lease_expired' ELSE NEW.status END
      WHERE work_id=OLD.id AND fence=OLD.fence AND ended_at IS NULL;
  END IF;
  IF NEW.status='leased' THEN
    INSERT INTO lingxios.agent_attempts(work_id,fence,lease_token_hash,worker_id,started_at,heartbeat_at,lease_expires_at)
      VALUES(NEW.id,NEW.fence,NEW.lease_token_hash,NEW.leased_by,NOW(),COALESCE(NEW.heartbeat_at,NOW()),NEW.lease_expires_at)
      ON CONFLICT(work_id,fence) DO UPDATE SET heartbeat_at=EXCLUDED.heartbeat_at,lease_expires_at=EXCLUDED.lease_expires_at;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION lingxios.sync_agent_request_snapshot() RETURNS trigger AS $$
BEGIN
  IF NEW.request_snapshot IS NOT NULL AND NEW.request_snapshot->>'workId' IS NOT NULL THEN
    INSERT INTO lingxios.agent_request_snapshots(work_id,session_key,request_snapshot)
    VALUES(NEW.request_snapshot->>'workId',NEW.session_key,NEW.request_snapshot)
    ON CONFLICT(work_id) DO UPDATE SET request_snapshot=EXCLUDED.request_snapshot,updated_at=NOW()
      WHERE lingxios.agent_request_snapshots.session_key=EXCLUDED.session_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lingxios.archive_memory_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'memory versions must increase';
  END IF;
  INSERT INTO lingxios.agent_memory_versions(tenant_id,memory_id,version,snapshot)
    VALUES(OLD.tenant_id,OLD.id,OLD.version,to_jsonb(OLD));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lingxios.supersede_memory_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  WITH superseded AS (
    UPDATE lingxios.agent_memory_evidence SET status='superseded'
    WHERE source_run_id=NEW.id AND status IN ('pending','processed')
      AND (NEW.cancel_requested_at IS NOT NULL OR NEW.status='cancelled'
        OR request_version<>jsonb_array_length(NEW.steer_inputs)+1)
    RETURNING source_run_id,tenant_id)
  UPDATE lingxios.agent_memories memory SET status='expired',version=version+1,updated_at=NOW()
    FROM superseded source WHERE memory.tenant_id=source.tenant_id AND memory.origin='synthesized'
      AND NOT memory.pinned AND memory.status='active'
      AND memory.source_refs @> jsonb_build_array(jsonb_build_object('workId',source.source_run_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_work_attempt ON lingxios.agent_work_items;
CREATE TRIGGER agent_work_attempt AFTER INSERT OR UPDATE ON lingxios.agent_work_items
  FOR EACH ROW EXECUTE FUNCTION lingxios.track_attempt();

DROP TRIGGER IF EXISTS agent_session_request_snapshot ON lingxios.agent_os_sessions;
CREATE TRIGGER agent_session_request_snapshot AFTER INSERT OR UPDATE OF request_snapshot ON lingxios.agent_os_sessions
FOR EACH ROW EXECUTE FUNCTION lingxios.sync_agent_request_snapshot();

DROP TRIGGER IF EXISTS agent_memory_version_history ON lingxios.agent_memories;
CREATE TRIGGER agent_memory_version_history
  BEFORE UPDATE OF version ON lingxios.agent_memories
  FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version)
  EXECUTE FUNCTION lingxios.archive_memory_version();

DROP TRIGGER IF EXISTS agent_work_memory_evidence ON lingxios.agent_work_items;
CREATE TRIGGER agent_work_memory_evidence
  AFTER UPDATE OF cancel_requested_at,status,steer_inputs ON lingxios.agent_work_items
  FOR EACH ROW
  WHEN (OLD.cancel_requested_at IS DISTINCT FROM NEW.cancel_requested_at
    OR OLD.status IS DISTINCT FROM NEW.status OR OLD.steer_inputs IS DISTINCT FROM NEW.steer_inputs)
  EXECUTE FUNCTION lingxios.supersede_memory_evidence();

-- Snapshot old recovery evidence once, before telemetry can expire.
INSERT INTO lingxios.agent_steps(work_id,step_id,request_version,kind,input_hash,input,output,artifacts,completed_at)
SELECT DISTINCT ON (event.run_id,event.data->>'callId') event.run_id,event.data->>'callId',
  (event.data->>'requestVersion')::integer,'ipython',md5(event.data::text),'{"migrated":true}'::jsonb,
  event.data->'output',COALESCE(event.data->'artifacts','[]'::jsonb),event.recorded_at
FROM lingxios.agent_run_events event JOIN lingxios.agent_work_items work ON work.id=event.run_id
WHERE event.kind='ipython.completed' AND event.data->>'callId' IS NOT NULL
  AND event.data->>'requestVersion' ~ '^[1-9][0-9]*$' AND jsonb_typeof(event.data->'output')='string'
ORDER BY event.run_id,event.data->>'callId',event.seq DESC;
INSERT INTO lingxios.agent_results(work_id,candidate_hash,request_version,fence,message,committed_at)
SELECT message.run_id,'legacy:'||md5(message.message::text),
  (message.message->'envelope'->>'requestVersion')::integer,work.fence,message.message,message.committed_at
FROM lingxios.agent_messages message JOIN lingxios.agent_work_items work ON work.id=message.run_id
WHERE message.message->'envelope'->>'requestVersion' ~ '^[1-9][0-9]*$';
UPDATE lingxios.schema_version SET version=6 WHERE singleton=TRUE;

ALTER TABLE lingxios.agent_run_events ADD COLUMN delivery_work JSONB;
ALTER TABLE lingxios.agent_run_events ADD COLUMN delivered_at TIMESTAMPTZ;
ALTER TABLE lingxios.agent_run_events ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE lingxios.agent_run_events ADD COLUMN claim_token TEXT;
ALTER TABLE lingxios.agent_run_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX agent_run_events_delivery_idx ON lingxios.agent_run_events(available_at,run_id,seq) WHERE delivery_work IS NOT NULL AND delivered_at IS NULL;
