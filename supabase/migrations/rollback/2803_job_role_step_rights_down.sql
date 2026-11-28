drop policy work_orders_engineer_insert on public.work_orders;
drop policy work_orders_engineer_update on public.work_orders;
drop policy rate_catalogue_items_engineer_read on public.rate_catalogue_items;
drop policy rate_catalogue_variants_engineer_read on public.rate_catalogue_variants;
drop policy work_order_plan_lines_engineer_select on public.work_order_plan_lines;
drop policy work_order_plan_lines_engineer_insert on public.work_order_plan_lines;
drop policy work_order_plan_lines_engineer_update on public.work_order_plan_lines;
drop policy work_order_plan_lines_engineer_delete on public.work_order_plan_lines;
drop policy tasks_planner_update on public.tasks;
drop policy task_dependencies_planner_write on public.task_dependencies;
drop policy equipment_usage_entries_project_administrator_read on public.equipment_usage_entries;
drop policy attendance_hr_officer_read on public.attendance_days;
drop policy scheduled_reports_project_administrator_read on public.scheduled_reports;
update public.scheduled_reports set managed_by = 'admin' where managed_by = 'project_administrator';
alter table public.scheduled_reports drop constraint scheduled_reports_managed_by_check;
alter table public.scheduled_reports add constraint scheduled_reports_managed_by_check check (managed_by in ('admin', 'project_control_manager'));
create or replace function public.scheduled_report_pcm_may_change(p_id uuid, p_org uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select sr.managed_by = 'project_control_manager'
    from public.scheduled_reports sr
   where sr.id = p_id and sr.org_id = p_org and sr.archived_at is null
     and sr.kind in ('daily_progress', 'overdue_tasks')
$$;
revoke all on function public.scheduled_report_pcm_may_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.scheduled_report_pcm_may_change(uuid, uuid) to service_role;

create or replace function public.save_scheduled_report(
  p_id uuid, p_name text, p_kind text, p_frequency text, p_weekday integer, p_send_time time,
  p_user_ids uuid[], p_roles text[], p_enabled boolean
) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_is_admin boolean;
  v_is_pcm boolean;
  v_users uuid[];
  v_roles text[];
  v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := public.auth_role() = 'Admin';
  v_is_pcm := public.actor_holds_job_role('project_control_manager')
    and coalesce((select o.pcm_scheduled_reports_enabled from public.organizations o where o.id = v_org), false);
  if not (v_is_admin or v_is_pcm) then raise exception 'admin only' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  -- Kinds the Project Control Manager may not read are refused as "admin only" (not "unknown"). The kinds that role reads are
  -- named here, apart from the full list on the next line, so a kind added to the full list is not handed to that role as well.
  if not v_is_admin and p_kind not in ('daily_progress','overdue_tasks') then raise exception 'admin only' using errcode = '42501'; end if;
  if p_kind not in ('daily_progress','overdue_tasks') then raise exception 'unknown report kind' using errcode = '22023'; end if;
  if p_frequency not in ('daily','weekly') then raise exception 'unknown frequency' using errcode = '22023'; end if;
  if (p_frequency = 'weekly') <> (p_weekday is not null) or (p_weekday is not null and p_weekday not between 1 and 7) then
    raise exception 'weekday is required for weekly and only then' using errcode = '22023';
  end if;
  if p_send_time is null or p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  -- PCM may pick only active (non-banned), non-light members of their own organisation who can read this report, and non-light base roles.
  if not v_is_admin then
    if exists (
      select 1 from unnest(coalesce(p_user_ids, '{}')) u
       where not public.scheduled_report_may_read(p_kind, v_org, u)
    ) then
      raise exception 'SCH_RECIPIENT_FORBIDDEN: every recipient must be an active member of your organisation who can read this report' using errcode = '42501';
    end if;
    if exists (
      select 1 from unnest(coalesce(p_roles, '{}')) x
       where btrim(x) <> ''
         and btrim(x) not in ('Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer')
    ) then
      raise exception 'SCH_RECIPIENT_FORBIDDEN: every recipient role must be a non-field role that can read this report' using errcode = '42501';
    end if;
  end if;
  -- recipients: people of this organisation only; roles trimmed and de-duplicated
  select coalesce(array_agg(distinct pr.id), '{}') into v_users from public.profiles pr
    where pr.org_id = v_org and pr.id = any (coalesce(p_user_ids, '{}'));
  select coalesce(array_agg(distinct btrim(x)), '{}') into v_roles from unnest(coalesce(p_roles, '{}')) x where btrim(x) <> '';
  if cardinality(v_users) + cardinality(v_roles) not between 1 and 50 then
    raise exception 'between 1 and 50 recipients are required' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.scheduled_reports (org_id, name, kind, frequency, weekday, send_time, recipient_user_ids, recipient_roles, enabled, created_by, managed_by)
      values (v_org, btrim(p_name), p_kind, p_frequency, p_weekday, p_send_time, v_users, v_roles, p_enabled, auth.uid(),
              case when v_is_admin then 'admin' else 'project_control_manager' end)
      returning id into v_id;
  else
    -- PCM manages only schedules created by the project_control_manager role; Admin-created schedules remain read-only to PCM.
    if not v_is_admin and public.scheduled_report_pcm_may_change(p_id, v_org) is not true then
      raise exception 'admin only' using errcode = '42501';
    end if;
    update public.scheduled_reports set name = btrim(p_name), kind = p_kind, frequency = p_frequency, weekday = p_weekday,
           send_time = p_send_time, recipient_user_ids = v_users, recipient_roles = v_roles, enabled = p_enabled, updated_at = now()
     where id = p_id and org_id = v_org and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.save_scheduled_report(uuid, text, text, text, integer, time, uuid[], text[], boolean) from public, anon;
grant execute on function public.save_scheduled_report(uuid, text, text, text, integer, time, uuid[], text[], boolean) to authenticated;

create or replace function public.set_scheduled_report_enabled(p_id uuid, p_enabled boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_is_admin boolean;
  v_is_pcm boolean;
  v_kind text;
  v_users uuid[];
  v_roles text[];
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := public.auth_role() = 'Admin';
  v_is_pcm := public.actor_holds_job_role('project_control_manager')
    and coalesce((select o.pcm_scheduled_reports_enabled from public.organizations o where o.id = v_org), false);
  if not (v_is_admin or v_is_pcm) then raise exception 'admin only' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'invalid setting' using errcode = '22023'; end if;
  -- PCM manages only schedules created by the project_control_manager role; Admin-created schedules remain read-only to PCM.
  if not v_is_admin and public.scheduled_report_pcm_may_change(p_id, v_org) is not true then
    raise exception 'admin only' using errcode = '42501';
  end if;
  -- Switching a schedule on sends it: the recipients saved earlier must each still be allowed to read the report.
  if not v_is_admin and p_enabled then
    select sr.kind, sr.recipient_user_ids, sr.recipient_roles
      into v_kind, v_users, v_roles
      from public.scheduled_reports sr
     where sr.id = p_id and sr.org_id = v_org and sr.archived_at is null;
    if v_kind is not null then
      if exists (
        select 1 from unnest(coalesce(v_users, '{}')) u
         where not public.scheduled_report_may_read(v_kind, v_org, u)
      ) or exists (
        select 1 from unnest(coalesce(v_roles, '{}')) x
         where btrim(x) <> ''
           and btrim(x) not in ('Admin', 'Project Manager', 'Finance', 'Executive', 'Engineer')
      ) then
        raise exception 'SCH_RECIPIENT_FORBIDDEN: every recipient must be an active member of your organisation who can read this report' using errcode = '42501';
      end if;
    end if;
  end if;
  update public.scheduled_reports set enabled = p_enabled, updated_at = now()
   where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_scheduled_report_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_scheduled_report_enabled(uuid, boolean) to authenticated;

create or replace function public.archive_scheduled_report(p_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_is_admin boolean;
  v_is_pcm boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := public.auth_role() = 'Admin';
  v_is_pcm := public.actor_holds_job_role('project_control_manager')
    and coalesce((select o.pcm_scheduled_reports_enabled from public.organizations o where o.id = v_org), false);
  if not (v_is_admin or v_is_pcm) then raise exception 'admin only' using errcode = '42501'; end if;
  -- PCM manages only schedules created by the project_control_manager role; Admin-created schedules remain read-only to PCM.
  if not v_is_admin and public.scheduled_report_pcm_may_change(p_id, v_org) is not true then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.scheduled_reports set archived_at = now(), enabled = false, updated_at = now()
   where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.archive_scheduled_report(uuid) from public, anon;
grant execute on function public.archive_scheduled_report(uuid) to authenticated;

-- ── engineer: capture and edit a Draft work order (issuing stays with transition_work_order) ──────────────────────────────────

-- ── engineer reads the rate catalogue (rates and stage weights follow their items; the price-visibility gate still applies) ───

-- ── engineer sets a work order's area, group and check-in point ────────────────────────────────────────────────────────────────
create or replace function public.set_work_order_area_group(p_work_order uuid, p_area uuid DEFAULT NULL::uuid, p_group uuid DEFAULT NULL::uuid, p_set_area boolean DEFAULT true, p_set_group boolean DEFAULT true)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  perform public.assert_not_light();
  if public.auth_org_id() is null or not public.is_active_member()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'only an Admin, Executive, Project Manager or Finance member can set a work order''s area or group' using errcode = '42501';
  end if;
  update public.work_orders w
     set area_id  = case when p_set_area  then p_area  else w.area_id  end,
         group_id = case when p_set_group then p_group else w.group_id end
   where w.id = p_work_order and w.org_id = public.auth_org_id();
  if not found then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.set_work_order_check_in_area(
  p_work_order uuid, p_lat double precision, p_lng double precision, p_radius_m double precision) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  if v_org is null or public.auth_role() not in ('Admin', 'Executive', 'Project Manager', 'Finance') then      -- mut:area_role
    raise exception 'only an Admin, Executive, Project Manager or Finance member can set a work order''s check-in area' using errcode = '42501';
  end if;
  if not ((p_lat is null and p_lng is null and p_radius_m is null)
          or coalesce(p_lat between -90 and 90 and p_lng between -180 and 180 and p_radius_m > 0 and p_radius_m <= 50000, false)) then
    raise exception 'WO_AREA: give latitude -90 to 90, longitude -180 to 180 and a radius above 0 up to 50000 metres, or all three empty'
      using errcode = '22023';
  end if;
  update public.work_orders w
     set area_lat = p_lat, area_lng = p_lng, area_radius_m = p_radius_m
   where w.id = p_work_order and w.org_id = v_org;                                                               -- mut:area_org
  if not found then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  perform public.log_audit('work_order.check_in_area_set', v_org, auth.uid(), p_work_order,
            jsonb_build_object('lat', p_lat, 'lng', p_lng, 'radius_m', p_radius_m));
end $$;

-- ── engineer writes the work order plan (cost against revenue): the setter, then the plan table it writes as the caller ────────
create or replace function public.set_work_order_plan(p_project_id uuid, p_work_order_id uuid, p_changes jsonb)
 returns integer language plpgsql set search_path to 'public', 'pg_temp' as $$
declare
  v_change jsonb;
  v_kind text;
  v_value text;
  v_note text;
  v_section uuid;
  v_id uuid;
  v_count integer := 0;
begin
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.project_id = p_project_id
                  and w.org_id = public.auth_org_id()) then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 200 then
    raise exception 'invalid plan changes' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_changes) x
              where jsonb_typeof(x) <> 'object' or not x ? 'value'
                 or x->>'kind' is null or x->>'kind' not in ('direct_budget', 'indirect_budget', 'equipment_hours', 'crew_hours')
                 or (x ? 'note' and jsonb_typeof(x->'note') not in ('string', 'null'))
                 or (x ? 'section_id' and jsonb_typeof(x->'section_id') not in ('string', 'null'))
                 or jsonb_typeof(x->'value') not in ('string', 'null'))
     or (select count(*) <> count(distinct (x->>'kind', x->>'section_id')) from jsonb_array_elements(p_changes) x) then
    raise exception 'invalid plan changes' using errcode = '22023';
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_kind := v_change->>'kind';
    v_value := v_change->>'value';
    v_note := v_change->>'note';
    v_section := nullif(v_change->>'section_id', '')::uuid;
    if v_value is not null and v_value !~ '^\d{1,15}(\.\d{1,2})?$' then
      raise exception 'invalid plan figure' using errcode = '23514';
    end if;
    select l.id into v_id from public.work_order_plan_lines l
     where l.org_id = public.auth_org_id() and l.project_id = p_project_id and l.work_order_id = p_work_order_id
       and l.discipline_id is null and l.kind = v_kind and l.section_id is not distinct from v_section for update;
    if v_value is null then
      if v_id is not null then
        delete from public.work_order_plan_lines where id = v_id;
        v_count := v_count + 1;
      end if;
    elsif v_id is null then
      insert into public.work_order_plan_lines (project_id, work_order_id, section_id, discipline_id, kind, value, note)
        values (p_project_id, p_work_order_id, v_section, null, v_kind, v_value::numeric, v_note);
      v_count := v_count + 1;
    else
      update public.work_order_plan_lines set value = v_value::numeric, note = v_note where id = v_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;


