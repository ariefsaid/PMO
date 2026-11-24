drop policy supervisor_attendance_read on public.attendance_days;
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
  if not public.actor_may_task_issue(i.work_order_id) then
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
create or replace function public.actor_may_task_issue(p_work_order uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (
      public.auth_role() in ('Admin','Executive','Project Manager','Finance')
      or (public.actor_holds_job_role('site_supervisor')                                                   -- mut:rr_ss_task
          and exists (select 1 from public.work_orders w
                       where w.id = p_work_order and w.org_id = public.auth_org_id()
                         and (w.responsible_person_id = auth.uid()
                              or exists (select 1 from public.work_order_crews r join public.crews c on c.id = r.crew_id
                                          where r.work_order_id = w.id and c.field_controller_id = auth.uid()
                                            and public.native_org_today(r.org_id) between r.valid_from                -- mut:rr_ss_task_current
                                                and coalesce(r.valid_to, 'infinity'::date)))))), false)
$$;

create or replace function public.actor_may_lend_workers(p_home_crew uuid, p_from date, p_to date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.crew_can_manage()
    or (public.actor_holds_job_role('site_supervisor')                                                     -- mut:rr_ss_loan
        and p_to is not distinct from p_from
        and exists (select 1 from public.crews c
                     where c.id = p_home_crew and c.org_id = public.auth_org_id() and c.field_controller_id = auth.uid())), false)
$$;
comment on function public.actor_may_lend_workers(uuid, date, date) is
  'Crew loans: a crew manager; or the Site Supervisor job role lending a worker of a crew it is the field controller of, for one day.';
revoke all on function public.actor_may_lend_workers(uuid, date, date) from public, anon;
grant execute on function public.actor_may_lend_workers(uuid, date, date) to authenticated, service_role;


drop function public.actor_may_task_incident(uuid);
alter policy crew_loans_insert on public.crew_loans
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.actor_may_lend_workers(home_crew_id, valid_from, valid_to));
alter policy crew_loans_update on public.crew_loans
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and public.actor_may_lend_workers(home_crew_id, valid_from, valid_to))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.actor_may_lend_workers(home_crew_id, valid_from, valid_to));


drop function public.supervisor_loan_crews();
drop function public.supervisor_may_lend_crew(uuid);
drop trigger crew_loans_actor on public.crew_loans;
drop function public.stamp_crew_loan_actor();
alter table public.crew_loans drop column created_by;
