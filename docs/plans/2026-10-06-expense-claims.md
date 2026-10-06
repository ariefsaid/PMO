# Plan — Expense claims and cash advances (#775), phase A

- **Spec:** `docs/specs/expense-claims.spec.md` (FR-EXP-001…068, NFR-EXP-001…006, AC-EXP-001…070)
- **ADR:** `docs/adr/0078-expense-claims-ride-spend-routing-and-core-erp-doctypes.md`
- **Tier:** money / SoD / approval → **Director-dispatched**, not the ADW. Builder brief carries
  `docs/money-path-primer.md`. The Director runs or witnesses the mutation battery (Task 13) before merge.
- **Migration:** `supabase/migrations/0247_expense_claims.sql`. On a collision run
  `scripts/renumber-migration.sh 0247 <next>` — never hand-rename.
- **Builds on #803 as merged:** `supabase/migrations/0243_spend_approval_routing.sql` (`spend_approval_route`,
  `holds_spend_approval_authority`, `spend_approvers`, `get_procurement_approval_routes`; DD-APR-1..5).
- **This plan is split across six files** (one per phase, so each stays readable):
  1. this file — design, file map, task index, Tasks 0–4 (schema, RLS, lifecycle)
  2. `docs/plans/2026-10-06-expense-claims.part2-db.md` — Tasks 5–13 (routing, lock, advances, notifications,
     allow-list, types, mutation battery)
  3. `docs/plans/2026-10-06-expense-claims.part3-fe-data.md` — Tasks 14–25 (DAL, repository, rules, hooks, policy)
  4. `docs/plans/2026-10-06-expense-claims.part4-fe-ui.md` — Tasks 26–35 (labels, list, form, aging, lines, receipts)
  5. `docs/plans/2026-10-06-expense-claims.part5-fe-ship.md` — Tasks 36–42 (record page, approvals inbox, wiring)
  6. `docs/plans/2026-10-06-expense-claims.part6-i18n-e2e.md` — Tasks 43–46 (i18n, e2e, final gate, phase-B spike)

## 0. Conventions for every task

- `WT=/Users/ariefsaid/Coding/PMO/.claude/worktrees/775-expense-claims` — the Director creates it off `origin/dev`
  on branch `codex/775-expense-claims` and symlinks `pmo-portal/node_modules`. Builders run no git.
- DB: reset + test in **one** lock hold:
  `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`
