-- 0370 CLI ops writes (#1270 B): API-client guard tiers for `pmo budgets` and `pmo accounts map set`, and the SharePoint
-- host pin on link_procurement_sharepoint_item.
-- Rollback: supabase/migrations/rollback/0370_cli_ops_writes_down.sql
--
-- The API-client guard gets NO activate_budget_version tier (owner has not ruled): the CLI refuses activation up front.
-- A Draft budget version's source file is linked through link_m365_documents_batch (0367), which already pins links to
-- the organisation's own SharePoint host; no new definer is added.
-- The guard below is rebuilt from the 0367 body (every 0363/0364/0366/0367 tier kept); lines marked `-- 0370` are new:
-- POST budget_activation_mode (active Admin/Executive/PM/Finance, as the RPC itself), GET/POST budget_category_account_map
-- and POST set_budget_push_account (active Admin).

-- link_procurement_sharepoint_item (0361): the CLI is its only caller, and it took any web_url. Pin it to the
-- organisation's own SharePoint host with the same block and the same refusal as link_m365_documents_batch (0367).
create or replace function public.link_procurement_sharepoint_item(p_procurement_id uuid, p_record_kind text, p_record_id uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_org uuid := public.auth_org_id(); v_host text;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this procurement reference.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.procurements p where p.id = p_procurement_id and p.org_id = v_org) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' or coalesce(p_item->>'kind', '') not in ('file','folder') then
    raise exception 'A SharePoint item needs drive_id, item_id, web_url, name and kind (file or folder).' using errcode = '22023';
  end if;
  -- Links must point at the org's own SharePoint host: a Graph site id is `<host>,<collection>,<site>`.
  select lower(nullif(btrim(split_part(default_site_id,',',1)),'')) into v_host
    from public.org_m365_document_settings where org_id=v_org;
  if v_host is null or position('.' in v_host)=0 then
    raise exception using errcode='22023',message='m365_not_configured',
      hint='Choose the default SharePoint library in the app first';
  end if;
  if lower(substring(p_item->>'web_url' from '^https://([^/:?#]+)')) is distinct from v_host then
    raise exception using errcode='22023',message='web_url host is not the organisation SharePoint host';
  end if;
  insert into public.procurement_documents (org_id, procurement_id, type, link, source, ms_drive_id, ms_item_id, ms_item_name, ms_item_kind, record_kind, record_id)
  values (v_org, p_procurement_id, 'Microsoft reference', p_item->>'web_url', 'onedrive', p_item->>'drive_id', p_item->>'item_id',
          p_item->>'name', p_item->>'kind', nullif(btrim(p_record_kind), ''), p_record_id)
  returning id into v_id;
  return v_id;
end $$;

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
  -- BUDGET OPS TIER (`pmo budgets`, #1270 B): the activation check. Same role set as the RPC's own check. A Draft's source
  -- file goes through link_m365_documents_batch (0367 tier, host-pinned). activate_budget_version is deliberately NOT here
  -- (owner has not ruled).  -- 0370
  budget_ops_rpcs constant text[] := array['budget_activation_mode'];  -- 0370
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
