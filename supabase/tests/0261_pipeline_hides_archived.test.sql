-- AC-PRJ-005a: get_sales_pipeline() includes live projects and excludes archived projects.
begin;
select plan(2);

insert into organizations (id, name) values
  ('02610000-0000-0000-0000-000000000001', 'Archived Pipeline Test Org (0261)');

insert into auth.users (id, email) values
  ('02610000-0000-0000-0000-0000000000a1', 'exec@pipeline0261.example');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('02610000-0000-0000-0000-0000000000a1', '02610000-0000-0000-0000-000000000001',
   'Exec 0261', 'exec@pipeline0261.example', 'Executive', 'active');

insert into pipeline_stage_config (org_id, status, win_probability) values
  ('02610000-0000-0000-0000-000000000001', 'Leads', 0.100);

insert into projects (id, org_id, name, status, project_manager_id, contract_value,
                      tax_treatment, tax_amount, archived_at) values
  ('26100000-0000-0000-0000-000000000001', '02610000-0000-0000-0000-000000000001',
   'Live pipeline project', 'Leads', '02610000-0000-0000-0000-0000000000a1', 1000,
   'exclusive', 0, null),
  ('26100000-0000-0000-0000-000000000002', '02610000-0000-0000-0000-000000000001',
   'Archived pipeline project', 'Leads', '02610000-0000-0000-0000-0000000000a1', 2000,
   'exclusive', 0, now());

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"02610000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok(
  exists (
    select 1
      from json_array_elements(public.get_sales_pipeline()->'projects') project
     where project->>'id' = '26100000-0000-0000-0000-000000000001'
  ),
  'AC-PRJ-005a a live project is present in the sales pipeline');

select ok(
  not exists (
    select 1
      from json_array_elements(public.get_sales_pipeline()->'projects') project
     where project->>'id' = '26100000-0000-0000-0000-000000000002'
  ),
  'AC-PRJ-005a an archived project is absent from the sales pipeline');

select * from finish();
rollback;