- Vitest from `pmo-portal/`: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run <files>`.
- TDD: each RED task names the reason it must fail; failing for any other reason (syntax, fixture) is not RED.
- The AC id is the leading token of every pgTAP description and every `it(...)` / `test(...)` title.
- Fixture ids: each pgTAP file owns a prefix (`02471000-…` schema, `02472000-…` transition, `02473000-…` routing,
  `02474000-…` lock, `02475000-…` advances, `02476000-…` notify). The test code is written out in full.

## 1. Design (brainstorm outcome, one decision at a time)

1. **Reuse or new record?** New — OD-PROC-5 forbids `procurements`. One table `expense_claims` with
   `kind ∈ {claim, advance}` (DD-EXP-1): the two differ by one field (entered amount vs Σ lines), and two tables would
   duplicate the status machine, SoD, routing call, notifications and list UI.
   *Reused, unchanged:* `stamp_org_id` (0074), `stamp_currency` (0187), `actor_bypasses_rls` (0174),
   `next_procurement_doc_number` (new prefixes `EXP`, `ADV`), `log_audit` (0076), `notify_workflow_user` (0237),
   `holds_spend_approval_authority` + `spend_approval_route` (0243), the 0028 storage-bucket pattern,
   `approvalRoute.ts` (#803 FE, parameter types widened only).
2. **Approval.** `transition_expense_claim` calls `spend_approval_route` exactly as `transition_procurement` does
   (including the DD-APR-3 decider and submitted-at inputs), under the **same** advisory-lock key
   (`spend-line:<project>:<category>`), so a claim and a purchase request on one budget line serialize. The route
   function is re-created once, adding approved/paid **claims** to line used (ADR-0075 §3 contract). Advances never
   count (DD-EXP-2).
3. **SoD.** In the RPC body before any role check, outside the Admin skip (DD-EXP-3).
4. **Amount integrity.** A claim's `amount` is maintained by an AFTER trigger on its lines (SECURITY DEFINER,
   EXECUTE revoked). Clients may write `amount` only on an advance; the update guard refuses it on a claim unless the
   writer bypasses RLS (i.e. the trigger).
5. **Freeze.** RLS UPDATE is `claimant AND status ∈ {Draft, Rejected}`; lines/receipts write policies require the
   same of the parent. The update-guard trigger repeats the freeze as defence in depth (DD-EXP-10).
6. **Settlement.** At →Paid, lock the advance row, compute `advance_applied = least(amount, outstanding)`, store it
   on the claim. Outstanding is derived (`expense_advance_outstanding`), never stored (DD-EXP-6). Lock order is always
   claim row → advance row; the return RPC locks only the advance row ⇒ no cycle.
7. **Dates/TZ.** `paid_on` and "today" for aging are dates in `organizations.default_timezone` (the 0231 idiom).
8. **UI data flow.** Repository seam (ADR-0017): `repositories.expenseClaim` + `repositories.expenseReceipts` →
   hooks in `src/hooks/useExpenseClaims.ts` / `useExpenseReceipts.ts`. The record page asks one pure function,
   `availableExpenseActions`, which buttons to show (FE projection of the RPC; server decides). The approvals inbox
   section composes one list read + one routes RPC.
9. **ERP.** None in phase A. Phase B (core Journal/Payment Entry, DD-EXP-9) is a separate issue planned after the
   Task 46 spike.

**Error handling.** Every refusal is a 42501 / P0001 / 23514 with a distinct message, pinned by pgTAP; the UI routes
all of them through `classifyMutationError` toasts; the server is the authority, the UI hides what it would refuse.

**Scaling risks surfaced.** (a) The line-used sum now scans claims too; it reaches them via
`expense_claims_line_idx (project_id, budget_category)`. (b) Lists are bounded (200 + sentinel; aging 500) with
visible truncation notices — PostgREST `max_rows` (1000) never silently trims a money list. (c) The per-line lock now
serializes claims with purchase requests on the same line only. (d) Duplicate logic knowingly accepted:
`useExpenseReceipts`/`ExpenseReceiptsCard` mirror the procurement-files pair (~200 lines); a shared attachments seam
would collapse documents/procurement/receipts — not in this issue.

## 2. File map

| File | Change | Task |
|---|---|---|
| `supabase/migrations/0247_expense_claims.sql` | new, §1–§10 | 2, 4, 6, 8, 10 |
| `supabase/tests/expense_claims_schema_rls.test.sql` | new — AC-EXP-001…006 | 1 |
| `supabase/tests/expense_claims_transition.test.sql` | new — AC-EXP-010…016 | 3 |
| `supabase/tests/expense_claims_routing.test.sql` | new — AC-EXP-020…025 | 5 |
| `supabase/tests/expense_claims_line_lock.test.sql` | new — AC-EXP-026 | 5 |
| `supabase/tests/expense_advances.test.sql` | new — AC-EXP-017, 030…032 | 7 |
| `supabase/tests/expense_claims_notify.test.sql` | new — AC-EXP-040…041 | 9 |
| `supabase/tests/0178_anon_executable_definers.test.sql` | +2 allow-list names, count +2 | 11 |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated | 12 |
| `pmo-portal/src/lib/procurement/approvalRoute.ts` | parameter types widened (no behaviour change) | 14 |
| `pmo-portal/src/lib/db/expenseClaims.ts` (+ `.test.ts`) | new — AC-EXP-050 | 15–16 |
| `pmo-portal/src/lib/db/expenseReceipts.ts` (+ `.test.ts`) | new — AC-EXP-051 | 17–18 |
| `pmo-portal/src/lib/repositories/{types,index}.ts`, `index.test.ts` | 2 repositories — AC-EXP-055 | 19 |
| `pmo-portal/src/lib/expenses/expenseRules.ts` (+ `.test.ts`) | new — AC-EXP-052 | 20–21 |
| `pmo-portal/src/hooks/useExpenseClaims.ts` (+ `.test.tsx`), `useExpenseReceipts.ts` | new — AC-EXP-053 | 22–23 |
| `pmo-portal/src/auth/policy.ts`, `policy.test.ts` | `expenseClaim` entity — AC-EXP-054 | 24–25 |
| `pmo-portal/pages/expenses/expenseLabels.ts`, `useOwnAdvanceOptions.ts` | new | 26 |
| `pmo-portal/pages/expenses/ExpenseClaimFormModal.tsx` | new | 28 |
| `pmo-portal/pages/expenses/AdvanceAgingCard.tsx` (+ test) | new — AC-EXP-063 | 29–30 |
| `pmo-portal/pages/ExpenseClaims.tsx` (+ test) | new — AC-EXP-060 | 27, 31 |
| `pmo-portal/pages/expenses/ExpenseLinesCard.tsx` (+ test) | new — AC-EXP-062 | 32–33 |
| `pmo-portal/pages/expenses/ExpenseReceiptsCard.tsx` (+ test) | new — AC-EXP-066 | 34–35 |
| `pmo-portal/pages/expenses/ExpenseDecisionBar.tsx`, `pages/ExpenseClaimDetail.tsx` (+ test) | new — AC-EXP-061 | 36–38 |
| `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx` (+ test), `pages/Approvals.tsx` | new + 1 mount line — AC-EXP-064 | 39–40 |
| `pmo-portal/src/components/shell/{NotificationBell.tsx,Rail.tsx,routeMatch.ts}`, `App.tsx`, bell test | wiring — AC-EXP-065 | 41–42 |
| `pmo-portal/public/locales/{en,id}/common.json`, `src/lib/i18n/launch-scope-routes.txt` | i18n | 43 |
| `pmo-portal/e2e/AC-EXP-070-expense-claim-journey.spec.ts` | new — AC-EXP-070 | 44 |

## 3. Task → AC index

| Task | AC | Task | AC |
|---|---|---|---|
| 1–2 | AC-EXP-001…006 | 20–21 | AC-EXP-052 |
| 3–4 | AC-EXP-010…016 | 22–23 | AC-EXP-053 |
| 5–6 | AC-EXP-020…026 | 24–25 | AC-EXP-054 |
| 7–8 | AC-EXP-017, 030…032 | 27–31 | AC-EXP-060, 063 |
| 9–10 | AC-EXP-040…041 | 32–33 | AC-EXP-062 |
| 11 | NFR-EXP-003 (0178 gate) | 34–35 | AC-EXP-066 |
| 12–13 | all DB ACs (regression + mutation) | 36–38 | AC-EXP-061 |
| 14 | — (type-only refactor; #803 tests stay green) | 39–40 | AC-EXP-064 |
| 15–16 | AC-EXP-050 | 41–42 | AC-EXP-065, FR-EXP-067/068 |
| 17–18 | AC-EXP-051 | 43 | NFR-EXP-006 |
| 19 | AC-EXP-055 | 44 | AC-EXP-070 |

---

## Phase A1 — Database (pgTAP-first)

### Task 0 — Preconditions (2 min)

```bash
cd "$WT" && ls supabase/migrations | tail -5 \
  && grep -n "p_submitted_at timestamptz default null" supabase/migrations/0243_spend_approval_routing.sql \
  && grep -n "create or replace function public.notify_workflow_user" supabase/migrations/0237_workflow_notifications.sql \
  && grep -n "'Special expenses'" supabase/migrations/0229_budget_special_expenses.sql
```
**Expect:** `0243_spend_approval_routing.sql` present with the 8-argument
`spend_approval_route(…, p_decider_id uuid default null, p_submitted_at timestamptz default null)`; 0237 and 0229
present; the highest migration is below 0247. **If the signature differs, STOP and report to the Director** — Tasks
6 and 10 call that exact signature and must not be adapted by guesswork.

### Task 1 — RED: records, RLS, server-owned columns (AC-EXP-001…006)

Create `supabase/tests/expense_claims_schema_rls.test.sql`:

```sql
-- expense_claims_schema_rls.test.sql — #775 records, RLS and the server-owned columns (AC-EXP-001..006).
begin;
select plan(23);

insert into organizations (id, name, default_currency) values
  ('02471000-0000-0000-0000-00000000000a','EXP Schema Org A','IDR'),
  ('02471000-0000-0000-0000-00000000000b','EXP Schema Org B','IDR');
