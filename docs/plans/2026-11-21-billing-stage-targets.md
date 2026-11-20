# Billing Stage Targets and Optional Stages Implementation Plan (#2592)

> Fresh Orca worker per slice; Director-dispatched (money path: it edits the invoice gate). Spec: `docs/specs/billing-stage-targets.spec.md`. Starts after OD-BSX-1..7 are signed, in the first release after the 15 December go-live. Builds on migrations 1021 and 1022 and the overdue-job shape in 1028.

## Migration (number assigned by the Director from the next free range; not numbered here)
One migration, additive:
- `billing_stage_templates`: add `target_days smallint check (target_days between 1 and 365)`, `optional boolean not null default false`.
- `claim_billing_stages`: add the same two columns, plus `skipped_on date`, `skipped_by uuid references auth.users(id)`, `skipped_reason text check (skipped_reason is null or char_length(btrim(skipped_reason)) between 3 and 500)`, `overdue_notified_at timestamptz`; check `not (completed_on is not null and skipped_on is not null)`; check `skipped_on is null or (optional and skipped_by is not null and skipped_reason is not null)`. Extend the existing completed check so a skipped stage needs `started_on`. Partial index on `(project_id) where completed_on is null and skipped_on is null and target_days is not null` for the job.
- `create or replace set_billing_stage_template`: read `target_days` and `optional` from each stage object (validate 1..365, else `23514` detail `stage-target-invalid`). Keep every existing assertion (member, role Admin/Finance, org, project lock, 20-stage cap).
- `create or replace instantiate_claim_billing_stages`: copy both new columns.
- `create or replace billing_stages_open`: `completed_on is null and skipped_on is null`. This is the one predicate for the native invoice and the ERP outbox trigger (`assert_claim_billing_stages_complete`); neither trigger changes.
- `create or replace complete_billing_stage`: the order check and the "not before the previous stage" check treat `coalesce(completed_on, skipped_on)` as the earlier stage's date, and refuse a stage that is already skipped.
- New `skip_billing_stage(p_stage uuid, p_reason text) returns void`, `security definer`, same shape as `complete_billing_stage`: `assert_is_active_member`, role in (Admin, Finance) else `42501`, `lock_billing_stage_claim`, refuse non-optional, non-current, finished or withdrawn (`55000`, detail `stage-not-skippable`), reason 3..500 (`23514`, detail `skip-reason-invalid`); set `skipped_on = native_org_today(org)`, `skipped_by = auth.uid()`, `skipped_reason`; set the next stage's `started_on` as `complete_billing_stage` does; `log_audit('billing_stage.skip', ...)`. `revoke all ... from public, anon; grant execute ... to authenticated, service_role`.
- New `notify_overdue_billing_stages() returns integer`, `security definer`, modelled on `escalate_overdue_incidents()` (1028): rows from `claim_billing_stages` joined to a live (not withdrawn) claim where open, `target_days is not null`, `overdue_notified_at is null` and age greater than target; `for update of s skip locked`; stamp; recipient = the project's active `project_manager_id`, else the organisation's active Admins; `notify_workflow_user(... 'warning', 'progress_claim', claim_id, label)`; `log_audit('billing_stage.overdue', ...)`. `revoke all ... from public, anon, authenticated`. `select cron.schedule('billing-stage-overdue', '17 1 * * *', 'select public.notify_overdue_billing_stages()')` (daily; `cron.schedule` upserts by name).
- RLS: no policy change (the tables already select for active members in the org, no client write grant). Any new policy uses `(select helper())`.
- **Rollback:** `supabase/migrations/rollback/<number>_billing_stage_targets_down.sql`: `select cron.unschedule('billing-stage-overdue')`; drop `skip_billing_stage` and `notify_overdue_billing_stages`; restore the prior bodies of the four replaced functions from 1021 and 1022; drop the new columns. A claim already holding a skipped stage must be reviewed before the down runs (the restored predicate would treat it as open); the down script says so in its header.

