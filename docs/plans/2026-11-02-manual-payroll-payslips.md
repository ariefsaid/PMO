# Manual Payroll Sheet and Payslips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Execute checked steps in order; one fresh Orca worker per slice under Director dispatch. This plan is proposed, not authority to build before owner sign-off.

**Goal:** Turn approved attendance into an independently approved manual payroll, individual payslips and reconcilable project-cost allocations.

**Architecture:** PMO owns versioned payroll snapshots and uses #1516/#1517 as source evidence. Server RPCs enforce transactional state, access, arithmetic and SoD; repositories and shared forms are the client seam. #1510 consumes approved allocation revisions and owns all ERP posting and reconciliation.

**Tech stack:** Postgres/Supabase RLS and pgTAP, React 19, TypeScript, Vitest, Playwright.

**Spec:** `docs/specs/manual-payroll-payslips.spec.md`.

## Global constraints

Owner signs OD-PAY-1–7 and retention before build; revise this plan to match any changed decision. #1516, #1517 and #1520 precede source assembly; reconcile their actual API and schema at integration, without creating competing records. #902 owns the eventual role matrix; enforce signed permissions server-side in the interim. #1510 depends on this issue and #1504; agree its revision/delta contract before integration. Use only migrations 0541–0544 and matching `supabase/migrations/rollback/<name>_down.sql`; if occupied, stop for a new reservation. Exact money uses Postgres numeric, never JS floating-point for authoritative totals. All payroll changes are online; preserve approved revisions. No payroll posting, automatic tax, employee tax slips or bank file. Money/SoD/auth slices ship separately and require spec, quality and security review. Never expose personal pay through project aggregates, logs or notifications.

## Slice map and file responsibilities

| Slice / ship boundary | Dependencies | Files and responsibility |
|---|---|---|
| A: private schema and source assembly (auth; ship alone) | #1516, #1517, #1520, OD-PAY-2 | `0541_payroll_sources.sql`, rollback; `supabase/tests/payroll_sources.test.sql`; source snapshots, permissions and refresh |
| B: manual amounts and approval (money/SoD; ship alone) | A, OD-PAY-1, 5, 7 | `0542_payroll_approval.sql`, rollback; `supabase/tests/payroll_approval.test.sql`; calculations, revision lifecycle and concurrency |
| C: allocation contract (money; ship alone) | B, OD-PAY-3, 4, 7; handshake with #1510 | `0543_payroll_allocation.sql`, rollback; `supabase/tests/payroll_allocation.test.sql`; deterministic allocations and versioned read contract |
| D: payslip read boundary (auth; ship alone) | B, OD-PAY-2, 6 | `0544_payroll_payslips.sql`, rollback; `supabase/tests/payroll_payslips.test.sql`; self and authorized read paths |
| E: client and end-to-end journey | A–D, #902 permission registration | `pmo-portal/src/lib/db/payroll.ts`, `src/lib/repositories/payroll.ts`, `src/hooks/usePayroll.ts`, `pages/Payroll.tsx`, `pages/Payslip.tsx`, route/nav/policy and locale files; corresponding tests and `e2e/AC-PAY-012-payroll.spec.ts` |

Each migration's down file removes its functions, policies, triggers and tables in reverse dependency order. Refuse a destructive rollback containing approved payroll without an explicit data-preservation/export procedure approved by the owner. Before each migration, check `find supabase/migrations -maxdepth 1 -name "054[1-4]_*"`; never overwrite an occupied number. Source-specific joins below must use the actual landed #1516/#1517 contracts; if those lack approved-state versions or project attribution, stop for upstream contract work rather than guessing columns.

## Review focus

1. Month boundary, timezone and split clock records: AC-PAY-001 source test.
2. Duplicate requests and simultaneous submit/approve: AC-PAY-006 approval test and untagged retry/race assertions in Task 4.
3. Retroactive evidence changes after submission: AC-PAY-007 approval test.
4. No hours, rounding ties and correction after export: AC-PAY-005 and AC-PAY-011 allocation tests.
5. Direct access to another employee's data and project totals: AC-PAY-010 payslip test.

## AC → owning layer (ADR-0010)

| AC | Canonical owner test |
|---|---|
| AC-PAY-001 | `supabase/tests/payroll_sources.test.sql` |
| AC-PAY-002 | `supabase/tests/payroll_sources.test.sql` |
| AC-PAY-003 | `supabase/tests/payroll_approval.test.sql` |
| AC-PAY-004 | `supabase/tests/payroll_approval.test.sql` |
| AC-PAY-005 | `supabase/tests/payroll_allocation.test.sql` |
| AC-PAY-006 | `supabase/tests/payroll_approval.test.sql` |
| AC-PAY-007 | `supabase/tests/payroll_approval.test.sql` |
| AC-PAY-008 | `supabase/tests/payroll_approval.test.sql` |
| AC-PAY-009 | `supabase/tests/payroll_payslips.test.sql` |
| AC-PAY-010 | `supabase/tests/payroll_payslips.test.sql` |
| AC-PAY-011 | `supabase/tests/payroll_allocation.test.sql` |
| AC-PAY-012 | `pmo-portal/e2e/AC-PAY-012-payroll.spec.ts` |
| AC-PAY-013 | `supabase/tests/payroll_approval.test.sql` |

