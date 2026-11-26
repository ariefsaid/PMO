-- 2730_org_day_in_crew_and_tpi_guards.sql — #2914: four places that filed "today" under the UTC day now use the
-- organisation's day (the same value native_org_today gives): the crew archive guard, the section roll-up's crews today,
-- the inspection overdue sweep (per inspection's organisation). Each restated from its latest definition; only the day changed.
-- ── REVERSE: rollback/2730_org_day_in_crew_and_tpi_guards_down.sql

-- drops: the UTC-day comparisons (current_date) on member and placement end dates; replaced by the organisation's day
create or replace function public.guard_crew_refs() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  case tg_table_name
    when 'crews' then
      if new.field_controller_id is not null and not exists (
           select 1 from public.profiles p where p.id = new.field_controller_id and p.org_id = new.org_id) then
        raise exception 'CRW_REF: the field controller is not in this organisation' using errcode = '23514';
      end if;
      if new.discipline_id is not null and (tg_op = 'INSERT' or new.discipline_id is distinct from old.discipline_id)
         and not exists (select 1 from public.cost_disciplines d
                          where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
        raise exception 'CRW_REF: the discipline is not on this organisation''s list' using errcode = '23514';
      end if;
      if new.vendor_company_id is not null and not exists (
           select 1 from public.companies c where c.id = new.vendor_company_id and c.org_id = new.org_id) then
        raise exception 'CRW_REF: the vendor company is not in this organisation' using errcode = '23514';
      end if;
      -- FR-CRW-002 + FR-CTR-005: archive only a crew with no open or future membership or roster placement and no live tool line.
      if new.archived_at is not null and old.archived_at is null and (
           exists (select 1 from public.crew_members m
                    where m.crew_id = new.id and coalesce(m.valid_to, 'infinity'::date) >= public.native_org_today(new.org_id))
           or exists (select 1 from public.work_order_crews r
                    where r.crew_id = new.id and coalesce(r.valid_to, 'infinity'::date) >= public.native_org_today(new.org_id))
           or exists (select 1 from public.crew_tool_lines t
                    where t.crew_id = new.id and t.archived_at is null)) then
        raise exception 'CRW_ARCHIVE_IN_USE: end this crew''s current and future members and roster placements first'
          using errcode = '23514';
      end if;
    when 'crew_standard_roles' then
      if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id) then
        raise exception 'CRW_REF: the crew is not in this organisation' using errcode = '23514';
      end if;
    when 'people' then
      if new.vendor_company_id is not null and not exists (
           select 1 from public.companies c where c.id = new.vendor_company_id and c.org_id = new.org_id) then
        raise exception 'CRW_REF: the vendor company is not in this organisation' using errcode = '23514';
      end if;
    when 'crew_members' then
      if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id
                        and (c.archived_at is null or tg_op = 'UPDATE')) then
        raise exception 'CRW_REF: the crew is not a live crew of this organisation' using errcode = '23514';
      end if;
      if not exists (select 1 from public.people w where w.id = new.worker_id and w.org_id = new.org_id) then
        raise exception 'CRW_REF: the person is not in this organisation' using errcode = '23514';
      end if;
      if new.standard_role_id is not null and not exists (
           select 1 from public.crew_standard_roles s where s.id = new.standard_role_id and s.crew_id = new.crew_id) then
        raise exception 'CRW_REF: the role is not one of this crew''s standard roles' using errcode = '23514';
      end if;
    when 'work_order_crews' then
      if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id
                        and (c.archived_at is null or tg_op = 'UPDATE')) then
        raise exception 'CRW_REF: the crew is not a live crew of this organisation' using errcode = '23514';
      end if;
      if not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.org_id = new.org_id
                        and (w.status <> 'Cancelled' or tg_op = 'UPDATE')) then
        raise exception 'CRW_REF: the work order is not a live work order of this organisation' using errcode = '23514';
      end if;
  end case;
  if tg_op = 'UPDATE' and tg_table_name in ('crew_members', 'work_order_crews') then
    -- FR-CRW-005: a correction bumps the version (the client sends the version it read) and is audited.
    new.version := old.version + 1;
    perform public.log_audit(tg_table_name || '.correct', new.org_id, auth.uid(), new.id,
              jsonb_build_object('before', to_jsonb(old) - 'org_id', 'after', to_jsonb(new) - 'org_id'));
  end if;
  return new;
end $$;
revoke all on function public.guard_crew_refs() from public, anon, authenticated;

-- drops: the UTC-day comparison (current_date) on a crew placement; replaced by the organisation's day
create or replace function public.work_order_section_rollup(p_work_order_id uuid)
  returns table (
    section_id uuid, code text, name text, location_note text, foreman_id uuid, readiness text, readiness_note text,
    sort_order integer, archived_at timestamptz,
    direct_budget numeric, indirect_budget numeric, equipment_hours numeric, crew_hours numeric,
    tasks_total integer, tasks_done integer, crews_today integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (
    select x.id, x.code, x.name, x.location_note, x.foreman_id, x.readiness, x.readiness_note, x.sort_order, x.archived_at
      from public.work_order_sections x where x.work_order_id = p_work_order_id
  ),
  keys as (
    select s.id as sid, s.code, s.name, s.location_note, s.foreman_id, s.readiness, s.readiness_note, s.sort_order, s.archived_at from s
    union all
    select null::uuid, null, null, null, null::uuid, null, null, null::integer, null::timestamptz where exists (select 1 from s)
  ),
  plan as (
    select l.section_id as sid, l.kind, sum(l.value) as v
      from public.work_order_plan_lines l where l.work_order_id = p_work_order_id group by l.section_id, l.kind
  ),
  tk as (
    select t.section_id as sid, count(*)::integer as total, (count(*) filter (where t.status = 'Done'))::integer as done
      from public.tasks t where t.work_order_id = p_work_order_id group by t.section_id
  ),
  cr as (
    select c.section_id as sid, count(*)::integer as n
      from public.work_order_crews c
     where c.work_order_id = p_work_order_id and (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC'))::date between c.valid_from and coalesce(c.valid_to, 'infinity'::date)
     group by c.section_id
  )
  select k.sid, k.code, k.name, k.location_note, k.foreman_id, k.readiness, k.readiness_note, k.sort_order, k.archived_at,
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'direct_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'indirect_budget'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'equipment_hours'),
         (select p.v from plan p where p.sid is not distinct from k.sid and p.kind = 'crew_hours'),
         coalesce((select t.total from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select t.done from tk t where t.sid is not distinct from k.sid), 0),
         coalesce((select c.n from cr c where c.sid is not distinct from k.sid), 0)
    from keys k
   order by (k.sid is null), k.sort_order, k.code
$$;

-- drops: the UTC-day variable v_today and its comparison; replaced by the organisation's day
create or replace function public.run_tpi_overdue_sweep(p_as_of date default null) returns int
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    select i.id, i.org_id, i.title, i.created_by, p.project_manager_id
      from public.third_party_inspections i join public.projects p on p.id = i.project_id
     where i.status not in ('reported','cancelled') and i.planned_date < coalesce(p_as_of, public.native_org_today(i.org_id)) and i.overdue_notified_at is null
     for update of i skip locked
  loop
    perform public.notify_workflow_user(r.org_id, r.created_by, 'Inspection overdue', r.title, 'warning', 'third_party_inspection', r.id, r.title);
    if r.project_manager_id is distinct from r.created_by then
      perform public.notify_workflow_user(r.org_id, r.project_manager_id, 'Inspection overdue', r.title, 'warning', 'third_party_inspection', r.id, r.title);
    end if;
    update public.third_party_inspections set overdue_notified_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
