# Plan — Customer invoices and receipts without an ERP (#784)

> Spec: `docs/specs/no-erp-revenue.spec.md` (FR-NAR-001..013, NFR-NAR-001..006, AC-NAR-001..007, DD-NAR-1..15).
> ADR: `docs/adr/0055-external-system-adapters-sot-enhancement.md` § Addendum 2026-10-07.
> Lane: **money path + SoD → Director-dispatched, not the factory.** Migration slot: **0270** only.
> Worktree: `/Users/ariefsaid/Coding/PMO/.claude/worktrees/784` (branch `feat/784-no-erp-invoicing`). Every command
> below runs from that root unless it starts with `(cd pmo-portal && …)`.

## 0. Design (brainstorm, one decision at a time)

**Q1 — Where do PMO invoices live?** Options: (a) new `pmo_sales_invoices` tables; (b) the existing
`sales_invoices` / `incoming_payments` with a marker. **(b).** Every reader — the two lists, revenue by project, the
management pack, 0262's work-order billing views, the assistant's overdue tool — already reads these tables by
`status` and `erp_outstanding_amount`. (a) would double every reader. Marker: `pmo_native boolean`, never
client-writable (DD-NAR-2).

**Q2 — Who writes?** Four SECURITY DEFINER RPCs (create, transition, record receipt, cancel receipt), each re-asserting
active membership, org, the Admin/Finance role (read from `profiles` now — current standing) and "no ERP owns
revenue". Mirrors `transition_procurement` (0243) / `transition_expense_claim` (0247): lock → org → legality → SoD →
role → one update → audit. The author set (0132) is written by the create RPC so the approval SoD reads the same oracle
as `submit_sales_invoice` (DD-NAR-5).

**Q3 — Paid-ness: view or stamp?** Stamp, from a derivation (DD-NAR-4). The receipt RPCs hold the invoice row lock,
recompute `gross − Σ live PMO receipts`, write it to `erp_outstanding_amount` and set `Paid` at zero. A view would
leave ≥8 readers keyed on the stored columns reading the wrong thing. No new status value (DD-NAR-3) so 0262's
`(status in ('Submitted','Unpaid','Paid'))` and `REVENUE_STATUSES` stay correct; "Partly paid" is a UI derivation.

**Q4 — Lines and tax.** Lines stored as `native_lines jsonb` (DD-NAR-8); total = Σ round(qty×rate,2) — the same rule
0262 uses for in-flight ERP commands, so a PMO invoice and an ERP one bill a work order identically. Tax: lines are
pre-tax (`exclusive`); the project's VAT flag + recorded rate + base decide (DD-NAR-7); the existing 0227 trigger
computes `tax_amount` from `tax_rate` on insert, so no tax arithmetic is duplicated.

**Q5 — Composition with #785 (0262).** 0262's `sales_invoices` trigger fires for every JWT writer that is not the
service role, so a PMO invoice naming a work order is fenced against the work order's remaining value with no 0262 edit.
Lock order DD-BWO-5 (billing lock → project row) is honoured by calling `lock_work_order_billing` first. Drafts count as
"pending" in 0262 — which is why a wrong draft must be cancellable (DD-NAR-10) and why the ERP cannot take revenue over
while a PMO draft is open (DD-NAR-11). **Hard dependency: 0262 must be on `dev` before this branch builds (Task 0).**
If #785 is abandoned, see Appendix A.

**Q6 — Connect (AC-NAR-004).** The built crossing for revenue is the flip. Every native RPC refuses while an ERP owns
revenue; the mirror guards (paired edit, DD-WO-4 rule) pin the new columns; the employ guard refuses the flip while a
PMO draft is open; the FE never dispatches a `pmo_native` row (DD-NAR-11).

**Q7 — Owner ruling: revenue writes are Admin and Finance only (DD-NAR-15).** The deciding artifacts, read at head:
the write policies on both tables are last defined by `0128_sales_ar_active_member_and_inflight_link_guard.sql`
(no later `create policy` on either table — `grep -n "policy.*on.*\(sales_invoices\|incoming_payments\)"
supabase/migrations/*.sql`); the grants are last set by 0176/0177/0178/0187/0188/0193/0227 (column-limited INSERT;
no UPDATE or DELETE grant to `authenticated`). Migration §8 re-creates the six write policies with the role set
`('Admin','Finance')`, predicates otherwise verbatim; §9 asserts the result on the database. Service-role mirror
writers and SECURITY DEFINER RPCs bypass RLS by design and keep working; each RPC enforces the same role set itself.

**Q8 — UI.** Reuse, don't fork: the Sales Invoices form becomes mode-aware (project required, description shown); the
Incoming Payments form requires an invoice in PMO mode; a new `SalesInvoiceApprovalSection` on `/approvals` follows
`ExpenseClaimApprovalSection`. Mode = `routeDomainWrite('revenue')` — the same fail-closed cache the repository routes
by, so a surface and its write path cannot disagree (`useRevenueMode`).

**Scaling.** Approvals reads only PMO drafts (partial index `sales_invoices_native_draft_idx`); balance recomputation
reads one invoice's receipts (existing `incoming_payments_org_si_idx`); lists stay paged.

## 1. File map

| File | Change |
|---|---|
| `supabase/migrations/0270_native_revenue.sql` | new (§1–§9, built across Tasks 2/4/7/10/13/15) |
| `supabase/migrations/rollback/0270_native_revenue_down.sql` | new (Task 16) |
| `supabase/tests/0270_native_revenue_create.test.sql` | new (Task 1) |
| `supabase/tests/0270_native_revenue_approve.test.sql` | new (Task 3) |
| `supabase/tests/0270_native_revenue_receipts.test.sql` | new (Task 6) |
| `supabase/tests/0270_native_revenue_crossing.test.sql` | new (Task 9) |
| `supabase/tests/0270_revenue_write_roles.test.sql` | new (Task 12) |
| `supabase/tests/0270_native_revenue_acl.test.sql` | new (Task 15) |
| `supabase/tests/0178_anon_executable_definers.test.sql` | +4 names, count 59 → 63 (Task 15) |
| `pmo-portal/src/lib/supabase/database.types.ts`, `scripts/isolation-probe-denominator.json` | regenerated (Task 17) |
| `pmo-portal/src/lib/revenue/nativeInvoice.ts` (+ test) | new (Task 19) |
| `pmo-portal/src/lib/db/revenueNative.ts` (+ test) | new (Task 20) |
| `pmo-portal/src/lib/db/revenue.ts` (+ `revenue.listFilters.test.ts`) | row fields + list filters (Task 21) |
| `pmo-portal/src/hooks/useRevenueMode.ts` (+ test) | new (Task 22) |
| `pmo-portal/src/lib/repositories/revenue.native.test.ts` | new (Task 23) |
| `pmo-portal/src/lib/repositories/revenue.external.test.ts` | retire the superseded cold-map block (Task 23) |
| `pmo-portal/src/lib/repositories/index.ts`, `types.ts` | native branches (Task 24) |
| `pmo-portal/src/hooks/useRevenue.ts` | `useNativeDraftInvoices` (Task 25) |
| `pmo-portal/public/locales/{en,id}/common.json`, `pmo-portal/src/lib/i18n/launch-scope-routes.txt` | keys + route (Task 26) |
| `pmo-portal/pages/SalesInvoices.tsx` (+ `__tests__/SalesInvoices.native.test.tsx`, `SalesInvoices.createForm.test.tsx`) | Tasks 27–28 |
| `pmo-portal/pages/approvals/SalesInvoiceApprovalSection.tsx` (+ test), `pages/Approvals.tsx`, 4 Approvals tests | Tasks 29–30 |
| `pmo-portal/pages/IncomingPayments.tsx` (+ `__tests__/IncomingPayments.native.test.tsx`, `IncomingPayments.createForm.test.tsx`) | Tasks 31–32 |
| `pmo-portal/e2e/AC-NAR-003-no-erp-billing.spec.ts` | new (Task 33) |

## 2. Traceability (owning test per AC)

| AC | Owning test | Task |
|---|---|---|
| AC-NAR-001 | `supabase/tests/0270_native_revenue_create.test.sql` | 1–2 |
| AC-NAR-002 | `supabase/tests/0270_native_revenue_approve.test.sql` | 3–5 |
| AC-NAR-003 | `pmo-portal/e2e/AC-NAR-003-no-erp-billing.spec.ts` | 33 (DB contract: Tasks 6–8) |
| AC-NAR-004 | `supabase/tests/0270_native_revenue_crossing.test.sql` | 9–11 (FE never-dispatch: Task 23) |
| AC-NAR-005 | `supabase/tests/0270_native_revenue_approve.test.sql` | 3–4 |
| AC-NAR-006 | `supabase/tests/0270_native_revenue_receipts.test.sql` | 6–7 |
| AC-NAR-007 | `supabase/tests/0270_revenue_write_roles.test.sql` | 12–14 |
| NFR-NAR-001 | `supabase/tests/0270_native_revenue_acl.test.sql` | 15 |

Gate commands used below:
- **DB:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` (reset and test in ONE lock hold).
- **Unit:** `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run <files>)`.

---

## Task 0 — Preconditions (2 min, no code)

```bash
test -f supabase/migrations/0262_billing_by_work_order.sql && echo "0262 present" || echo "STOP: rebase onto dev after #785 merges"
ls supabase/migrations/0270_* 2>/dev/null && echo "STOP: slot 0270 taken" || echo "0270 free"
grep -n "workOrderId?: string | null" pmo-portal/src/lib/repositories/types.ts || echo "STOP: #785 FE not on this base"
grep -c "^  ('" supabase/tests/0178_anon_executable_definers.test.sql
```
**Verify:** the first three lines print `0262 present`, `0270 free` and a `types.ts` match; the last prints the current
allow-list length (59 unless #775 phase B landed — then use that number + 4 in Task 15). On any `STOP`, do not start.

---

## Task 1 — RED: pgTAP for raising an invoice (AC-NAR-001) (5 min)

**File:** `supabase/tests/0270_native_revenue_create.test.sql`

```sql
-- 0270_native_revenue_create.test.sql — #784 AC-NAR-001: with no ERP owning revenue, a Finance user raises a customer
-- invoice; it saves as Draft with its tax treatment, tax and currency, its author recorded, and lists for the org only.
-- Migration under test: 0270_native_revenue.sql §1–§3 (and 0262's work-order fence, DD-BWO-4).
begin;
create extension if not exists pgtap;
select plan(23);

insert into organizations (id, name) values
  ('02700000-0000-0000-0000-000000000001', 'NAR Org'),
  ('02700000-0000-0000-0000-000000000002', 'NAR Other Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02700000-0000-0000-0000-0000000000a3', 'nar-admin@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com'),
  ('02700000-0000-0000-0000-0000000000a5', 'nar-off@example.com'),
  ('02700000-0000-0000-0000-0000000000b1', 'nar-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a3', '02700000-0000-0000-0000-000000000001', 'NAR Admin', 'nar-admin@example.com', 'Admin', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active'),
  ('02700000-0000-0000-0000-0000000000a5', '02700000-0000-0000-0000-000000000001', 'NAR Off', 'nar-off@example.com', 'Finance', 'disabled'),
  ('02700000-0000-0000-0000-0000000000b1', '02700000-0000-0000-0000-000000000002', 'NAR XOrg', 'nar-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client'),
  ('02700000-0000-0000-0000-0000000000c9', '02700000-0000-0000-0000-000000000002', 'NAR X Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1'),
  ('02700000-0000-0000-0000-0000000000d2', '02700000-0000-0000-0000-000000000001', 'NAR no-VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, false, null, '02700000-0000-0000-0000-0000000000c1'),
  ('02700000-0000-0000-0000-0000000000d3', '02700000-0000-0000-0000-000000000001', 'NAR VAT no-rate project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, true, null, '02700000-0000-0000-0000-0000000000c1'),
  ('02700000-0000-0000-0000-0000000000d9', '02700000-0000-0000-0000-000000000002', 'NAR X project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, true, null, '02700000-0000-0000-0000-0000000000c9');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency, client_po_number) values
  ('02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', 'NAR WO', 'Issued', 'WO-NAR-1', 2000000, 'exclusive', 0, 'IDR', 'PO-NAR-777');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"Site survey","qty":2,"rate":500000}]'::jsonb) $$,
  'AC-NAR-001 a Finance user raises an invoice for a project and a client');                                        -- 1
select is(
  (select row(status, pmo_native, tax_treatment, tax_rate, tax_base_numerator, tax_base_denominator, tax_amount, amount, currency)::text
     from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'),
  row('Draft', true, 'exclusive', 12.000::numeric(6,3), 11, 12, 110000.00::numeric(14,2), 1000000.00::numeric(14,2), 'IDR')::text,
  'AC-NAR-001 it is a Draft of 1,000,000 excl. PPN at the project''s 12% on 11/12 (tax 110,000) in the project''s currency'); -- 2
select is(
  (select row(si_number, pmo_number, invoice_date, erp_outstanding_amount, reference_number, author_user_id)::text
     from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'),
  row(null::text, null::text, null::date, null::numeric(14,2), 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000a1'::uuid)::text,
  'AC-NAR-001 a Draft has no number, date or balance yet; its reference is the project''s contract reference; the author is the caller'); -- 3
select is(
  (select array_agg(a.user_id)::text from public.sales_invoice_authors a
     join public.sales_invoices si on si.id = a.sales_invoice_id
    where si.native_lines @> '[{"description":"Site survey"}]'),
  '{02700000-0000-0000-0000-0000000000a1}',
  'AC-NAR-001 the author set — the approval SoD oracle (0132) — records the creator');                              -- 4
select is(
  (select native_lines from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'),
  '[{"item_code":"SVC","description":"Site survey","qty":2,"rate":500000,"amount":1000000.00}]'::jsonb,
  'AC-NAR-001 the lines are kept as raised, each with its amount');                                                  -- 5
select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d2', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"No VAT work","qty":1,"rate":250000}]'::jsonb) $$,
  'AC-NAR-001 an invoice on a project not subject to VAT is accepted');                                             -- 6
select is(
  (select row(tax_rate, tax_amount)::text from public.sales_invoices where native_lines @> '[{"description":"No VAT work"}]'),
  row(0.000::numeric(6,3), 0.00::numeric(14,2))::text,
  'AC-NAR-001 a project not subject to VAT carries no tax (OD-TAX-4)');                                             -- 7
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d3', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  'P0001', 'this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing',
  'AC-NAR-001 a VAT project with no recorded rate is refused, never invoiced untaxed (DD-TAX-4a)');                 -- 8
select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"WO billing","qty":1,"rate":1000000}]'::jsonb, '02700000-0000-0000-0000-0000000000e1') $$,
  'AC-NAR-001 an invoice may name an issued work order on its project');                                           -- 9
select is(
  (select row(work_order_id, reference_number, currency)::text from public.sales_invoices where native_lines @> '[{"description":"WO billing"}]'),
  row('02700000-0000-0000-0000-0000000000e1'::uuid, 'PO-NAR-777', 'IDR')::text,
  'AC-NAR-001 a work-order invoice takes the client PO and the currency from the work order (DD-BWO-8)');            -- 10
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","description":"Over WO","qty":1,"rate":1000000.01}]'::jsonb, '02700000-0000-0000-0000-0000000000e1') $$,
  'BW001', 'this invoice would bill 1000000.01 against work order WO-NAR-1 (worth 2000000.00 excl. tax, with 1000000.00 already invoiced or in draft): only 1000000.00 is still to invoice',
  'AC-NAR-001 a PMO invoice cannot bill past its work order (0262, DD-BWO-4)');                                     -- 11
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d9', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  'P0002', 'project not found', 'AC-NAR-001 another org''s project is refused');                                     -- 12
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c9',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  'P0002', 'customer not found', 'AC-NAR-001 another org''s customer is refused');                                   -- 13
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[]'::jsonb) $$,
  '23514', 'an invoice needs between 1 and 100 lines', 'AC-NAR-001 an invoice with no lines is refused');           -- 14
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1.0001,"rate":100}]'::jsonb) $$,
  '23514', 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals',
  'AC-NAR-001 a quantity with more than 3 decimals is refused');                                                    -- 15
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":"100"}]'::jsonb) $$,
  '23514', 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals',
  'AC-NAR-001 a rate that is not a JSON number is refused, never coerced');                                          -- 16
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"qty":1,"rate":100}]'::jsonb) $$,
  '23514', 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals',
  'AC-NAR-001 a line with neither item code nor description is refused');                                          -- 17
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":0}]'::jsonb) $$,
  '23514', 'the invoice total must be above zero', 'AC-NAR-001 a zero-total invoice is refused');                     -- 18
select throws_ok($$ insert into public.sales_invoices (project_id, customer_id, amount, tax_treatment, tax_amount, pmo_native)
  values ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 100, 'exclusive', 0, true) $$,
  '42501', null, 'AC-NAR-001 no client marks a row as a PMO invoice except through the RPC (pmo_native is not granted)'); -- 19

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-001 a Project Manager cannot raise an invoice'); -- 20
select is((select count(*)::int from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'), 1,
  'AC-NAR-001 the Draft lists for the org — any active member reads it');                                          -- 21

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1',
  '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-NAR-001 an offboarded Finance member cannot raise an invoice');                                                -- 22

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.sales_invoices where native_lines @> '[{"description":"Site survey"}]'), 0,
  'AC-NAR-001 another org cannot see the invoice');                                                                  -- 23

select * from finish();
rollback;
```

**Verify (RED):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_create.test.sql'`
→ fails with `function public.create_native_sales_invoice(...) does not exist`.

---

## Task 2 — GREEN: migration header, §1 schema, §2 helper, §3 create RPC (5 min)

**File (new):** `supabase/migrations/0270_native_revenue.sql`

