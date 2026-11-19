-- 0981_site_issue_escalation_and_task.sql — #2521: the overdue pass and the issue-to-task hand-off.
-- Spec docs/specs/site-issue-log.spec.md (FR-SIL-020..023, FR-SIL-030/031); proven by supabase/tests/0979_site_issue_log.test.sql.
--   §1 escalate_overdue_incidents(): every issue not Closed whose due time has passed and that has not been escalated, in an
--      org whose `incidents` switch is on: stamp escalated_at once, notify the assignee and the project's manager (Admins
--      when the project has none), write an audit row. A second run finds nothing. Scheduled every 15 minutes.
--   §2 create_task_from_incident(uuid): one transaction, one task, linked through incident_reports.task_id (unique).
--      The task is built without a work-order link when `tasks.work_order_id` does not exist yet (#2531); once it does, the
--      same call sets it (read from information_schema at call time, no re-migration needed).
-- ── REVERSE (also rollback/0981_site_issue_escalation_and_task_down.sql) ─────────────────────────────
--   select cron.unschedule('incident-escalation'); drop function public.escalate_overdue_incidents(uuid); drop function public.create_task_from_incident(uuid);

create function public.escalate_overdue_incidents(p_incident uuid default null) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_pm uuid; v_to uuid[]; v_who uuid; v_n integer := 0; v_label text;
begin
  for r in
    select i.id, i.org_id, i.project_id, i.assignee_id, i.action, i.due_at, i.type, i.location, i.description
      from public.incident_reports i
     where (p_incident is null or i.id = p_incident)
       and i.status <> 'Closed' and i.due_at is not null and i.due_at < now() and i.escalated_at is null
       -- The scheduler has no user JWT; resolve the same global/override/plan rule directly.
       and coalesce((select f.enabled from public.resolve_feature_internal(i.org_id, 'incidents') f), false)
     order by i.due_at
       for update of i skip locked
  loop
    update public.incident_reports set escalated_at = now() where id = r.id;
    select p.project_manager_id into v_pm from public.projects p
      join public.profiles m on m.id = p.project_manager_id and m.org_id = r.org_id and m.status = 'active'
     where p.id = r.project_id;
    v_to := array[]::uuid[];
    if r.assignee_id is not null then v_to := v_to || r.assignee_id; end if;
    if v_pm is not null then v_to := v_to || v_pm; end if;
    if v_pm is null then
      v_to := v_to || coalesce((select array_agg(p.id) from public.profiles p
                                  where p.org_id = r.org_id and p.role = 'Admin' and p.status = 'active'), array[]::uuid[]);
    end if;
    v_label := coalesce(nullif(btrim(r.action), ''), r.type);
    for v_who in select distinct u from unnest(v_to) u loop
      perform public.notify_workflow_user(r.org_id, v_who, 'Issue is overdue', v_label, 'warning', 'incident', r.id, v_label);
    end loop;
    perform public.log_audit('incident.escalated', r.org_id, null, r.id,
      jsonb_build_object('due_at', r.due_at, 'assignee_id', r.assignee_id, 'project_manager_id', v_pm));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.escalate_overdue_incidents(uuid) from public, anon, authenticated;

select cron.schedule('incident-escalation', '*/15 * * * *', 'select public.escalate_overdue_incidents()');

create function public.create_task_from_incident(p_incident uuid) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.incident_reports; v_task uuid; v_timezone text;
begin
  if not public.is_active_member() or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'only a manager may create a task from an issue' using errcode = '42501';
  end if;
  select * into i from public.incident_reports where id = p_incident and org_id = public.auth_org_id() for update;
  if not found then raise exception 'issue not found' using errcode = '42501'; end if;
  if not public.org_feature_enabled(i.org_id, 'incidents') then
    raise exception 'incidents are switched off' using errcode = '42501';
  end if;
  if i.task_id is not null then
    raise exception 'this issue already has a task' using errcode = '23505', detail = i.task_id::text;
  end if;
  if i.project_id is null then
    raise exception 'name the issue''s project before making a task' using errcode = '23514';
  end if;

  select coalesce(nullif(p.timezone, ''), nullif(o.default_timezone, ''), 'Asia/Jakarta') into v_timezone
    from public.profiles p join public.organizations o on o.id = p.org_id where p.id = auth.uid();

  insert into public.tasks (org_id, project_id, name, description, assignee_id, end_date)
  values (i.org_id, i.project_id, left(coalesce(nullif(btrim(i.action), ''), i.type || ' issue'), 200),
          nullif(btrim(coalesce(i.description, '')), ''), i.assignee_id, (i.due_at at time zone v_timezone)::date)
  returning id into v_task;

  if i.work_order_id is not null and exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks' and column_name = 'work_order_id') then
    execute 'update public.tasks set work_order_id = $1 where id = $2' using i.work_order_id, v_task;
  end if;

  perform set_config('pmo.incident_task_link', 'on', true);
  update public.incident_reports set task_id = v_task where id = i.id;
  perform set_config('pmo.incident_task_link', 'off', true);
  return v_task;
end; $$;
revoke all on function public.create_task_from_incident(uuid) from public, anon;
grant execute on function public.create_task_from_incident(uuid) to authenticated;
