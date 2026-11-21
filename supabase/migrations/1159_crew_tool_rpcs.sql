-- 1159_crew_tool_rpcs.sql — #2581: the tool report's writers, the coordinator setting and the usable-quantity view.
-- Spec: docs/specs/crew-tools-register.spec.md (FR-CTR-006..014, 016). Proven by supabase/tests/crew_tool_*.test.sql.
--   report_crew_tool          report + photo rows + task + notifications in ONE call, idempotent on the report id
--   correct_crew_tool_report  a crew manager corrects kind or quantity of an open report, with a reason (audited)
--   close_crew_tool_report    the one call that closes a report AND sets its task Done (assignee or crew manager)
--   set_crew_tool_settings    coordinator and task due days (Admin, Project Manager)
--   crew_tool_line_summary    held / damaged / lost / usable per live line (security invoker)
-- No money: nothing is costed, posted or approved here (OQ-CTR-3). Reversal: rollback/1159_crew_tool_rpcs_down.sql.

-- ── wording for the task and the notification, in the reader's language (FR-CTR-011/013) ───────────────────────
create function public.crew_tool_message(p_locale text, p_kind text, p_tool text, p_qty integer, p_crew text, p_due date)
  returns table (task_name text, title text, body text)
  language sql immutable set search_path = public, pg_temp as $$
  select case when p_locale = 'id' then format('Ganti: %s x%s (%s)', p_tool, p_qty, p_crew)
              else format('Replace: %s x%s (%s)', p_tool, p_qty, p_crew) end,
         case when p_locale = 'id'
              then format('Alat %s: %s x%s (%s)', case p_kind when 'damaged' then 'rusak' else 'hilang' end, p_tool, p_qty, p_crew)
              else format('Tool %s: %s x%s (%s)', p_kind, p_tool, p_qty, p_crew) end,
         case when p_locale = 'id' then format('Tugas penggantian dibuat, jatuh tempo %s.', p_due)
              else format('A replacement task was created, due %s.', p_due) end
$$;
revoke all on function public.crew_tool_message(text, text, text, integer, text, date) from public, anon, authenticated;

