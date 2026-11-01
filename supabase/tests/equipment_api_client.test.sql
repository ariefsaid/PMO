-- equipment_api_client.test.sql — 0473 (#1519 S4). Owns AC-EQU-013: the OAuth API-client tiers for `pmo equipment`.
-- Same role sets as the RPCs' own checks (plan S4.6). Fixture F1 is docs/plans/2026-11-01-equipment-usage.md "Fixture F1".
begin;
create extension if not exists pgtap;
select plan(23);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15190000-0000-0000-0000-00000000000a', 'EQU Org',   'IDR', 'Asia/Jakarta'),
  ('15190000-0000-0000-0000-00000000000b', 'EQU Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15190000-0000-0000-0000-0000000000a1', 'equ-admin@example.com'),
  ('15190000-0000-0000-0000-0000000000a2', 'equ-fin@example.com'),
  ('15190000-0000-0000-0000-0000000000a3', 'equ-pm1@example.com'),   -- manages P1 and P3
  ('15190000-0000-0000-0000-0000000000a4', 'equ-pm2@example.com'),   -- manages P2
  ('15190000-0000-0000-0000-0000000000a5', 'equ-exec@example.com'),
  ('15190000-0000-0000-0000-0000000000a6', 'equ-eng1@example.com'),
  ('15190000-0000-0000-0000-0000000000a7', 'equ-eng2@example.com'),
  ('15190000-0000-0000-0000-0000000000b1', 'equ-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a1', '15190000-0000-0000-0000-00000000000a', 'EQU Admin', 'equ-admin@example.com', 'Admin', 'active'),
  ('15190000-0000-0000-0000-0000000000a2', '15190000-0000-0000-0000-00000000000a', 'EQU Fin',   'equ-fin@example.com',   'Finance', 'active'),
  ('15190000-0000-0000-0000-0000000000a3', '15190000-0000-0000-0000-00000000000a', 'EQU PM1',   'equ-pm1@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a4', '15190000-0000-0000-0000-00000000000a', 'EQU PM2',   'equ-pm2@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a5', '15190000-0000-0000-0000-00000000000a', 'EQU Exec',  'equ-exec@example.com',  'Executive', 'active'),
  ('15190000-0000-0000-0000-0000000000a6', '15190000-0000-0000-0000-00000000000a', 'EQU Eng1',  'equ-eng1@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000a7', '15190000-0000-0000-0000-00000000000a', 'EQU Eng2',  'equ-eng2@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000b1', '15190000-0000-0000-0000-00000000000b', 'EQU XOrg',  'equ-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15190000-0000-0000-0000-0000000000c1', '15190000-0000-0000-0000-00000000000a', 'EQU P1', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000c2', '15190000-0000-0000-0000-00000000000a', 'EQU P2', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a4'),
  ('15190000-0000-0000-0000-0000000000c3', '15190000-0000-0000-0000-00000000000a', 'EQU P3', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000cb', '15190000-0000-0000-0000-00000000000b', 'EQU PX', 'Ongoing Project', null);
-- A1 loader (hours), A2 truck (days), A3/A4 hire-rate machines (hours), A9 foreign (ids are hex: d1..d4, d9)
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-00000000000a', 'LDR-1', 'Loader 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d2', '15190000-0000-0000-0000-00000000000a', 'TRK-1', 'Truck 1',  'days'),
  ('15190000-0000-0000-0000-0000000000d3', '15190000-0000-0000-0000-00000000000a', 'GEN-1', 'Generator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d4', '15190000-0000-0000-0000-00000000000a', 'EXC-1', 'Excavator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d5', '15190000-0000-0000-0000-00000000000a', 'PMX-1', 'Payroll mix 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d6', '15190000-0000-0000-0000-00000000000a', 'SBY-1', 'Standby 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d7', '15190000-0000-0000-0000-00000000000a', 'TRP-1', 'Trips 1', 'days'),
  ('15190000-0000-0000-0000-0000000000d8', '15190000-0000-0000-0000-00000000000a', 'MID-1', 'Mid-month 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000da', '15190000-0000-0000-0000-00000000000a', 'ORD-1', 'Order 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000db', '15190000-0000-0000-0000-00000000000a', 'ORD-2', 'Order 2', 'hours'),
  ('15190000-0000-0000-0000-0000000000d9', '15190000-0000-0000-0000-00000000000b', 'LDR-X', 'Foreign loader', 'hours');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- approved usage straight into the table (superuser; allocation tests only — S1 tests drive the RPCs)
create or replace function pg_temp.usage(p_asset text, p_project text, p_date date, p_qty numeric, p_unit text,
                                         p_kind text default 'work', p_status text default 'Approved',
                                         p_fuel numeric default null, p_trips int default null) returns void language sql as $$
  insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, fuel_litres, trips,
                                       status, author_id, approver_id, approved_at)
  values ('15190000-0000-0000-0000-00000000000a', p_asset::uuid, p_project::uuid, p_date, p_qty, p_unit, p_kind, p_fuel, p_trips,
          p_status, '15190000-0000-0000-0000-0000000000a6',
          case when p_status in ('Approved','Rejected') then '15190000-0000-0000-0000-0000000000a3'::uuid end,
          case when p_status = 'Approved' then now() end);
$$;


create or replace function pg_temp.req(p_sub text, p_path text, p_method text default 'POST') returns void language sql as $$
select set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated','client_id','pmo-cli')::text,true),
set_config('request.method',p_method,true),set_config('request.path',p_path,true),set_config('request.headers','{}',true);$$;

set local role authenticated;
-- Finance: costing writes, allocations, usage totals
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/save_equipment_costing');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 a Finance API client may save');
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/end_equipment_costing');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 a Finance API client may end');
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/list_equipment_allocations');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 a Finance API client may list allocations');
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/list_equipment_costing');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 a Finance API client may list costing');
-- Admin
select pg_temp.req('15190000-0000-0000-0000-0000000000a1','/rpc/preview_equipment_costing');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 an Admin API client may preview');
-- Executive and Project Manager: reads only
select pg_temp.req('15190000-0000-0000-0000-0000000000a5','/rpc/list_equipment_allocations');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 an Executive API client may list allocations');
select pg_temp.req('15190000-0000-0000-0000-0000000000a5','/rpc/save_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 an Executive API client may not save');
select pg_temp.req('15190000-0000-0000-0000-0000000000a3','/rpc/list_equipment_allocations');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 a Project Manager API client may list allocations');
select pg_temp.req('15190000-0000-0000-0000-0000000000a3','/rpc/save_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 a Project Manager API client may not save');
select pg_temp.req('15190000-0000-0000-0000-0000000000a3','/rpc/end_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 a Project Manager API client may not end');
select pg_temp.req('15190000-0000-0000-0000-0000000000a3','/rpc/preview_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 a Project Manager API client may not preview');
-- Engineer: usage totals only
select pg_temp.req('15190000-0000-0000-0000-0000000000a6','/rpc/save_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 an Engineer API client may not save');
select pg_temp.req('15190000-0000-0000-0000-0000000000a6','/rpc/preview_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 an Engineer API client may not preview');
select pg_temp.req('15190000-0000-0000-0000-0000000000a6','/rpc/list_equipment_allocations');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 an Engineer API client may not list allocations (amounts)');
select pg_temp.req('15190000-0000-0000-0000-0000000000a6','/rpc/list_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 an Engineer API client may not list costing');
select pg_temp.req('15190000-0000-0000-0000-0000000000a6','/rpc/list_equipment_usage_totals');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 an Engineer API client may list usage totals');
select pg_temp.req('15190000-0000-0000-0000-0000000000a3','/rpc/list_equipment_usage_totals');
select lives_ok('select public.api_client_request_guard()', 'AC-EQU-013 a Project Manager API client may list usage totals');
-- the usage-logging RPCs are not part of any API tier (the CLI does not log or approve usage)
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/save_equipment_usage');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 usage logging is not an API-client surface');
select pg_temp.req('15190000-0000-0000-0000-0000000000a3','/rpc/transition_equipment_usage');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 usage approval is not an API-client surface');
-- the tiers need POST (an RPC is not reachable by GET)
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/save_equipment_costing','GET');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 the write tier needs POST');
-- an inactive Finance user is refused
reset role;
update profiles set status = 'disabled' where id = '15190000-0000-0000-0000-0000000000a2';
set local role authenticated;
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/save_equipment_costing');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 a disabled Finance user''s API client may not save');
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/list_equipment_usage_totals');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 a disabled user''s API client may not list usage totals');
select pg_temp.req('15190000-0000-0000-0000-0000000000a2','/rpc/list_equipment_allocations');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-EQU-013 a disabled Finance user''s API client may not list allocations');
reset role;

select * from finish();
rollback;
