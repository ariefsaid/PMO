-- 0366_budget_travel_vehicle_categories.sql — #1326: Travel & accommodation and Vehicle, split out of
-- Special expenses (0229). Spec: docs/specs/budget-categories-travel-vehicle.spec.md (FR-TVC-001..007).
--
-- §1 two fixed categories, appended. Existing labels, rows and money are unchanged. The new values are
--    never USED in this file (ADD VALUE's values are unusable until the transaction commits): §2 compares
--    them as text inside a plpgsql body, which is not evaluated at CREATE time.
-- §2 recategorise_budget_lines — an Admin moves DRAFT Special-expenses lines to one of the new categories,
--    one or many in a single all-or-nothing call. An Active or Archived version is never changed.
-- §3 the OAuth API-client guard (0364 body, verbatim, with its purchase and set-aside tiers) gains an
--    active-Admin RPC tier so `pmo rpc` can call §2. Any later redefinition must carry every tier.
--
-- FR-TVC-006 — mapped actuals precedence during the accountant's reclass (no schema change, documented here):
-- an ERP account backs exactly ONE category (`unique (org_id, erp_account)`, 0137, kept by 0246). The new
-- project accounts are mapped under the new categories; the old account stays under Special expenses until
-- the reclass is finished. Actuals sum each account's NET, so a reclass journal (credit old, debit new)
-- moves the amount between categories and the categories always add up to the mapped accounts — never
-- double. An account cannot be listed under both (23505), so there is no overlap to break a tie on.
--
-- Rollback: supabase/migrations/rollback/0366_budget_travel_vehicle_categories_down.sql (drops §2, restores
-- the 0364 guard). The enum values follow 0229's rule: application rollback keeps them; a physical removal is
-- the operator-authored guarded rebuild written out in the down file, never DROP ... CASCADE.

-- ── §1 ────────────────────────────────────────────────────────────────────────────────────────────
alter type public.budget_category add value if not exists 'Travel & accommodation';
alter type public.budget_category add value if not exists 'Vehicle';

-- ── §2 ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.recategorise_budget_lines(
  p_line_ids uuid[],
  p_category public.budget_category
) returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_org   uuid := public.auth_org_id();
  v_ids   uuid[];
  v_found integer;
  v_line  record;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin'::public.user_role then
    raise exception 'only an Admin may re-categorise budget lines' using errcode = '42501';
  end if;

  if p_category is null or p_category::text not in ('Travel & accommodation', 'Vehicle') then
    raise exception 'budget lines can be moved only to Travel & accommodation or Vehicle' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_line_ids) x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'name at least one budget line to move' using errcode = '22023';
  end if;

  -- Lock the versions FIRST (shared): activation updates the version row, so it waits for this move to
  -- commit and pushes the categories the Admin chose — never a half-moved Draft. Then lock the lines.
  -- An id outside the caller's org is indistinguishable from one that does not exist.
  perform 1 from public.budget_versions v
    where v.org_id = v_org
      and v.id in (select li.budget_version_id from public.budget_line_items li where li.id = any (v_ids))
    for share;
  select count(*) into v_found from (
    select li.id from public.budget_line_items li
      where li.id = any (v_ids) and li.org_id = v_org
      for update
  ) locked;
  if v_found <> cardinality(v_ids) then
    raise exception 'budget line not found' using errcode = 'P0002';
  end if;

  -- All-or-nothing: one line on an Active/Archived version, or one that is not Special expenses, refuses all.
  if exists (select 1 from public.budget_line_items li join public.budget_versions v on v.id = li.budget_version_id
              where li.id = any (v_ids) and (v.status <> 'Draft' or v.org_id <> v_org)) then
    raise exception 'only lines on a Draft budget version can be re-categorised — an active budget is never changed'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.budget_line_items li
              where li.id = any (v_ids) and li.category::text <> 'Special expenses') then
    raise exception 'only Special expenses lines can be moved to Travel & accommodation or Vehicle'
      using errcode = 'P0001';
  end if;

  for v_line in
    update public.budget_line_items li set category = p_category
     where li.id = any (v_ids)
    returning li.id, li.budget_version_id
  loop
    perform public.log_audit('budget_line.recategorise', v_org, auth.uid(), v_line.id,
      jsonb_build_object('budget_version_id', v_line.budget_version_id,
                         'from', 'Special expenses', 'to', p_category::text));
  end loop;

  return cardinality(v_ids);
end;
$$;

comment on function public.recategorise_budget_lines(uuid[], public.budget_category) is
  '#1326 FR-TVC-003: an active Admin moves Draft Special-expenses budget lines to Travel & accommodation or '
  'Vehicle, all-or-nothing. Lines on an Active or Archived version are refused (P0001); lines outside the '
  'caller''s org are not found (P0002). Each moved line is audited as budget_line.recategorise.';

revoke all     on function public.recategorise_budget_lines(uuid[], public.budget_category) from public;
revoke execute on function public.recategorise_budget_lines(uuid[], public.budget_category) from anon;
grant  execute on function public.recategorise_budget_lines(uuid[], public.budget_category) to authenticated;

-- ── §3 ────────────────────────────────────────────────────────────────────────────────────────────
-- 0364's body verbatim plus the active-Admin `pmo rpc` tier; lines marked 0366 are new.
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
notify pgrst, 'reload config';
