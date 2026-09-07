-- First native package installation. The installer locks and rejects non-empty
-- retired runtime tables before this transaction starts applying any migrations.
-- There is no conversion of old sessions, receipts, approvals or memories.
ALTER TABLE public.evidence_claims DROP CONSTRAINT evidence_claims_model_run_id_fkey;
DROP TABLE public.approvals, public.agent_events, public.agent_runs,
  public.agent_host_actions, public.agent_os_session_leases, public.agent_os_session_routes,
  public.agent_os_workers, public.agent_os_sessions, public.agent_work_items,
  public.agent_workspace, public.agent_memory_evidence, public.agent_autonomy_rules,
  public.agent_action_executions, public.agent_tasks, public.agent_triages, public.tool_calls;
DROP SCHEMA lingxios CASCADE;

-- Populated in the same transaction from the installed package's public assets.
CREATE TABLE public.lingxios_installation (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  runtime_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  protocol_version INTEGER NOT NULL,
  schema_sha256 TEXT NOT NULL CHECK (schema_sha256 ~ '^[0-9a-f]{64}$'),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
