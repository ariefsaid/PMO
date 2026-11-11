# Return and rejection reasons implementation plan

> **For agentic workers:** Follow the repository's Orca dispatch and TDD workflow. This is a planning artifact; do not implement until the Director signs off the spec and the Slice A compatibility decision below.

**Goal:** Store the reason, actor and time on four kinds of rejected records and show them to their submitters.

**Architecture:** Extend existing row-scoped records and existing transition RPCs; preserve their signatures, authorization and transactional behavior. Retain rejection details during correction and clear them at resubmission, except terminal top-ups. Slice A ships separately to `dev`; Slice B builds on A in `ux/1110`.

**Tech stack:** Postgres/Supabase, pgTAP, TypeScript/React, Vitest/RTL.

**Spec:** `docs/specs/return-reasons.spec.md`.

## Global constraints and review focus

- No changed budget or procurement behavior, broader row visibility, changed approver authority, fabricated historical actors, or production deployment.
- Null, tabs/newlines, >1000 characters, preexisting rejected rows, actor deletion, simultaneous decisions and per-row permissions need explicit tests.
- **Release blocker:** `pmo-portal/pages/timesheets/ApprovalsQueue.tsx` on dev calls reject with `{ id }` only. Slice A as requested (server and repositories only) would break all individual timesheet returns. Recommended Director decision: include the minimal dev approver reason-entry changes in A, plus required/validation copy for expense and top-up dialogs; UI redesign and submitter display remain B. Do not ship A until approved. The redesign branch already has `ReasonDialog` at `pmo-portal/src/components/ui/ReasonDialog.tsx`; port its needed behavior into dev, checking dependencies, rather than assuming it exists there.

## Migration and interfaces

The highest forward migration in the checked `origin/dev` tree is `0854_odoo_equipment_adoption.sql`; `0855` is the next free numeric prefix above that maximum. Before implementation recheck `git ls-tree -r --name-only origin/dev supabase/migrations` and reserve a different prefix if another change has landed. Create `supabase/migrations/0855_return_reasons.sql` and `supabase/migrations/rollback/0855_return_reasons_down.sql`.

Keep signatures and existing EXECUTE grants (CREATE OR REPLACE preserves them):

```sql
public.transition_timesheet(p_timesheet_id uuid, p_to public.timesheet_status, p_notes text default null) returns void
public.transition_expense_claim(p_id uuid, p_to public.expense_claim_status, p_notes text default null, p_payment_reference text default null) returns void
public.transition_imprest_replenishment(p_id uuid, p_to text, p_notes text default null, p_payment_reference text default null) returns void
public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
-- Existing wrapper remains: public.transition_equipment_usage(uuid,text,text) returns text.
```

Add nullable `rejection_reason text`, `rejected_by uuid references public.profiles(id) on delete set null`, `rejected_at timestamptz` to `public.timesheets`. Add `rejected_by` and `rejected_at` of those types to `public.expense_claims`, `public.imprest_replenishments`, and `public.equipment_usage_entries`; reuse respectively `rejection_notes`, `decided_notes`, and `decision_notes`. Separate equipment rejection stamps preserve its existing approval fields. `ON DELETE SET NULL` intentionally permits actor-null with a retained reason/time.

