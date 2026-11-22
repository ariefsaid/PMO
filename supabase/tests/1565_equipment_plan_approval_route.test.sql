-- 1565_equipment_plan_approval_route.test.sql — the plan screen's read of WHO a Submitted equipment plan waits for.
-- AC-EQP-008 owns the approver route (equipment_plan_approval.test.sql is that AC's owning file); these are a second
-- pgTAP proof at the same layer, for the read that must name EXACTLY the people the decision function would let decide.
-- Migrations under test: 1358 (equipment_plan_approver_ok, the authority), 1565 (the read).
--
-- The equivalence is asserted the only way that means anything: every name the route returns is set as a real caller and
-- the decision function is asked (must be true); every legal actor the route leaves out is asked too (must be false).
begin;
create extension if not exists pgtap;
select plan(62);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27650000-0000-0000-0000-0000000000a0', 'EQP Route Org',       'IDR', 'Asia/Jakarta'),
  ('27650000-0000-0000-0000-0000000000b0', 'EQP Route Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('27650000-0000-0000-0000-0000000000a1', 'eqp-route-admin@example.com'),
  ('27650000-0000-0000-0000-0000000000a2', 'eqp-route-author@example.com'),
  ('27650000-0000-0000-0000-0000000000a3', 'eqp-route-finance@example.com'),
  ('27650000-0000-0000-0000-0000000000a4', 'eqp-route-exec@example.com'),
  ('27650000-0000-0000-0000-0000000000a5', 'eqp-route-role-changed@example.com'),
  ('27650000-0000-0000-0000-0000000000a6', 'eqp-route-pm@example.com'),
  ('27650000-0000-0000-0000-0000000000a7', 'eqp-route-disabled@example.com'),
  ('27650000-0000-0000-0000-0000000000a8', 'eqp-route-field@example.com'),
  ('27650000-0000-0000-0000-0000000000b1', 'eqp-route-xadmin@example.com'),
  ('27650000-0000-0000-0000-0000000000b2', 'eqp-route-xpm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27650000-0000-0000-0000-0000000000a1', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Admin',        'eqp-route-admin@example.com',        'Admin',           'active'),
  ('27650000-0000-0000-0000-0000000000a2', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Author',       'eqp-route-author@example.com',       'Project Manager', 'active'),
  ('27650000-0000-0000-0000-0000000000a3', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Finance',      'eqp-route-finance@example.com',      'Finance',         'active'),
  ('27650000-0000-0000-0000-0000000000a4', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Exec',         'eqp-route-exec@example.com',         'Executive',       'active'),
  -- the person whose ROLE CHANGED away from spend authority but who is still on the project's raw approver list
  ('27650000-0000-0000-0000-0000000000a5', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Role Changed', 'eqp-route-role-changed@example.com', 'Engineer',        'active'),
  ('27650000-0000-0000-0000-0000000000a6', '27650000-0000-0000-0000-0000000000a0', 'EQP Route PM',           'eqp-route-pm@example.com',           'Project Manager', 'active'),
  ('27650000-0000-0000-0000-0000000000a7', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Disabled',     'eqp-route-disabled@example.com',     'Finance',         'disabled'),
  ('27650000-0000-0000-0000-0000000000a8', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Field',        'eqp-route-field@example.com',        'Engineer',        'active'),
  ('27650000-0000-0000-0000-0000000000b1', '27650000-0000-0000-0000-0000000000b0', 'EQP Route Foreign Admin','eqp-route-xadmin@example.com',       'Admin',           'active'),
  ('27650000-0000-0000-0000-0000000000b2', '27650000-0000-0000-0000-0000000000b0', 'EQP Route Foreign PM',   'eqp-route-xpm@example.com',          'Project Manager', 'active');
-- an app-disabled account is also banned in GoTrue: admin_set_user_status keeps the two in step
update auth.users set banned_until = '2999-12-31T23:59:59+00'::timestamptz where id = '27650000-0000-0000-0000-0000000000a7';
insert into projects (id, org_id, name, status) values
  ('27650000-0000-0000-0000-0000000000c1', '27650000-0000-0000-0000-0000000000a0', 'EQP Route Project', 'Ongoing Project'),
  ('27650000-0000-0000-0000-0000000000c3', '27650000-0000-0000-0000-0000000000b0', 'EQP Route Foreign', 'Ongoing Project');
insert into org_equipment_plan_settings (org_id, enabled, approval_step, allow_self_approval) values
  ('27650000-0000-0000-0000-0000000000a0', true, 'spend_approvers', false),
  ('27650000-0000-0000-0000-0000000000b0', true, 'spend_approvers', false);
-- plans made as the owner: the write RPCs are not what this file proves
insert into equipment_plans (id, org_id, project_id, plan_month, status, created_by) values
  ('27650000-0000-0000-0000-0000000000d1', '27650000-0000-0000-0000-0000000000a0', '27650000-0000-0000-0000-0000000000c1', '2026-01-01', 'Submitted', '27650000-0000-0000-0000-0000000000a2'),
  ('27650000-0000-0000-0000-0000000000d2', '27650000-0000-0000-0000-0000000000a0', '27650000-0000-0000-0000-0000000000c1', '2026-02-01', 'Draft',     '27650000-0000-0000-0000-0000000000a2'),
  ('27650000-0000-0000-0000-0000000000d3', '27650000-0000-0000-0000-0000000000b0', '27650000-0000-0000-0000-0000000000c3', '2026-01-01', 'Submitted', '27650000-0000-0000-0000-0000000000b2');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- The route's approver ids / roles, sorted: an identity set, not an order of arrival.
create or replace function pg_temp._ids(p jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(a->>'id' order by a->>'id'), '{}'::text[]) from jsonb_array_elements(p->'approvers') a;
$$;
grant execute on function pg_temp._ids(jsonb) to authenticated;
create or replace function pg_temp._roles(p jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(a->>'role' order by a->>'id'), '{}'::text[]) from jsonb_array_elements(p->'approvers') a;
$$;
grant execute on function pg_temp._roles(jsonb) to authenticated;

-- ── guards: a read every signed-in account may call, and nobody else ────────────────────────────────────────────────
select is((select p.prosecdef from pg_proc p where p.oid = 'public.get_equipment_plan_approval_route(uuid)'::regprocedure), false,
  'AC-EQP-008 the route read runs as the caller, so the plan''s own row-level policy decides what it can see');
select ok((select exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
             from pg_proc p where p.oid = 'public.get_equipment_plan_approval_route(uuid)'::regprocedure),
  'AC-EQP-008 and pins its search_path');
select ok(has_function_privilege('authenticated', 'public.get_equipment_plan_approval_route(uuid)', 'execute'),
  'AC-EQP-008 a signed-in account may call it');
select ok(not has_function_privilege('anon', 'public.get_equipment_plan_approval_route(uuid)', 'execute'),
  'AC-EQP-008 an anonymous caller may not');

set local role anon;
select throws_ok($$ select public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1') $$, '42501', null,
  'AC-EQP-008 an anonymous call is refused by the missing grant');
reset role;
set local role authenticated;

select pg_temp._as('27650000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1') $$, '42501',
  'EQP_DENIED: your account cannot read who approves this plan',
  'AC-EQP-008 a disabled account is told it cannot read the route, not shown an empty one');

-- ── no level configured: the Admin holds the step (DD-APR-4) ────────────────────────────────────────────────────────
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'admin',
  'AC-EQP-008 with no approver list the Admin holds the step');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a1']::text[], 'AC-EQP-008 and the route names that Admin');
select is(pg_temp._roles(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['Admin']::text[], 'AC-EQP-008 with the Admin role, read from the person, not a fixed list on the screen');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true,
  'AC-EQP-008 the decision function agrees for the person the route names');
select pg_temp._as('27650000-0000-0000-0000-0000000000a3');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 and refuses a Finance who is neither an approver nor an Admin');

-- ── the project names an approver: that list is the route, and the Admin is no longer it ─────────────────────────────
reset role;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('27650000-0000-0000-0000-0000000000a0', '27650000-0000-0000-0000-0000000000c1', '27650000-0000-0000-0000-0000000000a6');
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'project',
  'AC-EQP-008 a project list with an eligible approver is the level that answers');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a6']::text[], 'AC-EQP-008 and the route names that approver alone');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 with the project''s approver named, the Admin is not the approver and is not on the route');
select pg_temp._as('27650000-0000-0000-0000-0000000000a6');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true,
  'AC-EQP-008 the named project approver decides');
select pg_temp._as('27650000-0000-0000-0000-0000000000a4');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 an Executive outside the project''s list does not decide');

-- ── ⚑ a listed approver whose ROLE CHANGED still decides, and the route must say so ─────────────────────────────────
reset role;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('27650000-0000-0000-0000-0000000000a0', '27650000-0000-0000-0000-0000000000c1', '27650000-0000-0000-0000-0000000000a5');
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'project',
  'AC-EQP-008 the level stays the project''s while one listed member keeps spend authority');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a5', '27650000-0000-0000-0000-0000000000a6']::text[],
  'AC-EQP-008 the raw list is the route: the role-changed member is named too');
select is(pg_temp._roles(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['Engineer', 'Project Manager']::text[], 'AC-EQP-008 each named person carries their own CURRENT role');
select pg_temp._as('27650000-0000-0000-0000-0000000000a5');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true,
  'AC-EQP-008 the decision function still lets that role-changed member decide (raw list membership)');

-- ── only a role-changed member on the project list: that level does NOT answer (v_has is eligibility) ───────────────
reset role;
delete from spend_approvers where profile_id = '27650000-0000-0000-0000-0000000000a6';
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'admin',
  'AC-EQP-008 a project list with no eligible member hands the step to an Admin');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a1']::text[], 'AC-EQP-008 and the route names the Admin, not the role-changed member');
select pg_temp._as('27650000-0000-0000-0000-0000000000a5');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 and that member cannot decide while no level elects their list');

-- ── the organisation''s senior set ───────────────────────────────────────────────────────────────────────────────────
reset role;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('27650000-0000-0000-0000-0000000000a0', null, '27650000-0000-0000-0000-0000000000a4');
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'org',
  'AC-EQP-008 with no eligible project approver the organisation''s senior set answers');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a4']::text[], 'AC-EQP-008 and the route names that senior approver');
