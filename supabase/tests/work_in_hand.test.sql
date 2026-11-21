-- work_in_hand.test.sql — #2575 (migration 1148): get_work_in_hand, the read-only inputs to Left to bill and months of backlog.
-- Owns AC-WIH-009..016 and 018 (spec docs/specs/work-in-hand-backlog.spec.md). The rate and backlog arithmetic is owned by
-- the unit test pmo-portal/src/lib/workInHand.test.ts (AC-WIH-001..008); this file proves the rows it is fed.
-- Cast: FIN a1 Finance · ADM a2 Admin · EXE a3 Executive · PM a4 · ENG a5 · OFF a6 Finance, disabled · XORG b1 Finance, org B.
begin;
create extension if not exists pgtap;
select plan(47);

insert into organizations (id, name, default_currency, default_timezone) values
  ('10600000-0000-0000-0000-000000000001', 'WIH Org', 'IDR', 'Asia/Jakarta'),
  ('10600000-0000-0000-0000-000000000002', 'WIH Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('10600000-0000-0000-0000-0000000000a1', 'wih-fin@example.com'),
  ('10600000-0000-0000-0000-0000000000a2', 'wih-adm@example.com'),
  ('10600000-0000-0000-0000-0000000000a3', 'wih-exe@example.com'),
  ('10600000-0000-0000-0000-0000000000a4', 'wih-pm@example.com'),
  ('10600000-0000-0000-0000-0000000000a5', 'wih-eng@example.com'),
  ('10600000-0000-0000-0000-0000000000a6', 'wih-off@example.com'),
  ('10600000-0000-0000-0000-0000000000b1', 'wih-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('10600000-0000-0000-0000-0000000000a1', '10600000-0000-0000-0000-000000000001', 'WIH Fin', 'wih-fin@example.com', 'Finance', 'active'),
  ('10600000-0000-0000-0000-0000000000a2', '10600000-0000-0000-0000-000000000001', 'WIH Adm', 'wih-adm@example.com', 'Admin', 'active'),
  ('10600000-0000-0000-0000-0000000000a3', '10600000-0000-0000-0000-000000000001', 'WIH Exe', 'wih-exe@example.com', 'Executive', 'active'),
  ('10600000-0000-0000-0000-0000000000a4', '10600000-0000-0000-0000-000000000001', 'WIH PM', 'wih-pm@example.com', 'Project Manager', 'active'),
  ('10600000-0000-0000-0000-0000000000a5', '10600000-0000-0000-0000-000000000001', 'WIH Eng', 'wih-eng@example.com', 'Engineer', 'active'),
  ('10600000-0000-0000-0000-0000000000a6', '10600000-0000-0000-0000-000000000001', 'WIH Off', 'wih-off@example.com', 'Finance', 'disabled'),
  ('10600000-0000-0000-0000-0000000000b1', '10600000-0000-0000-0000-000000000002', 'WIH XOrg', 'wih-xorg@example.com', 'Finance', 'active');

-- P1 the hand-calculation contract (net 1,200,000 = 1,332,000 inclusive less 132,000). P2 foreign-currency invoice. P3 invoice of unknown
-- amount. P4 undated invoice only. P5 value 0. P6 archived. P7 a Lead. P8 contract with work orders. P9 work order with an unpriced invoice.
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, archived_at) values
  ('10600000-0000-0000-0000-0000000000c1', '10600000-0000-0000-0000-000000000001', 'WIH P1', 'Ongoing Project', 1332000, 'inclusive', 132000, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000c2', '10600000-0000-0000-0000-000000000001', 'WIH P2', 'Ongoing Project', 500000, 'exclusive', 0, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000c3', '10600000-0000-0000-0000-000000000001', 'WIH P3', 'On Hold', 400000, 'exclusive', 0, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000c4', '10600000-0000-0000-0000-000000000001', 'WIH P4', 'Close Out', 300000, 'exclusive', 0, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000c5', '10600000-0000-0000-0000-000000000001', 'WIH P5', 'Ongoing Project', 0, null, null, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000c6', '10600000-0000-0000-0000-000000000001', 'WIH P6', 'Ongoing Project', 100000, 'exclusive', 0, 'IDR', now()),
  ('10600000-0000-0000-0000-0000000000c7', '10600000-0000-0000-0000-000000000001', 'WIH P7', 'Leads', 100000, 'exclusive', 0, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000c8', '10600000-0000-0000-0000-000000000001', 'WIH P8', 'Ongoing Project', 2000000, 'exclusive', 0, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000c9', '10600000-0000-0000-0000-000000000001', 'WIH P9', 'Won, Pending KoM', 800000, 'exclusive', 0, 'IDR', null),
  ('10600000-0000-0000-0000-0000000000d9', '10600000-0000-0000-0000-000000000002', 'WIH OtherOrg P', 'Ongoing Project', 777777, 'exclusive', 0, 'IDR', null);

insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount) values
  ('10600000-0000-0000-0000-0000000000e1', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c8', 'W1 issued', 'Issued', 'WIH-1', 555000, 'inclusive', 55000),
  ('10600000-0000-0000-0000-0000000000e2', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c8', 'W2 draft', 'Draft', 'WIH-2', 100000, 'exclusive', 0),
  ('10600000-0000-0000-0000-0000000000e4', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c9', 'W4 issued unpriced', 'Issued', 'WIH-4', 300000, 'exclusive', 0);
-- W3: a Closed work order carrying a stamped closing value. The closing guard and the acceptance FK are bypassed for the fixture only.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency, closing_value, closing_acceptance_id, closed_at) values
  ('10600000-0000-0000-0000-0000000000e3', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c8', 'W3 closed', 'Closed', 'WIH-3', 500000, 'exclusive', 0, 'IDR', 400000, '10600000-0000-0000-0000-0000000000f3', now());
set local session_replication_role = origin;

-- Down-payment claim (its invoice reuses the claim id; billed work of a down payment is 0).
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, down_payment_amount,
                             recovery_pct, dp_recovery_amount, dp_item_code, created_by) values
  ('10600000-0000-0000-0000-0000000005d1', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null,
   'down_payment', 'IDR', 500000, 500000, 10, 0, 'DP-ITEM', '10600000-0000-0000-0000-0000000000a1');

-- The ERP copy that the PMO copy pairs with (no project, so it is not billed work of any contract here).
insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('10600000-0000-0000-0000-0000000005e0', '10600000-0000-0000-0000-000000000001', null, '2026-10-20', 70000, 'exclusive', 0, 'IDR', 'Unpaid');
insert into sales_invoices (id, org_id, project_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status,
                            paired_erp_invoice_id, paired_at, paired_by, paired_filled) values
  -- P1: the hand-calculation fixture.
  ('10600000-0000-0000-0000-0000000005a1', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-09-15', 100000, 'exclusive', 0, 'IDR', 'Paid', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005a2', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-10-10', 166500, 'inclusive', 16500, 'IDR', 'Unpaid', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005a3', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-11-30', 50000, 'exclusive', 0, 'IDR', 'Submitted', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005a4', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-12-03', 40000, 'exclusive', 0, 'IDR', 'Submitted', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005d1', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-10-02', 500000, 'exclusive', 0, 'IDR', 'Unpaid', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005a5', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-11-05', 80000, 'exclusive', 0, 'IDR', 'Draft', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005a6', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-11-06', 90000, 'exclusive', 0, 'IDR', 'Cancelled', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005a7', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c1', null, '2026-10-20', 70000, 'exclusive', 0, 'IDR', 'Unpaid',
   '10600000-0000-0000-0000-0000000005e0', now(), '10600000-0000-0000-0000-0000000000a1', '{}'::jsonb),
  -- P2: a valued invoice in another currency.
  ('10600000-0000-0000-0000-0000000005b1', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c2', null, '2026-10-10', 1000, 'exclusive', 0, 'USD', 'Unpaid', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005b2', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c2', null, '2026-10-12', 20000, 'exclusive', 0, 'IDR', 'Unpaid', null, null, null, null),
  -- P3: an invoice of unknown amount.
  ('10600000-0000-0000-0000-0000000005c1', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c3', null, '2026-11-10', null, 'exclusive', 0, 'IDR', 'Unpaid', null, null, null, null),
  -- P4: an undated invoice only.
  ('10600000-0000-0000-0000-0000000005c2', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c4', null, null, 10000, 'exclusive', 0, 'IDR', 'Unpaid', null, null, null, null),
  -- P8 and its work order W1.
  ('10600000-0000-0000-0000-0000000005f1', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c8', '10600000-0000-0000-0000-0000000000e1', '2026-10-05', 100000, 'exclusive', 0, 'IDR', 'Paid', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005f2', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c8', '10600000-0000-0000-0000-0000000000e1', '2026-11-05', 50000, 'exclusive', 0, 'IDR', 'Unpaid', null, null, null, null),
  ('10600000-0000-0000-0000-0000000005f3', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c8', null, '2026-11-08', 30000, 'exclusive', 0, 'IDR', 'Unpaid', null, null, null, null),
  -- P9: W4 carries an invoice with no amount.
  ('10600000-0000-0000-0000-0000000005f4', '10600000-0000-0000-0000-000000000001', '10600000-0000-0000-0000-0000000000c9', '10600000-0000-0000-0000-0000000000e4', '2026-11-12', null, 'exclusive', 0, 'IDR', 'Unpaid', null, null, null, null);

-- Reads run as the caller; the result is kept in a table readable by every role used below.
create temp table wih_r (k text primary key, j jsonb);
grant all on wih_r to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10600000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into wih_r values ('fin', public.get_work_in_hand('2026-12-10'));
insert into wih_r values ('fin_default', public.get_work_in_hand());
select is((select count(*)::int from wih_r), 2, 'AC-WIH-013 a Finance caller is served');                                                           -- 1

-- ── AC-WIH-009: figures equal the hand calculation and the existing billing reads ────────────────────────────────────
create temp view c1 as select c from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'project_id' = '10600000-0000-0000-0000-0000000000c1';
grant select on c1 to authenticated;
select is((select c->>'contract_net' from c1), '1200000.00', 'AC-WIH-009 contract value is net of the inclusive tax');                                   -- 2
select is((select c->>'billed_to_date' from c1), '340000.00',
  'AC-WIH-009 billed to date = 100,000 + 150,000 + 50,000 + 40,000; down payment, Draft, Cancelled and the paired PMO copy count nothing');        -- 3
select is((select c->>'first_billing_month' from c1), '2026-09-01', 'AC-WIH-009 the first billing month is September');                                  -- 4
select is((select c->'window_months' from c1), '[{"month":"2026-09-01","billed":"100000.00"},{"month":"2026-10-01","billed":"150000.00"},{"month":"2026-11-01","billed":"50000.00"}]'::jsonb,
  'AC-WIH-009 the window months are the three billed months; December (the partial month) is outside the window');                                 -- 5
select is((select c->>'billed_to_date' from c1)::numeric, (public.get_project_billing('10600000-0000-0000-0000-0000000000c1')->>'work_billed')::numeric,
  'AC-WIH-009 billed to date equals get_project_billing.work_billed for the same project');                                                          -- 6
select is((select (c->>'contract_net')::numeric - (c->>'billed_to_date')::numeric from c1),
          (public.get_project_billing('10600000-0000-0000-0000-0000000000c1')->>'contract_net')::numeric
            - (public.get_project_billing('10600000-0000-0000-0000-0000000000c1')->>'work_billed')::numeric,
  'AC-WIH-009 Left to bill = the contract net less invoiced work, the figure the management pack shows (860,000)');                                  -- 7
select is((select c->>'incomplete' from c1), 'false', 'AC-WIH-009 a clean contract is not marked incomplete');                                          -- 8

-- ── set of contracts and the on-hand rule ───────────────────────────────────────────────────────────────────────────
select set_eq(
  $$ select c->>'name' from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' $$,
  $$ values ('WIH P1'), ('WIH P2'), ('WIH P3'), ('WIH P4'), ('WIH P8'), ('WIH P9') $$,
  'AC-WIH-009 the valued Contract on hand set: an archived project, a Lead, another organisation and a zero-value contract are not ranked'); -- 9
select is((select c->>'status' from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P3'), 'On Hold',
  'AC-WIH-009 the status is returned so On Hold reads as such');                                                                                    -- 10

-- ── AC-WIH-010 work orders ──────────────────────────────────────────────────────────────────────────────────────────
select set_eq(
  $$ select w->>'wo_number' from wih_r, jsonb_array_elements(j->'work_orders') w where k = 'fin' $$,
  $$ values ('WIH-1'), ('WIH-4') $$,
  'AC-WIH-010 only Issued work orders are in work in hand: the Draft and the Closed one are absent');                                                -- 11
select is((select w->>'order_net' from wih_r, jsonb_array_elements(j->'work_orders') w where k = 'fin' and w->>'wo_number' = 'WIH-1'),
          (select order_net::text from work_order_billing where wo_number = 'WIH-1'),
  'AC-WIH-010 the work-order value equals work_order_billing.order_net (500,000 = 555,000 less 55,000 tax)');                                         -- 12
select is((select w->>'order_net' from wih_r, jsonb_array_elements(j->'work_orders') w where k = 'fin' and w->>'wo_number' = 'WIH-1'), '500000.00',
  'AC-WIH-010 the inclusive-tax work order is stated net of tax');                                                                                  -- 13
select is((select w->>'billed_to_date' from wih_r, jsonb_array_elements(j->'work_orders') w where k = 'fin' and w->>'wo_number' = 'WIH-1'), '150000.00',
  'AC-WIH-010 the work order is billed only by the invoices that name it');                                                                         -- 14
select is((select w->>'incomplete' from wih_r, jsonb_array_elements(j->'work_orders') w where k = 'fin' and w->>'wo_number' = 'WIH-1'), 'false',
  'AC-WIH-010 a complete work order honours work_order_billing.figures_complete = true');                                                          -- 15
select is((select w->>'incomplete' from wih_r, jsonb_array_elements(j->'work_orders') w where k = 'fin' and w->>'wo_number' = 'WIH-4'), 'true',
  'AC-WIH-010 a work order with an invoice of no amount honours figures_complete = false');                                                        -- 16
select ok((select w->>'billed_to_date' is null and w->'window_months' = '[]'::jsonb from wih_r, jsonb_array_elements(j->'work_orders') w
            where k = 'fin' and w->>'wo_number' = 'WIH-4'),
  'AC-WIH-010 an incomplete work order carries no figure to show');                                                                                 -- 17
select is((select count(*)::int from wih_r, jsonb_array_elements(j->'work_orders') w where k = 'fin' and w->>'order_net' = '400000.00'), 0,
  'AC-WIH-010 the Closed work order''s stamped closing value (400,000) appears in no row');                                                         -- 18
select is((select c->>'billed_to_date' from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P8'), '180000.00',
  'AC-WIH-010 the contract is billed by every invoice on it, work-order and plain: 100,000 + 50,000 + 30,000');                                    -- 19

-- ── AC-WIH-011 foreign currency ─────────────────────────────────────────────────────────────────────────────────────
select is((select c->>'incomplete' from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P2'), 'true',
  'AC-WIH-011 a valued invoice in another currency makes the contract figure incomplete');                                                         -- 20
select is((select (c->>'foreign_currency_invoice_count')::int from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P2'), 1,
  'AC-WIH-011 the row counts the excluded invoices');                                                                                               -- 21
select ok((select c->>'billed_to_date' is null and c->>'first_billing_month' is null and c->'window_months' = '[]'::jsonb
             from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P2'),
  'AC-WIH-011 no billed-to-date, month or first-billing figure leaves the database for an incomplete contract');                                    -- 22

-- ── AC-WIH-012 organisation-local dates ─────────────────────────────────────────────────────────────────────────────
select is((select j->>'as_of' from wih_r where k = 'fin_default'), ((now() at time zone 'Asia/Jakarta')::date)::text,
  'AC-WIH-012 the default as-of date is today in the organisation timezone, not UTC');                                                              -- 23
select is((select j->>'timezone' from wih_r where k = 'fin'), 'Asia/Jakarta', 'AC-WIH-012 the organisation timezone is returned');                      -- 24
select is((select c->'window_months' ->> 2 from c1), '{"month": "2026-11-01", "billed": "50000.00"}',
  'AC-WIH-012 an invoice dated 30 November (last day of the month, in an organisation ahead of UTC) falls in November');                           -- 25
select is((select j->>'window_from' || ' ' || (j->>'window_to') from wih_r where k = 'fin'), '2026-06-01 2026-11-01',
  'AC-WIH-012 the window is the 6 complete months before the as-of month');                                                                        -- 26

-- ── AC-WIH-015 no value ─────────────────────────────────────────────────────────────────────────────────────────────
select is((select jsonb_array_length(j->'no_value') from wih_r where k = 'fin'), 1, 'AC-WIH-015 one contract has no value');                              -- 27
select is((select j->'no_value'->0->>'name' from wih_r where k = 'fin'), 'WIH P5', 'AC-WIH-015 the zero-value contract is in the no-value list');       -- 28
select is((select count(*)::int from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P5'), 0,
  'AC-WIH-015 and in no ranking row');                                                                                                              -- 29

-- ── AC-WIH-018 undated and unpriced ─────────────────────────────────────────────────────────────────────────────────
select is((select (j->>'undated_invoice_count')::int from wih_r where k = 'fin'), 1,
  'AC-WIH-018 the undated invoice is counted once (as the management pack counts it)');                                                           -- 30
select is((select c->>'billed_to_date' from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P4'), '0.00',
  'AC-WIH-018 the undated invoice is in no billed-to-date figure');                                                                                -- 31
select is((select c->'window_months' from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P4'), '[]'::jsonb,
  'AC-WIH-018 and in no window month');                                                                                                             -- 32
select ok((select (c->>'incomplete')::boolean and (c->>'unpriced_invoice_count')::int = 1 and c->>'billed_to_date' is null
             from wih_r, jsonb_array_elements(j->'contracts') c where k = 'fin' and c->>'name' = 'WIH P3'),
  'AC-WIH-018 a contract whose only invoice has no amount is incomplete, counts it and carries no figure');                                       -- 33

-- ── AC-WIH-016 bounds ───────────────────────────────────────────────────────────────────────────────────────────────
select is((select j->>'truncated' from wih_r where k = 'fin'), 'false', 'AC-WIH-016 within the row bounds the flag is false');                          -- 34

-- ── AC-WIH-013 access ───────────────────────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"10600000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.get_work_in_hand('2026-12-10') $$, 'AC-WIH-013 an Admin is served');                                                     -- 35
set local request.jwt.claims = '{"sub":"10600000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select public.get_work_in_hand('2026-12-10') $$, 'AC-WIH-013 an Executive is served');                                                 -- 36
set local request.jwt.claims = '{"sub":"10600000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.get_work_in_hand('2026-12-10') $$, '42501', 'not authorized',
  'AC-WIH-013 a Project Manager is refused (this gate is narrower than get_project_finances)');                                                    -- 37
set local request.jwt.claims = '{"sub":"10600000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.get_work_in_hand('2026-12-10') $$, '42501', 'not authorized', 'AC-WIH-013 an Engineer is refused');                    -- 38
set local request.jwt.claims = '{"sub":"10600000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select public.get_work_in_hand('2026-12-10') $$, '42501', 'your account is not an active member of this organisation',
  'AC-WIH-013 an offboarded account is refused');                                                                                                  -- 39
reset role;
select is(has_function_privilege('anon', 'public.get_work_in_hand(date)', 'execute'), false, 'AC-WIH-013 anon cannot execute the read');               -- 40
select is(has_function_privilege('authenticated', 'public.get_work_in_hand(date)', 'execute'), true, 'AC-WIH-013 authenticated can');                  -- 41
select is((select prosecdef from pg_proc where oid = 'public.get_work_in_hand(date)'::regprocedure), false, 'AC-WIH-014 the read is security invoker'); -- 42

-- ── AC-WIH-014 tenancy ──────────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"10600000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into wih_r values ('xorg', public.get_work_in_hand('2026-12-10'));
select is((select jsonb_array_length(j->'contracts') from wih_r where k = 'xorg'), 1, 'AC-WIH-014 another organisation sees only its own contract');       -- 43
select is((select j->'contracts'->0->>'name' from wih_r where k = 'xorg'), 'WIH OtherOrg P', 'AC-WIH-014 and it is its own');                              -- 44
select is((select jsonb_array_length(j->'work_orders') from wih_r where k = 'xorg'), 0, 'AC-WIH-014 none of the first organisation''s work orders appear');  -- 45
select is((select (j->>'undated_invoice_count')::int from wih_r where k = 'xorg'), 0, 'AC-WIH-014 nor its undated invoices');                                -- 46
reset role;
select is((select count(*)::int from wih_r, jsonb_array_elements(j->'contracts') c where k = 'xorg' and c->>'name' like 'WIH P%'), 0,
  'AC-WIH-014 no first-organisation contract is in the other organisation''s result');                                                              -- 47

select * from finish();
rollback;