Use `begin`, isolated fixtures and `rollback`, `finish()` in each pgTAP file. Test authenticated identities and grants, not just policies, including `service_role` inventory guard. Use `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <file>'` from repo root after every migration edit; inspect output for `Parse errors` as well as failing assertions. Run red test before implementation; the first failure may be missing RPC/table, then green after implementation. Apply security/money mutations temporarily and prove the owning test fails; restore before committing.

### Task 1: Private period and source snapshots (slice A)

**Files:** `supabase/migrations/0541_payroll_sources.sql`, `supabase/migrations/rollback/0541_payroll_sources_down.sql`, `supabase/tests/payroll_sources.test.sql`.

**Interface:** `create_payroll_sheet(p_month date, p_request_id uuid) returns uuid`; `preview_payroll_refresh(p_sheet_id uuid) returns jsonb`; `refresh_payroll_sheet(p_sheet_id uuid, p_version bigint, p_request_id uuid) returns jsonb`. Server derives organisation and actor. Preview returns source additions/changes/removals and exceptions; refresh requires explicit confirmation via its separate call.

- [ ] Add AC-PAY-001 pgTAP: approved sources, zero-activity assignment, rejected and overlapping records, month boundary and duplicate create; assert one row per employee and exceptions.
- [ ] Add AC-PAY-002: changed source preview and refresh retain manual values and audit actor/before/after. Assert wrong organisation cannot refresh.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/payroll_sources.test.sql'`; expect failure because RPCs are absent.
- [ ] Create org-stamped RLS tables for period, revision, employee row, source snapshot, change history and request deduplication; add guarded create/preview/refresh RPCs and rollback. Snapshot source IDs, versions, units and project, never GPS. Retain manual entries on refresh.
- [ ] Repeat the command; require all assertions passing and no parse errors. Mutate org check and show isolation test fails, then restore and repeat green.

### Task 2: Manual money validation (slice B)

**Files:** `supabase/migrations/0542_payroll_approval.sql`, its matching rollback, `supabase/tests/payroll_approval.test.sql`.

**Interface:** `save_payroll_row(p_row_id uuid, p_version bigint, p_components jsonb, p_request_id uuid) returns jsonb`, returns authoritative exact totals and new version. Components use decimal strings, not floating point.

- [ ] Add AC-PAY-003 using the exact example in the spec; assert gross 1150.00, deductions 110.00, net 1040.00. Add AC-PAY-004 for negative net, invalid precision and unchanged draft.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/payroll_approval.test.sql'`; expect missing RPC failure.
- [ ] Implement server numeric validation, signs, precision, row version check, actor audit and exact totals; extend rollback to reverse this task.
- [ ] Repeat the command; require green and no parse errors. Change the net formula temporarily and confirm AC-PAY-003 fails; restore and rerun.

### Task 3: Submit, approval and return (slice B)

**Files:** same as Task 2. **Interface:** `transition_payroll(p_sheet_id uuid, p_version bigint, p_action text, p_reason text, p_request_id uuid) returns jsonb`; actions `submit`, `approve`, `return`. A preparer is every actor who edited the revision, not only its creator.

- [ ] Add AC-PAY-006, AC-PAY-007 and AC-PAY-013: edited-by self-approval and cross-org denial, distinct approver success, changed source/version refusal, reasoned return and history; assert duplicate request is idempotent and concurrent stale version loses.
- [ ] Run the Task 2 pgTAP command and observe the new assertions fail.
- [ ] Add transactionally locked transitions, server-side permission and independent-approver checks, source-version recheck, reasons, idempotency and audit; submitted data is immutable except return.
- [ ] Repeat the Task 2 pgTAP command; require green and no parse errors. Mutate the self-approval guard and verify AC-PAY-006 fails; restore and rerun.

### Task 4: Corrections (slice B)

**Files:** same as Task 2. **Interface:** `correct_payroll(p_sheet_id uuid, p_version bigint, p_reason text, p_request_id uuid) returns uuid` returns the linked draft revision.

- [ ] Add AC-PAY-008 asserting required reason, immutable prior payslip and allocation references, new draft and independent reapproval; assert repeat request returns the same revision.
- [ ] Run the Task 2 pgTAP command and observe failure.
- [ ] Implement revision linking and reasoned copy to draft, retaining history and preventing edits to approved rows.
- [ ] Repeat the command; require green and no parse errors. Commit slice B only after all three tasks and their security review.

### Task 5: Allocation and downstream contract (slice C)

**Files:** `supabase/migrations/0543_payroll_allocation.sql`, matching rollback, `supabase/tests/payroll_allocation.test.sql`.

