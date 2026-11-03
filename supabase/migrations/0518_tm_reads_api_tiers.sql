-- 0518_tm_reads_api_tiers.sql — #1514 T4: the two time-and-materials reads and the OAuth API-client tiers for `pmo tm`.
-- list_tm_claims(project) lists a project's claims with their frozen lines; preview_tm_claim(project, from, to) groups the
-- approved, not-yet-claimed hours into priced lines and unrated groups (with the reason), writing nothing. Both are for the
-- amounts audience only: Admin, Finance, Executive and the Project Manager of that project (Engineers get 42501, another
-- organisation's project P0002). They are SECURITY DEFINER because they read other people's timesheet hours and rates; the
-- single gate `tm_assert_amounts_reader` MUST stay (a definer body bypasses RLS). No table, no data change.
-- api_client_request_guard = 0497 verbatim plus the T&M tiers; every added line is marked 0518. The rate-card tables are
-- readable by the amounts audience through the guard, and RLS still narrows every row to the caller's organisation and its
-- projects (the guard widens reach only; it is never the tenancy rule).
-- Proven by supabase/tests/tm_reads.test.sql. Rollback: supabase/migrations/rollback/0518_tm_reads_api_tiers_down.sql.

-- The reader gate shared by both reads: an active member in the amounts audience, targeting a project of their own organisation.
create function public.tm_assert_amounts_reader(p_project uuid) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_project is null then
    raise exception 'a project is required' using errcode = '22023';
  end if;
  if not public.is_active_member() or not (
       public.auth_role()::text in ('Admin', 'Finance', 'Executive')
       or (public.auth_role()::text = 'Project Manager' and exists (
             select 1 from public.projects p
              where p.id = p_project and p.org_id = public.auth_org_id() and p.project_manager_id = auth.uid()))) then
    raise exception 'not authorized to read time-and-materials claims for this project' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
end $$;

create function public.list_tm_claims(p_project uuid)
returns table(id uuid, work_order_id uuid, period_from date, period_to date, status text, currency text, gross_amount numeric,
              prepared_by uuid, signoff_prepared_by uuid, confirmed_by uuid, confirm_basis text, document_id uuid,
              note text, created_at timestamptz, lines jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform public.tm_assert_amounts_reader(p_project);
  return query
    select c.id, c.work_order_id, c.period_from, c.period_to, c.status, c.currency, c.gross_amount,
           c.prepared_by, c.signoff_prepared_by, c.confirmed_by, c.confirm_basis, c.document_id, c.note, c.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('line_key', l.line_key, 'rate_version', l.rate_version, 'kind', l.kind,
                                                         'label', l.label, 'unit', l.unit, 'units', l.units, 'rate', l.rate,
                                                         'amount', l.amount) order by l.label, l.rate_version)
                       from public.tm_claim_lines l where l.claim_id = c.id and l.org_id = c.org_id), '[]'::jsonb)
      from public.tm_claims c
     where c.org_id = public.auth_org_id() and c.project_id = p_project
     order by c.created_at desc, c.id;
end $$;

create function public.preview_tm_claim(p_project uuid, p_from date, p_to date)
returns table(line_key uuid, rate_version integer, kind text, label text, unit text, rate numeric, user_id uuid,
              units numeric, amount numeric, source_count bigint, unrated_reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  perform public.tm_assert_amounts_reader(p_project);
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'a valid date range is required' using errcode = '22023';
  end if;
  -- One row per priced line (the same grouping assemble_tm_claim freezes); unrated hours are grouped per person and reason
  -- and carry no amount: nothing is priced by guess.
  return query
    select s.line_key, s.rate_version, s.kind, s.label, s.unit, s.rate,
           case when s.unrated_reason is not null then s.user_id end,
           sum(s.units), case when s.unrated_reason is null then round(sum(s.units) * s.rate, 2) end,
           count(*), s.unrated_reason
      from public.tm_assignable_sources(p_project, p_from, p_to) s
     group by s.line_key, s.rate_version, s.kind, s.label, s.unit, s.rate, s.unrated_reason,
              case when s.unrated_reason is not null then s.user_id end
     order by s.unrated_reason nulls first, s.label, 7;
end $$;

alter function public.list_tm_claims(uuid) owner to postgres;
alter function public.preview_tm_claim(uuid, date, date) owner to postgres;
revoke all on function public.tm_assert_amounts_reader(uuid) from public, anon, authenticated;
revoke all on function public.list_tm_claims(uuid) from public, anon, authenticated;
revoke all on function public.preview_tm_claim(uuid, date, date) from public, anon, authenticated;
grant execute on function public.list_tm_claims(uuid) to authenticated;
grant execute on function public.preview_tm_claim(uuid, date, date) to authenticated;

-- ── API-client tiers: 0497 verbatim plus the T&M tiers ──────────────────────────────────────────
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
  operator_read_tables constant text[] := array['budget_versions', 'budget_line_items', 'budget_category_account_map', 'erp_gl_entry_mirror', 'project_documents', 'org_m365_document_settings', 'm365_record_folder_sweeps',  -- 0367
    'contract_rate_lines', 'contract_rate_assignees'];  -- 0518
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
  -- EQUIPMENT TIER (`pmo equipment`, #1519): costing preview/save/end for active Admin/Finance; costing and allocation
  -- reads for the amounts audience; usage totals for any active member. Same role sets as the RPCs' own checks.  -- 0497
  equipment_write_rpcs constant text[] := array['preview_equipment_costing', 'save_equipment_costing', 'end_equipment_costing'];  -- 0497
  equipment_read_rpcs constant text[] := array['list_equipment_costing', 'list_equipment_allocations'];  -- 0497
  equipment_usage_rpcs constant text[] := array['list_equipment_usage_totals'];  -- 0497
  -- TIME-AND-MATERIALS TIER (`pmo tm`, #1514): the rate and sign-off writers for active Admin/Finance; the claim list and
  -- preview for the amounts audience. Same role sets as the RPCs' own checks. The rate card itself is a table read, so
  -- `contract_rate_lines` and `contract_rate_assignees` join the operator read tier below; RLS stays the tenancy rule.  -- 0518
  tm_write_rpcs constant text[] := array['save_contract_rate_line', 'end_contract_rate_line', 'set_contract_rate_assignee', 'end_contract_rate_assignee', 'assemble_tm_claim', 'deselect_tm_source', 'prepare_tm_signoff', 'withdraw_tm_signoff', 'confirm_tm_signoff'];  -- 0518
  tm_read_rpcs constant text[] := array['list_tm_claims', 'preview_tm_claim'];  -- 0518
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
    if method = 'POST' and target = any (equipment_write_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_read_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_usage_rpcs) then  -- 0497
      if coalesce(public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (tm_write_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
    if method = 'POST' and target = any (tm_read_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
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

do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tm_assert_amounts_reader', 'list_tm_claims', 'preview_tm_claim')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname = 'anon');
  if v_bad is not null then raise exception '0518: a T&M read is executable by anon or PUBLIC: %', v_bad; end if;
  if has_function_privilege('authenticated', 'public.tm_assert_amounts_reader(uuid)', 'execute') then
    raise exception '0518: the reader gate helper is client-callable';
  end if;
  if not has_function_privilege('authenticated', 'public.list_tm_claims(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.preview_tm_claim(uuid,date,date)', 'execute') then
    raise exception '0518: a T&M read lost its authenticated grant';
  end if;
end $$;
