-- 1550_walk_checkin.test.sql — what stopped people at phone clock-in (migrations 1550-1553).
-- 1550 the work order's check-in area is set through set_work_order_check_in_area (Admin, Executive, Project Manager, Finance only;
-- never a field account; no direct table write) · 1551 a crew's Foreman clocks in himself on a work order his crew is rostered on,
-- and chooses the crew · 1552 my_home carries the state of today's clock-in · 1553 the request list carries the area.
-- Mutation checks run INSIDE this file (the transaction rolls back): the live function is rewritten with one rule broken, the
-- assertion that depends on the rule flips, and the original is restored. Markers in the migrations: mut:area_role, mut:foreman_leads.
begin;
create extension if not exists pgtap;
select plan(47);

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('15500000-0000-0000-0000-000000000010', 'WCI Org', 'IDR', true), ('15500000-0000-0000-0000-000000000011', 'WCI Other Org', 'IDR', true);
insert into auth.users (id, email) values
  ('15500000-0000-0000-0000-000000000021', 'wci-admin@example.com'), ('15500000-0000-0000-0000-000000000022', 'wci-pm@example.com'), ('15500000-0000-0000-0000-000000000023', 'wci-fin@example.com'),
  ('15500000-0000-0000-0000-000000000024', 'wci-exec@example.com'), ('15500000-0000-0000-0000-000000000025', 'wci-eng@example.com'), ('15500000-0000-0000-0000-000000000026', 'wci-sup@example.com'),
  ('15500000-0000-0000-0000-000000000027', 'wci-fm1@example.com'), ('15500000-0000-0000-0000-000000000028', 'wci-fm2@example.com'), ('15500000-0000-0000-0000-000000000029', 'wci-field@example.com'),
  ('15500000-0000-0000-0000-000000000030', 'wci-fm3@example.com'), ('15500000-0000-0000-0000-000000000031', 'wci-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('15500000-0000-0000-0000-000000000021', '15500000-0000-0000-0000-000000000010', 'WCI Admin', 'wci-admin@example.com', 'Admin', 'active', null),
  ('15500000-0000-0000-0000-000000000022', '15500000-0000-0000-0000-000000000010', 'WCI PM', 'wci-pm@example.com', 'Project Manager', 'active', null),
  ('15500000-0000-0000-0000-000000000023', '15500000-0000-0000-0000-000000000010', 'WCI Finance', 'wci-fin@example.com', 'Finance', 'active', null),
  ('15500000-0000-0000-0000-000000000024', '15500000-0000-0000-0000-000000000010', 'WCI Exec', 'wci-exec@example.com', 'Executive', 'active', null),
  ('15500000-0000-0000-0000-000000000025', '15500000-0000-0000-0000-000000000010', 'WCI Eng', 'wci-eng@example.com', 'Engineer', 'active', null),
  ('15500000-0000-0000-0000-000000000026', '15500000-0000-0000-0000-000000000010', 'WCI Site Supervisor', 'wci-sup@example.com', 'Engineer', 'active', 'site_supervisor'),
  ('15500000-0000-0000-0000-000000000027', '15500000-0000-0000-0000-000000000010', 'WCI Foreman One', 'wci-fm1@example.com', 'Engineer', 'active', 'foreman'),
  ('15500000-0000-0000-0000-000000000028', '15500000-0000-0000-0000-000000000010', 'WCI Foreman Two', 'wci-fm2@example.com', 'Engineer', 'active', 'foreman'),
  ('15500000-0000-0000-0000-000000000029', '15500000-0000-0000-0000-000000000010', 'WCI Field', 'wci-field@example.com', 'Engineer', 'active', 'field_user'),
  ('15500000-0000-0000-0000-000000000030', '15500000-0000-0000-0000-000000000010', 'WCI Foreman Three', 'wci-fm3@example.com', 'Engineer', 'active', 'foreman'),
  ('15500000-0000-0000-0000-000000000031', '15500000-0000-0000-0000-000000000011', 'WCI XAdmin', 'wci-xadmin@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15500000-0000-0000-0000-000000000040', '15500000-0000-0000-0000-000000000010', 'WCI Site', 'Ongoing Project', '15500000-0000-0000-0000-000000000022');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, area_lat, area_lng, area_radius_m) values
  ('15500000-0000-0000-0000-000000000051', '15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000040', 'WCI WO area',      'Issued', 1000, 'exclusive', 0, 0, 0, 100),
  ('15500000-0000-0000-0000-000000000052', '15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000040', 'WCI WO no area',   'Issued', 1000, 'exclusive', 0, null, null, null),
  ('15500000-0000-0000-0000-000000000053', '15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000040', 'WCI WO elsewhere', 'Issued', 1000, 'exclusive', 0, 0, 0, 100),
  ('15500000-0000-0000-0000-000000000054', '15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000040', 'WCI WO three',     'Issued', 1000, 'exclusive', 0, 0, 0, 100),
  ('15500000-0000-0000-0000-000000000055', '15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000040', 'WCI WO five',      'Issued', 1000, 'exclusive', 0, 0, 0, 100),
  ('15500000-0000-0000-0000-000000000056', '15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000040', 'WCI WO six',       'Issued', 1000, 'exclusive', 0, 0, 0, 100);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('15500000-0000-0000-0000-000000000061', '15500000-0000-0000-0000-000000000010', 'WCI-1', 'WCI crew one',   '15500000-0000-0000-0000-000000000027'),
  ('15500000-0000-0000-0000-000000000062', '15500000-0000-0000-0000-000000000010', 'WCI-2', 'WCI crew two',   '15500000-0000-0000-0000-000000000028'),
  ('15500000-0000-0000-0000-000000000063', '15500000-0000-0000-0000-000000000010', 'WCI-3', 'WCI crew three', '15500000-0000-0000-0000-000000000028'),
  ('15500000-0000-0000-0000-000000000064', '15500000-0000-0000-0000-000000000010', 'WCI-4', 'WCI crew four',  null),
  ('15500000-0000-0000-0000-000000000065', '15500000-0000-0000-0000-000000000010', 'WCI-5', 'WCI crew five',  '15500000-0000-0000-0000-000000000030'),
  ('15500000-0000-0000-0000-000000000066', '15500000-0000-0000-0000-000000000010', 'WCI-6', 'WCI crew six',   '15500000-0000-0000-0000-000000000027'),
  ('15500000-0000-0000-0000-000000000067', '15500000-0000-0000-0000-000000000010', 'WCI-7', 'WCI crew seven', '15500000-0000-0000-0000-000000000028'),
  ('15500000-0000-0000-0000-000000000068', '15500000-0000-0000-0000-000000000010', 'WCI-8', 'WCI crew eight', null);