**Interface:** `list_payroll_allocations(p_revision_id uuid) returns jsonb` returns revision ID, predecessor, employee/project IDs, amounts, period and source provenance to authorized #1510 consumers. A correction returns full immutable revision and predecessor so the consumer can reconcile the delta.

- [ ] Add AC-PAY-005 and AC-PAY-011: 100.00 across 1:2 hours = 33.33/66.67; equal remainders break by project ID; no hours requires explicit assigned project and reason; correction delta sums to new minus old, with old unchanged.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/payroll_allocation.test.sql'`; expect failure.
- [ ] Implement allocation in the submit transaction using approved unique attendance hours, largest remainder and stable ordering. Freeze the result at approval; expose the restricted versioned contract, never post or add to read-side ledger actuals here.
- [ ] Repeat command, require green with no parse errors. Mutate rounding or allow unallocated submission and confirm tests fail; restore and rerun. Confirm #1510 explicitly excludes duplicate read-side allocation for tagged lines before it ships.

### Task 6: Payslip and payroll access (slice D)

**Files:** `supabase/migrations/0544_payroll_payslips.sql`, matching rollback, `supabase/tests/payroll_payslips.test.sql`.

**Interface:** `get_approved_payslip(p_revision_id uuid, p_employee_id uuid) returns jsonb`; server derives employee identity and signed payroll privileges. Project aggregate read returns only permitted totals, not employee rows.

- [ ] Add AC-PAY-009 and AC-PAY-010: own approved result visible, draft and other employee invisible, no implicit Admin override, direct table/RPC/audit/export/cross-org access denied; assert authorized HR and approver paths succeed and project totals omit individuals.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/payroll_payslips.test.sql'`; expect missing RPC failure.
- [ ] Implement narrow approved-only read and permission checks across tables and RPCs, including service grants; add rollback. No public storage or attachment URLs.
- [ ] Repeat the command; require green and no parse errors. Remove the identity check temporarily and prove AC-PAY-010 fails; restore and rerun.

### Task 7: Repository and sheet client (slice E)

**Files:** `pmo-portal/src/lib/db/payroll.ts`, `src/lib/repositories/payroll.ts`, `src/hooks/usePayroll.ts`, `pages/Payroll.tsx`, `pages/Payroll.test.tsx`, `src/auth/policy.ts`, `App.tsx`, `public/locales/en/payroll.json`, `public/locales/id/payroll.json` and the existing locale namespace registration.

**Interface:** repository methods `create(month, requestId)`, `previewRefresh(sheetId)`, `refresh(sheetId, version, requestId)`, `saveRow(rowId, version, components, requestId)` and `transition(sheetId, version, action, reason, requestId)` forward to Tasks 1–3; errors preserve form state.

- [ ] Add RTL tests for empty/loading/error, source diff confirmation, field errors, draft preservation on stale/offline failure, permission-gated controls and pagination at 50; run `cd pmo-portal && npx vitest run pages/Payroll.test.tsx`, expect failure.
- [ ] Implement typed DAL → repository → hook and the sheet screen with shared form primitives, signed roles, localized copy and versioned server totals. Register module actions in #902's landed catalog; otherwise follow its interim contract and record the dependency.
- [ ] Run `cd pmo-portal && npx vitest run pages/Payroll.test.tsx`; require all tests green.

### Task 8: Payslip client and cross-stack journey (slice E)

**Files:** `pmo-portal/pages/Payslip.tsx`, `pages/Payslip.test.tsx`, `e2e/AC-PAY-012-payroll.spec.ts`, routes and both locale files. Read `docs/e2e-parallel-conventions.md` before authoring.

**Interface:** repository `getPayslip(revisionId, employeeId)` calls Task 6; display authoritative approved breakdown with authenticated print.

- [ ] Add RTL tests for own approved breakdown, loading/error and no draft issuance; run `cd pmo-portal && npx vitest run pages/Payslip.test.tsx`, expect failure.
- [ ] Implement payslip display and print; no notifications, persistent browser storage or email distribution. Run the same Vitest command and require green.
- [ ] Add AC-PAY-012 as an isolated real-auth journey: HR prepares approved source evidence, enters the spec example, submits; a different authorized approver approves; employee opens their payslip; assert 1150.00/110.00/1040.00 and the approved project allocations against the actual database result. Run `scripts/e2e-local.sh AC-PAY-012` from repo root; require pass.

## Final gates and handoff

After each slice run from `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <actual touched TS/TSX files>` and directly touched Vitest files. For migration slices run the touched pgTAP file under the DB lock and inspect output, including parse errors; run `scripts/ux-proof.sh <actual touched route>` for UI and touched e2e journeys under the shared lock. Capture command output and security/money mutation evidence. Run spec, quality and security reviews per slice, rendered design review for UI, and acceptance review against the table. No merge, production change or ERP post is authorized by this plan.
