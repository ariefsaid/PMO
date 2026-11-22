-- 1250_labour_cost_settings.sql — #2670 labour cost in money per work order (docs/specs/labour-cost-money.spec.md).
-- Cost rates for a person or a role, org-defined labour classes, and one switch that is OFF by default (no row = off).
-- Reads: settings and classes by every active member; rates by Admin, Finance, Executive only. Writes: Admin and Finance,
-- through the RPCs below (rates, settings) or RLS (classes). org_id is stamped by trigger, never sent by the client.
-- A rate that would change an hour already priced on an Approved timesheet is refused (LCM_RATE_LOCKED, 23514).
-- Proven by supabase/tests/1250_labour_cost_rates.test.sql. Reverse: supabase/migrations/rollback/1250_labour_cost_settings_down.sql.

create table public.labour_cost_settings (
  org_id     uuid primary key default public.auth_org_id() references public.organizations(id) on delete cascade,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.labour_cost_classes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  code        text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, code)
);

create table public.labour_cost_rates (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  subject_kind        text not null check (subject_kind in ('person', 'role')),
  person_id           uuid references public.profiles(id),
  role_key            text,
  class_id            uuid not null references public.labour_cost_classes(id),
  basis               text not null check (basis in ('hourly', 'daily', 'monthly')),
  amount              numeric(14,2) not null check (amount > 0 and amount < 'Infinity'::numeric),
  overtime_multiplier numeric(4,2) not null default 1 check (overtime_multiplier >= 1 and overtime_multiplier <= 5),
  day_hours           numeric(5,2) not null default 8 check (day_hours >= 1 and day_hours <= 24),
  month_hours         numeric(6,2) not null default 173 check (month_hours >= 1 and month_hours <= 744),
  effective_from      date not null,
  effective_to        date,
  archived_at         timestamptz,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  constraint labour_cost_rates_subject check (
    (subject_kind = 'person' and person_id is not null and role_key is null)
    or (subject_kind = 'role' and person_id is null and role_key is not null)),
  constraint labour_cost_rates_window check (effective_to is null or effective_to >= effective_from)
);
create unique index labour_cost_rates_one_start on public.labour_cost_rates
  (org_id, subject_kind, coalesce(person_id::text, role_key), effective_from) where archived_at is null;
create index labour_cost_rates_org_idx on public.labour_cost_rates (org_id, subject_kind);

alter table public.labour_cost_settings enable row level security;
alter table public.labour_cost_settings force row level security;
alter table public.labour_cost_classes enable row level security;
alter table public.labour_cost_classes force row level security;
alter table public.labour_cost_rates enable row level security;
alter table public.labour_cost_rates force row level security;

create policy labour_cost_settings_select on public.labour_cost_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy labour_cost_classes_select on public.labour_cost_classes for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy labour_cost_classes_insert on public.labour_cost_classes for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.auth_role()) in ('Admin', 'Finance'));
create policy labour_cost_classes_update on public.labour_cost_classes for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Finance'))
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin', 'Finance'));
create policy labour_cost_rates_select on public.labour_cost_rates for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Finance', 'Executive'));

create trigger labour_cost_classes_stamp_org_id before insert on public.labour_cost_classes
  for each row execute function public.stamp_org_id();

revoke all on public.labour_cost_settings, public.labour_cost_classes, public.labour_cost_rates from public, anon, authenticated;
grant select on public.labour_cost_settings, public.labour_cost_rates to authenticated;
grant select, insert on public.labour_cost_classes to authenticated;
grant update (name, archived_at) on public.labour_cost_classes to authenticated;
grant all on public.labour_cost_settings, public.labour_cost_classes, public.labour_cost_rates to service_role;

-- ── is the switch on for an org ──────────────────────────────────────────────────────────────────────
create function public.labour_cost_enabled(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.enabled from public.labour_cost_settings s where s.org_id = p_org), false)
$$;
revoke all on function public.labour_cost_enabled(uuid) from public, anon, authenticated;

