# Return and rejection reasons implementation plan

> **For agentic workers:** Follow the repository's Orca dispatch and TDD workflow. This is a planning artifact; do not implement until the Director signs off the revised spec.

**Goal:** Store the reason, actor and time on four kinds of rejected records and show them to their submitters.

**Architecture:** Extend existing row-scoped records and existing transition RPCs; preserve their signatures, authorization and transactional behavior. Retain rejection details during correction and clear them at resubmission, except terminal top-ups. Slice A ships separately to `dev` with optional reasons; Slice B builds on A in `ux/1110` and enforces mandatory reasons through constraint triggers.

**Tech stack:** Postgres/Supabase, pgTAP, TypeScript/React, Vitest/RTL.

**Spec:** `docs/specs/return-reasons.spec.md`.

## Global constraints and review focus

- No changed budget or procurement behavior, broader row visibility, changed approver authority, fabricated historical actors, or production deployment.
- Null, tabs/newlines, >1000 characters, preexisting rejected rows, actor deletion, simultaneous decisions and per-row permissions need explicit tests.
- Slice A is additive: retain optional reason behavior for all existing callers and make no dev UI changes; Slice B enforces required reasons and implements submitter display on the redesign branch.

## Migration and interfaces

The highest forward migration in the checked `origin/dev` tree is `0854_odoo_equipment_adoption.sql`; `0855` is the next free numeric prefix above that maximum. Before implementation recheck `git ls-tree -r --name-only origin/dev supabase/migrations` and reserve a different prefix if another change has landed. Slice A creates `supabase/migrations/0855_return_reasons.sql` and `supabase/migrations/rollback/0855_return_reasons_down.sql`. Slice B chooses the next free prefix on ux/1110 at build time, after A is integrated; use filenames `<next>_return_reason_required.sql` and `rollback/<next>_return_reason_required_down.sql` with that chosen prefix.

Keep signatures and existing EXECUTE grants (CREATE OR REPLACE preserves them):

```sql
public.transition_timesheet(p_timesheet_id uuid, p_to public.timesheet_status, p_notes text default null) returns void
public.transition_expense_claim(p_id uuid, p_to public.expense_claim_status, p_notes text default null, p_payment_reference text default null) returns void
public.transition_imprest_replenishment(p_id uuid, p_to text, p_notes text default null, p_payment_reference text default null) returns void
public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
-- Existing wrapper remains: public.transition_equipment_usage(uuid,text,text) returns text.
```

Add nullable `rejection_reason text`, `rejected_by uuid references public.profiles(id) on delete set null`, `rejected_at timestamptz` to `public.timesheets`. Add `rejected_by` and `rejected_at` of those types to `public.expense_claims`, `public.imprest_replenishments`, and `public.equipment_usage_entries`; reuse respectively `rejection_notes`, `decided_notes`, and `decision_notes`. Separate equipment rejection stamps preserve its existing approval fields. `ON DELETE SET NULL` intentionally permits actor-null with a retained reason/time.

In Slice A, add no required-reason or length constraint. In each existing transition body, after its existing authorization checks and in the same status update, stamp `rejected_by = auth.uid()` and `rejected_at = now()` on rejection, and store `nullif(btrim(p_notes), '')` in the appropriate reason column; null/empty notes remain accepted. On Draft → Submitted clear all three rejection fields on timesheets, expense claims and equipment; do not clear on Rejected → Draft. On top-ups, retain them on the terminal rejected record. Do not change approval notes or equipment bulk approval semantics. Preserve lock ordering, audit, feature gates and authorization by copying the latest bodies from 0534/0423/0534/0680 respectively and editing only the update assignments. Do not grant table UPDATE/INSERT on new columns; table-level SELECT and existing row policies remain the read authority. Explicitly assert unchanged function grants and column write privileges in pgTAP. Update `record_history_config` classification only for any of these tables actually registered there; classify text/time and omit actor like 0792. The A rollback first restores the exact pre-0855 four function bodies from those migrations, removes any added history classifications, drops columns, and retains existing notes and grants. Rollback discards newly stored fields; test it only on disposable local DB.

