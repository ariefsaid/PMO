-- Rollback 0279_budget_version_editors.sql.
create or replace function public.activate_budget_version(version_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_org uuid; v_status budget_status; v_drafter uuid;
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
  if v_drafter is not null and v_drafter = auth.uid() then
    raise exception 'separation of duties: the person who drafted a budget version cannot activate it'
      using errcode = '42501';
  end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then
    raise exception 'a budget version with no recorded drafter can be activated by Admin or Finance only'
      using errcode = '42501';
  end if;
  if v_status <> 'Draft' then raise exception 'only a Draft version can be activated' using errcode = 'P0001'; end if;
  update budget_versions set status = 'Archived' where project_id = v_project and status = 'Active';
  update budget_versions set status = 'Active', activated_at = now() where id = version_id;
end; $$;
drop trigger if exists budget_line_items_capture_editor on public.budget_line_items;
drop trigger if exists budget_versions_capture_editor on public.budget_versions;
drop function if exists public.capture_budget_line_item_editor();
drop function if exists public.capture_budget_version_insert_editor();
drop table if exists public.budget_version_editors;