## Slice 1: pure derivation (Orca)
- [ ] Write first, in `pmo-portal/src/lib/billingStages.test.ts`, AC-BSX-003, then add `stageOverdue(stage, today)` to `pmo-portal/src/lib/billingStages.ts` beside `stageAgeDays`; extend `currentStageIndex` to treat a skipped stage as done. No new date library; organisation calendar dates as strings, as the file does today.

## Slice 2: database (Director-dispatched Orca worker, Opus)
- [ ] pgTAP `supabase/tests/<number>_billing_stage_targets.test.sql`: AC-BSX-001, 002, 004..011. Fixtures follow `supabase/tests/0960_billing_stages.test.sql` (owner-written rows; client checks as `authenticated` with a JWT; a second organisation; a Project Manager, Engineer, Finance, Admin).
- [ ] Migration as above. Mutation checks listed in AC-BSX-009 and: remove the role check in `skip_billing_stage` (AC-BSX-011 red); stamp without testing `overdue_notified_at is null` (AC-BSX-004 red); restore each.
- [ ] DB work under `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` (one lock hold).

## Slice 3: data seam and screen (ui-implementer; `restructure` skill, `docs/ux/screen-rules.md`)
- [ ] `pmo-portal/src/lib/db/billingStages.ts`: `StageTemplateInput` gains `targetDays`, `optional`; `ClaimBillingStage` gains `targetDays`, `optional`, `skippedOn`, `skippedReason`; new `skipBillingStage(stageId, reason)`; validate every field, never default a missing figure. Extend `billingStages.test.ts`. Repository `src/lib/repositories/billingStages.ts` and contract `src/lib/repositories/contracts/billingStages.ts`; hook `src/hooks/useBillingStages.ts` (invalidate the claim trace on skip).
- [ ] `pmo-portal/pages/project-detail/tabs/ClaimBillingStages.tsx`: overdue label with age and target, "Not needed" action behind `can('edit','billingStage')`-style gating added to `src/auth/policy.ts` (Finance, Admin), reason dialog using `ConfirmDialog`/`EntityFormModal`, skipped state shown with reason. List editor (where the project's stages are edited) gets target and optional fields. RTL `ClaimBillingStages.test.tsx`: AC-BSX-012; behaviour only.
- [ ] Strings in the existing billing-stage namespace in `pmo-portal/public/locales/en/` and `.../id/`: "Target (days)", "Optional", "Overdue", "{{age}} days, target {{target}}", "Not needed", "Mark as not needed", "Reason". Bahasa Indonesia to be confirmed by the owner.
- [ ] E2E `pmo-portal/e2e/AC-BSX-013-optional-stage-invoice.spec.ts` (read `docs/e2e-parallel-conventions.md` first; tag isolation class); mirror the arrange step of the existing claim journeys.
- [ ] `scripts/ux-proof.sh` on the project billing tab route.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-BSX-001, 002, 004..011 | pgTAP | `supabase/tests/<number>_billing_stage_targets.test.sql` |
| AC-BSX-003 | Unit | `pmo-portal/src/lib/billingStages.test.ts` |
| AC-BSX-012 | RTL | `pmo-portal/pages/project-detail/tabs/__tests__/ClaimBillingStages.test.tsx` |
| AC-BSX-013 | E2E | `pmo-portal/e2e/AC-BSX-013-optional-stage-invoice.spec.ts` |

## Glossary and docs
- [ ] `docs/glossary.md`: Stage target, Overdue stage, Optional stage, Skipped stage. Note the new rule beside FR-BST-011/020 in `docs/specs/billing-stages.spec.md`. ADR: none expected; the gate predicate is the same single predicate.
- [ ] Update the roadmap issue (#1571) in the same session as the build ships.

## Final gate
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, the touched pgTAP file (`supabase test db <file>`), the touched e2e journey (`scripts/e2e-local.sh <fragment>`), `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh`. No full local suite. Reviewers: spec, code quality, security-auditor (money path).
