-- 1700_attendance_second_record.sql — docs/specs/pay-time.spec.md (FR-PAY-001, -002, -004, -005).
-- A second record of a worker's day (a surveyor's or timekeeper's), kept in its own table so the attendance day stays the ONE
-- figure every cost and timesheet reader sees. Two organisation settings name who may enter it and who decides a disagreement.
-- Writes only through the security-definer RPCs of 1701. Reverse: rollback/1700_attendance_second_record_down.sql (reverse 1702, 1701 first).

alter table public.organizations
  add column attendance_second_record_roles text[] not null default array['quantity_surveyor']::text[]
    check (cardinality(attendance_second_record_roles) <= 28),
  add column attendance_decider_roles text[] not null default '{}'::text[]
    check (cardinality(attendance_decider_roles) <= 28);

create table public.attendance_second_records (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                     references public.organizations(id) on delete cascade,
  worker_id        uuid not null references public.people(id),
  work_order_id    uuid not null references public.work_orders(id),
  work_date        date not null,
  status           text not null check (status in ('present', 'absent')),
  hours            numeric(5,2) check (hours between 0 and 24),
  overtime_hours   numeric(5,2) check (overtime_hours between 0 and 24),
  note             text check (note is null or char_length(btrim(note)) between 1 and 500),
  -- Everyone who entered this record (the separation oracle, like attendance_days.recorded_by_ids).
  recorded_by_ids  uuid[] not null default '{}',
  recorded_at      timestamptz not null default now(),
  -- The decision. `standing` says which figure the attendance day carries: 'day' (the site report's tick) or 'second'.
  standing         text check (standing in ('day', 'second')),
  decided_by       uuid references public.profiles(id),
  decided_at       timestamptz,
  decision_reason  text check (decision_reason is null or char_length(btrim(decision_reason)) between 1 and 500),
  constraint attendance_second_records_one_per_day unique (worker_id, work_order_id, work_date),
  constraint attendance_second_records_hours_when_present check (
    (status = 'present' and hours is not null) or (status = 'absent' and hours is null and overtime_hours is null)),
  constraint attendance_second_records_decision_whole check (
    (decided_at is null and decided_by is null and standing is null and decision_reason is null)
    or (decided_at is not null and decided_by is not null and standing is not null and decision_reason is not null))
);
create index attendance_second_records_wo_date_idx on public.attendance_second_records (work_order_id, work_date);
create trigger attendance_second_records_stamp_org_id before insert on public.attendance_second_records
  for each row execute function public.stamp_org_id();

-- Who may enter a second record: a crew manager level, or a built-in role the organisation named.
create function public.attendance_second_record_may_enter() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_member()
     and (public.crew_can_manage()
          or coalesce((select public.actor_built_in_role() = any (o.attendance_second_record_roles)
                         from public.organizations o where o.id = public.auth_org_id()), false))
$$;
-- Who decides a disagreement: the roles the organisation named; when none is named, today's approvers.
create function public.attendance_second_record_may_decide() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_member()
     and (select case when cardinality(o.attendance_decider_roles) = 0 then public.crew_can_manage()
                      else coalesce(public.actor_built_in_role() = any (o.attendance_decider_roles), false) end
            from public.organizations o where o.id = public.auth_org_id())
$$;
revoke all on function public.attendance_second_record_may_enter() from public, anon;
revoke all on function public.attendance_second_record_may_decide() from public, anon;
grant execute on function public.attendance_second_record_may_enter() to authenticated;
grant execute on function public.attendance_second_record_may_decide() to authenticated;

alter table public.attendance_second_records enable row level security;
alter table public.attendance_second_records force row level security;
create policy attendance_second_records_select on public.attendance_second_records for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or (select public.attendance_second_record_may_enter())
              or (select public.attendance_second_record_may_decide())));
create policy light_account_deny_select on public.attendance_second_records as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
revoke all on public.attendance_second_records from public, anon, authenticated;
grant select on public.attendance_second_records to authenticated;
grant all on public.attendance_second_records to service_role;

-- Administration › People: an Admin names the roles. Keys are checked against the built-in set.
create function public.set_attendance_time_roles(p_second_record_roles text[], p_decider_roles text[])
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_second_record_roles is null or p_decider_roles is null
     or exists (select 1 from unnest(p_second_record_roles || p_decider_roles) k
                 where not exists (select 1 from public.built_in_roles b where b.key = k)) then
    raise exception 'ATT_ROLE_UNKNOWN: choose roles from the built-in list' using errcode = '22023';
  end if;
  update public.organizations o
     set attendance_second_record_roles = (select coalesce(array_agg(distinct k order by k), '{}') from unnest(p_second_record_roles) k),
         attendance_decider_roles       = (select coalesce(array_agg(distinct k order by k), '{}') from unnest(p_decider_roles) k)
   where o.id = public.auth_org_id();
  perform public.log_audit('attendance.time_roles', public.auth_org_id(), auth.uid(), public.auth_org_id(),
            jsonb_build_object('second_record_roles', p_second_record_roles, 'decider_roles', p_decider_roles));
end $$;
revoke all on function public.set_attendance_time_roles(text[], text[]) from public, anon;
grant execute on function public.set_attendance_time_roles(text[], text[]) to authenticated;
