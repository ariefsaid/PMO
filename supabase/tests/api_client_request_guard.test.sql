-- api_client_request_guard.test.sql — the Data API surface for OAuth API clients (#728, DD-API-3).
--
-- Migration 0222 installs public.api_client_request_guard() as PostgREST's pre-request function. A
-- request whose JWT carries a `client_id` claim (a token issued by Supabase Auth's OAuth server to a
-- registered client, e.g. the PMO CLI) may only: GET the allow-listed tables (incl. read-only
-- profiles), POST/PATCH the writable ones, POST the allow-listed RPCs. Everything else is refused
-- with 42501. A request WITHOUT `client_id` (the app's browser sessions, anon, service role) is
-- untouched. The CLI's own allow-list mirrors the function's (scripts/pmo.test.mjs AC-CLI-015).
--
-- PostgREST sets request.method / request.path / request.headers / request.jwt.claims per request
-- (transaction-local); this test sets the same settings and calls the function as `authenticated`.
begin;
select plan(29);

create or replace function pg_temp.req(p_claims text, p_method text, p_path text, p_headers text default '{}')
returns void language sql as $$
  select set_config('request.jwt.claims', p_claims, true),
         set_config('request.method', p_method, true),
         set_config('request.path', p_path, true),
         set_config('request.headers', p_headers, true);
$$;

-- ── installation ─────────────────────────────────────────────────────────────────────────────────
select ok(
  exists (
    select 1 from pg_db_role_setting s
      join pg_roles r on r.oid = s.setrole
      join pg_database d on d.oid = s.setdatabase
     where r.rolname = 'authenticator' and d.datname = current_database()
       and 'pgrst.db_pre_request=public.api_client_request_guard' = any (s.setconfig)),
  'AC-CLI-015 PostgREST runs public.api_client_request_guard before every request (authenticator, this database)');
select ok(
  not (select prosecdef from pg_proc where oid = 'public.api_client_request_guard()'::regprocedure),
  'AC-CLI-015 the guard runs as the caller (SECURITY INVOKER) — it reads request settings only');
select ok(
  (select proconfig from pg_proc where oid = 'public.api_client_request_guard()'::regprocedure) @> array['search_path=""'],
  'AC-CLI-015 the guard pins an empty search_path');
select ok(
  has_function_privilege('anon', 'public.api_client_request_guard()', 'execute')
    and has_function_privilege('authenticated', 'public.api_client_request_guard()', 'execute')
    and has_function_privilege('service_role', 'public.api_client_request_guard()', 'execute'),
  'AC-CLI-015 every API role can execute the guard (else every request would fail)');

set local role authenticated;

-- ── OAuth API client (client_id present) ─────────────────────────────────────────────────────────
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/projects');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 client: GET an allow-listed table');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/profiles');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 client: GET the read-only profiles');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/budget_lines');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: GET a table outside the allow-list is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'POST', '/tasks');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 client: POST a writable table');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'PATCH', '/project_milestones');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 client: PATCH a writable table');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'POST', '/profiles');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: POST the read-only profiles is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'PATCH', '/profiles');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: PATCH the read-only profiles is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'DELETE', '/tasks');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: DELETE is refused, even on a writable table');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'PUT', '/tasks');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: PUT is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'POST', '/sales_invoices');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: POST a table outside the allow-list is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'POST', '/rpc/get_project_milestones');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 client: POST an allow-listed RPC');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/rpc/get_project_milestones');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: an allow-listed RPC only by POST');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'POST', '/rpc/transition_project');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: an RPC outside the allow-list is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'POST', '/rpc/activate_budget_version');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: budget activation is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: the API root is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/projects/extra');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: a path beyond one table name is refused');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/projects', '{"accept-profile":"graphql_public"}');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: a schema other than public is refused (Accept-Profile)');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'POST', '/tasks', '{"content-profile":"graphql_public"}');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: a schema other than public is refused (Content-Profile)');
select pg_temp.req('{"role":"authenticated","client_id":"c1"}', 'GET', '/projects', '{"accept-profile":"public"}');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 client: naming the public schema explicitly is fine');
select pg_temp.req('{"role":"authenticated","client_id":""}', 'DELETE', '/tasks');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CLI-015 client: an empty client_id still counts as a client (fails closed)');

-- ── everyone else (no client_id): untouched ──────────────────────────────────────────────────────
select pg_temp.req('{"role":"authenticated","session_id":"s1"}', 'DELETE', '/tasks');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 browser session: DELETE is not the guard''s business (RLS decides)');
select pg_temp.req('{"role":"authenticated","session_id":"s1"}', 'POST', '/rpc/transition_project');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 browser session: any RPC passes the guard');
select pg_temp.req('{"role":"authenticated","session_id":"s1"}', 'GET', '/budget_lines');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 browser session: any table passes the guard');
select pg_temp.req('{"role":"anon"}', 'POST', '/rpc/graphql');
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 anon: passes the guard');
select set_config('request.jwt.claims', '', true);
select lives_ok('select public.api_client_request_guard()', 'AC-CLI-015 no claims at all: passes the guard');

reset role;
select * from finish();
rollback;
