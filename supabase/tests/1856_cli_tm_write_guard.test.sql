-- 1856 AC-CTM-003 (server side): a command-line sign-in (a token with a client_id claim) may POST the T&M writers only as an
-- active Admin or Finance member. A Project Manager, Executive, Engineer or inactive member is refused 42501 by the SHIPPED
-- api_client_request_guard(); an app session (no client_id) is untouched. The CLI's own role gate (scripts/lib/pmo-tm-write.mjs)
-- only refuses earlier; this proves the database holds the line. The writers' own role and separation-of-duties rules stay
-- proved by tm_rates, tm_assembly and tm_signoff.
begin;
select plan(8);

insert into organizations (id, name, default_currency) values ('18560000-0000-0000-0000-00000000000a', 'CTM write guard org', 'IDR');
insert into auth.users (id, email) values
  ('18560000-0000-0000-0000-0000000000a1', 'ctmw-admin@example.com'), ('18560000-0000-0000-0000-0000000000a2', 'ctmw-fin@example.com'),
  ('18560000-0000-0000-0000-0000000000a3', 'ctmw-pm@example.com'), ('18560000-0000-0000-0000-0000000000a4', 'ctmw-exec@example.com'),
  ('18560000-0000-0000-0000-0000000000a5', 'ctmw-eng@example.com'), ('18560000-0000-0000-0000-0000000000a6', 'ctmw-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18560000-0000-0000-0000-0000000000a1', '18560000-0000-0000-0000-00000000000a', 'Admin', 'ctmw-admin@example.com', 'Admin', 'active'),
  ('18560000-0000-0000-0000-0000000000a2', '18560000-0000-0000-0000-00000000000a', 'Fin', 'ctmw-fin@example.com', 'Finance', 'active'),
  ('18560000-0000-0000-0000-0000000000a3', '18560000-0000-0000-0000-00000000000a', 'PM', 'ctmw-pm@example.com', 'Project Manager', 'active'),
  ('18560000-0000-0000-0000-0000000000a4', '18560000-0000-0000-0000-00000000000a', 'Exec', 'ctmw-exec@example.com', 'Executive', 'active'),
  ('18560000-0000-0000-0000-0000000000a5', '18560000-0000-0000-0000-00000000000a', 'Eng', 'ctmw-eng@example.com', 'Engineer', 'active'),
  ('18560000-0000-0000-0000-0000000000a6', '18560000-0000-0000-0000-00000000000a', 'Off', 'ctmw-off@example.com', 'Finance', 'disabled');

create function pg_temp.passes(p_sub text, p_method text, p_path text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
          set_config('request.method', p_method, true), set_config('request.path', p_path, true), set_config('request.headers', '{}', true);
  perform public.api_client_request_guard();
  return true;
exception when sqlstate '42501' then
  return false;
end $$;

-- Every T&M writer the CLI's `pmo tm` commands call (the shipped tm_write_rpcs tier).
create temp table writers (path text primary key);
grant select on writers to authenticated;
insert into writers values
  ('/rpc/save_contract_rate_line'), ('/rpc/end_contract_rate_line'), ('/rpc/set_contract_rate_assignee'), ('/rpc/end_contract_rate_assignee'),
  ('/rpc/assemble_tm_claim'), ('/rpc/deselect_tm_source'), ('/rpc/prepare_tm_signoff'), ('/rpc/withdraw_tm_signoff'), ('/rpc/confirm_tm_signoff');

set local role authenticated;
select is(array(select path from writers where not pg_temp.passes('18560000-0000-0000-0000-0000000000a1', 'POST', path) order by 1), '{}'::text[],
  'AC-CTM-003 client: an active Admin passes every T&M writer');
select is(array(select path from writers where not pg_temp.passes('18560000-0000-0000-0000-0000000000a2', 'POST', path) order by 1), '{}'::text[],
  'AC-CTM-003 client: an active Finance member passes every T&M writer');
select is(array(select path from writers where pg_temp.passes('18560000-0000-0000-0000-0000000000a3', 'POST', path) order by 1), '{}'::text[],
  'AC-CTM-003 client: a Project Manager is refused every T&M writer');
select is(array(select path from writers where pg_temp.passes('18560000-0000-0000-0000-0000000000a4', 'POST', path) order by 1), '{}'::text[],
  'AC-CTM-003 client: an Executive is refused every T&M writer');
select is(array(select path from writers where pg_temp.passes('18560000-0000-0000-0000-0000000000a5', 'POST', path) order by 1), '{}'::text[],
  'AC-CTM-003 client: an Engineer is refused every T&M writer');
select is(array(select path from writers where pg_temp.passes('18560000-0000-0000-0000-0000000000a6', 'POST', path) order by 1), '{}'::text[],
  'AC-CTM-003 client: a disabled Finance member is refused every T&M writer');
select is(array(select path from writers where pg_temp.passes('18560000-0000-0000-0000-0000000000a1', 'GET', path) order by 1), '{}'::text[],
  'AC-CTM-003 client: the writers are POST-only, even for an active Admin');
select set_config('request.jwt.claims', '{"role":"authenticated","session_id":"s1"}', true), set_config('request.method', 'POST', true),
       set_config('request.path', '/rpc/assemble_tm_claim', true), set_config('request.headers', '{}', true);
select lives_ok('select public.api_client_request_guard()', 'AC-CTM-003 browser session: a T&M writer passes the guard (no client_id)');

reset role;
select * from finish();
rollback;