```sql
-- 0270_native_revenue.sql — #784 (OD-REEL-1): customer invoices and receipts for an org whose revenue no ERP owns.
-- Spec: docs/specs/no-erp-revenue.spec.md (FR-NAR-*, AC-NAR-001..007). ADR: ADR-0055 addendum 2026-10-07.
-- Plan: docs/plans/2026-10-07-no-erp-revenue.md. Rollback: supabase/migrations/rollback/0270_native_revenue_down.sql.
--
-- Shape (DD-NAR-1..15): no new table. A PMO invoice / receipt is a row of sales_invoices / incoming_payments with
-- pmo_native = true, written ONLY by four SECURITY DEFINER RPCs:
--   create_native_sales_invoice     Draft, lines, tax from the project (OD-TAX-4), author recorded (0132's SoD oracle)
--   transition_native_sales_invoice Draft → Unpaid (approve: approver not in the author set, current Admin/Finance)
--                                   | Draft or unsettled Unpaid → Cancelled
--   record_native_receipt           settles part or all; recomputes the balance from live receipts; Paid at zero
--   cancel_native_receipt           reverses a receipt; recomputes the balance
-- The balance lives in erp_outstanding_amount — the one paid-detection oracle every reader already uses (DD-WO-3) —
-- recomputed (never incremented) under the invoice row lock. Every write is refused while an ERP owns revenue, and the
-- ERP cannot take revenue over while a PMO draft is open (§7). Revenue writes are Admin and Finance only (owner ruling):
-- the RPCs check it in their bodies and §8 states the same rule in the tables' write policies.
-- ⚑ Depends on 0262 (#785): create calls lock_work_order_billing (DD-BWO-5 lock order), and 0262's sales_invoices trigger
--   fences a work-order invoice against what is left on the work order.
-- ⚑ Hosted Supabase grants EXECUTE on new public functions to anon/authenticated (0185/0210): every function below
--   revokes what it must not expose and §9 asserts the result on the database itself.
-- ⚑ 0178's client-callable allow-list grows by the four RPCs: supabase/tests/0178_anon_executable_definers.test.sql.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the native marker, number, lines and stamps (DD-NAR-2, -8, -9). Not client-insertable: the INSERT grants on
-- both tables are column lists (0176/0178) and nothing here is added to them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.sales_invoices
  add column pmo_native     boolean not null default false,
  add column pmo_number     text,
  add column native_lines   jsonb,
  add column approved_by_id uuid references auth.users(id),
  add column approved_at    timestamptz,
  add constraint sales_invoices_pmo_native_shape check (
    not pmo_native
    or (si_number is null and erp_docstatus is null and coalesce(jsonb_typeof(native_lines) = 'array', false)));

comment on column public.sales_invoices.pmo_native is
  '#784 DD-NAR-2: true for an invoice raised in PMO (create_native_sales_invoice) while no ERP owned revenue; never an ERP mirror row.';
comment on column public.sales_invoices.pmo_number is
  '#784 DD-NAR-9: PMO''s own invoice number (INV-YYMMDDnnnn), minted when the invoice is approved. ERP invoices keep their number in si_number.';
comment on column public.sales_invoices.native_lines is
  '#784 DD-NAR-8: the lines of a PMO invoice as raised — [{item_code, description, qty, rate, amount}]; amount = round(qty × rate, 2). Fixed at creation.';
comment on column public.sales_invoices.approved_by_id is
  '#784 FR-NAR-005: who approved a PMO invoice (never one of its authors).';

create unique index sales_invoices_org_pmo_number_uidx
  on public.sales_invoices (org_id, pmo_number) where pmo_number is not null;
create index sales_invoices_native_draft_idx
  on public.sales_invoices (org_id) where pmo_native and status = 'Draft';

alter table public.incoming_payments
  add column pmo_native   boolean not null default false,
  add column pmo_number   text,
  add column cancelled_at timestamptz,
  add constraint incoming_payments_pmo_native_shape check (
    not pmo_native or (ip_number is null and erp_docstatus is null and sales_invoice_id is not null));

comment on column public.incoming_payments.pmo_native is
  '#784 DD-NAR-2: true for a receipt recorded in PMO against a PMO invoice; never an ERP mirror row.';
comment on column public.incoming_payments.pmo_number is
  '#784 DD-NAR-9: PMO''s own receipt number (RCV-YYMMDDnnnn).';
comment on column public.incoming_payments.cancelled_at is
  '#784 DD-NAR-10: set when a PMO receipt is cancelled; a cancelled receipt no longer settles its invoice.';

create unique index incoming_payments_org_pmo_number_uidx
  on public.incoming_payments (org_id, pmo_number) where pmo_number is not null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — what the live PMO receipts have settled on one invoice. INVOKER, no client EXECUTE: called only from the §4/§5
-- SECURITY DEFINER bodies (which run as the owner).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.native_invoice_settled(p_si_id uuid) returns numeric
  language sql stable set search_path = public as $$
  select coalesce(sum(ip.amount), 0)
    from public.incoming_payments ip
   where ip.sales_invoice_id = p_si_id and ip.pmo_native and ip.cancelled_at is null
$$;
revoke all on function public.native_invoice_settled(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — create_native_sales_invoice (FR-NAR-001..004). Order: member → role → ownership → lines → billing lock →
-- project (FOR SHARE: a concurrent VAT-flag change waits, then sees this invoice and refuses, 0253) → customer →
-- work order → tax → insert → author set.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_native_sales_invoice(
  p_project_id    uuid,
  p_customer_id   uuid,
  p_lines         jsonb,
  p_work_order_id uuid default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid      := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_uid         uuid      := auth.uid();
  v_valid       boolean;
  v_lines       jsonb;
  v_amount      numeric;
  v_p_org       uuid;
  v_currency    text;
  v_vat         boolean;
  v_rate        numeric;
  v_num         integer;
  v_den         integer;
  v_contract    text;
  v_wo_org      uuid;
  v_wo_currency text;
  v_wo_po       text;
  v_id          uuid      := gen_random_uuid();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can raise a customer invoice' using errcode = '42501';
  end if;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'an invoice needs between 1 and 100 lines' using errcode = '23514';
  end if;
  -- CASE, not a bare cast: a non-number qty/rate becomes NULL (refused below), never a cast error or a coercion.
  with lines as (
    select x.ord,
           nullif(btrim(x.l ->> 'item_code'), '')   as item_code,
           nullif(btrim(x.l ->> 'description'), '') as description,
           case when jsonb_typeof(x.l -> 'qty')  = 'number' then (x.l ->> 'qty')::numeric  end as qty,
           case when jsonb_typeof(x.l -> 'rate') = 'number' then (x.l ->> 'rate')::numeric end as rate
      from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
  )
  select bool_and((item_code is not null or description is not null)
                  and coalesce(length(item_code), 0) <= 140 and coalesce(length(description), 0) <= 140
                  and coalesce(qty > 0 and qty < 'Infinity'::numeric and qty = round(qty, 3), false)
                  and coalesce(rate >= 0 and rate < 'Infinity'::numeric and rate = round(rate, 2), false)),
         jsonb_agg(jsonb_build_object('item_code', item_code, 'description', description, 'qty', qty, 'rate', rate,
                                      'amount', round(qty * rate, 2)) order by ord),
         sum(round(qty * rate, 2))
    into v_valid, v_lines, v_amount
    from lines;
  if not coalesce(v_valid, false) then
    raise exception 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals'
      using errcode = '23514';
  end if;
  if not coalesce(v_amount > 0 and v_amount < 1000000000000, false) then
    raise exception 'the invoice total must be above zero' using errcode = '23514';
  end if;

  -- DD-BWO-5: the work order's billing lock BEFORE the project row lock — the order every billing writer uses.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency, p.subject_to_vat, p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
         p.customer_contract_ref
    into v_p_org, v_currency, v_vat, v_rate, v_num, v_den, v_contract
    from public.projects p where p.id = p_project_id for share;
  if not found or v_p_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_customer_id and c.org_id = v_org) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_work_order_id is not null then
    select wo.org_id, wo.currency, wo.client_po_number into v_wo_org, v_wo_currency, v_wo_po
      from public.work_orders wo where wo.id = p_work_order_id;
    if not found or v_wo_org is distinct from v_org then
      raise exception 'work order not found' using errcode = 'P0002';
    end if;
    v_currency := v_wo_currency;
  end if;

  -- OD-TAX-4 / DD-NAR-7: the project says whether it is subject to VAT; its own rate and base apply.
  if v_vat then
    if v_rate is null or v_rate <= 0 then
      raise exception 'this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing'
        using errcode = 'P0001';
    end if;
  else
    v_rate := 0; v_num := 1; v_den := 1;
  end if;

  -- tax_amount 0 is a placeholder the 0227 trigger (sales_invoices_zz_apply_tax_base) replaces from tax_rate on insert.
  insert into public.sales_invoices
    (id, org_id, project_id, customer_id, work_order_id, reference_number, native_lines, amount, currency,
     tax_treatment, tax_rate, tax_amount, tax_base_numerator, tax_base_denominator, status, pmo_native, author_user_id)
  values
    (v_id, v_org, p_project_id, p_customer_id, p_work_order_id,
     coalesce(nullif(btrim(v_wo_po), ''), nullif(btrim(v_contract), '')),
     v_lines, v_amount, v_currency,
     'exclusive', v_rate, 0, v_num, v_den, 'Draft', true, v_uid);

  -- 0132's SoD oracle: nobody in this set may approve the invoice (§4).
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id) values (v_org, v_id, v_uid);
  return v_id;
end; $$;
revoke all on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid) to authenticated;
comment on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid) is
  '#784 FR-NAR-001..004: raises a PMO customer invoice as a Draft while no ERP owns revenue. Admin/Finance only; tax from the project; the caller is recorded as author.';
```

**Verify (GREEN):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_create.test.sql'` → `ok 1..23`, `All tests successful`.

---

## Task 3 — RED: pgTAP for approving and cancelling (AC-NAR-002, AC-NAR-005) (5 min)

**File:** `supabase/tests/0270_native_revenue_approve.test.sql`

```sql
-- 0270_native_revenue_approve.test.sql — #784 AC-NAR-002 (a second person approves; the author never can) and
-- AC-NAR-005 (a Draft, or an Unpaid invoice with no receipt, can be cancelled). Migration under test: 0270 §3–§4.
begin;
create extension if not exists pgtap;
select plan(19);

insert into organizations (id, name) values
  ('02700000-0000-0000-0000-000000000001', 'NAR Org'),
  ('02700000-0000-0000-0000-000000000002', 'NAR Other Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02700000-0000-0000-0000-0000000000a3', 'nar-admin@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com'),
  ('02700000-0000-0000-0000-0000000000a5', 'nar-off@example.com'),
  ('02700000-0000-0000-0000-0000000000b1', 'nar-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a3', '02700000-0000-0000-0000-000000000001', 'NAR Admin', 'nar-admin@example.com', 'Admin', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active'),
  ('02700000-0000-0000-0000-0000000000a5', '02700000-0000-0000-0000-000000000001', 'NAR Off', 'nar-off@example.com', 'Finance', 'disabled'),
  ('02700000-0000-0000-0000-0000000000b1', '02700000-0000-0000-0000-000000000002', 'NAR XOrg', 'nar-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Approve me","qty":2,"rate":500000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Null target","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Demotion","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cancel draft","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Cancel unpaid","qty":1,"rate":100}]'::jsonb);
end $$;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Admin own","qty":1,"rate":100}]'::jsonb);
end $$;

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  '42501', 'approver must differ from author (SoD)', 'AC-NAR-002 the author cannot approve their own invoice');         -- 1
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Admin own"}]'), 'Unpaid') $$,
  '42501', 'approver must differ from author (SoD)', 'AC-NAR-002 an Admin cannot approve an invoice they raised either'); -- 2
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  '42501', 'only Finance or an Admin can approve or cancel a customer invoice', 'AC-NAR-002 a Project Manager cannot approve'); -- 3
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-000000000000'::uuid, 'Unpaid') $$,
  '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-NAR-002 an offboarded Finance member cannot approve');                                                         -- 4
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select si.id from public.sales_invoices si where si.org_id = '02700000-0000-0000-0000-000000000001' limit 1), 'Unpaid') $$,
  'P0002', 'sales invoice not found', 'AC-NAR-002 another org''s member cannot reach the invoice (it is invisible, so the id resolves to nothing)'); -- 5
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  'AC-NAR-002 a different Finance user approves it');                                                               -- 6
select is(
  (select row(status, pmo_number ~ '^INV-[0-9]{10}$', invoice_date is not null, approved_by_id, erp_outstanding_amount)::text
     from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'),
  row('Unpaid', true, true, '02700000-0000-0000-0000-0000000000a2'::uuid, 1110000.00::numeric(14,2))::text,
  'AC-NAR-002 approved, it is Unpaid, numbered, dated, approved by the second person, and owes its gross');           -- 7
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]'), 'Unpaid') $$,
  'P0001', 'illegal transition Unpaid -> Unpaid', 'AC-NAR-002 an approved invoice is not approved twice');          -- 8
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Null target"}]'), null) $$,
  'P0001', 'illegal transition Draft -> <NULL>', 'AC-NAR-002 a NULL target is refused, never a fall-through');       -- 9

reset role;
set local request.jwt.claims = '{}';
update public.profiles set role = 'Project Manager' where id = '02700000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Demotion"}]'), 'Unpaid') $$,
  '42501', 'only Finance or an Admin can approve or cancel a customer invoice',
  'AC-NAR-002 an approver demoted since is refused — the role is read at approval time, not trusted from before'); -- 10
reset role;
set local request.jwt.claims = '{}';
update public.profiles set role = 'Finance' where id = '02700000-0000-0000-0000-0000000000a2';
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status, pmo_native, native_lines)
  values ('02700000-0000-0000-0000-0000000000f1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
          '02700000-0000-0000-0000-0000000000c1', 100, 'exclusive', 0, 'IDR', 'Draft', true,
          '[{"item_code":"SVC","description":null,"qty":1,"rate":100,"amount":100.00}]');
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status)
  values ('02700000-0000-0000-0000-0000000000f2', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
          '02700000-0000-0000-0000-0000000000c1', 100, 'exclusive', 0, 'IDR', 'Draft');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f1', 'Unpaid') $$,
  '42501', 'sales invoice has no recorded author — SoD cannot be verified',
  'AC-NAR-002 a PMO invoice with no recorded author is never approvable (fail closed)');                            -- 11
select throws_ok($$ select public.transition_native_sales_invoice('02700000-0000-0000-0000-0000000000f2', 'Unpaid') $$,
  'P0001', 'this invoice belongs to the ERP: approve or cancel it there',
  'AC-NAR-002 an invoice that is not a PMO invoice is never approved by the PMO path');                             -- 12
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel draft"}]'), 'Cancelled') $$,
  'AC-NAR-005 Finance cancels a PMO draft');                                                                         -- 13
select is((select status from public.sales_invoices where native_lines @> '[{"description":"Cancel draft"}]'), 'Cancelled',
  'AC-NAR-005 the cancelled draft reads Cancelled (and so stops counting against a work order, 0262)');             -- 14
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'), 'Unpaid') $$,
  'AC-NAR-005 setup: a second invoice is approved');                                                                 -- 15
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'), 'Cancelled') $$,
  'AC-NAR-005 an approved invoice with no receipt can be cancelled');                                               -- 16
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'),
  row('Cancelled', 0.00::numeric(14,2))::text, 'AC-NAR-005 a cancelled invoice owes nothing');                       -- 17
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Cancel unpaid"}]'), 'Cancelled') $$,
  'P0001', 'illegal transition Cancelled -> Cancelled', 'AC-NAR-005 a cancelled invoice stays cancelled');          -- 18
reset role;
select is((select count(*)::int from public.audit_events
            where action = 'sales_invoice.transition' and actor_id = '02700000-0000-0000-0000-0000000000a2'
              and entity_id = (select id from public.sales_invoices where native_lines @> '[{"description":"Approve me"}]')),
  1, 'AC-NAR-002 the approval is on the audit trail with its approver');                                            -- 19

select * from finish();
rollback;
```

**Verify (RED):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_approve.test.sql'`
→ fails: `function public.transition_native_sales_invoice(uuid, unknown) does not exist`.

---

## Task 4 — GREEN: §4 transition RPC (approve / cancel) (5 min)

**Append to** `supabase/migrations/0270_native_revenue.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — transition_native_sales_invoice (FR-NAR-005, FR-NAR-009). Order is load-bearing: member → row lock → org →
-- role (read now: current standing) → native → ownership → legality (NULL-safe) → SoD (outside any Admin skip,
-- OD-PROC-8 shape) → one update → audit. Same SoD rule and messages as submit_sales_invoice (0133).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_native_sales_invoice(p_id uuid, p_to text)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_row    public.sales_invoices%rowtype;
  v_uid    uuid      := auth.uid();
  v_role   user_role := public.auth_role();
  v_gross  numeric;
  v_today  date;
  v_number text;
  v_legal  jsonb := jsonb_build_object('Draft',  jsonb_build_array('Unpaid','Cancelled'),
                                       'Unpaid', jsonb_build_array('Cancelled'));
begin
  perform public.assert_is_active_member();
  select * into v_row from public.sales_invoices where id = p_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can approve or cancel a customer invoice' using errcode = '42501';
  end if;
  if not v_row.pmo_native then
    raise exception 'this invoice belongs to the ERP: approve or cancel it there' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  if public.domain_externally_owned(v_row.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;
  -- NULL-safe: `? NULL` is NULL and `not NULL` would fall through (0176 §6).
  if p_to is null or not coalesce((v_legal -> v_row.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_row.status, coalesce(p_to, '<NULL>') using errcode = 'P0001';
  end if;

  v_gross := case when v_row.tax_treatment = 'inclusive' then v_row.amount else v_row.amount + v_row.tax_amount end;

  if p_to = 'Unpaid' then
    -- (0127 §B / 0133) FAIL CLOSED on an unknown author.
    if v_row.author_user_id is null
       and not exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = p_id) then
      raise exception 'sales invoice has no recorded author — SoD cannot be verified'
        using errcode = '42501', detail = 'sod-author-missing';
    end if;
    -- (0132) NOBODY WHO EVER WROTE THE BODY MAY APPROVE — an Admin included.
    if v_row.author_user_id = v_uid
       or exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = p_id and a.user_id = v_uid) then
      raise exception 'approver must differ from author (SoD)' using errcode = '42501', detail = 'sod-self-approval';
    end if;
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    v_number := public.next_procurement_doc_number(v_row.org_id, 'INV');
    update public.sales_invoices set
      status                 = 'Unpaid',
      pmo_number             = v_number,
      invoice_date           = v_today,
      approved_by_id         = v_uid,
      approved_at            = now(),
      erp_outstanding_amount = v_gross
    where id = p_id;
  else
    if v_row.status = 'Unpaid' and public.native_invoice_settled(p_id) > 0 then
      raise exception 'cancel the receipts recorded against this invoice first' using errcode = 'P0001';
    end if;
    update public.sales_invoices set
      status                 = 'Cancelled',
      erp_outstanding_amount = case when v_row.status = 'Unpaid' then 0 else erp_outstanding_amount end
    where id = p_id;
  end if;

  perform public.log_audit('sales_invoice.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status, 'to', p_to, 'pmo_number', coalesce(v_number, v_row.pmo_number),
                       'gross', v_gross));
end; $$;
revoke all on function public.transition_native_sales_invoice(uuid, text) from public, anon;
grant execute on function public.transition_native_sales_invoice(uuid, text) to authenticated;
comment on function public.transition_native_sales_invoice(uuid, text) is
  '#784 FR-NAR-005/009: approve (Draft → Unpaid; approver not in the author set; current Admin/Finance) or cancel (Draft, or Unpaid with no live receipt) a PMO invoice.';
```

**Verify (GREEN):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_create.test.sql supabase/tests/0270_native_revenue_approve.test.sql'` → both files `All tests successful` (23 + 19).

---

## Task 5 — Mutation checks on the approval SoD (5 min)

Each mutation is made in `supabase/migrations/0270_native_revenue.sql`, run, then **reverted by hand to the exact
original line**, then the file is re-run green. Command for every step:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_approve.test.sql'`

| # | Change (in §4) | Must go RED (by description) |
|---|---|---|
| M1 | `if v_row.author_user_id = v_uid` → `if false and v_row.author_user_id = v_uid` | 1 "the author cannot approve…", 2 "an Admin cannot approve…" |
| M2 | `if v_role is null or v_role not in ('Admin','Finance') then` (in §4) → `if v_role is null or v_role not in ('Admin','Finance','Project Manager') then` | 3 "a Project Manager cannot approve", 10 "an approver demoted since…" |
| M3 | `if v_row.author_user_id is null` (fail-closed block) → `if false and v_row.author_user_id is null` | 11 "…no recorded author is never approvable" |

**Verify:** each mutation prints `not ok` for exactly the listed assertions; after reverting, the file is green again.
Record the three outputs in the PR body.

---

## Task 6 — RED: pgTAP for receipts (AC-NAR-003 contract, AC-NAR-006) (5 min)

> **Superseded by DD-NAR-17 (owner OD-NAR-1):** a receipt carries a required payment date (never future) and an amount
> that defaults to the balance; more than the balance is accepted (Paid, `overpaid_amount` = the excess). The committed
> `0270_native_revenue_receipts.test.sql` and migration §5 are the source of truth for Tasks 6–7.

**File:** `supabase/tests/0270_native_revenue_receipts.test.sql`