insert into auth.users (id, email) values
  ('02471000-0000-0000-0000-0000000000a1','exp-s-e1@example.com'),
  ('02471000-0000-0000-0000-0000000000a2','exp-s-e2@example.com'),
  ('02471000-0000-0000-0000-0000000000a3','exp-s-pm@example.com'),
  ('02471000-0000-0000-0000-0000000000b1','exp-s-badmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02471000-0000-0000-0000-0000000000a1','02471000-0000-0000-0000-00000000000a','S Eng One','exp-s-e1@example.com','Engineer','active'),
  ('02471000-0000-0000-0000-0000000000a2','02471000-0000-0000-0000-00000000000a','S Eng Two','exp-s-e2@example.com','Engineer','active'),
  ('02471000-0000-0000-0000-0000000000a3','02471000-0000-0000-0000-00000000000a','S PM','exp-s-pm@example.com','Project Manager','active'),
  ('02471000-0000-0000-0000-0000000000b1','02471000-0000-0000-0000-00000000000b','S B Admin','exp-s-badmin@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('02471000-0000-0000-0000-000000000101','02471000-0000-0000-0000-00000000000a','S Project','Ongoing Project');
-- Server-side fixtures: postgres bypasses the origination guard, exactly as an importer would.
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, paid_on) values
  ('02471000-0000-0000-0000-000000000301','02471000-0000-0000-0000-00000000000a','advance','02471000-0000-0000-0000-0000000000a1','E1 paid advance',500,'Paid',current_date),
  ('02471000-0000-0000-0000-000000000302','02471000-0000-0000-0000-00000000000a','advance','02471000-0000-0000-0000-0000000000a2','E2 paid advance',500,'Paid',current_date),
  ('02471000-0000-0000-0000-000000000303','02471000-0000-0000-0000-00000000000a','advance','02471000-0000-0000-0000-0000000000a1','E1 draft advance',300,'Draft',null),
  ('02471000-0000-0000-0000-000000000304','02471000-0000-0000-0000-00000000000a','claim','02471000-0000-0000-0000-0000000000a1','E1 submitted claim',0,'Submitted',null),
  ('02471000-0000-0000-0000-000000000305','02471000-0000-0000-0000-00000000000a','claim','02471000-0000-0000-0000-0000000000a2','E2 draft claim',0,'Draft',null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$ insert into expense_claims (id, kind, title, project_id)
                   values ('02471000-0000-0000-0000-000000000401','claim','Site visit','02471000-0000-0000-0000-000000000101') $$,
  'AC-EXP-001: an Engineer creates a claim sending only kind, title and project');
select is((select org_id::text || '|' || claimant_id::text || '|' || status::text || '|' || currency
             from expense_claims where id = '02471000-0000-0000-0000-000000000401'),
  '02471000-0000-0000-0000-00000000000a|02471000-0000-0000-0000-0000000000a1|Draft|IDR',
  'AC-EXP-001: org, claimant, status and currency are stamped by the server');
select throws_ok($$ insert into expense_claims (kind, title, status) values ('claim','Forged','Submitted') $$,
  '42501', 'permission denied for table expense_claims',
  'AC-EXP-001: a client cannot choose the status');
select throws_ok($$ insert into expense_claims (kind, title, amount) values ('claim','Padded',50) $$,
  'P0001', 'an expense claim''s amount is the sum of its lines: create the claim, then add lines',
  'AC-EXP-001: a claim cannot be created carrying an amount');
select is((select count(*)::int from expense_claims
            where id in ('02471000-0000-0000-0000-000000000401','02471000-0000-0000-0000-000000000305')), 1,
  'AC-EXP-002: an Engineer sees only their own claims');

select lives_ok($$ insert into expense_claim_lines (id, claim_id, expense_date, expense_type, description, amount) values
   ('02471000-0000-0000-0000-000000000501','02471000-0000-0000-0000-000000000401','2026-10-01','Travel','Flight',100),
   ('02471000-0000-0000-0000-000000000502','02471000-0000-0000-0000-000000000401','2026-10-01','Accommodation','Hotel',250) $$,
  'AC-EXP-003: the claimant adds two lines');
select is((select amount from expense_claims where id = '02471000-0000-0000-0000-000000000401'), 350.00::numeric,
  'AC-EXP-003: the claim amount is the sum of its lines');
update expense_claim_lines set amount = 200 where id = '02471000-0000-0000-0000-000000000502';
select is((select amount from expense_claims where id = '02471000-0000-0000-0000-000000000401'), 300.00::numeric,
  'AC-EXP-003: changing a line re-sums the claim');
delete from expense_claim_lines where id = '02471000-0000-0000-0000-000000000501';
select is((select amount from expense_claims where id = '02471000-0000-0000-0000-000000000401'), 200.00::numeric,
  'AC-EXP-003: removing a line re-sums the claim');
select throws_ok($$ update expense_claims set amount = 999 where id = '02471000-0000-0000-0000-000000000401' $$,
  '42501', 'an expense claim''s amount is the sum of its lines: add, change or remove a line instead',
  'AC-EXP-003: a claim''s amount cannot be set directly');

select is((with u as (update expense_claims set title = 'Changed'
                       where id = '02471000-0000-0000-0000-000000000304' returning 1)
           select count(*)::int from u), 0,
  'AC-EXP-004: a submitted claim''s header cannot be changed by its claimant');
select throws_ok($$ insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount)
                   values ('02471000-0000-0000-0000-000000000304','2026-10-02','Meals','Lunch',40) $$,
  '42501', 'new row violates row-level security policy for table "expense_claim_lines"',
  'AC-EXP-004: no line can be added to a submitted claim');

select throws_ok($$ update expense_claims set advance_id = '02471000-0000-0000-0000-000000000302'
                   where id = '02471000-0000-0000-0000-000000000401' $$,
  '23514', 'a claim can be settled only against one of the claimant''s own paid advances',
  'AC-EXP-005: a claim cannot name another person''s advance');
select throws_ok($$ update expense_claims set advance_id = '02471000-0000-0000-0000-000000000303'
                   where id = '02471000-0000-0000-0000-000000000401' $$,
  '23514', 'a claim can be settled only against one of the claimant''s own paid advances',
  'AC-EXP-005: a claim cannot name an unpaid advance');
select lives_ok($$ update expense_claims set advance_id = '02471000-0000-0000-0000-000000000301'
                  where id = '02471000-0000-0000-0000-000000000401' $$,
  'AC-EXP-005: a claim names the claimant''s own paid advance');
select throws_ok($$ insert into expense_claims (kind, title, amount, advance_id)
                   values ('advance','Advance on advance',100,'02471000-0000-0000-0000-000000000301') $$,
  '23514', 'only a claim can be settled against an advance',
  'AC-EXP-005: an advance cannot name an advance');

