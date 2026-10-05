-- 0239_api_client_seed_surface.sql — an active-Admin tier in the OAuth API-client guard for `pmo load`
-- (#796, ADR-0074, spec docs/specs/client-starting-data-cli.spec.md). Amends 0222.
--
-- OD-SEED-5 lets the owner load a client's won projects at their real stage, with contract value, and
-- draft budgets, without the Director. Every write that needs already exists and is enforced in the
-- database (RLS inserts; set_project_contract_value / transition_project with their org, role, SoD and
-- audit rules; the 0176 Draft-only trigger; the 0195 import-key index). This only widens WHICH
-- ENDPOINTS a token with `client_id` may reach:
--   • for an ACTIVE ADMIN only: POST /rpc/set_project_contract_value, POST /rpc/transition_project,
--     GET/POST budget_versions and budget_line_items;
--   • for every such token: GET external_domain_ownership (read-only).
-- Still refused to every client, Admin included: PATCH/DELETE on the budget tables,
-- activate_budget_version, work-order and money RPCs. Browser sessions (no client_id) are untouched.
--
-- The Admin test reads the caller's LIVE profile, so a demoted or offboarded owner loses the tier at the
-- next request. It runs only for the tier's own endpoints (nested IF: no lookup on any other request).
--
-- Lists mirrored by scripts/pmo.mjs (ALLOWED_TABLES / READ_ONLY_TABLES / ALLOWED_RPCS / LOAD_TABLES /
-- LOAD_RPCS); scripts/pmo.test.mjs (AC-CLI-015, AC-CSD-014) fails if they drift.
-- Proof: supabase/tests/api_client_seed_surface.test.sql (AC-CSD-013) + api_client_request_guard.test.sql.
-- Rollback (staged, not automatic): supabase/migrations/rollback/0239_api_client_seed_surface_down.sql

create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
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
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

comment on function public.api_client_request_guard() is
  'PostgREST pre-request: limits tokens carrying a client_id claim (OAuth API clients) to the documented API surface (#728, DD-API-3), plus an active-Admin tier for pmo load (#796, ADR-0074). Other requests pass through.';

-- Grants unchanged from 0222 (create or replace keeps them); restated so this file is self-describing.
revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;

notify pgrst, 'reload config';
