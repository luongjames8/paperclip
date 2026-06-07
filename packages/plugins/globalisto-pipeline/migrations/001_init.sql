CREATE TABLE plugin_globalisto_pipeline_46b22ea2d1.pipeline_runs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  topic text NOT NULL,
  profile text NOT NULL,
  status text NOT NULL,
  completed_step_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_step_id text,
  active_worker_run_id uuid,
  active_issue_id uuid,
  step_complete boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
