-- 2803_role_setting_defaults_down.sql — reverse of 2803_role_setting_defaults.sql (RR-3 working defaults).
-- Restates each body from the migration 2803 replaced it with (the pre-2803 latest definitions) and drops the two
-- helpers. Seeded default rows are data: an org that adopted them keeps them; re-running 2803 re-seeds orgs that
-- keep none.

-- ── §2 daily-report validators: back to the Admin-list-only rules ──────────────────────────────────────────────
drop function public.dsr_fills_validate_role(uuid, uuid);
drop function public.dsr_validate_role_keys(uuid);

create or replace function public.actor_has_role_capability(p_capability text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select (
    p_capability = 'daily_report_validate'
    and public.org_built_in_roles_enabled(public.auth_org_id())
    and exists (
      select 1
        from public.organizations o
       where o.id = public.auth_org_id()
         and public.actor_built_in_role() = any (o.daily_report_validate_roles) -- mut:dsr_validate_org_role
    )
  ) or coalesce(public.role_has_capability(public.actor_built_in_role(), p_capability), false)
$$;
create or replace function public.get_dsr_validation_route(p_report_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid            uuid := auth.uid();
  v_org            uuid;
  v_author         uuid;
  v_status         text;
  v_project        uuid;
  v_pm             uuid;
  v_pm_found       boolean := false;
  v_pm_name        text;
  v_pm_role        public.user_role;
  v_pm_active      boolean := false;
  v_pm_light       boolean := true;
  v_finance_admin  boolean;
  v_validate_roles text[];
begin
  if v_uid is null or not coalesce(public.is_active_member(), false) then
    raise exception 'your account is not an active member of this organisation, so it cannot read a validation route'
      using errcode = '42501';
  end if;

  select r.org_id, r.author_id, r.status, r.project_id
    into v_org, v_author, v_status, v_project
    from public.daily_site_reports r
   where r.id = p_report_id;

  if v_org is null or v_status is distinct from 'submitted' then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  select p.project_manager_id into v_pm
    from public.projects p
   where p.id = v_project and p.org_id = v_org;
  if not found then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  if v_pm is not null then
    select pr.full_name, pr.role, (pr.status = 'active'), public.is_light_role_key(pr.built_in_role)
      into v_pm_name, v_pm_role, v_pm_active, v_pm_light
      from public.profiles pr
     where pr.id = v_pm and pr.org_id = v_org;
    v_pm_found := found;
  end if;

  select coalesce(array_agg(distinct pr.built_in_role order by pr.built_in_role), '{}'::text[])
    into v_validate_roles
    from public.organizations o
    join public.profiles pr
      on pr.org_id = o.id
     and pr.status = 'active'
     and pr.id <> v_author
     and not public.is_light_role_key(pr.built_in_role)
     and pr.built_in_role = any (o.daily_report_validate_roles) -- mut:dsr_route_validate_roles
   where o.id = v_org
     and o.built_in_roles_enabled is true;

  if v_pm_found
     and v_pm_role = 'Project Manager'
     and v_pm_active
     and not v_pm_light
     and v_pm is distinct from v_author
     and btrim(coalesce(v_pm_name, '')) <> '' then
    return jsonb_build_object(
      'approvers', jsonb_build_array(
        jsonb_build_object('id', v_pm, 'name', v_pm_name, 'role', v_pm_role::text)),
      'route_kind', 'project_manager')
      || case when cardinality(v_validate_roles) > 0
              then jsonb_build_object('validate_roles', to_jsonb(v_validate_roles))
              else '{}'::jsonb end;
  end if;

  select exists (
    select 1
      from public.profiles pr
     where pr.org_id = v_org
       and pr.status = 'active'
       and pr.role in ('Admin', 'Finance')
       and not public.is_light_role_key(pr.built_in_role)
       and pr.id <> v_author)
    into v_finance_admin;

  return jsonb_build_object(
    'approvers', '[]'::jsonb,
    'route_kind', case
      when v_finance_admin then 'finance_admin'
      when cardinality(v_validate_roles) > 0 then 'job_roles'
      else 'nobody'
    end)
    || case when cardinality(v_validate_roles) > 0
            then jsonb_build_object('validate_roles', to_jsonb(v_validate_roles))
            else '{}'::jsonb end;
end $$;

revoke all on function public.get_dsr_validation_route(uuid) from public, anon;
grant execute on function public.get_dsr_validation_route(uuid) to authenticated;

create or replace function public.dsr_validation_queue()
returns table (report_id uuid, project_id uuid, work_order_id uuid, work_order_label text, work_date date, author_id uuid,
               author_name text, submitted_at timestamptz, total_revenue numeric, unrated_lines integer, age_days integer,
               waiting_for_validator boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.dsr_require_member();
  return query
  select d.id, d.project_id, d.work_order_id, coalesce(w.wo_number || ' · ', '') || w.title, d.work_date, d.author_id,
         a.full_name, d.submitted_at,
         case
           when public.dsr_may_see_revenue(d.project_id) then -- mut:dsr_queue_revenue_mask
             coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                       left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id) v on true
                       where l.report_id = d.id), 0)
           else null::numeric
         end,
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id))),
         greatest(0, (public.equipment_org_today(d.org_id) - d.work_date) - 1),
         not exists (select 1 from public.profiles pr join public.projects p on p.id = d.project_id
                      where pr.org_id = d.org_id and pr.status = 'active' and pr.id <> d.author_id
                        and not public.is_light_role_key(pr.built_in_role)
                        and (pr.role in ('Admin','Finance')
                             or (pr.role = 'Project Manager' and p.project_manager_id = pr.id)
                             or (public.org_built_in_roles_enabled(d.org_id)
                                 and exists (select 1 from public.organizations o
                                              where o.id = d.org_id
                                                and pr.built_in_role = any (o.daily_report_validate_roles)))))
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
    left join public.profiles a on a.id = d.author_id
   where d.org_id = public.auth_org_id() and d.status = 'submitted' and d.archived_at is null
     and public.dsr_may_validate(d.project_id)
   order by d.submitted_at, d.id
   limit 500;
