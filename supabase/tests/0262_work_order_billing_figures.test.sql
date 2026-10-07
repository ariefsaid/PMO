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