insert into people (id, org_id, kind, code, name, profile_id) values
  ('15500000-0000-0000-0000-000000000071', '15500000-0000-0000-0000-000000000010', 'own', 'WCI-P1', 'WCI Field person', '15500000-0000-0000-0000-000000000029'),
  ('15500000-0000-0000-0000-000000000072', '15500000-0000-0000-0000-000000000010', 'own', 'WCI-P2', 'WCI Foreman Two person', '15500000-0000-0000-0000-000000000028'),
  ('15500000-0000-0000-0000-000000000073', '15500000-0000-0000-0000-000000000010', 'own', 'WCI-P3', 'WCI Foreman Three person', '15500000-0000-0000-0000-000000000030');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000064', '15500000-0000-0000-0000-000000000071', current_date - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000051', '15500000-0000-0000-0000-000000000062', current_date - 5),
  ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000051', '15500000-0000-0000-0000-000000000063', current_date - 5), ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000051', '15500000-0000-0000-0000-000000000064', current_date - 5),
  ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000052', '15500000-0000-0000-0000-000000000061', current_date - 5), ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000053', '15500000-0000-0000-0000-000000000068', current_date - 5),
  ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000054', '15500000-0000-0000-0000-000000000065', current_date - 5),
  ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000055', '15500000-0000-0000-0000-000000000067', current_date - 5), ('15500000-0000-0000-0000-000000000010', '15500000-0000-0000-0000-000000000056', '15500000-0000-0000-0000-000000000066', current_date - 5);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
-- The live function with one line changed, run and rolled back with the transaction (superuser only).
create or replace function pg_temp.mutate(p_sig regprocedure, p_from text, p_to text) returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_sig);
begin
  if position(p_from in v_def) = 0 then raise exception 'mutation target not found: %', p_from; end if;
  execute replace(v_def, p_from, p_to);
end $$;

set local role authenticated;