end $$;

-- ── §3 the keeper guard: back to named keepers and the Admin override ───────────────────────────────────────────
create or replace function public.stock_assert_keeper(p_org uuid, p_warehouse uuid, p_uid uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare v_keeper boolean; v_admin boolean;
begin
  if coalesce(current_setting('pmo.dsr_stock_post', true), '') = 'on' then return false; end if;   -- 2676 the validator's authority (dsr_may_validate) is the control; set only inside dsr_post_stock / dsr_reverse_stock
  v_keeper := exists (select 1 from public.stock_warehouse_keepers k
                       where k.org_id = p_org and k.warehouse_id = p_warehouse and k.user_id = p_uid);   -- mut:keeper
  if v_keeper then return false; end if;
  v_admin := coalesce(public.role_rank(public.auth_role()) >= 50, false);                               -- mut:keeper_admin
  if v_admin then return true; end if;
  raise exception 'STK_NOT_KEEPER: you do not keep this warehouse' using errcode = 'P0001';
end $$;

-- ── §4 the crew tool gates: back to the named-controller identity ───────────────────────────────────────────────
create or replace function public.crew_tool_is_reporter() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (public.crew_can_manage() or exists (
    select 1 from public.crews c where c.org_id = public.auth_org_id() and c.field_controller_id = auth.uid())), false)
$$;
revoke all on function public.crew_tool_is_reporter() from public, anon;
grant execute on function public.crew_tool_is_reporter() to authenticated;
CREATE OR REPLACE FUNCTION public.crew_tool_can_report(p_line uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
AS $function$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.crew_tool_lines l join public.crews c on c.id = l.crew_id
     where l.id = p_line and l.org_id = public.auth_org_id()
       and (public.crew_tool_may_manage(c.id) or c.field_controller_id = auth.uid())), false)
$function$
;

-- ── §1 the seeder: back to 2740's pipeline-only body ─────────────────────────────────────────────────────────────
create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'Quotation Submitted', 0.200),
    (p_org_id, 'PQ Submitted',        0.400),
    (p_org_id, 'Tender Submitted',    0.800),
    (p_org_id, 'Negotiation',         0.900),
    (p_org_id, 'Won, Pending KoM',    null),
    (p_org_id, 'Ongoing Project',     null),
    (p_org_id, 'On Hold',             null),
    (p_org_id, 'Close Out',           null),
    (p_org_id, 'Loss Tender',         null),
    (p_org_id, 'Declined',            null),
    (p_org_id, 'Internal Project',    null)
  on conflict (org_id, status) do nothing;
$$;
revoke all on function public.seed_org_defaults(uuid) from public, anon, authenticated;

-- ── §4 the report RPC: back to 2041's named-controller guard ─────────────────────────────────────────────────────
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