-- ── the rate in force for one person on one date: the person's own rate beats the role rate; latest start wins ──
create function public.labour_rate_for(p_org uuid, p_user uuid, p_date date)
returns setof public.labour_cost_rates
language sql stable security definer set search_path = public, pg_temp as $$
  select r.* from public.labour_cost_rates r
   where r.org_id = p_org and r.archived_at is null and r.effective_from <= p_date
     and (r.effective_to is null or r.effective_to >= p_date)
     and ((r.subject_kind = 'person' and r.person_id = p_user)
          or (r.subject_kind = 'role' and exists (select 1 from public.profiles pr
               where pr.id = p_user and pr.org_id = p_org and pr.role::text = r.role_key)))
   order by (r.subject_kind = 'person') desc, r.effective_from desc limit 1
$$;
revoke all on function public.labour_rate_for(uuid, uuid, date) from public, anon, authenticated;

-- ── lock rule: does an Approved hour that is priced now fall in the scope a change touches? ───────────────
-- p_rate set: hours this very rate prices after p_after. p_rate null: hours of the subject's people on/after p_from.
create function public.labour_rate_locked(p_org uuid, p_rate uuid, p_kind text, p_person uuid, p_role text, p_from date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.labour_cost_enabled(p_org) and exists (
    select 1 from public.timesheet_entries e
      join public.timesheets t on t.id = e.timesheet_id and t.org_id = p_org and t.status = 'Approved'
     where e.org_id = p_org and e.hours > 0 and e.entry_date >= p_from
       and (case when p_rate is not null then
                   exists (select 1 from public.labour_rate_for(p_org, t.user_id, e.entry_date) x where x.id = p_rate)
                 when p_kind = 'person' then t.user_id = p_person
                 else exists (select 1 from public.profiles pr where pr.id = t.user_id and pr.role::text = p_role) end)
       and (p_rate is not null or exists (select 1 from public.labour_rate_for(p_org, t.user_id, e.entry_date)))
  )
$$;
revoke all on function public.labour_rate_locked(uuid, uuid, text, uuid, text, date) from public, anon, authenticated;

create function public.labour_cost_gate() returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_active_member() or public.auth_role() is null or public.auth_role() not in ('Admin', 'Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.auth_org_id();
end $$;
revoke all on function public.labour_cost_gate() from public, anon, authenticated;

-- ── the switch (first turn-on seeds the default classes; renameable data, not code) ───────────────────────
create function public.save_labour_cost_settings(p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate();
begin
  perform public.assert_is_active_member();
  if p_enabled is null then raise exception 'enabled is required' using errcode = '22023'; end if;
  insert into public.labour_cost_settings (org_id, enabled, updated_by) values (v_org, p_enabled, auth.uid())
    on conflict (org_id) do update set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  if p_enabled and not exists (select 1 from public.labour_cost_classes c where c.org_id = v_org) then
    insert into public.labour_cost_classes (org_id, code, name)
      values (v_org, 'direct', 'Direct'), (v_org, 'indirect', 'Indirect'), (v_org, 'guard', 'Guard');
  end if;
end $$;
revoke all on function public.save_labour_cost_settings(boolean) from public, anon;
grant execute on function public.save_labour_cost_settings(boolean) to authenticated;

-- ── add a rate ───────────────────────────────────────────────────────────────────────────────────────
create function public.save_labour_cost_rate(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.labour_cost_gate();
  v_kind text := p->>'subject_kind';
  v_person uuid; v_role text; v_class uuid; v_basis text := p->>'basis';
  v_amount numeric; v_mult numeric; v_day numeric; v_month numeric; v_from date; v_to date; v_id uuid;
begin
  perform public.assert_is_active_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'rate must be a JSON object' using errcode = '22023'; end if;
  if v_kind is null or v_kind not in ('person', 'role') then raise exception 'subject_kind must be person or role' using errcode = '22023'; end if;
  if v_basis is null or v_basis not in ('hourly', 'daily', 'monthly') then raise exception 'basis must be hourly, daily or monthly' using errcode = '22023'; end if;
  begin
    v_amount := (p->>'amount')::numeric;
    v_mult := coalesce((p->>'overtime_multiplier')::numeric, 1);
    v_day := coalesce((p->>'day_hours')::numeric, 8);
    v_month := coalesce((p->>'month_hours')::numeric, 173);
    v_from := (p->>'effective_from')::date;
    v_to := nullif(p->>'effective_to', '')::date;
    v_class := (p->>'class_id')::uuid;
    if v_kind = 'person' then v_person := (p->>'person_id')::uuid; else v_role := p->>'role_key'; perform v_role::public.user_role; end if;
  exception when others then
    raise exception 'a rate field is missing or not valid' using errcode = '22023';
  end;
  if v_amount is null or v_amount <= 0 or v_amount >= 1e12 or round(v_amount, 2) <> v_amount then raise exception 'amount must be greater than 0 with at most 2 decimals' using errcode = '22023'; end if;
  if v_mult < 1 or v_mult > 5 then raise exception 'overtime multiplier must be between 1 and 5' using errcode = '22023'; end if;
  if v_day < 1 or v_day > 24 then raise exception 'day length must be between 1 and 24 hours' using errcode = '22023'; end if;
  if v_month < 1 or v_month > 744 then raise exception 'month length must be between 1 and 744 hours' using errcode = '22023'; end if;
  if v_from is null then raise exception 'start date is required' using errcode = '22023'; end if;
  if v_to is not null and v_to < v_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if not exists (select 1 from public.labour_cost_classes c where c.id = v_class and c.org_id = v_org and c.archived_at is null) then
    raise exception 'class not found or archived' using errcode = '22023';
  end if;
  if v_kind = 'person' and not exists (select 1 from public.profiles pr where pr.id = v_person and pr.org_id = v_org) then
    raise exception 'person not found' using errcode = '22023';
  end if;
  if public.labour_rate_locked(v_org, null, v_kind, v_person, v_role, v_from) then
    raise exception 'LCM_RATE_LOCKED: this rate would change hours already priced on approved timesheets; start it after the last priced day' using errcode = '23514';
  end if;
  insert into public.labour_cost_rates (org_id, subject_kind, person_id, role_key, class_id, basis, amount, overtime_multiplier,
                                        day_hours, month_hours, effective_from, effective_to, created_by)
  values (v_org, v_kind, v_person, v_role, v_class, v_basis, v_amount, v_mult, v_day, v_month, v_from, v_to, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'a rate for this person or role already starts on that date' using errcode = '23505';
end $$;
revoke all on function public.save_labour_cost_rate(jsonb) from public, anon;
grant execute on function public.save_labour_cost_rate(jsonb) to authenticated;

-- ── end a rate on a date ─────────────────────────────────────────────────────────────────────────────
create function public.end_labour_cost_rate(p_id uuid, p_end date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate(); r public.labour_cost_rates;
begin
  perform public.assert_is_active_member();
  select * into r from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'rate not found' using errcode = 'P0002'; end if;
  if p_end is null or p_end < r.effective_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, p_end + 1) then
    raise exception 'LCM_RATE_LOCKED: hours after that date are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set effective_to = p_end where id = p_id;
end $$;
revoke all on function public.end_labour_cost_rate(uuid, date) from public, anon;
grant execute on function public.end_labour_cost_rate(uuid, date) to authenticated;

-- ── archive a rate ───────────────────────────────────────────────────────────────────────────────────
create function public.archive_labour_cost_rate(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate();
begin
  perform public.assert_is_active_member();
  if not exists (select 1 from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null) then
    raise exception 'rate not found' using errcode = 'P0002';
  end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, date '0001-01-01') then
    raise exception 'LCM_RATE_LOCKED: hours are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set archived_at = now() where id = p_id;
end $$;
revoke all on function public.archive_labour_cost_rate(uuid) from public, anon;
grant execute on function public.archive_labour_cost_rate(uuid) to authenticated;
