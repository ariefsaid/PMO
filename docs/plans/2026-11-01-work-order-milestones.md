# Work orders as billing milestones — implementation plan (#1640)

Spec: [`docs/specs/work-order-milestones.spec.md`](../specs/work-order-milestones.spec.md) (Draft; owner signs
OQ-WOMS-1..8 — this plan builds the recommended defaults). Rulings: OD-GRILL-20261101, OD-BILL-1, DD-BWO-1..13.
Role contract: `.claude/agents/eng-planner.md`. Executor: Orca workers per `docs/orca-dispatch.md`.

Checked against `origin/dev` at `b52aa48a` (migration head `0426_imprest_approval_route.sql`). Reviewed 2026-11-01
(Opus, spec-reviewer contract): every cited file, table, column, view, RPC and hook re-read at that head.

**Money path.** No money posting, no SoD rule and no write path changes. S1-S2 are read-only. S3 refactors the
client-side gate in front of the shipped draft-invoice / claim modals, so it is Director-dispatched to an Opus
builder and ships alone (below).

## Architecture decision

**No ADR, no new table, no new column, no new write path.** One additive `security_invoker` view, one
`create or replace` of an existing invoker RPC (same signature, one extra output key), one pure FE mapping, one new
Overview block, and a one-shot URL hand-off into the shipped invoice flow. Record nothing in `docs/decisions.md`
beyond the owner's sign-off of the OQs (the Director adds `DD-WOMS-1` with the signed defaults).

### Design (one decision each)

- **D1 Same record, read twice.** The plan block reads `useProjectWorkOrders` + `useWorkOrderBilling` — the exact
  hooks Contract & billing uses (`WorkOrdersTab.tsx:288`, `useWorkOrders.ts:17`). TanStack de-duplicates the keys,
  so a viewer moving between the two areas hits the cache. No milestone entity.
- **D2 Status is a pure FE mapping over the shipped view** (`work_order_billing`, live `0337:1010-1021`). New
  `deriveBillingMilestoneStatus` in a new module `src/lib/billingMilestones.ts`, beside — not inside —
  `deriveWorkOrderBillingState` (`src/lib/workOrderBilling.ts:16`), which keeps its 8 shipped states and tests.
- **D3 Acceptance age is SQL-only, one view.** `public.work_order_uninvoiced_acceptance` (invoker) computes the
  anchor and days per spec §3. Two consumers: the per-project DAL read, and a `left join` inside
  `get_unbilled_work_orders`. Org-local "today" is inlined as `(now() at time zone coalesce(o.default_timezone,'UTC'))::date`
  joined from `organizations` — **not** `native_org_today()`, whose EXECUTE is revoked from `authenticated`
  (`0275_native_revenue.sql:113-118`) and would fail inside an invoker view.
- **D4 Clock rules in SQL.** "Submitted invoice" = `sales_invoice_work_billed` (`0262:21-29`) rows with status in
  (`Submitted`,`Unpaid`,`Paid`) and `not is_down_payment`; a null `invoice_date` is coalesced to `'infinity'` (stops
  every clock — no false nag). Only `Confirmed` acceptances count. Days floored at 0 (a BAST dated in the future
  reads 0, never negative).
- **D5 Invoice this = URL hand-off, not a second dialog.** The block links to
  `/projects/:id/contract?wo=<id>&invoice=1`. `WorkOrdersTab` already receives `focusWorkOrderId` from `?wo=`
  (`ProjectSections.tsx:128`). It gains `autoInvoiceWorkOrderId` (from `invoice=1`). The per-row gate and opener
  (`WorkOrdersTab.tsx:779-822`) are lifted into one component-scope function `orderInvoiceAction(row)` used by
  **both** the card button and a one-shot effect, so the auto-open can never disagree with the button.
- **D6 Query keys.** The acceptance-age hook key is `['work-order-billing', orgId, projectId, 'acceptance-age']`, so
  every shipped invalidation of `['work-order-billing', orgId, projectId]` (`useProgressBilling.ts:42`,
  `useWorkOrders.ts:71`, `useWorkOrderAcceptances.ts:46`) and of `['work-order-billing']` (`useRevenue.ts:128`)
  refreshes it by prefix. No new invalidation code.
- **D7 Permissions.** Block: `may('view','salesInvoice')` (`policy.ts:572-574`), same gate as `canSeeMoney`
  (`ProjectSections.tsx:67`). Invoice this: `may('create','salesInvoice') && canInvoiceWorkOrder(...)`; the arrival
  side re-applies the full shipped `canRaiseOrderInvoice`. `can()` is UX only; BW001 + SoD in the DB are unchanged.

### Scaling notes
- The view re-aggregates `work_order_billing` per row; the project read filters `project_id` exactly like the
  shipped `listWorkOrderBilling` (`db/workOrderBilling.ts:92-97`), so the cost profile matches what ships. Index
  `work_order_acceptances_latest_idx (work_order_id, status, confirmed_at desc, id desc)` (`0337:115`) serves the
  `status='Confirmed'` lookup.
- One row per WO; DAL caps at `WORK_ORDER_BILLING_ROW_LIMIT` (500) like the billing read.

## Slices and branches

| Slice | Branch | Content | Tier |
|---|---|---|---|
| S1 | `feat/woms-acceptance-age-db` | migration + rollback + pgTAP + types + DAL + repo + hook | read-only billing; normal |
| S2 | `feat/woms-plan-block` | status mapping, Billing milestones block, WO-card age chip, Still-to-invoice age, i18n | UI lane |
| S3 | `feat/woms-invoice-this` | `orderInvoiceAction` lift, `invoice=1` hand-off, Invoice this button, e2e | **money-path entry — Director-dispatched, ships alone** |

Order: S1 → S2 → S3 (S2 needs S1's hook; S3 needs S2's block). Each is one PR to `dev`, gated on `verify`, `pgtap`
and both unit shards (browser e2e runs on the release PR to `main`).

S3 changes no write, RPC or modal, but it refactors the gate in front of `InvoiceWorkOrderModal` /
`ProgressClaimModal` (money writes). It therefore ships alone, gets the three reviewers including security-auditor,
and carries the mutation check in T3.6.

## File map

| Action | Path | Slice |
|---|---|---|
| Create | `supabase/migrations/0441_work_order_acceptance_age.sql` | S1 |
| Create | `supabase/migrations/rollback/0441_work_order_acceptance_age_down.sql` | S1 |
| Create | `supabase/tests/0441_work_order_milestones.test.sql` | S1 |
| Modify | `pmo-portal/src/lib/supabase/database.types.ts` (Views: new view) | S1 |
| Modify | `pmo-portal/src/lib/db/workOrderBilling.ts` (+ `.test.ts`) | S1 |
| Modify | `pmo-portal/src/lib/repositories/contracts/workOrders.ts`, `pmo-portal/src/lib/repositories/workOrders.ts` | S1 |
| Modify | `pmo-portal/src/hooks/useWorkOrderBilling.ts` (+ `.test.tsx`) | S1 |
| Create | `pmo-portal/src/lib/billingMilestones.ts` (+ `.test.ts`) | S2 |
| Create | `pmo-portal/pages/project-detail/BillingMilestonesBlock.tsx` | S2 |
| Create | `pmo-portal/pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx` | S2 |
| Modify | `pmo-portal/pages/project-detail/ProjectSections.tsx` (L96, L107) | S2 |
| Modify | `pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx` (age chip; S3: gate lift + hand-off) | S2, S3 |
| Modify | `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` | S2, S3 |
| Modify | `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx` (+ `__tests__/StillToInvoiceCard.test.tsx`) | S2 |
| Modify | `pmo-portal/public/locales/{en,id}/project.json`, `pmo-portal/public/locales/{en,id}/common.json` | S2, S3 |
| Create | `pmo-portal/e2e/AC-WOMS-012-invoice-from-plan.spec.ts` | S3 |

Migration `0441` (Lane B range 0440-0449; 0440 is the stock fix). No remote branch held `043x`/`044x` at review.
The builder re-checks with `scripts/check-migration-collisions.sh` and, on collision, runs
`scripts/renumber-migration.sh <old> <new>` (renames the test file too).