Add four named CHECK constraints, `timesheets_rejection_reason_ck`, `expense_claims_rejection_reason_ck`, `imprest_replenishments_rejection_reason_ck`, `equipment_usage_rejection_reason_ck`: `rejected_at IS NULL OR (reason_column IS NOT NULL AND nullif(regexp_replace(reason_column, '[[:space:]]', '', 'g'), '') IS NOT NULL AND length(btrim(reason_column)) <= 1000)`. They permit historical rows with no rejection time and do not forbid nullable actor after profile deletion. The RPC validates all new rejections with the same whitespace test and 1000 bound after existing authorization checks, raising `22023`, then sets reason to `btrim(p_notes)`, actor to `auth.uid()`, and time to `now()` in the same update as status. On Draft → Submitted clear all three rejection fields on timesheets, expense claims and equipment; do not clear on Rejected → Draft. On top-ups, retain them on the terminal rejected record. Do not change approval notes or equipment bulk approval semantics. Preserve all lock ordering, audit and feature gates by copying the latest bodies from 0534/0423/0534/0680 respectively and editing only validation and update assignments. Do not grant table UPDATE/INSERT on new columns; table-level SELECT and existing row policies remain the read authority. Explicitly assert unchanged function grants and column write privileges in pgTAP. Update `record_history_config` classification only for any of these tables actually registered there; classify text/time and omit actor like 0792. The rollback first restores the exact pre-0855 four function bodies from those migrations, removes any added history classifications, drops constraints and columns, and retains existing notes and grants. Rollback irreversibly discards new stamps; test it only on disposable local DB.

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
- `supabase/functions/erpnext-sweep/index.ts`, `sweepWedge.test.ts`, `timesheetBackstopMint.test.ts` mention the timesheet RPC but do not invoke it in the matching source; `scripts/isolation-probe-denominator.json` lists signatures only. Existing SQL tests with a successful rejected transition and no reason, notably `equipment_costing.test.sql` and `imprest_notify_routing.test.sql`, must supply an explicit reason; keep intentional authorization/illegal-transition assertions intact. Search all listed files, including multiline calls, before changing fixtures. Existing valid rejection assertions are not weakened.

## Slice A — server, pgTAP, repositories and minimal dev caller compatibility

Each checkbox is a small ordered task; each test is written first and run red, then implement and rerun green. Existing unrelated behavior and authorization tests stay intact.

1. [ ] Create `supabase/tests/return_reasons_timesheet.test.sql`: AC-RSN-001/002/003 for timesheets, including unauthorized manager, author, wrong org, null/whitespace/length, trim, timestamps, revision and resubmit, legacy row, read and write privileges. Create migration's timesheet columns/check and replace 0534 body as specified; confirm named grant behavior.
2. [ ] Create `supabase/tests/return_reasons_expense.test.sql`: same checks for claim and advance plus routing/float SoD and approval-without-notes. Add expense stamps/check and replace 0423 body, retaining existing `rejection_notes` during correction and clearing on resubmit.
3. [ ] Create `supabase/tests/return_reasons_imprest.test.sql`: same input/read/authority checks, terminal rejected original surviving a new request, and approval/payment without notes. Add top-up stamps/check and replace 0534 body.
4. [ ] Create `supabase/tests/return_reasons_equipment.test.sql`: same checks, including rejected → Draft → Submitted and bulk approval without notes. Add stamps/check and replace 0680 core; keep wrapper and core privileges unchanged. Adapt successful legacy rejection calls in `supabase/tests/equipment_costing.test.sql` and `supabase/tests/imprest_notify_routing.test.sql` to provide genuine reasons; retain all test purposes.
5. [ ] Implement `rollback/0855_return_reasons_down.sql` as specified; classify registered history columns and run catalogue guards. Confirm migration does not expand UPDATE/INSERT grants or function EXECUTE. Generate local types into a temporary file with `scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > /tmp/return-reasons-database.types.ts'`; port only the four changed table definitions into `pmo-portal/src/lib/supabase/database.types.ts`, preserving existing hand-maintained RPC nullability (see `docs/reviews/2026-07-23-p3bc-audit-program.md`).
6. [ ] In `pmo-portal/src/lib/db/timesheets.ts`, `expenseClaims.ts`, `imprest.ts`, `equipment.ts` and their repositories/contracts (`src/lib/repositories/timesheets.ts`, `expenses.ts`, `imprest.ts`, `equipment.ts`, `contracts/imprest.ts`, `contracts/equipment.ts`), retain row reason/stamps in list/detail projections and expose decider name through existing profile visibility; missing profile/name maps to null. Avoid duplicate FK ambiguity with explicit relation names. Test in `src/lib/db/timesheetTransition.test.ts`, `expenseClaims.test.ts`, `imprest.test.ts`, `equipment.test.ts` and `src/lib/repositories/expenses.test.ts`: valid notes forwarded, fields preserved, null legacy data safe, no client-supplied actor/time.
7. [ ] After Director accepts compatibility exception, update `pages/timesheets/ApprovalsQueue.tsx` to require and send reason, `pages/expenses/ExpenseDecisionBar.tsx` and `pages/ImprestFloatDetail.tsx` to require it on rejection only. Add focused RTL tests to `pages/timesheets/__tests__/ApprovalsQueue.decisions.test.tsx`, `pages/ExpenseClaimDetail.test.tsx`, `pages/ImprestFloatDetail.test.tsx`; empty/whitespace cannot confirm and typed reason reaches mutation. Keep equipment's existing required dialog; approvals remain note-optional.
8. [ ] Run targeted verification below. Seek spec, quality and security review; A is an approval-transition change and ships alone to dev, only under Director's release authorization.