select pg_temp._as('27650000-0000-0000-0000-0000000000a4');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true,
  'AC-EQP-008 the senior approver decides');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 with a senior set configured an Admin is not the approver');
select pg_temp._as('27650000-0000-0000-0000-0000000000a5');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 nor is the role-changed project member');
select pg_temp._as('27650000-0000-0000-0000-0000000000a3');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 nor a Finance who is on no list');

-- ── a configured level with nobody eligible: an Admin, and the disabled member is named by neither ──────────────────
reset role;
update profiles set status = 'disabled' where id = '27650000-0000-0000-0000-0000000000a4';
update auth.users set banned_until = '2999-12-31T23:59:59+00'::timestamptz where id = '27650000-0000-0000-0000-0000000000a4';
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'admin',
  'AC-EQP-008 a senior set whose only member is disabled leaves the step to an Admin');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a1']::text[], 'AC-EQP-008 and never names the disabled member');
select pg_temp._as('27650000-0000-0000-0000-0000000000a4');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 the disabled (and banned) member cannot decide');

-- ── self-approval: the author is out of every route while it is off, and the empty answer is honest ──────────────────
reset role;
delete from spend_approvers;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('27650000-0000-0000-0000-0000000000a0', '27650000-0000-0000-0000-0000000000c1', '27650000-0000-0000-0000-0000000000a2');
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'project',
  'AC-EQP-009 a project list holding only the author still elects the project level');
