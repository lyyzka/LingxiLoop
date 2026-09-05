ALTER TABLE public.eval_cases
  ADD COLUMN scenario_key text,
  ADD COLUMN sample_index integer NOT NULL DEFAULT 0 CHECK (sample_index >= 0);

UPDATE public.eval_cases SET scenario_key = case_key WHERE scenario_key IS NULL;
ALTER TABLE public.eval_cases ALTER COLUMN scenario_key SET NOT NULL;
CREATE INDEX eval_cases_scenario_samples_idx ON public.eval_cases(eval_run_id, scenario_key, sample_index);

CREATE TABLE public.eval_jobs (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  profile text NOT NULL CHECK (profile IN ('core', 'full')),
  suite_key text NOT NULL,
  suite_version text NOT NULL,
  commit_sha text NOT NULL,
  prompt_version text NOT NULL,
  candidate_model text NOT NULL,
  judge_model text NOT NULL,
  requested_by text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  eval_run_id text REFERENCES public.eval_runs(id),
  error text,
  timeout_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (candidate_model <> judge_model)
);
CREATE INDEX eval_jobs_created_idx ON public.eval_jobs(created_at DESC);

CREATE TABLE public.eval_gate_policies (
  suite_key text NOT NULL,
  candidate_model text NOT NULL,
  prompt_version text NOT NULL,
  mode text NOT NULL DEFAULT 'monitor' CHECK (mode IN ('monitor', 'enforce')),
  baseline_run_id text REFERENCES public.eval_runs(id),
  reason text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (suite_key, candidate_model, prompt_version),
  CHECK (mode = 'monitor' OR baseline_run_id IS NOT NULL)
);

CREATE TABLE public.eval_callback_nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX eval_callback_nonces_expiry_idx ON public.eval_callback_nonces(expires_at);
