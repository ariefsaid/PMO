-- 1240_leave_requests.sql — #2708 (map #2516, OD-SCOPE-12): leave and sick requests, approved by the line manager.
-- Spec: docs/specs/leave-requests.spec.md. Plan: docs/plans/2026-11-21-leave-requests.md. Proven by
-- supabase/tests/leave_requests.test.sql. Every write goes through the RPCs in 1241; clients only read.
-- The whole feature is OFF until organizations.leave_requests_enabled is true (default false: nothing changes).
--
-- ── REVERSE (also supabase/migrations/rollback/1240_leave_requests_down.sql) ──────────────────────────────
--   reverse 1242, 1241 first; drop tables leave_requests, leave_types, function guard_leave_refs; drop the two
--   organizations columns.

-- ── §1 organisation settings ─────────────────────────────────────────────────────────────────────────────────
-- leave_approver_role is a role KEY (text), not an enum: a built-in role key can be allowed later without a type change.
alter table public.organizations
  add column leave_requests_enabled boolean not null default false,
  add column leave_approver_role text check (leave_approver_role is null or char_length(btrim(leave_approver_role)) between 1 and 60);

-- ── §2 leave types: the organisation's own list; PMO ships none ───────────────────────────────────────────────
create table public.leave_types (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create unique index leave_types_name_live on public.leave_types (org_id, lower(btrim(name))) where archived_at is null;
create trigger leave_types_stamp_org_id before insert on public.leave_types
  for each row execute function public.stamp_org_id();

-- ── §3 requests ──────────────────────────────────────────────────────────────────────────────────────────────
create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  person_id     uuid not null references public.people(id),
  leave_type_id uuid not null references public.leave_types(id),
  start_date    date not null,
  end_date      date not null,
  reason        text check (reason is null or char_length(reason) <= 500),
  status        text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  entered_by    uuid not null references public.profiles(id),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  constraint leave_requests_range check (end_date >= start_date and end_date - start_date < 366),
  -- AC-LV-003: a person has at most one live (Pending or Approved) request on any day.
  constraint leave_requests_no_overlap exclude using gist (
    person_id with =, daterange(start_date, end_date, '[]') with &&) where (status in ('Pending', 'Approved'))
);
create index leave_requests_person_idx on public.leave_requests (person_id, start_date);
create index leave_requests_org_status_idx on public.leave_requests (org_id, status, start_date);
create trigger leave_requests_stamp_org_id before insert on public.leave_requests
  for each row execute function public.stamp_org_id();

-- ── §4 authority (UX and RLS read it; the decide RPC re-checks it) ────────────────────────────────────────────
-- The caller may decide a request for this person if they are the person's line manager, or hold the organisation's
-- approver role (Admin while the setting is empty). Separation of duties is a SEPARATE check in the RPC.
create function public.leave_authority(p_person_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_member() and exists (
    select 1 from public.people w, public.organizations o
     where w.id = p_person_id and w.org_id = public.auth_org_id() and o.id = w.org_id
       and (public.auth_role()::text = coalesce(o.leave_approver_role, 'Admin')
            or exists (select 1 from public.profiles p where p.id = w.profile_id and p.manager_id = auth.uid())))
$$;
revoke all on function public.leave_authority(uuid) from public, anon;
grant execute on function public.leave_authority(uuid) to authenticated;

create function public.guard_leave_refs() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.people w where w.id = new.person_id and w.org_id = new.org_id) then
    raise exception 'LV_REF: the person is not in this organisation' using errcode = '23514';
  end if;
  if not exists (select 1 from public.leave_types t where t.id = new.leave_type_id and t.org_id = new.org_id
                    and (t.archived_at is null or tg_op = 'UPDATE')) then
    raise exception 'LV_REF: the leave type is not on this organisation''s list' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_leave_refs() from public, anon, authenticated;
create trigger zz_leave_requests_refs before insert or update on public.leave_requests
  for each row execute function public.guard_leave_refs();

-- ── §5 RLS: read only ────────────────────────────────────────────────────────────────────────────────────────
alter table public.leave_types enable row level security;
alter table public.leave_types force row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_requests force row level security;

create policy leave_types_select on public.leave_types for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy leave_types_insert on public.leave_types for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.auth_role()) = 'Admin');
create policy leave_types_update on public.leave_types for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- A request is visible to the person it is for, whoever entered it, and anyone who may decide it.
create policy leave_requests_select on public.leave_requests for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (entered_by = (select auth.uid())
              or exists (select 1 from public.people w where w.id = person_id and w.profile_id = (select auth.uid()))
              or (select public.leave_authority(person_id))));

revoke all on public.leave_types, public.leave_requests from public, anon, authenticated;
grant select on public.leave_types, public.leave_requests to authenticated;
grant insert (name) on public.leave_types to authenticated;
grant update (name, archived_at) on public.leave_types to authenticated;
grant all on public.leave_types, public.leave_requests to service_role;