```sql
-- 0270_native_revenue_receipts.test.sql — #784 AC-NAR-003 (part and full receipts; the balance is the gross less live
-- PMO receipts; Paid exactly at zero) and AC-NAR-006 (a receipt can be cancelled; the balance comes back).
-- Migration under test: 0270 §5.
begin;
create extension if not exists pgtap;
select plan(19);

insert into organizations (id, name) values
  ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Receipt invoice","qty":2,"rate":500000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Second invoice","qty":1,"rate":1000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Draft only","qty":1,"rate":100}]'::jsonb);
end $$;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), 'Unpaid');
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Second invoice"}]'), 'Unpaid');
end $$;

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Draft only"}]'), 100) $$,
  'P0001', 'a receipt can be recorded only against an approved invoice that is not fully paid',
  'AC-NAR-003 a Draft takes no receipt');                                                                            -- 1
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), 500000) $$,
  'AC-NAR-003 Finance records a part payment');                                                                      -- 2
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Unpaid', 610000.00::numeric(14,2))::text,
  'AC-NAR-003 a part payment leaves 610,000 of the 1,110,000 gross outstanding and the invoice Unpaid');             -- 3
select is(
  (select row(pmo_native, pmo_number ~ '^RCV-[0-9]{10}$', status, customer_id, currency, received_amount, withheld_amount)::text
     from public.incoming_payments
    where sales_invoice_id = (select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]')
      and amount = 500000),
  row(true, true, 'Paid', '02700000-0000-0000-0000-0000000000c1'::uuid, 'IDR', 500000.00::numeric(14,2), 0.00::numeric(14,2))::text,
  'AC-NAR-003 the receipt is a numbered PMO receipt for the invoice''s customer, in its currency, all cash');         -- 4
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), 610000.01) $$,
  'P0001', 'this receipt of 610000.01 is more than the 610000.00 still outstanding on this invoice',
  'AC-NAR-003 a receipt above the balance is refused');                                                              -- 5
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), 'Cancelled') $$,
  'P0001', 'cancel the receipts recorded against this invoice first',
  'AC-NAR-005 an invoice with a live receipt cannot be cancelled');                                                 -- 6
select lives_ok($$ insert into public.incoming_payments (customer_id, sales_invoice_id, date, amount)
  values ('02700000-0000-0000-0000-0000000000c1', (select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), '2026-10-07', 999) $$,
  'AC-NAR-003 setup: a client-inserted receipt row (the 0178 column-limited insert) lands');                         -- 7
select is((select erp_outstanding_amount from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  610000.00::numeric(14,2), 'AC-NAR-003 …and moves no PMO invoice''s balance: only PMO receipts settle a PMO invoice'); -- 8
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  610000, 600000, 10000, 'BP-NAR-1') $$,
  'AC-NAR-003 Finance records the rest, with tax withheld by the client (DD-RCPT-1) — the client row did not count'); -- 9
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Paid', 0.00::numeric(14,2))::text, 'AC-NAR-003 settled in full, the invoice is Paid');                        -- 10
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'), 1) $$,
  'P0001', 'a receipt can be recorded only against an approved invoice that is not fully paid',
  'AC-NAR-003 a Paid invoice takes no more receipts');                                                              -- 11
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Second invoice"}]'), 100, 90, 0) $$,
  '23514', 'cash received plus tax withheld must equal the amount settled',
  'AC-NAR-003 cash plus withholding must add up to the amount settled');                                            -- 12
select lives_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where withholding_slip_number = 'BP-NAR-1')) $$,
  'AC-NAR-006 Finance cancels a receipt recorded in error');                                                         -- 13
select is((select row(status, erp_outstanding_amount)::text from public.sales_invoices where native_lines @> '[{"description":"Receipt invoice"}]'),
  row('Unpaid', 610000.00::numeric(14,2))::text, 'AC-NAR-006 the balance is restored and the invoice is Unpaid again'); -- 14
select throws_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where withholding_slip_number = 'BP-NAR-1')) $$,
  'P0001', 'this receipt is already cancelled', 'AC-NAR-006 a receipt is cancelled once');                          -- 15

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Second invoice"}]'), 100) $$,
  '42501', 'only Finance or an Admin can record a customer receipt', 'AC-NAR-003 a Project Manager cannot record a receipt'); -- 16
select throws_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where pmo_native and amount = 500000)) $$,
  '42501', 'only Finance or an Admin can cancel a customer receipt', 'AC-NAR-006 a Project Manager cannot cancel a receipt'); -- 17

reset role;
set local request.jwt.claims = '{}';
insert into public.sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status, erp_outstanding_amount)
  values ('02700000-0000-0000-0000-0000000000f3', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1',
          '02700000-0000-0000-0000-0000000000c1', 100, 'inclusive', 0, 'IDR', 'Unpaid', 100);
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.record_native_receipt('02700000-0000-0000-0000-0000000000f3', 10) $$,
  'P0001', 'receipts for an ERP invoice are recorded in the ERP', 'AC-NAR-003 an ERP invoice takes no PMO receipt'); -- 18
reset role;
select is(
  (select count(*)::int from public.sales_invoices si
    where si.org_id = '02700000-0000-0000-0000-000000000001' and si.pmo_native and si.status in ('Unpaid','Paid')
      and (si.erp_outstanding_amount is distinct from si.amount + si.tax_amount - public.native_invoice_settled(si.id)
           or (si.status = 'Paid') is distinct from (si.erp_outstanding_amount = 0))),
  0, 'AC-NAR-003 every PMO invoice''s stored balance is its gross less its live receipts, and it is Paid exactly at zero'); -- 19

select * from finish();
rollback;
```

**Verify (RED):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_receipts.test.sql'`
→ fails: `function public.record_native_receipt(uuid, integer) does not exist`.

---

## Task 7 — GREEN: §5 receipt RPCs (5 min)

> **Superseded by DD-NAR-17 (owner OD-NAR-1):** a receipt carries a required payment date (never future) and an amount
> that defaults to the balance; more than the balance is accepted (Paid, `overpaid_amount` = the excess). The committed
> `0270_native_revenue_receipts.test.sql` and migration §5 are the source of truth for Tasks 6–7.

**Append to** `supabase/migrations/0270_native_revenue.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — record_native_receipt / cancel_native_receipt (FR-NAR-007, FR-NAR-009; DD-NAR-4). The balance is RECOMPUTED
-- from live PMO receipts under the invoice row lock — never incremented — and written to erp_outstanding_amount; the
-- invoice is Paid exactly when it reaches zero. Lock order: invoice, then receipt.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.record_native_receipt(
  p_sales_invoice_id        uuid,
  p_amount                  numeric,
  p_received_amount         numeric default null,
  p_withheld_amount         numeric default null,
  p_withholding_slip_number text    default null,
  p_date                    date    default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_si       public.sales_invoices%rowtype;
  v_role     user_role := public.auth_role();
  v_withheld numeric   := coalesce(p_withheld_amount, 0);
  v_received numeric;
  v_out      numeric;
  v_date     date;
  v_id       uuid      := gen_random_uuid();
begin
  perform public.assert_is_active_member();
  select * into v_si from public.sales_invoices where id = p_sales_invoice_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_si.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can record a customer receipt' using errcode = '42501';
  end if;
  if not v_si.pmo_native then
    raise exception 'receipts for an ERP invoice are recorded in the ERP' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  if public.domain_externally_owned(v_si.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;
  if v_si.status is distinct from 'Unpaid' then
    raise exception 'a receipt can be recorded only against an approved invoice that is not fully paid' using errcode = 'P0001';
  end if;
  if not coalesce(p_amount > 0 and p_amount < 'Infinity'::numeric and p_amount = round(p_amount, 2), false) then
    raise exception 'the receipt amount must be a positive number with at most 2 decimals' using errcode = '23514';
  end if;
  if not coalesce(v_withheld >= 0 and v_withheld < 'Infinity'::numeric and v_withheld = round(v_withheld, 2), false) then
    raise exception 'the tax withheld must be zero or more with at most 2 decimals' using errcode = '23514';
  end if;
  v_received := coalesce(p_received_amount, p_amount - v_withheld);
  if not coalesce(v_received >= 0 and v_received = round(v_received, 2) and v_received + v_withheld = p_amount, false) then
    raise exception 'cash received plus tax withheld must equal the amount settled' using errcode = '23514';
  end if;
  if v_withheld > 0 and nullif(btrim(p_withholding_slip_number), '') is null then
    raise exception 'tax withheld needs its withholding-slip number' using errcode = '23514';
  end if;

  v_out := (case when v_si.tax_treatment = 'inclusive' then v_si.amount else v_si.amount + v_si.tax_amount end)
           - public.native_invoice_settled(p_sales_invoice_id);
  if p_amount > v_out then
    raise exception 'this receipt of % is more than the % still outstanding on this invoice', round(p_amount, 2), round(v_out, 2)
      using errcode = 'P0001';
  end if;

  v_date := coalesce(p_date, (now() at time zone coalesce(
              (select o.default_timezone from public.organizations o where o.id = v_si.org_id), 'UTC'))::date);
  insert into public.incoming_payments
    (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount, withheld_amount,
     withholding_slip_number, currency, status, pmo_native, pmo_number)
  values
    (v_id, v_si.org_id, v_si.customer_id, p_sales_invoice_id, v_date, p_amount, v_received, v_withheld,
     nullif(btrim(p_withholding_slip_number), ''), v_si.currency, 'Paid', true,
     public.next_procurement_doc_number(v_si.org_id, 'RCV'));

  v_out := v_out - p_amount;
  update public.sales_invoices set
    erp_outstanding_amount = v_out,
    status                 = case when v_out = 0 then 'Paid' else 'Unpaid' end
  where id = p_sales_invoice_id;
  return v_id;
end; $$;
revoke all on function public.record_native_receipt(uuid, numeric, numeric, numeric, text, date) from public, anon;
grant execute on function public.record_native_receipt(uuid, numeric, numeric, numeric, text, date) to authenticated;
comment on function public.record_native_receipt(uuid, numeric, numeric, numeric, text, date) is
  '#784 FR-NAR-007: records a customer receipt against an Unpaid PMO invoice; refuses more than the balance; Paid at zero.';

create or replace function public.cancel_native_receipt(p_receipt_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_rc   public.incoming_payments%rowtype;
  v_si   public.sales_invoices%rowtype;
  v_uid  uuid      := auth.uid();
  v_role user_role := public.auth_role();
  v_out  numeric;
begin
  perform public.assert_is_active_member();
  select * into v_rc from public.incoming_payments where id = p_receipt_id;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if v_rc.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can cancel a customer receipt' using errcode = '42501';
  end if;
  if not v_rc.pmo_native then
    raise exception 'receipts recorded in the ERP are cancelled there' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  if public.domain_externally_owned(v_rc.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;
  -- Lock order invoice → receipt (record_native_receipt locks only the invoice), then re-read the receipt.
  select * into v_si from public.sales_invoices where id = v_rc.sales_invoice_id for update;
  select * into v_rc from public.incoming_payments where id = p_receipt_id for update;
  if v_rc.cancelled_at is not null then
    raise exception 'this receipt is already cancelled' using errcode = 'P0001';
  end if;

  update public.incoming_payments set cancelled_at = now() where id = p_receipt_id;
  v_out := (case when v_si.tax_treatment = 'inclusive' then v_si.amount else v_si.amount + v_si.tax_amount end)
           - public.native_invoice_settled(v_si.id);
  update public.sales_invoices set
    erp_outstanding_amount = v_out,
    status                 = case when v_out = 0 then 'Paid' else 'Unpaid' end
  where id = v_si.id;

  perform public.log_audit('incoming_payment.cancel', v_rc.org_id, v_uid, p_receipt_id,
    jsonb_build_object('sales_invoice_id', v_si.id, 'amount', v_rc.amount, 'pmo_number', v_rc.pmo_number,
                       'outstanding_after', v_out));
end; $$;
revoke all on function public.cancel_native_receipt(uuid) from public, anon;
grant execute on function public.cancel_native_receipt(uuid) to authenticated;
comment on function public.cancel_native_receipt(uuid) is
  '#784 FR-NAR-009: cancels a PMO receipt and recomputes its invoice''s balance and status.';
```

**Verify (GREEN):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_create.test.sql supabase/tests/0270_native_revenue_approve.test.sql supabase/tests/0270_native_revenue_receipts.test.sql'` → all three `All tests successful`.

---

## Task 8 — Mutation checks on the receipt rules (3 min)

Command: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_receipts.test.sql'`

| # | Change (in §5, `record_native_receipt`) | Must go RED |
|---|---|---|
| M4 | `overpaid_amount        = greatest(v_settled - v_gross, 0),` (the one in `record_native_receipt`) → `overpaid_amount        = 0,` | 18 "an overpaid invoice is Paid, owes nothing, and shows the 90,000 received beyond its gross" (DD-NAR-17 replaced the over-balance refusal) |
| M5 | `status                 = case when v_out = 0 then 'Paid' else 'Unpaid' end` (the one in `record_native_receipt`) → `status                 = 'Unpaid'` | 10 "settled in full, the invoice is Paid", 19 the invariant |

Revert each by hand; re-run green. **Verify:** the listed assertions fail under the mutation and pass after revert.

---

## Task 9 — RED: pgTAP for connecting an ERP later (AC-NAR-004) (5 min)

**File:** `supabase/tests/0270_native_revenue_crossing.test.sql`

```sql
-- 0270_native_revenue_crossing.test.sql — #784 AC-NAR-004 (DD-NAR-11, OD-XING-1 default): once an ERP owns revenue,
-- PMO invoices and receipts from before stay readable, every PMO write is refused (RPC + mirror guards), and the ERP
-- cannot take revenue over while a PMO draft is open. Migration under test: 0270 §6–§7.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name) values
  ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Pre-connect unpaid","qty":1,"rate":1000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Pre-connect draft","qty":1,"rate":100}]'::jsonb);
end $$;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), 'Unpaid');
  perform public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), 100);
end $$;

reset role;
set local request.jwt.claims = '{}';
select throws_ok($$ insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue') $$,
  'P0001', 'approve or cancel the 1 draft invoice(s) raised in PMO before the ERP takes over customer invoicing',
  'AC-NAR-004 the ERP cannot take over customer invoicing while a PMO draft is open');                              -- 1
select lives_ok($$ insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'procurement') $$,
  'AC-NAR-004 the guard binds the revenue domain only');                                                            -- 2
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect draft"}]'), 'Cancelled') $$,
  'AC-NAR-004 setup: Finance cancels the open PMO draft');                                                          -- 3
reset role;
set local request.jwt.claims = '{}';
select lives_ok($$ insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue') $$,
  'AC-NAR-004 with no PMO draft open, the ERP takes over customer invoicing');                                      -- 4

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 no new PMO invoice once the ERP owns revenue');                                                       -- 5
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), 'Cancelled') $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 a pre-connect PMO invoice cannot be cancelled in PMO');                                                -- 6
select throws_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), 10) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 a pre-connect PMO invoice takes no PMO receipt');                                                      -- 7
select throws_ok($$ select public.cancel_native_receipt((select id from public.incoming_payments where pmo_native and amount = 100)) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  'AC-NAR-004 a pre-connect PMO receipt cannot be cancelled in PMO');                                                -- 8

set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.sales_invoices where pmo_native), 2,
  'AC-NAR-004 the PMO invoices from before connect stay listed and readable');                                      -- 9
select is((select count(*)::int from public.incoming_payments where pmo_native), 1,
  'AC-NAR-004 the PMO receipt from before connect stays listed and readable');                                      -- 10

reset role;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update public.sales_invoices set pmo_number = 'INV-FORGED' where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', 'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 the mirror guard pins the PMO number while the ERP owns revenue (DD-WO-4 paired edit)');              -- 11
select throws_ok($$ update public.sales_invoices set native_lines = '[]' where native_lines @> '[{"description":"Pre-connect unpaid"}]' $$,
  '42501', 'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 …and the PMO lines');                                                                                  -- 12
select throws_ok($$ update public.incoming_payments set cancelled_at = now() where pmo_native $$,
  '42501', 'incoming_payments native fields are read-only while revenue is externally-owned',
  'AC-NAR-004 …and a PMO receipt''s cancellation stamp');                                                            -- 13

set local request.jwt.claims = '{}';
delete from public.external_domain_ownership where org_id = '02700000-0000-0000-0000-000000000001' and domain = 'revenue';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"Pre-connect unpaid"}]'), 10) $$,
  'AC-NAR-004 releasing the ERP re-opens PMO invoicing on the same rows — the crossing is reversible');             -- 14

select * from finish();
rollback;
```

**Verify (RED):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_crossing.test.sql'`
→ assertion 1 fails (the revenue row inserts), and 11–13 fail (the guards do not yet pin the new columns).

---

## Task 10 — GREEN: §6 mirror guards (paired edit) and §7 employ guard (5 min)

**Append to** `supabase/migrations/0270_native_revenue.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the mirror guards pin the new columns (DD-WO-4: a column added later is user-writable while the ERP owns the
-- domain unless its guard enumerates it). Bodies are the live definitions VERBATIM — sales_invoices from 0193,
-- incoming_payments from 0232 — with the lines marked `0270` added. SECURITY INVOKER as before; no trigger re-created
-- (a trigger binds by OID and create-or-replace keeps it).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.pmo_native is distinct from old.pmo_native           -- 0270 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0270 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0270 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0270 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0270 (#784)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.received_amount is distinct from old.received_amount
     or new.withheld_amount is distinct from old.withheld_amount
     or new.withholding_slip_number is distinct from old.withholding_slip_number
     or new.currency is distinct from old.currency               -- 0187 (#478)
     or new.pmo_native is distinct from old.pmo_native           -- 0270 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0270 (#784)
     or new.cancelled_at is distinct from old.cancelled_at       -- 0270 (#784)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — the ERP takes revenue over only with no PMO draft open (DD-NAR-11): a draft frozen by the flip could neither be
-- approved nor cancelled, and it would keep holding its work order's headroom (0262 counts drafts). Fires for every
-- writer (the ERP setup writes ownership with the service role), on insert or on a move of org/domain.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_revenue_employable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_drafts int;
begin
  if new.domain is distinct from 'revenue' then return new; end if;
  select count(*) into v_drafts
    from public.sales_invoices si
   where si.org_id = new.org_id and si.pmo_native and si.status = 'Draft';
  if v_drafts > 0 then
    raise exception 'approve or cancel the % draft invoice(s) raised in PMO before the ERP takes over customer invoicing', v_drafts
      using errcode = 'P0001', detail = 'native-drafts-open';
  end if;
  return new;
end; $$;
revoke all on function public.assert_revenue_employable() from public, anon, authenticated;
create trigger external_domain_ownership_revenue_employable
  before insert or update of domain, org_id on public.external_domain_ownership
  for each row execute function public.assert_revenue_employable();
```

**Verify (GREEN):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_crossing.test.sql supabase/tests/0270_native_revenue_receipts.test.sql'` → both `All tests successful` (14 + 19).

---

## Task 11 — Mutation checks on the crossing rules (3 min)

Command: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_crossing.test.sql'`

| # | Change | Must go RED |
|---|---|---|
| M6 | §3: `if public.domain_externally_owned(v_org, 'revenue') then` → `if false and public.domain_externally_owned(v_org, 'revenue') then` | 5 "no new PMO invoice once the ERP owns revenue" |
| M7 | §7: `if v_drafts > 0 then` → `if false and v_drafts > 0 then` | 1 "the ERP cannot take over … while a PMO draft is open" |
| M8 | §6 (sales_invoices guard): delete the line `or new.pmo_number is distinct from old.pmo_number           -- 0270 (#784)` | 11 "the mirror guard pins the PMO number…" |

Revert each by hand; re-run green. **Verify:** listed assertions fail under the mutation, pass after revert.

---

## Task 12 — RED: pgTAP for "revenue writes are Admin and Finance only" (AC-NAR-007) (5 min)

**File:** `supabase/tests/0270_revenue_write_roles.test.sql`

