-- 1720_labour_class_rates.sql — labour cost for crew members with no login (docs/specs/no-login-labour-cost.spec.md,
-- FR-NLL-001/002/006/008). Plan: docs/plans/2026-11-22-no-login-labour-cost.md (T2).
--   1. labour_cost_rates gains a third subject, 'class': a rate for a labour class, naming no person and no role.
--      labour_rate_for (1250) is untouched: it reads person and role rates only, so a class rate never prices a timesheet.
--   2. labour_class_assignments: the class a person in the people register holds from a date (dated like the rates, so a
--      reclassification never re-prices a costed day). Read by Admin, Finance, Executive (the rate rule); written by
--      Admin and Finance through three actions only.
--   3. labour_cost_attendance_days: THE no-double-count rule, in one place (FR-NLL-006). Not granted to any client role.
--   4. The history lock for class rates and assignments (labour_class_locked), independent of the switch (1299 rule).
--   5. save_labour_cost_rate, end_labour_cost_rate, archive_labour_cost_rate restated from the database at head.
-- drops: save_labour_cost_rate's subject check, subject parse, lock line and duplicate message gain the class subject; end_labour_cost_rate's added-span check gains the class arm and its final lock adds the class lock; archive_labour_cost_rate's lock adds the class lock (FR-NLL-001/008)
-- Proven by supabase/tests/1720_labour_class_rates.test.sql. Reverse: supabase/migrations/rollback/1720_labour_class_rates_down.sql.

-- ── 1. class rates ───────────────────────────────────────────────────────────────────────────────────────────
alter table public.labour_cost_rates drop constraint labour_cost_rates_subject_kind_check;
alter table public.labour_cost_rates add constraint labour_cost_rates_subject_kind_check
  check (subject_kind in ('person', 'role', 'class'));
alter table public.labour_cost_rates drop constraint labour_cost_rates_subject;
alter table public.labour_cost_rates add constraint labour_cost_rates_subject check (
  (subject_kind = 'person' and person_id is not null and role_key is null)
  or (subject_kind = 'role' and person_id is null and role_key is not null)
  or (subject_kind = 'class' and person_id is null and role_key is null));
drop index public.labour_cost_rates_one_start;
create unique index labour_cost_rates_one_start on public.labour_cost_rates
  (org_id, subject_kind, coalesce(person_id::text, role_key, class_id::text), effective_from) where archived_at is null;

-- ── 2. class assignments ─────────────────────────────────────────────────────────────────────────────────────
create table public.labour_class_assignments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  worker_id      uuid not null references public.people(id),
  class_id       uuid not null references public.labour_cost_classes(id),
  effective_from date not null,
  effective_to   date,
  archived_at    timestamptz,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  constraint labour_class_assignments_window check (effective_to is null or effective_to >= effective_from)
);
create unique index labour_class_assignments_one_start on public.labour_class_assignments (org_id, worker_id, effective_from)
  where archived_at is null;
create index labour_class_assignments_worker_idx on public.labour_class_assignments (worker_id, effective_from);
alter table public.labour_class_assignments enable row level security;
alter table public.labour_class_assignments force row level security;
create policy labour_class_assignments_select on public.labour_class_assignments for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin', 'Finance', 'Executive'));
-- Field accounts read none of it (the light-account boundary, 1480 (b)).
create policy light_account_deny_select on public.labour_class_assignments as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
revoke all on public.labour_class_assignments from public, anon, authenticated;
grant select on public.labour_class_assignments to authenticated;
grant all on public.labour_class_assignments to service_role;

