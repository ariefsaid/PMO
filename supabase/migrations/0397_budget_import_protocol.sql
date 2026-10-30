-- Import identity is assigned only by the transactional import authority.
alter table public.budget_line_items add column import_origin smallint
  constraint budget_line_items_import_origin_check check (import_origin is null or import_origin = 2);

create function public.guard_budget_import_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'postgres' then
    if tg_op = 'INSERT' and (new.import_key is not null or new.import_origin is not null) then
      raise exception 'Budget import requires an updated client' using errcode = '42501';
    elsif tg_op = 'UPDATE' and
      (new.import_key is distinct from old.import_key or new.import_origin is distinct from old.import_origin
       or (old.import_key is not null and new.budget_version_id is distinct from old.budget_version_id)) then
      raise exception 'Budget import identity cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_budget_import_identity() from public;
create trigger budget_line_items_a_import_identity_guard before insert or update on public.budget_line_items
  for each row execute function public.guard_budget_import_identity();

create function public.import_budget_line_v2(
  p_version_id uuid, p_category public.budget_category, p_description text,
  p_budgeted_amount numeric, p_fiscal_year text, p_batch_id uuid, p_imported_at timestamptz,
  p_v2_key text, p_legacy_key text, p_has_reference boolean
) returns table(outcome text, line_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_project uuid; v_status public.budget_status; v_line uuid;
begin
  if p_version_id is null or p_category is null or p_budgeted_amount is null
     or p_budgeted_amount::text in ('NaN','Infinity','-Infinity')
     or abs(p_budgeted_amount) >= 1000000000000 or p_budgeted_amount <> trunc(p_budgeted_amount, 2)
     or p_batch_id is null or p_imported_at is null or p_has_reference is null
     or p_v2_key is null or p_v2_key = '' or p_legacy_key is null or p_legacy_key = '' then
    raise exception 'Invalid budget import arguments' using errcode = '22023';
  end if;
  if not coalesce(auth.uid() is not null and public.is_active_member()
      and public.auth_role()::text in ('Admin','Executive','Project Manager','Finance'), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select v.org_id, v.project_id, v.status into v_org, v_project, v_status
    from public.budget_versions v join public.projects p on p.id = v.project_id and p.org_id = v.org_id
    where v.id = p_version_id and v.org_id = public.auth_org_id()
    for update of v;
  if not found then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_status <> 'Draft' then raise exception 'line-items can only change while the owning version is Draft' using errcode = 'P0001'; end if;

  select li.id into v_line from public.budget_line_items li
    where li.budget_version_id = p_version_id and li.import_origin is null
      and (li.import_key collate "C" = p_v2_key collate "C"
        or (li.import_key collate "C" = p_legacy_key collate "C"
            and (not p_has_reference or left(p_legacy_key, 3) = 'fp:' or p_legacy_key collate "C" = p_v2_key collate "C")))
    order by li.id limit 1;
  if found then return query select 'conflict'::text, v_line; return; end if;
  select li.id into v_line from public.budget_line_items li
    where li.budget_version_id = p_version_id
      and ((li.import_origin = 2 and li.import_key collate "C" = p_v2_key collate "C")
        or (li.import_origin is null and p_has_reference and left(p_legacy_key, 3) <> 'fp:'
            and li.import_key collate "C" = p_legacy_key collate "C"))
    order by li.id limit 1;
  if found then return query select 'skipped'::text, v_line; return; end if;
  insert into public.budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, fiscal_year,
      import_batch_id, imported_at, import_key, import_origin)
    values (v_org, p_version_id, p_category, p_description, p_budgeted_amount, p_fiscal_year,
      p_batch_id, p_imported_at, p_v2_key, 2) returning id into v_line;
  return query select 'created'::text, v_line;
end $$;
revoke all on function public.import_budget_line_v2(uuid, public.budget_category, text, numeric, text, uuid, timestamptz, text, text, boolean) from public, anon, service_role;
grant execute on function public.import_budget_line_v2(uuid, public.budget_category, text, numeric, text, uuid, timestamptz, text, text, boolean) to authenticated;

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
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project', 'import_budget_line_v2'];
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
  -- COST ATTRIBUTION TIER (`pmo attribution`, #1271): preview/save/end for active Admin/Finance; list for the
  -- project-actuals audience. Same role sets as the RPCs' own checks.  -- 0376
  cost_attribution_write_rpcs constant text[] := array['preview_cost_attribution', 'save_cost_attribution_rule', 'end_cost_attribution_rule'];  -- 0376
  cost_attribution_read_rpcs constant text[] := array['list_cost_attribution_rules'];  -- 0376
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
    if method = 'POST' and target = any (cost_attribution_write_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
    if method = 'POST' and target = any (cost_attribution_read_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
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
