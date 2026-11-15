-- 0899 (#1855, #1858): the command line may import purchase history and correct two loader-written tables, as an active Admin.
-- 1. `import_purchase_history` (POST rpc) joins the guard in the active-Admin tier (the function checks Admin itself).
-- 2. PATCH on `boq_items` and `budget_line_items` is admitted for an active Admin only, and only with `Prefer: handling=strict,
--    max-affected=1`, read the way PostgREST reads it (split on commas, each token trimmed at its ends only, case-sensitive; no
--    other spelling is admitted). The guard sees method, path, headers and claims, not the body or the query string, so the columns
--    and the row count are limited in the database instead: `api_client_restrict_patch_columns()` runs BEFORE UPDATE on
--    both tables and refuses (42501) a change to any column outside the allowed list when the request is a command-line token
--    (the verified `client_id` claim, read exactly as the guard reads it) and not the one reviewed RPC `/rpc/recategorise_budget_lines`
--    (a definer RPC that updates these tables by its own rules). It compares the WHOLE row, so a column added later is refused by default.
--    Trigger name `<table>_00_api_client_columns` sorts before every other BEFORE UPDATE trigger on these tables, so it compares the row
--    as the client sent it; none of those triggers assigns a column to NEW today (checked at 0898).
--    `api_client_limit_patch_rows()` is an AFTER UPDATE statement trigger (transition table) that refuses (42501) a command-line token
--    that changed more than one row, whatever the Prefer header says: the database decides the cap, not the header.
--    `api_client_insert_only()` is a BEFORE UPDATE row trigger on `budget_versions` and `budget_category_account_map`, the tables a
--    command-line token may only POST to: it refuses (42501) an update of an existing row when the request is a command-line token,
--    its method is POST and its path is not an `/rpc/` call, so a POST can only insert there.
-- Known limit: the `id=eq.<uuid>` filter is in the query string, which the guard cannot see; one row is changed per request, but
-- which row is the caller's filter.
-- Body of the api_client_request_guard() from 0894 copied verbatim; the only additions are the lines marked 0899.
create or replace function public.api_client_restrict_patch_columns()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if claims is null or not (claims ? 'client_id') then
    return new; -- not an OAuth API client (an app session): unchanged
  end if;
  if coalesce(current_setting('request.path', true), '') = '/rpc/recategorise_budget_lines' then
    return new; -- the one reviewed definer RPC that updates these tables (it checks Admin, membership and org itself)
  end if;
  if (to_jsonb(new) - tg_argv) is distinct from (to_jsonb(old) - tg_argv) then
    raise exception using errcode = '42501',
      message = format('OAuth API clients may change only %s on %s', array_to_string(tg_argv, ', '), tg_table_name);
  end if;
  return new;
end;
$$;
revoke all on function public.api_client_restrict_patch_columns() from public, anon;  -- a trigger function is not called through the API

drop trigger if exists boq_items_00_api_client_columns on public.boq_items;
create trigger boq_items_00_api_client_columns before update on public.boq_items
  for each row execute function public.api_client_restrict_patch_columns('description', 'unit', 'quantity', 'rate', 'earning_basis');
drop trigger if exists budget_line_items_00_api_client_columns on public.budget_line_items;
create trigger budget_line_items_00_api_client_columns before update on public.budget_line_items
  for each row execute function public.api_client_restrict_patch_columns('budgeted_amount', 'description');

create or replace function public.api_client_limit_patch_rows()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if claims is null or not (claims ? 'client_id') then
    return null; -- an app session: unchanged
  end if;
  if coalesce(current_setting('request.path', true), '') = '/rpc/recategorise_budget_lines' then
    return null; -- the one reviewed definer RPC that updates these tables
  end if;
  if (select count(*) from (select 1 from new_rows limit 2) two) > 1 then
    raise exception using errcode = '42501',
      message = format('OAuth API clients may change one %s row per request', tg_table_name);
  end if;
  return null;
end;
$$;
revoke all on function public.api_client_limit_patch_rows() from public, anon;

drop trigger if exists boq_items_01_api_client_one_row on public.boq_items;
create trigger boq_items_01_api_client_one_row after update on public.boq_items
  referencing new table as new_rows for each statement execute function public.api_client_limit_patch_rows();
drop trigger if exists budget_line_items_01_api_client_one_row on public.budget_line_items;
create trigger budget_line_items_01_api_client_one_row after update on public.budget_line_items
  referencing new table as new_rows for each statement execute function public.api_client_limit_patch_rows();

create or replace function public.api_client_insert_only()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if claims is null or not (claims ? 'client_id') then
    return new; -- an app session: unchanged
  end if;
  if current_setting('request.method', true) is distinct from 'POST'
     or coalesce(current_setting('request.path', true), '') like '/rpc/%' then
    return new; -- not a command-line POST to the table itself
  end if;
  raise exception using errcode = '42501',
    message = format('OAuth API clients may only insert into %s', tg_table_name);
end;
$$;
revoke all on function public.api_client_insert_only() from public, anon;

drop trigger if exists budget_versions_00_api_client_insert_only on public.budget_versions;
create trigger budget_versions_00_api_client_insert_only before update on public.budget_versions
  for each row execute function public.api_client_insert_only();
drop trigger if exists budget_category_account_map_00_api_client_insert_only on public.budget_category_account_map;
create trigger budget_category_account_map_00_api_client_insert_only before update on public.budget_category_account_map
  for each row execute function public.api_client_insert_only();

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
  -- #1835 stage-date correction tier: exact RPC + read endpoint, active Admin only.
  stage_admin_rpcs constant text[] := array['redate_stage_entry'];
  stage_admin_tables constant text[] := array['project_stage_entries'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item',
    'attach_erp_journal_lines', 'project_erp_journal_lines', 'create_record_only_journal_purchase', 'undo_captured_purchase'];  -- 0688 (#1919)
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
  tm_read_rpcs constant text[] := array['list_tm_claims', 'preview_tm_claim', 'list_tm_claim_source_details'];  -- 0588
  -- NATIVE RECEIPT TIER (`pmo purchases receive` on a PMO-owned org, #1866): same role set as the RPC's own check.  -- 0702
  native_receipt_rpcs constant text[] := array['create_procurement_receipt'];  -- 0702
  -- ACTIVE-ADMIN CAPTURE-READ TIER (`pmo purchases capture`, #2276) — keep in step with supabase/functions/purchase-capture.  -- 0872
  capture_read_rpcs constant text[] := array['purchase_capture_source_page', 'purchase_capture_ledger_page', 'purchase_capture_feed_health'];  -- 0872
  -- DISPATCH-READ TIER (`pmo purchases receive|pay-captured`, external `pmo companies create`, #2278) — keep in step with
  -- supabase/functions/adapter-dispatch/authGuard.ts and pmo-portal/src/lib/adapterSeam/cutoverGate.ts.  -- 0876
  dispatch_read_rpcs constant text[] := array['domain_owned_by_tier', 'actor_authorization_state'];  -- 0876
  dispatch_read_procurement_rpcs constant text[] := array['pre_cutover_procurement'];  -- 0876
  -- ACTIVE-ADMIN CAPTURE-ASSIGNMENT TIER (`pmo purchases assign`, #2195) — keep in step with supabase/functions/purchase-capture.  -- 0882
  capture_assign_rpcs constant text[] := array['assign_capture_invoices', 'purchase_capture_assignment_report'];  -- 0882
  -- DOCUMENT-REGISTER WRITE TIER (`pmo documents create|upload`, #1857) — keep in step with scripts/pmo.mjs DOCUMENT_WRITE_TABLES.  -- 0884
  document_write_tables constant text[] := array['project_documents'];  -- 0884
  -- OPERATOR ONBOARDING TIER (`pmo org add`, #2280) — keep in step with scripts/lib/pmo-org.mjs and supabase/functions/operator-org.  -- 0894
  operator_onboard_rpcs constant text[] := array['is_operator', 'is_active_member', 'operator_plan_catalogue', 'operator_org_plan',  -- 0894
    'operator_create_org_with_setup'];  -- 0894
  -- PURCHASE-HISTORY IMPORT TIER (`pmo purchases import-history`, #1855) — active Admin, as the RPC's own check; keep in step with scripts/lib/pmo-purchases.mjs.  -- 0899
  history_import_rpcs constant text[] := array['import_purchase_history'];  -- 0899
  -- ACTIVE-ADMIN CORRECTION TIER (`pmo correct contract-line|budget-line`, #1858) — PATCH on these two tables only, one row per request;  -- 0899
  -- the columns a token may change are fixed by the api_client_restrict_patch_columns() trigger on each table. Keep in step with scripts/lib/pmo-correct.mjs.  -- 0899
  correction_patch_tables constant text[] := array['boq_items', 'budget_line_items'];  -- 0899
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  -- Prefer tokens as PostgREST reads them: split on commas, each trimmed at its ends only, case-sensitive.  -- 0899
  prefer_tokens text[] := (select coalesce(array_agg(btrim(t, E' \t\n\v\f\r')), '{}') from unnest(string_to_array(coalesce(headers ->> 'prefer', ''), ',')) t);  -- 0899
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
    if method = 'POST' and target = any (stage_admin_rpcs) then  -- 0585
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
    if method = 'POST' and target = any (native_receipt_rpcs) then  -- 0702
      if coalesce(public.auth_role()::text in ('Admin', 'Project Manager') and public.is_active_member(), false) then  -- 0702
        return;  -- 0702
      end if;  -- 0702
    end if;  -- 0702
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
    if method = 'POST' and target = any (capture_read_rpcs) then  -- 0872
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0872
        return;  -- 0872
      end if;  -- 0872
    end if;  -- 0872
    if method = 'POST' and target = any (dispatch_read_rpcs) then  -- 0876
      if coalesce(public.is_active_member(), false) then  -- 0876
        return;  -- 0876
      end if;  -- 0876
    end if;  -- 0876
    if method = 'POST' and target = any (dispatch_read_procurement_rpcs) then  -- 0876
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0876
        return;  -- 0876
      end if;  -- 0876
    end if;  -- 0876
    if method = 'POST' and target = any (capture_assign_rpcs) then  -- 0882
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0882
        return;  -- 0882
      end if;  -- 0882
    end if;  -- 0882
    if method = 'POST' and target = any (operator_onboard_rpcs) then  -- 0894
      if coalesce(public.is_operator() and public.is_active_member(), false) then  -- 0894
        return;  -- 0894
      end if;  -- 0894
    end if;  -- 0894
    if method = 'POST' and target = any (history_import_rpcs) then  -- 0899
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0899
        return;  -- 0899
      end if;  -- 0899
    end if;  -- 0899
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
    if method = 'GET' and target = any (stage_admin_tables) then  -- 0585
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
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
    if method in ('POST', 'PATCH') and target = any (document_write_tables) then  -- 0884
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0884
        return;  -- 0884
      end if;  -- 0884
    end if;  -- 0884
    -- One row per request: PostgREST enforces `max-affected=1` only under `handling=strict`, and the guard cannot see the filter,  -- 0899
    -- so both tokens must be present exactly once, spelled exactly (a repeated or larger `max-affected` is refused). The statement  -- 0899
    -- trigger above enforces the one-row cap itself.  -- 0899
    if method = 'PATCH' and target = any (correction_patch_tables) then  -- 0899
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false)  -- 0899
         and (select count(*) from unnest(prefer_tokens) t where t like 'handling%') = 1 and 'handling=strict' = any (prefer_tokens)  -- 0899
         and (select count(*) from unnest(prefer_tokens) t where t like 'max-affected%') = 1 and 'max-affected=1' = any (prefer_tokens) then  -- 0899
        return;  -- 0899
      end if;  -- 0899
    end if;  -- 0899
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;