In Slice B, create four row-level `CREATE CONSTRAINT TRIGGER` triggers, `AFTER UPDATE OF status` is not valid syntax for constraint triggers, so use `AFTER UPDATE ON` each table, `DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW`. Each trigger calls a table-specific trigger function using `SET search_path = public, pg_temp`; on `OLD.status = 'Submitted' AND NEW.status = 'Rejected'` (timesheets, expense claims, equipment) or `OLD.status = 'Requested' AND NEW.status = 'Rejected'` (top-ups), reject if `NEW`'s corresponding reason is null, whitespace-only under `nullif(regexp_replace(reason, '[[:space:]]', '', 'g'), '') is null`, or `length(btrim(reason)) > 1000`; raise SQLSTATE `22023`. Use `timesheets.rejection_reason`, `expense_claims.rejection_notes`, `imprest_replenishments.decided_notes`, `equipment_usage_entries.decision_notes`. Name functions `require_timesheet_rejection_reason`, `require_expense_rejection_reason`, `require_imprest_rejection_reason`, `require_equipment_rejection_reason` and triggers with the same names plus `_trigger`; revoke function execution from public, anon, authenticated. Trigger only on the actual status edge, so historical rows remain valid and routine edits/resubmissions do not require a reason. No transition function is redefined in B. B rollback drops these four triggers first and their four functions, leaving Slice A storage intact. Test rollback on disposable local DB.

## Caller inventory

Search scope: all of `pmo-portal/`, `supabase/functions/`, `scripts/`; `cli/` does not exist at this checkout. Also inspected SQL callers under `supabase/tests/` and the bulk equipment caller in migrations. Exact RPC-name search is supplemented by wrapper/hook names. Re-run this search before implementation because indirect UI callers do not necessarily spell an RPC name:

```sh
rg -n 'transition_timesheet|transition_expense_claim|transition_imprest_replenishment|transition_equipment_usage|equipment_usage_transition_core|rejectTimesheet|transitionExpenseClaim|transitionReplenishment|useTimesheetMutations' pmo-portal supabase/functions scripts
rg -n 'transition_(timesheet|expense_claim|imprest_replenishment|equipment_usage)\(' supabase/tests
```

