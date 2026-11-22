-- 1211 (#2705): the phone check-in record: the position read at the tap, its distance from the work-order area, the outcome and,
-- for an off-area or off-roster check-in, the supervisor's decision. Written only by phone_check_in / phone_check_in_decide (1212, 1213).
-- Rollback: supabase/migrations/rollback/1211_phone_clock_in_table_down.sql
-- Location privacy: readable only by the person, the crew's controller / the check-in supervisor, and Admin. No client write grant.
-- Latitude and longitude are stored rounded to 5 decimals (about 1 m); the distance test uses the unrounded input (1212).
create table public.phone_check_ins (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                      references public.organizations(id) on delete cascade,
  work_order_id     uuid not null references public.work_orders(id),
  worker_id         uuid not null references public.people(id),
  requester_id      uuid not null references public.profiles(id),
  crew_id           uuid references public.crews(id),
  work_date         date not null,
  hours             numeric(5,2) not null check (hours between 0 and 24),
  lat               double precision check (lat is null or lat between -90 and 90),
  lng               double precision check (lng is null or lng between -180 and 180),
  accuracy_m        double precision check (accuracy_m is null or accuracy_m > 0),
  distance_m        numeric(12,1),
  checked_in_at     timestamptz not null default now(),
  outcome           text not null check (outcome in ('inside', 'outside', 'not_rostered', 'no_position')),
  status            text not null check (status in ('recorded', 'pending', 'approving', 'approved', 'rejected')),
  decided_by        uuid references public.profiles(id),
  decided_at        timestamptz,
  decision_reason   text check (decision_reason is null or char_length(btrim(decision_reason)) between 1 and 500),
  attendance_day_id uuid references public.attendance_days(id),
  constraint phone_check_ins_position_pair check ((lat is null) = (lng is null)),
  constraint phone_check_ins_decided_has_actor check (status in ('recorded', 'pending') or decided_by is not null)
);
create unique index phone_check_ins_one_pending on public.phone_check_ins (worker_id, work_order_id, work_date) where status in ('pending', 'approving');
create index phone_check_ins_wo_date_idx on public.phone_check_ins (work_order_id, work_date);
create index phone_check_ins_pending_idx on public.phone_check_ins (org_id, status) where status = 'pending';
create trigger phone_check_ins_stamp_org_id before insert on public.phone_check_ins
  for each row execute function public.stamp_org_id();

-- True when the signed-in, active person may act as the check-in supervisor in their organisation: the configured built-in role's
-- holder or, while no role is configured, anyone who may manage crews. (Per-request eligibility, incl. the crew controller, is 1213.)
create function public.phone_check_in_is_supervisor() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.is_active_member() and (
    case when (select o.phone_check_in_supervisor_role from public.organizations o where o.id = public.auth_org_id()) is null
         then public.crew_can_manage()
         else exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.status = 'active'
                         and p.built_in_role = (select o.phone_check_in_supervisor_role from public.organizations o where o.id = public.auth_org_id()))
    end)
$$;
revoke all on function public.phone_check_in_is_supervisor() from public, anon;
grant execute on function public.phone_check_in_is_supervisor() to authenticated;

alter table public.phone_check_ins enable row level security;
alter table public.phone_check_ins force row level security;
revoke all on public.phone_check_ins from anon, authenticated;
grant select on public.phone_check_ins to authenticated;
create policy phone_check_ins_select on public.phone_check_ins for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (requester_id = (select auth.uid())
              or (select public.auth_role()) = 'Admin'
              or crew_id in (select c.id from public.crews c where c.field_controller_id = (select auth.uid()))
              or (select public.phone_check_in_is_supervisor())));
