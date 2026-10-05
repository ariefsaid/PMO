-- api_client_seed_surface.test.sql — the active-Admin tier of the OAuth API-client guard (#796, ADR-0074).
-- Migration 0232: a token carrying `client_id` may POST set_project_contract_value / transition_project and
-- GET/POST budget_versions / budget_line_items ONLY when its user is an active Admin; any such token may
-- GET external_domain_ownership. Everything else stays as 0222 left it (42501).
-- Mutation check (Task 17): make the Admin conditional `if true` and the four non-Admin rows must go red.
begin;
select plan(16);

insert into auth.users (id, email) values
  ('07960000-0000-0000-0000-0000000000a1', 'load-admin@example.com'),
  ('07960000-0000-0000-0000-0000000000a2', 'load-pm@example.com'),
  ('07960000-0000-0000-0000-0000000000a3', 'load-gone@example.com');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('07960000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Load Admin', 'load-admin@example.com', 'Admin', 'active'),
  ('07960000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Load PM', 'load-pm@example.com', 'Project Manager', 'active'),
  ('07960000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Load Gone', 'load-gone@example.com', 'Admin', 'disabled');

create or replace function pg_temp.req(p_sub text, p_method text, p_path text)
returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'c1')::text, true),
         set_config('request.method', p_method, true),
         set_config('request.path', p_path, true),
         set_config('request.headers', '{}', true);
$$;

set local role authenticated;

-- active Admin: the load tier is open
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/set_project_contract_value');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST set_project_contract_value');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/transition_project');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST transition_project');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'GET', '/budget_versions');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: GET budget_versions');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/budget_versions');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST budget_versions');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/budget_line_items');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 active Admin client: POST budget_line_items');

-- active Admin: still closed
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'PATCH', '/budget_line_items');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: PATCH budget_line_items refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'DELETE', '/budget_versions');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: DELETE budget_versions refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/activate_budget_version');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: budget activation stays in the app');
select pg_temp.req('07960000-0000-0000-0000-0000000000a1', 'POST', '/rpc/set_work_order_value');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Admin client: work orders stay in the app');

-- not an active Admin: refused
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/rpc/transition_project');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Project Manager client: transition_project refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/budget_versions');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 Project Manager client: POST budget_versions refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a3', 'POST', '/rpc/set_project_contract_value');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 disabled Admin client: set_project_contract_value refused');
select pg_temp.req('07960000-0000-0000-0000-0000000000a3', 'GET', '/budget_line_items');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 disabled Admin client: GET budget_line_items refused');

-- any client: read which external system owns which domain, never write it
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'GET', '/external_domain_ownership');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 any client: GET external_domain_ownership');
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/external_domain_ownership');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CSD-013 any client: POST external_domain_ownership refused');

-- the 0222 surface is unchanged
select pg_temp.req('07960000-0000-0000-0000-0000000000a2', 'POST', '/projects');
select lives_ok('select public.api_client_request_guard()', 'AC-CSD-013 the generic surface still works for a non-Admin client');

reset role;
select * from finish();
rollback;