- Timesheets: `src/lib/db/timesheetTransition.ts` → `src/lib/repositories/timesheets.ts` → `src/hooks/useTimesheetApproval.ts` → `pages/timesheets/ApprovalsQueue.tsx`; `pages/Approvals.tsx` hosts queue; `pages/timesheets/TimesheetBulkApprove.tsx` approves only; `pages/timesheets/useTimesheetWeekEditor.ts` and `pages/Timesheets.tsx` submit/reopen. `scripts/second-org-roles-smoke.sh` submits/approves only. Tests include `src/lib/db/timesheetTransition.test.ts`, `.reopenApproved.test.ts`, `src/hooks/useTimesheetApproval.test.ts`, `src/lib/repositories/index.test.ts`, `pages/timesheets/__tests__/ApprovalsQueue.*.test.tsx`; SQL: `0021_timesheet_transition_tenant`, `0022_timesheet_submit_gate`, `0023_timesheet_manager_approve`, `0024_timesheet_fallback`, `0025_timesheet_sod`, `0026_timesheet_manager_read_anon`, `0151_timesheet_claim_guard`, `0151_timesheet_fence_concurrency`, `0151_timesheet_generation_witness`, `0151_timesheet_outbox_guard_acl`, `0151_timesheet_push_insert_recheck`, `0151_timesheet_reopen_authority`, `0151_timesheet_reopen_precondition`, `0151_timesheet_uuid_identity`, `0152_reopen_refuses_held_mirror`, `0157_reopen_refuses_unknown_erp_outcome`, `0158_held_predicate_is_advisory`, `0158_hold_stamps_witness_at_creation`, `0159_attestation_admits_the_reopen`, `0168_update_path_sod_class`, `0171_sod_class_completeness`, `0173_rpc_active_member_gate`, `0237_workflow_notifications`, `timesheet_transition_map`, `tm_assembly`, `plans_feature_enforcement` (all under `supabase/tests/`, suffix `.test.sql`).
- Expenses: `src/lib/db/expenseClaims.ts` → `src/lib/repositories/expenses.ts` → `src/hooks/useExpenseClaims.ts` → `pages/expenses/ExpenseDecisionBar.tsx`, hosted by `pages/ExpenseClaimDetail.tsx`; `pages/approvals/ExpenseClaimApprovalSection.tsx` is an approval entry point. `pmo-portal/e2e/AC-IMP-090-site-imprest-journey.spec.ts` and `pmo-portal/e2e/serial/AC-EXP-140-expense-postings-erp.spec.ts` call RPC; unit tests include `src/lib/db/expenseClaims.test.ts`, `src/lib/repositories/expenses.test.ts`, `src/hooks/useExpenseClaims.test.tsx`. SQL files: `expense_claims_transition`, `expense_claims_routing`, `expense_claims_line_lock`, `expense_claims_notify`, `expense_advances`, `0270_expense_postings_enqueue`, `imprest_cash`, `imprest_line_lock`, `imprest_routing`, `imprest_approval_route`, `imprest_postings`, `imprest_notify`, `imprest_notify_routing`, `0173_rpc_active_member_gate`, `0210_service_only_definers_execute_grants`.
- Top-ups: `src/lib/db/imprest.ts` → `src/lib/repositories/imprest.ts` → `src/hooks/useImprest.ts` → `pages/ImprestFloatDetail.tsx`; `pmo-portal/e2e/AC-IMP-090-site-imprest-journey.spec.ts` calls RPC. Unit tests: `src/lib/db/imprest.test.ts`, `src/hooks/useImprest.test.tsx`, `pages/ImprestFloatDetail.test.tsx`. SQL: `imprest_replenishment`, `imprest_cash`, `imprest_acl`, `imprest_notify`, `imprest_notify_routing`, `imprest_postings`, `plans_feature_enforcement`.
- Equipment: `src/lib/db/equipment.ts` → `src/lib/repositories/equipment.ts` → `src/hooks/useEquipment.ts` → `pages/equipment/EquipmentUsage.tsx`; the SQL bulk `approve_equipment_usage_week` calls the core with Approved/null and must stay valid. Unit tests `src/lib/db/equipment.test.ts`, `src/hooks/useEquipment.test.tsx`, `pages/equipment/EquipmentUsage.test.tsx`; SQL `equipment_usage`, `equipment_rls`, `equipment_costing`, `equipment_actual_cost`, `equipment_project_actuals`, `tm_equipment`.
- `supabase/functions/erpnext-sweep/index.ts`, `sweepWedge.test.ts`, `timesheetBackstopMint.test.ts` mention the timesheet RPC but do not invoke it in the matching source; `scripts/isolation-probe-denominator.json` lists signatures only. Existing successful no-reason rejection calls in `supabase/tests/timesheet_transition_map.test.sql:63`, `supabase/tests/plans_feature_enforcement.test.sql:316`, `supabase/tests/equipment_costing.test.sql:242`, and `supabase/tests/imprest_notify_routing.test.sql:124` must supply an explicit reason in Slice B; the intentionally unauthorized no-reason call in `supabase/tests/equipment_usage.test.sql:147` remains a 42501 authorization test because the trigger fires only on a successful update. No CLI directory exists; exact RPC-name searches in edge functions and scripts found no rejection calls (the script smoke caller submits/approves only). Keep intentional authorization/illegal-transition assertions intact. Search all listed files, including multiline calls, before changing fixtures. Existing valid rejection assertions are not weakened.

## Slice A — additive server, pgTAP and repositories on dev

