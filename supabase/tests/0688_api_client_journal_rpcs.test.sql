-- 0688 AC-JEC-017 (API tier): the procurement-writer API client may attach journal lines and read a project's lines,
-- never detach; an Engineer client is refused; non-listed RPCs stay refused.
begin;
select plan(6);

insert into organizations (id, name, default_currency) values ('06880000-0000-0000-0000-00000000000a','JAPI A','IDR');
insert into auth.users (id, email) values
  ('06880000-0000-0000-0000-0000000000a1','japi-fin@example.com'), ('06880000-0000-0000-0000-0000000000a2','japi-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06880000-0000-0000-0000-0000000000a1','06880000-0000-0000-0000-00000000000a','Fin','japi-fin@example.com','Finance','active'),
  ('06880000-0000-0000-0000-0000000000a2','06880000-0000-0000-0000-00000000000a','Eng','japi-eng@example.com','Engineer','active');

create function pg_temp.req(p_sub text, p_path text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
         set_config('request.method', 'POST', true), set_config('request.path', p_path, true), set_config('request.headers', '{}', true);
$$;

set local role authenticated;
select pg_temp.req('06880000-0000-0000-0000-0000000000a1', '/rpc/attach_erp_journal_lines');
select lives_ok('select public.api_client_request_guard()', 'AC-JEC-017 a Finance API client may attach journal lines');
select pg_temp.req('06880000-0000-0000-0000-0000000000a1', '/rpc/project_erp_journal_lines');
select lives_ok('select public.api_client_request_guard()', 'AC-JEC-017 a Finance API client may read a project''s journal lines');
select pg_temp.req('06880000-0000-0000-0000-0000000000a1', '/rpc/detach_erp_journal_line');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-JEC-017 detach is not exposed to API clients');
select pg_temp.req('06880000-0000-0000-0000-0000000000a1', '/rpc/erp_journal_cost_lines');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-JEC-017 the internal line function is not exposed');
select pg_temp.req('06880000-0000-0000-0000-0000000000a2', '/rpc/attach_erp_journal_lines');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-JEC-017 an Engineer API client is refused');
select pg_temp.req('06880000-0000-0000-0000-0000000000a1', '/rpc/link_erp_purchase_documents');
select lives_ok('select public.api_client_request_guard()', 'AC-JEC-017 the existing purchase-link RPC is still allowed');

select * from finish();
rollback;