-- ── 3. the costed attendance days (FR-NLL-006) ──────────────────────────────────────────────────────────────
-- Present and approved; not linked to a timesheet line (a login's attendance is counted through its line); and no
-- approved timesheet line of the person's login on the same project and date (that line counts instead).
create view public.labour_cost_attendance_days with (security_invoker = true) as
  select a.id, a.org_id, a.worker_id, a.project_id, a.work_order_id, a.crew_id, a.work_date,
         a.hours + coalesce(a.overtime_hours, 0) as hours
    from public.attendance_days a
   where a.status = 'present' and a.approved_at is not null
     and a.timesheet_entry_id is null
     and a.hours + coalesce(a.overtime_hours, 0) > 0
     and not exists (select 1 from public.people w
                       join public.timesheets t on t.user_id = w.profile_id and t.org_id = a.org_id and t.status = 'Approved'
                       join public.timesheet_entries e on e.timesheet_id = t.id and e.org_id = a.org_id
                      where w.id = a.worker_id and e.project_id = a.project_id and e.entry_date = a.work_date and e.hours > 0);
revoke all on public.labour_cost_attendance_days from public, anon, authenticated;

-- ── 4. lookups and the lock ─────────────────────────────────────────────────────────────────────────────────
create function public.labour_class_for(p_org uuid, p_worker uuid, p_date date)
returns setof public.labour_class_assignments
language sql stable security definer set search_path = public, pg_temp as $$
  select c.* from public.labour_class_assignments c
   where c.org_id = p_org and c.worker_id = p_worker and c.archived_at is null and c.effective_from <= p_date
     and (c.effective_to is null or c.effective_to >= p_date)
   order by c.effective_from desc limit 1
$$;
revoke all on function public.labour_class_for(uuid, uuid, date) from public, anon, authenticated;

create function public.labour_class_rate_for(p_org uuid, p_class uuid, p_date date)
returns setof public.labour_cost_rates
language sql stable security definer set search_path = public, pg_temp as $$
  select r.* from public.labour_cost_rates r
   where r.org_id = p_org and r.subject_kind = 'class' and r.class_id = p_class and r.archived_at is null
     and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)
   order by r.effective_from desc limit 1
$$;
revoke all on function public.labour_class_rate_for(uuid, uuid, date) from public, anon, authenticated;

