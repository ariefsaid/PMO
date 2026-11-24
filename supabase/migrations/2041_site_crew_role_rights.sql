-- 2041_site_crew_role_rights.sql — crew rights for the Storekeeper and the Site Supervisor job roles, by job-role key.
-- Storekeeper (held key): adds and edits a crew's tool lines, reports a damaged or lost tool and corrects that report, for a crew that
-- is today on a work order whose site location they keep (stock_warehouse_keepers). The person who reported a tool closes that
-- report only if they are a crew manager: the reporter is never the one who settles it.
-- Site Supervisor (held key): lends a worker of a crew they are the field controller of to another crew for one day; makes a task
-- linked to an issue on a work order they are assigned to (its responsible person, or the field controller of a crew on it). The
-- issue's own single task (create_task_from_incident) stays with managers: setting it is a manager's edit of the issue.
-- Each right reads ONE gate: crew_tool_may_manage, actor_may_lend_workers, actor_may_task_issue. Everyone who could act before still
-- can (each gate starts with today's rule); a person with no job role is judged by access level as before.
-- Restated from the live definitions (1157/1158/1159 crew tools, 1245 crew loans, 1392 issue tasks, each with the field-account
-- guard 1530 added to the body).
-- drops: the crew-manager-only role tests in the crew tool functions and policies and the manager-only test in the issue task
-- function (each now calls its gate, which keeps today's rule first), two refusal sentences that now name the new holders.
-- Proven by supabase/tests/2041_site_crew_role_rights.test.sql. Rollback: rollback/2041_site_crew_role_rights_down.sql

-- ── §1 the three gates ───────────────────────────────────────────────────────────────────────────────────────────────────────────
create function public.crew_tool_may_manage(p_crew uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.crew_can_manage()
    or (public.actor_holds_job_role('storekeeper')                                                         -- mut:rr_store_tools
        and exists (select 1 from public.work_order_crews r
                      join public.work_orders w on w.id = r.work_order_id and w.org_id = r.org_id
                      join public.stock_warehouse_keepers k on k.warehouse_id = w.site_warehouse_id and k.org_id = w.org_id
                     where r.crew_id = p_crew and r.org_id = public.auth_org_id() and k.user_id = auth.uid()
                       and public.native_org_today(r.org_id) between r.valid_from and coalesce(r.valid_to, 'infinity'::date))), false)
$$;
comment on function public.crew_tool_may_manage(uuid) is
  'Crew tools: a crew manager, or the Storekeeper job role for a crew today on a work order whose site location they keep.';
revoke all on function public.crew_tool_may_manage(uuid) from public, anon;
grant execute on function public.crew_tool_may_manage(uuid) to authenticated, service_role;

create function public.actor_may_lend_workers(p_home_crew uuid, p_from date, p_to date) returns boolean
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

create function public.actor_may_task_issue(p_work_order uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (
      public.auth_role() in ('Admin','Executive','Project Manager','Finance')
      or (public.actor_holds_job_role('site_supervisor')                                                   -- mut:rr_ss_task
          and exists (select 1 from public.work_orders w
                       where w.id = p_work_order and w.org_id = public.auth_org_id()
                         and (w.responsible_person_id = auth.uid()
                              or exists (select 1 from public.work_order_crews r join public.crews c on c.id = r.crew_id
                                          where r.work_order_id = w.id and c.field_controller_id = auth.uid()))))), false)
$$;
comment on function public.actor_may_task_issue(uuid) is
  'Tasks from an issue: a manager level, or the Site Supervisor job role on a work order it is assigned to.';
revoke all on function public.actor_may_task_issue(uuid) from public, anon;
grant execute on function public.actor_may_task_issue(uuid) to authenticated, service_role;

-- ── §2 crew tool lines: the policies read the tools gate ──────────────────────────────────────────────────────────────────────────
alter policy crew_tool_lines_insert on public.crew_tool_lines
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.crew_tool_may_manage(crew_id));
alter policy crew_tool_lines_update on public.crew_tool_lines
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.crew_tool_may_manage(crew_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.crew_tool_may_manage(crew_id));

-- ── §3 crew loans: the policies read the loan gate ───────────────────────────────────────────────────────────────────────────────
alter policy crew_loans_insert on public.crew_loans
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.actor_may_lend_workers(home_crew_id, valid_from, valid_to));
alter policy crew_loans_update on public.crew_loans
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and public.actor_may_lend_workers(home_crew_id, valid_from, valid_to))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.actor_may_lend_workers(home_crew_id, valid_from, valid_to));

