-- 1460 down: restore the 1395 select policy, the 1418 write policies and the 1368 recipients body.

drop policy task_groups_select on public.task_groups;
create policy task_groups_select on public.task_groups for select
  using (org_id = (select public.auth_org_id()));

drop policy task_groups_insert on public.task_groups;
create policy task_groups_insert on public.task_groups for insert
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())));
drop policy task_groups_update on public.task_groups;
create policy task_groups_update on public.task_groups for update
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())))
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())));
drop policy task_groups_delete on public.task_groups;
create policy task_groups_delete on public.task_groups for delete
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())));

create or replace function public.billing_stage_overdue_recipients(p_stage public.claim_billing_stages) returns setof uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  with pm as (
    select p.project_manager_id as id from public.projects p
      join public.profiles m on m.id = p.project_manager_id and m.org_id = p_stage.org_id and m.status = 'active'
     where p.id = p_stage.project_id and p.org_id = p_stage.org_id
  ), holders as (
    select m.id from public.profiles m
     where p_stage.owner_role is not null and m.org_id = p_stage.org_id and m.status = 'active' and m.role = p_stage.owner_role
       and (p_stage.owner_role <> 'Project Manager'
            or m.id = (select p.project_manager_id from public.projects p where p.id = p_stage.project_id and p.org_id = p_stage.org_id))
  )
  select id from holders
  union all
  select id from pm where p_stage.owner_role is null
  union all
  select a.id from public.profiles a
   where a.org_id = p_stage.org_id and a.role = 'Admin' and a.status = 'active'
     and not exists (select 1 from holders)
     and (p_stage.owner_role is not null or not exists (select 1 from pm))
$$;
revoke all on function public.billing_stage_overdue_recipients(public.claim_billing_stages) from public, anon, authenticated;
