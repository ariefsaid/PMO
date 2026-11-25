-- 2162_org_setup_workflow_settings.test.sql — the org opt-in is Admin-owned and default-off.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency) values
  ('21620000-0000-0000-0000-000000000001', 'Setup settings org', 'USD'),
  ('21620000-0000-0000-0000-000000000002', 'Setup settings other', 'USD');
insert into auth.users (id, email) values
  ('21620000-0000-0000-0000-0000000000a1', 'setup-admin@example.invalid'),
  ('21620000-0000-0000-0000-0000000000a2', 'setup-finance@example.invalid'),
  ('21620000-0000-0000-0000-0000000000a3', 'setup-pm@example.invalid'),
  ('21620000-0000-0000-0000-0000000000b1', 'setup-other-admin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21620000-0000-0000-0000-0000000000a1', '21620000-0000-0000-0000-000000000001', 'Setup Admin', 'setup-admin@example.invalid', 'Admin', 'active'),
  ('21620000-0000-0000-0000-0000000000a2', '21620000-0000-0000-0000-000000000001', 'Setup Finance', 'setup-finance@example.invalid', 'Finance', 'active'),
  ('21620000-0000-0000-0000-0000000000a3', '21620000-0000-0000-0000-000000000001', 'Setup PM', 'setup-pm@example.invalid', 'Project Manager', 'active'),
  ('21620000-0000-0000-0000-0000000000b1', '21620000-0000-0000-0000-000000000002', 'Setup Other Admin', 'setup-other-admin@example.invalid', 'Admin', 'active');

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
set local role authenticated;

select pg_temp.as_user('21620000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into public.org_setup_workflow_settings (enabled) values (true)$$, 'AC-SETUP-001 an Admin can enable setup workflows without sending org_id');
select is((select org_id from public.org_setup_workflow_settings), '21620000-0000-0000-0000-000000000001'::uuid, 'AC-SETUP-001 the database stamps the Admin''s own organisation');
reset role;
select pg_temp.as_user('21620000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.org_setup_workflow_settings), 1, 'AC-SETUP-001 an active organisation member can read the opt-in');
reset role;
select pg_temp.as_user('21620000-0000-0000-0000-0000000000a2');
select throws_ok($$insert into public.org_setup_workflow_settings (enabled) values (false)$$, '42501', null, 'AC-SETUP-001 Finance cannot enable or disable setup workflows');
update public.org_setup_workflow_settings set enabled = false;
select is((select enabled from public.org_setup_workflow_settings), true, 'AC-SETUP-001 Finance cannot update the Admin-owned opt-in');
reset role;
select pg_temp.as_user('21620000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.org_setup_workflow_settings), 0, 'AC-SETUP-001 another organisation cannot read this setting');
select lives_ok($$insert into public.org_setup_workflow_settings default values$$, 'AC-SETUP-001 a new organisation can retain the off default');
select is((select enabled from public.org_setup_workflow_settings), false, 'AC-SETUP-001 a missing choice defaults off');
select is((select org_id from public.org_setup_workflow_settings), '21620000-0000-0000-0000-000000000002'::uuid, 'AC-SETUP-001 the new row is stamped to the caller''s organisation');
reset role;
select ok(not has_table_privilege('anon', 'public.org_setup_workflow_settings', 'SELECT'), 'AC-SETUP-001 anon has no setting read grant');

select * from finish();
rollback;
