-- 0222_api_client_request_guard.sql — the Data API surface for OAuth API clients (#728, DD-API-3).
--
-- Supabase Auth's OAuth 2.1 server issues ordinary user session tokens to registered clients (the
-- PMO CLI), marked with a `client_id` claim; browser sessions carry no such claim. RLS already
-- applies to those tokens exactly as to the user's browser. This adds a narrower control on WHICH
-- REST endpoints and methods a token with `client_id` may call (DD-API-3):
--   • GET   the allow-listed table endpoints, plus the read-only `profiles`;
--   • POST / PATCH the writable table endpoints;
--   • POST  the allow-listed RPCs;
-- in the `public` schema only. Every other method, endpoint, RPC or schema is refused with 42501
-- before the request runs. It governs the endpoint called, not what a read returns: an embedded
-- read (`select=id,related(...)`) follows RLS exactly as it does for the browser. It covers the
-- REST API (PostgREST) only. Requests without `client_id` (browser sessions, anon, service role)
-- pass through untouched.
--
-- Mechanism: PostgREST's pre-request function (`db-pre-request`), set as in-database configuration
-- on the `authenticator` role for THIS database, so it lives and dies with the database (a reset of
-- a database without this migration leaves no dangling setting behind).
--
-- The lists below are mirrored by the CLI (scripts/pmo.mjs ALLOWED_TABLES / READ_ONLY_TABLES /
-- ALLOWED_RPCS); scripts/pmo.test.mjs (AC-CLI-015) fails if the two drift.
-- Proof: supabase/tests/api_client_request_guard.test.sql.
--
-- Rollback (staged, not automatic): supabase/migrations/rollback/0222_api_client_request_guard_down.sql

create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles'];
  rpcs constant text[] := array['get_project_milestones'];
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

comment on function public.api_client_request_guard() is
  'PostgREST pre-request: limits tokens carrying a client_id claim (OAuth API clients) to the documented API surface (#728, DD-API-3). Other requests pass through.';

-- PostgREST calls the pre-request function as the request's role.
revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;

do $$
begin
  execute format(
    'alter role authenticator in database %I set pgrst.db_pre_request = %L',
    current_database(), 'public.api_client_request_guard');
end;
$$;

notify pgrst, 'reload config';
