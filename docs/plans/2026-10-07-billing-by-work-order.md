# Plan: billing by work order (#785 / #786, owner ruling OD-BILL-1)

> **Spec:** [`docs/specs/progress-billing.spec.md`](../specs/progress-billing.spec.md) §7 (FR-BWO-001..013,
> AC-BWO-001..006, AC-UNB-001/002/004/005, DD-BWO-1..12).
> **ADR:** [ADR-0080](../adr/0080-billing-by-work-order.md).
> **Executor:** money path (an over-invoice refusal on the ERP outbox, a trigger on `sales_invoices`, a paired edit of
> `create_progress_claim`, the dispatch's work-order link) — **Director-dispatched**, per CLAUDE.md executor routing.
> Parts C–D (data hooks + UI) may go to an SSSF ADW with `--builder fe_builder --reviewer fe_reviewer` once Parts A–B
> are on `dev`.
> **Worktree:** the Director creates `$WT` off `origin/dev` on branch `feat/785-billing-by-work-order` and copies
> `.env.local` in. Every command below starts with `cd "$WT"…`. Agents run no git (memory: subagent git guard).
> **Migration slot:** **`0262` only** — `supabase/migrations/0262_billing_by_work_order.sql`, rollback
> `supabase/migrations/rollback/0262_billing_by_work_order_down.sql`. If `ls supabase/migrations/0262_*` shows another
> file when you start, STOP and report to the Director (do not renumber).
> **Preconditions (check first):** `ls supabase/migrations/0250_progress_billing.sql supabase/migrations/0261_pipeline_hides_archived.sql`
> both exist, and `sed -n '355p;512p;690p;701p' supabase/migrations/0250_progress_billing.sql` prints, in order:
> `create or replace function public.create_progress_claim(`, `grant execute on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) to authenticated;`,
> `create view public.sales_invoice_work_billed with (security_invoker = true) as`,
> `grant select on public.sales_invoice_work_billed to authenticated;` — the rollback copies those line ranges.
> If any differs, STOP and report.

## 1. Design

### Decisions (full text: spec §7.1)

| # | Decision |
|---|---|
| DD-BWO-1 | A work order's billed total = per linked, non-cancelled invoice its billed work (DD-PBL-9 view: net + recovery; down payment 0) + per live unraised claim its gross. Invoiced = Submitted/Unpaid/Paid; not yet submitted = Draft + unraised claims; still to invoice = value excl. tax − both. |
| DD-BWO-2 | Paid = billed work of Paid invoices (withheld tax counts as settled). WO is **Paid** when nothing left, nothing in draft, every submitted invoice Paid. Derived, never stored. |
| DD-BWO-3 | Excl. tax, WO currency. An invoice with no amount / another currency ⇒ "can't total"; the refusal fails closed. |
| DD-BWO-4 | One helper `assert_work_order_invoiceable`, called by a BEFORE INSERT trigger on `external_command_outbox` (pre-ERP), a BEFORE INSERT/UPDATE trigger on `sales_invoices` (all writers except the service-role mirror and a no-JWT load) and `create_progress_claim`. SQLSTATE `BW001` → HTTP 422. The mirror is never refused (DD-VI-3a). |
| DD-BWO-5 | Per-work-order **advisory** xact lock, taken before reading; in-flight outbox commands count until mirrored. |
| DD-BWO-6..8 | Admin/Finance (existing authority), SoD unchanged; Closed WOs invoiceable; an ordinary create may name its WO (create only). |
| DD-BWO-9 | The assistant links the WO and defaults to still-to-invoice. |
| DD-BWO-10..12 | Work orders tab + Exec/Finance dashboards; invoices without a WO stay legal; milestone link deferred. |

### Architecture and data flow

```
WRITE — ERP path (only UI path today)
 WorkOrdersTab ─"Invoice"─▶ InvoiceWorkOrderModal ─▶ useRevenueMutations.create({…, workOrderId})
   ─▶ repositories.revenue.createInvoice ─▶ salesInvoiceCreateFields ─▶ dispatchCreate('revenue')
     ─▶ adapter-dispatch ─ dispatchFactory.resolveProgressClaimInvoice  (keeps workOrderId on CREATE only)
        ─ link pre-flight (workOrderId org) ─ resolveSalesInvoicePo (po_no = WO client PO)
        ─▶ INSERT external_command_outbox ──▶ trigger external_command_outbox_zz_work_order_invoice_fence
              └─ assert_work_order_invoiceable(org, wo, project, record, Σ round(qty×rate,2), currency)   [BW001 → 422]
        ─▶ ERPNext POST (draft) ─▶ service-role mirror INSERT sales_invoices (work_order_id)   [never refused]
WRITE — native path (no UI yet; #784)          sales_invoices INSERT/UPDATE ─▶ trigger …_zzzz_work_order_invoiceable ─▶ helper
WRITE — claims                                  create_progress_claim ─ lock ─▶ helper (gross) before INSERT
WRITE — assistant                               draft_invoice.prepare ─ reads work_order_billing_lines ─▶ run passes workOrderId

READ
 view sales_invoice_work_billed (0250, + work_order_id)
   └▶ view work_order_billing_lines  (per record: billed, submitted, paid, currency)        [security_invoker]
        └▶ view work_order_billing   (per WO: order_net, invoiced, pending, paid, remaining,  [security_invoker]
                                       figures_complete, line_count, unpaid_count)
             ├▶ WorkOrdersTab (useWorkOrderBilling → repositories.workOrder.billing → db.listWorkOrderBilling)
             └▶ rpc get_unbilled_work_orders(p_limit) → jsonb {totals, incomplete_count, rows}     [INVOKER]
                   └▶ StillToInvoiceCard on Executive + Finance dashboards
```

### Error handling

| Where | Refusal | Code |
|---|---|---|
| helper | WO not found / other org | `BW001` "work order not found" |
| helper | WO on another project | `BW001` "the work order must be on the same project as the invoice" |
| helper | WO Draft / Cancelled | `BW001` "work order <label> is <status>: only an issued or closed work order can be invoiced" |
| helper | invoice in another currency | `BW001` "this invoice is in X but work order <label> is in Y: a work order is invoiced in its own currency" |
| helper | amount unreadable (no lines, non-numeric, NaN) | `BW001` "the invoice amount could not be read, so it cannot be checked against work order <label>" |
| helper | an existing record unreadable / other currency | `BW001` "an invoice on work order <label> has no amount or is in another currency, so what is still to invoice cannot be checked" |
| helper | over the value | `BW001` "this invoice would bill A against work order L (worth V excl. tax, with E already invoiced or in draft): only R is still to invoice" |
| dispatch | `BW001` from the outbox insert | HTTP **422** (`dispatchErrorStatus`), body `{error:'BW001', message}` |
| UI | refusal → dialog keeps `classifyMutationError` headline/detail; reads → `ListState` error, never 0; "Unavailable"/"Can't total" for untotallable figures | |

### Concurrency and lock order

Every billing writer takes `pg_advisory_xact_lock(hashtextextended('work_order_billing:'||wo_id, 0))` first. Lock
orders after this change: claim = WO advisory → project row; native invoice = WO advisory → (FK) project key-share;
outbox fence = WO advisory only; `transition_work_order` = WO row → project row (no advisory). No cycle. The mirror
takes no advisory lock.

### Scaling and existing-code notes

- Reads: project = one view query ≤ 500 WOs (`limit 501`, refuse above); dashboard = one RPC, server-side aggregates
  (not bounded by `max_rows`). Indexes already exist: `sales_invoices (org_id, work_order_id)`,
  `progress_claims (work_order_id)`, `work_orders (org_id, project_id, status)`.
- Fence cost: reads only the org's in-flight revenue outbox rows (`pending/committing/committed/quarantined/held`) —
  a handful at any time.
- No duplicate logic: the net-of-tax rule stays in `sales_invoice_work_billed`; the WO value rule is 0197's CASE;
  the agent reads the same lines view instead of recomputing.
- Behaviour change (deliberate, ruled): an ordinary invoice create now keeps its `workOrderId`
  (`progressClaimInvoice.test.ts` test "an ordinary invoice never takes a caller-supplied work order" is replaced,
  Task B1, with the reason written in the test).

### Files

| Path | Change |
|---|---|
| `supabase/migrations/0262_billing_by_work_order.sql` (+ `rollback/0262_billing_by_work_order_down.sql`) | new |
| `supabase/tests/0262_work_order_billing_figures.test.sql`, `0262_work_order_billing_refusal.test.sql`, `0262_unbilled_work_orders.test.sql` | new pgTAP |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated |
| `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`, `progressClaimInvoice.test.ts` | keep `workOrderId` on create |
| `supabase/functions/adapter-dispatch/readModelWriters.ts` | comment only |
| `supabase/functions/adapter-dispatch/dispatchErrorStatus.ts` (+ test) | `BW001` → 422 |
| `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts` (+ test), `src/lib/repositories/types.ts`, `src/hooks/useRevenue.ts` (+ `useRevenue.workOrderBilling.test.tsx`) | `workOrderId` + invalidation |
| `pmo-portal/src/lib/workOrderBilling.ts` (+ test, + `.i18n.test.ts`) | pure helpers |
| `pmo-portal/src/lib/db/workOrderBilling.ts` (+ test) | DAL |
| `pmo-portal/src/lib/repositories/index.ts` | `workOrder.billing`, `workOrder.unbilled` |
| `pmo-portal/src/hooks/useWorkOrderBilling.ts` (+ test), `src/hooks/useWorkOrders.ts` (+ `useWorkOrders.billingInvalidation.test.tsx`) | hooks |
| `pmo-portal/pages/project-detail/InvoiceWorkOrderModal.tsx` (+ `__tests__/InvoiceWorkOrderModal.test.tsx`) | dialog |
| `pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx` (+ `__tests__/WorkOrdersTab.billing.test.tsx`; mock added to `__tests__/WorkOrdersTab.test.tsx`), `ProjectDetail.tsx` | tab |
| `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx` (+ `__tests__/StillToInvoiceCard.test.tsx`), `pages/ExecutiveDashboard.tsx`, `src/components/dashboard/FinanceDashboard.tsx` + 9 dashboard test files (mock) | dashboard |
| `supabase/functions/agent-chat/draftInvoice.ts`, `pmo-portal/src/lib/agent/draftInvoice.prepare.test.ts`, `draftInvoice.run.test.ts` | assistant |
| `pmo-portal/public/locales/{en,id}/common.json` | strings |
| `pmo-portal/e2e/serial/AC-BWO-003-invoice-work-order-erp.spec.ts`, `scripts/check-e2e-skips.mjs` | ERP journey |
| `docs/decisions.md` | DD-BWO block (Task Z0) |

## 2. Traceability (one owning test per AC, ADR-0010)

| AC | Owning layer | Canonical proof | Tasks |
|---|---|---|---|
| AC-BWO-001 | pgTAP | `supabase/tests/0262_work_order_billing_figures.test.sql` | A1, A2 |
| AC-BWO-002 | pgTAP | `supabase/tests/0262_work_order_billing_refusal.test.sql` | A3, A4, A9, B3 |
| AC-BWO-003 | Playwright (served + bench) | `pmo-portal/e2e/serial/AC-BWO-003-invoice-work-order-erp.spec.ts` | B1, B2, B4, B5, F1, F2 |
| AC-BWO-004 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` | C1, C2, C3, C4, D2, D3, D4, D5 |
| AC-BWO-005 | Vitest | `pmo-portal/src/lib/agent/draftInvoice.prepare.test.ts` | E1, E2 |
| AC-BWO-006 | Vitest | `pmo-portal/src/lib/workOrderBilling.i18n.test.ts` | C5 |
| AC-UNB-001 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/OverviewTab.test.tsx` (shipped; re-run in G1) | — |
| AC-UNB-002 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` | C1, D4 |
| AC-UNB-004 | pgTAP | `supabase/tests/0262_unbilled_work_orders.test.sql` | A5, A6 |
| AC-UNB-005 | Vitest/RTL | `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx` | C2, C3, D6, D7 |

## 3. Tasks

### Z0 — record the rulings in `docs/decisions.md` (Director, docs push)

Append this block at the end of `docs/decisions.md` (the planner's tools could not append to a 3,000-line file):

```markdown
**DD-BWO-1..12 (Director, 2026-10-07, #785/#786, under OD-BILL-1) — billing by work order.** Ruled as written in
`docs/specs/progress-billing.spec.md` §7.1 and ADR-0080: a work order's billed total is its linked non-cancelled
invoices at their billed work (DD-PBL-9; a down payment counts zero) plus its live unraised claims at gross; invoiced =
submitted, not yet submitted = drafts + unraised claims, still to invoice = value excl. tax − both (DD-BWO-1) · Paid =
billed work of Paid invoices, withheld tax counts as settled; the WO is Paid when nothing is left, nothing is in draft
and every submitted invoice is Paid — derived, never stored (DD-BWO-2) · excl. tax in the WO's currency; an invoice
with no amount or another currency makes the WO "can't total" and the refusal fails closed (DD-BWO-3) · one helper
refuses (SQLSTATE BW001, HTTP 422) from a BEFORE INSERT trigger on the outbox (before any ERP write), a trigger on
`sales_invoices` for every writer except the service-role mirror and a no-JWT load, and `create_progress_claim`; the
mirror is never refused, an ERP-side overage shows as over-invoiced (DD-BWO-4) · a per-WO advisory xact lock, taken
before reading, serialises billing writes; in-flight ERP commands count until mirrored; not a row lock because the
claim RPC locks the project first (DD-BWO-5) · Admin/Finance, SoD unchanged (DD-BWO-6) · Closed WOs can be invoiced
(DD-BWO-7) · an ordinary invoice create may name its WO (create only), PO reference from the WO (DD-BWO-8) · the
assistant links the WO and defaults to what is left (amends DD-AIN-4) (DD-BWO-9) · shown on the Work orders tab and
the Executive/Finance dashboards (DD-BWO-10) · invoices without a WO stay legal, project-level (DD-BWO-11) · the
milestone→WO display link is a follow-up (DD-BWO-12). Plan: `docs/plans/2026-10-07-billing-by-work-order.md`.
```

Verify: `cd "$WT" && grep -c 'DD-BWO-1..12' docs/decisions.md` prints `1`.

---

### Part A — database (migration 0262)

#### A1 — failing pgTAP: the figures (AC-BWO-001)

Create `supabase/tests/0262_work_order_billing_figures.test.sql`:

```sql
-- 0262_work_order_billing_figures.test.sql — OD-BILL-1 AC-BWO-001: what a work order has been billed.
-- Migration under test: 0262_billing_by_work_order.sql §1–§3. Fixtures load with no JWT (a server load).
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name) values
  ('02620000-0000-0000-0000-000000000001', 'BWO Org'),
  ('02620000-0000-0000-0000-000000000002', 'BWO Other Org');
insert into auth.users (id, email) values
  ('02620000-0000-0000-0000-0000000000a2', 'bwo-f-fin@example.com'),
  ('02620000-0000-0000-0000-0000000000b1', 'bwo-f-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02620000-0000-0000-0000-0000000000a2', '02620000-0000-0000-0000-000000000001', 'BWO Fin', 'bwo-f-fin@example.com', 'Finance', 'active'),
  ('02620000-0000-0000-0000-0000000000b1', '02620000-0000-0000-0000-000000000002', 'BWO XOrg', 'bwo-f-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-000000000001', 'BWO Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-000000000001', 'BWO Project', 'Ongoing Project', 2000000, 'exclusive', 0, '02620000-0000-0000-0000-0000000000f1');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount) values
  ('02620000-0000-0000-0000-0000000000d1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'Survey', 'Issued', 'WO-F-1', 555000, 'inclusive', 55000),
  ('02620000-0000-0000-0000-0000000000d2', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'Build', 'Issued', 'WO-F-2', 300000, 'exclusive', 0),
  ('02620000-0000-0000-0000-0000000000d3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'Commission', 'Issued', 'WO-F-3', 100000, 'exclusive', 0);
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, down_payment_amount,
                             recovery_pct, dp_recovery_amount, dp_item_code, created_by, withdrawn_by, withdrawn_at) values
  ('02620000-0000-0000-0000-0000000000e1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1',
   'progress', 'USD', 40000, null, null, 0, null, '02620000-0000-0000-0000-0000000000a2', null, null),
  ('02620000-0000-0000-0000-0000000000e2', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1',
   'progress', 'USD', 30000, null, null, 0, null, '02620000-0000-0000-0000-0000000000a2', '02620000-0000-0000-0000-0000000000a2', now()),
  ('02620000-0000-0000-0000-0000000000e3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1',
   'progress', 'USD', 30000, null, null, 6000, 'DP-ITEM', '02620000-0000-0000-0000-0000000000a2', null, null),
  ('02620000-0000-0000-0000-0000000000e4', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1',
   'down_payment', 'USD', 100000, 100000, 10, 0, 'DP-ITEM', '02620000-0000-0000-0000-0000000000a2', null, null);
insert into sales_invoices (id, org_id, project_id, customer_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('02620000-0000-0000-0000-0000000005a1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-0000000000d1', '2026-10-01', 222000, 'inclusive', 22000, 'USD', 'Unpaid'),
  ('02620000-0000-0000-0000-0000000005a2', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-0000000000d1', '2026-10-01', 100000, 'exclusive', 10000, 'USD', 'Paid'),
  ('02620000-0000-0000-0000-0000000005a3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-0000000000d1', '2026-10-01', 50000, 'exclusive', 0, 'USD', 'Draft'),
  ('02620000-0000-0000-0000-0000000005a4', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-0000000000d1', '2026-10-01', 80000, 'exclusive', 0, 'USD', 'Cancelled'),
  ('02620000-0000-0000-0000-0000000000e3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-0000000000d1', '2026-10-01', 26400, 'inclusive', 2400, 'USD', 'Unpaid'),
  ('02620000-0000-0000-0000-0000000000e4', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-0000000000d1', '2026-10-01', 100000, 'exclusive', 0, 'USD', 'Unpaid'),
  ('02620000-0000-0000-0000-0000000005a7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-0000000000d3', '2026-10-01', null, 'exclusive', 0, 'USD', 'Unpaid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select order_net from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 500000::numeric,
  'AC-BWO-001 the work order''s value is stated excl. tax (555,000 incl. 55,000 tax)');                                          -- 1
select is((select invoiced from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 330000::numeric,
  'AC-BWO-001 invoiced = submitted invoices at their billed work: 200,000 + 100,000 + the claim''s 24,000 + 6,000 recovery; the down payment counts 0'); -- 2
select is((select pending from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 90000::numeric,
  'AC-BWO-001 not yet submitted = the 50,000 draft + the unraised 40,000 claim; the withdrawn claim and the cancelled invoice count nothing'); -- 3
select is((select paid from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 100000::numeric,
  'AC-BWO-001 paid = the billed work of Paid invoices');                                                                          -- 4
select is((select remaining from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 80000::numeric,
  'AC-BWO-001 still to invoice = 500,000 − 330,000 − 90,000');                                                                   -- 5
select is((select figures_complete from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), true,
  'AC-BWO-001 every counted record has an amount in the work order''s currency');                                               -- 6
select is((select line_count from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 6,
  'AC-BWO-001 six records count: five live invoices and the unraised claim');                                                   -- 7
select is((select unpaid_count from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 3,
  'AC-BWO-001 three submitted invoices are not yet Paid, so the work order is not Paid');                                        -- 8
select ok((select invoiced = 0 and pending = 0 and paid = 0 and remaining = 300000 and figures_complete and line_count = 0
             from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d2'),
  'AC-BWO-001 a work order with no invoices has its whole value still to invoice');                                              -- 9
select is((select figures_complete from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d3'), false,
  'AC-BWO-001 an invoice with no amount makes the work order''s figures not totalled (DD-BWO-3)');                              -- 10
select set_eq(
  $$ select record_id from work_order_billing_lines where work_order_id = '02620000-0000-0000-0000-0000000000d1' $$,
  $$ values ('02620000-0000-0000-0000-0000000005a1'::uuid), ('02620000-0000-0000-0000-0000000005a2'::uuid),
            ('02620000-0000-0000-0000-0000000005a3'::uuid), ('02620000-0000-0000-0000-0000000000e3'::uuid),
            ('02620000-0000-0000-0000-0000000000e4'::uuid), ('02620000-0000-0000-0000-0000000000e1'::uuid) $$,
  'AC-BWO-001 the cancelled invoice and the withdrawn claim are out, and a raised claim counts once (as its invoice)');          -- 11
select is((select billed from work_order_billing_lines where record_id = '02620000-0000-0000-0000-0000000000e4'), 0::numeric,
  'AC-BWO-001 a down-payment invoice bills no work (DD-PBL-9)');                                                                  -- 12
select is((select billed from work_order_billing_lines where record_id = '02620000-0000-0000-0000-0000000000e3'), 30000::numeric,
  'AC-BWO-001 a claim invoice bills its net plus the recovery its negative line removed');                                       -- 13
select is((select billed from work_order_billing_lines where record_id = '02620000-0000-0000-0000-0000000000e1'), 40000::numeric,
  'AC-BWO-001 an unraised claim reserves its gross');                                                                             -- 14
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 0,
  'AC-BWO-001 another organisation reads none of it');                                                                            -- 15
select is((select count(*)::int from work_order_billing_lines where work_order_id = '02620000-0000-0000-0000-0000000000d1'), 0,
  'AC-BWO-001 …not even its lines');                                                                                              -- 16
reset role;

select ok(not has_table_privilege('anon', 'public.work_order_billing', 'select')
          and not has_table_privilege('anon', 'public.work_order_billing_lines', 'select'),
  'AC-BWO-001 anon cannot read either view');                                                                                     -- 17
select has_column('public', 'sales_invoice_work_billed', 'work_order_id',
  'AC-BWO-001 the one billed-work view now carries the invoice''s work order');                                                  -- 18

select * from finish();
rollback;
```

Verify it fails (no migration yet):
`cd "$WT" && scripts/with-db-lock.sh supabase test db supabase/tests/0262_work_order_billing_figures.test.sql` →
errors with `relation "work_order_billing" does not exist`.

#### A2 — migration §1–§3: the views (AC-BWO-001)

Create `supabase/migrations/0262_billing_by_work_order.sql` with exactly:

```sql
-- 0262_billing_by_work_order.sql — OD-BILL-1 (#785 / #786): clients are billed against their work order (their PO/SO),
-- and the database refuses invoicing past it — before any ERP write.
-- Spec: docs/specs/progress-billing.spec.md §7 (FR-BWO-001..013, AC-BWO-001..006, AC-UNB-002/004).
-- ADR: docs/adr/0080-billing-by-work-order.md. Rulings: DD-BWO-1..12. Plan: docs/plans/2026-10-07-billing-by-work-order.md.
-- Reversal: supabase/migrations/rollback/0262_billing_by_work_order_down.sql (pre-production: supabase db reset).
--
-- ⚑ No table and no column. Two security_invoker views, one invoker reader RPC, two invoker helpers and two SECURITY
--   DEFINER trigger functions with NO client EXECUTE, and one paired edit of create_progress_claim (0250 §5 verbatim +
--   a lock + one call). 0178's allow-list is unchanged (59): nothing here is a client-callable definer. The isolation
--   denominator is unchanged: views are not tables and trigger functions are not in its definer list.
-- ⚑ Hosted Supabase grants EXECUTE on new public functions — and SELECT on new views — to anon/authenticated
--   explicitly (0185/0210): every object below revokes what it must not expose, and each section asserts the result
--   on the database itself.
-- ⚑ Refusals raise SQLSTATE BW001 ("billing, work order"); adapter-dispatch maps it to HTTP 422 (dispatchErrorStatus.ts).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the one billed-work view (0250 §8, DD-PBL-9) gains the invoice's work order. Appended LAST: 0250's
-- get_project_billing and 0251's get_management_pack read it by column name, so neither changes.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace view public.sales_invoice_work_billed with (security_invoker = true) as
  select si.id, si.org_id, si.project_id, si.currency, si.invoice_date, si.status,
         coalesce(pc.kind = 'down_payment', false) as is_down_payment,
         case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net,
         coalesce(pc.dp_recovery_amount, 0) as recovery,
         si.work_order_id
    from public.sales_invoices si
    left join public.progress_claims pc on pc.id = si.id and pc.org_id = si.org_id;
revoke all on public.sales_invoice_work_billed from public, anon, authenticated;
grant select on public.sales_invoice_work_billed to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — work_order_billing_lines (DD-BWO-1): one row per record that bills a work order.
--   • a linked invoice that is not Cancelled, at its billed work (net + recovery; a down payment bills 0);
--   • a live progress claim on the work order with NO invoice yet, at its gross (it will become an invoice, and
--     0250 makes its invoice reuse the claim id — so a raised claim appears exactly once, as its invoice).
-- `billed` is NULL when the invoice has no amount; the aggregate below reports that as "not totalled".
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create view public.work_order_billing_lines with (security_invoker = true) as
  select w.id as record_id, w.org_id, w.work_order_id, w.currency,
         case when w.is_down_payment then 0::numeric else w.net + w.recovery end as billed,
         (w.status in ('Submitted', 'Unpaid', 'Paid')) as submitted,
         (w.status = 'Paid') as paid
    from public.sales_invoice_work_billed w
   where w.work_order_id is not null and w.status <> 'Cancelled'
  union all
  select pc.id, pc.org_id, pc.work_order_id, pc.currency,
         case when pc.kind = 'down_payment' then 0::numeric else pc.gross_amount end,
         false, false
    from public.progress_claims pc
   where pc.work_order_id is not null and pc.withdrawn_at is null
     and not exists (select 1 from public.sales_invoices si where si.id = pc.id);
comment on view public.work_order_billing_lines is
  'OD-BILL-1 DD-BWO-1: every record that bills a work order — linked non-cancelled invoices at their billed work '
  '(DD-PBL-9; a down payment bills 0) and live unraised claims at gross. security_invoker: RLS stays the boundary.';
revoke all on public.work_order_billing_lines from public, anon, authenticated;
grant select on public.work_order_billing_lines to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — work_order_billing (DD-BWO-1..3): one row per work order. All figures excl. tax in the work order's currency.
-- The value uses 0197's rule (inclusive → value − tax amount), byte-identical to get_project_drawdown.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create view public.work_order_billing with (security_invoker = true) as
  select wo.id as work_order_id, wo.org_id, wo.project_id, wo.status, wo.wo_number, wo.title, wo.closed_at, wo.currency,
         case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end as order_net,
         coalesce(sum(l.billed) filter (where l.submitted), 0) as invoiced,
         coalesce(sum(l.billed) filter (where not l.submitted), 0) as pending,
         coalesce(sum(l.billed) filter (where l.paid), 0) as paid,
         (case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end)
           - coalesce(sum(l.billed), 0) as remaining,
         coalesce(bool_and(l.billed is not null and l.currency = wo.currency)
                    filter (where l.record_id is not null), true) as figures_complete,
         count(l.record_id)::int as line_count,
         (count(l.record_id) filter (where l.submitted and not l.paid))::int as unpaid_count
    from public.work_orders wo
    left join public.work_order_billing_lines l on l.work_order_id = wo.id and l.org_id = wo.org_id
   group by wo.id;
comment on view public.work_order_billing is
  'OD-BILL-1 DD-BWO-1..3: per work order, excl. tax in its currency — value, invoiced (submitted), pending (drafts + '
  'unraised claims), paid, remaining (value − invoiced − pending), and whether every record could be totalled. '
  'Derived on every read; never stored (DD-WO-3).';
revoke all on public.work_order_billing from public, anon, authenticated;
grant select on public.work_order_billing to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.work_order_billing_lines', 'select')
     or has_table_privilege('anon', 'public.work_order_billing', 'select')
     or has_table_privilege('anon', 'public.sales_invoice_work_billed', 'select') then
    raise exception '0262 §1-§3: anon can read a work-order billing view';
  end if;
  if not has_table_privilege('authenticated', 'public.work_order_billing', 'select') then
    raise exception '0262 §3: authenticated cannot read work_order_billing';
  end if;
end $$;
```

Verify green:
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0262_work_order_billing_figures.test.sql supabase/tests/0250_progress_billing_summary.test.sql supabase/tests/0251_management_pack_billed_work.test.sql'`
→ all `ok` (the last two prove the view change is behaviour-neutral for 0250/0251).

#### A3 — failing pgTAP: the refusal (AC-BWO-002)

Create `supabase/tests/0262_work_order_billing_refusal.test.sql`:

```sql
-- 0262_work_order_billing_refusal.test.sql — OD-BILL-1 AC-BWO-002: the database refuses invoicing past a work order.
-- Migration under test: 0262_billing_by_work_order.sql §4–§8. Every refusal asserts SQLSTATE AND message.
begin;
create extension if not exists pgtap;
select plan(30);

insert into organizations (id, name) values
  ('02620000-0000-0000-0000-000000000001', 'BWO Org'),
  ('02620000-0000-0000-0000-000000000002', 'BWO Other Org');
insert into auth.users (id, email) values
  ('02620000-0000-0000-0000-0000000000a2', 'bwo-r-fin@example.com'),
  ('02620000-0000-0000-0000-0000000000b1', 'bwo-r-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02620000-0000-0000-0000-0000000000a2', '02620000-0000-0000-0000-000000000001', 'BWO Fin', 'bwo-r-fin@example.com', 'Finance', 'active'),
  ('02620000-0000-0000-0000-0000000000b1', '02620000-0000-0000-0000-000000000002', 'BWO XOrg', 'bwo-r-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('02620000-0000-0000-0000-0000000000f1', '02620000-0000-0000-0000-000000000001', 'BWO Client', 'Client'),
  ('02620000-0000-0000-0000-0000000000f9', '02620000-0000-0000-0000-000000000002', 'BWO X Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-000000000001', 'BWO R Project', 'Ongoing Project', 10000, 'exclusive', 0, '02620000-0000-0000-0000-0000000000f1'),
  ('02620000-0000-0000-0000-0000000000c2', '02620000-0000-0000-0000-000000000001', 'BWO R Other Project', 'Ongoing Project', 10000, 'exclusive', 0, '02620000-0000-0000-0000-0000000000f1'),
  ('02620000-0000-0000-0000-0000000000c9', '02620000-0000-0000-0000-000000000002', 'BWO X Project', 'Ongoing Project', 10000, 'exclusive', 0, '02620000-0000-0000-0000-0000000000f9');
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, closed_at, cancelled_at) values
  ('02620000-0000-0000-0000-0000000000d1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R One',       'Issued',    'WO-R-1', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d2', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Draft',     'Draft',     null,     1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Cancelled', 'Cancelled', 'WO-R-3', 1000, 'exclusive', 0, null,  now()),
  ('02620000-0000-0000-0000-0000000000d4', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Closed',    'Closed',    'WO-R-4',  500, 'exclusive', 0, now(), null),
  ('02620000-0000-0000-0000-0000000000d6', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Six',       'Issued',    'WO-R-6', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Seven',     'Issued',    'WO-R-7', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d8', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'R Eight',     'Issued',    'WO-R-8', 1000, 'exclusive', 0, null,  null),
  ('02620000-0000-0000-0000-0000000000d9', '02620000-0000-0000-0000-000000000002', '02620000-0000-0000-0000-0000000000c9', 'X Nine',      'Issued',    'WO-X-9', 1000, 'exclusive', 0, null,  null);
insert into boq_items (id, org_id, project_id, work_order_id, item_code, description, unit, quantity, rate) values
  ('02620000-0000-0000-0000-0000000000e7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d7', 'STATION', 'Station build', 'unit', 10, 600);
-- A cancelled 300 on the Closed work order, loaded server-side (no JWT): §C revives it.
insert into sales_invoices (id, org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('02620000-0000-0000-0000-0000000005ac', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d4', '2026-10-01', 300, 'exclusive', 0, 'USD', 'Cancelled');

-- ── §A the native path: Finance records invoices in an org whose revenue PMO owns ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a1', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 600, 'exclusive', 0, 'USD') $$,
  'AC-BWO-002 Finance invoices 600 of a 1,000 work order');                                                          -- 1
select throws_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a2', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 401, 'exclusive', 0, 'USD') $$,
  'BW001', 'this invoice would bill 401.00 against work order WO-R-1 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 an invoice that would pass the work order is refused, naming what is left');                           -- 2
select lives_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a3', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 400, 'exclusive', 0, 'USD') $$,
  'AC-BWO-002 exactly what is left is accepted');                                                                     -- 3
select throws_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a4', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d1', 0.01, 'exclusive', 0, 'USD') $$,
  'BW001', 'this invoice would bill 0.01 against work order WO-R-1 (worth 1000.00 excl. tax, with 1000.00 already invoiced or in draft): only 0.00 is still to invoice',
  'AC-BWO-002 one cent past the value is refused');                                                                   -- 4
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d2', 10, 'exclusive', 0, 'USD') $$,
  'BW001', 'work order R Draft is Draft: only an issued or closed work order can be invoiced',
  'AC-BWO-002 a Draft work order cannot be invoiced');                                                                -- 5
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d3', 10, 'exclusive', 0, 'USD') $$,
  'BW001', 'work order WO-R-3 is Cancelled: only an issued or closed work order can be invoiced',
  'AC-BWO-002 a Cancelled work order cannot be invoiced');                                                            -- 6
select lives_ok($$ insert into sales_invoices (id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a5', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d4', 500, 'exclusive', 0, 'USD') $$,
  'AC-BWO-002 a Closed work order can still be invoiced (DD-BWO-7)');                                                -- 7
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d6', 10, 'exclusive', 0, 'EUR') $$,
  'BW001', 'this invoice is in EUR but work order WO-R-6 is in USD: a work order is invoiced in its own currency',
  'AC-BWO-002 an invoice in another currency than its work order is refused');                                       -- 8
reset role;

-- ── §B the ERP path: the outbox fence runs before any ERP write ─────────────────────────────────────
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c01', 'bwo-k1', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":2,"rate":300}]}') $$,
  'AC-BWO-002 an ERP create of 600 against a 1,000 work order is queued');                                          -- 9
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c02', 'bwo-k2', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":401}]}') $$,
  'BW001', 'this invoice would bill 401.00 against work order WO-R-6 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 a second ERP create that would pass the work order is refused before any ERP write — the first counts while in flight'); -- 10
set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ insert into sales_invoices (project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d6', 401, 'exclusive', 0, 'USD') $$,
  'BW001', 'this invoice would bill 401.00 against work order WO-R-6 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 a native invoice sees the in-flight ERP command too');                                                -- 11
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c03', 'bwo-k3', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":400}]}') $$,
  'AC-BWO-002 an ERP create of exactly what is left is queued');                                                    -- 12
update external_command_outbox set state = 'failed' where pmo_record_id = '02620000-0000-0000-0000-000000000c01';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c04', 'bwo-k4', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":600}]}') $$,
  'AC-BWO-002 a failed command no longer counts');                                                                  -- 13
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c05', 'bwo-k5', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","workOrderId":"02620000-0000-0000-0000-0000000000d6","projectId":"02620000-0000-0000-0000-0000000000c1","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":"5"}]}') $$,
  'BW001', 'the invoice amount could not be read, so it cannot be checked against work order WO-R-6',
  'AC-BWO-002 a command whose lines cannot be read is refused, never waved through');                               -- 14
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c06', 'bwo-k6', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","workOrderId":"02620000-0000-0000-0000-0000000000d9","projectId":"02620000-0000-0000-0000-0000000000c9","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":1}]}') $$,
  'BW001', 'work order not found',
  'AC-BWO-002 another organisation''s work order is refused as not found');                                         -- 15
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-000000000c07', 'bwo-k7', 'erpnext', 'create', 'pending',
          '{"erp_doc_kind":"sales-invoice","workOrderId":"02620000-0000-0000-0000-0000000000d1","projectId":"02620000-0000-0000-0000-0000000000c2","currency":"USD","items":[{"item_code":"SVC","qty":1,"rate":1}]}') $$,
  'BW001', 'the work order must be on the same project as the invoice',
  'AC-BWO-002 another project''s work order is refused before the ERP write (its mirror would otherwise be refused after it)'); -- 16
select throws_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-0000000005a1', 'bwo-k8', 'erpnext', 'update', 'pending',
          '{"erp_doc_kind":"sales-invoice","externalRecordId":"SI-1","items":[{"item_code":"SVC","qty":1,"rate":601}]}') $$,
  'BW001', 'this invoice would bill 601.00 against work order WO-R-1 (worth 1000.00 excl. tax, with 400.00 already invoiced or in draft): only 600.00 is still to invoice',
  'AC-BWO-002 an ERP edit whose rebuilt lines would pass the rest is refused (its work order is the mirror row''s)'); -- 17
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', '02620000-0000-0000-0000-0000000005a1', 'bwo-k9', 'erpnext', 'update', 'pending',
          '{"erp_doc_kind":"sales-invoice","externalRecordId":"SI-1","received_date":"2026-10-07"}') $$,
  'AC-BWO-002 an ERP edit that rebuilds no lines moves no money and is not checked');                               -- 18

-- ── §C the mirror is never refused; user-JWT updates are ────────────────────────────────────────────
select lives_ok($$ insert into sales_invoices (id, org_id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency, status)
  values ('02620000-0000-0000-0000-0000000005b1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d6', 5000, 'exclusive', 0, 'USD', 'Unpaid') $$,
  'AC-BWO-002 the ERP mirror writer is never refused, even past the value (the ERP document already exists, DD-VI-3a)'); -- 19
select ok((select remaining < 0 from work_order_billing where work_order_id = '02620000-0000-0000-0000-0000000000d6'),
  'AC-BWO-002 …and the work order then reads over-invoiced');                                                       -- 20
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ update sales_invoices set amount = 700 where id = '02620000-0000-0000-0000-0000000005a1' $$,
  'BW001', 'this invoice would bill 700.00 against work order WO-R-1 (worth 1000.00 excl. tax, with 400.00 already invoiced or in draft): only 600.00 is still to invoice',
  'AC-BWO-002 a definer-style update raising an invoice past the value under a user JWT is refused');               -- 21
select lives_ok($$ update sales_invoices set amount = 500 where id = '02620000-0000-0000-0000-0000000005a1' $$,
  'AC-BWO-002 a reduction always passes');                                                                           -- 22
select throws_ok($$ update sales_invoices set status = 'Unpaid' where id = '02620000-0000-0000-0000-0000000005ac' $$,
  'BW001', 'this invoice would bill 300.00 against work order WO-R-4 (worth 500.00 excl. tax, with 500.00 already invoiced or in draft): only 0.00 is still to invoice',
  'AC-BWO-002 reviving a cancelled invoice past the value is refused');                                             -- 23

-- ── §D claims reserve their gross when created ──────────────────────────────────────────────────────
set local role authenticated;
select lives_ok($$ do $d$ begin perform set_config('bwo.claim', public.create_progress_claim(
    '02620000-0000-0000-0000-0000000000c1', 'progress', p_work_order_id => '02620000-0000-0000-0000-0000000000d7',
    p_lines => '[{"boq_item_id":"02620000-0000-0000-0000-0000000000e7","quantity":1}]'::jsonb)::text, true); end $d$ $$,
  'AC-BWO-002 a 600 claim on a 1,000 work order is accepted');                                                       -- 24
select throws_ok($$ select public.create_progress_claim('02620000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '02620000-0000-0000-0000-0000000000d7', p_lines => '[{"boq_item_id":"02620000-0000-0000-0000-0000000000e7","quantity":1}]'::jsonb) $$,
  'BW001', 'this invoice would bill 600.00 against work order WO-R-7 (worth 1000.00 excl. tax, with 600.00 already invoiced or in draft): only 400.00 is still to invoice',
  'AC-BWO-002 a claim whose gross would pass the work order is refused');                                           -- 25
reset role;
insert into project_documents (id, org_id, project_id, category, title, status, revision, file_path) values
  ('02620000-0000-0000-0000-0000000000a7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'Report', 'BWO evidence', 'Issued', 'A', 'e2e/bwo-evidence.pdf');
insert into progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by) values
  ('02620000-0000-0000-0000-000000000001', current_setting('bwo.claim')::uuid, '02620000-0000-0000-0000-0000000000a7', 'Issued', 'A', '02620000-0000-0000-0000-0000000000a2');
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('02620000-0000-0000-0000-000000000001', 'revenue', current_setting('bwo.claim'), 'bwo-k10', 'erpnext', 'create', 'pending',
          jsonb_build_object('erp_doc_kind', 'sales-invoice', 'workOrderId', '02620000-0000-0000-0000-0000000000d7',
                             'projectId', '02620000-0000-0000-0000-0000000000c1', 'currency', 'USD',
                             'items', jsonb_build_array(jsonb_build_object('item_code', 'STATION', 'qty', 1, 'rate', 999999)))) $$,
  'AC-BWO-002 a claim''s own invoice command is left to the claim, which reserved its gross when it was created');  -- 26

-- ── §E lock and grants ──────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('bwo.locks', (select count(*)::text from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()), true);
insert into sales_invoices (id, org_id, project_id, work_order_id, amount, tax_treatment, tax_amount, currency)
  values ('02620000-0000-0000-0000-0000000005a8', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d8', 10, 'exclusive', 0, 'USD');
select is((select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()),
  current_setting('bwo.locks')::int + 1,
  'AC-BWO-002 a billing write takes its work order''s advisory lock (DD-BWO-5)');                                   -- 27
reset request.jwt.claims;
select ok(not has_function_privilege('anon', 'public.assert_work_order_invoiceable(uuid,uuid,uuid,text,numeric,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.assert_work_order_invoiceable(uuid,uuid,uuid,text,numeric,text)', 'execute'),
  'AC-BWO-002 the refusal helper is not client-executable');                                                         -- 28
select ok(not exists (select 1 from (values ('public.lock_work_order_billing(uuid)'), ('public.invoice_command_line_total(jsonb)'),
                                            ('public.assert_sales_invoice_within_work_order()'), ('public.assert_outbox_invoice_within_work_order()')) f(sig)
                       where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'AC-BWO-002 the lock, line-total and trigger functions are not client-executable');                               -- 29
select is((select count(*)::int from pg_trigger
            where tgname in ('sales_invoices_zzzz_work_order_invoiceable', 'external_command_outbox_zz_work_order_invoice_fence')
              and not tgisinternal), 2,
  'AC-BWO-002 both fences are installed');                                                                           -- 30

select * from finish();
rollback;
```

Verify it fails: `cd "$WT" && scripts/with-db-lock.sh supabase test db supabase/tests/0262_work_order_billing_refusal.test.sql`
→ `not ok 2` (the 401 is accepted — no fence yet) and the later ones fail.

#### A4 — migration §4–§8: the helper, both fences, the claim edit (AC-BWO-002)

Append to `supabase/migrations/0262_billing_by_work_order.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — the helpers. INVOKER and with NO client EXECUTE: they are called only from §5/§6 (SECURITY DEFINER trigger
-- functions) and from create_progress_claim (SECURITY DEFINER), i.e. always as the owner.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- An ERP command's pre-tax line total: Σ round(qty × rate, 2) — ERPNext rounds each line amount the same way. NULL
-- (cannot be read) when there are no lines or any qty/rate is not a JSON number; the helper refuses a NULL.
create or replace function public.invoice_command_line_total(p_payload jsonb)
  returns numeric language sql immutable set search_path = public as $$
  select case when bool_and(jsonb_typeof(i -> 'qty') = 'number' and jsonb_typeof(i -> 'rate') = 'number')
              then sum(round((i ->> 'qty')::numeric * (i ->> 'rate')::numeric, 2)) end
    from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'items') = 'array' then p_payload -> 'items'
                                   else '[]'::jsonb end) i
$$;
revoke all on function public.invoice_command_line_total(jsonb) from public, anon, authenticated;

-- DD-BWO-5: the ONE definition of the per-work-order serialisation point (transaction-scoped).
create or replace function public.lock_work_order_billing(p_work_order_id uuid)
  returns void language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('work_order_billing:' || p_work_order_id::text, 0))
$$;
revoke all on function public.lock_work_order_billing(uuid) from public, anon, authenticated;

-- DD-BWO-1..5: the refusal. p_record_id is the record being written (excluded from "already billed" so an edit is
-- measured against everything ELSE); p_billed its billed work excl. tax; p_currency NULL when the caller has none.
create or replace function public.assert_work_order_invoiceable(
  p_org_id uuid, p_work_order_id uuid, p_project_id uuid, p_record_id text, p_billed numeric, p_currency text)
  returns void language plpgsql volatile set search_path = public as $$
declare
  v_org      uuid;
  v_project  uuid;
  v_status   public.work_order_status;
  v_currency text;
  v_label    text;
  v_net      numeric;
  v_existing numeric;
  v_unknown  boolean;
begin
  -- Taken FIRST, so every read below sees each billing write that committed before this one (DD-BWO-5).
  perform public.lock_work_order_billing(p_work_order_id);

  select wo.org_id, wo.project_id, wo.status, wo.currency, coalesce(wo.wo_number, wo.title),
         case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end
    into v_org, v_project, v_status, v_currency, v_label, v_net
    from public.work_orders wo where wo.id = p_work_order_id;
  if not found or v_org is distinct from p_org_id then
    raise exception 'work order not found' using errcode = 'BW001';
  end if;
  if v_project is distinct from p_project_id then
    raise exception 'the work order must be on the same project as the invoice' using errcode = 'BW001';
  end if;
  if v_status not in ('Issued', 'Closed') then
    raise exception 'work order % is %: only an issued or closed work order can be invoiced', v_label, v_status
      using errcode = 'BW001';
  end if;
  if p_currency is not null and p_currency is distinct from v_currency then
    raise exception 'this invoice is in % but work order % is in %: a work order is invoiced in its own currency',
      p_currency, v_label, v_currency using errcode = 'BW001';
  end if;
  -- `< 'Infinity'` is what rejects NaN (NaN sorts above every value) — the 0169/0193 construction.
  if p_billed is null or not (p_billed > '-Infinity'::numeric and p_billed < 'Infinity'::numeric) then
    raise exception 'the invoice amount could not be read, so it cannot be checked against work order %', v_label
      using errcode = 'BW001';
  end if;

  with lines as (
    -- what the views count (mirrored invoices + unraised claims), minus the record being written
    select l.record_id::text as record_id, l.billed, l.currency
      from public.work_order_billing_lines l
     where l.work_order_id = p_work_order_id and l.record_id::text <> lower(p_record_id)
    union all
    -- ERP commands still in flight (not yet mirrored, or an edit/amend not yet read back). A claim's own command is
    -- excluded: the claim already counts at gross. A command with no line array rebuilds no body and moves no money.
    select lower(o.pmo_record_id), public.invoice_command_line_total(o.payload), v_currency
      from public.external_command_outbox o
     where o.org_id = p_org_id and o.domain = 'revenue'
       and o.state in ('pending', 'committing', 'committed', 'quarantined', 'held')
       and o.payload ->> 'erp_doc_kind' = 'sales-invoice'
       and jsonb_typeof(o.payload -> 'items') = 'array'
       and (o.operation in ('create', 'update') or (o.operation = 'transition' and o.payload ->> 'verb' = 'amend'))
       and lower(o.pmo_record_id) <> lower(p_record_id)
       and not exists (select 1 from public.progress_claims pc where pc.id::text = lower(o.pmo_record_id))
       and lower(coalesce(nullif(btrim(o.payload ->> 'workOrderId'), ''),
                          (select si.work_order_id::text from public.sales_invoices si
                            where si.id::text = lower(o.pmo_record_id)))) = p_work_order_id::text
  ), per_record as (
    -- an invoice with an edit in flight counts at the larger of its mirrored and its pending amount
    select record_id, max(billed) as billed,
           bool_or(billed is null or currency is distinct from v_currency) as unknown
      from lines group by record_id
  )
  select coalesce(sum(billed), 0), coalesce(bool_or(unknown), false)
    into v_existing, v_unknown
    from per_record;

  if v_unknown then
    raise exception 'an invoice on work order % has no amount or is in another currency, so what is still to invoice cannot be checked',
      v_label using errcode = 'BW001';
  end if;
  if v_existing + p_billed > v_net then
    raise exception 'this invoice would bill % against work order % (worth % excl. tax, with % already invoiced or in draft): only % is still to invoice',
      round(p_billed, 2), v_label, round(v_net, 2), round(v_existing, 2), round(greatest(v_net - v_existing, 0), 2)
      using errcode = 'BW001';
  end if;
end; $$;
revoke all on function public.assert_work_order_invoiceable(uuid, uuid, uuid, text, numeric, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — sales_invoices: every writer except the service-role mirror and a no-JWT server load (DD-BWO-4).
-- ⚑ NOT actor_bypasses_rls(): this function is SECURITY DEFINER, so current_user is the owner for EVERY caller and
--   that predicate would exempt everyone — the DD-WO-8 lesson. The exemptions key on the JWT instead.
-- ⚑ Named zzzz_ so it fires AFTER stamp_org_id, the currency stamp and 0227's tax-base trigger (BEFORE triggers fire
--   in name order): it reads the stamped org, currency and tax amount.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_sales_invoice_within_work_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_dp       boolean;
  v_recovery numeric;
  v_new      numeric;
  v_old      numeric;
begin
  -- The ERP mirror (dispatch finalize, sweep, inbound feed): the ERP document already exists; refusing its mirror
  -- would wedge every sweep replay (DD-VI-3a). An overage shows as over-invoiced instead (FR-BWO-006).
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  -- A server-side load with no JWT (seed, migration, owner-run loader).
  if auth.uid() is null and session_user in ('postgres', 'supabase_admin') then return new; end if;
  if new.work_order_id is null or new.status = 'Cancelled' then return new; end if;

  -- The row's billed work, by the same rule as sales_invoice_work_billed (a claim invoice adds its recovery back; a
  -- down-payment invoice bills nothing).
  select pc.kind = 'down_payment', pc.dp_recovery_amount into v_dp, v_recovery
    from public.progress_claims pc where pc.id = new.id and pc.org_id = new.org_id;
  v_new := case when coalesce(v_dp, false) then 0
                else (case when new.tax_treatment = 'inclusive' then new.amount - new.tax_amount else new.amount end)
                     + coalesce(v_recovery, 0) end;

  if tg_op = 'UPDATE' and old.work_order_id is not distinct from new.work_order_id and old.status <> 'Cancelled' then
    v_old := case when coalesce(v_dp, false) then 0
                  else (case when old.tax_treatment = 'inclusive' then old.amount - old.tax_amount else old.amount end)
                       + coalesce(v_recovery, 0) end;
    -- A reduction, or a status move that bills the same, never needs refusing. NULL on either side falls through.
    if v_new <= v_old then return new; end if;
  end if;

  perform public.assert_work_order_invoiceable(new.org_id, new.work_order_id, new.project_id, new.id::text, v_new, new.currency);
  return new;
end; $$;
revoke all on function public.assert_sales_invoice_within_work_order() from public, anon, authenticated;
create trigger sales_invoices_zzzz_work_order_invoiceable
  before insert or update of work_order_id, amount, tax_amount, tax_treatment, status on public.sales_invoices
  for each row execute function public.assert_sales_invoice_within_work_order();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the ERP path: BEFORE INSERT on the outbox, which precedes every ERP POST (0134), so a refusal never strands
-- an ERP document. PostgREST runs the insert as one statement: the advisory lock is held until it commits.
-- zz_: fires after external_command_outbox_stamp_org_id (it reads NEW.org_id).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_outbox_invoice_within_work_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_record  text := lower(new.pmo_record_id);
  v_wo_text text;
  v_wo      uuid;
  v_project uuid;
  v_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if new.payload is null or new.payload ->> 'erp_doc_kind' is distinct from 'sales-invoice' then return new; end if;
  -- submit / cancel act on an existing document and build no body (buildsSalesInvoiceBody, dispatchFactory.ts)
  if not (new.operation in ('create', 'update') or (new.operation = 'transition' and new.payload ->> 'verb' = 'amend')) then
    return new;
  end if;
  if jsonb_typeof(new.payload -> 'items') is distinct from 'array' then return new; end if;
  if v_record !~ v_uuid then return new; end if;
  -- A billing claim reserved its gross when it was created (§7) and is immutable (0250).
  if exists (select 1 from public.progress_claims pc where pc.id = v_record::uuid) then return new; end if;

  if new.operation = 'create' then
    v_wo_text := lower(nullif(btrim(new.payload ->> 'workOrderId'), ''));
    if v_wo_text is null then return new; end if;
    if v_wo_text !~ v_uuid then
      raise exception 'work order not found' using errcode = 'BW001';
    end if;
    v_wo := v_wo_text::uuid;
    v_project := case when lower(new.payload ->> 'projectId') ~ v_uuid then lower(new.payload ->> 'projectId')::uuid end;
  else
    -- An edit or amend never moves the work order (DD-BWO-8): it is the mirror row's.
    select si.work_order_id, si.project_id into v_wo, v_project
      from public.sales_invoices si where si.id = v_record::uuid and si.org_id = new.org_id;
    if v_wo is null then return new; end if;
  end if;

  perform public.assert_work_order_invoiceable(new.org_id, v_wo, v_project, v_record,
    public.invoice_command_line_total(new.payload), nullif(btrim(new.payload ->> 'currency'), ''));
  return new;
end; $$;
revoke all on function public.assert_outbox_invoice_within_work_order() from public, anon, authenticated;
create trigger external_command_outbox_zz_work_order_invoice_fence
  before insert on public.external_command_outbox
  for each row when (new.domain = 'revenue')
  execute function public.assert_outbox_invoice_within_work_order();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — paired edit: 0250 §5's create_progress_claim, VERBATIM, with two marked additions (the billing lock before the
-- project row lock; the reservation before the progress insert). Down payments bill nothing against a work order
-- (DD-BWO-1), so the down-payment branch gains no call.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  -- ⚑ 0262 (OD-BILL-1, DD-BWO-5): the work order's billing lock BEFORE the project row lock — the order every billing
  --   writer uses, so a claim and a native invoice on one work order cannot deadlock.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or b.work_order_id is distinct from p_work_order_id) then
      raise exception 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4): a claim reserves its gross against its work order when it is created.
    if p_work_order_id is not null then
      perform public.assert_work_order_invoiceable(v_org, p_work_order_id, p_project_id, v_id::text, v_gross, v_currency);
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;
revoke all on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — hosted-grant assertion for §4–§7 (fails the migration, on the database itself, if any internal function is
-- client-executable or the claim RPC lost its grant).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_exposed text;
begin
  select string_agg(sig, ', ') into v_exposed
    from (values ('public.invoice_command_line_total(jsonb)'),
                 ('public.lock_work_order_billing(uuid)'),
                 ('public.assert_work_order_invoiceable(uuid,uuid,uuid,text,numeric,text)'),
                 ('public.assert_sales_invoice_within_work_order()'),
                 ('public.assert_outbox_invoice_within_work_order()')) f(sig)
   where has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute');
  if v_exposed is not null then
    raise exception '0262 §8: client roles can execute internal billing functions: %', v_exposed;
  end if;
  if has_function_privilege('anon', 'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)', 'execute') then
    raise exception '0262 §8: create_progress_claim grants drifted';
  end if;
end $$;
```

Verify green (refusal, figures, and every neighbour the fences touch):
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0262_work_order_billing_refusal.test.sql supabase/tests/0262_work_order_billing_figures.test.sql supabase/tests/0250_progress_billing_claims.test.sql supabase/tests/0250_progress_billing_withdraw.test.sql supabase/tests/0250_progress_billing_evidence.test.sql supabase/tests/0193_work_orders.test.sql supabase/tests/0169_create_path_sod_residuals.test.sql'`
→ all `ok`. If a 0250/0193 test reddens, read the failing assertion first: a test that inserts a linked invoice
under a user JWT past a work order's value is a real conflict to report, not to edit.

#### A5 — failing pgTAP: the dashboard figures (AC-UNB-004)

Create `supabase/tests/0262_unbilled_work_orders.test.sql`:

```sql
-- 0262_unbilled_work_orders.test.sql — OD-BILL-1 / #786 AC-UNB-004: what is still to invoice across the organisation.
-- Migration under test: 0262_billing_by_work_order.sql §9.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name) values
  ('02620000-0000-0000-0000-000000000001', 'BWO Org'),
  ('02620000-0000-0000-0000-000000000002', 'BWO Other Org');
update organizations set default_timezone = 'Asia/Jakarta' where id = '02620000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values
  ('02620000-0000-0000-0000-0000000000a2', 'bwo-u-fin@example.com'),
  ('02620000-0000-0000-0000-0000000000b1', 'bwo-u-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02620000-0000-0000-0000-0000000000a2', '02620000-0000-0000-0000-000000000001', 'BWO Fin', 'bwo-u-fin@example.com', 'Finance', 'active'),
  ('02620000-0000-0000-0000-0000000000b1', '02620000-0000-0000-0000-000000000002', 'BWO XOrg', 'bwo-u-xorg@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, archived_at) values
  ('02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-000000000001', 'BWO Live',     'Ongoing Project', 10000, 'exclusive', 0, null),
  ('02620000-0000-0000-0000-0000000000c2', '02620000-0000-0000-0000-000000000001', 'BWO Archived', 'Ongoing Project', 10000, 'exclusive', 0, now()),
  ('02620000-0000-0000-0000-0000000000c3', '02620000-0000-0000-0000-000000000001', 'BWO Other',    'Ongoing Project', 10000, 'exclusive', 0, null),
  ('02620000-0000-0000-0000-0000000000c9', '02620000-0000-0000-0000-000000000002', 'BWO X',        'Ongoing Project', 10000, 'exclusive', 0, null);
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, closed_at, cancelled_at) values
  ('02620000-0000-0000-0000-0000000000d1', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'D One',   'Issued',    'WO-D-1', 1000, 'exclusive', 0, null, null),
  ('02620000-0000-0000-0000-0000000000d2', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'D Two',   'Closed',    'WO-D-2',  500, 'exclusive', 0, now() - interval '3 days', null),
  ('02620000-0000-0000-0000-0000000000d3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'D Three', 'Issued',    'WO-D-3',  400, 'exclusive', 0, null, null),
  ('02620000-0000-0000-0000-0000000000d4', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'D Four',  'Draft',     null,      900, 'exclusive', 0, null, null),
  ('02620000-0000-0000-0000-0000000000d5', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', 'D Five',  'Cancelled', 'WO-D-5',  800, 'exclusive', 0, null, now()),
  ('02620000-0000-0000-0000-0000000000d6', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c2', 'D Six',   'Issued',    'WO-D-6',  700, 'exclusive', 0, null, null),
  ('02620000-0000-0000-0000-0000000000d7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c3', 'D Seven', 'Issued',    'WO-D-7',  600, 'exclusive', 0, null, null),
  ('02620000-0000-0000-0000-0000000000d9', '02620000-0000-0000-0000-000000000002', '02620000-0000-0000-0000-0000000000c9', 'X Nine',  'Issued',    'WO-X-9',   50, 'exclusive', 0, null, null);
insert into sales_invoices (id, org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('02620000-0000-0000-0000-0000000005c2', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d2', '2026-10-01', 200,  'exclusive', 0, 'USD', 'Unpaid'),
  ('02620000-0000-0000-0000-0000000005c3', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c1', '02620000-0000-0000-0000-0000000000d3', '2026-10-01', 400,  'exclusive', 0, 'USD', 'Paid'),
  ('02620000-0000-0000-0000-0000000005c7', '02620000-0000-0000-0000-000000000001', '02620000-0000-0000-0000-0000000000c3', '02620000-0000-0000-0000-0000000000d7', '2026-10-01', null, 'exclusive', 0, 'USD', 'Unpaid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.get_unbilled_work_orders(8) -> 'totals', '[{"currency":"USD","remaining":1300,"count":2}]'::jsonb,
  'AC-UNB-004 only Issued and Closed work orders on live projects with something left count: 1,000 + 300');          -- 1
select is((public.get_unbilled_work_orders(8) ->> 'incomplete_count')::int, 1,
  'AC-UNB-004 the work order that cannot be totalled is counted apart, never as zero');                              -- 2
select is((select string_agg(x.r ->> 'wo_number', ',' order by x.n)
             from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') with ordinality as x(r, n)),
  'WO-D-1,WO-D-2', 'AC-UNB-004 the rows are ordered by the amount left');                                            -- 3
select is((select (r ->> 'days_since_closed')::int from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r
            where r ->> 'wo_number' = 'WO-D-2'), 3,
  'AC-UNB-004 days since closed, counted in the organisation''s timezone');                                          -- 4
select ok((select r -> 'days_since_closed' = 'null'::jsonb from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r
            where r ->> 'wo_number' = 'WO-D-1'),
  'AC-UNB-004 an Issued work order has no days since closed');                                                       -- 5
select is(jsonb_array_length(public.get_unbilled_work_orders(1) -> 'rows'), 1,
  'AC-UNB-004 the rows are capped at the limit');                                                                    -- 6
select is(public.get_unbilled_work_orders(1) -> 'totals', public.get_unbilled_work_orders(8) -> 'totals',
  'AC-UNB-004 …while the totals still cover every work order');                                                      -- 7
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02620000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.get_unbilled_work_orders(8) -> 'totals', '[{"currency":"USD","remaining":50,"count":1}]'::jsonb,
  'AC-UNB-004 another organisation reads only its own');                                                             -- 8
reset role;
select ok(not has_function_privilege('anon', 'public.get_unbilled_work_orders(integer)', 'execute'),
  'AC-UNB-004 anon cannot execute it');                                                                              -- 9
select is((select prosecdef from pg_proc where oid = 'public.get_unbilled_work_orders(integer)'::regprocedure), false,
  'AC-UNB-004 it is SECURITY INVOKER — RLS stays the boundary');                                                     -- 10

select * from finish();
rollback;
```

Verify it fails: `cd "$WT" && scripts/with-db-lock.sh supabase test db supabase/tests/0262_unbilled_work_orders.test.sql`
→ `function public.get_unbilled_work_orders(integer) does not exist`.

#### A6 — migration §9: the dashboard reader (AC-UNB-004)

Append to `supabase/migrations/0262_billing_by_work_order.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — get_unbilled_work_orders (DD-BWO-10, #786): one jsonb document so the totals are computed server-side and are
-- never bounded by PostgREST max_rows. SECURITY INVOKER — do NOT add security definer: RLS scopes every read.
-- Totals per currency, never converted (DD-MMP-5). Deliberately NOT in 0178's allow-list (invoker; listing it would
-- blind that sweep if someone later flips it to definer — the get_project_drawdown note).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.get_unbilled_work_orders(p_limit integer default 8)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with zone as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as tz
  ),
  live as (
    select b.work_order_id, b.wo_number, b.title, b.project_id, p.name as project_name, b.status, b.currency,
           b.remaining, b.figures_complete,
           case when b.status = 'Closed' and b.closed_at is not null
                then (now() at time zone zone.tz)::date - (b.closed_at at time zone zone.tz)::date end as days_since_closed
      from public.work_order_billing b
      join public.projects p on p.id = b.project_id
      cross join zone
     where b.status in ('Issued', 'Closed') and p.archived_at is null
  ),
  billable as (
    select * from live where figures_complete and remaining > 0
  )
  select jsonb_build_object(
    'totals', coalesce((select jsonb_agg(jsonb_build_object('currency', t.currency, 'remaining', t.remaining, 'count', t.n)
                                         order by t.currency)
                          from (select currency, sum(remaining) as remaining, count(*)::int as n
                                  from billable group by currency) t), '[]'::jsonb),
    'incomplete_count', (select count(*)::int from live where not figures_complete),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.remaining desc, r.work_order_id)
                        from (select work_order_id, wo_number, title, project_id, project_name, status, currency,
                                     remaining, days_since_closed
                                from billable
                               order by remaining desc, work_order_id
                               limit greatest(1, least(coalesce(p_limit, 8), 50))) r), '[]'::jsonb))
$$;
comment on function public.get_unbilled_work_orders(integer) is
  'OD-BILL-1 / #786 DD-BWO-10: what is still to invoice on the org''s Issued and Closed work orders on live projects — '
  'totals per currency, the untotallable count, and the work orders with the most left. SECURITY INVOKER on purpose.';
revoke all on function public.get_unbilled_work_orders(integer) from public, anon;
grant execute on function public.get_unbilled_work_orders(integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_unbilled_work_orders(integer)', 'execute') then
    raise exception '0262 §9: anon can execute get_unbilled_work_orders';
  end if;
  if not has_function_privilege('authenticated', 'public.get_unbilled_work_orders(integer)', 'execute') then
    raise exception '0262 §9: authenticated cannot execute get_unbilled_work_orders';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.get_unbilled_work_orders(integer)'::regprocedure) then
    raise exception '0262 §9: get_unbilled_work_orders must stay SECURITY INVOKER';
  end if;
end $$;
```

Verify green:
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0262_unbilled_work_orders.test.sql supabase/tests/0262_work_order_billing_figures.test.sql supabase/tests/0262_work_order_billing_refusal.test.sql'` → all `ok`.

#### A7 — the rollback file

Create `supabase/migrations/rollback/0262_billing_by_work_order_down.sql` by running exactly:

```bash
cd "$WT" && {
  cat <<'SQL'
-- Reverses 0262 (OD-BILL-1). Run BEFORE 0251's and 0250's rollbacks. Posted ERP documents are untouched.
drop trigger if exists external_command_outbox_zz_work_order_invoice_fence on public.external_command_outbox;
drop trigger if exists sales_invoices_zzzz_work_order_invoiceable on public.sales_invoices;
drop function if exists public.assert_outbox_invoice_within_work_order();
drop function if exists public.assert_sales_invoice_within_work_order();
drop function if exists public.get_unbilled_work_orders(integer);
-- Restore 0250 §5's create_progress_claim verbatim (without 0262's lock and reservation):
SQL
  sed -n '355,512p' supabase/migrations/0250_progress_billing.sql
  cat <<'SQL'
drop function if exists public.assert_work_order_invoiceable(uuid, uuid, uuid, text, numeric, text);
drop function if exists public.lock_work_order_billing(uuid);
drop function if exists public.invoice_command_line_total(jsonb);
drop view if exists public.work_order_billing;
drop view if exists public.work_order_billing_lines;
-- `create or replace view` cannot drop a column: drop and re-create 0250 §8's definition verbatim.
drop view if exists public.sales_invoice_work_billed;
SQL
  sed -n '690,701p' supabase/migrations/0250_progress_billing.sql
} > supabase/migrations/rollback/0262_billing_by_work_order_down.sql
```

Verify the round trip on a reset database:
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0262_billing_by_work_order_down.sql && supabase test db supabase/tests/0250_progress_billing_claims.test.sql supabase/tests/0250_progress_billing_summary.test.sql supabase/tests/0251_management_pack_billed_work.test.sql && supabase db reset'`
→ psql exits 0, the three 0250/0251 files are all `ok`, and the final reset restores 0262.

#### A8 — the allow-list count and the isolation denominator are unchanged

No edit is expected. Prove it:
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0171_sod_class_completeness.test.sql supabase/tests/postgrest_embed_ambiguity_guard.test.sql' && node scripts/check-isolation-denominator.mjs`
→ 0178 prints `ok … all 59 retained client-callable RPC names …` and `ok … all 59 retained client-callable RPCs retain
authenticated EXECUTE …`; the denominator check prints `PASS isolation denominator: …` with no `MISSING` or `STALE`
line. Reason, recorded for review: 0262 adds no table (`relkind r/p`), and its only SECURITY DEFINER functions are
trigger functions (excluded from the denominator's `DEFINERS_SQL`) with no client EXECUTE (so 0178's sweep does not
see them); `get_unbilled_work_orders` is INVOKER. If either check reports a difference, STOP and report.

#### A9 — mutation checks (each must turn the named assertions red; restore after each)

```bash
cd "$WT" && cp supabase/migrations/0262_billing_by_work_order.sql "$WT/.0262.orig"
```

| # | Mutation (edit `supabase/migrations/0262_billing_by_work_order.sql`) | Must go red (`0262_work_order_billing_refusal.test.sql` unless noted) |
|---|---|---|
| M1 | replace `if v_existing + p_billed > v_net then` with `if false then` | 2, 4, 10, 11, 17, 21, 23, 25 |
| M2 | in the helper's `lines` CTE, delete the whole second `union all` branch (the `external_command_outbox` select) | 10, 11 |
| M3 | in `assert_sales_invoice_within_work_order`, replace `if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;` with `if public.actor_bypasses_rls() then return new; end if;` | 2, 4, 5, 6, 8, 11, 21, 23 |
| M4 | in the helper, delete `perform public.lock_work_order_billing(p_work_order_id);` | 27 |
| M5 | in `work_order_billing_lines`, replace `and w.status <> 'Cancelled'` with `and true` | `0262_work_order_billing_figures.test.sql` 3, 5, 11 |
| M6 | in `assert_outbox_invoice_within_work_order`, delete `if exists (select 1 from public.progress_claims pc where pc.id = v_record::uuid) then return new; end if;` | 26 |

For each row: apply the edit, run
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0262_work_order_billing_refusal.test.sql supabase/tests/0262_work_order_billing_figures.test.sql'`,
confirm every listed number prints `not ok` (others may redden too — the listed ones must), then restore:
`cd "$WT" && cp "$WT/.0262.orig" supabase/migrations/0262_billing_by_work_order.sql && cmp "$WT/.0262.orig" supabase/migrations/0262_billing_by_work_order.sql`.
After M6: `rm "$WT/.0262.orig"` and re-run A6's verify (all green). Paste the six `not ok` lists into the PR body.
A mutation that leaves a listed row green is a dead oracle: fix the test, never the list.

#### A10 — regenerate the types

`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`
Verify: `cd "$WT" && grep -c 'work_order_billing' pmo-portal/src/lib/supabase/database.types.ts` ≥ 2 and
`grep -c 'get_unbilled_work_orders' pmo-portal/src/lib/supabase/database.types.ts` ≥ 1; `cd "$WT/pmo-portal" && npm run typecheck` → 0 errors.

---

### Part B — the dispatch and the create command

#### B1 — replace the superseded dispatch test (AC-BWO-003, red)

In `pmo-portal/src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts`, replace exactly:

```ts
  it('AC-PB-020 an ordinary invoice never takes a caller-supplied work order', async () => {
    const { body, command: cmd } = await push({ workOrderId: 'wo-1', items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] }, null);
    expect(cmd.record.workOrderId).toBeUndefined();
    expect(body.po_no).toBeUndefined();
  });
```

with:

```ts
  // OD-BILL-1 / DD-BWO-8 deliberately reverses the 0250-era rule this test used to pin ("an ordinary invoice never
  // takes a caller-supplied work order"). The protection moved rather than disappeared: the link pre-flight checks the
  // work order's org, and the outbox fence (0262, AC-BWO-002) checks its project, status and what is left BEFORE any
  // ERP write — so the stranded-mirror risk the old rule avoided cannot occur.
  it('AC-BWO-003 an ordinary invoice create keeps the work order it names and takes the client PO from it', async () => {
    const { body, command: cmd } = await push({ workOrderId: 'wo-1', items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] }, null);
    expect(cmd.record.workOrderId).toBe('wo-1');
    expect(body.po_no).toBe('WO-PO-001');
  });

  it('AC-BWO-003 an edit never moves an ordinary invoice onto a caller-named work order', async () => {
    const cmd = command({ id: 'si-9', workOrderId: 'wo-1', externalRecordId: 'SYNTHETIC-SI-9', items: [{ item_code: 'OWN-ITEM', qty: 1, rate: 1 }] }, 'update');
    const { attempt } = refused(cmd, null);
    await attempt.catch(() => undefined);
    expect(cmd.record.workOrderId).toBeUndefined();
  });
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts`
→ the "keeps the work order" test fails (`expected undefined to be 'wo-1'`); the "edit never moves" test passes (it
guards against B2 over-correcting).

#### B2 — keep `workOrderId` on an ordinary create (AC-BWO-003, green)

In `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`, replace exactly:

```ts
  // `taxes` is server-resolved for a claim only (deleted above): a caller can never smuggle tax rows into an invoice.
  // Likewise the work order: only a claim sets it (from the claim row, below). An ordinary invoice's work order
  // comes from its own mirror row, never from the caller's command.
  if (!claimData) {
    delete record.workOrderId;
    return 'ordinary';
  }
```

with:

```ts
  // `taxes` is server-resolved for a claim only (deleted above): a caller can never smuggle tax rows into an invoice.
  // OD-BILL-1 / DD-BWO-8: an ordinary invoice CREATE may name the work order it bills ("Invoice this work order", the
  // assistant's work-order draft). Its org is checked by the link pre-flight (DOMAIN_LINK_FIELDS); its project, status
  // and what is still to invoice by the outbox fence (0262) before any ERP write. Edits and amends never move it —
  // their work order is the mirror row's, which that same fence reads.
  if (!claimData) {
    const named = typeof record.workOrderId === 'string' && record.workOrderId.trim() !== '';
    if (deps.command.operation !== 'create' || !named) delete record.workOrderId;
    return 'ordinary';
  }
```

In `supabase/functions/adapter-dispatch/readModelWriters.ts`, replace exactly:

```ts
    // #766: a claim invoice records the work order it bills (the dispatch set it from the claim). The
    // same-project trigger (0193 §10) re-checks it; an absent work order writes no key at all.
```

with:

```ts
    // #766 + OD-BILL-1 (DD-BWO-8): a create records the work order it bills — a claim's (set from the claim) or the
    // one an ordinary create names. The outbox fence (0262) checked its project, status and what is left before the
    // ERP write, so the same-project trigger (0193 §10) cannot refuse it here; an absent work order writes no key.
```

Verify green:
`cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts src/lib/adapterSeam/erpnext/salesInvoicePo.test.ts`
and `cd "$WT/supabase/functions/adapter-dispatch" && deno test --allow-env --allow-net --allow-read readModelWriters.money.test.ts` → all pass.

#### B3 — `BW001` is a 422 business rejection (AC-BWO-002 / AC-BWO-003)

Append to `supabase/functions/adapter-dispatch/dispatchErrorStatus.test.ts`:

```ts
// OD-BILL-1 (0262, DD-BWO-4): the work-order over-invoice fence raises SQLSTATE BW001 from the outbox insert, before
// any ERP write. The request was well-formed; the rule refused it — 422, never the 500 fallback.
Deno.test('AC-BWO-003 the work-order over-invoice refusal (BW001) is a 422 business rejection at both exits', () => {
  assert(dispatchErrorStatus('BW001', 500) === 422, 'the dispatch exit must answer 422, not its 500 fallback');
  assert(dispatchErrorStatus('BW001', 400) === 422, 'the adapter-select exit must answer 422, not its 400 fallback');
  assert(isBusinessRejectionCode('BW001'), 'BW001 is a classified business rejection');
});
```

Verify red: `cd "$WT/supabase/functions/adapter-dispatch" && deno test --allow-env --allow-net --allow-read dispatchErrorStatus.test.ts` → the new test fails.

In `supabase/functions/adapter-dispatch/dispatchErrorStatus.ts`, replace exactly:

```ts
  'budget-unowned-live-occupant',
];
```

with:

```ts
  'budget-unowned-live-occupant',
  // OD-BILL-1 (0262, DD-BWO-4): the work-order over-invoice fence. A BEFORE INSERT trigger on the outbox raises SQLSTATE
  // BW001 before any ERP write when an invoice would bill past its work order, names a Draft/Cancelled one, one on
  // another project, or lines it cannot read. The request was well-formed; the rule refused it.
  'BW001',
];
```

Verify green: same command → all pass.

#### B4 — the create command carries `workOrderId` (AC-BWO-003)

Append to `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.test.ts`:

```ts
it('AC-BWO-003 carries the work order an invoice bills', () => {
  const items = [{ item_code: 'SVC', qty: 1, rate: 100 }];
  expect(salesInvoiceCreateFields({ customerId: 'c', projectId: 'p', items, workOrderId: 'wo-1' }))
    .toEqual({ customerId: 'c', projectId: 'p', items, workOrderId: 'wo-1', erp_doc_kind: 'sales-invoice' });
});
```

Verify red: `cd "$WT/pmo-portal" && npm run typecheck` → `Object literal may only specify known properties, and 'workOrderId' does not exist`.

In `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts`, replace exactly:

```ts
  /** Client PO / contract ref (→ ERPNext po_no). Omit to let the dispatch fall back to the work order / project. */
  reference_number?: string | null;
}
```

with:

```ts
  /** Client PO / contract ref (→ ERPNext po_no). Omit to let the dispatch fall back to the work order / project. */
  reference_number?: string | null;
  /** OD-BILL-1 (DD-BWO-8): the work order this invoice bills. The outbox fence (0262) refuses one that is not Issued or
   *  Closed, is on another project, or has too little left. */
  workOrderId?: string | null;
}
```

In `pmo-portal/src/lib/repositories/types.ts`, replace exactly:

```ts
  createInvoice(input: {
    customerId: string;
    projectId?: string | null;
    items: Array<{ item_code: string; qty: number; rate: number; description?: string }>;
  }, intent?: CommandIntent): Promise<{ id: string; si_number: string }>;
```

with:

```ts
  createInvoice(input: {
    customerId: string;
    projectId?: string | null;
    items: Array<{ item_code: string; qty: number; rate: number; description?: string }>;
    /** OD-BILL-1: the work order this invoice bills ("Invoice this work order"). */
    workOrderId?: string | null;
  }, intent?: CommandIntent): Promise<{ id: string; si_number: string }>;
```

Verify green: `cd "$WT/pmo-portal" && npm run typecheck && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/salesInvoiceCommand.test.ts` → 0 errors, pass.

#### B5 — creating an invoice refreshes work-order billing (AC-BWO-003 / AC-BWO-004)

Create `pmo-portal/src/hooks/useRevenue.workOrderBilling.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 'si-1', si_number: 'ACC-SINV-1' })) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: { createInvoice: h.create } } }));

import { useRevenueMutations } from './useRevenue';

describe('useRevenueMutations.create (OD-BILL-1)', () => {
  it('AC-BWO-003 sends the work order and refreshes work-order billing and the dashboard figure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRevenueMutations(), { wrapper });
    const input = { customerId: 'c-1', projectId: 'p1', workOrderId: 'wo-1', items: [{ item_code: 'SVC', qty: 1, rate: 10 }] };
    await act(async () => { await result.current.create.mutateAsync(input); });
    expect(h.create).toHaveBeenCalledWith(input, undefined);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-order-billing'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['unbilled-work-orders'] });
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/hooks/useRevenue.workOrderBilling.test.tsx` → the invalidation assertions fail.

In `pmo-portal/src/hooks/useRevenue.ts`, replace exactly:

```ts
    qc.invalidateQueries({ queryKey: ['revenueByProject'] });
  };
```

with:

```ts
    qc.invalidateQueries({ queryKey: ['revenueByProject'] });
    // OD-BILL-1: an invoice moves its work order's billing and the dashboard's still-to-invoice.
    qc.invalidateQueries({ queryKey: ['work-order-billing'] });
    qc.invalidateQueries({ queryKey: ['unbilled-work-orders'] });
  };
```

and replace exactly:

```ts
    mutationFn: ({ intent, ...input }: { customerId: string; projectId?: string | null; items: Array<{ item_code: string; qty: number; rate: number; description?: string }>; intent?: CommandIntent }) =>
```

with:

```ts
    mutationFn: ({ intent, ...input }: { customerId: string; projectId?: string | null; workOrderId?: string | null; items: Array<{ item_code: string; qty: number; rate: number; description?: string }>; intent?: CommandIntent }) =>
```

Verify green: same command → pass; `cd "$WT/pmo-portal" && npm run typecheck` → 0 errors.

---

### Part C — figures, data and strings

#### C1 — pure helpers (AC-BWO-004, AC-UNB-002)

Create `pmo-portal/src/lib/workOrderBilling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  canInvoiceWorkOrder, deriveWorkOrderBillingState, invoiceAmountProblem, summarizeProjectWorkOrderBilling,
} from './workOrderBilling';
import type { WorkOrderBillingRow } from './db/workOrderBilling';

const bill = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 500_000, invoiced: 330_000,
  pending: 90_000, paid: 100_000, remaining: 80_000, figuresComplete: true, lineCount: 6, unpaidCount: 3, ...over,
});

describe('deriveWorkOrderBillingState (OD-BILL-1)', () => {
  it.each([
    ['partly invoiced', bill(), 'partly-invoiced'],
    ['not invoiced', bill({ invoiced: 0, pending: 0, paid: 0, remaining: 500_000, lineCount: 0, unpaidCount: 0 }), 'not-invoiced'],
    ['fully invoiced, some unpaid', bill({ invoiced: 500_000, pending: 0, remaining: 0, unpaidCount: 2 }), 'fully-invoiced'],
    ['fully invoiced with a draft', bill({ invoiced: 450_000, pending: 50_000, remaining: 0, unpaidCount: 0 }), 'fully-invoiced'],
    ['paid', bill({ invoiced: 500_000, pending: 0, paid: 500_000, remaining: 0, unpaidCount: 0 }), 'paid'],
    ['over-invoiced', bill({ remaining: -1_000 }), 'over-invoiced'],
    ['cannot total', bill({ figuresComplete: false }), 'incomplete'],
  ] as const)('AC-BWO-004 %s', (_label, row, state) => {
    expect(deriveWorkOrderBillingState('Issued', row)).toBe(state);
  });
  it('AC-BWO-004 a Draft or Cancelled work order is not billable; an exact-to-the-cent remainder is zero', () => {
    expect(deriveWorkOrderBillingState('Draft', bill({ invoiced: 0, pending: 0, remaining: 500_000, lineCount: 0 }))).toBe('not-billable');
    expect(deriveWorkOrderBillingState('Cancelled', bill())).toBe('not-billable');
    expect(deriveWorkOrderBillingState('Closed', bill({ invoiced: 500_000, pending: 0, paid: 500_000, remaining: 0.004, unpaidCount: 0 }))).toBe('paid');
  });
});

describe('canInvoiceWorkOrder', () => {
  it('AC-BWO-004 only an Issued or Closed work order with something left and figures that total', () => {
    expect(canInvoiceWorkOrder('Issued', bill())).toBe(true);
    expect(canInvoiceWorkOrder('Closed', bill())).toBe(true);
    expect(canInvoiceWorkOrder('Draft', bill())).toBe(false);
    expect(canInvoiceWorkOrder('Issued', bill({ remaining: 0 }))).toBe(false);
    expect(canInvoiceWorkOrder('Issued', bill({ remaining: -5 }))).toBe(false);
    expect(canInvoiceWorkOrder('Issued', bill({ figuresComplete: false }))).toBe(false);
  });
});

describe('summarizeProjectWorkOrderBilling', () => {
  it('AC-UNB-002 adds Issued and Closed work orders; an over-invoiced one adds nothing left; Draft/Cancelled are ignored', () => {
    const rows = [
      bill(),
      bill({ workOrderId: 'wo-2', status: 'Closed', invoiced: 105_000, pending: 0, paid: 0, remaining: -5_000 }),
      bill({ workOrderId: 'wo-3', status: 'Draft', invoiced: 0, pending: 0, paid: 0, remaining: 900_000 }),
    ];
    expect(summarizeProjectWorkOrderBilling(rows)).toEqual({ invoiced: 435_000, paid: 100_000, stillToInvoice: 80_000, complete: true });
  });
  it('AC-UNB-002 one untotallable work order makes the totals incomplete', () => {
    expect(summarizeProjectWorkOrderBilling([bill(), bill({ workOrderId: 'wo-2', figuresComplete: false })]).complete).toBe(false);
  });
  it('sums in cents', () => {
    expect(summarizeProjectWorkOrderBilling([bill({ invoiced: 0.1, paid: 0, remaining: 0.2 }), bill({ workOrderId: 'wo-2', invoiced: 0.2, paid: 0, remaining: 0.1 })]))
      .toMatchObject({ invoiced: 0.3, stillToInvoice: 0.3 });
  });
});

describe('invoiceAmountProblem', () => {
  it('AC-BWO-004 refuses unreadable, zero and over-the-rest amounts; equal is fine', () => {
    expect(invoiceAmountProblem(null, 100)).toBe('invalid');
    expect(invoiceAmountProblem(0, 100)).toBe('not-positive');
    expect(invoiceAmountProblem(100.01, 100)).toBe('over-remaining');
    expect(invoiceAmountProblem(100, 100)).toBeNull();
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/workOrderBilling.test.ts` → cannot resolve `./workOrderBilling`.

Create `pmo-portal/src/lib/workOrderBilling.ts`:

```ts
import type { WorkOrderStatus } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

/**
 * Work-order billing, derived for display (OD-BILL-1, DD-BWO-1..3 / 10). The figures come from the view
 * `work_order_billing` (0262); these helpers only classify and add them, in integer cents. The database is the
 * authority on what may be invoiced — `canInvoiceWorkOrder` only decides whether to OFFER the button.
 */
export type WorkOrderBillingState =
  | 'not-billable' | 'incomplete' | 'over-invoiced' | 'not-invoiced' | 'paid' | 'fully-invoiced' | 'partly-invoiced';

const cents = (value: number): number => Math.round(value * 100);
const BILLABLE: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>(['Issued', 'Closed']);

export function deriveWorkOrderBillingState(status: WorkOrderStatus, f: WorkOrderBillingRow): WorkOrderBillingState {
  if (!f.figuresComplete) return 'incomplete';
  if (cents(f.remaining) < 0) return 'over-invoiced';
  if (!BILLABLE.has(status)) return 'not-billable';
  if (cents(f.invoiced) + cents(f.pending) <= 0) return 'not-invoiced';
  // DD-BWO-2: Paid = nothing left, nothing in draft, every submitted invoice Paid.
  if (cents(f.remaining) === 0 && cents(f.pending) === 0 && f.unpaidCount === 0) return 'paid';
  if (cents(f.remaining) === 0) return 'fully-invoiced';
  return 'partly-invoiced';
}

export function canInvoiceWorkOrder(status: WorkOrderStatus, f: WorkOrderBillingRow): boolean {
  return BILLABLE.has(status) && f.figuresComplete && cents(f.remaining) > 0;
}

export interface ProjectWorkOrderBillingTotals {
  invoiced: number;
  paid: number;
  stillToInvoice: number;
  /** false when any Issued/Closed work order's figures cannot be totalled — render "Unavailable", never a sum. */
  complete: boolean;
}

/** AC-UNB-002: totals over the project's Issued and Closed work orders; an over-invoiced one adds nothing left. */
export function summarizeProjectWorkOrderBilling(rows: ReadonlyArray<WorkOrderBillingRow>): ProjectWorkOrderBillingTotals {
  let invoiced = 0;
  let paid = 0;
  let still = 0;
  let complete = true;
  for (const r of rows) {
    if (!BILLABLE.has(r.status)) continue;
    if (!r.figuresComplete) {
      complete = false;
      continue;
    }
    invoiced += cents(r.invoiced);
    paid += cents(r.paid);
    still += Math.max(0, cents(r.remaining));
  }
  return { invoiced: invoiced / 100, paid: paid / 100, stillToInvoice: still / 100, complete };
}

export type InvoiceAmountProblem = 'invalid' | 'not-positive' | 'over-remaining';

/** The dialog's check; the database repeats it (and counts in-flight commands the client cannot see). */
export function invoiceAmountProblem(amount: number | null, remaining: number): InvoiceAmountProblem | null {
  if (amount === null || !Number.isFinite(amount)) return 'invalid';
  if (cents(amount) <= 0) return 'not-positive';
  if (cents(amount) > cents(remaining)) return 'over-remaining';
  return null;
}
```

(`WorkOrderBillingRow` is created in C2; until then this task's verify is red on the import — run C2, then verify both.)

#### C2 — the DAL (AC-BWO-004, AC-UNB-005)

Create `pmo-portal/src/lib/db/workOrderBilling.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { rows: { data: null as unknown, error: null as unknown }, rpc: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], select: [] as string[], eq: [] as unknown[][], limit: [] as number[], rpc: [] as unknown[][] };
  const builder: Record<string, unknown> = {};
  builder.select = (c: string) => { calls.select.push(c); return builder; };
  builder.eq = (...a: unknown[]) => { calls.eq.push(a); return builder; };
  builder.limit = (n: number) => { calls.limit.push(n); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(state.rows);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(state.rpc); });
  return { state, calls, from, rpc };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { getUnbilledWorkOrders, listWorkOrderBilling } from './workOrderBilling';

const ROW = {
  work_order_id: 'wo-1', project_id: 'p1', status: 'Issued', currency: 'USD', order_net: 500000, invoiced: '330000.00',
  pending: 90000, paid: 100000, remaining: 80000, figures_complete: true, line_count: 6, unpaid_count: 3,
};

beforeEach(() => {
  h.state.rows = { data: null, error: null };
  h.state.rpc = { data: null, error: null };
  for (const k of Object.keys(h.calls) as Array<keyof typeof h.calls>) h.calls[k].length = 0;
});

describe('work-order billing DAL (OD-BILL-1)', () => {
  it("AC-BWO-004 reads the project's rows from the view, numbers normalised", async () => {
    h.state.rows = { data: [ROW], error: null };
    expect(await listWorkOrderBilling('p1')).toEqual([{
      workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 500000, invoiced: 330000,
      pending: 90000, paid: 100000, remaining: 80000, figuresComplete: true, lineCount: 6, unpaidCount: 3,
    }]);
    expect(h.calls.from).toEqual(['work_order_billing']);
    expect(h.calls.eq).toEqual([['project_id', 'p1']]);
    expect(h.calls.limit).toEqual([501]);
  });
  it('NFR-BWO-005 a missing figure is an error, never a zero', async () => {
    h.state.rows = { data: [{ ...ROW, remaining: null }], error: null };
    await expect(listWorkOrderBilling('p1')).rejects.toMatchObject({ code: 'malformed-billing' });
  });
  it('NFR-BWO-003 more than 500 work orders is refused rather than silently truncated', async () => {
    h.state.rows = { data: Array.from({ length: 501 }, (_, i) => ({ ...ROW, work_order_id: `wo-${i}` })), error: null };
    await expect(listWorkOrderBilling('p1')).rejects.toMatchObject({ code: 'too-many-work-orders' });
  });
  it('a read error keeps its code', async () => {
    h.state.rows = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listWorkOrderBilling('p1')).rejects.toMatchObject({ code: '42501' });
  });
  it('AC-UNB-005 parses the dashboard document', async () => {
    h.state.rpc = { data: {
      totals: [{ currency: 'USD', remaining: 1300, count: 2 }], incomplete_count: 1,
      rows: [{ work_order_id: 'wo-2', wo_number: null, title: 'Fit-out', project_id: 'p2', project_name: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, days_since_closed: 3 }],
    }, error: null };
    expect(await getUnbilledWorkOrders(8)).toEqual({
      totals: [{ currency: 'USD', remaining: 1300, count: 2 }], incompleteCount: 1,
      rows: [{ workOrderId: 'wo-2', woNumber: null, title: 'Fit-out', projectId: 'p2', projectName: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, daysSinceClosed: 3 }],
    });
    expect(h.calls.rpc).toEqual([['get_unbilled_work_orders', { p_limit: 8 }]]);
  });
  it('AC-UNB-005 a malformed dashboard document is an error', async () => {
    h.state.rpc = { data: { totals: 'x', incomplete_count: 0, rows: [] }, error: null };
    await expect(getUnbilledWorkOrders(8)).rejects.toMatchObject({ code: 'malformed-billing' });
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/workOrderBilling.test.ts` → cannot resolve `./workOrderBilling`.

Create `pmo-portal/src/lib/db/workOrderBilling.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { WorkOrderStatus } from '@/src/lib/db/workOrders';

/**
 * Work-order billing reads (OD-BILL-1, migration 0262). Both sources are SECURITY INVOKER — the caller's RLS is the
 * tenancy boundary; org_id is never sent. Every figure is validated: a missing or non-numeric one is an ERROR, never a
 * plausible 0 (#508, NFR-BWO-005).
 */
export interface WorkOrderBillingRow {
  workOrderId: string;
  projectId: string;
  status: WorkOrderStatus;
  currency: string;
  /** All figures excl. tax in `currency`. */
  orderNet: number;
  invoiced: number;
  pending: number;
  paid: number;
  remaining: number;
  figuresComplete: boolean;
  lineCount: number;
  unpaidCount: number;
}

export interface UnbilledWorkOrderTotal { currency: string; remaining: number; count: number }
export interface UnbilledWorkOrderRow {
  workOrderId: string;
  woNumber: string | null;
  title: string;
  projectId: string;
  projectName: string;
  status: 'Issued' | 'Closed';
  currency: string;
  remaining: number;
  daysSinceClosed: number | null;
}
export interface UnbilledWorkOrders { totals: UnbilledWorkOrderTotal[]; incompleteCount: number; rows: UnbilledWorkOrderRow[] }

export const WORK_ORDER_BILLING_ROW_LIMIT = 500;
const MALFORMED = 'malformed-billing';
const STATUSES: readonly string[] = ['Draft', 'Issued', 'Closed', 'Cancelled'];
const COLS = 'work_order_id, project_id, status, currency, order_net, invoiced, pending, paid, remaining, figures_complete, line_count, unpaid_count';

function num(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new AppError(`Work order billing: ${field} is missing or not a number`, MALFORMED);
  return n;
}
function text(v: unknown, field: string): string {
  if (typeof v !== 'string' || v === '') throw new AppError(`Work order billing: ${field} is missing`, MALFORMED);
  return v;
}
function flag(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new AppError(`Work order billing: ${field} is missing`, MALFORMED);
  return v;
}
function status(v: unknown): WorkOrderStatus {
  const s = text(v, 'status');
  if (!STATUSES.includes(s)) throw new AppError(`Work order billing: unknown status ${s}`, MALFORMED);
  return s as WorkOrderStatus;
}

/** One row per work order on the project (view `work_order_billing`). */
export async function listWorkOrderBilling(projectId: string): Promise<WorkOrderBillingRow[]> {
  const { data, error } = await supabase
    .from('work_order_billing')
    .select(COLS)
    .eq('project_id', projectId)
    .limit(WORK_ORDER_BILLING_ROW_LIMIT + 1);
  if (error) throw new AppError(error.message, error.code);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  if (rows.length > WORK_ORDER_BILLING_ROW_LIMIT) {
    throw new AppError(`This project has more than ${WORK_ORDER_BILLING_ROW_LIMIT} work orders; billing cannot be shown in one view.`, 'too-many-work-orders');
  }
  return rows.map((r) => ({
    workOrderId: text(r.work_order_id, 'work_order_id'),
    projectId: text(r.project_id, 'project_id'),
    status: status(r.status),
    currency: text(r.currency, 'currency'),
    orderNet: num(r.order_net, 'order_net'),
    invoiced: num(r.invoiced, 'invoiced'),
    pending: num(r.pending, 'pending'),
    paid: num(r.paid, 'paid'),
    remaining: num(r.remaining, 'remaining'),
    figuresComplete: flag(r.figures_complete, 'figures_complete'),
    lineCount: num(r.line_count, 'line_count'),
    unpaidCount: num(r.unpaid_count, 'unpaid_count'),
  }));
}

/** What is still to invoice across the org (rpc `get_unbilled_work_orders`, aggregated server-side). */
export async function getUnbilledWorkOrders(limit: number): Promise<UnbilledWorkOrders> {
  const { data, error } = await supabase.rpc('get_unbilled_work_orders', { p_limit: limit });
  if (error) throw new AppError(error.message, error.code);
  return parseUnbilledWorkOrders(data);
}

export function parseUnbilledWorkOrders(data: unknown): UnbilledWorkOrders {
  const doc = data as { totals?: unknown; incomplete_count?: unknown; rows?: unknown } | null;
  if (!doc || !Array.isArray(doc.totals) || !Array.isArray(doc.rows)) {
    throw new AppError('Work order billing: the still-to-invoice document is malformed', MALFORMED);
  }
  return {
    totals: (doc.totals as Array<Record<string, unknown>>).map((t) => ({
      currency: text(t.currency, 'currency'), remaining: num(t.remaining, 'remaining'), count: num(t.count, 'count'),
    })),
    incompleteCount: num(doc.incomplete_count, 'incomplete_count'),
    rows: (doc.rows as Array<Record<string, unknown>>).map((r) => {
      const s = text(r.status, 'status');
      if (s !== 'Issued' && s !== 'Closed') throw new AppError(`Work order billing: unexpected status ${s}`, MALFORMED);
      return {
        workOrderId: text(r.work_order_id, 'work_order_id'),
        woNumber: r.wo_number == null ? null : text(r.wo_number, 'wo_number'),
        title: text(r.title, 'title'),
        projectId: text(r.project_id, 'project_id'),
        projectName: text(r.project_name, 'project_name'),
        status: s,
        currency: text(r.currency, 'currency'),
        remaining: num(r.remaining, 'remaining'),
        daysSinceClosed: r.days_since_closed == null ? null : num(r.days_since_closed, 'days_since_closed'),
      };
    }),
  };
}
```

Verify green (C1 + C2): `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/workOrderBilling.test.ts src/lib/db/workOrderBilling.test.ts && npm run typecheck` → pass, 0 errors.

#### C3 — repository + hooks (AC-BWO-004, AC-UNB-005)

Create `pmo-portal/src/hooks/useWorkOrderBilling.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  billing: vi.fn(async () => []),
  unbilled: vi.fn(async () => ({ totals: [], incompleteCount: 0, rows: [] })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { billing: h.billing, unbilled: h.unbilled } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { useUnbilledWorkOrders, useWorkOrderBilling } from './useWorkOrderBilling';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { h.billing.mockClear(); h.unbilled.mockClear(); });

describe('work-order billing hooks (OD-BILL-1)', () => {
  it("AC-BWO-004 reads the project's billing", async () => {
    const { result } = renderHook(() => useWorkOrderBilling('p1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.billing).toHaveBeenCalledWith('p1');
  });
  it('AC-BWO-004 does not read when the caller may not see billing', async () => {
    renderHook(() => useWorkOrderBilling('p1', false), { wrapper: wrapper() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.billing).not.toHaveBeenCalled();
  });
  it('AC-UNB-005 asks for the 8 work orders with the most left', async () => {
    const { result } = renderHook(() => useUnbilledWorkOrders(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.unbilled).toHaveBeenCalledWith(8);
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/hooks/useWorkOrderBilling.test.tsx` → cannot resolve `./useWorkOrderBilling`.

Create `pmo-portal/src/hooks/useWorkOrderBilling.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** OD-BILL-1: work-order billing reads over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const UNBILLED_WORK_ORDERS_LIMIT = 8;

/** Per-work-order billing for one project. `enabled` = the caller may see billing (salesInvoice.view). */
export function useWorkOrderBilling(projectId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-billing', orgId, projectId],
    queryFn: () => repositories.workOrder.billing(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}

/** What is still to invoice across the organisation's issued and closed work orders (dashboards). */
export function useUnbilledWorkOrders(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['unbilled-work-orders', orgId],
    queryFn: () => repositories.workOrder.unbilled(UNBILLED_WORK_ORDERS_LIMIT),
    enabled: enabled && Boolean(orgId),
  });
}
```

In `pmo-portal/src/lib/repositories/types.ts`, replace exactly:

```ts
  /** The derived drawdown, or null when the project is invisible/absent (never a fabricated zero). */
  drawdown(projectId: string): Promise<ProjectDrawdown | null>;
}
```

with:

```ts
  /** The derived drawdown, or null when the project is invisible/absent (never a fabricated zero). */
  drawdown(projectId: string): Promise<ProjectDrawdown | null>;
  /** OD-BILL-1: per-work-order billing for one project (view work_order_billing, RLS-scoped). */
  billing(projectId: string): Promise<WorkOrderBillingRow[]>;
  /** OD-BILL-1 / #786: what is still to invoice across the org's issued and closed work orders. */
  unbilled(limit: number): Promise<UnbilledWorkOrders>;
}
```

and add, directly below the `} from '@/src/lib/db/workOrders';` import block at the top of the same file:

```ts
import type { WorkOrderBillingRow, UnbilledWorkOrders } from '@/src/lib/db/workOrderBilling';
```

In `pmo-portal/src/lib/repositories/index.ts`, add directly below the `} from '@/src/lib/db/workOrders';` import block:

```ts
import { listWorkOrderBilling, getUnbilledWorkOrders } from '@/src/lib/db/workOrderBilling';
```

and replace exactly:

```ts
  drawdown: (projectId) => wrap(() => getProjectDrawdown(projectId)),
};
```

with:

```ts
  drawdown: (projectId) => wrap(() => getProjectDrawdown(projectId)),
  billing: (projectId) => wrap(() => listWorkOrderBilling(projectId)),
  unbilled: (limit) => wrap(() => getUnbilledWorkOrders(limit)),
};
```

Verify green: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/hooks/useWorkOrderBilling.test.tsx src/lib/repositories && npm run typecheck` → pass, 0 errors.

#### C4 — a work-order status move refreshes its billing (AC-BWO-004)

Create `pmo-portal/src/hooks/useWorkOrders.billingInvalidation.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ transition: vi.fn(async () => undefined) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { transition: h.transition } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));

import { useWorkOrderMutations } from './useWorkOrders';

describe('useWorkOrderMutations (OD-BILL-1)', () => {
  it('AC-BWO-004 closing or cancelling a work order refreshes its billing (Invoice is offered only on Issued/Closed)', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useWorkOrderMutations('p1'), { wrapper });
    await act(async () => { await result.current.transition.mutateAsync({ id: 'wo-1', to: 'Closed' }); });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-order-billing', 'org-1', 'p1'] });
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/hooks/useWorkOrders.billingInvalidation.test.tsx` → fails.

In `pmo-portal/src/hooks/useWorkOrders.ts`, replace exactly:

```ts
    void qc.invalidateQueries({ queryKey: ['project-drawdown', orgId, projectId] });
  };
```

with:

```ts
    void qc.invalidateQueries({ queryKey: ['project-drawdown', orgId, projectId] });
    // OD-BILL-1: a status move changes whether a work order can be invoiced.
    void qc.invalidateQueries({ queryKey: ['work-order-billing', orgId, projectId] });
  };
```

Verify green: same command → pass.

#### C5 — strings (AC-BWO-006)

Create `pmo-portal/src/lib/workOrderBilling.i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';

type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ''): Record<string, string> => Object.fromEntries(
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string'
    ? [[`${prefix}${key}`, value]]
    : Object.entries(leaves(value, `${prefix}${key}.`)))),
);
const subtree = (catalogue: unknown, path: string[]): Record<string, string> =>
  leaves(path.reduce((node, key) => (node as Tree)[key] as Tree, catalogue as Tree) as Tree);
const AREAS: Array<{ path: string[]; prefix: string; files: string[]; minUses: number }> = [
  { path: ['projectDetail', 'workOrders', 'billing'], prefix: 'projectDetail.workOrders.billing.', minUses: 20,
    files: ['pages/project-detail/tabs/WorkOrdersTab.tsx', 'pages/project-detail/InvoiceWorkOrderModal.tsx'] },
  { path: ['dashboard', 'stillToInvoice'], prefix: 'dashboard.stillToInvoice.', minUses: 5,
    files: ['src/components/dashboard/StillToInvoiceCard.tsx'] },
];

describe('work-order billing strings (OD-BILL-1)', () => {
  it('AC-BWO-006 every key exists, non-empty, in English and Indonesian', () => {
    for (const area of AREAS) {
      const english = subtree(en, area.path);
      const indonesian = subtree(id, area.path);
      expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
        expect(value.trim(), key).not.toBe('');
      }
    }
  });
  it('AC-BWO-006 every key the new screens use is in the catalogue', () => {
    for (const area of AREAS) {
      const english = subtree(en, area.path);
      const escaped = area.prefix.replace(/\./g, '\\.');
      const used = area.files.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8')
        .matchAll(new RegExp(`'${escaped}([A-Za-z.]+)'`, 'g'))].map((m) => m[1]));
      expect(used.length).toBeGreaterThan(area.minUses);
      expect(used.filter((key) => !(key in english))).toEqual([]);
    }
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/workOrderBilling.i18n.test.ts` → fails (subtrees absent).

In `pmo-portal/public/locales/en/common.json`, inside `"projectDetail" → "workOrders"`, insert directly after the
`"action": { … },` block (the one ending `"setValue": "Set value"` / `},`):

```json
      "billing": {
        "column": "Billing",
        "exclTax": "excl. PPN",
        "incompleteNote": "An invoice on one of these work orders has no amount or is in another currency, so the totals cannot be added up.",
        "invoiceAction": "Invoice",
        "invoiced": "Invoiced",
        "lineInvoiced": "Invoiced {{invoiced}} · paid {{paid}}",
        "lineOver": "Over by {{amount}}",
        "lineRemaining": "Still to invoice {{amount}}",
        "loadError": "Couldn't load billing for these work orders",
        "modal": {
          "amount": "Amount (excl. PPN)",
          "amountHelp": "Up to {{remaining}} is still to invoice on this work order.",
          "description": "Description",
          "errorHeadline": "That would invoice past the work order",
          "errors": {
            "amountInvalid": "Enter an amount with no more than 2 decimal places.",
            "amountOver": "Only {{remaining}} is still to invoice on this work order.",
            "amountPositive": "The amount must be more than zero.",
            "itemRequired": "Choose the ERP item."
          },
          "item": "ERP item",
          "itemCode": "Item code",
          "submit": "Create draft invoice",
          "subtitle": "Creates a draft invoice in ERPNext for the project's client. A different Finance or Admin user submits it.",
          "title": "Invoice this work order"
        },
        "paid": "Paid",
        "status": {
          "fullyInvoiced": "Fully invoiced",
          "incomplete": "Can't total",
          "notInvoiced": "Not invoiced",
          "overInvoiced": "Over-invoiced",
          "paid": "Paid",
          "partlyInvoiced": "Partly invoiced"
        },
        "stillToInvoice": "Still to invoice",
        "summaryNote": "Issued and closed work orders, less what has been invoiced or drafted against them.",
        "summaryTitle": "Billing against work orders",
        "toast": {
          "created": "Draft invoice created",
          "createdSub": "{{number}} — submit it from Sales Invoices."
        },
        "unavailable": "Unavailable"
      },
```

and inside `"dashboard"`, insert directly after the `"sr": { … },` block:

```json
    "stillToInvoice": {
      "count": "Work orders: {{n}}",
      "daysSinceClosed": "Days since closed: {{days}}",
      "empty": "Nothing left to invoice on issued work orders",
      "error": "Couldn't load what is still to invoice",
      "exclTax": "excl. PPN",
      "incomplete": "Work orders not totalled (an invoice on them has no amount or is in another currency): {{n}}",
      "title": "Still to invoice on work orders"
    },
```

In `pmo-portal/public/locales/id/common.json`, at the same two anchors:

```json
      "billing": {
        "column": "Penagihan",
        "exclTax": "belum termasuk PPN",
        "incompleteNote": "Salah satu faktur pada Work Order ini tidak memiliki jumlah atau memakai mata uang lain, sehingga totalnya tidak dapat dijumlahkan.",
        "invoiceAction": "Tagih",
        "invoiced": "Sudah ditagih",
        "lineInvoiced": "Ditagih {{invoiced}} · dibayar {{paid}}",
        "lineOver": "Lebih {{amount}}",
        "lineRemaining": "Belum ditagih {{amount}}",
        "loadError": "Gagal memuat penagihan Work Order ini",
        "modal": {
          "amount": "Jumlah (belum termasuk PPN)",
          "amountHelp": "Paling banyak {{remaining}} yang belum ditagih pada Work Order ini.",
          "description": "Deskripsi",
          "errorHeadline": "Tagihan ini akan melewati nilai Work Order",
          "errors": {
            "amountInvalid": "Masukkan jumlah dengan paling banyak 2 angka desimal.",
            "amountOver": "Hanya {{remaining}} yang belum ditagih pada Work Order ini.",
            "amountPositive": "Jumlah harus lebih dari nol.",
            "itemRequired": "Pilih item ERP."
          },
          "item": "Item ERP",
          "itemCode": "Kode item",
          "submit": "Buat draf faktur",
          "subtitle": "Membuat draf faktur di ERPNext untuk klien proyek. Pengguna Keuangan atau Admin lain yang mengirimkannya.",
          "title": "Tagih Work Order ini"
        },
        "paid": "Dibayar",
        "status": {
          "fullyInvoiced": "Sudah ditagih penuh",
          "incomplete": "Tidak dapat dijumlahkan",
          "notInvoiced": "Belum ditagih",
          "overInvoiced": "Tagihan berlebih",
          "paid": "Lunas",
          "partlyInvoiced": "Ditagih sebagian"
        },
        "stillToInvoice": "Belum ditagih",
        "summaryNote": "Work Order yang diterbitkan dan ditutup, dikurangi yang sudah ditagih atau masih draf.",
        "summaryTitle": "Penagihan per Work Order",
        "toast": {
          "created": "Draf faktur dibuat",
          "createdSub": "{{number}} — kirimkan dari Faktur Penjualan."
        },
        "unavailable": "Tidak tersedia"
      },
```

```json
    "stillToInvoice": {
      "count": "Work Order: {{n}}",
      "daysSinceClosed": "Hari sejak ditutup: {{days}}",
      "empty": "Tidak ada lagi yang perlu ditagih pada Work Order yang diterbitkan",
      "error": "Gagal memuat yang belum ditagih",
      "exclTax": "belum termasuk PPN",
      "incomplete": "Work Order yang tidak dijumlahkan (fakturnya tanpa jumlah atau bermata uang lain): {{n}}",
      "title": "Belum ditagih per Work Order"
    },
```

Verify: `cd "$WT/pmo-portal" && node -e "JSON.parse(require('fs').readFileSync('public/locales/en/common.json'));JSON.parse(require('fs').readFileSync('public/locales/id/common.json'))"`
exits 0. The C5 test's first `it` goes green now; its second goes green after D2, D4 and D6 (they add the screens).

---

### Part D — UI

#### D1 — keep the existing WorkOrdersTab suite isolated from the new hook

In `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.test.tsx`, insert directly after the
`vi.mock('@/src/hooks/useWorkOrders', () => ({ … }));` block:

```ts
// OD-BILL-1: the tab now reads work-order billing through react-query. These specs predate it and mount without a
// QueryClientProvider, so the hook is held in its loading state and contributes no figures; billing is covered in
// WorkOrdersTab.billing.test.tsx.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useWorkOrderBilling: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
```

Verify (after D4): `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/WorkOrdersTab.test.tsx`
→ every existing test passes. The tab gains one "Billing" column for the revenue read set (a deliberate UI change):
if an existing assertion counts column headers or cells for a role in that set, update ONLY that count by one and say
so in the PR — never loosen any other assertion.

#### D2 — the "Invoice this work order" dialog (AC-BWO-004)

Create `pmo-portal/pages/project-detail/__tests__/InvoiceWorkOrderModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AppError } from '@/src/lib/appError';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

const h = vi.hoisted(() => ({ mutateAsync: vi.fn(), connected: false }));
vi.mock('@/src/hooks/useRevenue', () => ({ useRevenueMutations: () => ({ create: { mutateAsync: h.mutateAsync, isPending: false } }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({
  useErpItemOptions: () => ({ connected: h.connected, loadOptions: async () => [{ value: 'SVC', label: 'SVC — Services' }] }),
}));
vi.mock('@/src/hooks/useCommandIntent', () => ({ useCommandIntent: () => ({ id: 'intent-1', idempotencyKey: 'key-1' }) }));

import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';

const WO = { id: 'wo-1', project_id: 'p1', wo_number: 'WO-1', title: 'Phase 1 fabrication', status: 'Issued', currency: 'USD' } as WorkOrderRow;
const onCreated = vi.fn();
const onError = vi.fn();
const renderModal = (remaining = 80_000) => render(
  <InvoiceWorkOrderModal workOrder={WO} projectId="p1" clientId="c-1" remaining={remaining}
    onClose={vi.fn()} onCreated={onCreated} onError={onError} />,
);
const amountInput = () => screen.getByLabelText(/Amount \(excl\. PPN\)/);
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create draft invoice' }));

beforeEach(() => {
  h.mutateAsync.mockReset();
  h.mutateAsync.mockResolvedValue({ id: 'si-1', si_number: 'ACC-SINV-1' });
  h.connected = false;
  onCreated.mockReset();
  onError.mockReset();
});

describe('InvoiceWorkOrderModal (OD-BILL-1)', () => {
  it("AC-BWO-004 pre-fills what is still to invoice and the work order's label", () => {
    renderModal();
    expect(amountInput()).toHaveValue('80,000');
    expect(screen.getByLabelText('Description')).toHaveValue('WO-1 — Phase 1 fabrication');
    expect(screen.getByText('Up to $80,000.00 is still to invoice on this work order.')).toBeInTheDocument();
  });

  it("AC-BWO-004 sends one line linked to the work order, for the project's client", async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await submit();
    expect(h.mutateAsync).toHaveBeenCalledWith({
      customerId: 'c-1', projectId: 'p1', workOrderId: 'wo-1',
      items: [{ item_code: 'SVC', qty: 1, rate: 80000, description: 'WO-1 — Phase 1 fabrication' }],
      intent: { id: 'intent-1', idempotencyKey: 'key-1' },
    });
    expect(onCreated).toHaveBeenCalledWith('ACC-SINV-1');
  });

  it.each([
    ['80000.01', 'Only $80,000.00 is still to invoice on this work order.'],
    ['0', 'The amount must be more than zero.'],
    ['10.001', 'Enter an amount with no more than 2 decimal places.'],
  ])('AC-BWO-004 refuses %s', async (typed, message) => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await userEvent.clear(amountInput());
    await userEvent.type(amountInput(), typed);
    await submit();
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-BWO-004 requires the ERP item', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Create draft invoice' })).toBeDisabled();
  });

  it('AC-BWO-004 a server refusal stays in the dialog', async () => {
    h.mutateAsync.mockRejectedValue(new AppError('this invoice would bill 80000.00 against work order WO-1 (worth 500000.00 excl. tax, with 500000.00 already invoiced or in draft): only 0.00 is still to invoice', 'BW001'));
    renderModal();
    await userEvent.type(screen.getByLabelText(/Item code/), 'SVC');
    await submit();
    expect(await screen.findByText('That would invoice past the work order')).toBeInTheDocument();
    expect(screen.getByText(/only 0\.00 is still to invoice/)).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('the item is chosen from the ERP catalogue when ERPNext is connected', () => {
    h.connected = true;
    renderModal();
    expect(screen.getByText('ERP item')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Item code/)).toBeNull();
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/InvoiceWorkOrderModal.test.tsx` → cannot resolve `../InvoiceWorkOrderModal`.

Create `pmo-portal/pages/project-detail/InvoiceWorkOrderModal.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, FormGrid, NumberField, TextField, type SubmitError } from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useRevenueMutations } from '@/src/hooks/useRevenue';
import { useCommandIntent } from '@/src/hooks/useCommandIntent';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { currencySymbol, formatCurrencyCents, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import { invoiceAmountProblem } from '@/src/lib/workOrderBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * "Invoice this work order" (OD-BILL-1, FR-BWO-008). One ERPNext Draft for the project's client, one line, linked to
 * the work order; the ERP PO reference falls back to the work order's client PO (no reference is sent).
 * ⚑ The amount check here is a courtesy. The database refuses past-the-value invoices before any ERP write (0262),
 *   counting commands still in flight that this dialog cannot see — its refusal is shown verbatim.
 * ⚑ ONE command identity per dialog session (ADR-0058): a retry after a lost response reuses it.
 */
export interface InvoiceWorkOrderModalProps {
  workOrder: WorkOrderRow;
  projectId: string;
  /** The project's client — the invoice customer. The tab renders this dialog only when there is one. */
  clientId: string;
  /** Still to invoice on this work order, excl. tax, from work_order_billing. */
  remaining: number;
  onClose: () => void;
  onCreated: (siNumber: string) => void;
  onError: (err: unknown) => void;
}

interface Values {
  itemCode: string;
  description: string;
  amount: string;
}

/** The invoice line's description: the work order's own label, within ERPNext's 140 characters. */
export function workOrderInvoiceDescription(wo: Pick<WorkOrderRow, 'wo_number' | 'title'>): string {
  return `${wo.wo_number ?? 'Work order'} — ${wo.title}`.slice(0, 140);
}

const InvoiceWorkOrderModal: React.FC<InvoiceWorkOrderModalProps> = ({
  workOrder, projectId, clientId, remaining, onClose, onCreated, onError,
}) => {
  const { t } = useTranslation();
  const erpItems = useErpItemOptions('sales');
  const { create } = useRevenueMutations();
  const intent = useCommandIntent();
  const remainingText = formatCurrencyCents(remaining, workOrder.currency);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const form = useEntityForm<Values>({
    initialValues: {
      itemCode: '',
      description: workOrderInvoiceDescription(workOrder),
      amount: formatMoneyInputValue(remaining),
    },
    validate: (v) => {
      const errors: Partial<Record<keyof Values, string>> = {};
      if (!v.itemCode.trim()) {
        errors.itemCode = t('projectDetail.workOrders.billing.modal.errors.itemRequired', 'Choose the ERP item.');
      }
      const problem = invoiceAmountProblem(parseMoneyInputAtScale(v.amount, 2), remaining);
      if (problem === 'invalid') {
        errors.amount = t('projectDetail.workOrders.billing.modal.errors.amountInvalid', 'Enter an amount with no more than 2 decimal places.');
      } else if (problem === 'not-positive') {
        errors.amount = t('projectDetail.workOrders.billing.modal.errors.amountPositive', 'The amount must be more than zero.');
      } else if (problem === 'over-remaining') {
        errors.amount = t('projectDetail.workOrders.billing.modal.errors.amountOver', {
          defaultValue: 'Only {{remaining}} is still to invoice on this work order.',
          remaining: remainingText,
          interpolation: { escapeValue: false },
        });
      }
      return errors;
    },
    idPrefix: 'invoice-work-order',
    module: 'work-orders',
    requiredFields: ['itemCode', 'amount'],
  });

  const itemField = form.fieldProps('itemCode');
  const descriptionField = form.fieldProps('description');
  const amountField = form.fieldProps('amount');

  const errorSummary = (() => {
    const items: { fieldId: string; message: string }[] = [];
    if (form.errors.itemCode) items.push({ fieldId: itemField.id, message: form.errors.itemCode });
    if (form.errors.amount) items.push({ fieldId: amountField.id, message: form.errors.amount });
    return items.length > 0 ? items : undefined;
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      const rate = parseMoneyInputAtScale(v.amount, 2);
      if (rate === null) return; // unreachable after validate
      try {
        const description = v.description.trim();
        const res = await create.mutateAsync({
          customerId: clientId,
          projectId,
          workOrderId: workOrder.id,
          items: [{ item_code: v.itemCode.trim(), qty: 1, rate, ...(description ? { description } : {}) }],
          intent,
        });
        onCreated(res.si_number);
      } catch (err) {
        // `suppressCapture`: the tab's onError owns the single save_failed event (ADR-0067).
        const { headline, detail } = classifyMutationError(
          err,
          { BW001: t('projectDetail.workOrders.billing.modal.errorHeadline', 'That would invoice past the work order') },
          { suppressCapture: true },
        );
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('projectDetail.workOrders.billing.modal.title', 'Invoice this work order')}
      subtitle={t(
        'projectDetail.workOrders.billing.modal.subtitle',
        "Creates a draft invoice in ERPNext for the project's client. A different Finance or Admin user submits it.",
      )}
      submitLabel={t('projectDetail.workOrders.billing.modal.submit', 'Create draft invoice')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormGrid>
        {erpItems.connected ? (
          <Combobox
            label={t('projectDetail.workOrders.billing.modal.item', 'ERP item')}
            value={itemField.value || null}
            selectedOption={itemField.value ? { value: itemField.value, label: itemField.value } : null}
            onChange={(code) => itemField.onChange(code ?? '')}
            loadOptions={erpItems.loadOptions}
            required
            error={itemField.error}
            noun={t('projectDetail.workOrders.billing.modal.item', 'ERP item')}
          />
        ) : (
          <TextField
            id={itemField.id}
            label={t('projectDetail.workOrders.billing.modal.itemCode', 'Item code')}
            value={itemField.value}
            onChange={itemField.onChange}
            error={itemField.error}
            required
          />
        )}
        <TextField
          id={descriptionField.id}
          label={t('projectDetail.workOrders.billing.modal.description', 'Description')}
          value={descriptionField.value}
          onChange={descriptionField.onChange}
        />
        <NumberField
          id={amountField.id}
          label={t('projectDetail.workOrders.billing.modal.amount', 'Amount (excl. PPN)')}
          required
          prefix={currencySymbol(workOrder.currency)}
          value={amountField.value}
          onChange={amountField.onChange}
          onBlur={amountField.onBlur}
          error={amountField.error}
          localeAware
          data-testid="invoice-wo-amount"
        />
      </FormGrid>
      <p className="mt-2 text-[12px] text-muted-foreground" data-testid="invoice-wo-remaining">
        {t('projectDetail.workOrders.billing.modal.amountHelp', {
          defaultValue: 'Up to {{remaining}} is still to invoice on this work order.',
          remaining: remainingText,
          interpolation: { escapeValue: false },
        })}
      </p>
    </EntityFormModal>
  );
};

export default InvoiceWorkOrderModal;
```

Verify green: same command → all pass; `cd "$WT/pmo-portal" && npm run typecheck && npx eslint --max-warnings=0 pages/project-detail/InvoiceWorkOrderModal.tsx`.
If `Combobox`'s `onChange` signature or `TextField`'s `id`/`error` props differ from the ones used in
`pages/SalesInvoices.tsx` / `WorkOrderValueModal.tsx`, align to those two files' usage (they are the reference) —
never weaken the test.

#### D3 — failing RTL: billing on the Work orders tab (AC-BWO-004, AC-UNB-002)

Create `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

const h = vi.hoisted(() => ({
  list: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  billing: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() },
  route: 'external' as 'external' | 'pmo',
  role: 'Finance' as string,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => h.list,
  useProjectDrawdown: () => ({ data: { committed: 0, draft: 0, ceiling: 1_000_000, currency: 'USD', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    setValue: { mutateAsync: vi.fn(), isPending: false }, transition: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.billing }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/adapterSeam/ownershipCache')>()),
  routeDomainWrite: () => h.route,
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: h.role }) }));
vi.mock('../InvoiceWorkOrderModal', () => ({
  default: ({ workOrder, remaining, clientId }: { workOrder: { id: string }; remaining: number; clientId: string }) => (
    <div data-testid="invoice-modal">{`${workOrder.id}|${remaining}|${clientId}`}</div>
  ),
}));

import WorkOrdersTab from '../tabs/WorkOrdersTab';

const wo = (over: Partial<WorkOrderRow> = {}): WorkOrderRow => ({
  id: 'wo-1', org_id: 'org-1', project_id: 'p1', wo_number: 'WO-1', client_po_number: 'PO-77', title: 'Phase 1 fabrication',
  description: null, status: 'Issued', order_value: 500_000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0,
  tax_rate: null, tax_template: null, tax_base_numerator: 1, tax_base_denominator: 1, order_date: '2026-08-01',
  start_date: null, end_date: null, order_value_set_by: 'u-2', order_value_set_at: '2026-08-01T00:00:00Z',
  issued_by: 'u-3', issued_at: '2026-08-02T00:00:00Z', over_commit_ack_by: null, over_commit_ack_at: null,
  closed_at: null, cancelled_at: null, created_at: '2026-08-01T00:00:00Z', ...over,
}) as WorkOrderRow;
const bill = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 500_000, invoiced: 330_000,
  pending: 90_000, paid: 100_000, remaining: 80_000, figuresComplete: true, lineCount: 6, unpaidCount: 3, ...over,
});
const renderTab = (role: Role = 'Finance', clientId: string | null = 'c-1') => {
  h.role = role;
  return render(<ToastProvider><WorkOrdersTab projectId="p1" currency="USD" clientId={clientId} /></ToastProvider>);
};

beforeEach(() => {
  h.list.data = [wo()];
  h.billing = { data: [bill()], isPending: false, isError: false, refetch: vi.fn() };
  h.route = 'external';
});

describe('WorkOrdersTab — billing by work order (OD-BILL-1)', () => {
  it("AC-BWO-004 Finance sees the work order's billing status with invoiced, paid and still to invoice, excl. PPN", () => {
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Partly invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Invoiced $330,000.00 · paid $100,000.00 excl. PPN');
    expect(cell).toHaveTextContent('Still to invoice $80,000.00 excl. PPN');
  });

  it.each([
    ['Paid', bill({ invoiced: 500_000, pending: 0, paid: 500_000, remaining: 0, unpaidCount: 0 }), 'Paid'],
    ['Fully invoiced', bill({ invoiced: 500_000, pending: 0, remaining: 0, unpaidCount: 2 }), 'Fully invoiced'],
    ['Not invoiced', bill({ invoiced: 0, pending: 0, paid: 0, remaining: 500_000, lineCount: 0, unpaidCount: 0 }), 'Not invoiced'],
    ["Can't total", bill({ figuresComplete: false }), "Can't total"],
  ])('AC-BWO-004 shows %s', (_label, row, pill) => {
    h.billing.data = [row];
    renderTab();
    expect(within(screen.getByTestId('wo-billing-wo-1')).getByText(pill)).toBeInTheDocument();
  });

  it('AC-BWO-004 an over-invoiced work order states the excess', () => {
    h.billing.data = [bill({ remaining: -1_000 })];
    renderTab();
    const cell = screen.getByTestId('wo-billing-wo-1');
    expect(within(cell).getByText('Over-invoiced')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Over by $1,000.00 excl. PPN');
  });

  it('AC-BWO-004 Finance gets Invoice on an Issued work order with something left; it opens the dialog with what is left', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Invoice' }));
    expect(screen.getByTestId('invoice-modal')).toHaveTextContent('wo-1|80000|c-1');
  });

  it('AC-BWO-004 a Closed work order with something left can still be invoiced (DD-BWO-7)', () => {
    h.list.data = [wo({ status: 'Closed' })];
    h.billing.data = [bill({ status: 'Closed' })];
    renderTab();
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeInTheDocument();
  });

  it.each([
    ['a Project Manager', () => {}, 'Project Manager' as Role, 'c-1'],
    ['no project client', () => {}, 'Finance' as Role, null],
    ['revenue not on ERPNext', () => { h.route = 'pmo'; }, 'Finance' as Role, 'c-1'],
    ['nothing left', () => { h.billing.data = [bill({ remaining: 0, pending: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['a Draft work order', () => { h.list.data = [wo({ status: 'Draft' })]; h.billing.data = [bill({ status: 'Draft', invoiced: 0, pending: 0, remaining: 500_000, lineCount: 0 })]; }, 'Finance' as Role, 'c-1'],
    ['figures that cannot be totalled', () => { h.billing.data = [bill({ figuresComplete: false })]; }, 'Finance' as Role, 'c-1'],
  ])('AC-BWO-004 no Invoice for %s', (_label, arrange, role, clientId) => {
    arrange();
    renderTab(role, clientId);
    expect(screen.queryByRole('button', { name: 'Invoice' })).toBeNull();
  });

  it('AC-UNB-002 the project totals add Issued and Closed work orders; an over-invoiced one adds nothing left', () => {
    h.list.data = [wo(), wo({ id: 'wo-2', status: 'Closed', wo_number: 'WO-2' }), wo({ id: 'wo-3', status: 'Draft', wo_number: null })];
    h.billing.data = [
      bill(),
      bill({ workOrderId: 'wo-2', status: 'Closed', invoiced: 105_000, pending: 0, paid: 0, remaining: -5_000 }),
      bill({ workOrderId: 'wo-3', status: 'Draft', invoiced: 0, pending: 0, paid: 0, remaining: 900_000, lineCount: 0, unpaidCount: 0 }),
    ];
    renderTab();
    expect(screen.getByTestId('wo-billing-total-invoiced')).toHaveTextContent('$435,000.00excl. PPN');
    expect(screen.getByTestId('wo-billing-total-paid')).toHaveTextContent('$100,000.00excl. PPN');
    expect(screen.getByTestId('wo-billing-total-still')).toHaveTextContent('$80,000.00excl. PPN');
  });

  it('AC-UNB-002 one untotallable work order makes the project totals Unavailable, never a sum', () => {
    h.billing.data = [bill({ figuresComplete: false })];
    renderTab();
    expect(screen.getByTestId('wo-billing-total-still')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('wo-billing-total-still')).not.toHaveTextContent('$');
  });

  it('AC-BWO-004 an Engineer sees no billing', () => {
    renderTab('Engineer');
    expect(screen.queryByTestId('wo-billing-summary')).toBeNull();
    expect(screen.queryByTestId('wo-billing-wo-1')).toBeNull();
  });

  it('NFR-BWO-005 a failed billing read shows an error, never a zero', () => {
    h.billing = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("Couldn't load billing for these work orders")).toBeInTheDocument();
    expect(screen.queryByTestId('wo-billing-total-still')).toBeNull();
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` → fails (no billing UI, no `clientId` prop).

#### D4 — billing on the Work orders tab (AC-BWO-004, AC-UNB-002, green)

Edit `pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx`:

1. In the `@/src/components/ui` import list, add `ListState,` after `DataTable,`.
2. Replace exactly `import { formatCurrency, formatDateOnly, currencySymbol } from '@/src/lib/format';` with
   `import { formatCurrency, formatCurrencyCents, formatDateOnly, currencySymbol } from '@/src/lib/format';`.
3. Replace exactly `import WorkOrderValueModal from '../WorkOrderValueModal';` with:

```tsx
import WorkOrderValueModal from '../WorkOrderValueModal';
import InvoiceWorkOrderModal from '../InvoiceWorkOrderModal';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  canInvoiceWorkOrder,
  deriveWorkOrderBillingState,
  summarizeProjectWorkOrderBilling,
  type WorkOrderBillingState,
} from '@/src/lib/workOrderBilling';
```

4. Replace exactly:

```tsx
  /** The project's currency. Work orders are pinned to it by a trigger, so they never disagree. */
  currency: string;
}
```

with:

```tsx
  /** The project's currency. Work orders are pinned to it by a trigger, so they never disagree. */
  currency: string;
  /** The project's client — the invoice customer (OD-BILL-1). No client, no "Invoice" button. */
  clientId?: string | null;
}

/** OD-BILL-1: the billing pill per derived state ('not-billable' renders a dash, no pill). */
const BILLING_VARIANT: Record<Exclude<WorkOrderBillingState, 'not-billable'>, StatusVariant> = {
  'not-invoiced': 'draft',
  'partly-invoiced': 'progress',
  'fully-invoiced': 'progress',
  paid: 'won',
  'over-invoiced': 'overdue',
  incomplete: 'warn',
};
```

5. Replace exactly `const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency }) => {` with
   `const WorkOrdersTab: React.FC<WorkOrdersTabProps> = ({ projectId, currency, clientId = null }) => {`.

6. Replace exactly:

```tsx
  const rows = useMemo(() => data ?? [], [data]);
  const prefix = currencySymbol(currency);
```

with:

```tsx
  const rows = useMemo(() => data ?? [], [data]);
  const prefix = currencySymbol(currency);

  // ── OD-BILL-1: billing by work order. Read = the revenue read set; Invoice = the invoice-create authority, only
  //    where an invoice can be raised today (revenue on ERPNext) and only with a client to invoice. UX only — the
  //    database refuses past-the-value invoices before any ERP write (0262).
  const canViewBilling = may('view', 'salesInvoice');
  const canInvoice = may('create', 'salesInvoice') && routeDomainWrite('revenue') === 'external' && Boolean(clientId);
  const billing = useWorkOrderBilling(projectId, canViewBilling);
  const billingById = useMemo(
    () => new Map((billing.data ?? []).map((b) => [b.workOrderId, b] as const)),
    [billing.data],
  );
  const totals = summarizeProjectWorkOrderBilling(billing.data ?? []);
  const [invoiceFor, setInvoiceFor] = useState<{ row: WorkOrderRow; remaining: number } | null>(null);
  const excl = t('projectDetail.workOrders.billing.exclTax', 'excl. PPN');

  const billingLabel = (state: Exclude<WorkOrderBillingState, 'not-billable'>): string => {
    switch (state) {
      case 'not-invoiced':
        return t('projectDetail.workOrders.billing.status.notInvoiced', 'Not invoiced');
      case 'partly-invoiced':
        return t('projectDetail.workOrders.billing.status.partlyInvoiced', 'Partly invoiced');
      case 'fully-invoiced':
        return t('projectDetail.workOrders.billing.status.fullyInvoiced', 'Fully invoiced');
      case 'paid':
        return t('projectDetail.workOrders.billing.status.paid', 'Paid');
      case 'over-invoiced':
        return t('projectDetail.workOrders.billing.status.overInvoiced', 'Over-invoiced');
      default:
        return t('projectDetail.workOrders.billing.status.incomplete', "Can't total");
    }
  };

  const billingColumn: Column<WorkOrderRow> = {
    key: 'billing',
    header: t('projectDetail.workOrders.billing.column', 'Billing'),
    cell: (row) => {
      const f = billingById.get(row.id);
      if (billing.isPending) return <span className="text-muted-foreground">…</span>;
      if (billing.isError || !f) {
        return (
          <span data-testid={`wo-billing-${row.id}`} className="text-[12px] text-muted-foreground">
            {t('projectDetail.workOrders.billing.unavailable', 'Unavailable')}
          </span>
        );
      }
      const state = deriveWorkOrderBillingState(row.status, f);
      if (state === 'not-billable') return <span data-testid={`wo-billing-${row.id}`}>—</span>;
      return (
        <div className="flex flex-col items-start gap-0.5" data-testid={`wo-billing-${row.id}`}>
          <StatusPill variant={BILLING_VARIANT[state]}>{billingLabel(state)}</StatusPill>
          {state !== 'incomplete' && (
            <>
              <span className="text-[11px] tabular text-muted-foreground">
                {t('projectDetail.workOrders.billing.lineInvoiced', {
                  defaultValue: 'Invoiced {{invoiced}} · paid {{paid}}',
                  invoiced: formatCurrencyCents(f.invoiced, f.currency),
                  paid: formatCurrencyCents(f.paid, f.currency),
                  interpolation: { escapeValue: false },
                })}{' '}
                {excl}
              </span>
              <span className="text-[11px] font-semibold tabular">
                {state === 'over-invoiced'
                  ? t('projectDetail.workOrders.billing.lineOver', {
                      defaultValue: 'Over by {{amount}}',
                      amount: formatCurrencyCents(-f.remaining, f.currency),
                      interpolation: { escapeValue: false },
                    })
                  : t('projectDetail.workOrders.billing.lineRemaining', {
                      defaultValue: 'Still to invoice {{amount}}',
                      amount: formatCurrencyCents(Math.max(f.remaining, 0), f.currency),
                      interpolation: { escapeValue: false },
                    })}{' '}
                {excl}
              </span>
            </>
          )}
        </div>
      );
    },
  };
```

7. In the `columns` array, between the `value` column object (ending with the `wo-value-${row.id}` cell) and the
   `orderDate` column object, insert the line:

```tsx
    ...(canViewBilling ? [billingColumn] : []),
```

8. In the `actions` column cell, replace exactly:

```tsx
            {(isDraft || isIssued) && canTransition && (
```

with:

```tsx
            {canInvoice && (() => {
              const f = billingById.get(row.id);
              return f && canInvoiceWorkOrder(row.status, f) ? (
                <Button variant="primary" size="sm" onClick={() => setInvoiceFor({ row, remaining: f.remaining })}>
                  {t('projectDetail.workOrders.billing.invoiceAction', 'Invoice')}
                </Button>
              ) : null;
            })()}
            {(isDraft || isIssued) && canTransition && (
```

9. Replace exactly:

```tsx
      <ProjectDrawdown projectId={projectId} />

      <Card variant="bare">
```

with:

```tsx
      <ProjectDrawdown projectId={projectId} />

      {canViewBilling && (
        <Card variant="bare" data-testid="wo-billing-summary">
          <CardHead>{t('projectDetail.workOrders.billing.summaryTitle', 'Billing against work orders')}</CardHead>
          <CardPad>
            {billing.isPending ? (
              <ListState variant="loading" rows={1} testId="wo-billing-loading" />
            ) : billing.isError || !billing.data ? (
              <ListState
                variant="error"
                title={t('projectDetail.workOrders.billing.loadError', "Couldn't load billing for these work orders")}
                onRetry={() => billing.refetch()}
              />
            ) : (
              <>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {([
                    ['wo-billing-total-invoiced', t('projectDetail.workOrders.billing.invoiced', 'Invoiced'), totals.invoiced],
                    ['wo-billing-total-paid', t('projectDetail.workOrders.billing.paid', 'Paid'), totals.paid],
                    ['wo-billing-total-still', t('projectDetail.workOrders.billing.stillToInvoice', 'Still to invoice'), totals.stillToInvoice],
                  ] as const).map(([testId, label, value]) => (
                    <div key={testId} data-testid={testId}>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 text-[15px] font-bold tabular">
                        {totals.complete
                          ? formatCurrencyCents(value, currency)
                          : t('projectDetail.workOrders.billing.unavailable', 'Unavailable')}
                      </dd>
                      {totals.complete && <dd className="text-[11px] text-muted-foreground">{excl}</dd>}
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {totals.complete
                    ? t('projectDetail.workOrders.billing.summaryNote', 'Issued and closed work orders, less what has been invoiced or drafted against them.')
                    : t('projectDetail.workOrders.billing.incompleteNote', 'An invoice on one of these work orders has no amount or is in another currency, so the totals cannot be added up.')}
                </p>
              </>
            )}
          </CardPad>
        </Card>
      )}

      <Card variant="bare">
```

10. Replace exactly:

```tsx
      {pending && (
        <ConfirmDialog
```

with:

```tsx
      {invoiceFor && clientId && (
        <InvoiceWorkOrderModal
          workOrder={invoiceFor.row}
          projectId={projectId}
          clientId={clientId}
          remaining={invoiceFor.remaining}
          onClose={() => setInvoiceFor(null)}
          onCreated={(siNumber) => {
            toast(
              t('projectDetail.workOrders.billing.toast.created', 'Draft invoice created'),
              t('projectDetail.workOrders.billing.toast.createdSub', {
                defaultValue: '{{number}} — submit it from Sales Invoices.',
                number: siNumber,
                interpolation: { escapeValue: false },
              }),
              'success',
            );
            setInvoiceFor(null);
          }}
          onError={fail}
        />
      )}

      {pending && (
        <ConfirmDialog
```

Verify green:
`cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx pages/project-detail/__tests__/WorkOrdersTab.test.tsx && npm run typecheck && npx eslint --max-warnings=0 pages/project-detail/tabs/WorkOrdersTab.tsx`
→ all pass (the legacy suite unchanged thanks to D1).

#### D5 — pass the project's client to the tab

In `pmo-portal/pages/project-detail/ProjectDetail.tsx`, replace exactly:

```tsx
        <WorkOrdersTab projectId={project.id} currency={project.currency} />
```

with:

```tsx
        <WorkOrdersTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null} />
```

Verify: `cd "$WT/pmo-portal" && npm run typecheck && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__` → 0 errors, all pass.

#### D6 — the dashboard card (AC-UNB-005)

Create `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  state: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => h.state }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { StillToInvoiceCard } from '../StillToInvoiceCard';

const DATA = {
  totals: [{ currency: 'USD', remaining: 1300, count: 2 }],
  incompleteCount: 1,
  rows: [
    { workOrderId: 'wo-1', woNumber: 'WO-1', title: 'Survey', projectId: 'p1', projectName: 'Harbor Tower', status: 'Issued', currency: 'USD', remaining: 1000, daysSinceClosed: null },
    { workOrderId: 'wo-2', woNumber: null, title: 'Fit-out', projectId: 'p2', projectName: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, daysSinceClosed: 3 },
  ],
};
const renderCard = () => render(<MemoryRouter><StillToInvoiceCard /></MemoryRouter>);

beforeEach(() => {
  h.role = 'Finance';
  h.state = { data: DATA, isPending: false, isError: false, refetch: vi.fn() };
});

describe('StillToInvoiceCard (OD-BILL-1 / #786)', () => {
  it('AC-UNB-005 shows each currency total excl. PPN with its count', () => {
    renderCard();
    const totals = screen.getByTestId('still-to-invoice-totals');
    expect(totals).toHaveTextContent('$1,300.00');
    expect(totals).toHaveTextContent('excl. PPN');
    expect(totals).toHaveTextContent('Work orders: 2');
  });
  it("AC-UNB-005 lists the work orders with the most left, linking to their project's Work orders tab", () => {
    renderCard();
    expect(screen.getByRole('link', { name: /WO-1/ })).toHaveAttribute('href', '/projects/p1/work-orders');
    expect(screen.getByRole('link', { name: /Fit-out/ })).toHaveAttribute('href', '/projects/p2/work-orders');
    expect(screen.getByRole('link', { name: /Fit-out/ })).toHaveTextContent('Days since closed: 3');
    expect(screen.getByRole('link', { name: /WO-1/ })).not.toHaveTextContent('Days since closed');
  });
  it('AC-UNB-005 says how many could not be totalled', () => {
    renderCard();
    expect(screen.getByTestId('still-to-invoice-incomplete')).toHaveTextContent(': 1');
  });
  it('AC-UNB-005 empty, loading and error states — never a fabricated zero', async () => {
    h.state = { data: { totals: [], incompleteCount: 0, rows: [] }, isPending: false, isError: false, refetch: vi.fn() };
    const view = renderCard();
    expect(screen.getByText('Nothing left to invoice on issued work orders')).toBeInTheDocument();
    view.unmount();
    h.state = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const loading = renderCard();
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
    loading.unmount();
    h.state = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderCard();
    expect(screen.getByText("Couldn't load what is still to invoice")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.state.refetch).toHaveBeenCalled();
  });
  it('AC-UNB-005 a role outside the revenue read set sees no card', () => {
    h.role = 'Engineer';
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx` → cannot resolve `../StillToInvoiceCard`.

Create `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx`:

```tsx
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useUnbilledWorkOrders } from '@/src/hooks/useWorkOrderBilling';
import { formatCurrencyCents } from '@/src/lib/format';

/**
 * What is still to invoice on the client's POs (OD-BILL-1, #786 AC-UNB-005). Totals per currency (never converted,
 * DD-MMP-5) are computed server-side by get_unbilled_work_orders, so they are not bounded by max_rows. Work orders that
 * cannot be totalled are counted apart, never added as zero.
 */
const StillToInvoiceBody: React.FC = () => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useUnbilledWorkOrders();
  const excl = t('dashboard.stillToInvoice.exclTax', 'excl. PPN');

  return (
    <Card data-testid="dashboard-still-to-invoice">
      <CardHead>{t('dashboard.stillToInvoice.title', 'Still to invoice on work orders')}</CardHead>
      <CardPad>
        {isPending ? (
          <ListState variant="loading" rows={3} testId="still-to-invoice-loading" />
        ) : isError || !data ? (
          <ListState
            variant="error"
            title={t('dashboard.stillToInvoice.error', "Couldn't load what is still to invoice")}
            onRetry={() => refetch()}
          />
        ) : data.totals.length === 0 && data.incompleteCount === 0 ? (
          <ListState variant="empty" icon="doc" title={t('dashboard.stillToInvoice.empty', 'Nothing left to invoice on issued work orders')} />
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1" data-testid="still-to-invoice-totals">
              {data.totals.map((total) => (
                <li key={total.currency} className="text-[15px] font-bold tabular">
                  {formatCurrencyCents(total.remaining, total.currency)}{' '}
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {excl} · {t('dashboard.stillToInvoice.count', { defaultValue: 'Work orders: {{n}}', n: total.count })}
                  </span>
                </li>
              ))}
            </ul>
            {data.incompleteCount > 0 && (
              <p data-testid="still-to-invoice-incomplete" className="text-[12px] text-muted-foreground">
                {t('dashboard.stillToInvoice.incomplete', {
                  defaultValue: 'Work orders not totalled (an invoice on them has no amount or is in another currency): {{n}}',
                  n: data.incompleteCount,
                })}
              </p>
            )}
            <ul className="flex flex-col divide-y divide-border" data-testid="still-to-invoice-rows">
              {data.rows.map((row) => (
                <li key={row.workOrderId} className="flex items-baseline justify-between gap-3 py-2">
                  <Link
                    to={`/projects/${row.projectId}/work-orders`}
                    className="min-w-0 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    <span className="block truncate font-medium">{row.woNumber ?? row.title}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {row.projectName}
                      {row.daysSinceClosed !== null
                        ? ` · ${t('dashboard.stillToInvoice.daysSinceClosed', { defaultValue: 'Days since closed: {{days}}', days: row.daysSinceClosed })}`
                        : ''}
                    </span>
                  </Link>
                  <span className="shrink-0 text-[13px] font-semibold tabular">
                    {formatCurrencyCents(row.remaining, row.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardPad>
    </Card>
  );
};

/** Rendered only for the revenue read set (salesInvoice.view); the body (and its query) never mounts otherwise. */
export const StillToInvoiceCard: React.FC = () => {
  const may = usePermission();
  return may('view', 'salesInvoice') ? <StillToInvoiceBody /> : null;
};
```

Verify green: same command → pass; `cd "$WT/pmo-portal" && npm run typecheck && npx eslint --max-warnings=0 src/components/dashboard/StillToInvoiceCard.tsx`.

#### D7 — the card on the Executive and Finance dashboards (AC-UNB-005)

1. Add this top-level block directly below the import statements of each of these nine files (vi.mock is hoisted;
   the stub holds the card in its loading state so no existing text or count changes):

```ts
// OD-BILL-1: the Still-to-invoice card reads through react-query; stubbed like the other dashboard hooks.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
```

   - `pmo-portal/pages/ExecutiveDashboard.test.tsx`
   - `pmo-portal/pages/__tests__/ExecutiveDashboard.mobile.test.tsx`
   - `pmo-portal/pages/__tests__/ExecutiveDashboard.honesty.test.tsx`
   - `pmo-portal/pages/__tests__/ExecutiveDashboard.atRiskLink.test.tsx`
   - `pmo-portal/pages/__tests__/ExecutiveDashboard.approvalError.test.tsx`
   - `pmo-portal/pages/__tests__/Dashboard.drillthrough.test.tsx`
   - `pmo-portal/src/components/dashboard/FinanceDashboard.test.tsx`
   - `pmo-portal/src/components/dashboard/__tests__/FinanceDashboard.w5b.test.tsx`
   - `pmo-portal/src/components/dashboard/__tests__/FinanceDashboard.budgetError.test.tsx`

   (If a file does not already import `vi`, add `vi` to its existing `vitest` import.)

2. Append to `pmo-portal/pages/ExecutiveDashboard.test.tsx` (after its last `describe` block):

```tsx
describe('still to invoice (OD-BILL-1 / #786)', () => {
  it('AC-UNB-005 the executive dashboard carries the still-to-invoice card', () => {
    renderPage();
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();
  });
});
```

   and append to `pmo-portal/src/components/dashboard/FinanceDashboard.test.tsx`:

```tsx
describe('still to invoice (OD-BILL-1 / #786)', () => {
  it('AC-UNB-005 the finance dashboard carries the still-to-invoice card', () => {
    renderPane();
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();
  });
});
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/ExecutiveDashboard.test.tsx src/components/dashboard/FinanceDashboard.test.tsx` → the two new tests fail.

3. In `pmo-portal/pages/ExecutiveDashboard.tsx`, add `import { StillToInvoiceCard } from '@/src/components/dashboard/StillToInvoiceCard';`
   below the `AwaitingApprovalTile` import, and replace exactly:

```tsx
    const chartsSection = (
      <>
        <DashGrid>
```

with:

```tsx
    const chartsSection = (
      <>
        {/* OD-BILL-1 / #786: what is still to invoice on the client's POs (gated inside on salesInvoice.view). */}
        <StillToInvoiceCard />
        <DashGrid>
```

4. In `pmo-portal/src/components/dashboard/FinanceDashboard.tsx`, add `import { StillToInvoiceCard } from './StillToInvoiceCard';`
   with the other imports, and replace exactly:

```tsx
        <AwaitingApprovalTile includeTimesheets={false} label="PRs awaiting you" />
      </section>
```

with:

```tsx
        <AwaitingApprovalTile includeTimesheets={false} label="PRs awaiting you" />
      </section>

      {/* OD-BILL-1 / #786: what is still to invoice on the client's POs. */}
      <StillToInvoiceCard />
```

Verify green: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/ExecutiveDashboard.test.tsx pages/__tests__ src/components/dashboard src/lib/workOrderBilling.i18n.test.ts && npm run typecheck`
→ all pass (C5's second test is green now that all three screens exist).

---

### Part E — the assistant (AC-BWO-005)

#### E1 — failing tests: the draft links the work order and bills what is left

Append to `pmo-portal/src/lib/agent/draftInvoice.prepare.test.ts`:

```ts
describe('prepareDraftInvoice — billing by work order (OD-BILL-1, DD-BWO-9)', () => {
  const billed = (rows: Array<{ billed: number | null; currency: string }>) =>
    world({ work_order_billing_lines: () => rows });

  it('AC-BWO-005 a work-order draft names the work order and defaults to what is still to invoice', async () => {
    const { client, calls } = fakeSupabase(billed([{ billed: 400_000, currency: 'IDR' }]), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.workOrderId).toBe(WO.id);
    expect(out.value.items[0].rate).toBe(600_000);
    expect(opsOf(calls, 'work_order_billing_lines')[0]).toContainEqual(['eq', 'work_order_id', WO.id]);
    expect(validatePreparedDraft(out.value)).toEqual({ ok: true, value: out.value });
  });

  it('AC-BWO-005 a stated amount above what is left is refused before the chip', async () => {
    const { client } = fakeSupabase(billed([{ billed: 400_000, currency: 'IDR' }]), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001', amount: 700_000 }, ctx('Finance', client), newId)).toEqual({
      ok: false,
      error: { error: 'Only IDR 600,000.00 is still to invoice on WO-20261001-001 — Phase 2 survey. How much should this invoice be, before tax?', needs: 'amount' },
    });
  });

  it('AC-BWO-005 a work order with nothing left is refused before the chip', async () => {
    const { client } = fakeSupabase(billed([{ billed: 1_000_000, currency: 'IDR' }]), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId))
      .toEqual({ ok: false, error: { error: 'Nothing is left to invoice on WO-20261001-001 — Phase 2 survey.' } });
  });

  it('AC-BWO-005 an invoice that cannot be totalled is refused before the chip', async () => {
    const { client } = fakeSupabase(billed([{ billed: null, currency: 'IDR' }]), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId)).toEqual({
      ok: false,
      error: { error: 'An invoice on WO-20261001-001 — Phase 2 survey has no amount or is in another currency, so what is left to invoice cannot be worked out.' },
    });
  });

  it('AC-BWO-005 a replayed draft with a malformed work-order id is refused', () => {
    expect(validatePreparedDraft({ ...PREPARED, workOrderId: 'not-a-uuid' })).toEqual({ ok: false, error: 'workOrderId must be a uuid' });
  });
});
```

and change the fixture import line at the top of the same file from
`import { C1, ctx, newId, oneItem, P1, PROJECT, WO, world } from './testing/draftInvoiceFixtures';` to
`import { C1, ctx, newId, oneItem, P1, PREPARED, PROJECT, WO, world } from './testing/draftInvoiceFixtures';`.

Append to `pmo-portal/src/lib/agent/draftInvoice.run.test.ts` (inside its top-level `describe`, after the first `it`):

```ts
  it('AC-BWO-005 the approved draft dispatches the work order with the create', async () => {
    const invoke = vi.fn<Invoker>(async () => ({ data: { canonical: { id: PREPARED.commandId, si_number: 'ACC-SINV-2026-00100' } }, error: null }));
    await runDraftInvoice({ ...PREPARED, workOrderId: '33333333-3333-4333-8333-333333333333' }, ctx(invoke));
    expect((invoke.mock.calls[0][1] as { body: { record: Record<string, unknown> } }).body.record.workOrderId)
      .toBe('33333333-3333-4333-8333-333333333333');
  });
```

Verify red: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/agent/draftInvoice.prepare.test.ts src/lib/agent/draftInvoice.run.test.ts`
→ the six new tests fail; every existing one still passes.

#### E2 — the assistant links the work order and bills what is left (green)

Edit `supabase/functions/agent-chat/draftInvoice.ts`:

1. In `interface DraftInvoicePrepared`, replace exactly these two adjacent lines:

```ts
  projectId: string;
  items: [DraftInvoiceLine];
```

with:

```ts
  projectId: string;
  /** OD-BILL-1 (DD-BWO-9): the work order this draft bills; absent for a milestone draft. */
  workOrderId?: string;
  items: [DraftInvoiceLine];
```

2. In `validatePreparedDraft`, replace exactly:

```ts
  const items = Array.isArray(p.items) ? p.items : [];
```

with:

```ts
  if (p.workOrderId !== undefined && (typeof p.workOrderId !== 'string' || !UUID_RE.test(p.workOrderId))) {
    return bad('workOrderId must be a uuid');
  }
  const items = Array.isArray(p.items) ? p.items : [];
```

   and replace exactly `      projectId: p.projectId as string,` with:

```ts
      projectId: p.projectId as string,
      ...(typeof p.workOrderId === 'string' ? { workOrderId: p.workOrderId } : {}),
```

3. Insert directly above `export interface MilestoneRow`:

```ts
const BILLING_LINE_LIMIT = 500;

/**
 * DD-BWO-9 (OD-BILL-1): what is still to invoice on a work order, before tax — its value (from its own recorded tax
 * facts) minus every record that bills it, read from the SAME view the Work orders tab and the database fence use
 * (`work_order_billing_lines`, RLS-scoped under the caller's JWT). In-flight ERP commands are not visible here; the
 * database fence counts them and remains the authority.
 */
export async function workOrderStillToInvoice(sb: LooseClient, wo: WorkOrderRow): Promise<Resolved<number>> {
  const net = normalizeTaxAmount(Number(wo.order_value), Number(wo.tax_amount), wo.tax_treatment, 'exclusive');
  if (net === null) {
    return refuse(`I can't work out ${woLabel(wo)}'s value before tax. How much should this invoice be, before tax?`, 'amount');
  }
  const rows = await readRows<{ billed: number | string | null; currency: string }>(
    sb.from('work_order_billing_lines').select('billed, currency').eq('work_order_id', wo.id).limit(BILLING_LINE_LIMIT),
  );
  if (rows.length >= BILLING_LINE_LIMIT) {
    return refuse(`${woLabel(wo)} has too many invoices to total here. Create this one from the project's Work orders tab.`);
  }
  let billedCents = 0;
  for (const r of rows) {
    const value = r.billed === null ? Number.NaN : Number(r.billed);
    if (!Number.isFinite(value) || r.currency !== wo.currency) {
      return refuse(`An invoice on ${woLabel(wo)} has no amount or is in another currency, so what is left to invoice cannot be worked out.`);
    }
    billedCents += Math.round(value * 100);
  }
  return { ok: true, value: (Math.round(net * 100) - billedCents) / 100 };
}
```

4. In `prepareDraftInvoice`, replace exactly:

```ts
  // DD-AIN-4: a stated amount wins; else a work order's value BEFORE tax from its own recorded tax facts.
  let rate: number | null = req.amount ?? null;
  if (rate === null && source.kind === 'workOrder') {
    const wo = source.wo;
    rate = normalizeTaxAmount(Number(wo.order_value), Number(wo.tax_amount), wo.tax_treatment, 'exclusive');
  }
```

with:

```ts
  // DD-BWO-9 (OD-BILL-1, amends DD-AIN-4): a work-order draft bills what is STILL TO INVOICE on that work order,
  // before tax, and links it — the figure the Work orders tab shows and the database fence enforces.
  let woRemaining: number | null = null;
  if (source.kind === 'workOrder') {
    const left = await workOrderStillToInvoice(sb, source.wo);
    if (!left.ok) return left;
    if (Math.round(left.value * 100) <= 0) return refuse(`Nothing is left to invoice on ${woLabel(source.wo)}.`);
    woRemaining = left.value;
  }
  // A stated amount wins; else the work order's still-to-invoice.
  const rate: number | null = req.amount ?? woRemaining;
```

5. Replace exactly:

```ts
  if (!isMoney(rate)) return refuse('The amount to invoice must be more than zero.', 'amount');
```

with:

```ts
  if (!isMoney(rate)) return refuse('The amount to invoice must be more than zero.', 'amount');
  if (source.kind === 'workOrder' && woRemaining !== null && Math.round(rate * 100) > Math.round(woRemaining * 100)) {
    const left = formatMoney(woRemaining, source.wo.currency, resolveNumberLocale(org));
    return refuse(`Only ${left} is still to invoice on ${woLabel(source.wo)}. How much should this invoice be, before tax?`, 'amount');
  }
```

6. In the `const value: DraftInvoicePrepared = {` literal, replace exactly `    projectId: project.id,` with:

```ts
    projectId: project.id,
    ...(source.kind === 'workOrder' ? { workOrderId: source.wo.id } : {}),
```

7. In `runDraftInvoice`, replace exactly:

```ts
        ...(p.reference_number ? { reference_number: p.reference_number } : {}),
      }),
```

with:

```ts
        ...(p.reference_number ? { reference_number: p.reference_number } : {}),
        ...(p.workOrderId ? { workOrderId: p.workOrderId } : {}),
      }),
```

Verify green:
`cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/agent && npm run typecheck && npx eslint --max-warnings=0 ../supabase/functions/agent-chat/draftInvoice.ts`
→ all pass. ⚑ The live model is not re-evaluated here (ADR-0052); the server-side change does not alter the tool's
schema or description, so the eval bar is unaffected — the agent functions need an owner-approved deploy as before.

---

### Part F — the cross-stack journey (AC-BWO-003)

#### F1 — the ERP journey spec

Create `pmo-portal/e2e/serial/AC-BWO-003-invoice-work-order-erp.spec.ts`:

```ts
// @e2e-isolation: serial — flips the shared org's revenue ownership + binding (org-global state).
/**
 * AC-BWO-003-invoice-work-order-erp — OD-BILL-1 through the REAL served adapter-dispatch and the local ERPNext bench
 * (never page.route; never a client's ERP). The goal: the client's PO is invoiced up to its value and never past it.
 * Finance invoices part of a 300,000 PO; an invoice that would pass the PO is refused BEFORE ERPNext is written; the
 * rest invoices exactly. Author admin@acme.test raises; the approver submits — the invoice SoD.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test AC-BWO-003
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedSAR, cleanupSAR, signInAdmin, signInApprover, dispatchCreateRevenue, dispatchTransitionRevenue } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-BWO-003: SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_API_KEY/SECRET are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
test.skip(!READY, 'AC-BWO-003: needs the served functions lane and the ERPNext bench API key — run via scripts/serve-functions.sh against the bench');
test.setTimeout(180_000);

const benchHeaders = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };

async function erpInvoicesWithPo(po: string): Promise<Array<{ name: string; docstatus: number }>> {
  const params = new URLSearchParams({ filters: JSON.stringify([['po_no', '=', po]]), fields: JSON.stringify(['name', 'docstatus']) });
  const res = await fetch(`${BENCH_URL}/api/resource/Sales%20Invoice?${params}`, { headers: benchHeaders });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Array<{ name: string; docstatus: number }> }).data;
}

/** One user intent = one idempotency key; a 502 is retried with the SAME key (ADR-0058). */
async function createWithRetry(record: Record<string, unknown>, token: string): Promise<Response> {
  const key = crypto.randomUUID();
  let res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, token, record, 'sales-invoice', key);
  for (let attempt = 0; res.status === 502 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, token, record, 'sales-invoice', key);
  }
  return res;
}

test.describe('AC-BWO-003: a work order is invoiced up to its value and no further', () => {
  test('AC-BWO-003 Finance invoices a client PO in parts, is refused past it before ERPNext, and invoices exactly the rest', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const approverToken = await signInApprover(AUTH_URL, ANON_KEY);
    const author = createClient(AUTH_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${authorToken}` } } });
    const suffix = `bwo003-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);
    const po = `PO-${suffix}`;
    const workOrderId = crypto.randomUUID();
    const [firstId, overId, restId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const invoice = (id: string, rate: number) => ({
      id, customerId: seeded.companyId, projectId: seeded.projectId, workOrderId,
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate }],
    });
    const billing = async () => {
      const { data, error } = await author.from('work_order_billing').select('invoiced,pending,remaining').eq('work_order_id', workOrderId).single();
      expect(error).toBeNull();
      return { invoiced: Number(data!.invoiced), pending: Number(data!.pending), remaining: Number(data!.remaining) };
    };

    try {
      expect((await admin.from('projects').update({ client_id: seeded.companyId, contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false })
        .eq('id', seeded.projectId)).error).toBeNull();
      expect((await admin.from('work_orders').insert({
        id: workOrderId, org_id: ORG_ID, project_id: seeded.projectId, title: `Route survey ${suffix}`, client_po_number: po,
        status: 'Issued', wo_number: `WO-${suffix}`, issued_at: new Date().toISOString(),
        order_value: 300_000, tax_treatment: 'exclusive', tax_amount: 0,
      })).error).toBeNull();

      // 1. Finance invoices 200,000 of the 300,000 PO: one ERP draft that carries the client's PO.
      const first = await createWithRetry(invoice(firstId, 200_000), authorToken);
      const firstBody = (await first.json()) as { externalRecordId?: string };
      expect(first.status, `first invoice failed: ${JSON.stringify(firstBody)}`).toBe(200);
      expect((await erpInvoicesWithPo(po)).map((si) => [si.name, si.docstatus])).toEqual([[firstBody.externalRecordId, 0]]);
      expect(await billing()).toEqual({ invoiced: 0, pending: 200_000, remaining: 100_000 });

      // 2. 150,000 would pass the PO: refused before any ERP write — ERPNext still holds one invoice for this PO.
      const over = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, authorToken, invoice(overId, 150_000), 'sales-invoice', crypto.randomUUID());
      const overBody = (await over.json()) as { error?: string; message?: string };
      expect(over.status, JSON.stringify(overBody)).toBe(422);
      expect(overBody.error).toBe('BW001');
      expect(overBody.message).toContain('only 100000.00 is still to invoice');
      expect(await erpInvoicesWithPo(po)).toHaveLength(1);

      // 3. A second user submits the first; Finance invoices exactly what is left.
      const submit = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approverToken,
        { ...invoice(firstId, 200_000), externalRecordId: firstBody.externalRecordId, verb: 'submit' }, 'sales-invoice', 'submit', crypto.randomUUID());
      const submitBody = await submit.json();
      expect(submit.status, `submit failed: ${JSON.stringify(submitBody)}`).toBe(200);
      const rest = await createWithRetry(invoice(restId, 100_000), authorToken);
      const restBody = await rest.json();
      expect(rest.status, `rest failed: ${JSON.stringify(restBody)}`).toBe(200);
      expect(await billing()).toEqual({ invoiced: 200_000, pending: 100_000, remaining: 0 });
    } finally {
      const ids = [firstId, overId, restId];
      await admin.from('sales_invoice_authors').delete().in('sales_invoice_id', ids);
      await admin.from('sales_invoices').delete().in('id', ids);
      await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
      await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
      await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', ids);
      await admin.from('work_orders').delete().eq('id', workOrderId);
      await cleanupSAR(admin, seeded);
    }
  });
});
```

#### F2 — allow-list the bench-gated skip, then run the journey

In `scripts/check-e2e-skips.mjs`, insert directly after the `AC-PB-003-progress-billing-erp.spec.ts` entry's closing `},`:

```js
  {
    file: 'serial/AC-BWO-003-invoice-work-order-erp.spec.ts',
    reason: 'Work-order billing proof needs the served functions lane and the throwaway ERPNext bench (its goal oracle includes the ERP Sales Invoice list for the PO); the bench is not provisioned in CI.',
    restore: 'Run with scripts/serve-functions.sh against the local ERPNext bench, with the bench API key exported.',
    verified: '2026-10-07',
  },
```

Verify: `cd "$WT" && node scripts/check-e2e-skips.mjs --self-test` passes, then with the bench up and the key exported:
`cd "$WT" && scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test AC-BWO-003` → 1 passed.
Mutation: comment out the `perform public.assert_work_order_invoiceable(…)` line in §6 of the migration, `supabase db reset`,
re-run → step 2 must fail (a second ERP draft appears); restore and reset.

---

### G1 — local final gate (before the PR)

```bash
cd "$WT/pmo-portal" && npm run typecheck
cd "$WT/pmo-portal" && npx eslint --max-warnings=0 \
  src/lib/workOrderBilling.ts src/lib/db/workOrderBilling.ts src/hooks/useWorkOrderBilling.ts src/hooks/useWorkOrders.ts \
  src/hooks/useRevenue.ts src/lib/repositories/index.ts src/lib/repositories/types.ts \
  src/lib/adapterSeam/erpnext/dispatchFactory.ts src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts \
  pages/project-detail/InvoiceWorkOrderModal.tsx pages/project-detail/tabs/WorkOrdersTab.tsx pages/project-detail/ProjectDetail.tsx \
  src/components/dashboard/StillToInvoiceCard.tsx src/components/dashboard/FinanceDashboard.tsx pages/ExecutiveDashboard.tsx \
  ../supabase/functions/agent-chat/draftInvoice.ts e2e/serial/AC-BWO-003-invoice-work-order-erp.spec.ts
cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
cd "$WT/supabase/functions/adapter-dispatch" && deno test --allow-env --allow-net --allow-read dispatchErrorStatus.test.ts readModelWriters.money.test.ts
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db \
  supabase/tests/0262_work_order_billing_figures.test.sql supabase/tests/0262_work_order_billing_refusal.test.sql \
  supabase/tests/0262_unbilled_work_orders.test.sql supabase/tests/0250_progress_billing_claims.test.sql \
  supabase/tests/0250_progress_billing_summary.test.sql supabase/tests/0251_management_pack_billed_work.test.sql \
  supabase/tests/0193_work_orders.test.sql supabase/tests/0178_anon_executable_definers.test.sql'
cd "$WT" && node scripts/check-isolation-denominator.mjs
cd "$WT" && scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test AC-BWO-003
```

Every line exits 0 / all `ok`. Then the review battery (spec, code-quality, security — security at depth: the two
fences, the definer trigger exemptions, the grants), and the rendered Discover pass on rich seed for the Work orders
tab, the dialog, and both dashboards (phone width included). CI's `pgtap` job is the full DB proof on the PR to `dev`.
After the owner-gated production DB push of 0262: run the anon-key probe (`scripts/isolation-probe.sh`) and confirm
`get_unbilled_work_orders` is not anon-executable on the hosted project — local Docker does not reproduce hosted grant
defaults.

## 4. Risks and notes for review

- **Deliberate test replacement (B1).** `progressClaimInvoice.test.ts`'s "an ordinary invoice never takes a
  caller-supplied work order" encoded a rule OD-BILL-1 reverses. Its protection moved to the link pre-flight and the
  outbox fence (AC-BWO-002 #15, #16); reviewers should confirm both.
- **Payload shape is now a control input.** The fence reads `payload.items[].qty/rate`, `workOrderId`, `projectId`,
  `currency`. A future change to the sales-invoice command shape must keep those or update `invoice_command_line_total`
  — the fence fails closed (refuses) if lines become unreadable, never open.
- **Rounding.** The fence uses `round(qty × rate, 2)` per line; ERPNext rounds to the currency's precision. For IDR at
  0 decimals a mirrored amount can differ by under 1 from the command total; the display may then show a sub-unit
  over/under. Accepted; the refusal itself is exact on what PMO sends.
- **Concurrent WO cancel.** The helper reads the work order's status without a row lock (a row lock would deadlock with
  `transition_work_order`'s project lock). An invoice can land on a work order cancelled in the same instant; it is
  recorded and shown. Accepted.
- **Down payments do not consume a PO** (DD-BWO-1; owner question 2). If the owner answers "yes", the change is one
  CASE in `work_order_billing_lines` plus its pgTAP rows.
