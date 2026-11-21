-- 1360_billing_stage_targets_columns.sql — billing stage target days, optional stages, skip and overdue stamp (#2592).
-- Spec docs/specs/billing-stage-targets.spec.md (FR-BSX-001/002/020/024/030); proven by supabase/tests/1360_billing_stage_targets.test.sql.
-- Additive: every new column is nullable or defaulted, so an existing list or claim reads as no target, not optional, never overdue.
-- The columns are written only by set_billing_stage_template, instantiate_claim_billing_stages, skip_billing_stage and
-- notify_overdue_billing_stages (1361..1363); no client write grant exists on these tables (1021).
-- ── REVERSE: rollback/1360_billing_stage_targets_columns_down.sql ─────────────────────────────────────────────────────

alter table public.billing_stage_templates
  add column target_days smallint check (target_days between 1 and 365),
  add column optional    boolean  not null default false;

alter table public.claim_billing_stages
  add column target_days         smallint check (target_days between 1 and 365),
  add column optional            boolean not null default false,
  add column skipped_on          date,
  add column skipped_by          uuid references auth.users(id),
  add column skipped_reason      text check (skipped_reason is null or char_length(btrim(skipped_reason)) between 3 and 500),
  add column overdue_notified_at timestamptz,
  add constraint claim_billing_stages_not_both check (completed_on is null or skipped_on is null),
  add constraint claim_billing_stages_skip_shape check (
    (skipped_on is null and skipped_by is null and skipped_reason is null)
    or (skipped_on is not null and optional and skipped_by is not null and skipped_reason is not null
        and started_on is not null and skipped_on >= started_on));

-- The overdue job's scan: open stages of any claim that carry a target and were not yet notified.
create index claim_billing_stages_overdue_idx on public.claim_billing_stages (project_id)
  where completed_on is null and skipped_on is null and target_days is not null and overdue_notified_at is null;

comment on column public.claim_billing_stages.skipped_on is
  'Optional stage marked not needed (1360). Counts as complete for the invoice gate (billing_stages_open, 1361).';
