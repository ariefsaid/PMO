drop policy incident_reports_update_reporter on public.incident_reports;
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
create or replace function public.guard_incident_issue_fields() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_mgr boolean := auth.uid() is null or public.auth_role() in ('Admin','Executive','Project Manager','Finance');
  v_wo_org uuid; v_wo_project uuid;
begin
  -- work order: of the issue's own project and org (the #2517 rule)
  if new.work_order_id is not null then
    if new.project_id is null then
      raise exception 'a work order needs the issue to name its project' using errcode = '23514';
    end if;
    select w.org_id, w.project_id into v_wo_org, v_wo_project from public.work_orders w where w.id = new.work_order_id;
    if v_wo_org is distinct from new.org_id then
      raise exception 'work order not in this org' using errcode = '42501';
    end if;
    if v_wo_project is distinct from new.project_id then
      raise exception 'work order belongs to another project' using errcode = '23514';
    end if;
  end if;

  -- assignee: an active member of the issue's org
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    if not exists (select 1 from public.profiles p where p.id = new.assignee_id and p.org_id = new.org_id and p.status = 'active') then
      raise exception 'assignee must be an active member of this org' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_uid is not null and new.due_at is not null and new.due_at < now() then
      raise exception 'due time cannot be in the past' using errcode = '23514';
    end if;
    new.escalated_at := null;
    new.task_id := null;
    if new.status = 'Closed' then new.closed_at := now(); new.closed_by := v_uid;
    else new.closed_at := null; new.closed_by := null; end if;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------------------------------------
  if not v_mgr then
    -- the assignee: status, the close note and the root cause only; never a reopen
    if (to_jsonb(new) - 'status' - 'close_note' - 'root_cause' - 'closed_at' - 'closed_by')
       is distinct from (to_jsonb(old) - 'status' - 'close_note' - 'root_cause' - 'closed_at' - 'closed_by') then
      raise exception 'only a manager may change the assignee, due time, work order or action' using errcode = '42501';
    end if;
    if old.status = 'Open' and new.status = 'Closed' then
      raise exception 'an assignee must investigate before closing' using errcode = '23514';
    end if;
    if old.status = 'Closed' and new.status <> 'Closed' then
      raise exception 'only a manager may reopen an issue' using errcode = '42501';
    end if;
  end if;

  -- close stamps are the database's, never the client's
  if new.status = 'Closed' and old.status <> 'Closed' then
    new.closed_at := now(); new.closed_by := v_uid;
  elsif new.status = 'Closed' then
    new.closed_at := old.closed_at; new.closed_by := old.closed_by;
  else
    new.closed_at := null; new.closed_by := null;
    if old.status = 'Closed' then
      perform public.log_audit('incident.reopened', new.org_id, v_uid, new.id,
        jsonb_build_object('closed_at', old.closed_at, 'closed_by', old.closed_by, 'status', new.status));
    end if;
  end if;

  -- escalation: a client never sets it; moving the due time forward clears it (a later miss escalates again)
  if v_uid is not null then
    new.escalated_at := old.escalated_at;
    -- the link is written only by create_task_from_incident (1028), which raises this transaction-local flag
    if current_setting('pmo.incident_task_link', true) is distinct from 'on' then
      new.task_id := old.task_id;
    end if;
  end if;
  if old.escalated_at is not null and new.due_at is not null and new.due_at > coalesce(old.due_at, '-infinity') and new.due_at > now() then
    new.escalated_at := null;
    perform public.log_audit('incident.escalation_cleared', new.org_id, v_uid, new.id,
      jsonb_build_object('old_due_at', old.due_at, 'new_due_at', new.due_at));
  end if;
  return new;
end; $$;
revoke all on function public.guard_incident_issue_fields() from public, anon, authenticated;
