-- 0363_api_client_purchase_surface.sql — the OAuth API-client guard gains a procurement-writer tier for
-- `pmo purchases` (#1319, FR-PFE-062). An active Admin, Executive, Project Manager or Finance token may POST
-- link_erp_purchase_documents and link_procurement_sharepoint_item and GET erp_purchase_orphans. Owner ruling
-- 2026-10-23 overrides DD-API-3 for these three endpoints: none writes to ERPNext or moves money, and each RPC keeps
-- its own org, membership, role and SoD checks. Everything else is 0337's body unchanged (lines marked 0363 are new).
-- The guard stays SECURITY INVOKER: no new definer (0178's list is unchanged).
-- Proof: supabase/tests/api_client_purchase_surface.test.sql (AC-PFE-018) + api_client_request_guard.test.sql +
-- api_client_seed_surface.test.sql. CLI parity: scripts/pmo-purchases.test.mjs (AC-PFE-018).
-- Rollback: supabase/migrations/rollback/0363_api_client_purchase_surface_down.sql (re-creates 0337's body).
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
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.  -- 0363
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item'];  -- 0363
  purchase_read_views constant text[] := array['erp_purchase_orphans'];  -- 0363
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

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
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
    if method = 'POST' and target = any (purchase_rpcs) then  -- 0363
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0363
        return;  -- 0363
      end if;  -- 0363
    end if;  -- 0363
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
    if method = 'GET' and target = any (purchase_read_views) then  -- 0363
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0363
        return;  -- 0363
      end if;  -- 0363
    end if;  -- 0363
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;
notify pgrst, 'reload config';