```sql
-- 0270_revenue_write_roles.test.sql — #784 AC-NAR-007 (owner ruling, DD-NAR-15): writes to sales_invoices and
-- incoming_payments are Admin and Finance only, by every path a member has — direct insert, update and delete (the
-- table policies), and the PMO revenue RPCs. The service-role ERP mirror writer is unaffected.
-- Update and delete are proven through the POLICY layer: the test grants the column/table privilege inside its own
-- transaction (rolled back), then shows which roles the policy admits.
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name) values ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a3', 'nar-admin@example.com'),
  ('02700000-0000-0000-0000-0000000000a4', 'nar-pm@example.com'),
  ('02700000-0000-0000-0000-0000000000a6', 'nar-exec@example.com'),
  ('02700000-0000-0000-0000-0000000000a7', 'nar-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a3', '02700000-0000-0000-0000-000000000001', 'NAR Admin', 'nar-admin@example.com', 'Admin', 'active'),
  ('02700000-0000-0000-0000-0000000000a4', '02700000-0000-0000-0000-000000000001', 'NAR PM', 'nar-pm@example.com', 'Project Manager', 'active'),
  ('02700000-0000-0000-0000-0000000000a6', '02700000-0000-0000-0000-000000000001', 'NAR Exec', 'nar-exec@example.com', 'Executive', 'active'),
  ('02700000-0000-0000-0000-0000000000a7', '02700000-0000-0000-0000-000000000001', 'NAR Eng', 'nar-eng@example.com', 'Engineer', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');
insert into public.sales_invoices (id, org_id, project_id, customer_id, reference_number, amount, tax_treatment, tax_amount, currency, status) values
  ('02700000-0000-0000-0000-0000000000f5', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 'SEED', 100, 'exclusive', 0, 'IDR', 'Draft'),
  ('02700000-0000-0000-0000-0000000000f7', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 'DELETE-ME', 100, 'exclusive', 0, 'IDR', 'Draft');
insert into public.incoming_payments (id, org_id, customer_id, reference_number, date, amount) values
  ('02700000-0000-0000-0000-0000000000f6', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', 'SEED', '2026-10-07', 10);

-- ── INSERT (the narrow column-limited body) ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  'AC-NAR-007 an Admin may insert a sales invoice');                                                                 -- 1
select lives_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  'AC-NAR-007 an Admin may insert a customer receipt');                                                              -- 2
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  'AC-NAR-007 a Finance member may insert a sales invoice');                                                         -- 3
select lives_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  'AC-NAR-007 a Finance member may insert a customer receipt');                                                      -- 4
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  '42501', 'new row violates row-level security policy for table "sales_invoices"', 'AC-NAR-007 an Executive cannot insert a sales invoice'); -- 5
select throws_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  '42501', 'new row violates row-level security policy for table "incoming_payments"', 'AC-NAR-007 an Executive cannot insert a customer receipt'); -- 6
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  '42501', 'new row violates row-level security policy for table "sales_invoices"', 'AC-NAR-007 a Project Manager cannot insert a sales invoice'); -- 7
select throws_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  '42501', 'new row violates row-level security policy for table "incoming_payments"', 'AC-NAR-007 a Project Manager cannot insert a customer receipt'); -- 8
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$ insert into public.sales_invoices (org_id, project_id, customer_id, amount, tax_treatment, tax_amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 10, 'exclusive', 0) $$,
  '42501', 'new row violates row-level security policy for table "sales_invoices"', 'AC-NAR-007 an Engineer cannot insert a sales invoice'); -- 9
select throws_ok($$ insert into public.incoming_payments (org_id, customer_id, date, amount) values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', '2026-10-07', 10) $$,
  '42501', 'new row violates row-level security policy for table "incoming_payments"', 'AC-NAR-007 an Engineer cannot insert a customer receipt'); -- 10

-- ── UPDATE (policy layer, privilege granted inside this transaction only) ─────────────────────────
reset role;
grant update (reference_number) on public.sales_invoices to authenticated;
grant update (reference_number) on public.incoming_payments to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-EXEC' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-EXEC' where id = '02700000-0000-0000-0000-0000000000f6';
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-PM' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-PM' where id = '02700000-0000-0000-0000-0000000000f6';
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a7","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-ENG' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-ENG' where id = '02700000-0000-0000-0000-0000000000f6';
reset role;
select is((select reference_number from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f5'), 'SEED',
  'AC-NAR-007 Executive, Project Manager and Engineer updates leave a sales invoice untouched');                    -- 11
select is((select reference_number from public.incoming_payments where id = '02700000-0000-0000-0000-0000000000f6'), 'SEED',
  'AC-NAR-007 Executive, Project Manager and Engineer updates leave a customer receipt untouched');                 -- 12
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-FIN' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-FIN' where id = '02700000-0000-0000-0000-0000000000f6';
reset role;
select is((select reference_number from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f5'), 'BY-FIN',
  'AC-NAR-007 a Finance member''s update of a sales invoice is admitted by the policy');                           -- 13
select is((select reference_number from public.incoming_payments where id = '02700000-0000-0000-0000-0000000000f6'), 'BY-FIN',
  'AC-NAR-007 a Finance member''s update of a customer receipt is admitted by the policy');                        -- 14
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update public.sales_invoices set reference_number = 'BY-ADMIN' where id = '02700000-0000-0000-0000-0000000000f5';
update public.incoming_payments set reference_number = 'BY-ADMIN' where id = '02700000-0000-0000-0000-0000000000f6';
reset role;
select is((select reference_number from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f5'), 'BY-ADMIN',
  'AC-NAR-007 an Admin''s update of a sales invoice is admitted by the policy');                                   -- 15
select is((select reference_number from public.incoming_payments where id = '02700000-0000-0000-0000-0000000000f6'), 'BY-ADMIN',
  'AC-NAR-007 an Admin''s update of a customer receipt is admitted by the policy');                                -- 16
revoke update (reference_number) on public.sales_invoices from authenticated;
revoke update (reference_number) on public.incoming_payments from authenticated;

-- ── DELETE (policy layer, privilege granted inside this transaction only) ─────────────────────────
grant delete on public.sales_invoices to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
delete from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7';
reset role;
select is((select count(*)::int from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7'), 1,
  'AC-NAR-007 a Project Manager''s delete of a sales invoice removes nothing');                                    -- 17
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
delete from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7';
reset role;
select is((select count(*)::int from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7'), 1,
  'AC-NAR-007 an Executive''s delete of a sales invoice removes nothing');                                         -- 18
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
delete from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7';
reset role;
select is((select count(*)::int from public.sales_invoices where id = '02700000-0000-0000-0000-0000000000f7'), 0,
  'AC-NAR-007 a Finance member''s delete is admitted by the policy');                                              -- 19
revoke delete on public.sales_invoices from authenticated;

-- ── the PMO revenue RPCs carry the same rule in their bodies ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-007 an Executive cannot raise a PMO invoice'); -- 20
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","qty":1,"rate":100}]'::jsonb) $$,
  '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-007 an Engineer cannot raise a PMO invoice'); -- 21
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"Role check","qty":1,"rate":100}]'::jsonb) $$,
  'AC-NAR-007 a Finance member raises a PMO invoice');                                                               -- 22
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Role check"}]'), 'Cancelled') $$,
  '42501', 'only Finance or an Admin can approve or cancel a customer invoice', 'AC-NAR-007 an Executive cannot cancel a PMO invoice'); -- 23
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"Role check"}]'), 'Cancelled') $$,
  'AC-NAR-007 an Admin cancels a PMO invoice');                                                                      -- 24

-- ── the service-role ERP mirror writer is unaffected ─────────────────────────────────────────────
reset role;
set local role service_role;
select lives_ok($$ insert into public.sales_invoices (org_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount, status, erp_docstatus, tax_treatment, tax_amount)
  values ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000c1', 'SI-MIRROR-NAR', '2026-10-07', 250, 250, 'Unpaid', 1, 'inclusive', 0) $$,
  'AC-NAR-007 CONTROL the service-role ERP mirror writer still lands a full mirror row');                           -- 25

select * from finish();
rollback;
```

**Verify (RED):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_revenue_write_roles.test.sql'`
→ assertions 5–8, 11–12 and 17–18 fail (the policies still admit Executive and Project Manager).

---

## Task 13 — GREEN: §8 revenue write policies, Admin and Finance only (3 min)

**Append to** `supabase/migrations/0270_native_revenue.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — Revenue writes are Admin and Finance only (owner ruling; DD-NAR-15, FR-NAR-013). The six write policies on the
-- two revenue tables are re-created with that role set; every other predicate is 0128's, verbatim (org, active member,
-- and for INSERT/DELETE "no ERP owns revenue"). Service-role mirror writers and SECURITY DEFINER RPCs do not pass
-- through these policies; each RPC checks the same role set in its own body.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop policy if exists sales_invoices_insert on public.sales_invoices;
create policy sales_invoices_insert on public.sales_invoices for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists sales_invoices_update on public.sales_invoices;
create policy sales_invoices_update on public.sales_invoices for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'));
drop policy if exists sales_invoices_delete on public.sales_invoices;
create policy sales_invoices_delete on public.sales_invoices for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

drop policy if exists incoming_payments_insert on public.incoming_payments;
create policy incoming_payments_insert on public.incoming_payments for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists incoming_payments_update on public.incoming_payments;
create policy incoming_payments_update on public.incoming_payments for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'));
drop policy if exists incoming_payments_delete on public.incoming_payments;
create policy incoming_payments_delete on public.incoming_payments for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

comment on policy sales_invoices_insert on public.sales_invoices is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Inserts are column-limited (0176) and only while no ERP owns revenue.';
comment on policy sales_invoices_update on public.sales_invoices is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Client updates go through role-checked RPCs; this policy states the same rule.';
comment on policy sales_invoices_delete on public.sales_invoices is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Deletes are made by the service-role mirror writer and audited (sales_invoices_audit_delete); this policy states the same rule.';
comment on policy incoming_payments_insert on public.incoming_payments is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Inserts are column-limited (0178) and only while no ERP owns revenue.';
comment on policy incoming_payments_update on public.incoming_payments is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Client updates go through role-checked RPCs; this policy states the same rule.';
comment on policy incoming_payments_delete on public.incoming_payments is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Deletes are made by the service-role mirror writer and audited; this policy states the same rule.';
```

**Verify (GREEN):** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_revenue_write_roles.test.sql'` → `ok 1..25`.

---

## Task 14 — Mutation check on the policies + sweep of existing tests for the ruled role set (5 min)

1. **M9:** in §8, `sales_invoices_insert` line `and auth_role() in ('Admin','Finance')` → `and auth_role() in ('Admin','Executive','Project Manager','Finance')`.
   Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_revenue_write_roles.test.sql'`
   → assertions 5 and 7 must fail. Revert by hand, re-run → green.
2. **Sweep.** List every existing pgTAP file that writes either table under a member JWT:
   ```bash
   grep -ln "insert into \(public\.\)\?\(sales_invoices\|incoming_payments\)\|update \(public\.\)\?\(sales_invoices\|incoming_payments\)" supabase/tests/*.test.sql
   ```
   Run them all under the new policy in one hold:
   ```bash
   scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db $(grep -ln "insert into \(public\.\)\?\(sales_invoices\|incoming_payments\)\|update \(public\.\)\?\(sales_invoices\|incoming_payments\)" supabase/tests/*.test.sql | tr "\n" " ")'
   ```
   Read-ahead results (checked while planning): the successful client inserts in `0169_create_path_sod_residuals` (actor
   `…a4`, Finance), `0262_work_order_billing_*` (Finance) and the inserts in `0171`/`0193`/`0170` (service role or
   postgres) are inside the ruled set. **Rule for any red this sweep finds:** if the failing assertion is a `lives_ok`
   on an insert/update by an Executive, Project Manager or Engineer, the test asserted the role set the owner has
   now ruled out — change only that statement's JWT `sub` to the same file's Finance profile and keep its goal and
   description; if a file has no Finance profile, add one row to its `profiles` fixture with `role 'Finance'`. Any
   other red is a real regression: stop and fix the migration.

**Verify:** the sweep run ends `All tests successful`; the PR body lists every file changed under the rule above (or "none").

---

## Task 15 — ACL proof, §9 in-migration assertions, 0178 allow-list (5 min)

**a) File:** `supabase/tests/0270_native_revenue_acl.test.sql`

```sql
-- 0270_native_revenue_acl.test.sql — #784 NFR-NAR-001: the four PMO revenue writers are client-callable SECURITY
-- DEFINER functions with a pinned search_path, never anon; the helper and the employ guard are not client-executable;
-- no new column is client-writable.
begin;
create extension if not exists pgtap;
select plan(5);

select ok(not exists (
  select 1 from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                        ('public.transition_native_sales_invoice(uuid,text)'),
                        ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                        ('public.cancel_native_receipt(uuid)')) f(sig)
   where has_function_privilege('anon', sig, 'execute')),
  'NFR-NAR-001 anon cannot execute any PMO revenue writer');
select ok(not exists (
  select 1 from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                        ('public.transition_native_sales_invoice(uuid,text)'),
                        ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                        ('public.cancel_native_receipt(uuid)')) f(sig)
   where not has_function_privilege('authenticated', sig, 'execute')),
  'NFR-NAR-001 a signed-in member can call all four (each checks role and SoD itself)');
select ok(not exists (
  select 1 from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                        ('public.transition_native_sales_invoice(uuid,text)'),
                        ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                        ('public.cancel_native_receipt(uuid)')) f(sig)
   join pg_proc p on p.oid = f.sig::regprocedure
   where not p.prosecdef or p.proconfig is distinct from array['search_path=public']),
  'NFR-NAR-001 all four are SECURITY DEFINER with search_path pinned to public');
select ok(not exists (
  select 1 from (values ('public.native_invoice_settled(uuid)'), ('public.assert_revenue_employable()')) f(sig)
   where has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute')),
  'NFR-NAR-001 the settled-amount helper and the employ guard are not client-executable');
select ok(not exists (
  select 1 from (values ('sales_invoices','pmo_native'), ('sales_invoices','pmo_number'), ('sales_invoices','native_lines'),
                        ('sales_invoices','approved_by_id'), ('sales_invoices','approved_at'),
                        ('sales_invoices','overpaid_amount'), ('sales_invoices','erp_opening_amount'),
                        ('sales_invoices','erp_opening_at'),
                        ('incoming_payments','pmo_native'), ('incoming_payments','pmo_number'),
                        ('incoming_payments','cancelled_at')) c(t, col)
   where has_column_privilege('authenticated', 'public.' || c.t, c.col, 'INSERT')
      or has_column_privilege('authenticated', 'public.' || c.t, c.col, 'UPDATE')),
  'NFR-NAR-001 no client writes a PMO marker, number, line set, stamp, overpaid figure or ERP opening stamp directly');

select * from finish();
rollback;
```

**b) Append to** `supabase/migrations/0270_native_revenue.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — assert the result on the database itself (hosted Supabase grants EXECUTE on new functions by default).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad text;
begin
  select string_agg(sig, ', ') into v_bad
    from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                 ('public.transition_native_sales_invoice(uuid,text)'),
                 ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                 ('public.cancel_native_receipt(uuid)')) f(sig)
   where has_function_privilege('anon', sig, 'execute')
      or not has_function_privilege('authenticated', sig, 'execute')
      or not (select p.prosecdef from pg_proc p where p.oid = sig::regprocedure);
  if v_bad is not null then
    raise exception '0270 §9: PMO revenue writer grants or SECURITY DEFINER drifted: %', v_bad;
  end if;

  select string_agg(sig, ', ') into v_bad
    from (values ('public.native_invoice_settled(uuid)'), ('public.assert_revenue_employable()')) f(sig)
   where has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute');
  if v_bad is not null then
    raise exception '0270 §9: client roles can execute internal functions: %', v_bad;
  end if;

  -- Every column §1 adds: neither client-insertable nor client-updatable (DD-NAR-2, -16, -17).
  select string_agg(c.t || '.' || c.col, ', ') into v_bad
    from (values ('sales_invoices','pmo_native'), ('sales_invoices','pmo_number'), ('sales_invoices','native_lines'),
                 ('sales_invoices','approved_by_id'), ('sales_invoices','approved_at'), ('sales_invoices','overpaid_amount'),
                 ('sales_invoices','erp_opening_amount'), ('sales_invoices','erp_opening_at'),
                 ('incoming_payments','pmo_native'), ('incoming_payments','pmo_number'),
                 ('incoming_payments','cancelled_at')) c(t, col)
   where has_column_privilege('authenticated', 'public.' || c.t, c.col, 'INSERT')
      or has_column_privilege('authenticated', 'public.' || c.t, c.col, 'UPDATE')
      or has_column_privilege('anon', 'public.' || c.t, c.col, 'INSERT')
      or has_column_privilege('anon', 'public.' || c.t, c.col, 'UPDATE');
  if v_bad is not null then
    raise exception '0270 §9: a PMO revenue column is client-writable: %', v_bad;
  end if;

  -- §8: exactly six write policies on the two tables, each admitting Admin and Finance and no other role.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename in ('sales_invoices','incoming_payments')
         and cmd in ('INSERT','UPDATE','DELETE')) <> 6
     or exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename in ('sales_invoices','incoming_payments')
                   and cmd in ('INSERT','UPDATE','DELETE')
                   and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(Executive|Project Manager|Engineer)') then
    raise exception '0270 §9: revenue write policies are not exactly the Admin/Finance set';
  end if;
end $$;
```

**c) Edit** `supabase/tests/0178_anon_executable_definers.test.sql`:
- After the `-- ⚑ AMENDED BY 0250 (#766): …` paragraph (ending `…deliberately NOT listed.`), insert:
  ```sql
  --
  -- ⚑ AMENDED BY 0270 (#784): `create_native_sales_invoice`, `transition_native_sales_invoice`, `record_native_receipt`
  -- and `cancel_native_receipt` join the retained set, taking the count to 63 (59 + 4, re-derived by hand from the list).
  -- Each is a SECURITY DEFINER writer called through PostgREST under a member's JWT that re-asserts membership + org +
  -- Admin/Finance (and, for approval, approver ∉ author set), proven by supabase/tests/0270_native_revenue_*.test.sql and
  -- 0270_revenue_write_roles.test.sql. `native_invoice_settled` (INVOKER, no client EXECUTE) is deliberately NOT listed.
  ```
- In the `insert into client_callable_rpc_names` list add, in alphabetical position: `('cancel_native_receipt'),` after
  `('attest_timesheet_no_erp_document'),`; `('create_native_sales_invoice'),` after `('confirm_erp_employee_link'),`;
  `('record_native_receipt'),` after `('record_expense_advance_return'),`; `('transition_native_sales_invoice'),` after
  `('transition_expense_claim'),`.
- Change both `59,` count literals to `63,` and both descriptions `all 59 retained` → `all 63 retained`.
  (If Task 0 printed a different base count, use that number + 4 and re-count the list by hand after any rebase.)

**Verify:**
```bash
grep -c "^  ('" supabase/tests/0178_anon_executable_definers.test.sql   # → 63 (or base + 4)
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_native_revenue_acl.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0173_rpc_active_member_gate.test.sql'
```
→ `db reset` applies 0270 without a §9 exception; all three files pass.

---

## Task 16 — Rollback file and a reversibility check (5 min)

**File:** `supabase/migrations/rollback/0270_native_revenue_down.sql`

```sql
-- Rollback for 0270_native_revenue.sql (#784). Precondition (data, not schema): no PMO invoice or receipt exists —
--   select count(*) from public.sales_invoices where pmo_native;    -- must be 0
--   select count(*) from public.incoming_payments where pmo_native; -- must be 0
-- Dropping the columns with PMO rows present would leave them indistinguishable from mirror rows.

-- §7
drop trigger if exists external_domain_ownership_revenue_employable on public.external_domain_ownership;
drop function if exists public.assert_revenue_employable();
-- §5, §4, §3, §2
drop function if exists public.cancel_native_receipt(uuid);
drop function if exists public.record_native_receipt(uuid, numeric, numeric, numeric, text, date);
drop function if exists public.transition_native_sales_invoice(uuid, text);
drop function if exists public.create_native_sales_invoice(uuid, uuid, jsonb, uuid);
drop function if exists public.native_invoice_settled(uuid);

-- §6 — restore the guards' previous bodies (0193 for sales_invoices, 0232 for incoming_payments), verbatim.
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.received_amount is distinct from old.received_amount
     or new.withheld_amount is distinct from old.withheld_amount
     or new.withholding_slip_number is distinct from old.withholding_slip_number
     or new.currency is distinct from old.currency               -- 0187 (#478)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- §8 — restore 0128's write policies and their 0177/0178 comments.
drop policy if exists sales_invoices_insert on public.sales_invoices;
create policy sales_invoices_insert on public.sales_invoices for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists sales_invoices_update on public.sales_invoices;
create policy sales_invoices_update on public.sales_invoices for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
drop policy if exists sales_invoices_delete on public.sales_invoices;
create policy sales_invoices_delete on public.sales_invoices for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists incoming_payments_insert on public.incoming_payments;
create policy incoming_payments_insert on public.incoming_payments for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists incoming_payments_update on public.incoming_payments;
create policy incoming_payments_update on public.incoming_payments for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
drop policy if exists incoming_payments_delete on public.incoming_payments;
create policy incoming_payments_delete on public.incoming_payments for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
comment on policy sales_invoices_delete on public.sales_invoices is
  'DEAD SINCE 0177 and kept deliberately: the DELETE grant to authenticated/anon is revoked, so this '
  'policy is never reached. It stays as the second layer if a future migration re-grants DELETE — '
  'dropping it would make such a re-grant fully open instead of 4-role gated. The sole deleter is the '
  'service-role mirror writer; every delete is audited by sales_invoices_audit_delete.';
comment on policy incoming_payments_delete on public.incoming_payments is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete.';
comment on policy incoming_payments_update on public.incoming_payments is
  'DEAD SINCE 0178 and kept deliberately: the UPDATE grant to authenticated/anon is revoked, so this '
  'policy is never reached. It stays as the second layer if a future migration re-grants UPDATE — '
  'dropping it would make such a re-grant fully open instead of 4-role gated. The sole updater is the '
  'service-role mirror writer. Mirrors the comment 0177 put on incoming_payments_delete.';

-- §1
drop index if exists public.incoming_payments_org_pmo_number_uidx;
drop index if exists public.sales_invoices_native_draft_idx;
drop index if exists public.sales_invoices_org_pmo_number_uidx;
alter table public.incoming_payments
  drop constraint if exists incoming_payments_pmo_native_shape,
  drop column if exists cancelled_at,
  drop column if exists pmo_number,
  drop column if exists pmo_native;
alter table public.sales_invoices
  drop constraint if exists sales_invoices_pmo_native_shape,
  drop column if exists approved_at,
  drop column if exists approved_by_id,
  drop column if exists native_lines,
  drop column if exists pmo_number,
  drop column if exists pmo_native;
```