## Slice B — submitter display on `origin/ux/1110` after A lands

Branch inspection used `git show origin/ux/1110:<path>`. The actual target screens are `pmo-portal/pages/Timesheets.tsx` (returned banner around line 243), `pmo-portal/pages/ExpenseClaimDetail.tsx` (existing note around line 154), `pmo-portal/pages/ImprestFloatDetail.tsx` (replenishment table around line 243), and `pmo-portal/pages/equipment/EquipmentUsage.tsx` (own-entry rows). Its approver dialogs already use `ReasonDialog`; do not regress them when integrating A.

9. [ ] In `pages/Timesheets.tsx` show current sheet reason, decider and time in the existing returned/correction banner; retain while Draft with a reason. Update `pages/Timesheets.test.tsx` and `pages/__tests__/Timesheets.reopen.test.tsx` for reason/name, legacy fallback, and post-resubmit disappearance.
10. [ ] In `pages/ExpenseClaimDetail.tsx` replace note-only copy with reason, decider and time in the top detail area while rejected or correcting; test `pages/ExpenseClaimDetail.test.tsx`.
11. [ ] In `pages/ImprestFloatDetail.tsx` surface the reason, decider and time with each rejected request in the replenishment section; in `pages/equipment/EquipmentUsage.tsx` surface them with each rejected/correcting own entry. Test `pages/ImprestFloatDetail.test.tsx` and `pages/equipment/EquipmentUsage.test.tsx`, including multiple records, unavailable actor and legacy fields. Respect `DESIGN.md` and existing access boundaries.
12. [ ] Run touched Vitest/RTL and existing touched e2e journeys plus `node scripts/affected-e2e.mjs` and `scripts/ux-proof.sh` for the four routes. No new e2e journey is necessary: pgTAP owns the full server/read contract and RTL owns display; use existing cross-stack journeys for integration diagnosis. Follow UI rendered review and owner screenshot gate.

## Exact targeted verification

Run from repository root unless shown otherwise. DB commands use the shared DB lock; reset only for the new migration. Stop on any red test and fix the implementation or explicitly escalate an actually incorrect test.

```sh
scripts/with-db-lock.sh supabase db reset
scripts/with-db-lock.sh supabase test db supabase/tests/return_reasons_timesheet.test.sql supabase/tests/return_reasons_expense.test.sql supabase/tests/return_reasons_imprest.test.sql supabase/tests/return_reasons_equipment.test.sql supabase/tests/equipment_costing.test.sql supabase/tests/imprest_notify_routing.test.sql
cd pmo-portal
npm run check:guards
npm run typecheck
npx eslint --max-warnings=0 src/lib/db/timesheets.ts src/lib/db/timesheetTransition.ts src/lib/db/expenseClaims.ts src/lib/db/imprest.ts src/lib/db/equipment.ts src/lib/repositories/timesheets.ts src/lib/repositories/expenses.ts src/lib/repositories/imprest.ts src/lib/repositories/equipment.ts pages/timesheets/ApprovalsQueue.tsx pages/expenses/ExpenseDecisionBar.tsx pages/ImprestFloatDetail.tsx
npx vitest run src/lib/db/timesheetTransition.test.ts src/lib/db/expenseClaims.test.ts src/lib/db/imprest.test.ts src/lib/db/equipment.test.ts src/lib/repositories/expenses.test.ts pages/timesheets/__tests__/ApprovalsQueue.decisions.test.tsx pages/ExpenseClaimDetail.test.tsx pages/ImprestFloatDetail.test.tsx pages/equipment/EquipmentUsage.test.tsx
```

For Slice B run from `pmo-portal/`:

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
