-- roles_that_decide_function.test.sql — the deciding function holds_job_role (docs/specs/roles-that-decide.spec.md §2.1).
-- Migration under test: 1840_holds_job_role.sql.
-- AC-RTD-001 a holder fills its job role only; a person with no job role fills every job role built on their access level; inactive,
-- banned, null and unknown give false; a signed-in caller cannot call it.
-- The expected sets are an INDEPENDENT literal list (builtin-role-set.spec.md §2), never read from built_in_roles.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop "p.built_in_role is null and" from the mut:includes line ...... 'AC-RTD-001 a holder of storekeeper fills storekeeper only'
--   replace the mut:holds line with "p.role = built_in_role_base(p_job_role)" 'AC-RTD-001 a holder of storekeeper fills storekeeper only'
--   drop "public.is_active_member(p.id) and" ............................ 'AC-RTD-001 a disabled holder fills nothing'
--   grant execute on holds_job_role to authenticated .................... 'AC-RTD-001 a signed-in caller cannot call holds_job_role'
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('18400000-0000-0000-0000-00000000000a', 'RTD Org', 'IDR', 'Asia/Jakarta', true);
insert into auth.users (id, email, banned_until) values
  ('18400000-0000-0000-0000-0000000000a1', 'rtd-exec@example.com', null),
  ('18400000-0000-0000-0000-0000000000a2', 'rtd-admin@example.com', null),
  ('18400000-0000-0000-0000-0000000000a3', 'rtd-pm@example.com', null),
  ('18400000-0000-0000-0000-0000000000a4', 'rtd-eng@example.com', null),
  ('18400000-0000-0000-0000-0000000000a5', 'rtd-fin@example.com', null),
  ('18400000-0000-0000-0000-0000000000a6', 'rtd-store@example.com', null),
  ('18400000-0000-0000-0000-0000000000a7', 'rtd-store-off@example.com', null),
  ('18400000-0000-0000-0000-0000000000a8', 'rtd-store-banned@example.com', now() + interval '1 day');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18400000-0000-0000-0000-0000000000a1', '18400000-0000-0000-0000-00000000000a', 'RTD Exec',  'rtd-exec@example.com',  'Executive',       'active', null),
  ('18400000-0000-0000-0000-0000000000a2', '18400000-0000-0000-0000-00000000000a', 'RTD Admin', 'rtd-admin@example.com', 'Admin',           'active', null),
  ('18400000-0000-0000-0000-0000000000a3', '18400000-0000-0000-0000-00000000000a', 'RTD PM',    'rtd-pm@example.com',    'Project Manager', 'active', null),
  ('18400000-0000-0000-0000-0000000000a4', '18400000-0000-0000-0000-00000000000a', 'RTD Eng',   'rtd-eng@example.com',   'Engineer',        'active', null),
  ('18400000-0000-0000-0000-0000000000a5', '18400000-0000-0000-0000-00000000000a', 'RTD Fin',   'rtd-fin@example.com',   'Finance',         'active', null),
  ('18400000-0000-0000-0000-0000000000a6', '18400000-0000-0000-0000-00000000000a', 'RTD Store', 'rtd-store@example.com', 'Engineer',        'active', 'storekeeper'),
  ('18400000-0000-0000-0000-0000000000a7', '18400000-0000-0000-0000-00000000000a', 'RTD Off',   'rtd-store-off@example.com', 'Engineer',    'disabled', 'storekeeper'),
  ('18400000-0000-0000-0000-0000000000a8', '18400000-0000-0000-0000-00000000000a', 'RTD Ban',   'rtd-store-banned@example.com', 'Engineer', 'active', 'storekeeper');

-- the job roles each person fills, over the whole catalogue, as one sorted list
create function pg_temp._fills(p uuid) returns text language sql as $$
  select coalesce(string_agg(r.key, ',' order by r.key), '') from public.built_in_roles r where public.holds_job_role(p, r.key)
$$;
create function pg_temp._sorted(t text[]) returns text language sql as $$ select string_agg(x, ',' order by x) from unnest(t) x $$;

select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a1'), pg_temp._sorted(array['executive']),
  'AC-RTD-001 a no-job-role Executive fills the job roles built on Executive');
select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a2'), pg_temp._sorted(array['administrator']),
  'AC-RTD-001 a no-job-role Admin fills the job roles built on Admin');
select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a3'),
  pg_temp._sorted(array['project_manager','deputy_project_manager','project_control_manager','construction_manager',
                        'procurement_manager','quality_manager','safety_manager','equipment_manager','hr_manager']),
  'AC-RTD-001 a no-job-role Project Manager fills the job roles built on Project Manager');
select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a4'),
  pg_temp._sorted(array['project_administrator','engineer','planner','quantity_surveyor','site_supervisor','foreman',
                        'material_coordinator','storekeeper','buyer','quality_inspector','safety_officer','equipment_officer',
                        'hr_officer','field_user']),
  'AC-RTD-001 a no-job-role Engineer fills the job roles built on Engineer');
select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a5'),
  pg_temp._sorted(array['billing_officer','finance_manager','finance_officer']),
  'AC-RTD-001 a no-job-role Finance person fills the job roles built on Finance');
select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a6'), 'storekeeper',
  'AC-RTD-001 a holder of storekeeper fills storekeeper only');
select ok(not public.holds_job_role('18400000-0000-0000-0000-0000000000a6', 'material_coordinator'),
  'AC-RTD-001 a Storekeeper does not fill Material Coordinator although both are built on Engineer');
select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a7'), '', 'AC-RTD-001 a disabled holder fills nothing');
select is(pg_temp._fills('18400000-0000-0000-0000-0000000000a8'), '', 'AC-RTD-001 a banned holder fills nothing');
select is(public.holds_job_role('18400000-0000-0000-0000-0000000000a4', null), false, 'AC-RTD-001 a null job role is false');
select is(public.holds_job_role('18400000-0000-0000-0000-0000000000a4', 'nope'), false, 'AC-RTD-001 an unknown job role is false');
select is(public.holds_job_role('18400000-0000-0000-0000-0000000000ff', 'engineer'), false, 'AC-RTD-001 an unknown person is false');
select is((select count(*)::int from public.built_in_roles), 28, 'AC-RTD-001 the case table covers the whole catalogue');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '18400000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select throws_ok($$ select public.holds_job_role('18400000-0000-0000-0000-0000000000a6', 'storekeeper') $$, '42501', null,
  'AC-RTD-001 a signed-in caller cannot call holds_job_role');

select * from finish();
rollback;
