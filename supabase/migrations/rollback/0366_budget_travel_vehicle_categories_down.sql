-- Reverses 0366 (#1326). Roll the app back first.
-- §3: restore the 0364 api_client_request_guard body verbatim (purchase and set-aside tiers kept) (drops the active-Admin `pmo rpc` tier).
-- §4: restore the 0298 activate_budget_version body.
-- §2: drop recategorise_budget_lines. Lines it already moved KEEP their new category — a move is authored
--     money composition, never reverted silently; move them back in the app before a physical enum removal.
-- §1: the two enum values STAY (0229's rule). Application rollback is complete without removing them.
--
-- Physical removal of the two values is an operator-authored, guarded rebuild, never DROP ... CASCADE.
-- Current direct dependencies (0001, 0137, 0153, 0290 and later):
--   public.budget_line_items.category
--   public.budget_category_account_map.category
--   public.budget_projections.category
--   public.expense_claims.budget_category, public.procurements.budget_category (0243, 0247; and any later
--   column of this type)
--   functions whose signature or RETURNS TABLE uses public.budget_category (get_budget_projection,
--   project_mapped_actuals, ...).
-- Re-inventory pg_depend at the target revision and capture each dependent function's
-- pg_get_functiondef, owner, ACLs and comment, and every affected column definition, before rebuilding;
-- abort on dependencies not captured. In ONE transaction, execute this guard before touching the type:
--   LOCK TABLE public.budget_line_items, public.budget_category_account_map,
--     public.budget_projections, public.expense_claims, public.procurements IN ACCESS EXCLUSIVE MODE;
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM public.budget_line_items WHERE category::text IN ('Travel & accommodation','Vehicle'))
--       OR EXISTS (SELECT 1 FROM public.budget_category_account_map WHERE category::text IN ('Travel & accommodation','Vehicle'))
--       OR EXISTS (SELECT 1 FROM public.budget_projections WHERE category::text IN ('Travel & accommodation','Vehicle'))
--       OR EXISTS (SELECT 1 FROM public.expense_claims WHERE budget_category::text IN ('Travel & accommodation','Vehicle'))
--       OR EXISTS (SELECT 1 FROM public.procurements WHERE budget_category::text IN ('Travel & accommodation','Vehicle')) THEN
--       RAISE EXCEPTION 'Cannot remove Travel & accommodation / Vehicle while authored rows exist';
--     END IF;
--   END $$;
-- No row may be relabelled, deleted or coerced to make that guard pass.
-- After the guard, drop only the captured dependent functions, rename budget_category to
-- budget_category_0366_old, and CREATE TYPE public.budget_category AS ENUM
-- ('Labor','Materials','Subcontractors','Equipment','Permits & Fees','Overheads','Contingency','Special expenses').
-- ALTER each listed column TYPE public.budget_category USING <col>::text::public.budget_category;
-- DROP TYPE public.budget_category_0366_old RESTRICT. Restore the captured functions, owners, grants and
-- comments exactly; verify the columns, enum order, row counts and unchanged numeric totals, then COMMIT.
-- Any failed guard/cast/dependency check aborts the entire transaction and preserves the data.

begin;

drop function if exists public.recategorise_budget_lines(uuid[], public.budget_category);

-- §4: restore the 0298 activate_budget_version body verbatim (no FOR UPDATE on the version read).
create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid; v_sole_operator boolean := false;
begin
  select project_id, org_id, status, created_by into v_project, v_org, v_status, v_drafter
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from public.budget_version_editors e
             where e.budget_version_id = version_id and e.user_id = auth.uid()) then
    select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
      from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole_operator,false) then
      raise exception 'separation of duties: You edited this version, so someone else must activate it.'
        using errcode = '42501';
    end if;
  end if;
  if v_drafter is not null and v_drafter = auth.uid() and not v_sole_operator then
    select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
      from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole_operator,false) then
      raise exception 'separation of duties: the person who drafted a budget version cannot activate it'
        using errcode = '42501';
    end if;
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be activated by Admin or Finance only'
      using errcode = '42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now(),
    activation_basis = case when v_sole_operator then 'sole_operator' else 'standard' end where id = version_id;
end; $$;

revoke all on function public.activate_budget_version(uuid) from public, anon;
grant execute on function public.activate_budget_version(uuid) to authenticated;

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

commit;
