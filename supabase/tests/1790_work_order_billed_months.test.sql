-- 1790_work_order_billed_months.test.sql: AC-BPM-001..006 — get_work_order_billed_months and the ONE shared calculation
-- (work_order_billed_months_core) that get_work_in_hand also reads. Cast: FIN a1 Finance · PM a2 · ENG a3 · XORG b1 Finance, org B.
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name, default_currency, default_timezone) values
  ('17900000-0000-0000-0000-000000000001', 'BPM Org', 'IDR', 'Asia/Jakarta'),
  ('17900000-0000-0000-0000-000000000002', 'BPM Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('17900000-0000-0000-0000-0000000000a1', 'bpm-fin@example.com'), ('17900000-0000-0000-0000-0000000000a2', 'bpm-pm@example.com'),
  ('17900000-0000-0000-0000-0000000000a3', 'bpm-eng@example.com'), ('17900000-0000-0000-0000-0000000000b1', 'bpm-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17900000-0000-0000-0000-0000000000a1', '17900000-0000-0000-0000-000000000001', 'BPM Fin', 'bpm-fin@example.com', 'Finance', 'active'),
  ('17900000-0000-0000-0000-0000000000a2', '17900000-0000-0000-0000-000000000001', 'BPM PM', 'bpm-pm@example.com', 'Project Manager', 'active'),
  ('17900000-0000-0000-0000-0000000000a3', '17900000-0000-0000-0000-000000000001', 'BPM Eng', 'bpm-eng@example.com', 'Engineer', 'active'),
  ('17900000-0000-0000-0000-0000000000b1', '17900000-0000-0000-0000-000000000002', 'BPM XOrg', 'bpm-xorg@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-000000000001', 'BPM Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, client_id) values
  ('17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-000000000001', 'BPM Project', 'Ongoing Project', 2000000, 'exclusive', 0, 'IDR', '17900000-0000-0000-0000-0000000000f1');
-- The Project Manager manages it: a Project Manager reads money for their own projects (DD-R1125-14).
update projects set project_manager_id = '17900000-0000-0000-0000-0000000000a2' where id = '17900000-0000-0000-0000-0000000000c1';
-- d1 Issued with billing in three months; d2 Closed (any status) with one invoice; d3 Issued with nothing; d4 Issued with a foreign-currency invoice.
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount) values
  ('17900000-0000-0000-0000-0000000000d1', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', 'Survey', 'Issued', 'BPM-1', 800000, 'exclusive', 0),
  ('17900000-0000-0000-0000-0000000000d3', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', 'Idle', 'Issued', 'BPM-3', 100000, 'exclusive', 0),
  ('17900000-0000-0000-0000-0000000000d4', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', 'Foreign', 'Issued', 'BPM-4', 100000, 'exclusive', 0);
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, down_payment_amount,
                             recovery_pct, dp_recovery_amount, dp_item_code, created_by) values
  ('17900000-0000-0000-0000-0000000005d1', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000d1',
   'down_payment', 'IDR', 300000, 300000, 10, 0, 'DP-ITEM', '17900000-0000-0000-0000-0000000000a1');
insert into sales_invoices (id, org_id, project_id, customer_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('17900000-0000-0000-0000-0000000005a1', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', '2026-09-15', 100000, 'exclusive', 0, 'IDR', 'Paid'),
  ('17900000-0000-0000-0000-0000000005a2', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', '2026-10-10', 166500, 'inclusive', 16500, 'IDR', 'Unpaid'),
  ('17900000-0000-0000-0000-0000000005a3', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', '2026-12-03', 40000, 'exclusive', 0, 'IDR', 'Submitted'),
  ('17900000-0000-0000-0000-0000000005a4', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', '2026-11-05', 80000, 'exclusive', 0, 'IDR', 'Draft'),
  ('17900000-0000-0000-0000-0000000005a5', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', '2026-11-06', 90000, 'exclusive', 0, 'IDR', 'Cancelled'),
  ('17900000-0000-0000-0000-0000000005a6', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', null, 7000, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('17900000-0000-0000-0000-0000000005a7', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', '2027-01-04', 55000, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('17900000-0000-0000-0000-0000000005d1', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d1', '2026-10-02', 300000, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('17900000-0000-0000-0000-0000000005b1', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d4', '2026-10-10', 1000, 'exclusive', 0, 'USD', 'Unpaid');
-- d2: a Closed work order (guards bypassed for the fixture only) with one invoice.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency, closed_at) values
  ('17900000-0000-0000-0000-0000000000d2', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', 'Closed', 'Closed', 'BPM-2', 100000, 'exclusive', 0, 'IDR', now());
set local session_replication_role = origin;
insert into sales_invoices (id, org_id, project_id, customer_id, work_order_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('17900000-0000-0000-0000-0000000005c1', '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-0000000000c1', '17900000-0000-0000-0000-0000000000f1', '17900000-0000-0000-0000-0000000000d2', '2026-11-20', 25000, 'exclusive', 0, 'IDR', 'Submitted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"17900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- d1 as of 2026-12-05: Sep 100,000 · Oct 150,000 (166,500 incl. 16,500) · Nov 0 · Dec 40,000 to date.
-- Out: the Draft, the Cancelled, the undated one, the January one (after the as-of month), the down payment.
select is((select jsonb_array_length(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months')), 4,
  'AC-BPM-001 every month from the first billed month through the current month, gaps included');                                -- 1
select is((select string_agg((m->>'month') || '=' || (m->>'billed')::numeric::text, ' ' order by m->>'month')
             from jsonb_array_elements(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months') m),
  '2026-09-01=100000.00 2026-10-01=150000.00 2026-11-01=0.00 2026-12-01=40000.00',
  'AC-BPM-002 submitted invoices only, excl. tax; the draft, cancelled, undated and later-month invoices and the down payment count nothing'); -- 2
select is((get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months'->3->>'to_date')::boolean, true,
  'AC-BPM-002 the current month is marked to date');                                                                              -- 3
select is((get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months'->2->>'to_date')::boolean, false,
  'AC-BPM-002 a past month is not');                                                                                              -- 4
select is(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d2', '2026-12-05')->'months'->0->>'billed', '25000.00',
  'AC-BPM-003 a Closed work order reads too (any status)');                                                                       -- 5
select is(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d3', '2026-12-05')->'months', '[]'::jsonb,
  'AC-BPM-003 nothing billed gives no months, not a zero month');                                                                 -- 6
select is((get_work_order_billed_months('17900000-0000-0000-0000-0000000000d4', '2026-12-05')->>'incomplete')::boolean, true,
  'AC-BPM-003 a work order that cannot be totalled in its own currency says so');                                                 -- 7
select is(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d4', '2026-12-05')->'months', '[]'::jsonb,
  'AC-BPM-003 …and returns no figures (as get_work_in_hand)');                                                                    -- 8
-- Org time zone: 2026-12-05 is the as-of date given; without it, "today" is the organisation's calendar date.
select is(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1')->>'timezone', 'Asia/Jakarta',
  'AC-BPM-003 the organisation''s time zone decides the month boundaries');                                                       -- 9
-- AC-BPM-004: the same figures as get_work_in_hand's window for the same work order and month.
select is((select (m->>'billed')::numeric from jsonb_array_elements(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months') m where m->>'month' = '2026-10-01'),
          (select (w->>'billed')::numeric from jsonb_array_elements((select o->'window_months' from jsonb_array_elements(get_work_in_hand('2026-12-05')->'work_orders') o
                                                                       where o->>'work_order_id' = '17900000-0000-0000-0000-0000000000d1')) w where w->>'month' = '2026-10-01'),
  'AC-BPM-004 October equals get_work_in_hand''s window figure for the same work order');                                         -- 10
select is((select (m->>'billed')::numeric from jsonb_array_elements(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months') m where m->>'month' = '2026-09-01'),
          (select (w->>'billed')::numeric from jsonb_array_elements((select o->'window_months' from jsonb_array_elements(get_work_in_hand('2026-12-05')->'work_orders') o
                                                                       where o->>'work_order_id' = '17900000-0000-0000-0000-0000000000d1')) w where w->>'month' = '2026-09-01'),
  'AC-BPM-004 September equals it too');                                                                                          -- 11
select is((select sum((m->>'billed')::numeric) from jsonb_array_elements(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months') m),
          (select (o->>'billed_to_date')::numeric from jsonb_array_elements(get_work_in_hand('2026-12-05')->'work_orders') o where o->>'work_order_id' = '17900000-0000-0000-0000-0000000000d1'),
  'AC-BPM-004 the months add up to get_work_in_hand''s billed to date for the work order');                                        -- 12
reset role;

-- AC-BPM-005 roles. Project Manager reads (RLS on invoices is organisation-wide for the four roles); Engineer is refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"17900000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(jsonb_array_length(get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05')->'months'), 4,
  'AC-BPM-005 a Project Manager reads, as the totals on the same page');                                                          -- 13
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"17900000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05') $$, '42501', null,
  'AC-BPM-005 an Engineer is refused');                                                                                           -- 14
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"17900000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05') $$, 'P0002', null,
  'AC-BPM-005 another organisation''s user finds no such work order');                                                            -- 15
reset role;
set local request.jwt.claims = '{}';   -- the previous caller's claims outlive `reset role`; a true no-sign-in has none
select throws_ok($$ select get_work_order_billed_months('17900000-0000-0000-0000-0000000000d1', '2026-12-05') $$, '42501', null,
  'AC-BPM-005 with no sign-in there is no organisation, so it is refused');                                                       -- 16
select ok(not has_function_privilege('anon', 'public.get_work_order_billed_months(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'public.work_order_billed_months_core(uuid[], date)', 'execute'),
  'AC-BPM-005 anon cannot call either function');                                                                                 -- 17
select ok(has_function_privilege('authenticated', 'public.get_work_order_billed_months(uuid, date)', 'execute'),
  'AC-BPM-005 signed-in users can call the read (it gates itself)');                                                              -- 18

select * from finish();
rollback;