select lives_ok($$ insert into expense_claim_files (id, claim_id, file_path) values
   ('02471000-0000-0000-0000-000000000601','02471000-0000-0000-0000-000000000401',
    '02471000-0000-0000-0000-00000000000a/02471000-0000-0000-0000-000000000401/f1/receipt.pdf') $$,
  'AC-EXP-006: the claimant records a receipt on their Draft claim');
select is((select org_id from expense_claim_files where id = '02471000-0000-0000-0000-000000000601'),
  '02471000-0000-0000-0000-00000000000a'::uuid, 'AC-EXP-006: the receipt row inherits the claim''s org');
select throws_ok($$ insert into expense_claim_files (claim_id, file_path)
                   values ('02471000-0000-0000-0000-000000000304','x/y/z/r.pdf') $$,
  '42501', 'new row violates row-level security policy for table "expense_claim_files"',
  'AC-EXP-006: no receipt is added to a submitted claim');

set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ insert into expense_claim_files (claim_id, file_path)
                   values ('02471000-0000-0000-0000-000000000401','x/y/z/r.pdf') $$,
  '42501', 'new row violates row-level security policy for table "expense_claim_files"',
  'AC-EXP-006: nobody else records a receipt on a claim');

set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from expense_claims
            where id in ('02471000-0000-0000-0000-000000000401','02471000-0000-0000-0000-000000000305')), 2,
  'AC-EXP-002: a Project Manager sees every claim in the org');
select is((with u as (update expense_claims set title = 'PM edit'
                       where id = '02471000-0000-0000-0000-000000000305' returning 1)
           select count(*)::int from u), 0,
  'AC-EXP-004: a Project Manager cannot edit someone else''s Draft');

set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from expense_claims where org_id = '02471000-0000-0000-0000-00000000000a'), 0,
  'AC-EXP-002: another org''s Admin sees none of them');
reset role;

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_schema_rls.test.sql'`
→ fails at the fixture with `relation "expense_claims" does not exist` (the stated reason: the table is new).

### Task 2 — GREEN: migration header, §1 tables, §2 stamps + guards, §3 amount sync, §4 RLS, §5 receipts bucket

Create `supabase/migrations/0247_expense_claims.sql`:

```sql
-- 0247_expense_claims.sql — #775 expense claims and cash advances (phase A: the PMO process).
-- Spec: docs/specs/expense-claims.spec.md · ADR-0078 · Plan: docs/plans/2026-10-06-expense-claims.md (+ part2..6)
-- Depends on 0243 (#803: spend_approval_route, holds_spend_approval_authority, spend_approvers) and 0237 (#788).
-- Proven by supabase/tests/expense_claims_schema_rls.test.sql, expense_claims_transition.test.sql,
--   expense_claims_routing.test.sql, expense_claims_line_lock.test.sql, expense_advances.test.sql,
--   expense_claims_notify.test.sql, and the 0178 allow-list.
--
-- §1 types + tables · §2 stamps and guards · §3 claim amount = Σ lines · §4 RLS + grants
-- §5 receipts bucket + storage policies · §6 expense_advance_outstanding · §7 transition_expense_claim
-- §8 spend_approval_route (+claims) and get_expense_claim_approval_routes · §9 advance return + aging
-- §10 notifications
--
-- ── REVERSE (manual, in this order — not `db reset`; prod data may exist) ───────────────────────────
--   drop trigger if exists expense_claims_notify_transition_trg on public.expense_claims;
--   drop function if exists public.notify_expense_claim_transition();
--   drop function if exists public.get_expense_advance_aging();
--   drop function if exists public.record_expense_advance_return(uuid, numeric, text);
--   drop function if exists public.get_expense_claim_approval_routes(uuid[]);
--   -- §8: re-create spend_approval_route from THIS file's §8 text minus every line marked `-- 0247`
--   --     (that text is 0243 §5 verbatim). Reverse by editing this text, never by re-applying a migration.
--   drop function if exists public.transition_expense_claim(uuid, public.expense_claim_status, text, text);
--   drop function if exists public.expense_advance_outstanding(uuid);
--   drop policy if exists storage_objects_expense_receipt_write on storage.objects;
--   drop policy if exists storage_objects_expense_receipt_read  on storage.objects;
--   -- bucket: only once it holds no objects (remove them through the Storage API first):
--   delete from storage.buckets where id = 'expense-receipts';
--   drop table if exists public.expense_claim_files;   -- drops its policies and triggers
--   drop table if exists public.expense_claim_lines;
--   drop table if exists public.expense_claims;
--   drop function if exists public.sync_expense_claim_amount();
--   drop function if exists public.stamp_expense_claim_child_org();
--   drop function if exists public.check_expense_claim_advance_link();
--   drop function if exists public.assert_expense_claim_update();
--   drop function if exists public.assert_expense_claim_origination();
--   drop type if exists public.expense_type;
--   drop type if exists public.expense_kind;
--   drop type if exists public.expense_claim_status;
--   (procurement_doc_counters rows with prefix EXP/ADV are harmless; leave them.)

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — types and tables. One record, two kinds (DD-EXP-1). Money is numeric(14,2) with a range CHECK whose
-- upper bound rejects NaN ('NaN' sorts above every number, so `>= 0` alone admits it — 0193's lesson).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create type public.expense_claim_status as enum ('Draft','Submitted','Approved','Rejected','Paid','Cancelled');
create type public.expense_kind as enum ('claim','advance');
create type public.expense_type as enum ('Travel','Accommodation','Meals','Local transport','Other');

create table public.expense_claims (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id)
                      default '00000000-0000-0000-0000-000000000001',
  kind              public.expense_kind not null default 'claim',
  claim_number      text,
  claimant_id       uuid not null references public.profiles(id) default auth.uid(),
  project_id        uuid references public.projects(id),
  budget_category   public.budget_category,
  title             text not null,
  purpose           text,
  currency          text not null default 'XXX',
  amount            numeric(14,2) not null default 0,
  advance_id        uuid references public.expense_claims(id),
  advance_applied   numeric(14,2) not null default 0,
  returned_amount   numeric(14,2) not null default 0,
  status            public.expense_claim_status not null default 'Draft',
  submitted_at      timestamptz,
  approved_by_id    uuid references public.profiles(id),
  approved_at       timestamptz,
  approval_notes    text,
  rejection_notes   text,
  paid_by_id        uuid references public.profiles(id),
  paid_at           timestamptz,
  paid_on           date,
  payment_reference text,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expense_claims_number_unique          unique (org_id, claim_number),
  constraint expense_claims_title_present          check (btrim(title) <> ''),
  constraint expense_claims_amount_range           check (amount >= 0 and amount < 'Infinity'::numeric),
  constraint expense_claims_applied_range          check (advance_applied >= 0 and advance_applied <= amount),
  constraint expense_claims_returned_range         check (returned_amount >= 0 and returned_amount <= amount),
  constraint expense_claims_advance_link_on_claims check (advance_id is null or kind = 'claim'),
  constraint expense_claims_returns_on_advances    check (returned_amount = 0 or kind = 'advance'),
  constraint expense_claims_currency_iso4217       check (currency ~ '^[A-Z]{3}$' and currency <> 'XXX')
);
create index expense_claims_org_status_idx  on public.expense_claims (org_id, status, created_at desc);
create index expense_claims_claimant_idx    on public.expense_claims (claimant_id);
create index expense_claims_line_idx        on public.expense_claims (project_id, budget_category);
create index expense_claims_advance_idx     on public.expense_claims (advance_id) where advance_id is not null;
create index expense_claims_approved_by_idx on public.expense_claims (approved_by_id);
create index expense_claims_paid_by_idx     on public.expense_claims (paid_by_id);
comment on table public.expense_claims is
  '#775 — staff expense claims (kind=claim, amount = Σ lines) and cash advances (kind=advance, entered amount). '
  'Not procurement (OD-PROC-5). Status moves only through transition_expense_claim.';
comment on column public.expense_claims.advance_applied is
  'DD-EXP-6 — how much of the linked advance settled this claim; stamped once at →Paid under a lock on the advance.';

create table public.expense_claim_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  claim_id      uuid not null references public.expense_claims(id) on delete cascade,
  expense_date  date not null,
  expense_type  public.expense_type not null,
  description   text not null,
  amount        numeric(14,2) not null,
  created_at    timestamptz not null default now(),
  constraint expense_claim_lines_description_present check (btrim(description) <> ''),
  constraint expense_claim_lines_amount_range check (amount > 0 and amount < 'Infinity'::numeric)
);
create index expense_claim_lines_claim_idx on public.expense_claim_lines (claim_id, expense_date);

create table public.expense_claim_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  claim_id       uuid not null references public.expense_claims(id) on delete cascade,
  title          text,
  file_path      text not null,
  uploaded_by_id uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create index expense_claim_files_claim_idx       on public.expense_claim_files (claim_id, created_at desc);
create index expense_claim_files_uploaded_by_idx on public.expense_claim_files (uploaded_by_id);

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — stamps and guards. BEFORE-row triggers fire in NAME order, so the names are load-bearing:
--   expense_claims_origination_guard (o) → expense_claims_stamp_org_id (s) → expense_claims_zz_stamp_currency
--   (needs org) → expense_claims_zz_zcheck_advance_link (needs org). Do not rename them "tidier".
-- Server writers (SECURITY DEFINER owned by a BYPASSRLS role: the transition RPC, the line-sum trigger, an
-- importer) are exempt from the client-only rules via actor_bypasses_rls() (0174).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_expense_claim_origination() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;
  if new.status is distinct from 'Draft' then
    raise exception 'expense_claims.status "%" is not the origination status: a claim or advance is created as a Draft and moves only through transition_expense_claim',
      coalesce(new.status::text, '<NULL>') using errcode = 'P0001';
  end if;
  if new.claim_number is not null or new.submitted_at is not null or new.approved_by_id is not null
     or new.approved_at is not null or new.paid_by_id is not null or new.paid_at is not null
     or new.paid_on is not null or new.payment_reference is not null or new.cancelled_at is not null
     or new.advance_applied <> 0 or new.returned_amount <> 0 then
    raise exception 'expense_claims numbers and stamps cannot be set when a record is created: they are written only by transition_expense_claim and record_expense_advance_return'
      using errcode = 'P0001';
  end if;
  if new.kind = 'claim' and new.amount <> 0 then
    raise exception 'an expense claim''s amount is the sum of its lines: create the claim, then add lines'
      using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function public.assert_expense_claim_origination() from public, anon, authenticated;
create trigger expense_claims_origination_guard before insert on public.expense_claims
  for each row execute function public.assert_expense_claim_origination();

create trigger expense_claims_stamp_org_id before insert on public.expense_claims
  for each row execute function public.stamp_org_id();
create trigger expense_claims_zz_stamp_currency before insert on public.expense_claims
  for each row execute function public.stamp_currency();

create or replace function public.check_expense_claim_advance_link() returns trigger
  language plpgsql set search_path = public as $$
declare v_adv record;
begin
  if new.advance_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.advance_id is not distinct from old.advance_id then
    return new;
  end if;
  if new.kind is distinct from 'claim' then
    raise exception 'only a claim can be settled against an advance' using errcode = '23514';
  end if;
  -- Runs as the writer: a claimant can see only their own advances, so another person's is "not found".
  select a.kind, a.org_id, a.claimant_id, a.status into v_adv
    from public.expense_claims a where a.id = new.advance_id;
  if not found or v_adv.kind is distinct from 'advance' or v_adv.org_id is distinct from new.org_id
     or v_adv.claimant_id is distinct from new.claimant_id or v_adv.status is distinct from 'Paid' then
    raise exception 'a claim can be settled only against one of the claimant''s own paid advances'
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.check_expense_claim_advance_link() from public, anon, authenticated;
create trigger expense_claims_zz_zcheck_advance_link before insert or update of advance_id on public.expense_claims
  for each row execute function public.check_expense_claim_advance_link();

create or replace function public.assert_expense_claim_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.kind is distinct from old.kind
     or new.claimant_id is distinct from old.claimant_id or new.created_at is distinct from old.created_at
     or new.currency is distinct from old.currency then
    raise exception 'expense_claims identity columns (id, org_id, kind, claimant_id, created_at, currency) are immutable'
      using errcode = '42501';
  end if;
  if old.claim_number is not null and new.claim_number is distinct from old.claim_number then
    raise exception 'expense_claims.claim_number is minted once and never changes' using errcode = '42501';
  end if;
  new.updated_at := now();
  if public.actor_bypasses_rls() then
    return new;
  end if;
  if new.kind = 'claim' and new.amount is distinct from old.amount then
    raise exception 'an expense claim''s amount is the sum of its lines: add, change or remove a line instead'
      using errcode = '42501';
  end if;
  -- Defence in depth behind the RLS update policy (which already hides non-Draft rows): DD-EXP-10.
  if old.status not in ('Draft','Rejected') then
    raise exception 'this % is % and can no longer be changed: approval routing is decided on its content — reject it back to Draft or cancel it',
      old.kind, old.status using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.assert_expense_claim_update() from public, anon, authenticated;
create trigger expense_claims_assert_update before update on public.expense_claims
  for each row execute function public.assert_expense_claim_update();

-- Children inherit org from the parent claim (the 0028 idiom). Runs as the writer, so a claim the writer
-- cannot see leaves the seed default — and the child's RLS WITH CHECK then refuses it.
create or replace function public.stamp_expense_claim_child_org() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select c.org_id into new.org_id from public.expense_claims c where c.id = new.claim_id;
  end if;
  return new;
end; $$;
revoke all on function public.stamp_expense_claim_child_org() from public, anon, authenticated;
create trigger expense_claim_lines_stamp_org before insert on public.expense_claim_lines
  for each row execute function public.stamp_expense_claim_child_org();
create trigger expense_claim_files_stamp_org before insert on public.expense_claim_files
  for each row execute function public.stamp_expense_claim_child_org();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — a claim's amount is the sum of its lines (FR-EXP-004). DEFINER so the header write passes the
-- client-only refusal in §2; EXECUTE revoked so nothing calls it but the trigger.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.sync_expense_claim_amount() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_claim uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.expense_claims c
     set amount = coalesce((select sum(l.amount) from public.expense_claim_lines l where l.claim_id = v_claim), 0)
   where c.id = v_claim and c.kind = 'claim';
  return null;
end; $$;
revoke all on function public.sync_expense_claim_amount() from public, anon, authenticated;
create trigger expense_claim_lines_sync_amount after insert or update or delete on public.expense_claim_lines
  for each row execute function public.sync_expense_claim_amount();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — RLS and grants. FORCE everywhere; is_active_member() conjoined in every policy (0203 rule).
-- Visibility (DD-EXP-4): the claimant, or anyone holding approval rank. Writes: the claimant, Draft/Rejected.
-- No DELETE on claims (Cancelled is the soft delete) or receipts (archived_at). Column grants are the first
-- layer; the triggers in §2 are the second.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.expense_claims      enable row level security;
alter table public.expense_claims      force  row level security;
alter table public.expense_claim_lines enable row level security;
alter table public.expense_claim_lines force  row level security;
alter table public.expense_claim_files enable row level security;
alter table public.expense_claim_files force  row level security;

create policy expense_claims_select on public.expense_claims for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and (claimant_id = auth.uid() or public.holds_spend_approval_authority(public.auth_role())));
create policy expense_claims_insert on public.expense_claims for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and claimant_id = auth.uid()
              and (project_id is null or exists (select 1 from public.projects p
                                                  where p.id = expense_claims.project_id and p.org_id = public.auth_org_id())));
create policy expense_claims_update on public.expense_claims for update
  using (org_id = public.auth_org_id() and public.is_active_member() and claimant_id = auth.uid()
         and status in ('Draft','Rejected'))
  with check (org_id = public.auth_org_id() and public.is_active_member() and claimant_id = auth.uid()
              and status in ('Draft','Rejected')
              and (project_id is null or exists (select 1 from public.projects p
                                                  where p.id = expense_claims.project_id and p.org_id = public.auth_org_id())));
revoke all on public.expense_claims from anon, authenticated;
grant select on public.expense_claims to authenticated;
grant insert (id, kind, title, purpose, project_id, budget_category, amount, advance_id) on public.expense_claims to authenticated;
grant update (title, purpose, project_id, budget_category, amount, advance_id) on public.expense_claims to authenticated;

create policy expense_claim_lines_select on public.expense_claim_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_claim_lines.claim_id));
create policy expense_claim_lines_write on public.expense_claim_lines for all
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_lines.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.kind = 'claim' and c.status in ('Draft','Rejected')))
  with check (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_lines.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.kind = 'claim' and c.status in ('Draft','Rejected')));
revoke all on public.expense_claim_lines from anon, authenticated;
grant select, delete on public.expense_claim_lines to authenticated;
grant insert (id, claim_id, expense_date, expense_type, description, amount) on public.expense_claim_lines to authenticated;
grant update (expense_date, expense_type, description, amount) on public.expense_claim_lines to authenticated;

create policy expense_claim_files_select on public.expense_claim_files for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c where c.id = expense_claim_files.claim_id));
create policy expense_claim_files_write on public.expense_claim_files for all
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_files.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')))
  with check (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.expense_claims c
                      where c.id = expense_claim_files.claim_id and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')));
revoke all on public.expense_claim_files from anon, authenticated;
grant select on public.expense_claim_files to authenticated;
grant insert (id, claim_id, title, file_path) on public.expense_claim_files to authenticated;
grant update (title, archived_at) on public.expense_claim_files to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — receipts bucket (private, 5 MB) at {org}/{claim}/{file}/{filename}. Read follows claim visibility (the
-- subquery runs under the caller's RLS); write = the claimant while Draft/Rejected (0028 pattern).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('expense-receipts', 'expense-receipts', false, 5242880,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

create policy storage_objects_expense_receipt_read on storage.objects for select
  using (bucket_id = 'expense-receipts' and auth.uid() is not null
         and split_part(name, '/', 1) = public.auth_org_id()::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.expense_claims c where c.id::text = split_part(name, '/', 2)));
create policy storage_objects_expense_receipt_write on storage.objects for all
  using (bucket_id = 'expense-receipts' and auth.uid() is not null
         and split_part(name, '/', 1) = public.auth_org_id()::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.expense_claims c
                      where c.id::text = split_part(name, '/', 2) and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')))
  with check (bucket_id = 'expense-receipts' and auth.uid() is not null
         and split_part(name, '/', 1) = public.auth_org_id()::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.expense_claims c
                      where c.id::text = split_part(name, '/', 2) and c.org_id = public.auth_org_id()
                        and c.claimant_id = auth.uid() and c.status in ('Draft','Rejected')));
```

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_schema_rls.test.sql supabase/tests/0131_org_stamp_trigger.test.sql supabase/tests/0215_org_checks_after_stamp.test.sql supabase/tests/dead_authenticated_write_grants.test.sql supabase/tests/0002_tenant_isolation.test.sql'`
→ all `ok`; 23/23 in the new file.