Each checkbox is a small ordered task: write the focused test, observe red, implement, then rerun green. Existing no-reason rejections remain valid; no dev UI edits or mandatory-reason checks belong in this slice.

1. [ ] Create `supabase/tests/return_reasons_timesheet.test.sql` for AC-RSN-002/003/007: authorized rejection with and without notes, trimmed storage and actor/time, existing authorization and org boundaries, owner read, correction retention, resubmit clearing and legacy null. Add timesheet columns and replace 0534 body as above.
2. [ ] Create `supabase/tests/return_reasons_expense.test.sql` with the same cases for claims and advances, including routed/float SoD and approval with no notes. Add expense stamps and replace 0423 body, using `rejection_notes`.
3. [ ] Create `supabase/tests/return_reasons_imprest.test.sql` with optional notes, storage, requester read, Finance/Admin authority, wrong-org denial, terminal rejection and replacement request; preserve optional approval/payment notes. Add stamps and replace 0534 body.
4. [ ] Create `supabase/tests/return_reasons_equipment.test.sql` with optional notes, actor/time, owner read, existing authorization, correction and resubmission plus bulk approval with no notes. Add stamps and replace 0680 core; preserve wrapper and core privileges.
5. [ ] Create `supabase/migrations/rollback/0855_return_reasons_down.sql` as specified; classify registered history columns and verify privilege posture. Generate local types to `/tmp/return-reasons-database.types.ts` with `scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > /tmp/return-reasons-database.types.ts'`; port only four changed table definitions into `pmo-portal/src/lib/supabase/database.types.ts`, preserving existing hand-maintained RPC nullability.
6. [ ] Update `pmo-portal/src/lib/db/timesheets.ts`, `expenseClaims.ts`, `imprest.ts`, `equipment.ts` and their repositories/contracts (`src/lib/repositories/timesheets.ts`, `expenses.ts`, `imprest.ts`, `equipment.ts`, `contracts/imprest.ts`, `contracts/equipment.ts`) as needed for row fields and decider names under existing profile visibility. Test `src/lib/db/timesheetTransition.test.ts`, `expenseClaims.test.ts`, `imprest.test.ts`, `equipment.test.ts` and `src/lib/repositories/expenses.test.ts`: reason forwarded, fields preserved, legacy null safe, no client-supplied stamps.
7. [ ] Run Slice A targeted commands below, then seek spec, quality and security review; A ships alone to dev under Director authorization.

## Slice B — enforcement and submitter display on ux/1110 after A

Slice B owns whitespace-aware refusal; its required-reason cap must respect equipment’s existing 500-character limit (use per-kind caps or 500 for equipment).

Branch inspection used `git show origin/ux/1110:<path>`. Screens are `pmo-portal/pages/Timesheets.tsx` (returned banner), `pmo-portal/pages/ExpenseClaimDetail.tsx` (existing note), `pmo-portal/pages/ImprestFloatDetail.tsx` (replenishment table), and `pmo-portal/pages/equipment/EquipmentUsage.tsx` (own-entry rows). Its approver dialogs already use `pmo-portal/src/components/ui/ReasonDialog.tsx`; retain them.

