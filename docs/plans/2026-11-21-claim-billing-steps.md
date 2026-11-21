# Claim Billing Steps Implementation Plan (#2680)

> Status: built, awaiting the wave run (pgTAP, e2e, denominator, mutations, screenshots). Fresh Orca worker; Director-dispatched, ships alone (money path). Spec: `docs/specs/claim-billing-steps.spec.md`. Stacked on `feat/2592-billing-stage-targets`; OD-SCOPE-6/2 applied; OD-CBS-1..5 recommended defaults. Gate change: the builder writes pgTAP/e2e but does not run db reset, pgTAP, e2e, screenshots or mutations; the wave run does.

## Migrations (1365-1369, all five used; each has `supabase/migrations/rollback/<n>_..._down.sql`)
- **1365 `claim_billing_steps_columns`**: `billing_stage_templates.owner_role user_role`; `claim_billing_stages.owner_role user_role`, `target_on date`; partial index `claim_billing_stages_waiting_idx (org_id, owner_role) where completed_on is null and skipped_on is null and started_on is not null and owner_role is not null`; replace the #2592 overdue index with one covering `target_on` as well. New tables `billing_step_templates` (id, org_id default `auth_org_id()`, name unique per org among live, archived_at, created_at) and `billing_step_template_steps` (template_id, position 1-20, name, owner_role, target_days 1-365, client_side, optional) and `billing_step_template_documents` (step_id, position, name, required). RLS enabled and forced; select policy `org_id = (select auth_org_id())` and active member; no write grant. `instantiate_claim_billing_stages` replaced to copy `owner_role` (everything else unchanged).
- **1366 `billing_step_template_rpcs`**: `save_billing_step_template(p_template uuid, p_name text, p_steps jsonb) returns uuid` (null id = create; replaces steps whole; Admin/Finance; validates as `set_billing_stage_template`), `archive_billing_step_template(uuid)`, `load_billing_step_template_onto_project(p_project, p_template)` (reuses the same insert path as `set_billing_stage_template`; `set_billing_stage_template` replaced once more to read `owner_role`), `load_billing_step_template_onto_claim(p_claim, p_template)` (Admin/Finance/PM of project; refuses if any step completed/skipped, invoice, withdrawn: `claim-steps-started`).
- **1367 `claim_billing_step_edit`**: `update_claim_billing_step(p_stage, p_patch jsonb)` (owner_role, target_on, and for Finance/Admin also name, target_days, client_side, optional), `add_claim_billing_step(p_claim, p_after_position, p_step jsonb)`, `remove_claim_billing_step(p_stage, p_reason)`, `move_claim_billing_step(p_stage, p_new_position)`. All lock claim then step (same order as 1361/1362), shift positions in a way that respects `unique (claim_id, position)` (renumber descending), refuse as the spec's error table, `log_audit('billing_step.*')`. Invoice-existence test: `exists sales_invoices/outbox` through the same lookup `assert_claim_billing_stages_complete` uses. `billing_stages_open` and its two triggers are NOT changed.
- **1368 `billing_step_seams_and_job`**: replace `billing_stage_due_on` (coalesce(target_on, started_on + target_days)), `billing_stage_overdue_recipients` (owner role holders; Project Manager role = the project's manager; fallback Admins), and `notify_overdue_billing_stages` (reads the seam in its where clause; otherwise identical, same cron).
- **1369 `billing_steps_needs_you`**: `my_waiting_billing_steps() returns table(stage_id, claim_id, project_id, project_name, step_name, due_on, days_over)` (security definer, stable, limit 200, active member, matches `auth_role()`; PM only own projects) and `overdue_billing_steps_by_claim(p_project uuid) returns table(claim_id, step_name, days_over)` (active member of org; used by the claim-list marker).
- Isolation-probe fragment `scripts/isolation-probe-denominator.d/2680-claim-billing-steps.json` for the new tables and definer functions.
- Record history: not extended (stage tables are not in `record_history_config`; audit via `log_audit`).

## Slices (test first)
1. **Pure** `pmo-portal/src/lib/waitingSteps.ts` + `waitingSteps.test.ts` (AC-CBS-012): pointer derivation (count, oldest overdue, link). `stageOverdue` in `billingStages.ts` takes the step target date when present.
2. **pgTAP** `supabase/tests/1365_claim_billing_steps.test.sql` (AC-CBS-001..011), fixtures as `1360_billing_stage_targets.test.sql`.
3. **Data seam**: `pmo-portal/src/lib/db/billingSteps.ts`, `src/lib/repositories/billingSteps.ts`, `src/hooks/useBillingSteps.ts`: template CRUD, load, edit RPC calls, `fetchWaitingSteps`, `fetchOverdueByClaim`; validate every field, no defaults for missing figures. Extend `billingStages.ts` mapping with `ownerRole`, `targetOn`.
4. **Needs you**: `useNeedsYou.ts` adds fact `waitingBillingSteps` and item id `billing-steps-waiting` (tone `warn`, `lost` if any overdue), failure shows unknown not zero; `NeedsYouList` test extended. Tests: `useNeedsYou.waitingSteps.test.tsx`.
5. **Screens** (read `.claude/skills/restructure/SKILL.md`, `docs/ux/screen-rules.md`; shared primitives `EntityFormModal`/`Combobox`/`SelectField`/`ConfirmDialog`): `ClaimBillingStages.tsx` edit mode (Finance/Admin: add, rename, remove with reason, reorder, load template; PM: owner role and target date), `BillingTermsModal.tsx` owner role per stage and load template, claim-row marker in `BillingTab.tsx`, template manager page in the billing settings area (route chosen by builder from existing settings routes). Owner-role options come from the app's existing role list. Strings en/id in `project.json`. Tests: `ClaimBillingStagesEdit.test.tsx`, claim-row marker test (AC-CBS-013/014).
6. **E2E** `pmo-portal/e2e/AC-CBS-015-claim-steps-needs-you.spec.ts` (read `docs/e2e-parallel-conventions.md`; isolation tag).
7. **Docs**: `docs/glossary.md` (EN and ID), cross-references in the two earlier specs, roadmap #1571 note.

## Traceability
| AC | Layer | File |
|---|---|---|
| AC-CBS-001..011 | pgTAP | `supabase/tests/1365_claim_billing_steps.test.sql` |
| AC-CBS-012 | Unit | `pmo-portal/src/lib/waitingSteps.test.ts`, `pmo-portal/src/components/dashboard/restructure/useNeedsYou.waitingSteps.test.ts` |
| AC-CBS-013 | RTL | `pmo-portal/pages/project-detail/tabs/__tests__/ClaimOverdueMarker.test.tsx` |
| AC-CBS-014 | RTL | `pmo-portal/pages/project-detail/tabs/__tests__/ClaimBillingStagesEdit.test.tsx` |
| AC-CBS-015 | E2E | `pmo-portal/e2e/AC-CBS-015-claim-steps-needs-you.spec.ts` |
| AC-CBS-016 | existing suites | untouched |

## Mutation cases for the wave run (break, test must go red, restore)
1. `remove_claim_billing_step`: drop the Finance/Admin role check (PM may remove) -> AC-CBS-007 / 006 red.
2. `remove_claim_billing_step`: drop the reason check -> AC-CBS-007 red.
3. `update_claim_billing_step`: drop the completed/skipped refusal -> AC-CBS-005 red.
4. `add_claim_billing_step`: drop the invoice-exists refusal -> AC-CBS-008 red.
5. `add_claim_billing_step`: allow position before a completed step -> AC-CBS-005 red.
6. `billing_stage_due_on`: ignore `target_on` -> AC-CBS-009 red.
7. `billing_stage_overdue_recipients`: ignore `owner_role` -> AC-CBS-010 red.
8. `my_waiting_billing_steps`: drop the org filter -> AC-CBS-011 red; drop the `completed_on is null` test -> AC-CBS-011 red (pointer does not clear).
9. `load_..._onto_claim`: drop the started-claim refusal -> AC-CBS-003 red.
10. Template save: drop the role check -> AC-CBS-001 red.

## Final gate (builder)
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed files>`, `npx vitest run <touched/added test files>`. DB, e2e, screenshots (phone 390 / desktop 1440 under `docs/evidence/1215/2680/`) and mutations run in the wave.
