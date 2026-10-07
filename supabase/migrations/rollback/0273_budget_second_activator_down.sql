-- Reverses 0273_budget_second_activator.sql: restores the 0139 activate_budget_version body, drops the
-- drafter stamp, the created_by column and its change-history classification.

create or replace function activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status;
begin
  select project_id, org_id, status into v_project, v_org, v_status
    from budget_versions where id = version_id;
  if v_project is null then raise exception 'budget version not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
     or not public.is_active_member()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if (select org_id from public.projects where id = v_project) is distinct from auth_org_id()
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived'
    where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now() where id = version_id;
end; $$;

update public.record_history_config
   set omit_cols = array_remove(omit_cols, 'created_by')
 where entity_type = 'budget_version';

drop trigger if exists budget_versions_drafter on public.budget_versions;
drop function if exists public.budget_version_drafter();
alter table public.budget_versions drop column if exists created_by;