-- ── engineer reads progress claims and billing steps (read only: no write policy, and the run right stays out) ─────────────────
delete from public.built_in_role_capabilities where role_key = 'engineer' and capability = 'billing_steps_view';

alter policy progress_claims_engineer_read_scope on public.progress_claims
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or (select public.actor_holds_job_role('quantity_surveyor')));
alter policy progress_claim_lines_engineer_read_scope on public.progress_claim_lines
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or (select public.actor_holds_job_role('quantity_surveyor')));
alter policy progress_claim_evidence_engineer_read_scope on public.progress_claim_evidence
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or (select public.actor_holds_job_role('quantity_surveyor')));
alter policy claim_billing_stages_engineer_read_scope on public.claim_billing_stages
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or (select public.actor_holds_job_role('quantity_surveyor')));
alter policy claim_billing_stage_documents_engineer_read_scope on public.claim_billing_stage_documents
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or (select public.actor_holds_job_role('quantity_surveyor')));

-- ── planner: links tasks to a work order and writes task dependencies ──────────────────────────────────────────────────────────
-- Insert guard: a planner may name a work order on a new task; proof_required stays with managers.
create or replace function public.check_task_work_order() returns trigger
  language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_org uuid; v_project uuid; v_status public.work_order_status;
begin
  -- Structure columns on INSERT: an Engineer/Finance creator (0204) may not set either. No auth.uid() = server authority.
  if tg_op = 'INSERT' and auth.uid() is not null
     and (new.work_order_id is not null or new.proof_required)
     and auth_role() not in ('Admin','Executive','Project Manager') then
    raise exception 'only a manager may link a task to a work order or require proof' using errcode = '42501';
  end if;

  if new.work_order_id is null then
    return new;
  end if;

  -- Moving a linked task to another project: name the way out (FR-TWOP-004).
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id
     and new.work_order_id is not distinct from old.work_order_id then
    raise exception 'task is linked to a work order of its current project; clear the work order before moving it'
      using errcode = '23514';
  end if;

  if new.project_id is null then
    raise exception 'a task without a project cannot name a work order' using errcode = '23514';
  end if;

  select w.org_id, w.project_id, w.status into v_org, v_project, v_status
    from public.work_orders w where w.id = new.work_order_id;
  if v_org is distinct from new.org_id or v_project is distinct from new.project_id then
    raise exception 'work order must belong to the task''s own project' using errcode = '23514';
  end if;
  if v_status = 'Cancelled'
     and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
    raise exception 'a cancelled work order takes no new tasks' using errcode = '23514';
  end if;
  return new;
