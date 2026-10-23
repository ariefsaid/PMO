-- api_client_purchase_surface.test.sql — 0363, the procurement-writer tier of the OAuth API-client guard (#1319).
-- Owns AC-PFE-018 (FR-PFE-062): an active Admin / Executive / Project Manager / Finance token may POST
-- link_erp_purchase_documents and link_procurement_sharepoint_item and GET erp_purchase_orphans; any other
-- role, or a disabled member, is refused; unlink stays app-only; the shipped surface keeps its answers.
-- Mutation checks: drop the role conjunct and the Engineer rows go red; drop 'Executive' and the Executive row goes
-- red; drop is_active_member() from either branch and the matching disabled-Finance row goes red.
begin;
select plan(14);

insert into organizations (id, name, default_currency) values ('03630000-0000-0000-0000-0000000000c0', 'API PFE', 'IDR');
insert into auth.users (id, email) values
  ('03630000-0000-0000-0000-0000000000c1', 'api-fin@example.com'),
  ('03630000-0000-0000-0000-0000000000c2', 'api-eng@example.com'),
  ('03630000-0000-0000-0000-0000000000c3', 'api-gone@example.com'),
  ('03630000-0000-0000-0000-0000000000c4', 'api-pm@example.com'),
  ('03630000-0000-0000-0000-0000000000c5', 'api-exec@example.com'),
  ('03630000-0000-0000-0000-0000000000c6', 'api-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03630000-0000-0000-0000-0000000000c1', '03630000-0000-0000-0000-0000000000c0', 'Fin', 'api-fin@example.com', 'Finance', 'active'),
  ('03630000-0000-0000-0000-0000000000c2', '03630000-0000-0000-0000-0000000000c0', 'Eng', 'api-eng@example.com', 'Engineer', 'active'),
  ('03630000-0000-0000-0000-0000000000c3', '03630000-0000-0000-0000-0000000000c0', 'Gone', 'api-gone@example.com', 'Finance', 'disabled'),
  ('03630000-0000-0000-0000-0000000000c4', '03630000-0000-0000-0000-0000000000c0', 'PM', 'api-pm@example.com', 'Project Manager', 'active'),
  ('03630000-0000-0000-0000-0000000000c5', '03630000-0000-0000-0000-0000000000c0', 'Exec', 'api-exec@example.com', 'Executive', 'active'),
  ('03630000-0000-0000-0000-0000000000c6', '03630000-0000-0000-0000-0000000000c0', 'Admin', 'api-admin@example.com', 'Admin', 'active');

create or replace function pg_temp.req(p_sub text, p_method text, p_path text)
returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
         set_config('request.method', p_method, true),
         set_config('request.path', p_path, true),
         set_config('request.headers', '{}', true);
$$;

set local role authenticated;

-- active Finance: the purchase tier is open
select pg_temp.req('03630000-0000-0000-0000-0000000000c1', 'POST', '/rpc/link_erp_purchase_documents');
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Finance token may POST the link RPC');
select pg_temp.req('03630000-0000-0000-0000-0000000000c1', 'POST', '/rpc/link_procurement_sharepoint_item');
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Finance token may POST the SharePoint RPC');
select pg_temp.req('03630000-0000-0000-0000-0000000000c1', 'GET', '/erp_purchase_orphans');
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Finance token may GET orphans');
select pg_temp.req('03630000-0000-0000-0000-0000000000c1', 'POST', '/rpc/unlink_erp_purchase_document');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 unlink stays app-only');
select pg_temp.req('03630000-0000-0000-0000-0000000000c1', 'POST', '/erp_purchase_orphans');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 the orphan list is read-only');

-- active Project Manager: same tier
select pg_temp.req('03630000-0000-0000-0000-0000000000c4', 'POST', '/rpc/link_erp_purchase_documents');
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Project Manager token may POST the link RPC');

-- active Executive and Admin: same tier
select pg_temp.req('03630000-0000-0000-0000-0000000000c5', 'POST', '/rpc/link_erp_purchase_documents');
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Executive token may POST the link RPC');
select pg_temp.req('03630000-0000-0000-0000-0000000000c6', 'POST', '/rpc/link_erp_purchase_documents');
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Admin token may POST the link RPC');

-- Engineer: refused
select pg_temp.req('03630000-0000-0000-0000-0000000000c2', 'POST', '/rpc/link_erp_purchase_documents');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 an Engineer token is refused');
select pg_temp.req('03630000-0000-0000-0000-0000000000c2', 'GET', '/erp_purchase_orphans');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 an Engineer token may not read orphans');
select pg_temp.req('03630000-0000-0000-0000-0000000000c2', 'POST', '/rpc/link_procurement_sharepoint_item');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 an Engineer token may not link a SharePoint item');

-- disabled Finance: refused
select pg_temp.req('03630000-0000-0000-0000-0000000000c3', 'POST', '/rpc/link_erp_purchase_documents');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 a disabled member token is refused');
select pg_temp.req('03630000-0000-0000-0000-0000000000c3', 'GET', '/erp_purchase_orphans');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 a disabled member token may not read orphans');

-- the shipped surface is unchanged
select pg_temp.req('03630000-0000-0000-0000-0000000000c2', 'GET', '/projects');
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 the shipped surface is unchanged');

reset role;
select * from finish();
rollback;
