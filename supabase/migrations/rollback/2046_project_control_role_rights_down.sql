-- Reverses 2046_project_control_role_rights.sql: the live bodies and policies from before it; drops dsr_may_write_revenue.

CREATE OR REPLACE FUNCTION public.dsr_may_see_revenue(p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin','Finance','Executive')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid()))), false)
$function$
;

CREATE OR REPLACE FUNCTION public.wrp_writable_work_order(p_work_order uuid)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare w public.work_orders;
begin
  if not public.is_active_member() then
    raise exception 'WRP_ROLE: not authorized' using errcode = '42501';
  end if;
  select * into w from public.work_orders where id = p_work_order and org_id = public.auth_org_id();
  if w.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(w.project_id) then
    raise exception 'WRP_ROLE: you cannot change the revenue plan on this project' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(w.org_id) then
    raise exception 'WRP_OFF: the revenue plan is not switched on for this organisation' using errcode = '55000';
  end if;
  if w.status in ('Cancelled', 'Closed') then
    raise exception 'WRP_FROZEN: the plan of a % work order is frozen', lower(w.status::text) using errcode = '23514';
  end if;
  return w;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_boq_item_discipline(p_item uuid, p_discipline uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_project uuid; v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  perform public.dsr_require_member();
  select b.project_id into v_project from public.boq_items b where b.id = p_item and b.org_id = v_org;
  if v_project is null then raise exception 'contract item not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(v_project) then
    raise exception 'you cannot change contract items on this project' using errcode = '42501';
  end if;
  if p_discipline is not null and not exists (
       select 1 from public.cost_disciplines d where d.id = p_discipline and d.org_id = v_org and d.archived_at is null) then
    raise exception 'the discipline is not on your list or is archived' using errcode = '23514';
  end if;
  update public.boq_items set discipline_id = p_discipline where id = p_item;
  return p_discipline;
end $function$
;

CREATE OR REPLACE FUNCTION public.guard_work_order_section()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.work_order_sections := case when tg_op = 'DELETE' then old else new end;
  v_org uuid; v_project uuid; v_status public.work_order_status;
  v_writer boolean := coalesce(public.auth_role() in ('Admin', 'Executive', 'Finance', 'Project Manager'), false);
  v_blockers text;
  v_structure_changed boolean;
begin
  select w.org_id, w.project_id, w.status into v_org, v_project, v_status
    from public.work_orders w where w.id = v_row.work_order_id;
  if v_org is null or v_org is distinct from v_row.org_id then
    raise exception 'WOS_WO: the work order is not in your organisation' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    if v_status = 'Cancelled' then
      raise exception 'WOS_CANCELLED: a cancelled work order''s sections are frozen' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.project_id := v_project;
    if v_status in ('Cancelled', 'Closed') then
      raise exception 'WOS_STATUS: a % work order takes no new sections', lower(v_status::text) using errcode = '23514';
    end if;
    if (select count(*) from public.work_order_sections s where s.work_order_id = new.work_order_id) >= 200 then
      raise exception 'WOS_LIMIT: a work order has 200 sections at most' using errcode = '23514';
    end if;
    -- A section is created not ready, with no readiness author yet; the creation is the first history row.
    new.readiness := 'not_ready'; new.readiness_note := null;
    new.readiness_set_by := auth.uid(); new.readiness_set_at := clock_timestamp();
    new.archived_at := null;
    new.created_by := auth.uid(); new.updated_by := auth.uid(); new.created_at := now(); new.updated_at := now();
  else
    -- FR-WOS-007: where it lives is fixed once created.
    if new.work_order_id is distinct from old.work_order_id or new.project_id is distinct from old.project_id
       or new.org_id is distinct from old.org_id then
      raise exception 'WOS_KEY: a section keeps its work order and project' using errcode = '23514';
    end if;
    if v_status = 'Cancelled' then
      raise exception 'WOS_CANCELLED: a cancelled work order''s sections are frozen' using errcode = '23514';
    end if;
    v_structure_changed := (new.code, new.name, new.location_note, new.foreman_id, new.sort_order)
                           is distinct from (old.code, old.name, old.location_note, old.foreman_id, old.sort_order);
    -- FR-WOS-023: a caller who is not a structure role (the foreman) may change readiness and its note only.
    if auth.uid() is not null and not v_writer
       and (v_structure_changed or new.archived_at is distinct from old.archived_at) then
      raise exception 'WOS_FOREMAN_COLUMNS: a foreman may set readiness and its note only' using errcode = '42501';
    end if;
    if v_status = 'Closed' and v_structure_changed then
      raise exception 'WOS_STATUS: a closed work order''s sections allow readiness and archive only' using errcode = '23514';
    end if;
    if new.archived_at is not null and old.archived_at is null then
      v_blockers := public.wos_archive_blockers(new.id);
      if v_blockers is not null then
        raise exception 'WOS_ARCHIVE_BLOCKED: %', v_blockers using errcode = '23514';
      end if;
    end if;
    -- Readiness author and time are stamped here, never taken from the client.
    if (new.readiness, new.readiness_note) is distinct from (old.readiness, old.readiness_note) then
      new.readiness_set_by := auth.uid(); new.readiness_set_at := clock_timestamp();
    else
      new.readiness_set_by := old.readiness_set_by; new.readiness_set_at := old.readiness_set_at;
    end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_by := auth.uid(); new.updated_at := now();
  end if;

  -- FR-WOS-002: the foreman is an active user of the same organisation.
  if new.foreman_id is not null and (tg_op = 'INSERT' or new.foreman_id is distinct from old.foreman_id)
     and not exists (select 1 from public.profiles p
                      where p.id = new.foreman_id and p.org_id = new.org_id and p.status = 'active') then
    raise exception 'WOS_FOREMAN: the foreman must be an active user of this organisation' using errcode = '23514';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cus_assert_planner(p_work_order_id uuid, p_open boolean DEFAULT true)
 RETURNS work_orders
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; wo public.work_orders;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found then
    raise exception 'CUS_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if not public.may_record_project_progress(wo.project_id) then                                         -- mut:plan_writer
    raise exception 'CUS_FORBIDDEN: you cannot plan consumables for this work order' using errcode = '42501'; end if;
  if p_open and wo.status not in ('Draft', 'Issued') then
    raise exception 'CUS_WORK_ORDER: the work order is closed or cancelled; its consumable plan cannot change' using errcode = 'P0001'; end if;
  return wo;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_headcount_day(p_work_order_id uuid, p_crew_id uuid, p_work_date date, p_class_id uuid, p_count integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_backdate int;
  v_earliest date;
  v_today date;
  v_cur public.headcount_days;
  v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org)
     or not exists (select 1 from public.crews c where c.id = p_crew_id and c.org_id = v_org) then
    raise exception 'work order or crew not found' using errcode = 'P0002';   -- another organisation's id reads as absent
  end if;
  if not public.attendance_can_record(p_crew_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_count is null or p_count not between 1 and 500 then
    raise exception 'HC_COUNT: a head count is a whole number from 1 to 500' using errcode = '22023';
  end if;
  if not exists (select 1 from public.labour_cost_classes k where k.id = p_class_id and k.org_id = v_org and k.archived_at is null) then
    raise exception 'HC_CLASS: choose a labour class that is not archived' using errcode = '22023';
  end if;
  select o.attendance_backdate_days into v_backdate from public.organizations o where o.id = v_org;
  v_today := public.equipment_org_today(v_org);
  v_earliest := v_today - v_backdate;
  if p_work_date is null or p_work_date > v_today then
    raise exception 'HC_DATE_FUTURE: a head count cannot be recorded for a future date' using errcode = '23514';
  end if;
  if p_work_date < v_earliest then
    raise exception 'HC_DATE_OLD: the earliest date open for a head count is %', to_char(v_earliest, 'YYYY-MM-DD') using errcode = '23514';
  end if;
  if not exists (select 1 from public.work_order_crews r
                  where r.work_order_id = p_work_order_id and r.crew_id = p_crew_id and r.org_id = v_org
                    and p_work_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)) then
    raise exception 'HC_CREW_NOT_ROSTERED: that crew is not on this work order on that date' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hc:' || p_work_order_id::text || p_crew_id::text || p_work_date::text || p_class_id::text, 0));
  select * into v_cur from public.headcount_days h
   where h.work_order_id = p_work_order_id and h.crew_id = p_crew_id and h.work_date = p_work_date and h.class_id = p_class_id;
  if found and v_cur.approved_at is not null then
    raise exception 'HC_LOCKED: this head count is approved and final' using errcode = '23514';
  end if;
  if found then
    update public.headcount_days h
       set head_count = p_count, recorded_at = now(),
           recorded_by_ids = case when v_uid = any(h.recorded_by_ids) then h.recorded_by_ids else h.recorded_by_ids || v_uid end
     where h.id = v_cur.id returning h.id into v_id;
  else
    insert into public.headcount_days (org_id, work_order_id, crew_id, class_id, work_date, head_count, recorded_by_ids)
    values (v_org, p_work_order_id, p_crew_id, p_class_id, p_work_date, p_count, array[v_uid])
    returning id into v_id;
  end if;
  perform public.log_audit('headcount_day.record', v_org, v_uid, v_id,
            jsonb_build_object('work_order_id', p_work_order_id, 'crew_id', p_crew_id, 'class_id', p_class_id,
                               'work_date', p_work_date, 'head_count', p_count));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.clear_headcount_day(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_h public.headcount_days;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_h from public.headcount_days h where h.id = p_id and h.org_id = v_org;
  if not found then
    raise exception 'head count not found' using errcode = 'P0002';
  end if;
  if not public.attendance_can_record(v_h.crew_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_h.approved_at is not null then
    raise exception 'HC_LOCKED: this head count is approved and final' using errcode = '23514';
  end if;
  delete from public.headcount_days h where h.id = p_id;
  perform public.log_audit('headcount_day.clear', v_org, v_uid, p_id,
            jsonb_build_object('work_order_id', v_h.work_order_id, 'work_date', v_h.work_date, 'head_count', v_h.head_count));
end $function$
;

alter policy work_order_sections_insert on public.work_order_sections
  with check ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Finance'::user_role, 'Project Manager'::user_role])));
alter policy work_order_sections_update on public.work_order_sections
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and (((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Finance'::user_role, 'Project Manager'::user_role])) or (foreman_id = (select auth.uid()))))
  with check (org_id = (select public.auth_org_id()));
alter policy headcount_days_select on public.headcount_days
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()) and (((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]))
         or (exists (select 1 from public.crews c where c.id = headcount_days.crew_id and c.field_controller_id = (select auth.uid()))))));
drop function public.dsr_may_write_revenue(uuid);
