-- 1392_add_task_to_incident.sql — #2677: the second and later tasks of an issue. Spec FR-ITR-002/003, 013.
-- One transaction, one task, one incident_tasks row. Same permission rule as create_task_from_incident (1028): a manager,
-- the issue in the caller's org (a foreign issue reads as missing), the `incidents` entitlement on, the issue named a project.
-- Also: no task on a Closed issue, an active-member assignee, and 100 tasks per issue as a technical abuse bound (not client
-- process, not a setting). The issue row is locked so the count is race-safe.
-- ── REVERSE (also rollback/1392_add_task_to_incident_down.sql): drop function public.add_task_to_incident(uuid,text,uuid,date);

create function public.add_task_to_incident(p_incident uuid, p_name text, p_assignee uuid default null, p_due_date date default null)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.incident_reports; v_task uuid; v_name text := left(btrim(coalesce(p_name, '')), 200);
begin
  if not public.is_active_member() or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'only a manager may add a task to an issue' using errcode = '42501';
  end if;
  select * into i from public.incident_reports where id = p_incident and org_id = public.auth_org_id() for update;
  if not found then raise exception 'issue not found' using errcode = '42501'; end if;
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
end; $$;
revoke all on function public.add_task_to_incident(uuid, text, uuid, date) from public, anon;
grant execute on function public.add_task_to_incident(uuid, text, uuid, date) to authenticated;
