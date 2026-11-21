-- 1245_crew_loans.sql — #2704 (map #2516): a worker lent to another crew follows the host crew for the loan period.
-- Spec: docs/specs/crew-loan.spec.md (FR-LOAN-001/002/005/007/008/009). Plan: docs/plans/2026-11-21-crew-loan.md.
-- Proven by supabase/tests/1245_crew_loans.test.sql.
--
-- A loan is a separate record; the worker's home placement (crew_members) is never edited. An organisation that
-- creates no loans sees no change: every rule here is inert without a row.
--
-- ── REVERSE (also supabase/migrations/rollback/1245_crew_loans_down.sql) ───────────────────────────────────────

create table public.crew_loans (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                 references public.organizations(id) on delete cascade,
  worker_id    uuid not null references public.people(id),
  home_crew_id uuid not null references public.crews(id),
  host_crew_id uuid not null references public.crews(id),
  valid_from   date not null,
  valid_to     date not null,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  constraint crew_loans_range check (valid_to >= valid_from),
  constraint crew_loans_host_differs check (host_crew_id <> home_crew_id),
  -- FR-LOAN-005 / AC-LOAN-004: a worker is on at most one loan on any day (inclusive ranges).
  constraint crew_loans_no_overlap exclude using gist (
    worker_id with =, daterange(valid_from, valid_to, '[]') with &&)
);
create index crew_loans_worker_dates_idx on public.crew_loans (worker_id, valid_from, valid_to);
create index crew_loans_host_dates_idx on public.crew_loans (host_crew_id, valid_from, valid_to);
create index crew_loans_home_dates_idx on public.crew_loans (home_crew_id, valid_from, valid_to);
create trigger crew_loans_stamp_org_id before insert on public.crew_loans
  for each row execute function public.stamp_org_id();

-- ── guard: same-organisation references, home placement, approved hours never move, version and audit ────────────
-- SECURITY: definer so it can see a foreign row's org and the worker's attendance whatever the caller's RLS shows.
create function public.guard_crew_loan() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.crew_loans;
  o_from date; o_to date; n_from date; n_to date;
  v_locked date;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' then
    if tg_op = 'INSERT' then
      -- FR-LOAN-002: both crews are live crews of this organisation; the home crew holds the worker for the whole
      -- period (checked at creation only; a later placement edit does not re-check it).
      if not exists (select 1 from public.crews c where c.id = new.home_crew_id and c.org_id = new.org_id and c.archived_at is null)
         or not exists (select 1 from public.crews c where c.id = new.host_crew_id and c.org_id = new.org_id and c.archived_at is null) then
        raise exception 'LOAN_CREW: both crews must be live crews of this organisation' using errcode = '23514';
      end if;
      if not exists (select 1 from public.people w where w.id = new.worker_id and w.org_id = new.org_id) then
        raise exception 'LOAN_CREW: the person is not in this organisation' using errcode = '23514';
      end if;
      if not exists (select 1 from public.crew_members m
                      where m.worker_id = new.worker_id and m.crew_id = new.home_crew_id
                        and m.valid_from <= new.valid_from and coalesce(m.valid_to, 'infinity'::date) >= new.valid_to) then
        raise exception 'LOAN_HOME: the person must be placed in the home crew for the whole loan period' using errcode = '23514';
      end if;
    end if;
  end if;
  -- FR-LOAN-007: approved, locked or submitted hours never move. Refuse a change to any day whose crew would change.
  if tg_op <> 'INSERT' then o_from := old.valid_from; o_to := old.valid_to; end if;
  if tg_op <> 'DELETE' then n_from := new.valid_from; n_to := new.valid_to; end if;
  select min(a.work_date) into v_locked
    from public.attendance_days a
   where a.worker_id = v_row.worker_id
     and (a.approved_at is not null or a.locked_at is not null or a.submitted_at is not null)
     and coalesce(a.work_date between n_from and n_to, false) is distinct from coalesce(a.work_date between o_from and o_to, false);
  if v_locked is not null then
    raise exception 'LOAN_HOURS_LOCKED: hours on % are already submitted or approved and cannot move', to_char(v_locked, 'YYYY-MM-DD')
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    perform public.log_audit('crew_loans.correct', new.org_id, auth.uid(), new.id,
              jsonb_build_object('before', to_jsonb(old) - 'org_id', 'after', to_jsonb(new) - 'org_id'));
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.guard_crew_loan() from public, anon, authenticated;
create trigger zz_crew_loans_guard before insert or update or delete on public.crew_loans
  for each row execute function public.guard_crew_loan();

-- FR-LOAN-009: a crew with a current or future loan (home or host) is not archived.
create function public.guard_crew_loan_archive() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.archived_at is not null and old.archived_at is null and exists (
       select 1 from public.crew_loans l
        where (l.home_crew_id = new.id or l.host_crew_id = new.id) and l.valid_to >= current_date) then
    raise exception 'CRW_ARCHIVE_IN_USE: end this crew''s current and future loans first' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_crew_loan_archive() from public, anon, authenticated;
create trigger zz_crews_loan_archive before update on public.crews
  for each row execute function public.guard_crew_loan_archive();

-- ── access: whoever manages crews today (crew_can_manage, 1035) writes; every active member reads; Admin deletes ───
alter table public.crew_loans enable row level security;
alter table public.crew_loans force row level security;
create policy crew_loans_select on public.crew_loans for select using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy crew_loans_insert on public.crew_loans for insert with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.crew_can_manage()));
create policy crew_loans_update on public.crew_loans for update using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.crew_can_manage()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy crew_loans_delete on public.crew_loans for delete using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
revoke all on public.crew_loans from public, anon, authenticated;
grant select, delete on public.crew_loans to authenticated;
grant insert (id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) on public.crew_loans to authenticated;
grant update (valid_from, valid_to) on public.crew_loans to authenticated;
grant all on public.crew_loans to service_role;