### Task 3 — RED: lifecycle and SoD (AC-EXP-010…016)

Create `supabase/tests/expense_claims_transition.test.sql`:

```sql
-- expense_claims_transition.test.sql — #775 status machine, numbering and the separations of duty
-- (AC-EXP-010..016). No spend_approvers rows here, so routing is `flat` (the OD-PROC-1 rank floor).
begin;
select plan(24);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02472000-0000-0000-0000-00000000000a','EXP Txn Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02472000-0000-0000-0000-0000000000a1','exp-t-e1@example.com'),
  ('02472000-0000-0000-0000-0000000000a2','exp-t-e2@example.com'),
  ('02472000-0000-0000-0000-0000000000a3','exp-t-pm@example.com'),
  ('02472000-0000-0000-0000-0000000000a4','exp-t-f1@example.com'),
  ('02472000-0000-0000-0000-0000000000a5','exp-t-f2@example.com'),
  ('02472000-0000-0000-0000-0000000000a6','exp-t-ad@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02472000-0000-0000-0000-0000000000a1','02472000-0000-0000-0000-00000000000a','T Eng One','exp-t-e1@example.com','Engineer','active'),
  ('02472000-0000-0000-0000-0000000000a2','02472000-0000-0000-0000-00000000000a','T Eng Two','exp-t-e2@example.com','Engineer','active'),
  ('02472000-0000-0000-0000-0000000000a3','02472000-0000-0000-0000-00000000000a','T PM','exp-t-pm@example.com','Project Manager','active'),
  ('02472000-0000-0000-0000-0000000000a4','02472000-0000-0000-0000-00000000000a','T Fin One','exp-t-f1@example.com','Finance','active'),
  ('02472000-0000-0000-0000-0000000000a5','02472000-0000-0000-0000-00000000000a','T Fin Two','exp-t-f2@example.com','Finance','active'),
  ('02472000-0000-0000-0000-0000000000a6','02472000-0000-0000-0000-00000000000a','T Admin','exp-t-ad@example.com','Admin','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id) values
  ('02472000-0000-0000-0000-000000000701','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T1 draft claim',0,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000702','02472000-0000-0000-0000-00000000000a','advance','02472000-0000-0000-0000-0000000000a1','T2 draft advance',500,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000703','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T3 empty claim',0,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000704','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a6','T4 admin own',100,'Submitted','EXP-2610010004',null),
  ('02472000-0000-0000-0000-000000000705','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T5 submitted',200,'Submitted','EXP-2610010005',null),
  ('02472000-0000-0000-0000-000000000706','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T6 approved by F1',150,'Approved','EXP-2610010006','02472000-0000-0000-0000-0000000000a4'),
  ('02472000-0000-0000-0000-000000000707','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a5','T7 F2 own',80,'Approved','EXP-2610010007','02472000-0000-0000-0000-0000000000a6'),
  ('02472000-0000-0000-0000-000000000708','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T8 rejected',0,'Rejected','EXP-2610010008',null),
  ('02472000-0000-0000-0000-000000000709','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T9 submitted',60,'Submitted','EXP-2610010009',null),
  ('02472000-0000-0000-0000-000000000710','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T10 approved by PM',70,'Approved','EXP-2610010010','02472000-0000-0000-0000-0000000000a3'),
  ('02472000-0000-0000-0000-000000000711','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T11 submitted',50,'Submitted','EXP-2610010011',null);
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02472000-0000-0000-0000-000000000701','2026-10-01','Travel','Bus',120),
  ('02472000-0000-0000-0000-000000000708','2026-10-01','Meals','Dinner',90);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000701','Submitted') $$,
  'AC-EXP-010: the claimant submits a claim that has a line');
select ok((select claim_number ~ '^EXP-\d{10}$' and status = 'Submitted' and submitted_at is not null
             from expense_claims where id = '02472000-0000-0000-0000-000000000701'),
  'AC-EXP-010: submission mints an EXP number and stamps submitted_at');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000702','Submitted') $$,
  'AC-EXP-010: the claimant submits an advance');
select ok((select claim_number ~ '^ADV-\d{10}$' from expense_claims where id = '02472000-0000-0000-0000-000000000702'),
  'AC-EXP-010: an advance gets an ADV number');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000703','Submitted') $$,
  'P0001', 'an expense claim needs at least one line before it can be submitted',
  'AC-EXP-010: a claim with no lines cannot be submitted');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000703','Submitted') $$,
  '42501', 'only the claimant can submit this expense claim', 'AC-EXP-010: only the claimant submits');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000704','Approved') $$,
  '42501', 'separation of duties: a claimant cannot approve or reject their own expense claim',
  'AC-EXP-011: an Admin cannot approve their own claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Approved') $$,
  '42501', 'not authorized for transition Submitted -> Approved', 'AC-EXP-012: an Engineer cannot approve');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Approved') $$,
  'AC-EXP-012: a Project Manager approves when no approvers are configured');
select is((select approved_by_id from expense_claims where id = '02472000-0000-0000-0000-000000000705'),
  '02472000-0000-0000-0000-0000000000a3'::uuid, 'AC-EXP-012: the approver is stamped');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000706','Paid') $$,
  '42501', 'not authorized for transition Approved -> Paid', 'AC-EXP-013: a Project Manager cannot pay');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000706','Paid') $$,
  '42501', 'separation of duties: the approver cannot also pay this expense claim', 'AC-EXP-013: the approver cannot pay');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000707','Paid') $$,
  '42501', 'separation of duties: a claimant cannot pay their own expense claim',
  'AC-EXP-013: Finance cannot pay their own claim');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000706','Paid', null, 'TRF-9') $$,
  'AC-EXP-013: another Finance member pays it with a reference');
select is((select paid_by_id::text || '|' || payment_reference || '|' || paid_on::text
             from expense_claims where id = '02472000-0000-0000-0000-000000000706'),
  '02472000-0000-0000-0000-0000000000a5|TRF-9|' || ((now() at time zone 'Asia/Jakarta')::date)::text,
  'AC-EXP-013: payer, reference and the org-timezone paid date are stamped');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000708','Draft') $$,
  '42501', 'only the claimant can send a rejected expense claim back to Draft',
  'AC-EXP-014: only the claimant reopens a rejected claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000708','Draft') $$,
  'AC-EXP-014: the claimant reopens it');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000708','Submitted') $$,
  'AC-EXP-014: and resubmits it');
select is((select claim_number from expense_claims where id = '02472000-0000-0000-0000-000000000708'),
  'EXP-2610010008', 'AC-EXP-014: the number is minted once');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000709','Cancelled') $$,
  'AC-EXP-015: the claimant cancels a submitted claim');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000710','Cancelled') $$,
  '42501', 'not authorized for transition Approved -> Cancelled',
  'AC-EXP-015: the claimant cannot cancel an approved claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000710','Cancelled') $$,
  'AC-EXP-015: Finance cancels an approved claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000711','Approved', null, 'TRF-1') $$,
  'P0001', 'a payment reference belongs only to the payment step',
  'AC-EXP-016: a payment reference on an approval is refused');
reset role;

select ok(exists (select 1 from audit_events
                   where action = 'expense_claim.transition'
                     and entity_id = '02472000-0000-0000-0000-000000000705'
                     and detail->>'to' = 'Approved'),
  'AC-EXP-012: the approval is on the audit trail');

select * from finish();
rollback;
```