**Catalog CI gates (run in T1.2's GREEN command):** `0137_service_role_grants` sweeps base tables only
(`relkind 'r'`), so a view needs no carve-out; both `0136_*` tests drop the ERP side mirrors with `RESTRICT`, and
nothing here depends on a mirror; `0178_anon_executable_definers` lists client-callable SECURITY DEFINER functions,
and this adds none (`get_unbilled_work_orders` stays invoker and stays OFF that list, per its 0262 §9 note).

---

## S1 — acceptance age (DB + read path)

### T1.1 Failing pgTAP first (AC-WOMS-004..009) — 5 min
Create `supabase/tests/0441_work_order_milestones.test.sql`. Fixtures load with no JWT (server load), exactly as
`supabase/tests/0262_work_order_billing_figures.test.sql:1-42`; reads run as `authenticated` with JWT claims.

```sql
-- 0441_work_order_milestones.test.sql — #1640 AC-WOMS-004..009: billing-milestone inputs and acceptance age.
-- Migration under test: 0441_work_order_acceptance_age.sql. Fixtures load with no JWT (a server load).
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name) values
  ('16400000-0000-0000-0000-000000000001', 'WOMS Org'),
  ('16400000-0000-0000-0000-000000000002', 'WOMS Other Org');
-- UTC-11 and UTC+14: at every hour at least one of these local dates differs from the UTC date, so a view that
-- counted days in UTC would fail test 3 or test 12 whenever it runs (AC-WOMS-005 "not UTC").
update organizations set default_timezone = 'Pacific/Pago_Pago' where id = '16400000-0000-0000-0000-000000000001';
update organizations set default_timezone = 'Pacific/Kiritimati' where id = '16400000-0000-0000-0000-000000000002';
insert into auth.users (id, email) values
  ('16400000-0000-0000-0000-0000000000a1', 'woms-fin@example.com'),
  ('16400000-0000-0000-0000-0000000000b1', 'woms-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16400000-0000-0000-0000-0000000000a1', '16400000-0000-0000-0000-000000000001', 'WOMS Fin', 'woms-fin@example.com', 'Finance', 'active'),
  ('16400000-0000-0000-0000-0000000000b1', '16400000-0000-0000-0000-000000000002', 'WOMS XOrg', 'woms-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('16400000-0000-0000-0000-0000000000f1', '16400000-0000-0000-0000-000000000001', 'WOMS Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-000000000001', 'WOMS P', 'Ongoing Project', 10000, 'exclusive', 0, '16400000-0000-0000-0000-0000000000f1'),
  ('16400000-0000-0000-0000-0000000000c9', '16400000-0000-0000-0000-000000000002', 'WOMS X', 'Ongoing Project', 10000, 'exclusive', 0, null);
-- d1 aged (only a draft and a Paid down payment); d2 invoiced after its BAST then a later BAST; d3 untotallable; d4 Draft;
-- d5 fully submitted; d6/d7 the Paid-vs-Unpaid pair; d8 undated submitted invoice; d9 other org.
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount) values
  ('16400000-0000-0000-0000-0000000000d1', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Aged',       'Issued', 'WO-M-1', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d2', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Restarted',  'Issued', 'WO-M-2', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d3', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'No total',   'Issued', 'WO-M-3', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d4', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Draft',      'Draft',  null,     1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d5', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'All billed', 'Issued', 'WO-M-5', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d6', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Unpaid',     'Issued', 'WO-M-6', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d7', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Paid',       'Issued', 'WO-M-7', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d8', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', 'Undated',    'Issued', 'WO-M-8', 1000, 'exclusive', 0),
  ('16400000-0000-0000-0000-0000000000d9', '16400000-0000-0000-0000-000000000002', '16400000-0000-0000-0000-0000000000c9', 'X',          'Issued', 'WO-X-9', 1000, 'exclusive', 0);

-- Every date below is relative to the org-local today, written inline (no temp table: the reads run as
-- `authenticated`, which could not select a postgres-owned temp table), so the test never flakes on a UTC midnight.

insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis)
select v.id::uuid, v.org::uuid, v.project::uuid, v.wo::uuid, v.dt, false, v.status, v.who::uuid,
       case when v.status = 'Confirmed' then v.who::uuid end,
       case when v.status = 'Confirmed' then now() end,
       case when v.status = 'Confirmed' then 'sole_operator' end
  from (values
    ('16400000-0000-0000-0000-00000000e101', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 10, 'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e102', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 1,  'Draft', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e201', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d2', (now() at time zone 'Pacific/Pago_Pago')::date - 10, 'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e202', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d2', (now() at time zone 'Pacific/Pago_Pago')::date - 2,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e301', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d3', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e401', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d4', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e501', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d5', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e801', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d8', (now() at time zone 'Pacific/Pago_Pago')::date - 5,  'Confirmed', '16400000-0000-0000-0000-0000000000a1'),
    ('16400000-0000-0000-0000-00000000e901', '16400000-0000-0000-0000-000000000002', '16400000-0000-0000-0000-0000000000c9', '16400000-0000-0000-0000-0000000000d9', (now() at time zone 'Pacific/Kiritimati')::date - 4, 'Confirmed', '16400000-0000-0000-0000-0000000000b1')
  ) as v(id, org, project, wo, dt, status, who);

-- d1: a Paid down-payment invoice does not stop the clock either (FR-WOMS-024). A down payment is an invoice that
-- reuses a down_payment claim's id (0262 §1); same shape as 0262_work_order_billing_figures.test.sql e4.
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, down_payment_amount,
                             recovery_pct, dp_recovery_amount, dp_item_code, created_by, withdrawn_by, withdrawn_at) values
  ('16400000-0000-0000-0000-0000000005a2', '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000d1',
   'down_payment', 'USD', 100, 100, 10, 0, 'DP-ITEM', '16400000-0000-0000-0000-0000000000a1', null, null);

insert into sales_invoices (id, org_id, project_id, customer_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status)
select v.id::uuid, '16400000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-0000000000c1', '16400000-0000-0000-0000-0000000000f1', v.wo::uuid, v.dt, v.amount, 'exclusive', 0, 'USD', v.status
  from (values
    -- d1: a Draft does not stop the clock (FR-WOMS-024).
    ('16400000-0000-0000-0000-0000000005a1', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 3, 200::numeric, 'Draft'),
    ('16400000-0000-0000-0000-0000000005a2', '16400000-0000-0000-0000-0000000000d1', (now() at time zone 'Pacific/Pago_Pago')::date - 3, 100::numeric, 'Paid'),
    -- d2: submitted 5 days ago, after the 10-day BAST and before the 2-day BAST.
    ('16400000-0000-0000-0000-0000000005b1', '16400000-0000-0000-0000-0000000000d2', (now() at time zone 'Pacific/Pago_Pago')::date - 5, 300::numeric, 'Unpaid'),
    -- d3: an invoice with no amount makes the WO untotallable.
    ('16400000-0000-0000-0000-0000000005c1', '16400000-0000-0000-0000-0000000000d3', (now() at time zone 'Pacific/Pago_Pago')::date - 9, null::numeric, 'Unpaid'),
    -- d5: fully submitted (remaining 0, pending 0) but dated before the BAST.
    ('16400000-0000-0000-0000-0000000005e1', '16400000-0000-0000-0000-0000000000d5', (now() at time zone 'Pacific/Pago_Pago')::date - 9, 1000::numeric, 'Unpaid'),
    -- d6/d7: the same full invoice, Unpaid vs Paid (the state a recorded payment leaves: 0275 restate / ERP read-back).
    ('16400000-0000-0000-0000-0000000005f1', '16400000-0000-0000-0000-0000000000d6', (now() at time zone 'Pacific/Pago_Pago')::date - 9, 1000::numeric, 'Unpaid'),
    ('16400000-0000-0000-0000-0000000005f2', '16400000-0000-0000-0000-0000000000d7', (now() at time zone 'Pacific/Pago_Pago')::date - 9, 1000::numeric, 'Paid'),
    -- d8: a submitted invoice with no invoice date stops every clock.
    ('16400000-0000-0000-0000-0000000005f3', '16400000-0000-0000-0000-0000000000d8', null::date, 100::numeric, 'Unpaid')
  ) as v(id, wo, dt, amount, status);

set local role authenticated;
set local request.jwt.claims = '{"sub":"16400000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok((select unpaid_count = 1 and remaining = 0 and pending = 0 from work_order_billing where work_order_id = '16400000-0000-0000-0000-0000000000d6'),
  'AC-WOMS-004 a fully invoiced work order with an Unpaid invoice has one unpaid, nothing left, nothing pending (reads Invoiced)');   -- 1
select ok((select unpaid_count = 0 and remaining = 0 and pending = 0 from work_order_billing where work_order_id = '16400000-0000-0000-0000-0000000000d7'),
  'AC-WOMS-004 once that invoice is Paid nothing is unpaid, left or pending (reads Paid)');                                       -- 2
select is((select days from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d1'), 10,
  'AC-WOMS-005 days since the confirmed BAST, counted in the organisation''s time zone; a Draft BAST, a draft invoice and a Paid down payment change nothing');  -- 3
select is((select anchor_date from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d1'), (now() at time zone 'Pacific/Pago_Pago')::date - 10,
  'AC-WOMS-005 the anchor is the confirmed BAST''s acceptance date');                                                                     -- 4
select is((select days from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d2'), 2,
  'AC-WOMS-006 an invoice submitted after a BAST satisfies it; a later BAST starts a new clock');                                         -- 5
select is((select count(*)::int from work_order_uninvoiced_acceptance where work_order_id = '16400000-0000-0000-0000-0000000000d8'), 0,
  'AC-WOMS-006 a submitted invoice with no invoice date stops every clock');                                                              -- 6
select is((select count(*)::int from work_order_uninvoiced_acceptance where work_order_id in (
  '16400000-0000-0000-0000-0000000000d3', '16400000-0000-0000-0000-0000000000d4', '16400000-0000-0000-0000-0000000000d5')), 0,
  'AC-WOMS-007 no age on an untotallable, Draft, or fully submitted work order, each with a confirmed BAST');                                                         -- 7
select is((select count(*)::int from work_order_uninvoiced_acceptance where org_id <> '16400000-0000-0000-0000-000000000001'), 0,
  'AC-WOMS-008 a user reads only their own organisation''s ages');                                                                        -- 8
select is((select (r ->> 'days_since_acceptance')::int from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r
            where r ->> 'wo_number' = 'WO-M-1'), 10,
  'AC-WOMS-009 the still-to-invoice rows carry the same days since acceptance');                                                          -- 9
select ok((select r -> 'days_since_acceptance' = 'null'::jsonb from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r
            where r ->> 'wo_number' = 'WO-M-8'),
  'AC-WOMS-009 a row with no acceptance age carries null');                                                                               -- 10
select ok((select bool_and(r ? 'days_since_closed') from jsonb_array_elements(public.get_unbilled_work_orders(8) -> 'rows') r),
  'AC-WOMS-009 days since closed is still returned on every row');                                                                        -- 11
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"16400000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select string_agg(work_order_id::text || ':' || days, ',') from work_order_uninvoiced_acceptance), '16400000-0000-0000-0000-0000000000d9:4',
  'AC-WOMS-008 the other organisation sees only its own work order, aged in its own time zone (AC-WOMS-005)');                                                                     -- 12
reset role;
select ok(not has_table_privilege('anon', 'public.work_order_uninvoiced_acceptance', 'select'),
  'AC-WOMS-008 anon cannot read the view');                                                                                               -- 13
select is((select reloptions from pg_class where oid = 'public.work_order_uninvoiced_acceptance'::regclass), array['security_invoker=true'],
  'AC-WOMS-008 the view is security_invoker — RLS stays the boundary');                                                                   -- 14
select * from finish();
rollback;
```

Verify RED (from repo root): `scripts/with-db-lock.sh supabase test db supabase/tests/0441_work_order_milestones.test.sql`
→ fails at test 3 (`relation "work_order_uninvoiced_acceptance" does not exist`). Tests 1-2 already pass: they pin
the shipped inputs the FE status mapping reads.

Fixture notes the builder must not "fix" by bending: if the sales-invoice insert trigger refuses a no-JWT load,
that contradicts DD-BWO-4 ("every writer except the service-role mirror and a no-JWT load") — stop and report.

### T1.2 Migration — 5 min
Create `supabase/migrations/0441_work_order_acceptance_age.sql`:

```sql
-- 0441_work_order_acceptance_age.sql — #1640 (OD-GRILL-20261101): days since a work order's acceptance with no
-- invoice yet. Spec: docs/specs/work-order-milestones.spec.md §3, FR-WOMS-020..024. Plan: docs/plans/2026-11-01-work-order-milestones.md.
-- Reversal: rollback/0441_work_order_acceptance_age_down.sql.
-- ⚑ Read-only. No table, no column, no definer. One security_invoker view + get_unbilled_work_orders (0262 §9)
--   re-created with the same signature and one extra row key. RLS on every base relation stays the boundary.
-- ⚑ "Today" is inlined from organizations.default_timezone, NOT native_org_today(): that helper's EXECUTE is revoked
--   from authenticated (0275 §2) and would fail inside an invoker view.

create view public.work_order_uninvoiced_acceptance with (security_invoker = true) as
  select b.work_order_id, b.org_id, b.project_id, a.anchor_date,
         greatest(((now() at time zone coalesce(o.default_timezone, 'UTC'))::date - a.anchor_date), 0) as days
    from public.work_order_billing b
    left join public.organizations o on o.id = b.org_id
    cross join lateral (
      select min(x.acceptance_date) as anchor_date
        from public.work_order_acceptances x
       where x.work_order_id = b.work_order_id and x.org_id = b.org_id and x.status = 'Confirmed'
         and x.acceptance_date > coalesce((
               select max(coalesce(w.invoice_date, 'infinity'::date))
                 from public.sales_invoice_work_billed w
                where w.work_order_id = b.work_order_id and w.org_id = b.org_id
                  and not w.is_down_payment and w.status in ('Submitted', 'Unpaid', 'Paid')),
             '-infinity'::date)
    ) a
   where a.anchor_date is not null
     and b.status in ('Issued', 'Closed')
     and b.figures_complete
     and round((b.remaining + b.pending) * 100) > 0;
comment on view public.work_order_uninvoiced_acceptance is
  '#1640 FR-WOMS-020: per Issued/Closed work order with something not yet submitted-invoiced, the earliest confirmed '
  'BAST dated after its latest submitted (non-down-payment) invoice, and the org-local days since it. Derived, never stored.';
revoke all on public.work_order_uninvoiced_acceptance from public, anon, authenticated;
grant select on public.work_order_uninvoiced_acceptance to authenticated;

-- 0262 §9 verbatim, plus `days_since_acceptance` (left join; null when none). Same signature, still SECURITY INVOKER.
create or replace function public.get_unbilled_work_orders(p_limit integer default 8)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with zone as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as tz
  ),
  live as (
    select b.work_order_id, b.wo_number, b.title, b.project_id, p.name as project_name, b.status, b.currency,
           b.remaining, b.figures_complete,
           case when b.status = 'Closed' and b.closed_at is not null
                then (now() at time zone zone.tz)::date - (b.closed_at at time zone zone.tz)::date end as days_since_closed,
           u.days as days_since_acceptance
      from public.work_order_billing b
      join public.projects p on p.id = b.project_id
      left join public.work_order_uninvoiced_acceptance u on u.work_order_id = b.work_order_id
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
                                     remaining, days_since_closed, days_since_acceptance
                                from billable
                               order by remaining desc, work_order_id
                               limit greatest(1, least(coalesce(p_limit, 8), 50))) r), '[]'::jsonb))
$$;
comment on function public.get_unbilled_work_orders(integer) is
  'OD-BILL-1 / #786 DD-BWO-10, #1640: what is still to invoice on the org''s Issued and Closed work orders on live projects — '
  'totals per currency, the untotallable count, and the work orders with the most left, each with days since closed and '
  'days since acceptance not invoiced. SECURITY INVOKER on purpose.';
revoke all on function public.get_unbilled_work_orders(integer) from public, anon;
grant execute on function public.get_unbilled_work_orders(integer) to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.work_order_uninvoiced_acceptance', 'select') then
    raise exception '0441: anon can read work_order_uninvoiced_acceptance';
  end if;
  if has_function_privilege('anon', 'public.get_unbilled_work_orders(integer)', 'execute') then
    raise exception '0441: anon can execute get_unbilled_work_orders';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.get_unbilled_work_orders(integer)'::regprocedure) then
    raise exception '0441: get_unbilled_work_orders must stay SECURITY INVOKER';
  end if;
end $$;
```

Before writing the replaced function, the builder diffs its body against `0262_billing_by_work_order.sql:631-661`
(`diff <(sed -n 631,661p supabase/migrations/0262_billing_by_work_order.sql) …`): the only differences allowed are the
`days_since_acceptance` column, the `left join`, and the extra name in the `rows` select list.

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0441_work_order_milestones.test.sql supabase/tests/0262_unbilled_work_orders.test.sql supabase/tests/0262_work_order_billing_figures.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0136_posture_b_side_mirror_droppable.test.sql supabase/tests/0136_audit_agent_denial.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`
→ all pass; the catalog gates unchanged (see File map note).

### T1.3 Rollback file — 3 min
Create `supabase/migrations/rollback/0441_work_order_acceptance_age_down.sql`:

```sql
-- Reverses 0441_work_order_acceptance_age.sql: restore 0262 §9's get_unbilled_work_orders, then drop the view.
begin;
-- (paste supabase/migrations/0262_billing_by_work_order.sql lines 631-666 verbatim here: the function, its comment,
--  revoke and grant — copied by the builder with `sed -n 631,666p`, not retyped)
drop view if exists public.work_order_uninvoiced_acceptance;
commit;
```
The paste is a mechanical copy of named lines, not a placeholder: build it with
`{ echo '-- Reverses …'; echo begin';'; sed -n 631,666p supabase/migrations/0262_billing_by_work_order.sql; echo 'drop view if exists public.work_order_uninvoiced_acceptance;'; echo commit';'; } > supabase/migrations/rollback/0441_work_order_acceptance_age_down.sql`.
Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && psql "$(supabase status -o env | sed -n "s/^DB_URL=\"\(.*\)\"/\1/p")" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0441_work_order_acceptance_age_down.sql && supabase test db supabase/tests/0262_unbilled_work_orders.test.sql'`
→ rollback applies, the shipped 0262 test still passes; then `scripts/with-db-lock.sh supabase db reset` to restore.

### T1.4 Types — 2 min
In `pmo-portal/src/lib/supabase/database.types.ts`, in `Views`, after the `work_order_billing_lines` entry
(starts L9617), add:

```ts
      work_order_uninvoiced_acceptance: {
        Row: {
          anchor_date: string | null
          days: number | null
          org_id: string | null
          project_id: string | null
          work_order_id: string | null
        }
        Relationships: []
      }
```
`get_unbilled_work_orders` returns `Json`: no change. Verify: `cd pmo-portal && npm run typecheck`.

### T1.5 DAL — failing test first — 4 min
In `pmo-portal/src/lib/db/workOrderBilling.test.ts` add (the file already mocks `supabase.from`/`rpc`; follow its
existing `listWorkOrderBilling` cases):

```ts
// import line (L30) becomes: import { getUnbilledWorkOrders, listWorkOrderAcceptanceAge, listWorkOrderBilling, parseUnbilledWorkOrders } from './workOrderBilling';
describe('work-order acceptance age DAL (#1640)', () => {
  it('AC-WOMS-011 listWorkOrderAcceptanceAge reads the view for one project, figures validated', async () => {
    h.state.rows = { data: [{ work_order_id: 'wo-1', anchor_date: '2026-10-22', days: 10 }], error: null };
    expect(await listWorkOrderAcceptanceAge('p1')).toEqual([{ workOrderId: 'wo-1', anchorDate: '2026-10-22', days: 10 }]);
    expect(h.calls.from).toEqual(['work_order_uninvoiced_acceptance']);
    expect(h.calls.eq).toEqual([['project_id', 'p1']]);
    expect(h.calls.limit).toEqual([501]);
  });
  it('AC-WOMS-011 a missing day count is an error, never a plausible 0', async () => {
    h.state.rows = { data: [{ work_order_id: 'wo-1', anchor_date: '2026-10-22', days: null }], error: null };
    await expect(listWorkOrderAcceptanceAge('p1')).rejects.toMatchObject({ code: 'malformed-billing' });
  });
  it('AC-WOMS-009 parseUnbilledWorkOrders carries days since acceptance, null when absent', () => {
    const doc = parseUnbilledWorkOrders({ totals: [], incomplete_count: 0, rows: [
      { work_order_id: 'wo-1', wo_number: 'WO-1', title: 'A', project_id: 'p1', project_name: 'P', status: 'Issued', currency: 'USD', remaining: 5, days_since_closed: null, days_since_acceptance: 12 },
      { work_order_id: 'wo-2', wo_number: 'WO-2', title: 'B', project_id: 'p1', project_name: 'P', status: 'Closed', currency: 'USD', remaining: 5, days_since_closed: 3 },
    ] });
    expect(doc.rows.map((r) => r.daysSinceAcceptance)).toEqual([12, null]);
  });
});
```
The mock `h` (L3-28) already answers any table from `h.state.rows`. RED:
`cd pmo-portal && npx vitest run src/lib/db/workOrderBilling.test.ts`.

### T1.6 DAL implementation — 3 min
In `pmo-portal/src/lib/db/workOrderBilling.ts`:
- `UnbilledWorkOrderRow` (L38-50): add `daysSinceAcceptance: number | null;` after `daysSinceClosed`.
- `parseUnbilledWorkOrders` (L229-243): add
  `daysSinceAcceptance: r.days_since_acceptance == null ? null : num(r.days_since_acceptance, 'days_since_acceptance'),`.
- Append:

```ts
/** #1640 FR-WOMS-020: days since a work order's acceptance with no invoice yet (view work_order_uninvoiced_acceptance). */
export interface WorkOrderAcceptanceAge { workOrderId: string; anchorDate: string; days: number }

export async function listWorkOrderAcceptanceAge(projectId: string): Promise<WorkOrderAcceptanceAge[]> {
  const { data, error } = await supabase
    .from('work_order_uninvoiced_acceptance')
    .select('work_order_id, anchor_date, days')
    .eq('project_id', projectId)
    .limit(WORK_ORDER_BILLING_ROW_LIMIT + 1);
  if (error) throw new AppError(error.message, error.code);
  const rows: ReadonlyArray<Record<string, unknown>> = data ?? [];
  if (rows.length > WORK_ORDER_BILLING_ROW_LIMIT) {
    throw new AppError(`This project has more than ${WORK_ORDER_BILLING_ROW_LIMIT} work orders; billing cannot be shown in one view.`, 'too-many-work-orders');
  }
  return rows.map((r) => ({
    workOrderId: text(r.work_order_id, 'work_order_id'),
    anchorDate: text(r.anchor_date, 'anchor_date'),
    days: num(r.days, 'days'),
  }));
}
```
GREEN: `cd pmo-portal && npx vitest run src/lib/db/workOrderBilling.test.ts`.

### T1.7 Repository + hook — 4 min
- `pmo-portal/src/lib/repositories/contracts/workOrders.ts` after L71:
  `/** #1640: days since acceptance, not invoiced, per work order of one project (RLS-scoped view). */ acceptanceAge(projectId: string): Promise<WorkOrderAcceptanceAge[]>;`
  (import the type from `@/src/lib/db/workOrderBilling`).
- `pmo-portal/src/lib/repositories/workOrders.ts` after L77: `acceptanceAge: (projectId) => wrap(() => listWorkOrderAcceptanceAge(projectId)),`.
- `pmo-portal/src/hooks/useWorkOrderBilling.ts` append:

```ts
/** #1640: acceptance age per work order. Keyed under 'work-order-billing' so every billing invalidation refreshes it. */
export function useWorkOrderAcceptanceAge(projectId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-billing', orgId, projectId, 'acceptance-age'],
    queryFn: () => repositories.workOrder.acceptanceAge(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}
```
- Test first in `pmo-portal/src/hooks/useWorkOrderBilling.test.tsx` (add `acceptanceAge: h.acceptanceAge` to the
  mocked `repositories.workOrder`, L10):
  `it('AC-WOMS-011 useWorkOrderAcceptanceAge is keyed under the work-order billing prefix so billing invalidations refresh it', …)`
  — render the hook, call `queryClient.invalidateQueries({ queryKey: ['work-order-billing', 'org-1', 'p1'] })`,
  assert `h.acceptanceAge` was called twice.
Verify: `cd pmo-portal && npx vitest run src/hooks/useWorkOrderBilling.test.tsx && npm run typecheck`.

### T1.8 S1 local final gate — 3 min
`cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 src/lib/db/workOrderBilling.ts src/lib/db/workOrderBilling.test.ts src/lib/repositories/workOrders.ts src/lib/repositories/contracts/workOrders.ts src/hooks/useWorkOrderBilling.ts src/hooks/useWorkOrderBilling.test.tsx && npx vitest run src/lib/db/workOrderBilling.test.ts src/hooks/useWorkOrderBilling.test.tsx`
plus T1.2's pgTAP command. Commit, push branch, Director opens the PR to `dev`.

---

## S2 — the plan block, the WO card age, the card age (UI lane)

### T2.1 Status mapping — failing test first (AC-WOMS-003) — 4 min
Create `pmo-portal/src/lib/billingMilestones.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveBillingMilestoneStatus, sortBillingMilestones } from './billingMilestones';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

const row = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 1000, invoiced: 0, pending: 0,
  paid: 0, remaining: 1000, figuresComplete: true, lineCount: 0, unpaidCount: 0, ...over,
});

describe('deriveBillingMilestoneStatus (#1640 FR-WOMS-010)', () => {
  it.each([
    ['figures incomplete → unknown', 'Issued', row({ figuresComplete: false, invoiced: 500, remaining: 500 }), 'unknown', false],
    ['Draft work order → planned', 'Draft', row(), 'planned', false],
    ['nothing invoiced or pending → planned', 'Issued', row(), 'planned', false],
    ['something left → in-progress', 'Issued', row({ invoiced: 900, remaining: 100, unpaidCount: 1 }), 'in-progress', false],
    ['nothing left but a draft → in-progress', 'Issued', row({ invoiced: 950, pending: 50, remaining: 0, unpaidCount: 1 }), 'in-progress', false],
    ['all submitted, one unpaid → invoiced', 'Closed', row({ invoiced: 1000, remaining: 0, unpaidCount: 1 }), 'invoiced', false],
    ['all submitted and paid → paid', 'Closed', row({ invoiced: 1000, paid: 1000, remaining: 0 }), 'paid', false],
    ['over-invoiced and unpaid → invoiced + flag', 'Issued', row({ invoiced: 1010, remaining: -10, unpaidCount: 1 }), 'invoiced', true],
    ['sub-cent remainder rounds to zero → paid', 'Issued', row({ invoiced: 999.996, paid: 999.996, remaining: 0.004 }), 'paid', false],
  ] as const)('AC-WOMS-003 %s', (_name, status, billing, expected, over) => {
    expect(deriveBillingMilestoneStatus(status, billing)).toEqual({ status: expected, overInvoiced: over });
  });
});

describe('sortBillingMilestones (FR-WOMS-004)', () => {
  it('AC-WOMS-002 orders by end, else start, else order date; undated last; then number and id', () => {
    const wos = [
      { id: 'a', wo_number: 'WO-4', end_date: null, start_date: null, order_date: null },
      { id: 'b', wo_number: 'WO-3', end_date: '2026-12-01', start_date: '2026-11-10', order_date: null },
      { id: 'c', wo_number: 'WO-2', end_date: null, start_date: null, order_date: '2026-10-01' },
      { id: 'd', wo_number: 'WO-1', end_date: null, start_date: '2026-11-10', order_date: null },
    ];
    expect(sortBillingMilestones(wos).map((w) => w.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});
```
RED: `cd pmo-portal && npx vitest run src/lib/billingMilestones.test.ts`.

### T2.2 Status mapping implementation — 3 min
Create `pmo-portal/src/lib/billingMilestones.ts`:

```ts
import type { WorkOrderStatus } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

/**
 * #1640 (OD-GRILL-20261101): a work order shown as a billing milestone. Derived from the shipped view
 * `work_order_billing` on every read — never stored (DD-BWO-2). The DB stays the authority on what may be invoiced.
 */
export type BillingMilestoneStatus = 'unknown' | 'planned' | 'in-progress' | 'invoiced' | 'paid';

const cents = (value: number): number => Math.round(value * 100);

export function deriveBillingMilestoneStatus(
  status: WorkOrderStatus, f: WorkOrderBillingRow,
): { status: BillingMilestoneStatus; overInvoiced: boolean } {
  if (!f.figuresComplete) return { status: 'unknown', overInvoiced: false };
  const overInvoiced = cents(f.remaining) < 0;
  if (status === 'Draft' || cents(f.invoiced) + cents(f.pending) <= 0) return { status: 'planned', overInvoiced };
  if (cents(f.remaining) > 0 || cents(f.pending) > 0) return { status: 'in-progress', overInvoiced };
  if (f.unpaidCount > 0) return { status: 'invoiced', overInvoiced };
  return { status: 'paid', overInvoiced };
}

interface Dated { id: string; wo_number: string | null; end_date: string | null; start_date: string | null; order_date: string | null }

/** FR-WOMS-004: milestone date = end, else start, else order date (ISO dates compare as strings); undated last. */
export function sortBillingMilestones<T extends Dated>(rows: readonly T[]): T[] {
  const key = (r: T) => r.end_date ?? r.start_date ?? r.order_date;
  return [...rows].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    if (ka !== kb) return ka === null ? 1 : kb === null ? -1 : ka < kb ? -1 : 1;
    const na = a.wo_number ?? '￿'; const nb = b.wo_number ?? '￿';
    if (na !== nb) return na < nb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
```
GREEN: `cd pmo-portal && npx vitest run src/lib/billingMilestones.test.ts`.

### T2.3 Copy (en + id) — 3 min
`pmo-portal/public/locales/en/project.json`, under `projectDetail` (sibling of `delivery`, L484):

```json
"billingMilestones": {
  "title": "Billing milestones",
  "subline": "The client's work orders. Billing follows each work order.",
  "error": "Couldn't load the billing milestones",
  "empty": "No work orders yet.",
  "openContract": "Open contract & billing",
  "notIssued": "Not issued yet",
  "dates": "{{start}} – {{end}}",
  "startOnly": "From {{date}}",
  "endOnly": "Due {{date}}",
  "ordered": "Ordered {{date}}",
  "noDates": "No dates",
  "status": { "planned": "Planned", "inProgress": "In progress", "invoiced": "Invoiced", "paid": "Paid" },
  "statusSource": "Source: this work order's invoices and drafts (Contract & billing).",
  "invoiceThis": "Invoice this",
  "invoiceThisLabel": "Invoice {{order}}"
},
```
and under `projectDetail.workOrders`:
`"acceptanceAge": "Days since acceptance, not invoiced: {{days}}"`,
`"acceptanceAgeSource": "Counted from the earliest confirmed BAST not yet followed by a submitted invoice."`,
`"cannotInvoiceHere": "This work order can't be invoiced from here right now."` (S3 uses the last one).

`pmo-portal/public/locales/id/project.json`, same paths:
`"title": "Milestone penagihan"`, `"subline": "Work order klien. Penagihan mengikuti tiap work order."`,
`"error": "Gagal memuat milestone penagihan"`, `"empty": "Belum ada work order."`,
`"openContract": "Buka kontrak & penagihan"`, `"notIssued": "Belum diterbitkan"`, `"dates": "{{start}} – {{end}}"`,
`"startOnly": "Mulai {{date}}"`, `"endOnly": "Jatuh tempo {{date}}"`, `"ordered": "Dipesan {{date}}"`,
`"noDates": "Tanpa tanggal"`, status `"Direncanakan"`, `"Berjalan"`, `"Ditagih"`, `"Lunas"`,
`"statusSource": "Sumber: faktur dan draf work order ini (Kontrak & penagihan)."`, `"invoiceThis": "Tagih ini"`,
`"invoiceThisLabel": "Tagih {{order}}"`; workOrders `"acceptanceAge": "Hari sejak BAST, belum ditagih: {{days}}"`,
`"acceptanceAgeSource": "Dihitung dari BAST terkonfirmasi paling awal yang belum diikuti faktur terkirim."`,
`"cannotInvoiceHere": "Work order ini belum bisa ditagih dari sini."`.

`pmo-portal/public/locales/en/common.json` `dashboard.stillToInvoice` (L1431): add
`"daysSinceAcceptance": "Days since acceptance, not invoiced: {{days}}"`; `id/common.json` same path:
`"daysSinceAcceptance": "Hari sejak BAST, belum ditagih: {{days}}"`.

Verify: `cd pmo-portal && npm run check:i18n`.

### T2.4 Block — failing RTL first (AC-WOMS-001, 002, 014, 015; 011 plan-row reference) — 5 min
Create `pmo-portal/pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx`. Mock pattern copied from
`WorkOrdersTab.billing.test.tsx:12-60` (hoisted `h`, `vi.mock` of `@/src/hooks/useWorkOrders`,
`@/src/hooks/useWorkOrderBilling` → `{ useWorkOrderBilling: () => h.billing, useWorkOrderAcceptanceAge: () => h.age }`,
`@/src/auth/impersonation`, `@/src/auth/useAuth`), rendered in `MemoryRouter` + `FinanceI18nTestProvider`.
Tests (titles are the traceability oracles):

```ts
it('AC-WOMS-001 lists each non-cancelled work order once, by id, and never the cancelled one', …)
  // list: Issued wo-1, Draft wo-2 (wo_number null), Cancelled wo-3 → rows 'billing-milestone-wo-1', '-wo-2'; no '-wo-3';
  // wo-2 shows 'Not issued yet' and status 'Planned'.
it('AC-WOMS-001 a role without billing visibility sees no block', …)          // role 'Engineer' → container empty
it('AC-WOMS-002 rows follow the milestone date and show dates, value excl. tax and status', …)
  // the four rows of T2.1's sort case; texts 'Ordered 1 Oct 2026', 'From 10 Nov 2026', '10 Nov 2026 – 1 Dec 2026', 'No dates';
  // value text is formatCurrencyAuto(orderNet,'USD') and a TaxBasisLabel 'excl.' is present per row.
it('AC-WOMS-011 an aged work order shows days since acceptance with its source; others show none', …)
  // h.age.data = [{ workOrderId: 'wo-1', anchorDate: '2026-10-22', days: 10 }] → row wo-1 has
  // 'Days since acceptance, not invoiced: 10'; row wo-2 does not.
it('AC-WOMS-014 a PM sees status and value but no Invoice this', …)            // role 'Project Manager'
it('AC-WOMS-015 a pending or failed read shows loading or error with retry, never a status, value or age', …)
  // three renders: list pending; billing error (retry calls both refetches); age error → error state (no partial rows).
it('AC-WOMS-015 no work orders → says so and links to Contract & billing', …)  // link href '/projects/p1/contract'
```
RED: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx`.

### T2.5 Block implementation — 5 min
First export the shipped shell: in `pmo-portal/pages/project-detail/ProjectBlocks.tsx:40` change `const Block` to
`export const Block` (section + `Card` + `CardHead` + `CardPad`, the shell every Overview block uses), so the new
block does not copy its markup. Then create `pmo-portal/pages/project-detail/BillingMilestonesBlock.tsx`:

```tsx
import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, StatusPill, TaxBasisLabel, Tooltip, type StatusVariant } from '@/src/components/ui';
import { Block } from './ProjectBlocks';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useWorkOrderAcceptanceAge, useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { deriveBillingMilestoneStatus, sortBillingMilestones, type BillingMilestoneStatus } from '@/src/lib/billingMilestones';
import { formatCurrencyAuto, formatDateOnly } from '@/src/lib/format';