select is(jsonb_array_length(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->'approvers'), 0,
  'AC-EQP-009 and the route is honestly empty: the author is excluded while self-approval is off');
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-009 the author cannot approve their own plan');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-009 and an Admin is not a fallback for a level that has a candidate SoD excludes');
reset role;
update org_equipment_plan_settings set allow_self_approval = true where org_id = '27650000-0000-0000-0000-0000000000a0';
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a2']::text[], 'AC-EQP-009 with self-approval on the author is the route');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true,
  'AC-EQP-009 and the decision function lets the author decide');
reset role;
update org_equipment_plan_settings set allow_self_approval = false where org_id = '27650000-0000-0000-0000-0000000000a0';
set local role authenticated;

-- ── the senior_role step: anyone whose role holds spend authority ───────────────────────────────────────────────────
reset role;
update org_equipment_plan_settings set approval_step = 'senior_role' where org_id = '27650000-0000-0000-0000-0000000000a0';
update profiles set status = 'active' where id = '27650000-0000-0000-0000-0000000000a4';
update auth.users set banned_until = null where id = '27650000-0000-0000-0000-0000000000a4';
delete from spend_approvers;
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'senior_role',
  'AC-EQP-008 on the senior-role step the route is the rank, not a list');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a1', '27650000-0000-0000-0000-0000000000a3',
        '27650000-0000-0000-0000-0000000000a4', '27650000-0000-0000-0000-0000000000a6']::text[],
  'AC-EQP-008 and names every active role that holds spend authority, the author and a below-rank role left out');