-- The task's name is written once for the organisation, in its default language.
create function public.crew_tool_org_locale(p_org uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when o.default_locale = 'id' then 'id' else 'en' end from public.organizations o where o.id = p_org
$$;
revoke all on function public.crew_tool_org_locale(uuid) from public, anon, authenticated;

create function public.crew_tool_locale(p_user uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(nullif(p.locale, ''), o.default_locale, 'en') = 'id' then 'id' else 'en' end
    from public.profiles p join public.organizations o on o.id = p.org_id where p.id = p_user
$$;
revoke all on function public.crew_tool_locale(uuid) from public, anon, authenticated;

-- ── report (FR-CTR-006..009, 011..013) ──────────────────────────────────────────────────────────────────────────
-- p_photos: [{path, title?}] — storage paths {org}/{p_id}/{file}/{filename} of objects already uploaded.
create function public.report_crew_tool(p_id uuid, p_line uuid, p_kind text, p_qty integer, p_note text, p_photos jsonb)
  returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_line public.crew_tool_lines; v_crew public.crews;
  v_open integer; v_usable integer; v_today date; v_due date; v_days integer; v_coord uuid;
  v_project uuid; v_task uuid; v_msg record; v_photo jsonb; v_path text; v_n integer := 0; v_rcpt uuid; v_loc text;
begin
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
  if not (public.crew_can_manage() or v_crew.field_controller_id = v_uid) then
    raise exception 'CTR_NOT_ALLOWED: only the crew''s field controller or a crew manager reports a tool' using errcode = '42501';
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
end $$;
revoke all on function public.report_crew_tool(uuid, uuid, text, integer, text, jsonb) from public, anon;
grant execute on function public.report_crew_tool(uuid, uuid, text, integer, text, jsonb) to authenticated;

-- ── correct (FR-CTR-010) ──────────────────────────────────────────────────────────────────────────────────────
create function public.correct_crew_tool_report(p_report uuid, p_kind text, p_qty integer, p_reason text)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_rep public.crew_tool_reports; v_line public.crew_tool_lines; v_crew public.crews;
  v_others integer; v_msg record;
begin
  if v_org is null or v_uid is null or not public.is_active_member() or not public.crew_can_manage() then
    raise exception 'CTR_NOT_ALLOWED: only a crew manager corrects a tool report' using errcode = '42501';
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
end $$;
revoke all on function public.correct_crew_tool_report(uuid, text, integer, text) from public, anon;
grant execute on function public.correct_crew_tool_report(uuid, text, integer, text) to authenticated;

-- ── close (FR-CTR-014) ────────────────────────────────────────────────────────────────────────────────────────
create function public.close_crew_tool_report(p_report uuid, p_resolution text)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_rep public.crew_tool_reports; v_line public.crew_tool_lines; v_assignee uuid;
begin
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
end $$;
revoke all on function public.close_crew_tool_report(uuid, text) from public, anon;
grant execute on function public.close_crew_tool_report(uuid, text) to authenticated;

-- ── coordinator setting (FR-CTR-012, FR-CTR-016 configure) ──────────────────────────────────────────────────────────
create function public.set_crew_tool_settings(p_coordinator uuid, p_due_days integer)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
begin
  if v_org is null or v_uid is null or not public.is_active_member() or public.auth_role() not in ('Admin', 'Project Manager') then
    raise exception 'CTR_NOT_ALLOWED: only an Admin or Project Manager sets the equipment coordinator' using errcode = '42501';
  end if;
  if p_due_days is null or p_due_days not between 1 and 60 then
    raise exception 'due days must be 1 to 60' using errcode = '22023';
  end if;
  if p_coordinator is not null and not (public.is_active_member(p_coordinator)
       and exists (select 1 from public.profiles p where p.id = p_coordinator and p.org_id = v_org)) then
    raise exception 'CTR_REF: the coordinator must be an active user of this organisation' using errcode = '23514';
  end if;
  insert into public.org_crew_tool_settings (org_id, coordinator_id, task_due_days, updated_by, updated_at)
  values (v_org, p_coordinator, p_due_days, v_uid, now())
  on conflict (org_id) do update
    set coordinator_id = excluded.coordinator_id, task_due_days = excluded.task_due_days,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.log_audit('crew_tool.settings', v_org, v_uid, v_org,
    jsonb_build_object('coordinator_id', p_coordinator, 'task_due_days', p_due_days));
end $$;
revoke all on function public.set_crew_tool_settings(uuid, integer) from public, anon;
grant execute on function public.set_crew_tool_settings(uuid, integer) to authenticated;

-- ── the crew screen's one indexed read (FR-CTR-004, NFR-CTR-002) ─────────────────────────────────────────────────────
-- security invoker: the caller's RLS on both tables decides what it sees (another organisation sees nothing).
create view public.crew_tool_line_summary with (security_invoker = true) as
  select l.id, l.crew_id, l.name, l.code, l.serial, l.held_qty, l.note, l.archived_at,
         coalesce(s.damaged, 0)::integer as damaged_qty, coalesce(s.lost, 0)::integer as lost_qty,
         greatest(l.held_qty - coalesce(s.damaged, 0) - coalesce(s.lost, 0), 0)::integer as usable_qty
    from public.crew_tool_lines l
    left join lateral (
      select sum(r.qty) filter (where r.kind = 'damaged') as damaged, sum(r.qty) filter (where r.kind = 'lost') as lost
        from public.crew_tool_reports r where r.line_id = l.id and r.status = 'open') s on true;
revoke all on public.crew_tool_line_summary from public, anon, authenticated;
grant select on public.crew_tool_line_summary to authenticated;
grant all on public.crew_tool_line_summary to service_role;
