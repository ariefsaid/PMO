-- 0273_budget_second_activator.sql — OD-BUDGET-6 (#922): a budget version is activated by someone other
-- than the person who drafted it (activation also pushes the budget to the ERP).
--
--   §1 budget_versions.created_by — the drafter, stamped server-side on insert. A client caller's value is
--      always the caller (auth.uid()); the column carries no client INSERT/UPDATE grant, so naming it is a
--      42501. clone_budget_version is a postgres-owned definer, so its insert reaches the trigger as a
--      server-side actor with the caller's JWT still in force: the cloner becomes the copy's drafter.
--      Server-side writers (seed, service-role fixtures) may state the drafter; when they don't, the
--      caller's uid applies, and with no caller it stays NULL.
--   §2 activate_budget_version: 0139's body VERBATIM plus the drafter read and two refusals (marked 0273).
--      The drafter is refused whatever their role — Admin included, as with OD-PROC-8. A version with no
--      recorded drafter (older or seeded) is activated by Admin or Finance only. Both run after the org /
--      role / project checks, so a caller outside the org still reads only "not authorized".
--   §3 record_history_config: created_by is classified (omitted — set once at insert, never a change).
--
-- No new definer function and no signature change: create-or-replace keeps activate_budget_version's ACL,
-- so the hosted-grant allow-lists (0178) and the isolation-probe denominator are unchanged. The drafter
-- trigger function is SECURITY INVOKER; on UPDATE it refuses a client change to created_by (behind the grant).
-- Pre-existing versions keep NULL (no backfill: nothing recorded who drafted them).
-- Reversal: supabase/migrations/rollback/0273_budget_second_activator_down.sql.
-- pgTAP: supabase/tests/budget_second_activator.test.sql.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the drafter column + its server-side stamp.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.budget_versions
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

comment on column public.budget_versions.created_by is
  'Who drafted this version (OD-BUDGET-6): stamped server-side on insert and on clone, never client-set. '
  'activate_budget_version refuses this person; NULL (older or seeded) = Admin or Finance only.';

-- The 0176 column INSERT grant and 0178 UPDATE (status) grant name their columns, so a new column is
-- outside both. Re-stated explicitly so the state does not depend on a reader finding those files.
revoke insert (created_by), update (created_by) on public.budget_versions from authenticated, anon;

create or replace function public.budget_version_drafter() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- Behind the grant (created_by is not client-UPDATEable); this names the rule.
    if new.created_by is distinct from old.created_by and not public.actor_bypasses_rls() then
      raise exception 'budget_versions.created_by cannot be changed: the drafter is recorded server-side'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if public.actor_bypasses_rls() then
    -- Server-side authority (postgres / service_role, and the definer RPCs such as clone_budget_version).
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_by := auth.uid();
  end if;
  return new;
end; $$;

revoke execute on function public.budget_version_drafter() from public, anon, authenticated;

drop trigger if exists budget_versions_drafter on public.budget_versions;
create trigger budget_versions_drafter
  before insert or update on public.budget_versions
  for each row execute function public.budget_version_drafter();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — activate_budget_version: the second-person rule.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid;  -- 0273: v_drafter
begin
  select project_id, org_id, status, created_by into v_project, v_org, v_status, v_drafter  -- 0273: created_by
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Defense-in-depth (audit HIGH-BV-1): also assert the parent project belongs to the caller's org, so a
  -- definer-context archive-by-project_id can never cross orgs even if a grafted version slipped past RLS.
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- 0273 (OD-BUDGET-6): the drafter cannot activate their own version — no role is exempt.
  if v_drafter is not null and v_drafter = auth.uid() then
    raise exception 'separation of duties: the person who drafted a budget version cannot activate it'
      using errcode = '42501';
  end if;
  -- 0273 (OD-BUDGET-6): with no recorded drafter, only Admin or Finance may activate.
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be activated by Admin or Finance only'
      using errcode = '42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now() where id = version_id;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — change-history registry: classify the new column (record_changes_catalog_gate).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.record_history_config
   set omit_cols = omit_cols || '{created_by}'::text[]
 where entity_type = 'budget_version'
   and not ('created_by' = any (omit_cols));