-- ── §4 the crew tool functions ───────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.report_crew_tool(p_id uuid, p_line uuid, p_kind text, p_qty integer, p_note text, p_photos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_line public.crew_tool_lines; v_crew public.crews;
  v_open integer; v_usable integer; v_today date; v_due date; v_days integer; v_coord uuid;
  v_project uuid; v_task uuid; v_msg record; v_photo jsonb; v_path text; v_n integer := 0; v_rcpt uuid; v_loc text;
begin
  perform public.assert_not_light();
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if p_id is null or p_line is null or p_kind not in ('damaged', 'lost') or p_qty is null or p_qty < 1
     or (p_note is not null and char_length(p_note) > 500) or (p_photos is not null and jsonb_typeof(p_photos) <> 'array') then
    raise exception 'invalid tool report' using errcode = '22023';
  end if;

  -- FR-CTR-009: a retry returns the report it already made.
  if exists (select 1 from public.crew_tool_reports r where r.id = p_id and r.org_id = v_org) then return p_id; end if;
  if exists (select 1 from public.crew_tool_reports r where r.id = p_id) then
    raise exception 'report id already used' using errcode = '23505';
  end if;

  -- FR-CTR-007: the line row lock serialises concurrent reports on it.
  select * into v_line from public.crew_tool_lines l where l.id = p_line and l.org_id = v_org for update;
  if v_line.id is null then raise exception 'tool line not found' using errcode = 'P0002'; end if;
  select * into v_crew from public.crews c where c.id = v_line.crew_id;
  if not (public.crew_tool_may_manage(v_crew.id) or v_crew.field_controller_id = v_uid) then
    raise exception 'CTR_NOT_ALLOWED: only the crew''s field controller, a crew manager or the keeper of its site store reports a tool' using errcode = '42501';
  end if;
  if v_line.archived_at is not null then
    raise exception 'CTR_LINE_ARCHIVED: this tool line is archived' using errcode = '23514';
  end if;

  -- FR-CTR-006 / OD-CTR-3: a damaged report carries at least one photo; every path is the caller's own report's.
  for v_photo in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    v_path := v_photo->>'path';
    if v_path is null or array_length(string_to_array(v_path, '/'), 1) <> 4
       or split_part(v_path, '/', 1) <> v_org::text or split_part(v_path, '/', 2) <> p_id::text
       or not public.crew_tool_photo_stored(v_path) then
      raise exception 'CTR_PHOTO: a photo path is not an uploaded file of this report' using errcode = '23514';
    end if;
    v_n := v_n + 1;
  end loop;
  if p_kind = 'damaged' and v_n = 0 then
    raise exception 'CTR_PHOTO_REQUIRED: add a photo of the damaged tool' using errcode = '23514';
  end if;

  select coalesce(sum(r.qty), 0) into v_open from public.crew_tool_reports r where r.line_id = v_line.id and r.status = 'open';
  v_usable := greatest(v_line.held_qty - v_open, 0);
  if p_qty > v_usable then
    raise exception 'CTR_QTY_EXCEEDS_USABLE: only % usable', v_usable using errcode = '23514', detail = v_usable::text;
  end if;

  select s.coordinator_id, s.task_due_days into v_coord, v_days from public.org_crew_tool_settings s where s.org_id = v_org;
  v_days := coalesce(v_days, 3);
  -- an ex-coordinator who left or was disabled means no coordinator
  if v_coord is not null and not (public.is_active_member(v_coord)
       and exists (select 1 from public.profiles p where p.id = v_coord and p.org_id = v_org)) then v_coord := null; end if;
  v_today := public.native_org_today(v_org);
  v_due := v_today + v_days;

  -- OQ-CTR-2: the rostered project, when exactly one work order roster covers the day (the exclusion constraint of 1035 allows one).
  select wo.project_id into v_project
    from public.work_order_crews r join public.work_orders wo on wo.id = r.work_order_id
   where r.crew_id = v_crew.id and wo.org_id = v_org
     and v_today between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
   limit 1;
  if v_project is not null and public.task_domain_externally_owned(v_project) then v_project := null; end if;

  perform set_config('pmo.crew_tool_rpc', 'on', true);
  insert into public.crew_tool_reports (id, org_id, line_id, kind, qty, note, reported_by, reported_on, due_on)
  values (p_id, v_org, v_line.id, p_kind, p_qty, nullif(btrim(coalesce(p_note, '')), ''), v_uid, v_today, v_due);

  select m.task_name into v_msg from public.crew_tool_message(
    public.crew_tool_org_locale(v_org), p_kind, v_line.name, p_qty, v_crew.name, v_due) m;
  insert into public.tasks (org_id, project_id, name, description, assignee_id, end_date, crew_tool_report_id)
  values (v_org, v_project, left(v_msg.task_name, 200),
          nullif(btrim(coalesce(p_note, '')), ''), v_coord, v_due, p_id)
  returning id into v_task;
  update public.crew_tool_reports set task_id = v_task where id = p_id;

  for v_photo in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    insert into public.crew_tool_report_files (org_id, report_id, title, file_path, uploaded_by_id)
    values (v_org, p_id, left(nullif(btrim(coalesce(v_photo->>'title', '')), ''), 200), v_photo->>'path', v_uid);
  end loop;

  -- FR-CTR-012/013: the coordinator is told; with none set, everyone who can write the equipment register is.
  for v_rcpt in
    select x from (
      select v_coord as x where v_coord is not null
      union all
      select p.id from public.profiles p
       where v_coord is null and p.org_id = v_org and p.status = 'active' and p.role in ('Admin', 'Project Manager')) s
  loop
    v_loc := public.crew_tool_locale(v_rcpt);
    select m.title, m.body into v_msg from public.crew_tool_message(v_loc, p_kind, v_line.name, p_qty, v_crew.name, v_due) m;
    perform public.notify_workflow_user(v_org, v_rcpt, v_msg.title, v_msg.body, 'info', 'task', v_task, v_line.name);
  end loop;

  perform public.log_audit('crew_tool.report', v_org, v_uid, p_id,
    jsonb_build_object('line_id', v_line.id, 'kind', p_kind, 'qty', p_qty, 'task_id', v_task));
  perform set_config('pmo.crew_tool_rpc', 'off', true);
  return p_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.correct_crew_tool_report(p_report uuid, p_kind text, p_qty integer, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_rep public.crew_tool_reports; v_line public.crew_tool_lines; v_crew public.crews;
  v_others integer; v_msg record;
begin
  perform public.assert_not_light();
  if v_org is null or v_uid is null or not public.is_active_member() or not (public.crew_can_manage() or public.actor_holds_job_role('storekeeper')) then
    raise exception 'CTR_NOT_ALLOWED: only a crew manager or the keeper of the crew''s site store corrects a tool report' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 or char_length(p_reason) > 500 then
    raise exception 'CTR_REASON_REQUIRED: give a reason for the correction' using errcode = '23514';
  end if;
  if p_kind not in ('damaged', 'lost') or p_qty is null or p_qty < 1 then
    raise exception 'invalid tool report' using errcode = '22023';
  end if;
  -- lock order: the line, then the report (the same as report_crew_tool and close_crew_tool_report)
  select * into v_rep from public.crew_tool_reports r where r.id = p_report and r.org_id = v_org;
  if v_rep.id is null then raise exception 'tool report not found' using errcode = 'P0002'; end if;
  select * into v_line from public.crew_tool_lines l where l.id = v_rep.line_id for update;
  select * into v_rep from public.crew_tool_reports r where r.id = p_report for update;
  if not public.crew_tool_may_manage(v_line.crew_id) then
    raise exception 'CTR_NOT_ALLOWED: only a crew manager or the keeper of the crew''s site store corrects a tool report' using errcode = '42501';
  end if;
  if v_rep.status <> 'open' then
    raise exception 'CTR_REPORT_CLOSED: a closed report cannot be corrected' using errcode = '23514';
  end if;
  if p_kind = 'damaged' and not exists (select 1 from public.crew_tool_report_files f where f.report_id = v_rep.id and f.archived_at is null) then
    raise exception 'CTR_PHOTO_REQUIRED: a damaged report needs a photo' using errcode = '23514';
  end if;
  select coalesce(sum(r.qty), 0) into v_others from public.crew_tool_reports r
   where r.line_id = v_line.id and r.status = 'open' and r.id <> v_rep.id;
  if p_qty > greatest(v_line.held_qty - v_others, 0) then
    raise exception 'CTR_QTY_EXCEEDS_USABLE: only % usable', greatest(v_line.held_qty - v_others, 0)
      using errcode = '23514', detail = greatest(v_line.held_qty - v_others, 0)::text;
  end if;
  update public.crew_tool_reports set kind = p_kind, qty = p_qty where id = v_rep.id;
  if v_rep.task_id is not null then
    select * into v_crew from public.crews c where c.id = v_line.crew_id;
    select m.task_name into v_msg from public.crew_tool_message(
      public.crew_tool_org_locale(v_org), p_kind, v_line.name, p_qty, v_crew.name, v_rep.due_on) m;
    perform set_config('pmo.crew_tool_rpc', 'on', true);
    update public.tasks set name = left(v_msg.task_name, 200) where id = v_rep.task_id;
    perform set_config('pmo.crew_tool_rpc', 'off', true);
  end if;
  perform public.log_audit('crew_tool.correct', v_org, v_uid, v_rep.id,
    jsonb_build_object('reason', btrim(p_reason), 'before', jsonb_build_object('kind', v_rep.kind, 'qty', v_rep.qty),
                       'after', jsonb_build_object('kind', p_kind, 'qty', p_qty)));
end $function$
;

CREATE OR REPLACE FUNCTION public.close_crew_tool_report(p_report uuid, p_resolution text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_rep public.crew_tool_reports; v_line public.crew_tool_lines; v_assignee uuid;
begin
  perform public.assert_not_light();
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if p_resolution not in ('replaced', 'repaired', 'written_off') then
    raise exception 'invalid resolution' using errcode = '22023';
  end if;
  select * into v_rep from public.crew_tool_reports r where r.id = p_report and r.org_id = v_org;
  if v_rep.id is null then raise exception 'tool report not found' using errcode = 'P0002'; end if;
  select * into v_line from public.crew_tool_lines l where l.id = v_rep.line_id for update;
  select * into v_rep from public.crew_tool_reports r where r.id = p_report for update;
  if v_rep.task_id is not null then select t.assignee_id into v_assignee from public.tasks t where t.id = v_rep.task_id; end if;
  -- the reporter closes nothing unless they are also the assignee or a crew manager (AC-CTR-008)
  if not (public.crew_can_manage() or v_assignee = v_uid) then
    raise exception 'CTR_NOT_ALLOWED: only the task assignee or a crew manager closes a tool report' using errcode = '42501';
  end if;
  if v_rep.reported_by = v_uid and not public.crew_can_manage() then                                   -- mut:rr_own_report
    raise exception 'CTR_OWN_REPORT: you reported this tool, so someone else closes the report' using errcode = '42501';
  end if;
  if v_rep.status <> 'open' then
    raise exception 'CTR_REPORT_CLOSED: already closed as %', v_rep.resolution using errcode = '23514', detail = v_rep.resolution;
  end if;
  if p_resolution = 'repaired' and v_rep.kind <> 'damaged' then
    raise exception 'CTR_RESOLUTION: only a damaged tool can be repaired' using errcode = '23514';
  end if;

  perform set_config('pmo.crew_tool_rpc', 'on', true);
  update public.crew_tool_reports
     set status = 'closed', resolution = p_resolution, closed_by = v_uid, closed_at = now() where id = v_rep.id;
  if p_resolution = 'written_off' then
    update public.crew_tool_lines set held_qty = held_qty - v_rep.qty where id = v_line.id;
  end if;
  if v_rep.task_id is not null then
    update public.tasks set status = 'Done', completed_at = coalesce(completed_at, now())
     where id = v_rep.task_id and status <> 'Done';
  end if;
  perform public.log_audit('crew_tool.close', v_org, v_uid, v_rep.id,
    jsonb_build_object('resolution', p_resolution, 'qty', v_rep.qty, 'kind', v_rep.kind));
  perform set_config('pmo.crew_tool_rpc', 'off', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.crew_tool_can_report(p_line uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.crew_tool_lines l join public.crews c on c.id = l.crew_id
     where l.id = p_line and l.org_id = public.auth_org_id()
       and (public.crew_tool_may_manage(c.id) or c.field_controller_id = auth.uid())), false)
$function$
;

CREATE OR REPLACE FUNCTION public.crew_tool_is_reporter()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(public.is_active_member() and (public.crew_can_manage()
    or exists (select 1 from public.crews s where s.org_id = public.auth_org_id() and public.crew_tool_may_manage(s.id))
    or exists (
    select 1 from public.crews c where c.org_id = public.auth_org_id() and c.field_controller_id = auth.uid())), false)
$function$
;


-- ── §5 tasks from an issue ───────────────────────────────────────────────────────────────────────────────────────────────────────

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
