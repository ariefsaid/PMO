-- 1561_requester_notified.test.sql — fix-waiting item 4: the requester is told when a request is returned, refused or approved, with the reason.
-- Migration under test: 1561_requester_notified.sql.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values ('15610000-0000-0000-0000-00000000000a', 'Notice Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('15610000-0000-0000-0000-0000000000a1', 'n-req@example.com'), ('15610000-0000-0000-0000-0000000000a2', 'n-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15610000-0000-0000-0000-0000000000a1', '15610000-0000-0000-0000-00000000000a', 'N Req', 'n-req@example.com', 'Engineer', 'active'),
  ('15610000-0000-0000-0000-0000000000a2', '15610000-0000-0000-0000-00000000000a', 'N PM', 'n-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15610000-0000-0000-0000-0000000000d1', '15610000-0000-0000-0000-00000000000a', 'Notice Site', 'Ongoing Project', '15610000-0000-0000-0000-0000000000a2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15610000-0000-0000-0000-000000000401', '15610000-0000-0000-0000-00000000000a', '15610000-0000-0000-0000-0000000000d1', 'Notice WO', 'Issued', 0, 'exclusive', 0);
insert into material_requests (id, org_id, number, work_order_id, project_id, needed_by, status, round, created_by) values
  ('15610000-0000-0000-0000-000000000501', '15610000-0000-0000-0000-00000000000a', 'MRQ-N1', '15610000-0000-0000-0000-000000000401', '15610000-0000-0000-0000-0000000000d1', current_date + 2, 'pending', 1, '15610000-0000-0000-0000-0000000000a1'),
  ('15610000-0000-0000-0000-000000000502', '15610000-0000-0000-0000-00000000000a', 'MRQ-N2', '15610000-0000-0000-0000-000000000401', '15610000-0000-0000-0000-0000000000d1', current_date + 2, 'pending', 1, '15610000-0000-0000-0000-0000000000a1');
insert into material_request_steps (request_id, org_id, round, position, role, label, status) values
  ('15610000-0000-0000-0000-000000000501', '15610000-0000-0000-0000-00000000000a', 1, 1, 'Project Manager', 'Site lead', 'open'),
  ('15610000-0000-0000-0000-000000000502', '15610000-0000-0000-0000-00000000000a', 1, 1, 'Project Manager', 'Site lead', 'open');
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at) values
  ('15610000-0000-0000-0000-000000000601', '15610000-0000-0000-0000-00000000000a', '15610000-0000-0000-0000-0000000000d1', '15610000-0000-0000-0000-000000000401', current_date - 1, 'submitted', '15610000-0000-0000-0000-0000000000a1', now());

-- The decider is the PM (the acting user is never notified).
select set_config('request.jwt.claims', json_build_object('sub', '15610000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);

update material_request_steps set status = 'returned', decided_by = '15610000-0000-0000-0000-0000000000a2', decided_at = now(), reason = 'Split the pour' where request_id = '15610000-0000-0000-0000-000000000501';
update material_request_steps set status = 'rejected', decided_by = '15610000-0000-0000-0000-0000000000a2', decided_at = now(), reason = 'Not on this site' where request_id = '15610000-0000-0000-0000-000000000502';
update daily_site_reports set status = 'returned', returned_reason = 'Photo is blurred' where id = '15610000-0000-0000-0000-000000000601';

select is((select count(*)::int from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1' and title = 'Your material request was sent back'), 1,
  'AC-NTF-001 a returned material request tells the requester');
select is((select body from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1' and title = 'Your material request was sent back'), 'Split the pour',
  'AC-NTF-002 the notification carries the reason');
select is((select metadata->'entity'->>'label' from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1' and title = 'Your material request was sent back'), 'MRQ-N1',
  'AC-NTF-003 and names which request it was');
select is((select body from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1' and title = 'Your material request was refused'), 'Not on this site',
  'AC-NTF-004 a refused material request tells the requester with the reason');
select is((select count(*)::int from notifications where owner_id = '15610000-0000-0000-0000-0000000000a2'), 0,
  'AC-NTF-005 the person who decided is not notified');
select is((select body from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1' and title = 'Your daily report was sent back'), 'Photo is blurred',
  'AC-NTF-006 a returned daily report tells its author with the reason');

-- Approval: the last step approves the whole request.
update material_requests set status = 'approved' where id = '15610000-0000-0000-0000-000000000501';
select is((select count(*)::int from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1' and title = 'Your material request was approved'), 1,
  'AC-NTF-007 an approved material request tells the requester');
select is((select metadata->'entity'->>'id' from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1' and title = 'Your material request was approved'), '15610000-0000-0000-0000-000000000501',
  'AC-NTF-008 and links the request');

-- A step that merely moves to the next person does not notify the requester of a decision.
update material_request_steps set status = status where request_id = '15610000-0000-0000-0000-000000000502';
select is((select count(*)::int from notifications where owner_id = '15610000-0000-0000-0000-0000000000a1'), 4, 'AC-NTF-009 an update that decides nothing adds nothing');
select is(has_function_privilege('authenticated', 'public.notify_requester_mrq_step()', 'execute'), false, 'AC-NTF-010 the trigger functions are not callable by a signed-in client');
select * from finish();
rollback;
