-- AC-MV-004: current measured quantity less confirmed client acceptance, with tenant and role boundaries.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_timezone) values
  ('22820000-0000-0000-0000-0000000000a1', 'Progress Org A', 'UTC'),
  ('22820000-0000-0000-0000-0000000000a2', 'Progress Org B', 'UTC');
insert into auth.users (id, email) values
  ('22820000-0000-0000-0000-0000000000b1', 'progress-fin@example.invalid'),
  ('22820000-0000-0000-0000-0000000000b2', 'progress-eng@example.invalid'),
  ('22820000-0000-0000-0000-0000000000b3', 'progress-foreign@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22820000-0000-0000-0000-0000000000b1', '22820000-0000-0000-0000-0000000000a1', 'Progress Finance', 'progress-fin@example.invalid', 'Finance', 'active'),
  ('22820000-0000-0000-0000-0000000000b2', '22820000-0000-0000-0000-0000000000a1', 'Progress Engineer', 'progress-eng@example.invalid', 'Engineer', 'active'),
  ('22820000-0000-0000-0000-0000000000b3', '22820000-0000-0000-0000-0000000000a2', 'Progress Foreign Finance', 'progress-foreign@example.invalid', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('22820000-0000-0000-0000-0000000000c1', '22820000-0000-0000-0000-0000000000a1', 'Progress Project A', 'Ongoing Project', 'IDR'),
  ('22820000-0000-0000-0000-0000000000c2', '22820000-0000-0000-0000-0000000000a2', 'Progress Project B', 'Ongoing Project', 'IDR');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis, line_no) values
  ('22820000-0000-0000-0000-0000000000d1', '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000c1', 'A', 'Measured and partly accepted', 'm', 20, 10, 'unit_rate', 1),
  ('22820000-0000-0000-0000-0000000000d2', '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000c1', 'B', 'Fully accepted', 'm', 20, 10, 'unit_rate', 2),
  ('22820000-0000-0000-0000-0000000000d3', '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000c1', 'C', 'Measured, not accepted', 'm', 20, 10, 'unit_rate', 3),
  ('22820000-0000-0000-0000-0000000000d4', '22820000-0000-0000-0000-0000000000a2', '22820000-0000-0000-0000-0000000000c2', 'D', 'Other organisation', 'm', 100, 10, 'unit_rate', 1);
insert into work_orders (id, org_id, project_id, title, status, order_value, currency, tax_treatment, tax_amount) values
  ('22820000-0000-0000-0000-0000000000e1', '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000c1', 'Progress order A', 'Issued', 1000, 'IDR', 'exclusive', 0),
  ('22820000-0000-0000-0000-0000000000e2', '22820000-0000-0000-0000-0000000000a2', '22820000-0000-0000-0000-0000000000c2', 'Progress order B', 'Issued', 1000, 'IDR', 'exclusive', 0);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000e1', '22820000-0000-0000-0000-0000000000d1', 12),
  ('22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000e1', '22820000-0000-0000-0000-0000000000d2', 4),
  ('22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000e1', '22820000-0000-0000-0000-0000000000d3', 2),
  ('22820000-0000-0000-0000-0000000000a2', '22820000-0000-0000-0000-0000000000e2', '22820000-0000-0000-0000-0000000000d4', 99);
insert into project_progress_entries (id, org_id, project_id, month, pct_complete) values
  ('22820000-0000-0000-0000-0000000000f1', '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000c1', date_trunc('month', current_date)::date, 50),
  ('22820000-0000-0000-0000-0000000000f2', '22820000-0000-0000-0000-0000000000a2', '22820000-0000-0000-0000-0000000000c2', date_trunc('month', current_date)::date, 50);
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000f1', '22820000-0000-0000-0000-0000000000d1', 12),
  ('22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000f1', '22820000-0000-0000-0000-0000000000d2', 4),
  ('22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000f1', '22820000-0000-0000-0000-0000000000d3', 2),
  ('22820000-0000-0000-0000-0000000000a2', '22820000-0000-0000-0000-0000000000f2', '22820000-0000-0000-0000-0000000000d4', 99);
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('22820000-0000-0000-0000-0000000000f3', '22820000-0000-0000-0000-0000000000a1', '22820000-0000-0000-0000-0000000000c1', '22820000-0000-0000-0000-0000000000e1', current_date, false, 'Confirmed', '22820000-0000-0000-0000-0000000000b1', '22820000-0000-0000-0000-0000000000b1', now(), 'standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('22820000-0000-0000-0000-0000000000f3', '22820000-0000-0000-0000-0000000000d1', 4),
  ('22820000-0000-0000-0000-0000000000f3', '22820000-0000-0000-0000-0000000000d2', 4);

select has_function('public', 'billing_unaccepted_progress', ARRAY['uuid'], 'AC-MV-004 progress read exists');
select is((select prosecdef from pg_proc where oid = 'public.billing_unaccepted_progress(uuid)'::regprocedure), false, 'AC-MV-004 read remains security invoker');
select is(has_function_privilege('anon', 'public.billing_unaccepted_progress(uuid)', 'execute'), false, 'AC-MV-004 anon cannot call the read');
select is(has_function_privilege('authenticated', 'public.billing_unaccepted_progress(uuid)', 'execute'), true, 'AC-MV-004 authenticated can call the read');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22820000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.billing_unaccepted_progress()), 2, 'AC-MV-004 only positive assessed-minus-accepted rows appear');
select results_eq($$ select item_code, quantity from public.billing_unaccepted_progress() order by item_code $$,
  $$ values ('A'::text, '8.000'::text), ('C'::text, '2.000'::text) $$, 'AC-MV-004 subtracts confirmed client acceptance exactly');
select is((select count(*)::int from public.billing_unaccepted_progress('22820000-0000-0000-0000-0000000000c1')), 2, 'AC-MV-004 project filter returns the selected project');
select is((select count(*)::int from public.billing_unaccepted_progress('22820000-0000-0000-0000-0000000000c2')), 0, 'AC-MV-004 another organisation project returns nothing');
set local request.jwt.claims = '{"sub":"22820000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.billing_unaccepted_progress()), 0, 'AC-MV-004 Engineer receives no candidates');
set local request.jwt.claims = '{"sub":"22820000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select results_eq($$ select item_code from public.billing_unaccepted_progress() $$, $$ values ('D'::text) $$,
  'AC-MV-004 another organisation sees only its own unaccepted progress');
reset role;
select * from finish();
rollback;
