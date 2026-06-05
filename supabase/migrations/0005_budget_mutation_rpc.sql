-- 0005_budget_mutation_rpc.sql — Budget lifecycle write contract (ADR-0011 / budget-versioning.spec).
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- Provides: get_project_budget (read, Σ Active), activate_budget_version + clone_budget_version
-- (security-definer lifecycle writes that re-assert authz internally because definer rights bypass RLS),
-- and a not-Draft trigger on budget_line_items. Calls auth_org_id()/auth_role() from 0002_rls.sql.
-- ACL discipline mirrors 0003 / ADR-0009: revoke all from public, grant execute to authenticated,
-- revoke execute from anon.

-- get_project_budget: Σ budgeted_amount of the project's Active version (FR-BV-001/002/003,
-- NFR-BV-PERF-001). SECURITY INVOKER (the default — do NOT add security definer): each base-table read
-- runs under the CALLER'S RLS (budget_versions_select / budget_line_items_select = org_id = auth_org_id()),
-- so the aggregate is org-scoped automatically (mirrors ADR-0009 / 0003).
create or replace function get_project_budget(p_project_id uuid)
  returns numeric language sql stable security invoker as $$
  select coalesce(sum(li.budgeted_amount), 0)
  from budget_versions v
  join budget_line_items li on li.budget_version_id = v.id
  where v.project_id = p_project_id and v.status = 'Active';
$$;
revoke all on function get_project_budget(uuid) from public;
grant execute on function get_project_budget(uuid) to authenticated;
revoke execute on function get_project_budget(uuid) from anon;

-- Atomic activate: archive the project's current Active, set this Draft Active. SECURITY DEFINER so it
-- runs in one txn; therefore it RE-ASSERTS authz internally (RLS is bypassed under definer rights).
-- SECURITY: removing the v_org/auth_org_id() + auth_role() re-assertion below would bypass RLS and permit
-- cross-org activation by any authenticated caller — it MUST stay. search_path is pinned to public to
-- harden against search_path injection (consistent with auth_org_id/auth_role in 0002).
create or replace function activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status;
begin
  select project_id, org_id, status into v_project, v_org, v_status
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active' where id = version_id;
end; $$;
revoke all on function activate_budget_version(uuid) from public;
grant execute on function activate_budget_version(uuid) to authenticated;
revoke execute on function activate_budget_version(uuid) from anon;

-- Clone any version into a new Draft (next version), copying line-items with actual_amount reset to 0.
-- SECURITY DEFINER: same internal authz re-assertion as activate_budget_version. Removing the
-- v_org/auth_org_id() + auth_role() check below would bypass RLS and let any authenticated caller clone
-- across orgs — it MUST stay. search_path is pinned to public against injection.
create or replace function clone_budget_version(version_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_next int; v_new uuid;
begin
  select project_id, org_id into v_project, v_org from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(max(version),0)+1 into v_next from budget_versions where project_id = v_project;
  insert into budget_versions (org_id, project_id, version, name, status)
    select v_org, v_project, v_next, name || ' (copy)', 'Draft'
    from budget_versions where id = version_id
    returning id into v_new;
  insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
    select v_org, v_new, category, description, budgeted_amount, 0
    from budget_line_items where budget_version_id = version_id;
  return v_new;
end; $$;
revoke all on function clone_budget_version(uuid) from public;
grant execute on function clone_budget_version(uuid) to authenticated;
revoke execute on function clone_budget_version(uuid) from anon;

-- FR-BV-011 guard: line-items mutate only while the owning version is Draft (covers I/U/D uniformly).
create or replace function enforce_draft_line_item()
  returns trigger language plpgsql as $$
declare v_status budget_status;
begin
  select status into v_status from budget_versions
    where id = coalesce(new.budget_version_id, old.budget_version_id);
  if v_status <> 'Draft' then
    raise exception 'line-items can only change while the owning version is Draft' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end; $$;
create trigger budget_line_items_draft_guard
  before insert or update or delete on budget_line_items
  for each row execute function enforce_draft_line_item();