const TONE: Record<BillingMilestoneStatus, StatusVariant> = { unknown: 'warn', planned: 'open', 'in-progress': 'progress', invoiced: 'neutral', paid: 'won' };

/** #1640: the client's work orders as billing milestones (same records as Contract & billing; no second entry). */
const Body: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('project');
  const orders = useProjectWorkOrders(projectId);
  const billing = useWorkOrderBilling(projectId);
  const age = useWorkOrderAcceptanceAge(projectId);
  const title = t('projectDetail.billingMilestones.title', 'Billing milestones');
  const rows = useMemo(() => sortBillingMilestones((orders.data ?? []).filter((w) => w.status !== 'Cancelled')), [orders.data]);
  const billingById = useMemo(() => new Map((billing.data ?? []).map((b) => [b.workOrderId, b] as const)), [billing.data]);
  const ageById = useMemo(() => new Map((age.data ?? []).map((a) => [a.workOrderId, a] as const)), [age.data]);
  const contractHref = `/projects/${projectId}/contract`;
  const shell = (children: React.ReactNode) => (
    <Block id="pd-billing-milestones" title={title}
      unit={t('projectDetail.billingMilestones.subline', "The client's work orders. Billing follows each work order.")}>{children}</Block>
  );
  if (orders.isPending || billing.isPending || age.isPending) return shell(<ListState variant="loading" rows={3} />);
  if (orders.isError || billing.isError || age.isError) {
    return shell(<ListState variant="error" title={t('projectDetail.billingMilestones.error', "Couldn't load the billing milestones")}
      onRetry={() => { void orders.refetch(); void billing.refetch(); void age.refetch(); }} />);
  }
  if (rows.length === 0) {
    return shell(<p className="text-sm text-muted-foreground">{t('projectDetail.billingMilestones.empty', 'No work orders yet.')}{' '}
      <Link to={contractHref} className="font-semibold text-primary-text hover:underline">{t('projectDetail.billingMilestones.openContract', 'Open contract & billing')}</Link></p>);
  }
  const statusLabel: Record<BillingMilestoneStatus, string> = {
    unknown: t('common:projectDetail.workOrders.billing.status.incomplete', "Can't total"),
    planned: t('projectDetail.billingMilestones.status.planned', 'Planned'),
    'in-progress': t('projectDetail.billingMilestones.status.inProgress', 'In progress'),
    invoiced: t('projectDetail.billingMilestones.status.invoiced', 'Invoiced'),
    paid: t('projectDetail.billingMilestones.status.paid', 'Paid'),
  };
  const dates = (w: (typeof rows)[number]) =>
    w.start_date && w.end_date ? t('projectDetail.billingMilestones.dates', '{{start}} – {{end}}', { start: formatDateOnly(w.start_date), end: formatDateOnly(w.end_date) })
      : w.start_date ? t('projectDetail.billingMilestones.startOnly', 'From {{date}}', { date: formatDateOnly(w.start_date) })
      : w.end_date ? t('projectDetail.billingMilestones.endOnly', 'Due {{date}}', { date: formatDateOnly(w.end_date) })
      : w.order_date ? t('projectDetail.billingMilestones.ordered', 'Ordered {{date}}', { date: formatDateOnly(w.order_date) })
      : t('projectDetail.billingMilestones.noDates', 'No dates');
  return shell(
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((w) => {
        const b = billingById.get(w.id);
        const derived = b ? deriveBillingMilestoneStatus(w.status, b) : null;
        const aged = ageById.get(w.id);
        return (
          <li key={w.id} data-testid={`billing-milestone-${w.id}`} className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <Link to={`${contractHref}?wo=${encodeURIComponent(w.id)}`} className="font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                {w.wo_number ?? t('projectDetail.billingMilestones.notIssued', 'Not issued yet')}
              </Link>
              <span className="ml-2 break-words text-sm text-foreground">{w.title}</span>
              <p className="text-xs text-muted-foreground tabular-nums">{dates(w)}</p>
              {aged && <Tooltip content={t('projectDetail.workOrders.acceptanceAgeSource', 'Counted from the earliest confirmed BAST not yet followed by a submitted invoice.')}>
                <p tabIndex={0} className="text-xs font-semibold text-warning-foreground">{t('projectDetail.workOrders.acceptanceAge', 'Days since acceptance, not invoiced: {{days}}', { days: aged.days })}</p>
              </Tooltip>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {b && <span className="text-sm font-semibold tabular-nums">{formatCurrencyAuto(b.orderNet, b.currency)}{' '}
                <TaxBasisLabel treatment="exclusive" showDetails={false} /></span>}
              {derived && <Tooltip content={t('projectDetail.billingMilestones.statusSource', "Source: this work order's invoices and drafts (Contract & billing).")}>
                <span tabIndex={0}><StatusPill variant={TONE[derived.status]}>{statusLabel[derived.status]}</StatusPill></span></Tooltip>}
              {derived?.overInvoiced && <StatusPill variant="lost">{t('common:projectDetail.workOrders.billing.status.overInvoiced', 'Over-invoiced')}</StatusPill>}
              {/* S3 adds Invoice this here. */}
            </div>
          </li>
        );
      })}
    </ul>,
  );
};