**Verify (round trip, one lock hold):**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset \
  && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0270_native_revenue_down.sql \
  && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "select count(*) from information_schema.columns where table_name in ('"'"'sales_invoices'"'"','"'"'incoming_payments'"'"') and column_name in ('"'"'pmo_native'"'"','"'"'pmo_number'"'"','"'"'native_lines'"'"','"'"'cancelled_at'"'"')" \
  && supabase db reset'
```
→ the rollback runs without error, the count prints `0`, and the final reset re-applies 0270 cleanly.

---

## Task 17 — Regenerate types and the isolation denominator (3 min)

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset \
  && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts \
  && node --input-type=module -e "import { readActualCatalog, formatDenominator } from \"./scripts/check-isolation-denominator.mjs\"; process.stdout.write(formatDenominator(readActualCatalog()) + \"\\n\")" > scripts/isolation-probe-denominator.json \
  && node scripts/check-isolation-denominator.mjs'
```
**Verify:** exit 0. `git diff scripts/isolation-probe-denominator.json` shows exactly four added `definer_functions`
entries — `cancel_native_receipt(uuid)`, `create_native_sales_invoice(uuid,uuid,jsonb,uuid)`,
`record_native_receipt(uuid,numeric,numeric,numeric,text,date)`, `transition_native_sales_invoice(uuid,text)` — plus
`assert_revenue_employable()` only if the formatter lists trigger functions (it does not today), and no `tables`
change (no new table). Any other drift: stop and investigate. `database.types.ts` shows the new columns on both tables
and the four RPCs under `Functions`.

---

## Task 18 — Neighbour pgTAP suites (3 min)

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db \
  supabase/tests/0270_native_revenue_create.test.sql supabase/tests/0270_native_revenue_approve.test.sql \
  supabase/tests/0270_native_revenue_receipts.test.sql supabase/tests/0270_native_revenue_crossing.test.sql \
  supabase/tests/0270_revenue_write_roles.test.sql supabase/tests/0270_native_revenue_acl.test.sql \
  supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0173_rpc_active_member_gate.test.sql \
  supabase/tests/0169_create_path_sod_residuals.test.sql supabase/tests/0170_delete_path_sod_and_project_money_sod.test.sql \
  supabase/tests/0171_sod_class_completeness.test.sql supabase/tests/0193_work_orders.test.sql \
  supabase/tests/0244_sales_invoice_received_date.test.sql supabase/tests/0253_project_vat_flag.test.sql \
  supabase/tests/0227_tax_reduced_base.test.sql supabase/tests/money_currency_seam.test.sql \
  supabase/tests/sales_invoice_tax_treatment.test.sql supabase/tests/0232_receipt_withholding.test.sql \
  supabase/tests/erpnext_sales_invoices_flip_rls.test.sql supabase/tests/erpnext_incoming_payments_flip_rls.test.sql \
  supabase/tests/erpnext_money_flip_rls.test.sql supabase/tests/sales_ar_offboarded_rls.test.sql \
  supabase/tests/si_rpcs_active_member.test.sql supabase/tests/0262_work_order_billing_figures.test.sql \
  supabase/tests/0262_work_order_billing_refusal.test.sql supabase/tests/0262_work_order_billing_fence_hardening.test.sql \
  supabase/tests/0262_unbilled_work_orders.test.sql'
```
**Verify:** `All tests successful`. (CI's `pgtap` job runs the full suite.)

---

## Task 19 — Pure display rules: `nativeInvoice.ts` (TDD, 4 min) — AC-NAR-003 (support)

**Step 1 — failing test** `pmo-portal/src/lib/revenue/nativeInvoice.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { invoiceGross, invoiceNumber, isPartlyPaid, nativeInvoiceSummary, receiptNumber } from './nativeInvoice';

const unpaid = { pmo_native: true, status: 'Unpaid' as const, amount: 1_000_000, tax_amount: 110_000, tax_treatment: 'exclusive', erp_outstanding_amount: 610_000 };

describe('nativeInvoice display rules (#784)', () => {
  it('AC-NAR-003 an exclusive invoice owes its amount plus tax; an inclusive one owes its amount', () => {
    expect(invoiceGross(unpaid)).toBe(1_110_000);
    expect(invoiceGross({ amount: 1_110_000, tax_amount: 110_000, tax_treatment: 'inclusive' })).toBe(1_110_000);
    expect(invoiceGross({ amount: null, tax_amount: 0, tax_treatment: 'exclusive' })).toBeNull();
  });
  it('AC-NAR-003 a PMO invoice with part of its gross settled is Partly paid', () => {
    expect(isPartlyPaid(unpaid)).toBe(true);
  });
  it('AC-NAR-003 nothing settled, fully settled, Paid, or an ERP invoice is never Partly paid', () => {
    expect(isPartlyPaid({ ...unpaid, erp_outstanding_amount: 1_110_000 })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, erp_outstanding_amount: 0 })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, status: 'Paid' })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, pmo_native: false })).toBe(false);
    expect(isPartlyPaid({ ...unpaid, erp_outstanding_amount: null })).toBe(false);
  });
  it('AC-NAR-002 the number read is the ERP number, else the PMO number', () => {
    expect(invoiceNumber({ si_number: 'ACC-SINV-1', pmo_number: null })).toBe('ACC-SINV-1');
    expect(invoiceNumber({ si_number: null, pmo_number: 'INV-2610070001' })).toBe('INV-2610070001');
    expect(invoiceNumber({ si_number: null })).toBeNull();
    expect(receiptNumber({ ip_number: null, pmo_number: 'RCV-2610070001' })).toBe('RCV-2610070001');
  });
  it('AC-NAR-002 a PMO invoice is summarised by its first line and how many more', () => {
    const line = { item_code: 'SVC', description: 'Site survey', qty: 1, rate: 1, amount: 1 };
    expect(nativeInvoiceSummary({ native_lines: [line] })).toBe('Site survey');
    expect(nativeInvoiceSummary({ native_lines: [line, { ...line, description: null }] })).toBe('Site survey +1');
    expect(nativeInvoiceSummary({ native_lines: [{ ...line, description: null }] })).toBe('SVC');
    expect(nativeInvoiceSummary({ native_lines: null })).toBeNull();
  });
});
```
Run `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/revenue/nativeInvoice.test.ts)` → RED (module missing).

**Step 2 — implementation** `pmo-portal/src/lib/revenue/nativeInvoice.ts`:

```ts
/**
 * #784 — the pure display rules the PMO-native revenue surfaces share (docs/specs/no-erp-revenue.spec.md).
 * Display only: migration 0270's RPCs are the authority for every figure these read.
 */
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** One line of a PMO invoice as raised (DD-NAR-8). */
export interface NativeInvoiceLine {
  item_code: string | null;
  description: string | null;
  qty: number;
  rate: number;
  amount: number;
}

/** The number a person reads for an invoice: the ERP's document name when it has one, else PMO's own (DD-NAR-9). */
export function invoiceNumber(inv: { si_number: string | null; pmo_number?: string | null }): string | null {
  return inv.si_number ?? inv.pmo_number ?? null;
}

/** The number a person reads for a receipt: the ERP's, else PMO's own. */
export function receiptNumber(p: { ip_number: string | null; pmo_number?: string | null }): string | null {
  return p.ip_number ?? p.pmo_number ?? null;
}

/** What the client owes in full, by 0188's rule: an inclusive amount already holds its tax. */
export function invoiceGross(inv: { amount: number | null; tax_amount: number; tax_treatment: string }): number | null {
  if (inv.amount == null) return null;
  if (inv.tax_treatment === 'inclusive') return inv.amount;
  return Math.round((inv.amount + inv.tax_amount) * 100) / 100;
}

/** DD-NAR-3: "Partly paid" is how a PMO invoice that is Unpaid with part of its gross settled reads. Never stored. */
export function isPartlyPaid(
  inv: Pick<SalesInvoiceRow, 'status' | 'erp_outstanding_amount' | 'amount' | 'tax_amount' | 'tax_treatment'> & {
    pmo_native?: boolean;
  },
): boolean {
  if (!inv.pmo_native || inv.status !== 'Unpaid' || inv.erp_outstanding_amount == null) return false;
  const gross = invoiceGross(inv);
  return gross != null && inv.erp_outstanding_amount > 0 && inv.erp_outstanding_amount < gross;
}

/** What a PMO invoice bills, in one line of text: its first line, plus how many more. */
export function nativeInvoiceSummary(inv: { native_lines?: NativeInvoiceLine[] | null }): string | null {
  const lines = inv.native_lines ?? [];
  if (lines.length === 0) return null;
  const first = lines[0].description ?? lines[0].item_code ?? '';
  return lines.length > 1 ? `${first} +${lines.length - 1}` : first;
}
```
**Verify (GREEN):** same command → 5 passed.

---

## Task 20 — DAL `revenueNative.ts` (TDD, 5 min) — AC-NAR-001/002/003/006 (support)

**Step 1 — failing test** `pmo-portal/src/lib/db/revenueNative.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { cancelNativeReceipt, createNativeSalesInvoice, recordNativeReceipt, transitionNativeSalesInvoice } from './revenueNative';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: 'new-id', error: null });
});

describe('revenueNative DAL (#784) — names the four RPCs and sends what the user entered', () => {
  it('AC-NAR-001 raises an invoice with its project, customer, lines and work order', async () => {
    const lines = [{ item_code: 'SVC', qty: 2, rate: 500000, description: 'Site survey' }];
    await expect(createNativeSalesInvoice({ projectId: 'p-1', customerId: 'c-1', lines, workOrderId: 'wo-1' })).resolves.toBe('new-id');
    expect(h.rpc).toHaveBeenCalledWith('create_native_sales_invoice', {
      p_project_id: 'p-1', p_customer_id: 'c-1', p_lines: lines, p_work_order_id: 'wo-1',
    });
  });
  it('AC-NAR-001 sends no work order when there is none', async () => {
    await createNativeSalesInvoice({ projectId: 'p-1', customerId: 'c-1', lines: [{ item_code: 'SVC', qty: 1, rate: 1 }], workOrderId: null });
    expect(h.rpc.mock.calls[0][1]).not.toHaveProperty('p_work_order_id');
  });
  it('AC-NAR-002 approves (Unpaid) and AC-NAR-005 cancels through the one transition RPC', async () => {
    await transitionNativeSalesInvoice('si-1', 'Unpaid');
    await transitionNativeSalesInvoice('si-1', 'Cancelled');
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'transition_native_sales_invoice', { p_id: 'si-1', p_to: 'Unpaid' });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'transition_native_sales_invoice', { p_id: 'si-1', p_to: 'Cancelled' });
  });
  it('AC-NAR-003 records a receipt with the settled, cash and withheld amounts and the slip', async () => {
    await expect(recordNativeReceipt({ salesInvoiceId: 'si-1', amount: 610000, receivedAmount: 600000, withheldAmount: 10000, withholdingSlipNumber: ' BP-1 ', date: '2026-10-07' })).resolves.toBe('new-id');
    expect(h.rpc).toHaveBeenCalledWith('record_native_receipt', {
      p_sales_invoice_id: 'si-1', p_amount: 610000, p_received_amount: 600000, p_withheld_amount: 10000,
      p_withholding_slip_number: 'BP-1', p_date: '2026-10-07',
    });
  });
  it('AC-NAR-006 cancels a receipt by id', async () => {
    await cancelNativeReceipt('ip-1');
    expect(h.rpc).toHaveBeenCalledWith('cancel_native_receipt', { p_receipt_id: 'ip-1' });
  });
  it('AC-NAR-002 a server refusal reaches the caller with its SQLSTATE', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'approver must differ from author (SoD)', code: '42501' } });
    const err = await transitionNativeSalesInvoice('si-1', 'Unpaid').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: '42501' });
  });
});
```
Run `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/revenueNative.test.ts)` → RED.

**Step 2 — implementation** `pmo-portal/src/lib/db/revenueNative.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Json } from '@/src/lib/supabase/database.types';

/**
 * #784 (ADR-0055 addendum 2026-10-07): the PMO-native revenue writes — used while no ERP owns revenue for the org.
 * Every write is a SECURITY DEFINER RPC (migration 0270) that enforces role (Admin/Finance), approval SoD, ownership and
 * balance rules; this module only names them.
 */
export interface NativeInvoiceLineInput {
  item_code: string;
  qty: number;
  rate: number;
  description?: string;
}

export interface NativeInvoiceInput {
  projectId: string;
  customerId: string;
  /** Pre-tax lines; PPN is added server-side from the project's VAT setting (OD-TAX-4). */
  lines: NativeInvoiceLineInput[];
  workOrderId?: string | null;
}

export interface NativeReceiptInput {
  salesInvoiceId: string;
  /** The amount settled on the invoice, tax withheld included (DD-RCPT-1). */
  amount: number;
  receivedAmount?: number;
  withheldAmount?: number;
  withholdingSlipNumber?: string | null;
  date?: string;
}

function fail(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

export async function createNativeSalesInvoice(input: NativeInvoiceInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_native_sales_invoice', {
    p_project_id: input.projectId,
    p_customer_id: input.customerId,
    p_lines: input.lines as unknown as Json,
    ...(input.workOrderId ? { p_work_order_id: input.workOrderId } : {}),
  });
  if (error) fail(error);
  return String(data);
}

export async function transitionNativeSalesInvoice(id: string, to: 'Unpaid' | 'Cancelled'): Promise<void> {
  const { error } = await supabase.rpc('transition_native_sales_invoice', { p_id: id, p_to: to });
  if (error) fail(error);
}

export async function recordNativeReceipt(input: NativeReceiptInput): Promise<string> {
  const slip = input.withholdingSlipNumber?.trim();
  const { data, error } = await supabase.rpc('record_native_receipt', {
    p_sales_invoice_id: input.salesInvoiceId,
    p_amount: input.amount,
    ...(input.receivedAmount !== undefined ? { p_received_amount: input.receivedAmount } : {}),
    ...(input.withheldAmount !== undefined ? { p_withheld_amount: input.withheldAmount } : {}),
    ...(slip ? { p_withholding_slip_number: slip } : {}),
    ...(input.date ? { p_date: input.date } : {}),
  });
  if (error) fail(error);
  return String(data);
}

export async function cancelNativeReceipt(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_native_receipt', { p_receipt_id: id });
  if (error) fail(error);
}
```
**Verify (GREEN):** same command → 6 passed; `(cd pmo-portal && npx tsc --noEmit -p . 2>&1 | grep revenueNative || echo clean)` prints `clean`.

---

## Task 21 — `revenue.ts`: new row fields + list filters (TDD, 4 min) — AC-NAR-002 (support)

**Step 1 — failing test** `pmo-portal/src/lib/db/revenue.listFilters.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const eqCalls: Array<[string, unknown]> = [];
  const builder = () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (column: string, value: unknown) => { eqCalls.push([column, value]); return b; },
      order: () => b,
      range: () => b,
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
    });
    return b;
  };
  return { eqCalls, from: vi.fn(() => builder()) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listSalesInvoices } from './revenue';

beforeEach(() => { h.eqCalls.length = 0; });

describe('listSalesInvoices filters (#784)', () => {
  it('AC-NAR-002 the approvals queue reads only PMO drafts', async () => {
    await listSalesInvoices({ status: 'Draft', nativeOnly: true });
    expect(h.eqCalls).toEqual(expect.arrayContaining([['status', 'Draft'], ['pmo_native', true]]));
  });
  it('an unfiltered list adds no filter (the Sales Invoices page is unchanged)', async () => {
    await listSalesInvoices();
    expect(h.eqCalls).toEqual([]);
  });
});
```
Run `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/revenue.listFilters.test.ts)` → RED.

**Step 2 — edits in** `pmo-portal/src/lib/db/revenue.ts`:
- In `interface SalesInvoiceRow`, after `received_date: string | null;` add:
  ```ts
  /** #784 (DD-NAR-2): true for an invoice raised in PMO while no ERP owned revenue; written only by migration 0270's RPCs. */
  pmo_native?: boolean;
  /** #784 (DD-NAR-9): PMO's own invoice number, minted on approval; null for a Draft and for ERP invoices. */
  pmo_number?: string | null;
  /** #784 (DD-NAR-8): the lines of a PMO invoice as raised. */
  native_lines?: Array<{ item_code: string | null; description: string | null; qty: number; rate: number; amount: number }> | null;
  /** #784 (FR-NAR-005): who approved a PMO invoice, and when. */
  approved_by_id?: string | null;
  approved_at?: string | null;
  ```
- In `interface IncomingPaymentRow`, after `created_at: string;` add:
  ```ts
  /** #784 (DD-NAR-2): a receipt recorded in PMO against a PMO invoice. */
  pmo_native?: boolean;
  /** #784 (DD-NAR-9): PMO's own receipt number. */
  pmo_number?: string | null;
  /** #784 (DD-NAR-10): set when a PMO receipt is cancelled. */
  cancelled_at?: string | null;
  ```
- Replace the signature line `  params?: { projectId?: string } & PageParams,` of `listSalesInvoices` with
  `  params?: { projectId?: string; status?: SalesInvoiceStatus; nativeOnly?: boolean } & PageParams,`
- Replace `    if (params?.projectId) query = query.eq('project_id', params.projectId);` with:
  ```ts
    if (params?.projectId) query = query.eq('project_id', params.projectId);
    if (params?.status) query = query.eq('status', params.status);
    if (params?.nativeOnly) query = query.eq('pmo_native', true);
  ```

**Verify (GREEN):** `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/revenue.listFilters.test.ts src/lib/db/revenue.test.ts)` → all pass.

---

## Task 22 — `useRevenueMode` (TDD, 3 min) — AC-NAR-001/004 (support)

**Step 1 — failing test** `pmo-portal/src/hooks/useRevenueMode.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn() }));

import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { useRevenueMode } from './useRevenueMode';

describe('useRevenueMode (#784)', () => {
  it('AC-NAR-001 reads native while no ERP owns revenue', () => {
    vi.mocked(routeDomainWrite).mockReturnValue('pmo');
    expect(renderHook(() => useRevenueMode()).result.current).toBe('native');
    expect(routeDomainWrite).toHaveBeenCalledWith('revenue');
  });
  it('AC-NAR-004 reads erp once an ERP owns revenue', () => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    expect(renderHook(() => useRevenueMode()).result.current).toBe('erp');
  });
});
```
RED: `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/hooks/useRevenueMode.test.ts)`.

**Step 2 — implementation** `pmo-portal/src/hooks/useRevenueMode.ts`:

```ts
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';

export type RevenueMode = 'native' | 'erp';

/**
 * #784 (DD-NAR-1): who raises this org's customer invoices — PMO ('native') or the connected ERP ('erp'). Reads the
 * same fail-closed ownership cache the repository routes writes by, so a surface and its write path never disagree.
 * A cold cache reads 'native'; the server refuses a PMO write while an ERP owns revenue, so the worst case is an
 * honest refusal, never a wrong write.
 */