-- ── 1550 who may set the check-in area ───────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('15500000-0000-0000-0000-000000000021');
select lives_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 1.5, 2.5, 80) $$, 'AC-WCI-001 an Admin sets the check-in area');
select is((select area_radius_m from work_orders where id = '15500000-0000-0000-0000-000000000052'), 80::double precision, 'AC-WCI-001 the area is stored');
select pg_temp.act_as('15500000-0000-0000-0000-000000000022');
select lives_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 1.5, 2.5, 90) $$, 'AC-WCI-001 a Project Manager sets it');
select pg_temp.act_as('15500000-0000-0000-0000-000000000023');
select lives_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 1.5, 2.5, 95) $$, 'AC-WCI-001 Finance sets it');
select pg_temp.act_as('15500000-0000-0000-0000-000000000024');
select lives_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 1.5, 2.5, 99) $$, 'AC-WCI-001 an Executive sets it');
select pg_temp.act_as('15500000-0000-0000-0000-000000000025');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 9, 9, 10) $$, '42501', null, 'AC-WCI-002 an Engineer cannot set it');
select pg_temp.act_as('15500000-0000-0000-0000-000000000026');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 9, 9, 10) $$, '42501', null, 'AC-WCI-002 a site supervisor cannot set it');
select pg_temp.act_as('15500000-0000-0000-0000-000000000027');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 9, 9, 10) $$, '42501', null, 'AC-WCI-002 a Foreman (light account) cannot set it');
select pg_temp.act_as('15500000-0000-0000-0000-000000000029');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 9, 9, 10) $$, '42501', null, 'AC-WCI-002 a Field user (light account) cannot set it');
select pg_temp.act_as('15500000-0000-0000-0000-000000000031');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 9, 9, 10) $$, 'P0002', null, 'AC-WCI-002 another organisation''s Admin finds no such work order');
select pg_temp.act_as('15500000-0000-0000-0000-000000000021');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 91, 0, 10) $$, '22023', null, 'AC-WCI-003 a latitude out of range is refused');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 0, 0, 0) $$, '22023', null, 'AC-WCI-003 a zero radius is refused');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 0, null, 10) $$, '22023', null, 'AC-WCI-003 half an area is refused');
select throws_ok($$ update work_orders set area_lat = 5, area_lng = 5, area_radius_m = 5 where id = '15500000-0000-0000-0000-000000000052' $$, '42501', null,
  'AC-WCI-004 a direct table write of the area stays refused for every role');
select is((select area_lat from work_orders where id = '15500000-0000-0000-0000-000000000052'), 1.5::double precision, 'AC-WCI-002 every refusal left the area as it was');
select lives_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', null, null, null) $$, 'AC-WCI-001 an Admin clears the area');
select is((select area_lat from work_orders where id = '15500000-0000-0000-0000-000000000052'), null::double precision, 'AC-WCI-001 cleared means no location is asked');
select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 3, 4, 60);
reset role;
select is((select count(*)::int from audit_events where action = 'work_order.check_in_area_set' and entity_id = '15500000-0000-0000-0000-000000000052'), 6,
  'AC-WCI-005 each successful change left an audit entry');
select ok(not has_function_privilege('anon', 'public.set_work_order_check_in_area(uuid,double precision,double precision,double precision)', 'execute'),
  'AC-WCI-002 anon cannot call the setter');
-- mutation: open the role gate; the Engineer refusal must depend on it
select pg_temp.mutate('public.set_work_order_check_in_area(uuid,double precision,double precision,double precision)',
  'public.auth_role() not in (''Admin'', ''Executive'', ''Project Manager'', ''Finance'')', 'false');
set local role authenticated;
select pg_temp.act_as('15500000-0000-0000-0000-000000000025');
select lives_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 7, 7, 7) $$, 'AC-WCI-006 MUTATION: with the role gate open an Engineer gets through (so the refusal above is the gate)');
reset role;
select pg_temp.mutate('public.set_work_order_check_in_area(uuid,double precision,double precision,double precision)',
  'false', 'public.auth_role() not in (''Admin'', ''Executive'', ''Project Manager'', ''Finance'')');
set local role authenticated;
select pg_temp.act_as('15500000-0000-0000-0000-000000000025');
select throws_ok($$ select public.set_work_order_check_in_area('15500000-0000-0000-0000-000000000052', 8, 8, 8) $$, '42501', null, 'AC-WCI-006 restored: the Engineer is refused again');

