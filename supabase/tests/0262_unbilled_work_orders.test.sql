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