8. [ ] Verify the existing redesign reason dialogs with their RTL tests (AC-RSN-006), preserving required input and reason forwarding. Pick the next free prefix on ux/1110 at build time; add the four constraint triggers and rollback described above. Create `supabase/tests/return_reasons_required.test.sql` owning AC-RSN-001: for each type test null, empty, spaces, tabs/newlines, over 1000 characters, valid 1000 characters, legal authorization and atomic unchanged state on refusal; prove legacy rows and correction remain usable and non-rejection transitions unaffected.
9. [ ] Update successful no-reason rejection fixtures in `supabase/tests/timesheet_transition_map.test.sql`, `supabase/tests/plans_feature_enforcement.test.sql`, `supabase/tests/equipment_costing.test.sql`, and `supabase/tests/imprest_notify_routing.test.sql` to pass genuine reasons. Search all caller scopes again, including multiline and dynamic calls, and update any newly introduced no-reason reject callers. Keep denial tests and their authorization expectations intact.
10. [ ] Update `pages/Timesheets.tsx` and `pages/ExpenseClaimDetail.tsx` to show reason, actor and time at the top through correction; add RTL coverage in `pages/Timesheets.test.tsx`, `pages/__tests__/Timesheets.reopen.test.tsx`, and `pages/ExpenseClaimDetail.test.tsx`, including legacy unavailable fallbacks and resubmission clearing.
11. [ ] Update `pages/ImprestFloatDetail.tsx` and `pages/equipment/EquipmentUsage.tsx` to show reason, actor and time per rejected request/own entry. Test `pages/ImprestFloatDetail.test.tsx` and `pages/equipment/EquipmentUsage.test.tsx`, including multiple records and missing legacy details; respect existing access boundaries.
12. [ ] Run B's pgTAP, touched Vitest/RTL and existing touched e2e journeys plus `node scripts/affected-e2e.mjs` and `scripts/ux-proof.sh` for four routes. No new e2e journey is necessary: pgTAP owns server/read contract and RTL owns display. Follow UI rendered review and owner screenshot gate.

## Exact targeted verification

Run from repository root unless shown otherwise. DB commands use the shared DB lock; reset only for the new migration. Stop on any red test and fix the implementation or explicitly escalate an actually incorrect test.

```sh
scripts/with-db-lock.sh supabase db reset
scripts/with-db-lock.sh supabase test db supabase/tests/return_reasons_timesheet.test.sql supabase/tests/return_reasons_expense.test.sql supabase/tests/return_reasons_imprest.test.sql supabase/tests/return_reasons_equipment.test.sql
cd pmo-portal
npm run check:guards
npm run typecheck
npx eslint --max-warnings=0 src/lib/db/timesheets.ts src/lib/db/expenseClaims.ts src/lib/db/imprest.ts src/lib/db/equipment.ts src/lib/repositories/timesheets.ts src/lib/repositories/expenses.ts src/lib/repositories/imprest.ts src/lib/repositories/equipment.ts
npx vitest run src/lib/db/timesheetTransition.test.ts src/lib/db/expenseClaims.test.ts src/lib/db/imprest.test.ts src/lib/db/equipment.test.ts src/lib/repositories/expenses.test.ts
```

For Slice B run from the repository root after its migration is applied:

```sh
scripts/with-db-lock.sh supabase db reset
scripts/with-db-lock.sh supabase test db supabase/tests/return_reasons_required.test.sql supabase/tests/timesheet_transition_map.test.sql supabase/tests/plans_feature_enforcement.test.sql supabase/tests/equipment_costing.test.sql supabase/tests/imprest_notify_routing.test.sql supabase/tests/equipment_usage.test.sql
```

Then run from `pmo-portal/`:

```sh
npx eslint --max-warnings=0 pages/Timesheets.tsx pages/ExpenseClaimDetail.tsx pages/ImprestFloatDetail.tsx pages/equipment/EquipmentUsage.tsx
npx vitest run pages/Timesheets.test.tsx pages/__tests__/Timesheets.reopen.test.tsx pages/ExpenseClaimDetail.test.tsx pages/ImprestFloatDetail.test.tsx pages/equipment/EquipmentUsage.test.tsx
```

From repository root run:

```sh
node scripts/affected-e2e.mjs
scripts/e2e-local.sh AC-911-timesheet-approval
scripts/e2e-local.sh AC-EXP-070-expense-claim-journey
scripts/e2e-local.sh AC-IMP-090-site-imprest-journey
scripts/e2e-local.sh AC-EQU-019-equipment-allocation-journey
scripts/ux-proof.sh /timesheets /expenses /imprest /equipment
```

The `/expenses` and `/imprest` captures are list routes, not proof of detail records: the executor must also capture populated claim and float detail URLs from its seed and report those exact URLs, since no stable seeded IDs were established during planning. Run any additional affected journeys reported by the script; capture the commands and outputs.