-- ── 1551 a Foreman clocks in himself ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('15500000-0000-0000-0000-000000000027');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000052', '15500000-0000-0000-0000-000000000061', null, null, null)->>'status', 'recorded',
  'AC-WCI-010 a Foreman clocks in on a work order his crew is rostered on (no area), though he is not a member of the crew');
reset role;
select is((select count(*)::int from people where profile_id = '15500000-0000-0000-0000-000000000027'), 1, 'AC-WCI-010 his first clock-in entered him in the workforce register');
select is((select crew_id from attendance_days where work_order_id = '15500000-0000-0000-0000-000000000052' and work_date = current_date), '15500000-0000-0000-0000-000000000061'::uuid,
  'AC-WCI-010 his attendance is recorded against the crew he leads');
set local role authenticated;
select pg_temp.act_as('15500000-0000-0000-0000-000000000027');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000056', '15500000-0000-0000-0000-000000000066', 0.0003, 0, 10)->>'outcome', 'inside', 'AC-WCI-011 inside the area, as a Foreman of a rostered crew, records');
select throws_ok($$ select public.phone_check_in('15500000-0000-0000-0000-000000000056', '15500000-0000-0000-0000-000000000064', 0.0003, 0, 10) $$, '23514', null,
  'AC-WCI-012 a Foreman cannot pick a crew he neither leads nor belongs to');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000053', null, 0.0003, 0, 10)->>'outcome', 'not_rostered',
  'AC-WCI-012 on a work order none of his crews is rostered on he is a request to the supervisor, not attendance');
select pg_temp.act_as('15500000-0000-0000-0000-000000000025');
select throws_ok($$ select public.phone_check_in('15500000-0000-0000-0000-000000000052', null, null, null, null) $$, '23514', null,
  'AC-WCI-012 someone who leads no crew and is not in the register still cannot clock in');
-- a Foreman of two crews on one work order chooses
select pg_temp.act_as('15500000-0000-0000-0000-000000000028');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000051', '15500000-0000-0000-0000-000000000063', 0.0003, 0, 10)->>'status', 'recorded', 'AC-WCI-013 a Foreman of two crews on the work order chooses the second');
reset role;
select is((select crew_id from attendance_days where work_order_id = '15500000-0000-0000-0000-000000000051' and worker_id = '15500000-0000-0000-0000-000000000072' and work_date = current_date), '15500000-0000-0000-0000-000000000063'::uuid,
  'AC-WCI-013 the attendance names the crew he chose');
-- outside: a request; the decider approves; the crew carries through
set local role authenticated;
select pg_temp.act_as('15500000-0000-0000-0000-000000000028');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000055', '15500000-0000-0000-0000-000000000067', 0.003, 0, 10)->>'status', 'pending', 'AC-WCI-014 a Foreman outside the area is a pending request');
select pg_temp.act_as('15500000-0000-0000-0000-000000000028');
select throws_ok($$ select public.phone_check_in_decide((select id from phone_check_ins where worker_id = '15500000-0000-0000-0000-000000000072' and status = 'pending'), true, null) $$, '42501', null,
  'AC-WCI-014 a Foreman (light account) cannot decide, not even his own');
select pg_temp.act_as('15500000-0000-0000-0000-000000000022');
select is((select area_radius_m from public.phone_check_in_requests() where worker_name = 'WCI Foreman Two person'), 100::double precision,
  'AC-WCI-015 the supervisor''s request list carries the area it is judged against');
select lives_ok($$ select public.phone_check_in_decide((select id from phone_check_ins where worker_id = '15500000-0000-0000-0000-000000000072' and status = 'pending'), true, null) $$,
  'AC-WCI-014 a crew manager approves the Foreman''s request');
reset role;
select is((select crew_id from attendance_days where work_order_id = '15500000-0000-0000-0000-000000000055' and worker_id = '15500000-0000-0000-0000-000000000072' and work_date = current_date), '15500000-0000-0000-0000-000000000067'::uuid,
  'AC-WCI-014 approval records him against the crew he asked with');
-- mutation: a Foreman's leadership no longer counts as being rostered
select pg_temp.mutate('public.phone_check_in(uuid,uuid,double precision,double precision,double precision,numeric,boolean)',
  'v_rostered := v_leads or exists (', 'v_rostered := exists (');
set local role authenticated;
select pg_temp.act_as('15500000-0000-0000-0000-000000000030');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000054', '15500000-0000-0000-0000-000000000065', 0.0003, 0, 10)->>'outcome', 'not_rostered',
  'AC-WCI-016 MUTATION: without the leadership rule a Foreman inside his own crew''s area is only a request (so AC-WCI-010/013 depend on it)');
