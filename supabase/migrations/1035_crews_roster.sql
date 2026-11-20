-- 1035_crews_roster.sql — #2528 (map #2516): crews, the people in them, and which crews serve a work order.
-- Spec: docs/specs/crews-roster-attendance.spec.md (FR-CRW-001..007, FR-CRW-019/020, NFR-CRW-001/003).
-- Plan: docs/plans/2026-11-20-crews-roster-attendance.md (Slice 1). Proven by supabase/tests/crews_roster.test.sql.
--
-- Membership uses the shared workforce register introduced by 0970.
-- Basic workforce records are available to active members; Admin and Project Manager manage them.
-- Expiry-document access policies are unchanged.
--
-- ── REVERSE (also supabase/migrations/rollback/1035_crews_roster_down.sql) ──────────────────────────────────────
--   reverse 1037 and 1036 first; then drop function work_order_roster, the tables (reverse order), the guard functions.

create extension if not exists btree_gist with schema extensions;

-- ── §1 crew master (FR-CRW-001/002) ──────────────────────────────────────────────────────────────────────────
create table public.crews (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                        references public.organizations(id) on delete cascade,
  code                text not null check (char_length(btrim(code)) between 1 and 20),
  name                text not null check (char_length(btrim(name)) between 1 and 120),
  discipline_id       uuid references public.cost_disciplines(id),
  field_controller_id uuid references public.profiles(id),
  kind                text not null default 'own' check (kind in ('own', 'vendor')),
  vendor_company_id   uuid references public.companies(id),
  created_at          timestamptz not null default now(),
  archived_at         timestamptz,
  constraint crews_vendor_company check ((kind = 'vendor') = (vendor_company_id is not null))
);
-- AC-CRW-001: one live code per organisation; archiving frees it.
create unique index crews_code_live on public.crews (org_id, lower(btrim(code))) where archived_at is null;
create index crews_org_name_idx on public.crews (org_id, name);
create index crews_field_controller_idx on public.crews (field_controller_id) where field_controller_id is not null;
create trigger crews_stamp_org_id before insert on public.crews for each row execute function public.stamp_org_id();

create table public.crew_standard_roles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
               references public.organizations(id) on delete cascade,
  crew_id    uuid not null references public.crews(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  headcount  integer not null check (headcount between 1 and 500),
  sort_order integer not null default 0
);
create unique index crew_standard_roles_name on public.crew_standard_roles (crew_id, lower(btrim(name)));
create trigger crew_standard_roles_stamp_org_id before insert on public.crew_standard_roles
  for each row execute function public.stamp_org_id();

-- ── §2 people (FR-CRW-004) ───────────────────────────────────────────────────────────────────────────────────
alter table public.people
  add column kind text not null default 'own' check (kind in ('own', 'vendor')),
  add column id_reference text check (id_reference is null or char_length(btrim(id_reference)) between 1 and 60),
  add column vendor_company_id uuid references public.companies(id),
  add column job_title text check (job_title is null or char_length(btrim(job_title)) between 1 and 120),
  add constraint people_vendor_no_login check (kind = 'own' or profile_id is null);

drop policy people_insert on public.people;
drop policy people_update on public.people;
create policy people_insert on public.people for insert with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (select public.auth_role()) in ('Admin', 'Project Manager'));
create policy people_update on public.people for update using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (select public.auth_role()) in ('Admin', 'Project Manager'))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
grant insert (id, kind, id_reference, vendor_company_id, job_title) on public.people to authenticated;
grant update (kind, id_reference, vendor_company_id, job_title) on public.people to authenticated;

-- A member-readable directory exposes only basic person fields, scoped explicitly to the caller's org.
create view public.people_directory with (security_barrier = true) as
  select p.id, p.name, p.code, p.job_title, p.archived_at from public.people p
  where p.org_id = (select public.auth_org_id()) and (select public.is_active_member());
revoke all on public.people_directory from public, anon, authenticated;
grant select on public.people_directory to authenticated;

