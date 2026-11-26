begin;
create extension if not exists pgtap;
select plan(5);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled, phone_check_in_supervisor_role)
values ('28230000-0000-0000-0000-000000000001', 'Check-In Decisions', 'USD', 'UTC', true, 'site_supervisor');

insert into auth.users (id, email) values
  ('28230000-0000-0000-0000-000000000011', 'checkin-requester@example.test'),
  ('28230000-0000-0000-0000-000000000012', 'checkin-supervisor@example.test');
insert into profiles (id, org_id, role, built_in_role, email, full_name, status) values
  ('28230000-0000-0000-0000-000000000011', '28230000-0000-0000-0000-000000000001', 'Engineer', 'storekeeper',
   'checkin-requester@example.test', 'Requester', 'active'),
  ('28230000-0000-0000-0000-000000000012', '28230000-0000-0000-0000-000000000001', 'Engineer', 'site_supervisor',
   'checkin-supervisor@example.test', 'Site Supervisor', 'active');

insert into projects (id, org_id, name, status, currency) values
  ('28230000-0000-0000-0000-000000000021', '28230000-0000-0000-0000-000000000001', 'Check-in project', 'Ongoing Project', 'USD');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('28230000-0000-0000-0000-000000000022', '28230000-0000-0000-0000-000000000001', '28230000-0000-0000-0000-000000000021',
   'Check-in work order', 'Issued', 100, 'exclusive', 0);
insert into people (id, org_id, kind, name, profile_id) values
  ('28230000-0000-0000-0000-000000000023', '28230000-0000-0000-0000-000000000001', 'own', 'Requester', '28230000-0000-0000-0000-000000000011');
insert into phone_check_ins (id, org_id, work_order_id, worker_id, requester_id, work_date, hours, outcome, status) values
  ('28230000-0000-0000-0000-000000000024', '28230000-0000-0000-0000-000000000001', '28230000-0000-0000-0000-000000000022',
   '28230000-0000-0000-0000-000000000023', '28230000-0000-0000-0000-000000000011', current_date, 8, 'outside', 'pending');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"28230000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select is_empty($$ select record_id from public.my_waiting_decisions() where kind = 'check_in' $$,
  'AC-WAIT-2823 the requester sees no decision for their own check-in');
select throws_ok(
  $$ select public.phone_check_in_decide('28230000-0000-0000-0000-000000000024', false, 'Outside the assigned area') $$,
  '42501', 'PCI_SELF: you cannot decide your own check-in',
  'AC-WAIT-2823 the gate refuses the requester');
select set_config('request.jwt.claims', '{"sub":"28230000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select results_eq(
  $$ select record_id from public.my_waiting_decisions() where kind = 'check_in' $$,
  $$ values ('28230000-0000-0000-0000-000000000024'::uuid) $$,
  'AC-WAIT-2823 the configured supervisor sees the waiting request');
select is(public.phone_check_in_decide('28230000-0000-0000-0000-000000000024', false, 'Outside the assigned area')->>'status',
  'rejected', 'AC-WAIT-2823 the configured supervisor can decide the listed request');
select is_empty($$ select record_id from public.my_waiting_decisions() where kind = 'check_in' $$,
  'AC-WAIT-2823 the decided request leaves the list');
reset role;

select * from finish();
rollback;