/** Mounted only for the revenue read set; the queries never run otherwise (same gate as the Money block). */
export const BillingMilestonesBlock: React.FC<{ projectId: string }> = ({ projectId }) => {
  const may = usePermission();
  return may('view', 'salesInvoice') ? <Body projectId={projectId} /> : null;
};
export default BillingMilestonesBlock;
```
The value is the work order's own net (closing value once stamped) and shows on every row, Can't total included: it
does not depend on the invoices that make a row untotallable (FR-WOMS-003). The `{/* S3 adds … */}` comment is the S3
insertion anchor (T3.4), not a placeholder in S2's behaviour: S2 ships no action. If `StatusVariant` is not exported from `@/src/components/ui`, import it from where `WorkOrdersTab.tsx`
imports it (same file, same name).
GREEN: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx`.

### T2.6 Mount on the Overview — 2 min
`pmo-portal/pages/project-detail/ProjectSections.tsx`: import `BillingMilestonesBlock from './BillingMilestonesBlock'`;
directly after each non-pipeline `<DeliveryBlock projectId={project.id}>{curve}</DeliveryBlock>` (L96 and L107) add
`<BillingMilestonesBlock projectId={project.id} />` (the component self-gates). Pipeline branches (L76, L83) unchanged.
Test: in `pmo-portal/pages/project-detail/__tests__/OverviewTab.test.tsx` add
`it('AC-WOMS-001 the Billing milestones block follows the Phase timeline on an active project', …)` asserting the
`pd-billing-milestones` heading comes after `pd-delivery` in document order (mock the block's hooks as in T2.4).
Verify: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/OverviewTab.test.tsx`.

### T2.7 Age on the WO card — RTL first (AC-WOMS-011 card) — 4 min
In `WorkOrdersTab.billing.test.tsx`: extend the `@/src/hooks/useWorkOrderBilling` mock (L45) to
`{ useWorkOrderBilling: () => h.billing, useWorkOrderAcceptanceAge: () => h.age }`, add `age` to `h`
(`{ data: [] }`) and reset it in `beforeEach`. New `describe('WorkOrdersTab — days since acceptance (#1640)')`:

```ts
it('AC-WOMS-011 an aged work order card shows days since acceptance with its source; others show none', () => {
  h.list.data = [wo(), wo({ id: 'wo-2', wo_number: 'WO-2' })];
  h.billing.data = [bill(), bill({ workOrderId: 'wo-2' })];
  h.age = { data: [{ workOrderId: 'wo-1', anchorDate: '2026-10-22', days: 10 }], isPending: false, isError: false, refetch: vi.fn() };
  renderTab();
  expect(within(screen.getByTestId('customer-order-wo-1')).getByText('Days since acceptance, not invoiced: 10')).toBeInTheDocument();
  expect(within(screen.getByTestId('customer-order-wo-2')).queryByText(/Days since acceptance/)).toBeNull();
});
```
Implementation in `WorkOrdersTab.tsx`: next to `const billing = useWorkOrderBilling(projectId, canViewBilling);`
(L288) add `const acceptanceAge = useWorkOrderAcceptanceAge(projectId, canViewBilling);` and
`const ageById = useMemo(() => new Map((acceptanceAge.data ?? []).map((a) => [a.workOrderId, a.days] as const)), [acceptanceAge.data]);`.
In the header row after the client-PO / order-date spans (after L885) add:

```tsx
{canViewBilling && ageById.has(row.id) && <Tooltip content={t('projectDetail.workOrders.acceptanceAgeSource', 'Counted from the earliest confirmed BAST not yet followed by a submitted invoice.')}>
  <span tabIndex={0} className="text-xs font-semibold text-warning-foreground">
    {t('projectDetail.workOrders.acceptanceAge', 'Days since acceptance, not invoiced: {{days}}', { days: ageById.get(row.id) })}
  </span>
</Tooltip>}
```
A failed age read shows nothing here (the billing figures and their error state are unchanged; the plan block owns
the age error state). Verify: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx`.

### T2.8 Still-to-invoice card — RTL first (AC-WOMS-010) — 3 min
`src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx`: add `daysSinceAcceptance: null` to both `DATA.rows`
entries (L20-21; typing only — every shipped AC-UNB-005 assertion is unchanged). New test with its own data:

```ts
it('AC-WOMS-010 a row shows days since acceptance, not invoiced, in place of days since closed; a row without one keeps days since closed', () => {
  h.state = { ...h.state, data: { ...DATA, rows: [
    { ...DATA.rows[1], workOrderId: 'wo-2', daysSinceClosed: 3, daysSinceAcceptance: 12 },
    { ...DATA.rows[1], workOrderId: 'wo-3', woNumber: 'WO-3', daysSinceClosed: 3, daysSinceAcceptance: null },
  ] } };
  renderCard();
  const rows = screen.getByTestId('still-to-invoice-rows');
  expect(within(rows).getByText(/Days since acceptance, not invoiced: 12/)).toBeInTheDocument();
  expect(within(rows).getAllByText(/Days since closed: 3/)).toHaveLength(1);
});
```
(add `within` to the `@testing-library/react` import). Implementation, `StillToInvoiceCard.tsx:103-105`:

```tsx
{row.daysSinceAcceptance !== null
  ? ` · ${t('dashboard.stillToInvoice.daysSinceAcceptance', { defaultValue: 'Days since acceptance, not invoiced: {{days}}', days: row.daysSinceAcceptance })}`
  : row.daysSinceClosed !== null
    ? ` · ${t('dashboard.stillToInvoice.daysSinceClosed', { defaultValue: 'Days since closed: {{days}}', days: row.daysSinceClosed })}`
    : ''}
```
Also add `daysSinceAcceptance` to fixtures in `StillToInvoiceCard.polish.test.tsx` and
`FinanceDashboard.actualAlignment.test.tsx` where `UnbilledWorkOrderRow` literals are typed (typecheck finds them).
Verify: `cd pmo-portal && npx vitest run src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx src/components/dashboard/__tests__/FinanceDashboard.actualAlignment.test.tsx`.

### T2.9 S2 local final gate + rendered proof — 5 min
`cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 src/lib/billingMilestones.ts src/lib/billingMilestones.test.ts pages/project-detail/BillingMilestonesBlock.tsx pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx pages/project-detail/ProjectSections.tsx pages/project-detail/tabs/WorkOrdersTab.tsx pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx src/components/dashboard/StillToInvoiceCard.tsx src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx`
then the touched test files (T2.1, T2.4, T2.6, T2.7, T2.8 commands), then
`scripts/ux-proof.sh /projects/40000000-0000-0000-0000-000000000013/overview /projects/40000000-0000-0000-0000-000000000013/contract /`
(seed project P013, `supabase/seed.sql:257`). `supabase/seed.sql` holds no work orders (grep `work_orders`: no hits),
so this capture proves the empty state; the populated states (Planned / In progress / Invoiced / Paid / Can't total,
an aged row) are rendered by inserting fixture rows with the service-role client exactly as T3.5's fixture does
(three Issued WOs + one Confirmed acceptance + one Unpaid and one Paid invoice on P013) before re-running the same
`ux-proof.sh` command, and deleting them after. Director's one rendered review (impeccable + taste, every state); owner judges screenshots.

---

## S3 — Invoice this (money-path entry; Director-dispatched; **ships alone**)

### T3.1 Hand-off test first (AC-WOMS-013) — 5 min
In `WorkOrdersTab.billing.test.tsx`, new `describe('WorkOrdersTab — Invoice this from the plan (#1640)')`. `renderTab`
already takes `initialEntry` and renders `RouteSearch` (L80-92).

```ts
it('AC-WOMS-013 ?invoice=1 opens the shipped invoice dialog for that work order with what is left, then clears the flag', async () => {
  h.list.data = [wo(), wo({ id: 'wo-2', wo_number: 'WO-2' })];
  h.billing.data = [bill(), bill({ workOrderId: 'wo-2', remaining: 40_000 })];
  renderTab('Finance', 'c-1', 'wo-2', '/?wo=wo-2&invoice=1', 'wo-2');
  expect(await screen.findByTestId('invoice-modal')).toHaveTextContent('wo-2|40000|c-1');
  await vi.waitFor(() => expect(screen.getByTestId('route-search')).toHaveTextContent('?wo=wo-2'));
});
it('AC-WOMS-013 a work order with contract lines opens the claim dialog with it preselected', …)
  // h.orderLines.data = [{ work_order_id: 'wo-2', boq_item_id: 'b1', quantity: 1 }] and projectBilling with a
  // contract line allocating wo-2, ERP connected (mock already returns connected) → ProgressClaimModal mock receives
  // initialWorkOrderId 'wo-2' (add a vi.mock of '../ProgressClaimModal' rendering `claim-modal|${initialWorkOrderId}`).
it('AC-WOMS-013 when the shipped gate refuses (no create permission, nothing left, route not ready, no client) nothing opens and the status is announced', …)
  // it.each over: role 'Project Manager'; remaining 0; h.routeReady=false; clientId null →
  // no 'invoice-modal', getByRole('status') has "This work order can't be invoiced from here right now.", flag cleared.
it('AC-WOMS-013 the dialog opens once: closing it does not reopen it', …)
it('AC-WOMS-013 it waits for the revenue route to sync: no refusal is announced while the route is still settling', …)
  // h.synced = false, h.routeReady = false → no modal, no status, flag kept; rerender with both true → modal opens.
  // Extend the useOwnershipCacheSync mock (L49) with `useOwnershipCacheSynced: () => h.synced` (h.synced = true in beforeEach).
```
`renderTab` gains a 5th param `autoInvoiceWorkOrderId: string | null = null` passed to the tab as
`autoInvoiceWorkOrderId`. RED: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx`.

### T3.2 Lift the gate into one function — 5 min
In `WorkOrdersTab.tsx`, move the per-row computations at L779-783 (`orderAllocations`, `rawLines`, `hasOrderLines`),
L788 (`billingRow`), L802-803 (`invoiceForOrder`, `canRaiseOrderInvoice`) and L817-822 (`raiseOrderInvoice`) into a
component-scope helper declared after `billingById` (L289-292):

```ts
/** The card's Raise invoice and the plan's Invoice this share ONE gate and ONE opener (#1640 D5). */
const orderInvoiceAction = (row: WorkOrderRow): (() => void) | null => {
  const orderAllocations = (projectBilling.data?.contractLines ?? []).some((line) => line.allocations.some((a) => a.workOrderId === row.id));
  const hasOrderLines = orderAllocations || (allocationsByWo.get(row.id) ?? []).length > 0;
  const billingRow = billingById.get(row.id);
  const invoiceable = billingRow && canInvoiceWorkOrder(row.status, billingRow);
  if (!((hasOrderLines ? canBill : canInvoice) && invoiceable && billingRow && billingRow.remaining > 0)) return null;
  return () => {
    setCreatedInvoice(null);
    if (hasOrderLines) setClaimFor(row);
    else setInvoiceFor({ row, remaining: billingRow.remaining });
  };
};
```
In the row map replace `canRaiseOrderInvoice` / `raiseOrderInvoice` with
`const raiseOrderInvoice = orderInvoiceAction(row); const canRaiseOrderInvoice = raiseOrderInvoice !== null;` and
call sites `onClick={raiseOrderInvoice ?? undefined}` (both the button, L888-892, and the menu item, L827). Keep
`orderAllocations`/`hasOrderLines` in the row map where the line table still needs the allocation objects.
Verify no behaviour change: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx pages/project-detail/__tests__/WorkOrdersTab.test.tsx pages/project-detail/__tests__/WorkOrdersTab.recordProgress.test.tsx`
→ every pre-existing test green (the new T3.1 tests still red).

### T3.3 One-shot hand-off — 4 min
`WorkOrdersTabProps` (L86) gains `autoInvoiceWorkOrderId?: string | null;` (destructure it beside `focusWorkOrderId`, L139). After the focus effect (L313-321):

```ts
// #1640 FR-WOMS-031..033: arriving from the plan's Invoice this. Wait until every input of the gate is read, act
// once, then drop `invoice` from the URL so reload/Back never reopens the dialog. `useRevenueRouteReady` is false
// until the ownership cache syncs (`useOwnershipCacheSync.ts:60-69`), so waiting on `revenueMode` alone would announce
// a false refusal on a fast arrival and spend the one shot.
const autoInvoiced = useRef(false);
const [autoInvoiceNote, setAutoInvoiceNote] = useState<string | null>(null);
const ownershipSynced = useOwnershipCacheSynced();
const gateReady = !isPending && !billing.isPending && !lines.isPending && !projectBilling.isPending
  && revenueMode !== undefined && ownershipSynced;
useEffect(() => {
  if (!autoInvoiceWorkOrderId || autoInvoiced.current || !gateReady) return;
  autoInvoiced.current = true;
  const row = rows.find((r) => r.id === autoInvoiceWorkOrderId);
  const open = row ? orderInvoiceAction(row) : null;
  if (open) open();
  else setAutoInvoiceNote(t('projectDetail.workOrders.cannotInvoiceHere', "This work order can't be invoiced from here right now."));
  const next = new URLSearchParams(searchParams);
  next.delete('invoice');
  setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on arrival; orderInvoiceAction reads current state.
}, [autoInvoiceWorkOrderId, gateReady, rows]);
```
(`isPending` is the work-order list's, L164; import `useOwnershipCacheSynced` beside `useRevenueRouteReady`. A WO id
not in the list gets the same refusal note.) Render `{autoInvoiceNote && <p role="status" className="text-sm text-muted-foreground">{autoInvoiceNote}</p>}` at the
top of the customer-orders section. `ProjectSections.tsx:126-130`: pass
`autoInvoiceWorkOrderId={new URLSearchParams(window.location.search).get('invoice') === '1' ? new URLSearchParams(window.location.search).get('wo') : null}`
(same source as `focusWorkOrderId` on L128).
GREEN: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx`.

### T3.4 Invoice this on the plan — test first (AC-WOMS-014 + action) — 4 min
`BillingMilestonesBlock.test.tsx` add:
`it('AC-WOMS-012 Invoice this links to the work order in Contract & billing with the invoice hand-off', …)` — Finance,
Issued wo-1 remaining 80,000 → `getByRole('link', { name: 'Invoice WO-1' })` has href
`/projects/p1/contract?wo=wo-1&invoice=1`; a Paid row and a Draft row have no such link. (AC-WOMS-014's PM case from
T2.4 now asserts the link is absent.)
Implementation: replace the S3 anchor comment in `BillingMilestonesBlock.tsx` with:

```tsx
{canCreate && b && canInvoiceWorkOrder(w.status, b) && (
  <Link to={`${contractHref}?wo=${encodeURIComponent(w.id)}&invoice=1`}
    aria-label={t('projectDetail.billingMilestones.invoiceThisLabel', 'Invoice {{order}}', { order: w.wo_number ?? w.title })}
    className="touch-target inline-flex items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
    {t('projectDetail.billingMilestones.invoiceThis', 'Invoice this')}
  </Link>
)}
```
with `const may = usePermission(); const canCreate = may('create', 'salesInvoice');` in `Body` and
`import { canInvoiceWorkOrder } from '@/src/lib/workOrderBilling';`. It is a link (navigation), styled with the same
tokens `Button variant="primary" size="sm"` uses — the builder copies the class list from
`src/components/ui/Button.tsx`'s `primary`/`sm` variants rather than the literal above if they differ.
Verify: `cd pmo-portal && npx vitest run pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx`.

### T3.5 Curated journey (AC-WOMS-012) — 5 min
Create `pmo-portal/e2e/AC-WOMS-012-invoice-from-plan.spec.ts`, self-isolated, modelled line-for-line on
`e2e/AC-S15-004-project-billing-context.spec.ts:1-10, 140-190, 249-275` (fixture creation with the service-role
client, native revenue mode, `page.route('**/api/resource/**', abort)`, cleanup in `finally` of only this run's rows):

```ts
// @e2e-isolation: self-isolated — creates a unique local client, project, and issued work order; deletes only rows linked to this run in finally.
// AC-WOMS-012 — the plan shows the client's work order as a billing milestone and "Invoice this" opens the shipped
// invoice-from-work-order flow; saving it moves the milestone to In progress. Goal oracle: a Draft linked to the WO.
test('AC-WOMS-012 Finance invoices a work order from the project plan', async ({ page }) => {
  // fixture: client company, Ongoing project (EUR, client_id), Issued WO value 1,000,000 excl., no contract lines.
  await signIn(page, 'finance@acme.test');
  await page.route('**/api/resource/**', (route) => route.abort());
  await page.goto('/projects/' + projectId + '/overview');
  const milestone = page.getByTestId('billing-milestone-' + workOrderId);
  await expect(milestone.getByText(localized('Planned', 'Direncanakan'))).toBeVisible();
  await milestone.getByRole('link', { name: localized('Invoice ' + workOrderNumber, 'Tagih ' + workOrderNumber) }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/projects/${projectId}/contract` && url.searchParams.get('wo') === workOrderId && !url.searchParams.has('invoice'));
  const form = page.getByRole('dialog');
  await expect(form.getByRole('heading', { name: localized('Invoice this work order', 'Tagih Work Order ini') })).toBeVisible();
  await form.getByLabel(/amount \(excl\. PPN\)|jumlah \(belum termasuk PPN\)/i).fill('250000');
  await form.getByRole('button', { name: /create draft invoice|buat draf faktur/i }).click();
  await expect(form).toBeHidden();
  const saved = await admin.from('sales_invoices').select('work_order_id,status,amount').eq('work_order_id', workOrderId).single();
  expect(saved.data).toMatchObject({ work_order_id: workOrderId, status: 'Draft' });
  expect(Number(saved.data?.amount)).toBe(250000);
  await page.goto('/projects/' + projectId + '/overview');
  await expect(page.getByTestId('billing-milestone-' + workOrderId).getByText(localized('In progress', 'Berjalan'))).toBeVisible();
});
```
(`localized`, `admin`, the ids, `signIn` and the `finally` cleanup are the AC-S15-004 helpers, copied.)
Verify: `scripts/e2e-local.sh AC-WOMS-012` (once; CI's `integration` job on the release PR to `main` is the proof).

### T3.6 Mutation check (security-critical gate) — 3 min
Temporarily change `orderInvoiceAction` to return the opener unconditionally (`if (false) return null;`). Run
`cd pmo-portal && npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` → the AC-WOMS-013
"gate refuses" cases and the shipped role/remaining cases MUST go red. Revert; re-run green. Record both outputs in
the PR body.

### T3.7 S3 local final gate — 3 min
`cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 pages/project-detail/tabs/WorkOrdersTab.tsx pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx pages/project-detail/BillingMilestonesBlock.tsx pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx pages/project-detail/ProjectSections.tsx e2e/AC-WOMS-012-invoice-from-plan.spec.ts`
+ T3.2's three test files + `scripts/ux-proof.sh` on `/projects/<id>/overview` and `/projects/<id>/contract`.
Reviewers: spec-reviewer, code-quality-reviewer, security-auditor (confirms: no new write path, gate shared, URL
flag cannot open a dialog the button would not). Ships alone to `dev`.

---

## Traceability

| AC | Owning layer | File | Test title (leading token) |
|---|---|---|---|
| AC-WOMS-001 | Vitest/RTL | `pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx` | `AC-WOMS-001 lists each non-cancelled work order once…` |
| AC-WOMS-002 | Vitest/RTL | `pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx` | `AC-WOMS-002 rows follow the milestone date…` (pure sort in `billingMilestones.test.ts` references) |
| AC-WOMS-003 | Vitest (pure) | `src/lib/billingMilestones.test.ts` | `AC-WOMS-003 <case>` (9 cases) |
| AC-WOMS-004 | pgTAP | `supabase/tests/0441_work_order_milestones.test.sql` | tests 1-2 (payment → Paid itself: shipped `AC-NAR-003`, `0275_native_revenue_receipts.test.sql`) |
| AC-WOMS-005 | pgTAP | same | tests 3-4, 12 (time zone) |
| AC-WOMS-006 | pgTAP | same | tests 5-6 |
| AC-WOMS-007 | pgTAP | same | test 7 |
| AC-WOMS-008 | pgTAP | same | tests 8, 12-14 |
| AC-WOMS-009 | pgTAP | same | tests 9-11 (DAL parse: `workOrderBilling.test.ts` references) |
| AC-WOMS-010 | Vitest/RTL | `src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx` | `AC-WOMS-010 a row shows days since acceptance…` |
| AC-WOMS-011 | Vitest/RTL | `pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` | `AC-WOMS-011 an aged work order card shows…` (plan row referenced in BillingMilestonesBlock test) |
| AC-WOMS-012 | Playwright | `e2e/AC-WOMS-012-invoice-from-plan.spec.ts` | `AC-WOMS-012 Finance invoices a work order from the project plan` |
| AC-WOMS-013 | Vitest/RTL | `pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` | `AC-WOMS-013 …` (5 tests) |
| AC-WOMS-014 | Vitest/RTL | `pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx` | `AC-WOMS-014 a PM sees status and value but no Invoice this` |
| AC-WOMS-015 | Vitest/RTL | same | `AC-WOMS-015 a pending or failed read…`, `AC-WOMS-015 no work orders…` |

## Discover graduation (S2, UI lane)
Rendered checks the Director's review must cover on rich seed: a long WO title at 390px wraps without horizontal
scroll; a project with 20+ work orders stays one list (no nested scroll); a Can't total row shows its value but no
billing status beyond the pill; id copy fits the status pills; the Still-to-invoice row's sub-line is `truncate`
(`StillToInvoiceCard.tsx:98`), so the longer acceptance-age text must stay readable at 390px (wrap it or move it to
its own line). Each finding graduates to a test + a `routes × oracles` cell
(`/projects/:id/overview` × billing-milestones) + a `docs/decisions.md` note.

## Open questions for the Director
None beyond the spec's OQ-WOMS-1..8 (owner). If the owner flips OQ-WOMS-1 to a delivery-based "In progress", only
`deriveBillingMilestoneStatus` and its table change (it would also take the acceptance list as input); if OQ-WOMS-3
flips to the literal rule, only the view's lateral subquery changes (drop the `acceptance_date >` predicate and
require no submitted invoice at all).
