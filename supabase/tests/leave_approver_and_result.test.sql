-- leave_approver_and_result.test.sql — fix/walk-people item 9 (migration 1611).
-- AC-LVR-001 the visible list names the approver role and the line manager · AC-LVR-002 a decision names who decided ·
-- AC-LVR-003 the requester gets one notification of the result, from a template key · AC-LVR-004 nobody else does.
begin;
create extension if not exists pgtap;
select plan(8);
insert into organizations (id, name, default_currency, leave_requests_enabled) values ('27090000-0000-0000-0000-00000000010a', 'LVR Org', 'IDR', true);
insert into auth.users (id, email) values
  ('27090000-0000-0000-0000-0000000001a1', 'lvr-admin@example.com'),
  ('27090000-0000-0000-0000-0000000001a2', 'lvr-mgr@example.com'),
  ('27090000-0000-0000-0000-0000000001a3', 'lvr-worker@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27090000-0000-0000-0000-0000000001a1', '27090000-0000-0000-0000-00000000010a', 'LVR Admin',  'lvr-admin@example.com',  'Admin', 'active'),
  ('27090000-0000-0000-0000-0000000001a2', '27090000-0000-0000-0000-00000000010a', 'LVR Manager', 'lvr-mgr@example.com',    'Project Manager', 'active'),
  ('27090000-0000-0000-0000-0000000001a3', '27090000-0000-0000-0000-00000000010a', 'LVR Worker', 'lvr-worker@example.com', 'Engineer', 'active');
update profiles set manager_id = '27090000-0000-0000-0000-0000000001a2' where id = '27090000-0000-0000-0000-0000000001a3';
insert into people (id, org_id, kind, name, profile_id) values
  ('27090000-0000-0000-0000-000000001f01', '27090000-0000-0000-0000-00000000010a', 'own', 'LVR Own Worker', '27090000-0000-0000-0000-0000000001a3');
insert into leave_types (id, org_id, name) values ('27090000-0000-0000-0000-0000000001e1', '27090000-0000-0000-0000-00000000010a', 'Type A');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create temp table lvr_ids (k text primary key, id uuid);
grant all on lvr_ids to authenticated;
set local role authenticated;

select pg_temp.act_as('27090000-0000-0000-0000-0000000001a3');
insert into lvr_ids select 'r1', leave_request_submit('27090000-0000-0000-0000-000000001f01', '27090000-0000-0000-0000-0000000001e1', current_date + 10, current_date + 11, null);
select is((select line_manager_name from leave_requests_visible() limit 1), 'LVR Manager', 'AC-LVR-001 the request names the person''s line manager');
select is((select approver_role from leave_requests_visible() limit 1), 'Admin', 'AC-LVR-001 and the approver role (Admin while the setting is empty)');
select is((select decided_by_name from leave_requests_visible() limit 1), null, 'AC-LVR-002 nobody has decided yet');

select pg_temp.act_as('27090000-0000-0000-0000-0000000001a2');
select lives_ok($$ select leave_request_decide((select id from lvr_ids where k = 'r1'), 'Approved', null) $$, 'AC-LVR-002 the line manager approves');
select pg_temp.act_as('27090000-0000-0000-0000-0000000001a3');
select is((select decided_by_name from leave_requests_visible() limit 1), 'LVR Manager', 'AC-LVR-002 the requester sees who decided');
select is((select count(*)::int from notifications where owner_id = '27090000-0000-0000-0000-0000000001a3' and message_key = 'leaveApproved'), 1,
  'AC-LVR-003 the requester is told, with the template key kept');
select pg_temp.act_as('27090000-0000-0000-0000-0000000001a2');
select is((select count(*)::int from notifications where message_key = 'leaveApproved'), 0, 'AC-LVR-004 the approver gets no copy');
select is((select message_params ->> 'type' from (select message_params from notifications limit 1) x), null, 'AC-LVR-004 and cannot read the requester''s notification');
select * from finish();
rollback;