export function useRevenueMode(): RevenueMode {
  return routeDomainWrite('revenue') === 'external' ? 'erp' : 'native';
}
```
**Verify (GREEN):** same command → 2 passed.

---

## Task 23 — RED: repository native routing; retire the superseded cold-map block (5 min) — AC-NAR-001..006, AC-NAR-004 never-dispatch

**Step 1 — retire** in `pmo-portal/src/lib/repositories/revenue.external.test.ts`:
- Delete the whole block that starts `describe('AC-SAR-001 cold ownership map — revenue writes are rejected with revenue-not-enabled', () => {`
  and ends at its closing `});` (the five `it(…revenue-not-enabled…)` cases).
- Delete the import line `import { AppError } from '@/src/lib/appError';` — its only two uses were in the deleted
  block (`grep -n AppError pmo-portal/src/lib/repositories/revenue.external.test.ts` must then print nothing), so
  leaving it would fail ESLint's unused-import rule.
- In the file header comment, replace the lines
  ```
   * With an empty/cold ownership map (the state of every non-flipped org — every client that does NOT
   * employ ERPNext for revenue, FR-SAR-004), every revenue write on `repositories.revenue.*`
   * must be rejected at the repository layer with `revenue-not-enabled` (OQ-SAR-6: no PMO-native path
   * today) and **never** dispatch — `dispatchSpy` uncalled.
  ```
  with
  ```
   * #784 (OD-REEL-1) replaced OQ-SAR-6's deferral: with an empty/cold ownership map every revenue write now
   * takes the PMO-native path — and still **never** dispatches. That contract (and its never-dispatch goal)
   * lives in revenue.native.test.ts.
  ```
  *(Why this is not weakening a test: the deleted assertions encoded "no PMO-native path", which the owner ruled
  must exist; their goal — a cold map never reaches the ERP — is asserted again, per write, in the new file.)*

**Step 2 — failing test** `pmo-portal/src/lib/repositories/revenue.native.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #784 — the repository's PMO-native revenue path. While no ERP owns revenue (cold or 'pmo' route), every revenue
 * write goes to migration 0270's RPCs and NEVER dispatches to the ERP (the goal AC-SAR-001 always asserted). Once an
 * ERP owns revenue, a row raised in PMO before connect is history: it is never pushed (AC-NAR-004).
 */
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: vi.fn() }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  clearOwnershipCache: vi.fn(),
  setDomainOwnership: vi.fn(),
  routeDomainWrite: vi.fn(),
}));
vi.mock('@/src/lib/db/revenue', () => ({
  submitSalesInvoiceSod: vi.fn(),
  getSalesInvoice: vi.fn(),
  getIncomingPayment: vi.fn(),
}));
vi.mock('@/src/lib/db/revenueNative', () => ({
  createNativeSalesInvoice: vi.fn(),
  transitionNativeSalesInvoice: vi.fn(),
  recordNativeReceipt: vi.fn(),
  cancelNativeReceipt: vi.fn(),
}));

import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import * as revenueDb from '@/src/lib/db/revenue';
import * as native from '@/src/lib/db/revenueNative';
import { repositories } from '@/src/lib/repositories';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(routeDomainWrite).mockReturnValue('pmo');
  vi.mocked(native.createNativeSalesInvoice).mockResolvedValue('si-native-1');
  vi.mocked(native.transitionNativeSalesInvoice).mockResolvedValue(undefined);
  vi.mocked(native.recordNativeReceipt).mockResolvedValue('ip-native-1');
  vi.mocked(native.cancelNativeReceipt).mockResolvedValue(undefined);
});

describe('no ERP owns revenue — writes take the PMO path and never dispatch (AC-SAR-001 goal kept)', () => {
  it('AC-NAR-001 createInvoice raises a PMO invoice with the typed lines and never dispatches', async () => {
    const items = [{ item_code: 'SVC', qty: 2, rate: 500000, description: 'Site survey' }];
    await expect(repositories.revenue.createInvoice({ customerId: 'c-1', projectId: 'p-1', items }))
      .resolves.toEqual({ id: 'si-native-1', si_number: '' });
    expect(native.createNativeSalesInvoice).toHaveBeenCalledWith({ projectId: 'p-1', customerId: 'c-1', lines: items, workOrderId: null });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-001 a PMO invoice without a project is refused before any write', async () => {
    await expect(repositories.revenue.createInvoice({ customerId: 'c-1', items: [{ item_code: 'SVC', qty: 1, rate: 1 }] }))
      .rejects.toMatchObject({ code: 'native-invoice-needs-project' });
    expect(native.createNativeSalesInvoice).not.toHaveBeenCalled();
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-002 submitInvoice approves in PMO and never dispatches', async () => {
    await repositories.revenue.submitInvoice('si-1');
    expect(native.transitionNativeSalesInvoice).toHaveBeenCalledWith('si-1', 'Unpaid');
    expect(revenueDb.submitSalesInvoiceSod).not.toHaveBeenCalled();
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-005 cancelInvoice cancels in PMO and never dispatches', async () => {
    await repositories.revenue.cancelInvoice('si-1');
    expect(native.transitionNativeSalesInvoice).toHaveBeenCalledWith('si-1', 'Cancelled');
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-003 createPayment records a PMO receipt against the invoice', async () => {
    await expect(repositories.revenue.createPayment({ customerId: 'c-1', salesInvoiceId: 'si-1', paidAmount: 610000, receivedAmount: 600000, withheldAmount: 10000, withholdingSlipNumber: 'BP-1', date: '2026-10-07' }))
      .resolves.toEqual({ id: 'ip-native-1', ip_number: '' });
    expect(native.recordNativeReceipt).toHaveBeenCalledWith({ salesInvoiceId: 'si-1', amount: 610000, receivedAmount: 600000, withheldAmount: 10000, withholdingSlipNumber: 'BP-1', date: '2026-10-07' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-003 a PMO receipt must name its invoice', async () => {
    await expect(repositories.revenue.createPayment({ customerId: 'c-1', salesInvoiceId: null, paidAmount: 1, receivedAmount: 1, date: '2026-10-07' }))
      .rejects.toMatchObject({ code: 'native-receipt-needs-invoice' });
    expect(native.recordNativeReceipt).not.toHaveBeenCalled();
  });
  it('AC-NAR-006 cancelPayment cancels a PMO receipt and never dispatches', async () => {
    await repositories.revenue.cancelPayment('ip-1');
    expect(native.cancelNativeReceipt).toHaveBeenCalledWith('ip-1');
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
});

describe('an ERP owns revenue — a PMO row from before connect is never pushed (AC-NAR-004)', () => {
  beforeEach(() => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    vi.mocked(revenueDb.getSalesInvoice).mockResolvedValue({ si_number: null, pmo_native: true } as unknown as Awaited<ReturnType<typeof revenueDb.getSalesInvoice>>);
    vi.mocked(revenueDb.getIncomingPayment).mockResolvedValue({ ip_number: null, pmo_native: true } as unknown as Awaited<ReturnType<typeof revenueDb.getIncomingPayment>>);
  });
  it('AC-NAR-004 submitInvoice on a PMO invoice is refused and never dispatched', async () => {
    await expect(repositories.revenue.submitInvoice('si-1')).rejects.toMatchObject({ code: 'native-revenue-read-only' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-004 cancelInvoice on a PMO invoice is refused and never dispatched', async () => {
    await expect(repositories.revenue.cancelInvoice('si-1')).rejects.toMatchObject({ code: 'native-revenue-read-only' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-004 cancelPayment on a PMO receipt is refused and never dispatched', async () => {
    await expect(repositories.revenue.cancelPayment('ip-1')).rejects.toMatchObject({ code: 'native-revenue-read-only' });
    expect(dispatchDomainCommand).not.toHaveBeenCalled();
  });
  it('AC-NAR-004 the PMO path is never called once an ERP owns revenue', async () => {
    await repositories.revenue.submitInvoice('si-1').catch(() => undefined);
    expect(native.transitionNativeSalesInvoice).not.toHaveBeenCalled();
  });
});
```
RED: `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/repositories/revenue.native.test.ts)` → fails (`createNativeSalesInvoice` not called; `revenue-not-enabled`).

---

## Task 24 — GREEN: repository native branches (5 min)

**Edits in** `pmo-portal/src/lib/repositories/index.ts`:

1. After the `} from '@/src/lib/db/revenue';` import block add:
   ```ts
   import {
     createNativeSalesInvoice,
     transitionNativeSalesInvoice,
     recordNativeReceipt,
     cancelNativeReceipt,
   } from '@/src/lib/db/revenueNative';
   ```
2. Immediately above `const revenue: RevenueRepository = {` add:
   ```ts
   /** #784 AC-NAR-004 (DD-NAR-11): a PMO invoice or receipt from before the ERP took revenue over is history — never pushed. */
   function nativeReadOnly(): AppError {
     return new AppError('this was recorded in PMO before the ERP was connected and is read-only', 'native-revenue-read-only');
   }

   /** #784 (DD-NAR-1/7): no ERP owns revenue — PMO raises the invoice. The project decides its VAT, so it is required. */
   function nativeCreateInvoice(input: Parameters<RevenueRepository['createInvoice']>[0]): Promise<{ id: string; si_number: string }> {
     const projectId = input.projectId;
     if (!projectId) {
       return Promise.reject(new AppError('an invoice raised in PMO needs a project — the project decides its VAT', 'native-invoice-needs-project'));
     }
     return wrap(() => createNativeSalesInvoice({
       projectId,
       customerId: input.customerId,
       lines: input.items,
       workOrderId: input.workOrderId ?? null,
     })).then((id) => ({ id, si_number: '' }));
   }

   /** #784 (FR-NAR-007): a PMO receipt settles a named PMO invoice — there is no on-account receipt without an ERP. */
   function nativeCreatePayment(input: Parameters<RevenueRepository['createPayment']>[0]): Promise<{ id: string; ip_number: string }> {
     const salesInvoiceId = input.salesInvoiceId;
     if (!salesInvoiceId) {
       return Promise.reject(new AppError('a receipt recorded in PMO must name the invoice it settles', 'native-receipt-needs-invoice'));
     }
     return wrap(() => recordNativeReceipt({
       salesInvoiceId,
       amount: input.paidAmount,
       receivedAmount: input.receivedAmount ?? input.paidAmount - (input.withheldAmount ?? 0),
       withheldAmount: input.withheldAmount ?? 0,
       ...(input.withholdingSlipNumber ? { withholdingSlipNumber: input.withholdingSlipNumber } : {}),
       date: input.date,
     })).then((id) => ({ id, ip_number: '' }));
   }
   ```
3. In `createInvoice`, replace its last line
   `      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),`
   with `      : nativeCreateInvoice(input),`
4. In `createPayment`, replace its last line (same `Promise.reject(… 'revenue-not-enabled')),` text, the one after the
   `.then((res) => ({ id: String(res.canonical.id), ip_number: …`) with `      : nativeCreatePayment(input),`
5. In `submitInvoice`, replace
   ```ts
           const si = await getSalesInvoice(siId);
           if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
           await dispatchDomainCommand(
             'revenue',
             'transition',
             { id: siId, erp_doc_kind: 'sales-invoice', verb: 'submit', externalRecordId: si.si_number },
             keyFor(intent),
           );
         } else {
           throw new AppError('revenue is not enabled for this org', 'revenue-not-enabled');
         }
   ```
   with
   ```ts
           const si = await getSalesInvoice(siId);
           if (si?.pmo_native) throw nativeReadOnly();
           if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
           await dispatchDomainCommand(
             'revenue',
             'transition',
             { id: siId, erp_doc_kind: 'sales-invoice', verb: 'submit', externalRecordId: si.si_number },
             keyFor(intent),
           );
         } else {
           // #784 (FR-NAR-005): approve in PMO — the RPC enforces approver ≠ author and the approver's current role.
           await transitionNativeSalesInvoice(siId, 'Unpaid');
         }
   ```
6. In `cancelInvoice`, replace
   ```ts
             const si = await getSalesInvoice(siId);
             if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
   ```
   with
   ```ts
             const si = await getSalesInvoice(siId);
             if (si?.pmo_native) throw nativeReadOnly();
             if (!si || !si.si_number) throw new AppError('sales invoice not found or missing si_number', 'not-found');
   ```
   and its last line `      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),`
   with `      : wrap(() => transitionNativeSalesInvoice(siId, 'Cancelled')),`
7. In `cancelPayment`, replace
   ```ts
             const ip = await getIncomingPayment(ipId);
             if (!ip || !ip.ip_number) throw new AppError('incoming payment not found or missing ip_number', 'not-found');
   ```
   with
   ```ts
             const ip = await getIncomingPayment(ipId);
             if (ip?.pmo_native) throw nativeReadOnly();
             if (!ip || !ip.ip_number) throw new AppError('incoming payment not found or missing ip_number', 'not-found');
   ```
   and its last line `      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),`
   with `      : wrap(() => cancelNativeReceipt(ipId)),`

**Edit in** `pmo-portal/src/lib/repositories/types.ts` (`RevenueRepository`): replace
`  listInvoices(params?: { projectId?: string } & PageParams): Promise<SalesInvoiceRow[]>;` with
`  listInvoices(params?: { projectId?: string; status?: SalesInvoiceRow['status']; nativeOnly?: boolean } & PageParams): Promise<SalesInvoiceRow[]>;`

**Verify (GREEN):**
```bash
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/repositories/revenue.native.test.ts src/lib/repositories/revenue.external.test.ts src/lib/repositories/index.test.ts src/lib/repositories/progressBilling.test.ts \
  && npm run typecheck && npx eslint --max-warnings=0 src/lib/repositories/index.ts src/lib/repositories/types.ts src/lib/db/revenueNative.ts src/lib/repositories/revenue.external.test.ts src/lib/repositories/revenue.native.test.ts)
```
→ all pass; typecheck 0 errors; lint clean (`progressBilling.raiseInvoice` keeps `revenue-not-enabled` — claims without
an ERP are out of scope).

---

## Task 25 — `useNativeDraftInvoices` (3 min) — AC-NAR-002 (support)

**Edit** `pmo-portal/src/hooks/useRevenue.ts` — after `useSalesInvoice` add:

```ts
/**
 * #784 (DD-NAR-12): the PMO drafts the approvals queue offers — PMO-native Drafts only (partial index
 * sales_invoices_native_draft_idx). `enabled` lets the queue skip the read for a viewer who cannot approve.
 * Shares the 'salesInvoices' key prefix, so every revenue mutation's invalidation refreshes it.
 */
export function useNativeDraftInvoices(enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesInvoiceRow[]>({
    queryKey: ['salesInvoices', orgId, 'native-drafts'],
    queryFn: () => repositories.revenue.listInvoices({ status: 'Draft', nativeOnly: true }),
    enabled: Boolean(orgId) && enabled,
  });
}
```

**Verify:** `(cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 src/hooks/useRevenue.ts)` → clean. (Behaviour is
proven through the section tests in Task 29, which mock this hook, and the e2e in Task 33.)

---

## Task 26 — i18n keys (en + id) and the launch-scope route line (4 min) — NFR-NAR-006

1. `pmo-portal/public/locales/en/common.json` — immediately after the line `  "financeCopy": {` insert:
   ```json
       "nativeSalesInvoicesDescription": "Client invoices raised, approved and settled in PMO.",
       "nativeNewInvoiceSubtitle": "Raises a draft. A different Finance or Admin user approves it.",
       "nativeProjectRequired": "Project is required: it decides the invoice's VAT.",
       "nativeSelectProject": "Select project…",
       "approve": "Approve",
       "approveInvoiceNamed": "Approve the invoice for {{customer}}?",
       "approveInvoiceBody": "Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it.",
       "approveInvoice": "Approve invoice",
       "invoiceApproved": "Invoice approved",
       "nativeCancelInvoiceBody": "This cancels the invoice in PMO and it stops counting as billed. An invoice with receipts can be cancelled only after its receipts are cancelled.",
       "statusPartlyPaid": "Partly paid",
       "recordedBeforeErp": "Recorded in PMO before the ERP was connected",
       "nativeIncomingPaymentsDescription": "Customer receipts recorded in PMO against approved invoices.",
       "salesInvoiceLabel": "Sales Invoice",
       "salesInvoiceRequired": "Choose the invoice this receipt settles.",
       "nativeCancelReceiptBody": "This cancels the receipt in PMO and puts its amount back on the invoice's balance.",
       "receiptCancelled": "Receipt cancelled",
   ```
   and immediately after the first line that is exactly `  "approvals": {` insert:
   ```json
       "salesInvoices": {
         "label": "Customer invoices awaiting you",
         "heading": "Customer invoices awaiting you ({{count}})",
         "errorTitle": "Couldn't load invoices awaiting you",
         "errorSub": "Purchase requests and timesheets below are unaffected."
       },
   ```
2. `pmo-portal/public/locales/id/common.json` — same two positions:
   ```json
       "nativeSalesInvoicesDescription": "Faktur klien yang dibuat, disetujui, dan dilunasi di PMO.",
       "nativeNewInvoiceSubtitle": "Membuat draf. Pengguna Finance atau Admin lain yang menyetujuinya.",
       "nativeProjectRequired": "Proyek wajib diisi: proyek menentukan PPN faktur.",
       "nativeSelectProject": "Pilih proyek…",
       "approve": "Setujui",
       "approveInvoiceNamed": "Setujui faktur untuk {{customer}}?",
       "approveInvoiceBody": "Persetujuan menerbitkan faktur: faktur mendapat nomor, menjadi Belum Dibayar, dan dapat menerima pembayaran. Pembuatnya tidak dapat menyetujuinya.",
       "approveInvoice": "Setujui faktur",
       "invoiceApproved": "Faktur disetujui",
       "nativeCancelInvoiceBody": "Ini membatalkan faktur di PMO sehingga tidak lagi dihitung sebagai tagihan. Faktur yang memiliki penerimaan hanya dapat dibatalkan setelah penerimaannya dibatalkan.",
       "statusPartlyPaid": "Dibayar sebagian",
       "recordedBeforeErp": "Dicatat di PMO sebelum ERP terhubung",
       "nativeIncomingPaymentsDescription": "Penerimaan pelanggan yang dicatat di PMO atas faktur yang telah disetujui.",
       "salesInvoiceLabel": "Faktur Penjualan",
       "salesInvoiceRequired": "Pilih faktur yang dilunasi penerimaan ini.",
       "nativeCancelReceiptBody": "Ini membatalkan penerimaan di PMO dan mengembalikan jumlahnya ke saldo faktur.",
       "receiptCancelled": "Penerimaan dibatalkan",
   ```
   ```json
       "salesInvoices": {
         "label": "Faktur pelanggan yang menunggu Anda",
         "heading": "Faktur pelanggan yang menunggu Anda ({{count}})",
         "errorTitle": "Gagal memuat faktur yang menunggu Anda",
         "errorSub": "Permintaan pembelian dan lembar waktu di bawah tidak terpengaruh."
       },
   ```
3. `pmo-portal/src/lib/i18n/launch-scope-routes.txt` — replace
   `/approvals                     pages/Approvals.tsx pages/approvals/ExpenseClaimApprovalSection.tsx` with
   `/approvals                     pages/Approvals.tsx pages/approvals/ExpenseClaimApprovalSection.tsx pages/approvals/SalesInvoiceApprovalSection.tsx`

**Verify:** `node -e "JSON.parse(require('fs').readFileSync('pmo-portal/public/locales/en/common.json','utf8')); JSON.parse(require('fs').readFileSync('pmo-portal/public/locales/id/common.json','utf8')); console.log('json ok')"` → `json ok`.
(`npm run check:i18n` is run in Task 34, once the keys are referenced; until then the orphan half would flag them.)

---

## Task 27 — RED: Sales Invoices in PMO mode (5 min) — AC-NAR-001/002/003/004 (support)

**Step 1 — new test** `pmo-portal/pages/__tests__/SalesInvoices.native.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * #784 — Sales Invoices while PMO owns revenue. The form needs a project (it decides VAT, OD-TAX-4), the page says
 * invoices are raised and settled in PMO, a PMO Draft offers "Approve" to anyone but its author (real can(), no
 * stub), a part-paid PMO invoice reads "Partly paid", and once an ERP owns revenue a PMO invoice is history.
 */
const h = vi.hoisted(() => ({
  createMutate: vi.fn(async () => ({ id: 'si-new', si_number: '' })),
  submitMutate: vi.fn(async () => undefined),
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  route: 'pmo' as 'pmo' | 'external',
  userId: 'u-fin2',
}));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    create: { mutateAsync: h.createMutate, isPending: false },
    submitInvoice: { mutateAsync: h.submitMutate, isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }),
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => h.route) }));

import SalesInvoices from '../SalesInvoices';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n } from './financeI18nTestInstance';

const nativeInvoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'si-n1', org_id: 'org-1', project_id: 'proj-1', customer_id: 'cust-1', customer_name: 'Acme Energy',
  si_number: null, pmo_number: null, pmo_native: true, reference_number: null, invoice_date: null,
  amount: 1_000_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 110_000, tax_rate: 12,
  tax_base_numerator: 11, tax_base_denominator: 12, erp_outstanding_amount: null, status: 'Draft',
  erp_docstatus: null, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-07T00:00:00Z', author_user_id: 'u-fin1', author_user_ids: ['u-fin1'],
  erp_payment_terms_days: null, erp_due_date: null, received_date: null, ...over,
}) as SalesInvoiceRow;

const renderPage = () => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter>
        <ToastProvider>
          <SalesInvoices />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

async function pick(user: ReturnType<typeof userEvent.setup>, picker: string, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

beforeEach(async () => {
  h.createMutate.mockClear();
  h.submitMutate.mockClear();
  h.invoices.data = [];
  h.route = 'pmo';
  h.userId = 'u-fin2';
  await financeTestI18n.changeLanguage('en');
});

describe('Sales Invoices while PMO owns revenue (#784)', () => {
  it('AC-NAR-001 the page says invoices are raised and settled in PMO', () => {
    renderPage();
    expect(screen.getByText('Client invoices raised, approved and settled in PMO.')).toBeInTheDocument();
  });

  it('AC-NAR-001 a PMO invoice needs a project — Create stays disabled until one is chosen — and sends the typed line', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await user.type(screen.getByLabelText(/Item code/), 'SVC');
    await user.type(screen.getByLabelText('Description'), 'Site survey');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '500000');
    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeDisabled();
    await pick(user, 'Project', 'Alpha Platform');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect(h.createMutate).toHaveBeenCalledWith({
      customerId: 'cust-1',
      projectId: 'proj-1',
      items: [{ item_code: 'SVC', qty: 1, rate: 500000, description: 'Site survey' }],
      intent: { id: expect.any(String), idempotencyKey: expect.any(String) },
    });
  });

  it('AC-NAR-002 a PMO Draft offers "Approve" to a Finance user who did not raise it, and approving calls the approve path', async () => {
    h.invoices.data = [nativeInvoice()];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(h.submitMutate).toHaveBeenCalledWith({ siId: 'si-n1', intent: expect.objectContaining({ id: expect.any(String) }) });
  });

  it('AC-NAR-002 the author of a PMO Draft is not offered "Approve"', async () => {
    h.userId = 'u-fin1';
    h.invoices.data = [nativeInvoice()];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Approve' })).toBeNull();
  });

  it('AC-NAR-003 a part-paid PMO invoice reads "Partly paid" under its PMO number', () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000 })];
    renderPage();
    expect(screen.getAllByText('Partly paid')[0]).toBeInTheDocument();
    expect(screen.getAllByText('INV-2610070001')[0]).toBeInTheDocument();
  });

  it('AC-NAR-004 once an ERP owns revenue, a PMO invoice reads as recorded before connect and offers no Approve or Cancel', async () => {
    h.route = 'external';
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 1_110_000 })];
    const user = userEvent.setup();
    renderPage();
    expect(screen.getAllByText('Recorded in PMO before the ERP was connected')[0]).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Approve' })).toBeNull();
  });
});
```

**Step 2 — the existing form test meets the new required project** in `pmo-portal/pages/__tests__/SalesInvoices.createForm.test.tsx`
(route mock stays `'pmo'` — this file tests the standalone form, which is now the PMO form; requiring a project is a
deliberate UX change, DD-NAR-7; every goal assertion is unchanged):
- In `'AC-ITM-001/002 connected invoice searches ERP item name and submits separate authored description'`, after
  `await pick(user, 'Customer', 'Acme Energy');` add `await pick(user, 'Project', 'Alpha Platform');`.
- Rename `'enables "Create invoice" once a customer is chosen (it was permanently disabled)'` to
  `'enables "Create invoice" once a customer and project are chosen (it was permanently disabled)'` and after its
  `await pick(user, 'Customer', 'Acme Energy');` add:
  ```ts
      expect(screen.getByRole('button', { name: 'Create invoice' })).toBeDisabled();
      await pick(user, 'Project', 'Alpha Platform');
  ```
- In both `AC-PLC-009` tests and in `'submits every line the user added, not just the first'`, after
  `await pick(user, 'Customer', 'Acme Energy');` add `await pick(user, 'Project', 'Alpha Platform');`.

**Verify (RED):** `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/SalesInvoices.native.test.tsx)` → the native
file fails (copy, Approve label, Partly paid, frozen row absent; Create enabled without a project).

---

## Task 28 — GREEN: Sales Invoices PMO mode (5 min)

**Edits in** `pmo-portal/pages/SalesInvoices.tsx`:

1. After `import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';` add:
   ```ts
   import { useRevenueMode } from '@/src/hooks/useRevenueMode';
   import { invoiceNumber, isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';
   ```
2. Replace the first two lines of `validate`:
   ```ts
   const validate = (v: FormValues, t: (key: string, fallback: string, options?: Record<string, unknown>) => string): Partial<Record<keyof FormValues, string>> => {
     const errors: Partial<Record<keyof FormValues, string>> = {};
     if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
   ```
   with
   ```ts
   const validate = (
     v: FormValues,
     t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
     native = false,
   ): Partial<Record<keyof FormValues, string>> => {
     const errors: Partial<Record<keyof FormValues, string>> = {};
     if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
     // #784 (DD-NAR-7): the project decides a PMO invoice's VAT (OD-TAX-4), so a PMO invoice names one.
     if (native && !v.projectId) errors.projectId = t('financeCopy.nativeProjectRequired', "Project is required: it decides the invoice's VAT.");
   ```
3. After `const { create, setReceivedDate, submitInvoice, cancelInvoice, pendingPush } = useRevenueMutations();` add
   `  const native = useRevenueMode() === 'native';`
4. Replace `        || inv.si_number?.toLowerCase().includes(q)` with `        || invoiceNumber(inv)?.toLowerCase().includes(q)`.
5. Replace the whole `si_number` column object (from `key: 'si_number',` through its `exportValue: (inv) => inv.si_number ?? '',`) with:
   ```tsx
       key: 'si_number',
       header: t('financeCopy.invoice', "Invoice #"),
       cell: (inv) => (
         <span className="flex min-w-0 flex-col">
           <span className="truncate font-mono text-[13px]" title={invoiceNumber(inv) ?? ''}>
             {invoiceNumber(inv) ?? '—'}
           </span>
           {inv.pmo_native && !native && (
             <span className="text-[11px] text-muted-foreground">
               {t('financeCopy.recordedBeforeErp', 'Recorded in PMO before the ERP was connected')}
             </span>
           )}
         </span>
       ),
       exportValue: (inv) => invoiceNumber(inv) ?? '',
   ```
6. Replace the status column's `cell:` line with:
   ```tsx
       cell: (inv) => isPartlyPaid(inv)
         ? <StatusPill variant={salesInvoiceStatusVariant('Unpaid')}>{t('financeCopy.statusPartlyPaid', 'Partly paid')}</StatusPill>
         : <StatusPill variant={salesInvoiceStatusVariant(inv.status)}>{salesInvoiceStatusLabel(inv.status, t)}</StatusPill>,
   ```
7. Replace the body of `rowMenu` with:
   ```tsx
     const items: RowMenuItem[] = [];
     // #784 AC-NAR-004 (DD-NAR-11): a PMO invoice from before the ERP took revenue over is history — no approve or cancel.
     const frozen = Boolean(inv.pmo_native) && !native;
     if (canEdit) items.push({ label: t('financeCopy.edit', "Edit"), onClick: () => setFormTarget({ invoice: inv }) });
     // #767 AC-DUE-001: receipt is learned after submission, so this is offered in any non-cancelled
     // state to the revenue write set (the RPC enforces it; `can()` is UX only).
     if (canRecordReceipt && inv.status !== 'Cancelled')
       items.push({ label: t('financeCopy.recordReceivedDate', "Record received date"), onClick: () => setReceiptTarget(inv) });
     // A PMO invoice that is Paid is not cancellable (FR-NAR-009); an ERP one follows the ERP.
     if (canCancel && !frozen && inv.status !== 'Cancelled' && !(inv.pmo_native && inv.status === 'Paid'))
       items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(inv), danger: true });
     // Approve (PMO) / Submit (ERP): Draft only, gated by the same SoD predicate the RPCs enforce — the append-only
     // author SET union the legacy scalar, failing closed on an unattributed invoice.
     if (
       !frozen
       && inv.status === 'Draft'
       && may('submit_sales_invoice', 'salesInvoice', {
         currentUserId: currentUser?.id,
         record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
       })
     ) {
       items.push({
         label: inv.pmo_native ? t('financeCopy.approve', 'Approve') : t('financeCopy.submit', "Submit"),
         onClick: () => setSubmitTarget(inv),
       });
     }
     return items;
   ```
8. In `onSubmitConfirm`, replace
   `      toast(t('financeCopy.invoiceSubmitted', 'Invoice submitted'), submitTarget.si_number ?? submitTarget.id, 'success');` with
   ```tsx
         toast(
           submitTarget.pmo_native ? t('financeCopy.invoiceApproved', 'Invoice approved') : t('financeCopy.invoiceSubmitted', 'Invoice submitted'),
           invoiceNumber(submitTarget) ?? submitTarget.customer_name ?? submitTarget.id,
           'success',
         );
   ```
9. Replace the `ListPage` `description={…}` prop with:
   ```tsx
         description={native
           ? t('financeCopy.nativeSalesInvoicesDescription', 'Client invoices raised, approved and settled in PMO.')
           : t('financeCopy.clientInvoicesIssuedThroughPMOMirroredFromERPNextOutstandingAmountsAreERPSourced', "Client invoices issued through PMO, mirrored from ERPNext. Outstanding amounts are ERP-sourced.")}
   ```
10. On `<SalesInvoiceFormModal`, add the prop `native={native}` after `pendingPush={pendingPush}`.
11. Cancel `ConfirmDialog`: replace its `description={…}` with
    ```tsx
          description={cancelTarget?.pmo_native
            ? t('financeCopy.nativeCancelInvoiceBody', 'This cancels the invoice in PMO and it stops counting as billed. An invoice with receipts can be cancelled only after its receipts are cancelled.')
            : t('financeCopy.thisCancelsTheInvoiceInERPNextDocstatus12TheInvoiceWillBeMarkedCancelledAndCanNoLongerBeSubmittedOutstandingAmountIsReleased', "This cancels the invoice in ERPNext (docstatus 1→2). The invoice will be marked Cancelled and can no longer be submitted. Outstanding amount is released.")}
    ```
12. Submit `ConfirmDialog`: replace its `title`, `description` and `confirmLabel` props with
    ```tsx
          title={submitTarget?.pmo_native
            ? t('financeCopy.approveInvoiceNamed', 'Approve the invoice for {{customer}}?', { customer: submitTarget.customer_name ?? '' })
            : submitTarget ? t('financeCopy.submitInvoiceNamed', 'Submit {{invoice}}?', { invoice: submitTarget.si_number ?? submitTarget.id }) : t('financeCopy.submitInvoiceQuestion', 'Submit invoice?')}
          description={submitTarget?.pmo_native
            ? t('financeCopy.approveInvoiceBody', 'Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it.')
            : t('financeCopy.submitInvoiceForApprovalThisCommitsItToTheLedgerAndCannotBeUndoneByTheSubmitter', "Submit invoice for approval? This commits it to the ledger and cannot be undone by the submitter.")}
          confirmLabel={submitTarget?.pmo_native ? t('financeCopy.approveInvoice', 'Approve invoice') : t('financeCopy.submitInvoice', "Submit invoice")}
    ```
13. `SalesInvoiceFormModalProps`: add after `pendingPush: PendingPushState;`
    ```ts
      /** #784: true while PMO owns revenue — the project is required and lines carry a description. */
      native: boolean;
    ```
    and add `native,` to the component's destructured props after `pendingPush,`.
14. In the modal's `useEntityForm` call, replace `    validate: (values) => validate(values, t),` with
    `    validate: (values) => validate(values, t, native),` and `    requiredFields: ['customerId', 'lineItems'],` with
    `    requiredFields: native ? ['customerId', 'projectId', 'lineItems'] : ['customerId', 'lineItems'],`
15. Replace the modal's `errorSummary` declaration with:
    ```tsx
      const errorSummary = form.errors.customerId || form.errors.projectId || form.errors.lineItems
        ? [
            ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
            ...(form.errors.projectId ? [{ fieldId: projectField.id, message: form.errors.projectId }] : []),
            ...(form.errors.lineItems ? [{ fieldId: 'line-items', message: form.errors.lineItems }] : []),
          ]
        : undefined;
    ```
16. Replace `      subtitle={isEdit ? 'Update this sales invoice' : 'Create a new sales invoice for a client'}` with
    `      subtitle={native ? t('financeCopy.nativeNewInvoiceSubtitle', 'Raises a draft. A different Finance or Admin user approves it.') : (isEdit ? 'Update this sales invoice' : 'Create a new sales invoice for a client')}`
17. Replace `      {pendingPush.status !== 'idle' && (` (in the modal) with `      {!native && pendingPush.status !== 'idle' && (`.
18. In the Project `Combobox`, add `required={native}` after `label={t('financeCopy.project', "Project")}` and replace its
    `placeholder={…}` with
    `placeholder={native ? t('financeCopy.nativeSelectProject', 'Select project…') : t('financeCopy.selectProjectOptional', "Select project (optional)…")}`
19. Replace `              {erpItems.connected && (` (the Description `TextField` guard) with `              {(erpItems.connected || native) && (`.

**Verify (GREEN):**
```bash
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/SalesInvoices.native.test.tsx pages/__tests__/SalesInvoices.createForm.test.tsx pages/__tests__/SalesInvoices.commandIntent.test.tsx pages/__tests__/SalesInvoices.deepLink.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx pages/__tests__/Revenue.exportAndCurrency.test.tsx pages/__tests__/Revenue.exportNumeric.test.tsx pages/__tests__/Finance.customerDisplay.test.tsx \
  && npx eslint --max-warnings=0 pages/SalesInvoices.tsx)
```
→ all pass, lint clean.

---

## Task 29 — RED: the Approvals-page section (4 min) — AC-NAR-002 (support)

**File:** `pmo-portal/pages/approvals/SalesInvoiceApprovalSection.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  data: [] as unknown[],
  submit: vi.fn(async () => undefined),
  userId: 'u-fin2',
  route: 'pmo' as 'pmo' | 'external',
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useNativeDraftInvoices: () => ({ data: h.data, isPending: false, isError: false, refetch: vi.fn() }),
  useRevenueMutations: () => ({ submitInvoice: { mutateAsync: h.submit, isPending: false } }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => h.route) }));
vi.mock('@/src/hooks/useCommandIntent', () => ({
  useCommandIntentMap: () => ({ intentFor: () => ({ id: 'i-1', idempotencyKey: 'k-1' }), release: vi.fn() }),
}));

import { SalesInvoiceApprovalSection } from './SalesInvoiceApprovalSection';
import { FinanceI18nTestProvider } from '../__tests__/financeI18nTestProvider';

const draft = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'si-n1', org_id: 'org-1', project_id: 'proj-1', customer_id: 'cust-1', customer_name: 'Acme Energy',
  si_number: null, pmo_number: null, pmo_native: true, reference_number: null, invoice_date: null,
  amount: 1_000_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 110_000, tax_rate: 12,
  tax_base_numerator: 11, tax_base_denominator: 12, erp_outstanding_amount: null, status: 'Draft',
  erp_docstatus: null, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-07T00:00:00Z', author_user_id: 'u-fin1', author_user_ids: ['u-fin1'],
  erp_payment_terms_days: null, erp_due_date: null, received_date: null,
  native_lines: [{ item_code: 'SVC', description: 'Site survey', qty: 2, rate: 500_000, amount: 1_000_000 }], ...over,
}) as SalesInvoiceRow;

const renderSection = (role: Role = 'Finance') => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole={role}>
      <ToastProvider>
        <SalesInvoiceApprovalSection />
      </ToastProvider>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

beforeEach(() => {
  h.data = [draft()];
  h.submit.mockClear();
  h.userId = 'u-fin2';
  h.route = 'pmo';
});

describe('SalesInvoiceApprovalSection (#784)', () => {
  it('AC-NAR-002 lists a PMO draft the viewer did not raise, and approving it calls the approve path', async () => {
    const user = userEvent.setup();
    renderSection();
    expect(screen.getByRole('region', { name: 'Customer invoices awaiting you' })).toHaveTextContent('Site survey');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(h.submit).toHaveBeenCalledWith({ siId: 'si-n1', intent: { id: 'i-1', idempotencyKey: 'k-1' } });
  });
  it('AC-NAR-002 the author never sees their own draft here', () => {
    h.userId = 'u-fin1';
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-NAR-002 a Project Manager sees nothing — approval is Admin and Finance', () => {
    const { container } = renderSection('Project Manager');
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-NAR-004 once an ERP owns revenue the section shows nothing', () => {
    h.route = 'external';
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });
});
```
**Verify (RED):** `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/approvals/SalesInvoiceApprovalSection.test.tsx)` → fails (module missing).

---

## Task 30 — GREEN: section, mount on /approvals, isolate it in existing Approvals tests (5 min)

**a) File:** `pmo-portal/pages/approvals/SalesInvoiceApprovalSection.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, ConfirmDialog, ListState, TaxBasisLabel, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
import { useNativeDraftInvoices, useRevenueMutations } from '@/src/hooks/useRevenue';
import { useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyCents } from '@/src/lib/format';
import { nativeInvoiceSummary } from '@/src/lib/revenue/nativeInvoice';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * "Customer invoices awaiting you" on /approvals (#784 FR-NAR-006, DD-NAR-12): PMO drafts the viewer may approve — never
 * their own, by the same can() predicate as the Sales Invoices menu (the RPC is the authority). Hidden when none, when
 * the viewer cannot approve, or once an ERP owns revenue; a failed read says so rather than showing a false "nothing".
 */
export const SalesInvoiceApprovalSection: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const userId = useAuth().currentUser?.id;
  const native = useRevenueMode() === 'native';
  const canApprove = may('create', 'salesInvoice');
  const { data, isPending, isError, refetch } = useNativeDraftInvoices(canApprove && native);
  const { submitInvoice } = useRevenueMutations();
  const intents = useCommandIntentMap();
  const [target, setTarget] = useState<SalesInvoiceRow | null>(null);

  const rows = useMemo(
    () => (data ?? []).filter((inv) =>
      may('submit_sales_invoice', 'salesInvoice', {
        currentUserId: userId,
        record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
      })),
    [data, may, userId],
  );

  if (!canApprove || !native || isPending) return null;
  if (isError) {
    return (
      <div className="mb-4">
        <ListState variant="error" title={t('approvals.salesInvoices.errorTitle', "Couldn't load invoices awaiting you")}
          sub={t('approvals.salesInvoices.errorSub', 'Purchase requests and timesheets below are unaffected.')} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (rows.length === 0) return null;

  const onConfirm = async () => {
    if (!target) return;
    const key = `approve:${target.id}`;
    try {
      await submitInvoice.mutateAsync({ siId: target.id, intent: intents.intentFor(key) });
      intents.release(key);
      toast(t('financeCopy.invoiceApproved', 'Invoice approved'), target.customer_name ?? target.id, 'success');
      setTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <section aria-label={t('approvals.salesInvoices.label', 'Customer invoices awaiting you')} className="mb-4">
      <Card seam>
        <CardHead className="rounded-t-lg">{t('approvals.salesInvoices.heading', 'Customer invoices awaiting you ({{count}})', { count: rows.length })}</CardHead>
        <ul className="divide-y divide-border rounded-b-lg border-t border-border">
          {rows.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{inv.customer_name ?? '—'}</span>
              <span className="min-w-0 truncate text-muted-foreground">{nativeInvoiceSummary(inv) ?? '—'}</span>
              <span className="ml-auto inline-flex items-baseline gap-1.5">
                <span className="tabular-nums">{inv.amount != null ? formatCurrencyCents(inv.amount, inv.currency) : '—'}</span>
                <TaxBasisLabel treatment={inv.tax_treatment} taxRate={inv.tax_rate} taxBaseNumerator={inv.tax_base_numerator} taxBaseDenominator={inv.tax_base_denominator} />
              </span>
              <Button variant="outline" size="sm" onClick={() => setTarget(inv)}>{t('financeCopy.approve', 'Approve')}</Button>
            </li>
          ))}
        </ul>
      </Card>
      <ConfirmDialog
        open={!!target}
        title={t('financeCopy.approveInvoiceNamed', 'Approve the invoice for {{customer}}?', { customer: target?.customer_name ?? '' })}
        description={t('financeCopy.approveInvoiceBody', 'Approving issues the invoice: it gets its number, becomes Unpaid and can receive payments. Its author cannot approve it.')}
        confirmLabel={t('financeCopy.approveInvoice', 'Approve invoice')}
        loading={submitInvoice.isPending}
        onConfirm={onConfirm}
        onCancel={() => setTarget(null)}
      />
    </section>
  );
};
```