-- ── §3 membership (FR-CRW-003/005) ───────────────────────────────────────────────────────────────────────────
create table public.crew_members (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                     references public.organizations(id) on delete cascade,
  crew_id          uuid not null references public.crews(id),
  worker_id        uuid not null references public.people(id),
  standard_role_id uuid references public.crew_standard_roles(id),
  valid_from       date not null,
  valid_to         date,
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  constraint crew_members_range check (valid_to is null or valid_to >= valid_from),
  -- AC-CRW-002: a person is in one crew on any day. Day-placement handover: a placement's last day yields to a
  -- placement in another crew starting that day (the newer one wins the day, JOB-F6), so the range is [from, to)
  -- (min one day); any longer cross-crew overlap, or two open placements, is still refused.
  constraint crew_members_no_overlap exclude using gist (
    worker_id with =, daterange(valid_from, greatest(coalesce(valid_to, 'infinity'::date), valid_from + 1), '[)') with &&),
  -- the same crew never double-books a person (inclusive, as before).
  constraint crew_members_no_same_crew_overlap exclude using gist (
    worker_id with =, crew_id with =, daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&)
);
create index crew_members_crew_dates_idx on public.crew_members (crew_id, valid_from, valid_to);
create index crew_members_worker_dates_idx on public.crew_members (worker_id, valid_from, valid_to);
create trigger crew_members_stamp_org_id before insert on public.crew_members
  for each row execute function public.stamp_org_id();

-- ── §4 roster per work order (FR-CRW-006) ────────────────────────────────────────────────────────────────────
create table public.work_order_crews (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id),
  crew_id       uuid not null references public.crews(id),
  valid_from    date not null,
  valid_to      date,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  constraint work_order_crews_range check (valid_to is null or valid_to >= valid_from),
  -- AC-CRW-003 / OD-CRW-2: a crew serves one work order on any day.
  constraint work_order_crews_no_overlap exclude using gist (
    crew_id with =, daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&)
);
create index work_order_crews_wo_dates_idx on public.work_order_crews (work_order_id, valid_from, valid_to);
create trigger work_order_crews_stamp_org_id before insert on public.work_order_crews
  for each row execute function public.stamp_org_id();

-- ── §5 same-organisation references, version and audit (zz_: after the org stamp, 0215) ───────────────────────────────────────────────────────
-- SECURITY: definer so it can see a foreign row's org to refuse it; RLS alone would make a foreign id look absent
-- only on read, not on an FK write.
create function public.guard_crew_refs() returns trigger
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
      -- FR-CRW-002: archive only a crew with no open or future membership or roster placement.
      if new.archived_at is not null and old.archived_at is null and (
           exists (select 1 from public.crew_members m
                    where m.crew_id = new.id and coalesce(m.valid_to, 'infinity'::date) >= current_date)
           or exists (select 1 from public.work_order_crews r
                    where r.crew_id = new.id and coalesce(r.valid_to, 'infinity'::date) >= current_date)) then
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

create trigger zz_crews_refs before insert or update on public.crews
  for each row execute function public.guard_crew_refs();
create trigger zz_crew_standard_roles_refs before insert or update on public.crew_standard_roles
  for each row execute function public.guard_crew_refs();
create trigger zz_people_crew_refs before insert or update on public.people
  for each row execute function public.guard_crew_refs();
create trigger zz_crew_members_refs before insert or update on public.crew_members
  for each row execute function public.guard_crew_refs();
create trigger zz_work_order_crews_refs before insert or update on public.work_order_crews
  for each row execute function public.guard_crew_refs();

-- ── §6 who may manage crews (FR-CRW-019) ─────────────────────────────────────────────────────────────────────
-- One predicate for every crew-master write: an active member of the org with a delivery role. Mirrored by
-- `can('manage', 'crew')` in pmo-portal/src/auth/policy.ts.
create function public.crew_can_manage() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_member() and coalesce(public.auth_role() in ('Admin', 'Executive', 'Project Manager'), false)
$$;
revoke all on function public.crew_can_manage() from public, anon;
grant execute on function public.crew_can_manage() to authenticated;