end $$;

-- Update: the planner may change a task's work-order link and nothing else on a task they neither created nor are assigned to.

create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
declare
  k_external_allowed constant text[] :=
    array['milestone_id','completed_at','tombstoned_at','source_updated_at'];
  k_assignee_allowed constant text[] := array['status','completed_at'];
  k_creator_allowed constant text[] :=
    array['name','description','priority','status','assignee_id','milestone_id','parent_task_id',
          'project_id','start_date','end_date','completed_at','last_update','meeting_id',
          'procurement_id','expense_claim_id','material_request_id'];
  k_close_allowed constant text[] :=
    array['status','completed_at','closed_by_record_type','closed_by_record_status','closed_by_record_at'];
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.task_domain_externally_owned(new.project_id) then
    return new;
  end if;

  if public.task_domain_externally_owned(new.project_id) then
    if to_jsonb(new) - k_external_allowed is distinct from to_jsonb(old) - k_external_allowed then
      -- Message byte-preserved from 0093/0140/0146/0199 — asserted verbatim elsewhere.
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- FR-RLT-014: a linked task may move to Done while its record is in an end state (status + close columns only).
  if new.status = 'Done' and old.status is distinct from 'Done'
     and num_nonnulls(new.procurement_id, new.expense_claim_id, new.material_request_id) = 1
     and (new.procurement_id, new.expense_claim_id, new.material_request_id)
         is not distinct from (old.procurement_id, old.expense_claim_id, old.material_request_id)
     and to_jsonb(new) - k_close_allowed is not distinct from to_jsonb(old) - k_close_allowed
     and public.task_link_record_ended(new.procurement_id, new.expense_claim_id, new.material_request_id) then
    return new;
  end if;

  if auth_role() in ('Admin','Executive','Project Manager') then
    return new;
  end if;

  if old.created_by is not null and old.created_by = (select auth.uid()) then
    if to_jsonb(new) - k_creator_allowed is distinct from to_jsonb(old) - k_creator_allowed then
      raise exception 'creator may edit task fields, not lifecycle or provenance columns'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if to_jsonb(new) - k_assignee_allowed is distinct from to_jsonb(old) - k_assignee_allowed then
    -- Message byte-preserved from 0016 onward — first_class_tasks.test.sql matches it verbatim.
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;