reset role;
select pg_temp.mutate('public.phone_check_in(uuid,uuid,double precision,double precision,double precision,numeric,boolean)',
  'v_rostered := exists (', 'v_rostered := v_leads or exists (');
delete from phone_check_ins where worker_id = '15500000-0000-0000-0000-000000000073';
set local role authenticated;
select pg_temp.act_as('15500000-0000-0000-0000-000000000030');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000054', '15500000-0000-0000-0000-000000000065', 0.0003, 0, 10)->>'outcome', 'inside', 'AC-WCI-016 restored: the Foreman inside his crew''s area records');

-- ── 1552 the home says what became of the clock-in ───────────────────────────────────────────────────────────────────
select pg_temp.act_as('15500000-0000-0000-0000-000000000027');
select is((select e->'check_in'->>'state' from jsonb_array_elements(public.my_home()->'work_orders') e where e->>'work_order_id' = '15500000-0000-0000-0000-000000000052'),
  'clocked_in', 'AC-WCI-020 after clocking in the home says clocked in');
select ok((select (e->'check_in'->>'at') is not null from jsonb_array_elements(public.my_home()->'work_orders') e where e->>'work_order_id' = '15500000-0000-0000-0000-000000000052'),
  'AC-WCI-020 and carries the time');
select ok((select e->>'my_worker_id' is not null from jsonb_array_elements(public.my_home()->'work_orders') e where e->>'work_order_id' = '15500000-0000-0000-0000-000000000052'),
  'AC-WCI-020 the Foreman now has a person of his own on the home');
select pg_temp.act_as('15500000-0000-0000-0000-000000000029');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000051', '15500000-0000-0000-0000-000000000064', 0.003, 0, 10)->>'status', 'pending', 'AC-WCI-021 a worker outside the area is waiting');
select is((select e->'check_in'->>'state' from jsonb_array_elements(public.my_home()->'work_orders') e where e->>'work_order_id' = '15500000-0000-0000-0000-000000000051' and e->>'crew_id' = '15500000-0000-0000-0000-000000000064'),
  'pending', 'AC-WCI-021 the home says waiting for the supervisor');
select is(public.my_home()->'decider_role', 'null'::jsonb, 'AC-WCI-021 with no role configured the decider is the crew''s Foreman or a manager (key null)');
select pg_temp.act_as('15500000-0000-0000-0000-000000000022');
select public.phone_check_in_decide((select id from phone_check_ins where worker_id = '15500000-0000-0000-0000-000000000071' and status = 'pending'), false, 'too far from the gate');
select pg_temp.act_as('15500000-0000-0000-0000-000000000029');
select is((select e->'check_in'->>'reason' from jsonb_array_elements(public.my_home()->'work_orders') e where e->>'work_order_id' = '15500000-0000-0000-0000-000000000051' and e->>'crew_id' = '15500000-0000-0000-0000-000000000064'),
  'too far from the gate', 'AC-WCI-022 after a refusal the home carries the reason');
select is((select e->'check_in'->>'state' from jsonb_array_elements(public.my_home()->'work_orders') e where e->>'work_order_id' = '15500000-0000-0000-0000-000000000051' and e->>'crew_id' = '15500000-0000-0000-0000-000000000064'),
  'rejected', 'AC-WCI-022 and says refused');
reset role;
update phone_check_ins set checked_in_at = now() - interval '1 hour' where worker_id = '15500000-0000-0000-0000-000000000071' and status = 'rejected';   -- one transaction shares one now()
set local role authenticated;
select pg_temp.act_as('15500000-0000-0000-0000-000000000029');
select is(public.phone_check_in('15500000-0000-0000-0000-000000000051', '15500000-0000-0000-0000-000000000064', 0.0003, 0, 10)->>'status', 'recorded', 'AC-WCI-022 after a refusal the worker can try again inside the area');
select is((select e->'check_in'->>'state' from jsonb_array_elements(public.my_home()->'work_orders') e where e->>'work_order_id' = '15500000-0000-0000-0000-000000000051' and e->>'crew_id' = '15500000-0000-0000-0000-000000000064'),
  'clocked_in', 'AC-WCI-022 and the home says clocked in');

select * from finish();
rollback;
