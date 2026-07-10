-- 0085_agent_usage_duration.sql — agent_usage gains duration_ms (agent cost/latency dashboard).
--
-- Why. The cost/latency dashboard (docs/plans/2026-07-10-agent-cost-dashboard.md) needs per-run
-- wall-clock latency, but the privacy line (NFR-PRIV-001) forbids the usage surface from ever
-- reading agent_runs/agent_events/agent_threads. agent_usage is the ONLY sanctioned source, so we
-- persist the edge fn's already-computed per-round `model_ms` (Date.now() - _t0) here. Cost-per-run
-- and latency percentiles are then computed by grouping agent_usage by run_id inside the aggregate
-- RPCs — the privacy line stays intact.
--
-- Shape. One additive, non-null-default-0 int column; mirrors 0084's additive-column pattern. No RLS
-- change (agent_usage's existing policies cover all columns), no index change (a reporting measure,
-- not a filter/group key), no CHECK (any non-negative int is valid; the edge fn clamps).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   alter table public.agent_usage drop column if exists duration_ms;

alter table public.agent_usage
  add column duration_ms integer not null default 0;

comment on column public.agent_usage.duration_ms is
  'Wall-clock ms of the model call that produced this row (edge-fn model_ms). 0 when unmeasured.';