-- What prices one person's day now: the class they hold that date and that class's rate (no row = not priced).
create function public.labour_attendance_priced_by(p_org uuid, p_worker uuid, p_date date)
returns table(assignment_id uuid, class_id uuid, rate_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.class_id, r.id
    from public.labour_class_for(p_org, p_worker, p_date) a
   cross join lateral public.labour_class_rate_for(p_org, a.class_id, p_date) r
$$;
revoke all on function public.labour_attendance_priced_by(uuid, uuid, date) from public, anon, authenticated;

-- Is a costed day on/after p_from priced now within the scope a change touches? kind: 'rate' (this rate prices it),
-- 'assignment' (this assignment), 'worker' (any day of this person), 'class' (any day of a person holding this class).
-- An unknown kind locks (fail closed). Holds whatever the switch says.
create function public.labour_class_locked(p_org uuid, p_kind text, p_id uuid, p_from date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.labour_cost_attendance_days d
     cross join lateral public.labour_attendance_priced_by(p_org, d.worker_id, d.work_date) x
     where d.org_id = p_org and d.work_date >= p_from
       and case p_kind when 'rate' then x.rate_id = p_id
                       when 'assignment' then x.assignment_id = p_id
                       when 'worker' then d.worker_id = p_id
                       when 'class' then x.class_id = p_id
                       else true end
  )
$$;
revoke all on function public.labour_class_locked(uuid, text, uuid, date) from public, anon, authenticated;

-- ── 5. assignment actions (Admin, Finance) ──────────────────────────────────────────────────────────────────
create function public.save_labour_class_assignment(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.labour_cost_gate();
  v_worker uuid; v_class uuid; v_from date; v_to date; v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'assignment must be a JSON object' using errcode = '22023'; end if;
  begin
    v_worker := (p->>'worker_id')::uuid;
    v_class := (p->>'class_id')::uuid;
    v_from := (p->>'effective_from')::date;
    v_to := nullif(p->>'effective_to', '')::date;
  exception when others then
    raise exception 'an assignment field is missing or not valid' using errcode = '22023';
  end;
  if v_from is null then raise exception 'start date is required' using errcode = '22023'; end if;
  if v_to is not null and v_to < v_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if v_worker is null or not exists (select 1 from public.people w where w.id = v_worker and w.org_id = v_org and w.archived_at is null) then
    raise exception 'person not found' using errcode = '22023';
  end if;
  if not exists (select 1 from public.labour_cost_classes c where c.id = v_class and c.org_id = v_org and c.archived_at is null) then
    raise exception 'class not found or archived' using errcode = '22023';
  end if;
  if public.labour_class_locked(v_org, 'worker', v_worker, v_from) then
    raise exception 'LCM_CLASS_LOCKED: this would change hours already costed for this person; start the new class after the last costed day' using errcode = '23514';
  end if;
  insert into public.labour_class_assignments (org_id, worker_id, class_id, effective_from, effective_to, created_by)
  values (v_org, v_worker, v_class, v_from, v_to, auth.uid())
  returning id into v_id;
  perform public.log_audit('labour_class_assignment.save', v_org, auth.uid(), v_id,
                           jsonb_build_object('worker_id', v_worker, 'class_id', v_class, 'effective_from', v_from, 'effective_to', v_to));
  return v_id;
exception when unique_violation then
  raise exception 'this person already has a class starting on that date' using errcode = '23505';
end $$;
revoke all on function public.save_labour_class_assignment(jsonb) from public, anon;
grant execute on function public.save_labour_class_assignment(jsonb) to authenticated;

create function public.end_labour_class_assignment(p_id uuid, p_end date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate(); r public.labour_class_assignments;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.labour_class_assignments where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'assignment not found' using errcode = 'P0002'; end if;
  if p_end is null or p_end < r.effective_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if p_end > coalesce(r.effective_to, p_end) then
    -- Moving the end later adds a span: no costed day inside it may already be priced through another class.
    if exists (
      select 1 from public.labour_cost_attendance_days d
       cross join lateral public.labour_attendance_priced_by(v_org, d.worker_id, d.work_date) x
       where d.org_id = v_org and d.worker_id = r.worker_id and d.work_date > r.effective_to and d.work_date <= p_end
         and x.assignment_id <> r.id
    ) then
      raise exception 'LCM_CLASS_LOCKED: days in the added span are already costed' using errcode = '23514';
    end if;
  end if;
  if public.labour_class_locked(v_org, 'assignment', p_id, p_end + 1) then
    raise exception 'LCM_CLASS_LOCKED: days after that date are already costed by this class' using errcode = '23514';
  end if;
  update public.labour_class_assignments set effective_to = p_end where id = p_id;
  perform public.log_audit('labour_class_assignment.end', v_org, auth.uid(), p_id,
                           jsonb_build_object('effective_to', p_end, 'previous_effective_to', r.effective_to));
end $$;
revoke all on function public.end_labour_class_assignment(uuid, date) from public, anon;
grant execute on function public.end_labour_class_assignment(uuid, date) to authenticated;

create function public.archive_labour_class_assignment(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate(); r public.labour_class_assignments;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.labour_class_assignments where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'assignment not found' using errcode = 'P0002'; end if;
  if public.labour_class_locked(v_org, 'assignment', p_id, date '0001-01-01') then
    raise exception 'LCM_CLASS_LOCKED: days are already costed by this class' using errcode = '23514';
  end if;
  update public.labour_class_assignments set archived_at = now() where id = p_id;
  perform public.log_audit('labour_class_assignment.archive', v_org, auth.uid(), p_id,
                           jsonb_build_object('worker_id', r.worker_id, 'class_id', r.class_id, 'effective_from', r.effective_from,
                                              'effective_to', r.effective_to));
end $$;
revoke all on function public.archive_labour_class_assignment(uuid) from public, anon;
grant execute on function public.archive_labour_class_assignment(uuid) to authenticated;

-- ── 6. the rate actions, restated from the database at head ─────────────────────────────────────────────────
create or replace function public.save_labour_cost_rate(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.labour_cost_gate();
  v_kind text := p->>'subject_kind';
  v_person uuid; v_role text; v_class uuid; v_basis text := p->>'basis';
  v_amount numeric; v_mult numeric; v_day numeric; v_month numeric; v_from date; v_to date; v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'rate must be a JSON object' using errcode = '22023'; end if;
  if v_kind is null or v_kind not in ('person', 'role', 'class') then raise exception 'subject_kind must be person, role or class' using errcode = '22023'; end if;
  if v_basis is null or v_basis not in ('hourly', 'daily', 'monthly') then raise exception 'basis must be hourly, daily or monthly' using errcode = '22023'; end if;
  begin
    v_amount := (p->>'amount')::numeric;
    v_mult := coalesce((p->>'overtime_multiplier')::numeric, 1);
    v_day := coalesce((p->>'day_hours')::numeric, 8);
    v_month := coalesce((p->>'month_hours')::numeric, 173);
    v_from := (p->>'effective_from')::date;
    v_to := nullif(p->>'effective_to', '')::date;
    v_class := (p->>'class_id')::uuid;
    if v_kind = 'person' then v_person := (p->>'person_id')::uuid; elsif v_kind = 'role' then v_role := p->>'role_key'; perform v_role::public.user_role; end if;
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
  if (v_kind = 'class' and public.labour_class_locked(v_org, 'class', v_class, v_from))
     or (v_kind <> 'class' and public.labour_rate_locked(v_org, null, v_kind, v_person, v_role, v_from)) then
    raise exception 'LCM_RATE_LOCKED: this rate would change hours already priced on approved timesheets; start it after the last priced day' using errcode = '23514';
  end if;
  insert into public.labour_cost_rates (org_id, subject_kind, person_id, role_key, class_id, basis, amount, overtime_multiplier,
                                        day_hours, month_hours, effective_from, effective_to, created_by)
  values (v_org, v_kind, v_person, v_role, v_class, v_basis, v_amount, v_mult, v_day, v_month, v_from, v_to, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'a rate for this person, role or class already starts on that date' using errcode = '23505';
end $$;
revoke all on function public.save_labour_cost_rate(jsonb) from public, anon;
grant execute on function public.save_labour_cost_rate(jsonb) to authenticated;

create or replace function public.end_labour_cost_rate(p_id uuid, p_end date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate(); r public.labour_cost_rates;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'rate not found' using errcode = 'P0002'; end if;
  if p_end is null or p_end < r.effective_from then raise exception 'end date is before the start date' using errcode = '22023'; end if;
  if p_end > coalesce(r.effective_to, p_end) then
    -- Moving the end later adds a span: no approved hour inside it may already be priced.
    if exists (
      select 1 from public.timesheet_entries e
        join public.timesheets t on t.id = e.timesheet_id
       where e.org_id = v_org and t.org_id = v_org and t.status = 'Approved' and e.hours > 0
         and e.entry_date > r.effective_to and e.entry_date <= p_end
         and ((r.subject_kind = 'person' and t.user_id = r.person_id)
              or (r.subject_kind = 'role' and exists (select 1 from public.profiles pr
                   where pr.id = t.user_id and pr.org_id = v_org and pr.role::text = r.role_key)))
         and exists (select 1 from public.labour_rate_for(v_org, t.user_id, e.entry_date) x where x.id <> r.id)
    ) or (r.subject_kind = 'class' and exists (
      select 1 from public.labour_cost_attendance_days d
       cross join lateral public.labour_attendance_priced_by(v_org, d.worker_id, d.work_date) x
       where d.org_id = v_org and d.work_date > r.effective_to and d.work_date <= p_end
         and x.class_id = r.class_id and x.rate_id <> r.id
    )) then
      raise exception 'LCM_RATE_LOCKED: hours in the added span are already priced' using errcode = '23514';
    end if;
  end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, p_end + 1)
     or public.labour_class_locked(v_org, 'rate', p_id, p_end + 1) then
    raise exception 'LCM_RATE_LOCKED: hours after that date are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set effective_to = p_end where id = p_id;
  perform public.log_audit('labour_cost_rate.end', v_org, auth.uid(), p_id,
                           jsonb_build_object('effective_to', p_end, 'previous_effective_to', r.effective_to));
end $$;
revoke all on function public.end_labour_cost_rate(uuid, date) from public, anon;
grant execute on function public.end_labour_cost_rate(uuid, date) to authenticated;

create or replace function public.archive_labour_cost_rate(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate(); r public.labour_cost_rates;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.labour_cost_rates where id = p_id and org_id = v_org and archived_at is null;
  if not found then raise exception 'rate not found' using errcode = 'P0002'; end if;
  if public.labour_rate_locked(v_org, p_id, null, null, null, date '0001-01-01')
     or public.labour_class_locked(v_org, 'rate', p_id, date '0001-01-01') then
    raise exception 'LCM_RATE_LOCKED: hours are already priced by this rate' using errcode = '23514';
  end if;
  update public.labour_cost_rates set archived_at = now() where id = p_id;
  perform public.log_audit('labour_cost_rate.archive', v_org, auth.uid(), p_id,
                           jsonb_build_object('subject_kind', r.subject_kind, 'effective_from', r.effective_from,
                                              'effective_to', r.effective_to));
end $$;
revoke all on function public.archive_labour_cost_rate(uuid) from public, anon;
grant execute on function public.archive_labour_cost_rate(uuid) to authenticated;
