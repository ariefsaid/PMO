-- 1631_absence_reports.sql — a field worker says "I am not coming in today" from the phone home (walk finding).
-- One report per person per organisation-local day (sick or other, optional note). It reaches the field controller(s) of the
-- crew the person is in today and, while leave requests are on, the person's line manager and the leave approver role (Admin
-- while the setting is empty). The roster shows the person as "reported absent" instead of "no record".
-- The report is a statement, not attendance: it writes no attendance row and decides no leave. The roster keeper still
-- records the day; an office user decides any leave through the leave flow, exactly as before.
-- Proven by supabase/tests/1631_absence_reports.test.sql. Reverse: rollback/1631_absence_reports_down.sql
create table public.absence_reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  person_id   uuid not null references public.people(id),
  work_date   date not null,
  reason      text not null check (reason in ('sick', 'other')),
  note        text check (note is null or char_length(note) <= 300),
  reported_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  constraint absence_reports_one_per_day unique (person_id, work_date)
);
create index absence_reports_day_idx on public.absence_reports (org_id, work_date);
create trigger absence_reports_stamp_org_id before insert on public.absence_reports
  for each row execute function public.stamp_org_id();

-- Read: the person's own report, an office manager, and the field controller of a crew (the roster reads it).
alter table public.absence_reports enable row level security;
alter table public.absence_reports force row level security;
create policy absence_reports_select on public.absence_reports for select using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (reported_by = (select auth.uid())
       or (select public.crew_can_manage())
       or exists (select 1 from public.crews c where c.org_id = absence_reports.org_id and c.field_controller_id = (select auth.uid()))));
revoke all on public.absence_reports from public, anon, authenticated;
grant select on public.absence_reports to authenticated;
grant all on public.absence_reports to service_role;

-- The only writer. A person reports THEMSELVES only (people.profile_id = the caller); there is no argument for who.
-- Deliberately no assert_not_light: this is a field path a light account uses (it writes only the caller's own row).
create function public.report_absence(p_reason text, p_note text default null) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_person uuid;
  v_name text;
  v_today date;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_who uuid;
  v_mgr uuid;
  v_role text;
  v_leave boolean;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('sick', 'other') then
    raise exception 'ABS_REASON: choose sick or other' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'ABS_NOTE: the note is too long' using errcode = '22023';
  end if;
  select w.id, w.name into v_person, v_name from public.people w
   where w.profile_id = v_uid and w.org_id = v_org and w.archived_at is null limit 1;
  if v_person is null then
    raise exception 'ABS_PERSON: this account is not linked to a person on a crew' using errcode = '23514';
  end if;
  v_today := public.equipment_org_today(v_org);
  insert into public.absence_reports (person_id, work_date, reason, note, reported_by)
    values (v_person, v_today, p_reason, v_note, v_uid)
    on conflict (person_id, work_date) do update set reason = excluded.reason, note = excluded.note, created_at = now()
    returning id into v_id;

  -- Tell the roster keeper: the field controller of the crew the person is in today and, while leave requests are on,
  -- the line manager and the leave approver role. There is ONE report per person per day, so each person is told once
  -- for it: re-stating the same day updates that report and its wording on the roster, and must not stack a second
  -- notification (a person in two of these groups is still told once).
  select coalesce(o.leave_requests_enabled, false), coalesce(o.leave_approver_role, 'Admin') into v_leave, v_role
    from public.organizations o where o.id = v_org;
  if v_leave then
    select p.manager_id into v_mgr from public.profiles p where p.id = v_uid;
  end if;
  for v_who in
    select distinct x.id from (
      select c.field_controller_id as id
        from public.crews c
       where c.id = public.worker_effective_crew(v_person, v_today)
      union all
      select v_mgr as id where v_leave
      union all
      select p.id from public.profiles p
       where v_leave and p.org_id = v_org and p.role::text = v_role and p.status = 'active'
    ) x where x.id is not null
  loop
    if not exists (select 1 from public.notifications n
                    where n.owner_id = v_who and n.org_id = v_org
                      and n.metadata -> 'entity' ->> 'type' = 'absence_report'
                      and n.metadata -> 'entity' ->> 'id' = v_id::text) then
      perform public.notify_workflow_user(v_org, v_who, 'A crew member reports absent today',
        v_name || ' reports not coming in today (' || p_reason || ').', 'info', 'absence_report', v_id, 'Absence');
    end if;
  end loop;
  perform public.log_audit('absence.report', v_org, v_uid, v_id, jsonb_build_object('work_date', v_today, 'reason', p_reason));
  return v_id;
end $$;
revoke all on function public.report_absence(text, text) from public, anon;
grant execute on function public.report_absence(text, text) to authenticated;

-- The roster shows a reported absence. Copy of the 1247 definition (the newest); a member gains `reported_absent`
-- ({reason, note}) when the person reported for this date; with no reports the output is identical to 1247.
create or replace function public.work_order_roster(p_work_order_id uuid, p_date date)
  returns table (crew_id uuid, crew_code text, crew_name text, field_controller_id uuid,
                 members jsonb, roles jsonb, shortfall integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with rostered as (
    select c.id, c.code, c.name, c.field_controller_id
      from public.work_order_crews r join public.crews c on c.id = r.crew_id
     where r.work_order_id = p_work_order_id
       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
  ), placed as (
    select x.crew_id, x.worker_id, w.name as display_name, x.standard_role_id, x.on_loan
      from (
        select m.crew_id, m.worker_id, m.standard_role_id, false as on_loan
          from public.crew_members m
         where m.crew_id in (select id from rostered)
           and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
           and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                            where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                              and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
        union all
        select l.host_crew_id, l.worker_id, null::uuid, true
          from public.crew_loans l
         where l.host_crew_id in (select id from rostered)
           and p_date between l.valid_from and l.valid_to
      ) x
      join public.people_directory w on w.id = x.worker_id
     where public.worker_effective_crew(x.worker_id, p_date) = x.crew_id
  ), role_counts as (
    select s.crew_id, s.id, s.name, s.headcount, s.sort_order,
           (select count(*)::int from placed p where p.crew_id = s.crew_id and p.standard_role_id = s.id) as placed
      from public.crew_standard_roles s where s.crew_id in (select id from rostered)
  )
  select r.id, r.code, r.name, r.field_controller_id,
         coalesce((select jsonb_agg(jsonb_build_object('worker_id', p.worker_id, 'display_name', p.display_name,
                                                       'standard_role_id', p.standard_role_id,
                                                       'off_rotation', exists (
                                                         select 1 from public.crew_worker_rotation_off o
                                                          where o.worker_id = p.worker_id and p_date between o.off_from and o.off_to))
                                    || case when p.on_loan then jsonb_build_object('on_loan', true) else '{}'::jsonb end
                                    || coalesce((select jsonb_build_object('reported_absent', jsonb_build_object('reason', a.reason, 'note', a.note))
                                                   from public.absence_reports a
                                                  where a.person_id = p.worker_id and a.work_date = p_date), '{}'::jsonb)
                                    order by p.display_name, p.worker_id)
                     from placed p where p.crew_id = r.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('standard_role_id', rc.id, 'name', rc.name,
                                                       'headcount', rc.headcount, 'placed', rc.placed,
                                                       'shortfall', greatest(rc.headcount - rc.placed, 0))
                                    order by rc.sort_order, rc.name)
                     from role_counts rc where rc.crew_id = r.id), '[]'::jsonb),
         coalesce((select sum(greatest(rc.headcount - rc.placed, 0))::int from role_counts rc where rc.crew_id = r.id), 0)
    from rostered r
   order by r.code, r.id
$$;
