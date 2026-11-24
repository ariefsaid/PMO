begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name, default_currency, default_timezone) values
  ('22800000-0000-0000-0000-000000000001', 'Portfolio org', 'IDR', 'UTC'),
  ('22800000-0000-0000-0000-000000000002', 'Other org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('22800000-0000-0000-0000-0000000000a1', 'portfolio-exec@example.com'),
  ('22800000-0000-0000-0000-0000000000a2', 'portfolio-fin@example.com'),
  ('22800000-0000-0000-0000-0000000000a3', 'portfolio-pm@example.com'),
  ('22800000-0000-0000-0000-0000000000a4', 'portfolio-eng@example.com'),
  ('22800000-0000-0000-0000-0000000000b1', 'portfolio-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22800000-0000-0000-0000-0000000000a1', '22800000-0000-0000-0000-000000000001', 'Portfolio Exec', 'portfolio-exec@example.com', 'Executive', 'active'),
  ('22800000-0000-0000-0000-0000000000a2', '22800000-0000-0000-0000-000000000001', 'Portfolio Finance', 'portfolio-fin@example.com', 'Finance', 'active'),
  ('22800000-0000-0000-0000-0000000000a3', '22800000-0000-0000-0000-000000000001', 'Portfolio PM', 'portfolio-pm@example.com', 'Project Manager', 'active'),
  ('22800000-0000-0000-0000-0000000000a4', '22800000-0000-0000-0000-000000000001', 'Portfolio Engineer', 'portfolio-eng@example.com', 'Engineer', 'active'),
  ('22800000-0000-0000-0000-0000000000b1', '22800000-0000-0000-0000-000000000002', 'Portfolio foreign', 'portfolio-foreign@example.com', 'Executive', 'active');
insert into projects (id, org_id, name, status, contract_value, currency, tax_treatment, tax_amount) values
  ('22800000-0000-0000-0000-0000000000c1', '22800000-0000-0000-0000-000000000001', 'Portfolio one', 'Ongoing Project', 100, 'IDR', 'exclusive', 0),
  ('22800000-0000-0000-0000-0000000000c2', '22800000-0000-0000-0000-000000000001', 'Portfolio two', 'Ongoing Project', 100, 'IDR', 'exclusive', 0),
  ('22800000-0000-0000-0000-0000000000c3', '22800000-0000-0000-0000-000000000002', 'Foreign project', 'Ongoing Project', 100, 'IDR', 'exclusive', 0);
insert into project_milestones (id, org_id, project_id, name, target_date, weight, sort_order, input_pct) values
  ('22800000-0000-0000-0000-0000000000d1', '22800000-0000-0000-0000-000000000001', '22800000-0000-0000-0000-0000000000c1', 'Done', (now() at time zone 'UTC')::date - 10, 2, 1, 100),
  ('22800000-0000-0000-0000-0000000000d2', '22800000-0000-0000-0000-000000000001', '22800000-0000-0000-0000-0000000000c1', 'Late', (now() at time zone 'UTC')::date - 10, 1, 2, 50),
  ('22800000-0000-0000-0000-0000000000d3', '22800000-0000-0000-0000-000000000001', '22800000-0000-0000-0000-0000000000c1', 'Future', (now() at time zone 'UTC')::date + 10, 2, 3, 0),
  ('22800000-0000-0000-0000-0000000000d4', '22800000-0000-0000-0000-000000000001', '22800000-0000-0000-0000-0000000000c1', 'Undated', null, 1, 4, 0),
  ('22800000-0000-0000-0000-0000000000d5', '22800000-0000-0000-0000-000000000001', '22800000-0000-0000-0000-0000000000c2', 'No dates', null, 1, 1, null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"22800000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c1','22800000-0000-0000-0000-0000000000c2','22800000-0000-0000-0000-0000000000c3']::uuid[])), 2, 'AC-MV-001 returns only the caller organization projects');
select is((select done_count from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c1']::uuid[])), 1, 'AC-MV-001 a milestone at 100% counts as done');
select is((select late_count from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c1']::uuid[])), 1, 'AC-MV-001 a past-due milestone below 100% counts as late');
select is((select total_count from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c1']::uuid[])), 4, 'AC-MV-001 all milestones, including undated, are counted');
select is((select planned_pct::numeric(8,2) from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c1']::uuid[])), 66.67::numeric(8,2), 'AC-MV-001 planned progress interpolates between dated milestones with undated weight retained in the denominator');
select is((select planned_pct from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c2']::uuid[])), null::numeric, 'AC-MV-001 no dated milestones means planned progress is unknown');
reset role;
select is((select prosecdef from pg_proc where oid = 'public.project_management_overview(uuid[])'::regprocedure), false, 'AC-MV-001 read remains security invoker');
select is(has_function_privilege('anon', 'public.project_management_overview(uuid[])', 'execute'), false, 'AC-MV-001 anon cannot execute the read');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22800000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select * from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c1']::uuid[]) $$, '42501', 'not authorized', 'AC-MV-001 a Project Manager cannot read the executive portfolio RPC');
set local request.jwt.claims = '{"sub":"22800000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select * from public.project_management_overview(array['22800000-0000-0000-0000-0000000000c1']::uuid[]) $$, '42501', 'not authorized', 'AC-MV-001 an Engineer cannot read the executive portfolio RPC');
reset role;
select is(has_function_privilege('authenticated', 'public.project_management_overview(uuid[])', 'execute'), true, 'AC-MV-001 authenticated can execute the read');
select * from finish();
rollback;