**Verify (RED):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_transition.test.sql'`
→ fails: `function transition_expense_claim(unknown, unknown) does not exist` (the stated reason: the RPC is new).

### Task 4 — GREEN: §6 `expense_advance_outstanding`, §7 `transition_expense_claim` (flat matrix only)

Append to `supabase/migrations/0247_expense_claims.sql`. The `Approved/Rejected` branch is the flat rank floor only;
Task 6 replaces exactly that branch with the routing block (so Task 5's tests go RED for the right reason first).

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — outstanding on an advance (DD-EXP-6): amount − returned − Σ applied by PAID claims. Derived, never
-- stored. SECURITY INVOKER: under the UI it sees what the caller sees (a claimant sees all claims on their own
-- advance; approval rank sees all); under §7/§9 (definers) it sees everything.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.expense_advance_outstanding(p_id uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select a.amount - a.returned_amount
         - coalesce((select sum(c.advance_applied) from public.expense_claims c
                      where c.advance_id = a.id and c.status = 'Paid'), 0)
    from public.expense_claims a
   where a.id = p_id and a.kind = 'advance'
$$;
revoke all on function public.expense_advance_outstanding(uuid) from public, anon;
grant execute on function public.expense_advance_outstanding(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — transition_expense_claim: the single authority for every status move, the number mint, the SoD and
-- settlement. Order is load-bearing: active member → load (row lock) → org → legality → stray-reference
-- refusal → SoD (outside any Admin skip, DD-EXP-3) → per-move rules → one UPDATE → audit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_expense_claim(
  p_id                uuid,
  p_to                public.expense_claim_status,
  p_notes             text default null,
  p_payment_reference text default null
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_row      public.expense_claims%rowtype;
  v_uid      uuid      := auth.uid();
  v_role     user_role := auth_role();
  v_is_admin boolean;
  v_route    record;
  v_lines    int;
  v_adv      public.expense_claims%rowtype;
  v_applied  numeric   := 0;
  v_today    date;
  v_legal    jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted','Cancelled'),
    'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',  jsonb_build_array('Paid','Cancelled'),
    'Rejected',  jsonb_build_array('Draft'),
    'Paid',      jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense claim not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (v_legal -> v_row.status::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_row.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;

  -- SoD (DD-EXP-3), for every actor including an Admin (the OD-PROC-8 shape).
  if v_row.status = 'Submitted' and p_to in ('Approved','Rejected') and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot approve or reject their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot pay their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.approved_by_id then
    raise exception 'separation of duties: the approver cannot also pay this expense claim' using errcode = '42501';
  end if;

  if p_to = 'Submitted' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can submit this expense claim' using errcode = '42501';
    end if;
    if v_row.kind = 'claim' then
      select count(*) into v_lines from public.expense_claim_lines l where l.claim_id = p_id;
      if v_lines = 0 then
        raise exception 'an expense claim needs at least one line before it can be submitted' using errcode = 'P0001';
      end if;
    end if;
    if not (v_row.amount > 0) then
      raise exception 'the amount must be greater than zero before submitting' using errcode = 'P0001';
    end if;
  elsif v_row.status = 'Rejected' and p_to = 'Draft' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can send a rejected expense claim back to Draft' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not ((v_row.status in ('Draft','Submitted') and v_uid = v_row.claimant_id) or v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- APPROVE-BRANCH (Task 6 replaces this branch body with the routing block).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
  elsif p_to = 'Paid' then
    if not (v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    if v_row.advance_id is not null then
      -- Lock order is always claim → advance; record_expense_advance_return locks only the advance.
      select * into v_adv from public.expense_claims where id = v_row.advance_id for update;
      if v_adv.status is distinct from 'Paid' or v_adv.claimant_id is distinct from v_row.claimant_id then
        raise exception 'the linked advance is not a paid advance of this claimant' using errcode = 'P0001';
      end if;
      v_applied := least(v_row.amount, greatest(public.expense_advance_outstanding(v_row.advance_id), 0));
    end if;
  end if;

  update public.expense_claims set
    status            = p_to,
    claim_number      = case when p_to = 'Submitted'
                             then coalesce(claim_number, public.next_procurement_doc_number(org_id,
                                    case kind when 'advance' then 'ADV' else 'EXP' end))
                             else claim_number end,
    submitted_at      = case when p_to = 'Submitted' then now() else submitted_at end,
    approved_by_id    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by_id end,
    approved_at       = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    approval_notes    = case when p_to = 'Approved' then p_notes else approval_notes end,
    rejection_notes   = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    paid_by_id        = case when p_to = 'Paid' then v_uid else paid_by_id end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then v_today else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    advance_applied   = case when p_to = 'Paid' then v_applied else advance_applied end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;

  perform public.log_audit('expense_claim.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status::text, 'to', p_to::text, 'notes', p_notes, 'advance_applied', v_applied));
end; $$;
revoke all on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) from public, anon;
grant execute on function public.transition_expense_claim(uuid, public.expense_claim_status, text, text) to authenticated;
```

**Verify (GREEN):** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/expense_claims_transition.test.sql supabase/tests/expense_claims_schema_rls.test.sql'`
→ 24/24 and 23/23.

**Continue with `docs/plans/2026-10-06-expense-claims.part2-db.md`.**
