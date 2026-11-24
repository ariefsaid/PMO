-- drops: actor_may_lend_workers replaces the controller-only test with the current supervised-crew gate; actor_may_task_issue adds work-order date bounds; add_task_to_incident uses its incident-aware gate for project issues.
-- Supervisor scope on active work orders and their currently rostered crews.
create or replace function public.actor_may_task_issue(p_work_order uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
select coalesce(public.is_active_member() and (
 public.auth_role() in ('Admin','Executive','Project Manager','Finance')
 or (public.actor_holds_job_role('site_supervisor') -- mut:site_supervisor_role
 and exists(select 1 from public.work_orders w where w.id=p_work_order and w.org_id=public.auth_org_id()
 and public.native_org_today(w.org_id) between coalesce(w.start_date, '-infinity'::date) and coalesce(w.end_date, 'infinity'::date) -- mut:site_assignment_dates
 and (w.responsible_person_id=auth.uid() or exists(select 1 from public.work_order_crews r join public.crews c on c.id=r.crew_id and c.org_id=r.org_id
 where r.work_order_id=w.id and r.org_id=w.org_id and c.field_controller_id=auth.uid()
 and public.native_org_today(r.org_id) between r.valid_from and coalesce(r.valid_to,'infinity'::date))))
)),false)
$$;

create function public.supervisor_may_lend_crew(p_crew uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select coalesce(public.is_active_member() and public.actor_holds_job_role('site_supervisor')
 and exists(select 1 from public.crews c where c.id=p_crew and c.org_id=public.auth_org_id() and c.archived_at is null
 and (c.field_controller_id=auth.uid() or exists(select 1 from public.work_order_crews r
 where r.crew_id=c.id and r.org_id=c.org_id
 and public.native_org_today(r.org_id) between r.valid_from and coalesce(r.valid_to,'infinity'::date) -- mut:site_roster_dates
 and public.actor_may_task_issue(r.work_order_id)))),false)
$$;
revoke all on function public.supervisor_may_lend_crew(uuid) from public,anon;
grant execute on function public.supervisor_may_lend_crew(uuid) to authenticated,service_role;

create or replace function public.actor_may_lend_workers(p_home_crew uuid,p_from date,p_to date) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select coalesce(public.crew_can_manage() or
 (p_from is not distinct from p_to and public.supervisor_may_lend_crew(p_home_crew)),false)
$$;
alter policy crew_loans_insert on public.crew_loans with check (
 org_id=(select public.auth_org_id()) and (select public.is_active_member())
 and public.actor_may_lend_workers(home_crew_id,valid_from,valid_to)
 and (public.crew_can_manage() or public.supervisor_may_lend_crew(host_crew_id))); -- mut:site_host_scope
alter policy crew_loans_update on public.crew_loans using (
 org_id=(select public.auth_org_id()) and (select public.is_active_member())
 and public.actor_may_lend_workers(home_crew_id,valid_from,valid_to)
 and (public.crew_can_manage() or public.supervisor_may_lend_crew(host_crew_id))) with check (
 org_id=(select public.auth_org_id()) and (select public.is_active_member())
 and public.actor_may_lend_workers(home_crew_id,valid_from,valid_to)
 and (public.crew_can_manage() or public.supervisor_may_lend_crew(host_crew_id)));

create function public.supervisor_loan_crews() returns setof uuid
language sql stable security definer set search_path=public,pg_temp as $$
 select c.id from public.crews c where c.org_id=public.auth_org_id() and public.supervisor_may_lend_crew(c.id)
$$;
revoke all on function public.supervisor_loan_crews() from public,anon;
grant execute on function public.supervisor_loan_crews() to authenticated,service_role;

create function public.actor_may_task_incident(p_incident uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select coalesce(public.is_active_member() and exists(select 1 from public.incident_reports i
 where i.id=p_incident and i.org_id=public.auth_org_id() and (
 public.actor_may_task_issue(i.work_order_id) or (i.work_order_id is null and exists(
 select 1 from public.work_orders w where w.project_id=i.project_id and w.org_id=i.org_id
 and public.actor_may_task_issue(w.id))))),false)
$$;
revoke all on function public.actor_may_task_incident(uuid) from public,anon;
grant execute on function public.actor_may_task_incident(uuid) to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.add_task_to_incident(p_incident uuid, p_name text, p_assignee uuid DEFAULT NULL::uuid, p_due_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare i public.incident_reports; v_task uuid; v_name text := left(btrim(coalesce(p_name, '')), 200);
begin
  perform public.assert_not_light();
  if not public.is_active_member()
     or (public.auth_role() not in ('Admin','Executive','Project Manager','Finance') and not public.actor_holds_job_role('site_supervisor')) then
    raise exception 'only a manager, or the site supervisor of its work order, may add a task to an issue' using errcode = '42501';
  end if;
  select * into i from public.incident_reports where id = p_incident and org_id = public.auth_org_id() for update;
  if not found then raise exception 'issue not found' using errcode = '42501'; end if;
  if not public.actor_may_task_incident(i.id) then
    raise exception 'only a manager, or the site supervisor of its work order, may add a task to an issue' using errcode = '42501';
  end if;
  if not public.org_feature_enabled(i.org_id, 'incidents') then
    raise exception 'incidents are switched off' using errcode = '42501';
  end if;
  if i.project_id is null then
    raise exception 'name the issue''s project before making a task' using errcode = '23514';
  end if;
  if i.status = 'Closed' then
    raise exception 'a closed issue takes no new task' using errcode = '23514';
  end if;
  if v_name = '' then
    raise exception 'a task needs a name' using errcode = '23514';
  end if;
  if p_assignee is not null and not exists (select 1 from public.profiles p
       where p.id = p_assignee and p.org_id = i.org_id and p.status = 'active') then
    raise exception 'assignee must be an active member of this org' using errcode = '23514';
  end if;
  if (select count(*) from public.incident_tasks where incident_id = i.id) >= 100 then
    raise exception 'this issue has the most tasks it can take' using errcode = '23514';
  end if;

  insert into public.tasks (org_id, project_id, name, assignee_id, end_date)
  values (i.org_id, i.project_id, v_name, p_assignee, p_due_date)
  returning id into v_task;
  insert into public.incident_tasks (incident_id, task_id, org_id, created_by) values (i.id, v_task, i.org_id, auth.uid());
  return v_task;
end; $function$
;

alter table public.crew_loans add column created_by uuid references public.profiles(id);
create function public.stamp_crew_loan_actor() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then new.created_by:=auth.uid();
 else new.created_by:=old.created_by; end if;
 return new;
end $$;
revoke all on function public.stamp_crew_loan_actor() from public,anon,authenticated;
create trigger crew_loans_actor before insert or update on public.crew_loans for each row execute function public.stamp_crew_loan_actor();

create policy supervisor_attendance_read on public.attendance_days for select to authenticated using (org_id=(select public.auth_org_id()) and public.actor_holds_job_role('site_supervisor') and public.actor_may_task_issue(work_order_id));