**b) Edit** `pmo-portal/pages/Approvals.tsx`: after
`import { ExpenseClaimApprovalSection } from './approvals/ExpenseClaimApprovalSection';` add
`import { SalesInvoiceApprovalSection } from './approvals/SalesInvoiceApprovalSection';`, and after
`      {canApproveProcurement && <ExpenseClaimApprovalSection />}` add `      <SalesInvoiceApprovalSection />`
(the section gates itself on the revenue write role and on PMO owning revenue).

**c) Isolate the new section in the four existing page tests** (same precedent as `useExpenseClaims`): add this line
next to their other `vi.mock(...)` calls in `pmo-portal/pages/Approvals.test.tsx`,
`pmo-portal/pages/__tests__/Approvals.inbox.test.tsx`, `pmo-portal/pages/__tests__/Approvals.pushAttention.test.tsx`
and `pmo-portal/pages/__tests__/Approvals.reopen.test.tsx`:
```ts
vi.mock('@/pages/approvals/SalesInvoiceApprovalSection', () => ({ SalesInvoiceApprovalSection: () => null }));
```

**Verify (GREEN):**
```bash
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/approvals/SalesInvoiceApprovalSection.test.tsx pages/Approvals.test.tsx pages/__tests__/Approvals.inbox.test.tsx pages/__tests__/Approvals.pushAttention.test.tsx pages/__tests__/Approvals.reopen.test.tsx pages/approvals/ExpenseClaimApprovalSection.test.tsx \
  && npx eslint --max-warnings=0 pages/approvals/SalesInvoiceApprovalSection.tsx pages/Approvals.tsx)
```

---

## Task 31 — RED: Incoming Payments in PMO mode (4 min) — AC-NAR-003/006 (support)

**a) File:** `pmo-portal/pages/__tests__/IncomingPayments.native.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  createPaymentMutate: vi.fn(async () => ({ id: 'ip-new' })),
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => h.payments,
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: h.createPaymentMutate, isPending: false },
    cancelPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));

import IncomingPayments from '../IncomingPayments';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n } from './financeI18nTestInstance';

const receipt = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Energy', sales_invoice_id: 'si-1',
  ip_number: null, pmo_number: 'RCV-2610070001', pmo_native: true, cancelled_at: null, reference_number: null,
  date: '2026-10-07', amount: 500_000, received_amount: 500_000, withheld_amount: 0, withholding_slip_number: null,
  currency: 'IDR', status: 'Paid', erp_docstatus: null, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-10-07T00:00:00Z', ...over,
}) as IncomingPaymentRow;

const renderPage = () => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter>
        <ToastProvider>
          <IncomingPayments />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

beforeEach(async () => {
  h.createPaymentMutate.mockClear();
  h.payments.data = [];
  h.invoices.data = [];
  await financeTestI18n.changeLanguage('en');
});

describe('Incoming Payments while PMO owns revenue (#784)', () => {
  it('AC-NAR-003 a receipt recorded in PMO must name the invoice it settles', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
    for (const label of [/Paid Amount/, /Received Amount/]) {
      const field = screen.getByLabelText(label);
      await user.clear(field);
      await user.type(field, '100');
    }
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect((await screen.findAllByText('Choose the invoice this receipt settles.')).length).toBeGreaterThan(0);
    expect(h.createPaymentMutate).not.toHaveBeenCalled();
  });

  it('AC-NAR-003 an open PMO invoice is offered by its PMO number', async () => {
    h.invoices.data = [{
      id: 'si-1', customer_id: 'cust-1', si_number: null, pmo_number: 'INV-2610070001', pmo_native: true,
      status: 'Unpaid', erp_outstanding_amount: 610_000, currency: 'IDR',
    } as unknown as SalesInvoiceRow];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    await user.click(screen.getByRole('combobox', { name: /Sales Invoice/ }));
    expect(within(await screen.findByRole('listbox')).getByRole('option', { name: /INV-2610070001/ })).toBeInTheDocument();
  });

  it('AC-NAR-006 a live PMO receipt offers Cancel; a cancelled one reads Cancelled', async () => {
    h.payments.data = [receipt(), receipt({ id: 'ip-2', pmo_number: 'RCV-2610070002', cancelled_at: '2026-10-07T01:00:00Z' })];
    const user = userEvent.setup();
    renderPage();
    expect(screen.getAllByText('RCV-2610070001')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Cancelled')[0]).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
  });
});
```

**b) The existing form test meets the required invoice** in `pmo-portal/pages/__tests__/IncomingPayments.createForm.test.tsx`,
test `'AC-PLC-009: persists id-ID grouped payment amounts as 1234'` (deliberate UX change: a PMO receipt names its
invoice, FR-NAR-007; the goal assertion is unchanged): as its first statement add
`    hoisted.invoicesState.data = [invoice({ id: 'si-a', si_number: 'SI-ACME', customer_id: 'cust-1' })];`
and after `    await pick(user, 'Customer', 'Acme Energy');` add `    await pick(user, /Sales Invoice/, 'SI-ACME');`.

**Verify (RED):** `(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/IncomingPayments.native.test.tsx)` → fails.

---

## Task 32 — GREEN: Incoming Payments PMO mode (5 min)

**Edits in** `pmo-portal/pages/IncomingPayments.tsx`:

1. Replace `import { incomingPaymentStatusVariant } from '@/src/lib/status/statusVariants';` with
   `import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';` and add
   ```ts
   import { useRevenueMode } from '@/src/hooks/useRevenueMode';
   import { invoiceNumber, receiptNumber } from '@/src/lib/revenue/nativeInvoice';
   ```
2. Replace `const validate = (v: FormValues, t: (key: string, fallback: string) => string): Partial<Record<keyof FormValues, string>> => {`
   and its next two lines (`const errors…` and the `customerId` line) with:
   ```ts
   const validate = (
     v: FormValues,
     t: (key: string, fallback: string) => string,
     native = false,
   ): Partial<Record<keyof FormValues, string>> => {
     const errors: Partial<Record<keyof FormValues, string>> = {};
     if (!v.customerId.trim()) errors.customerId = t('financeCopy.customerRequired', 'Customer is required.');
     // #784 (FR-NAR-007): a PMO receipt settles a named PMO invoice — there is no on-account receipt without an ERP.
     if (native && !v.salesInvoiceId) errors.salesInvoiceId = t('financeCopy.salesInvoiceRequired', 'Choose the invoice this receipt settles.');
   ```
3. In `openInvoiceOptions`, replace `      label: inv.si_number ?? inv.id,` with `      label: invoiceNumber(inv) ?? inv.id,`.
4. After `  const { createPayment, cancelPayment, pendingPush } = useRevenueMutations();` add `  const native = useRevenueMode() === 'native';`
5. Replace `        || p.ip_number?.toLowerCase().includes(q)` with `        || receiptNumber(p)?.toLowerCase().includes(q)`.
6. In the `ip_number` column replace both `p.ip_number ?? ''` with `receiptNumber(p) ?? ''` and `{p.ip_number ?? '—'}` with `{receiptNumber(p) ?? '—'}`.
7. Replace the status column's `cell` and `exportValue` lines with:
   ```tsx
       cell: (p) => p.cancelled_at
         ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
         : <StatusPill variant={incomingPaymentStatusVariant(p.status)}>{incomingPaymentStatusLabel(p.status, t)}</StatusPill>,
       exportValue: (p) => (p.cancelled_at ? 'Cancelled' : p.status),
   ```
8. Replace the body of `rowMenu` with:
   ```tsx
     const items: RowMenuItem[] = [];
     if (canCancel && !p.pmo_native && p.status !== 'Paid')
       items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(p), danger: true });
     // #784 AC-NAR-006: a PMO receipt is cancelled in PMO while PMO owns revenue (the RPC re-checks all of it).
     if (canCancel && p.pmo_native && !p.cancelled_at && native)
       items.push({ label: t('financeCopy.cancel', "Cancel"), onClick: () => setCancelTarget(p), danger: true });
     return items;
   ```
9. In `onCancelConfirm`, replace
   `      toast(t('financeCopy.paymentCancelled', 'Payment cancelled'), cancelTarget.ip_number ?? cancelTarget.id, 'success');` with
   ```tsx
         toast(
           cancelTarget.pmo_native ? t('financeCopy.receiptCancelled', 'Receipt cancelled') : t('financeCopy.paymentCancelled', 'Payment cancelled'),
           receiptNumber(cancelTarget) ?? cancelTarget.id,
           'success',
         );
   ```
10. Replace the `ListPage` `description={…}` with:
    ```tsx
          description={native
            ? t('financeCopy.nativeIncomingPaymentsDescription', 'Customer receipts recorded in PMO against approved invoices.')
            : t('financeCopy.paymentsReceivedFromClientsMirroredFromERPNextLinkedToSalesInvoicesWhenApplicable', "Payments received from clients, mirrored from ERPNext. Linked to sales invoices when applicable.")}
    ```
11. On `<IncomingPaymentFormModal`, add `native={native}` after `pendingPush={pendingPush}`.
12. Cancel `ConfirmDialog`: in `title`, replace `payment: cancelTarget.ip_number ?? cancelTarget.id` with
    `payment: receiptNumber(cancelTarget) ?? cancelTarget.id`; replace `description={…}` with
    ```tsx
          description={cancelTarget?.pmo_native
            ? t('financeCopy.nativeCancelReceiptBody', "This cancels the receipt in PMO and puts its amount back on the invoice's balance.")
            : t('financeCopy.cancelPaymentDescription', "This cancels the payment in ERPNext (docstatus 1→2). The payment will be marked Cancelled and the linked invoice's outstanding amount will be restored.")}
    ```
13. `IncomingPaymentFormModalProps`: add after `pendingPush: PendingPushState;`
    ```ts
      /** #784: true while PMO owns revenue — the receipt must name its invoice. */
      native: boolean;
    ```
    and add `native,` to the destructured props after `pendingPush,`.
14. In the modal's `useEntityForm`, replace `    validate: (values) => validate(values, t),` with `    validate: (values) => validate(values, t, native),`.
15. Replace the modal's `errorSummary` declaration with:
    ```tsx
      const errorSummary = form.errors.customerId || form.errors.salesInvoiceId || form.errors.paidAmount || form.errors.receivedAmount || form.errors.date || form.errors.withheldAmount || form.errors.withholdingSlipNumber
        ? [
            ...(form.errors.customerId ? [{ fieldId: customerField.id, message: form.errors.customerId }] : []),
            ...(form.errors.salesInvoiceId ? [{ fieldId: salesInvoiceField.id, message: form.errors.salesInvoiceId }] : []),
            ...(form.errors.paidAmount ? [{ fieldId: paidAmountField.id, message: form.errors.paidAmount }] : []),
            ...(form.errors.receivedAmount ? [{ fieldId: receivedAmountField.id, message: form.errors.receivedAmount }] : []),
            ...(form.errors.date ? [{ fieldId: dateField.id, message: form.errors.date }] : []),
            ...(form.errors.withheldAmount ? [{ fieldId: withheldAmountField.id, message: form.errors.withheldAmount }] : []),
            ...(form.errors.withholdingSlipNumber ? [{ fieldId: slipField.id, message: form.errors.withholdingSlipNumber }] : []),
          ]
        : undefined;
    ```
16. Replace `      {pendingPush.status !== 'idle' && (` (in the modal) with `      {!native && pendingPush.status !== 'idle' && (`.
17. In the Sales Invoice `Combobox`, replace `label={t('financeCopy.salesInvoiceOptional', "Sales Invoice (optional)")}` with
    `label={native ? t('financeCopy.salesInvoiceLabel', 'Sales Invoice') : t('financeCopy.salesInvoiceOptional', "Sales Invoice (optional)")}`
    and add `required={native}` on the next line.

**Verify (GREEN):**
```bash
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/IncomingPayments.native.test.tsx pages/__tests__/IncomingPayments.createForm.test.tsx pages/__tests__/IncomingPayments.commandIntent.test.tsx pages/__tests__/IncomingPayments.currency.test.tsx pages/__tests__/Finance.customerDisplay.test.tsx \
  && npx eslint --max-warnings=0 pages/IncomingPayments.tsx)
```

---

## Task 33 — The one curated journey (5 min) — owns AC-NAR-003

**File:** `pmo-portal/e2e/AC-NAR-003-no-erp-billing.spec.ts`

```ts
// @e2e-isolation: self-isolated — creates its own uniquely-named client company and VAT project each run, raises, approves and settles its own invoice, and deletes all of it afterwards; touches no shared seed row (the seed org's revenue is PMO-owned in this lane; only serial specs flip it, and they run after).
/**
 * AC-NAR-003 — #784, the one cross-stack journey for billing without an ERP. Finance raises an invoice on a VAT project
 * (12% on 11/12 → 1,110,000 gross); an Admin approves it from the Approvals queue (the second person, AC-NAR-002's
 * path); Finance records a part payment — the invoice reads Partly paid with 610,000 outstanding — then the rest, and
 * the invoice reads Paid. Goal oracle: what the Sales Invoices list shows, to the people who act on it.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { signIn, requireServiceRoleKey, pickComboboxOption } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const VITE_ENV = loadEnv('development', process.cwd(), 'VITE_');
const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? VITE_ENV.VITE_SUPABASE_URL,
);

test.setTimeout(150_000);

let admin: SupabaseClient | undefined;
let projectId = '';
let companyId = '';
let tag = '';

test.beforeEach(async () => {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('AC-NAR-003 needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it');
  admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  tag = `NAR-003 ${Date.now()}`;
  const company = await admin.from('companies').insert({ org_id: ORG_ID, name: `${tag} Client`, type: 'Client' }).select('id').single();
  if (company.error) throw new Error(`AC-NAR-003 fixture company: ${company.error.message}`);
  companyId = company.data.id;
  const project = await admin.from('projects').insert({
    org_id: ORG_ID, name: tag, status: 'Ongoing Project', currency: 'IDR', client_id: companyId,
    contract_value: 10_000_000, tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12,
    tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single();
  if (project.error) throw new Error(`AC-NAR-003 fixture project: ${project.error.message}`);
  projectId = project.data.id;
});

test.afterEach(async () => {
  if (!admin) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`AC-NAR-003 cleanup ${step}: ${e.message}`); };
  if (projectId) {
    const invoices = await admin.from('sales_invoices').select('id').eq('project_id', projectId);
    fail('invoice read', invoices.error);
    const ids = (invoices.data ?? []).map((r: { id: string }) => r.id);
    if (ids.length > 0) fail('receipts', (await admin.from('incoming_payments').delete().in('sales_invoice_id', ids)).error);
    fail('invoices', (await admin.from('sales_invoices').delete().eq('project_id', projectId)).error);
    fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
    projectId = '';
  }
  if (companyId) {
    fail('company', (await admin.from('companies').delete().eq('id', companyId)).error);
    companyId = '';
  }
});

async function invoiceRow(page: Page) {
  await page.goto('/sales-invoices');
  await page.getByLabel('Search sales invoices').fill(`${tag} Client`);
  return page.getByRole('row').filter({ hasText: `${tag} Client` });
}

async function recordReceipt(page: Page, amount: string) {
  await page.goto('/incoming-payments');
  await page.getByRole('button', { name: 'Receive Payment' }).first().click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^Customer/, new RegExp(`${tag} Client`));
  await pickComboboxOption(form, page, /^Sales Invoice/, /INV-\d{10}/);
  await form.getByLabel(/Paid Amount/).fill(amount);
  await form.getByLabel(/Received Amount/).fill(amount);
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
}

test('AC-NAR-003 a no-ERP org raises an invoice, a second person approves it, and part then full payment marks it Paid', async ({ page }) => {
  // Finance raises the invoice.
  await signIn(page, 'finance@acme.test');
  await page.goto('/sales-invoices');
  await page.getByRole('button', { name: 'New Invoice' }).first().click();
  const form = page.getByRole('dialog');
  await pickComboboxOption(form, page, /^Customer/, new RegExp(`${tag} Client`));
  await pickComboboxOption(form, page, /^Project/, new RegExp(tag));
  await form.getByLabel(/Item code/).fill('SVC-NAR');
  await form.getByLabel('Description').fill('Site survey');
  await form.getByLabel(/Rate/).fill('1000000');
  await form.getByRole('button', { name: 'Create invoice' }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });
  let row = await invoiceRow(page);
  await expect(row.getByText('Draft', { exact: true })).toBeVisible({ timeout: 15_000 });

  // A second person — an Admin — approves it from the Approvals queue.
  await signIn(page, 'admin@acme.test');
  await page.goto('/approvals');
  const queue = page.getByRole('region', { name: 'Customer invoices awaiting you' });
  const item = queue.getByRole('listitem').filter({ hasText: `${tag} Client` });
  await item.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Approve invoice' }).click();
  await expect(item).toHaveCount(0, { timeout: 15_000 });
  row = await invoiceRow(page);
  await expect(row.getByText('Unpaid', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/INV-\d{10}/);

  // Finance records a part payment, then the rest.
  await signIn(page, 'finance@acme.test');
  await recordReceipt(page, '500000');
  row = await invoiceRow(page);
  await expect(row.getByText('Partly paid', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/610[.,]000/);
  await recordReceipt(page, '610000');
  row = await invoiceRow(page);
  await expect(row.getByText('Paid', { exact: true })).toBeVisible({ timeout: 15_000 });
});
```

**Verify:** `scripts/e2e-local.sh AC-NAR-003` → 1 passed; then `bash scripts/check-e2e-isolation.sh` → clean.

---

## Task 34 — Local final gate (5 min)

```bash
(cd pmo-portal && npm run typecheck)
(cd pmo-portal && npx eslint --max-warnings=0 src/lib/revenue/nativeInvoice.ts src/lib/db/revenueNative.ts src/lib/db/revenue.ts src/hooks/useRevenueMode.ts src/hooks/useRevenue.ts src/lib/repositories/index.ts src/lib/repositories/types.ts src/lib/repositories/revenue.external.test.ts src/lib/repositories/revenue.native.test.ts pages/SalesInvoices.tsx pages/IncomingPayments.tsx pages/Approvals.tsx pages/approvals/SalesInvoiceApprovalSection.tsx e2e/AC-NAR-003-no-erp-billing.spec.ts)
(cd pmo-portal && npm run check:i18n)
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev)
node scripts/check-isolation-denominator.mjs
scripts/e2e-local.sh AC-NAR-003
```
plus Task 18's pgTAP command. **Verify:** every command exits 0. Then the 3-reviewer pass (spec, code quality,
security — this is money + SoD + RLS) and the rendered Discover pass on `/sales-invoices`, `/incoming-payments`,
`/approvals` (rich seed, phone and desktop) before the PR to `dev`.

---

## Appendix A — if #785 (0262) is not on `dev` when #784 must build

Do not merge 0270 before 0262: the hosted push would then need an out-of-order `--include-all`. If the Director still
orders #784 first, these exact deltas apply (and are reverted when #785 lands):
1. §3: replace `    perform public.lock_work_order_billing(p_work_order_id);` with
   `    perform pg_advisory_xact_lock(hashtextextended('work_order_billing:' || p_work_order_id::text, 0));`
   (the same key 0262 defines, so the two serialise whichever lands first).
2. Task 1: delete assertion 11 (the `BW001` refusal) and change `select plan(23);` to `select plan(22);`.
3. Task 24: in `nativeCreateInvoice`, replace `workOrderId: input.workOrderId ?? null,` with `workOrderId: null,`
   (the create input has no `workOrderId` without #785); Task 23's first test expects `workOrderId: null` either way.
4. Task 18: drop the four `0262_*` files from the list.
