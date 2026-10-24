-- 0370 link a SharePoint source file to a budget version (CLI `pmo budgets activate --source`; #1270 B).
-- Rollback: supabase/migrations/rollback/0370_cli_ops_writes_down.sql
-- The app writes this table directly (0292 grants + insert policy); the API client cannot, so the CLI gets one
-- RPC with the same predicate: active member, Admin/Executive/Project Manager/Finance, own org, Draft version.
-- Activation itself is NOT touched, and the API-client guard gets NO activate_budget_version tier (owner has not ruled):
-- the CLI refuses activation up front.
-- The guard below is rebuilt from the 0367 body (every 0363/0364/0366/0367 tier kept); lines marked `-- 0370` are new:
-- POST budget_activation_mode + link_budget_version_sharepoint_item (active Admin/Executive/PM/Finance, as the RPCs
-- themselves), GET/POST budget_category_account_map and POST set_budget_push_account (active Admin).
create function public.link_budget_version_sharepoint_item(p_version_id uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_status public.budget_status;
  v_id uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change evidence on this budget version.' using errcode = '42501';
  end if;
  select v.status into v_status from public.budget_versions v where v.id = p_version_id and v.org_id = v_org for update;
  if not found then
    raise exception 'budget version not found' using errcode = 'P0002';
  end if;
  if v_status <> 'Draft' then
    raise exception 'A source file can only be attached to a Draft budget version.' using errcode = 'P0001';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object'
     or coalesce(p_item->>'kind', '') not in ('file','folder')
     or coalesce(btrim(p_item->>'drive_id'), '') = '' or coalesce(btrim(p_item->>'item_id'), '') = ''
     or coalesce(btrim(p_item->>'name'), '') = '' or not public.m365_browser_url_valid(p_item->>'web_url') then
    raise exception 'A SharePoint item needs drive_id, item_id, web_url (https), name and kind (file or folder).' using errcode = '22023';
  end if;
  -- Linking the same item twice is a no-op, so a retried command does not stack duplicate evidence.
  select l.id into v_id from public.budget_version_document_links l
   where l.budget_version_id = p_version_id and l.ms_drive_id = p_item->>'drive_id' and l.ms_item_id = p_item->>'item_id';
  if found then return v_id; end if;
  insert into public.budget_version_document_links (org_id, budget_version_id, ms_drive_id, ms_item_id, ms_web_url, ms_item_name, ms_item_kind)
  values (v_org, p_version_id, p_item->>'drive_id', p_item->>'item_id', p_item->>'web_url', p_item->>'name', p_item->>'kind')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.link_budget_version_sharepoint_item(uuid, jsonb) from public, anon;
grant execute on function public.link_budget_version_sharepoint_item(uuid, jsonb) to authenticated;

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
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item'];
  purchase_read_views constant text[] := array['erp_purchase_orphans', 'erp_purchase_orphans_all'];  -- 0364
  -- ADMIN/FINANCE TIER (`pmo purchases set-aside`, #1319 AC-13)  -- 0364
  set_aside_rpcs constant text[] := array['mark_erp_purchase_documents'];  -- 0364
  -- ACTIVE-ADMIN `pmo rpc` TIER (#1326) — keep in step with scripts/pmo.mjs ADMIN_RPCS.  -- 0366
  admin_cli_rpcs constant text[] := array['recategorise_budget_lines'];  -- 0366
  -- OPERATOR READ TIER (`pmo get/documents/m365`, #1270) — keep in step with scripts/pmo.mjs.  -- 0367
  operator_read_tables constant text[] := array['budget_versions', 'budget_line_items', 'budget_category_account_map', 'erp_gl_entry_mirror', 'project_documents', 'org_m365_document_settings', 'm365_record_folder_sweeps'];  -- 0367
  operator_read_rpcs constant text[] := array['project_mapped_actuals', 'link_m365_documents_batch'];  -- 0367
  -- BUDGET OPS TIER (`pmo budgets activate --source`, #1270 B): the activation check and the Draft source-file link.
  -- Same role set as those RPCs' own checks. activate_budget_version is deliberately NOT here (owner has not ruled).  -- 0370
  budget_ops_rpcs constant text[] := array['budget_activation_mode', 'link_budget_version_sharepoint_item'];  -- 0370
  -- ACTIVE-ADMIN ACCOUNT-MAP TIER (`pmo accounts map set`, #1270 B) — the same Admin rule as the table's own policy.  -- 0370
  account_map_tables constant text[] := array['budget_category_account_map'];  -- 0370
  account_map_rpcs constant text[] := array['set_budget_push_account'];  -- 0370
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
    if method = 'POST' and target = any (purchase_rpcs) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (operator_read_rpcs) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'POST' and target = any (budget_ops_rpcs) then  -- 0370
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (account_map_rpcs) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
    if method = 'POST' and target = any (admin_cli_rpcs) then  -- 0366
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0366
        return;  -- 0366
      end if;  -- 0366
    end if;  -- 0366
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
    if method in ('GET', 'POST') and target = any (account_map_tables) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'GET' and target = any (operator_read_tables) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'GET' and target = any (purchase_read_views) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;