do $rls$
declare t text;
begin
  foreach t in array array['crews', 'crew_standard_roles', 'crew_members', 'work_order_crews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- Every active member of the organisation reads the crew master and roster (the tick screen and pickers need it).
    -- Helpers are scalar-selected (evaluated once per query, 0646/0696) and every policy names the membership gate (0203).
    execute format('create policy %I on public.%I for select using (org_id = (select public.auth_org_id()) '
                   'and (select public.is_active_member()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (org_id = (select public.auth_org_id()) '
                   'and (select public.is_active_member()) and (select public.crew_can_manage()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (org_id = (select public.auth_org_id()) '
                   'and (select public.is_active_member()) and (select public.crew_can_manage())) '
                   'with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (org_id = (select public.auth_org_id()) '
                   'and (select public.is_active_member()) and (select public.auth_role()) = ''Admin'')', t || '_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $rls$;

grant insert (id, code, name, discipline_id, field_controller_id, kind, vendor_company_id) on public.crews to authenticated;
grant update (code, name, discipline_id, field_controller_id, kind, vendor_company_id, archived_at) on public.crews to authenticated;
grant insert (id, crew_id, name, headcount, sort_order) on public.crew_standard_roles to authenticated;
grant update (name, headcount, sort_order) on public.crew_standard_roles to authenticated;
grant insert (id, crew_id, worker_id, standard_role_id, valid_from, valid_to) on public.crew_members to authenticated;
grant update (standard_role_id, valid_from, valid_to) on public.crew_members to authenticated;
grant insert (id, work_order_id, crew_id, valid_from, valid_to) on public.work_order_crews to authenticated;
grant update (valid_from, valid_to) on public.work_order_crews to authenticated;

-- Create the master and its standard roles in one transaction under the caller's RLS grants.
create function public.create_crew_with_roles(p_crew jsonb, p_roles jsonb)
  returns public.crews language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_crew public.crews;
begin
  if jsonb_typeof(p_crew) is distinct from 'object' or jsonb_typeof(p_roles) is distinct from 'array' then
    raise exception 'invalid crew or roles' using errcode = '22023';
  end if;
  insert into public.crews (code, name, kind, discipline_id, field_controller_id, vendor_company_id)
  values (p_crew->>'code', p_crew->>'name', coalesce(p_crew->>'kind', 'own'),
          nullif(p_crew->>'discipline_id', '')::uuid, nullif(p_crew->>'field_controller_id', '')::uuid,
          nullif(p_crew->>'vendor_company_id', '')::uuid)
  returning * into v_crew;
  insert into public.crew_standard_roles (crew_id, name, headcount, sort_order)
  select v_crew.id, item->>'name', (item->>'headcount')::integer, (ord - 1)::integer
  from jsonb_array_elements(p_roles) with ordinality as r(item, ord);
  return v_crew;
end $$;
revoke all on function public.create_crew_with_roles(jsonb, jsonb) from public, anon;
grant execute on function public.create_crew_with_roles(jsonb, jsonb) to authenticated;

-- New people and their first placement share a transaction under the caller's grants.
create function public.place_new_crew_worker(p_person jsonb, p_placement jsonb)
  returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_person uuid;
begin
  if jsonb_typeof(p_person) is distinct from 'object' or jsonb_typeof(p_placement) is distinct from 'object' then
    raise exception 'invalid person or placement' using errcode = '22023';
  end if;
  insert into public.people (name, kind, id_reference, profile_id, vendor_company_id)
  values (p_person->>'name', coalesce(p_person->>'kind', 'own'), p_person->>'id_reference',
          nullif(p_person->>'profile_id', '')::uuid, nullif(p_person->>'vendor_company_id', '')::uuid)
  returning id into v_person;
  insert into public.crew_members (crew_id, worker_id, standard_role_id, valid_from, valid_to)
  values ((p_placement->>'crew_id')::uuid, v_person, nullif(p_placement->>'standard_role_id', '')::uuid,
          (p_placement->>'valid_from')::date, nullif(p_placement->>'valid_to', '')::date);
end $$;
revoke all on function public.place_new_crew_worker(jsonb, jsonb) from public, anon;
grant execute on function public.place_new_crew_worker(jsonb, jsonb) to authenticated;

-- ── §7 the work-order roster for a date (FR-CRW-007, AC-CRW-004) ─────────────────────────────────────────────
-- One row per crew rostered on the work order that day: its members and, per standard role, headcount vs placed.
-- security invoker: the caller's RLS decides what it sees (another org sees nothing).
create function public.work_order_roster(p_work_order_id uuid, p_date date)
  returns table (crew_id uuid, crew_code text, crew_name text, field_controller_id uuid,
                 members jsonb, roles jsonb, shortfall integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with rostered as (
    select c.id, c.code, c.name, c.field_controller_id
      from public.work_order_crews r join public.crews c on c.id = r.crew_id
     where r.work_order_id = p_work_order_id
       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
  ), placed as (
    select m.crew_id, m.worker_id, w.name as display_name, m.standard_role_id
      from public.crew_members m join public.people_directory w on w.id = m.worker_id
     where m.crew_id in (select id from rostered)
       and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
       and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                        where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                          and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
  ), role_counts as (
    select s.crew_id, s.id, s.name, s.headcount, s.sort_order,
           (select count(*)::int from placed p where p.crew_id = s.crew_id and p.standard_role_id = s.id) as placed
      from public.crew_standard_roles s where s.crew_id in (select id from rostered)
  )
  select r.id, r.code, r.name, r.field_controller_id,
         coalesce((select jsonb_agg(jsonb_build_object('worker_id', p.worker_id, 'display_name', p.display_name,
                                                       'standard_role_id', p.standard_role_id)
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
revoke all on function public.work_order_roster(uuid, date) from public, anon;
grant execute on function public.work_order_roster(uuid, date) to authenticated;