select is(pg_temp._roles(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['Admin', 'Finance', 'Executive', 'Project Manager']::text[], 'AC-EQP-008 with each person''s own role');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true, 'AC-EQP-008 the Admin decides on the senior-role step');
select pg_temp._as('27650000-0000-0000-0000-0000000000a3');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true, 'AC-EQP-008 Finance decides too');
select pg_temp._as('27650000-0000-0000-0000-0000000000a4');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true, 'AC-EQP-008 Executive decides too');
select pg_temp._as('27650000-0000-0000-0000-0000000000a6');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true, 'AC-EQP-008 Project Manager decides too');
select pg_temp._as('27650000-0000-0000-0000-0000000000a5');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 a role below spend authority does not decide on the senior-role step');
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-009 the author is out of the senior-role step while self-approval is off');

-- ── the organisation switch off ─────────────────────────────────────────────────────────────────────────────────────
reset role;
update org_equipment_plan_settings set enabled = false, approval_step = 'spend_approvers' where org_id = '27650000-0000-0000-0000-0000000000a0';
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'disabled',
  'AC-EQP-001 with the plan switched off the route says so');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')), '{}'::text[],
  'AC-EQP-001 with nobody named');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-001 and no Admin may decide either');
reset role;
update org_equipment_plan_settings set enabled = true where org_id = '27650000-0000-0000-0000-0000000000a0';
set local role authenticated;

-- ── only a Submitted plan is waiting ────────────────────────────────────────────────────────────────────────────────
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d2')->>'route_kind', 'not_waiting',
  'AC-EQP-008 a Draft plan waits for nobody');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d2')), '{}'::text[],
  'AC-EQP-008 and the route names nobody');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.approve_equipment_plan('27650000-0000-0000-0000-0000000000d2') $$, '55000',
  'EQP_STATE: only a submitted plan can be approved',
  'AC-EQP-008 the empty route is honest: the write refuses a Draft anyway');

-- ── tenancy and record visibility: not-visible answers exactly as not-there ─────────────────────────────────────────
select pg_temp._as('27650000-0000-0000-0000-0000000000b1');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'unavailable',
  'AC-EQP-015 another organisation''s Admin reads no route for our plan');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')), '{}'::text[],
  'AC-EQP-015 and no name of ours is revealed to them');
select is(public.get_equipment_plan_approval_route(gen_random_uuid()), public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1'),
  'AC-EQP-015 an id that does not exist answers exactly as a plan they may not see: no existence leak');
select pg_temp._as('27650000-0000-0000-0000-0000000000a1');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d3')->>'route_kind', 'unavailable',
  'AC-EQP-015 and our Admin reads no route for another organisation''s plan');

-- ── a disabled (and banned) member of the raw list is never named, and never decides ────────────────────────────────
reset role;
insert into spend_approvers (org_id, project_id, profile_id) values
  ('27650000-0000-0000-0000-0000000000a0', '27650000-0000-0000-0000-0000000000c1', '27650000-0000-0000-0000-0000000000a7'),
  ('27650000-0000-0000-0000-0000000000a0', '27650000-0000-0000-0000-0000000000c1', '27650000-0000-0000-0000-0000000000a6');
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a2');
select is(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')->>'route_kind', 'project',
  'AC-EQP-008 a project list with an eligible member still answers as the project''s');
select is(pg_temp._ids(public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1')),
  array['27650000-0000-0000-0000-0000000000a6']::text[], 'AC-EQP-008 the disabled listed member is left out of the route');
select pg_temp._as('27650000-0000-0000-0000-0000000000a7');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), false,
  'AC-EQP-008 and cannot decide (the decision function''s own active-member gate)');
select pg_temp._as('27650000-0000-0000-0000-0000000000a6');
select is(public.equipment_plan_approver_ok('27650000-0000-0000-0000-0000000000d1'), true,
  'AC-EQP-008 while the eligible listed approver decides');

-- ── a light (field) account: the read-side convention refuses it (1209) ─────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '', true);
update organizations set built_in_roles_enabled = true where id = '27650000-0000-0000-0000-0000000000a0';
update profiles set built_in_role = 'foreman' where id = '27650000-0000-0000-0000-0000000000a8';
set local role authenticated;
select pg_temp._as('27650000-0000-0000-0000-0000000000a8');
select throws_ok($$ select public.get_equipment_plan_approval_route('27650000-0000-0000-0000-0000000000d1') $$, '42501',
  'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this',
  'AC-EQP-008 a light account is refused the route, like every read-side function (1209)');

select * from finish();
rollback;
