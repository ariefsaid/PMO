-- 0172_timesheet_entry_date_bound_to_sheet_week.sql
--
-- 0168 did not fix the defect its header claims to close. Two independent holes, both reachable by
-- `authenticated` over PostgREST with no FE involvement.
--
-- ⚑ (A) THE RPC BOUNDS AGAINST AN ARGUMENT, NOT THE SHEET. 0168:70 resolves the sheet with
--     `select user_id, status, org_id into ...` — it never reads week_start_date — and the guard at
--     0168:98-105 bounds entry_date against `p_week_start_date`, which is a CALLER-SUPPLIED ARGUMENT.
--     On the `p_timesheet_id is not null` path (the FE's normal edit path — src/lib/db/timesheets.ts
--     sends the sheet id and the week as two independent client-supplied args) nothing ties the
--     argument to the sheet, so the guard only ever checks the caller's claim against itself:
--         save_timesheet_week(S /* week of 2026-06-08 */, '2026-05-04',
--                             '[{"project_id":"…","entry_date":"2026-05-06","hours":24}]', '{}')
--     passes (2026-05-06 ∈ [2026-05-04, 2026-05-10]) and lands 24 May hours on the June sheet — the
--     exact corruption 0168's header says it closes. 0161 shipped green over it because all five of
--     its calls pass `null` for p_timesheet_id, the one path where argument == sheet week by
--     construction; the reachable path was never exercised.
--
-- ⚑ (B) A GUARD INSIDE A SECURITY DEFINER FUNCTION CANNOT PROTECT A DIRECTLY-WRITABLE TABLE.
--     0075:255-256 grants INSERT/UPDATE on public.timesheet_entries to `authenticated`, and the
--     timesheet_entries_write policy (0018, re-stated 0021) carries NO entry_date predicate at all —
--     only org / role / own-Draft-sheet / project-org. `POST /rest/v1/timesheet_entries` with
--     {timesheet_id: <own draft>, entry_date: '2020-01-01', hours: 24} writes straight through
--     whatever save_timesheet_week does.
--
-- ⚑ (C) AND THE PARENT SIDE PRODUCES THE SAME CORRUPTION IN REVERSE. timesheets_update_own
--     (0002, re-stated 0021) lets an owner UPDATE their own Draft sheet and 0075 grants UPDATE on
--     `timesheets`, so `week_start_date` is client-writable: move the sheet's week and its entries are
--     left outside it. Closing only (A) and (B) would leave the invariant trivially breakable and this
--     header would be overclaiming in the same way 0168's did.
--
-- Why this is money and not tidiness: the grid indexes cells by `project|entry_date` across the
-- sheet's 7 days (src/lib/timesheet-edit.ts), so an out-of-week row has NO cell to render in — an
-- approver approves hours they cannot see — and 0138_approved_timesheet_for_push carries entry_date
-- verbatim into the client's ERPNext Timesheet, posting payroll costing into the wrong period.
--
-- ── MECHANISM, AND WHY (the choice for (B)) ─────────────────────────────────────────────────────────
-- A CHECK constraint cannot express this: the bound lives on the PARENT `timesheets` row. Of the three
-- realistic mechanisms, this migration uses a BEFORE INSERT OR UPDATE trigger (§1):
--   • trigger — binds the invariant to the TABLE, so it holds for EVERY writer: direct PostgREST,
--     service_role (the 0138 push/read path), future edge functions, and save_timesheet_week itself.
--     The message names the offending date and the sheet's week. No FE change. CHOSEN.
--   • an entry_date predicate on timesheet_entries_write — rejected: RLS binds only `authenticated`.
--     service_role and every SECURITY DEFINER function (including save_timesheet_week) bypass it, so
--     the rule would live in two places and be free to drift — which is how (A) happened. It also
--     surfaces as an opaque 42501 "new row violates row-level security policy" that never says the
--     date is the problem.
--   • revoking the INSERT/UPDATE grant (0058's precedent) — rejected here: 0058 revoked grants on
--     tables whose writes had moved WHOLESALE to RPCs; timesheet_entries' have not. The FE still uses
--     the direct path for DELETE (deleteTimesheetEntry → useTimesheetEntries.ts:59 `deleteRow`), and
--     `upsertTimesheetEntries` + `repositories.timesheets.upsertEntries` remain exported API. A revoke
--     is therefore the only option that requires an FE change, and it STILL would not bind
--     service_role or definer writers. (Correction to the reported premise: no live FE code path does
--     a direct INSERT/UPDATE of timesheet_entries today — the live direct write is the DELETE — so the
--     grant is under-used rather than dead. Narrowing it to `delete` is a defensible follow-up; it is
--     a strictly smaller change once the trigger holds the invariant, and is deliberately not bundled
--     with a defect fix.)
-- §2 keeps the guard in save_timesheet_week as well, reading the week from the SHEET: it rejects
-- before any write (preserving 0168's all-or-nothing guarantee — the trigger would abort mid-insert
-- with the same transactional outcome but a per-row message), and it is where the mismatched-argument
-- raise belongs.
--
-- ── PRE-EXISTING VIOLATING ROWS ─────────────────────────────────────────────────────────────────────
-- §0 counts them and raises a WARNING rather than failing the apply, so a production apply SURFACES
-- any legacy corruption instead of hiding it. The trade-off is stated plainly: with the trigger
-- unconditional, an UPDATE (including the FE's upsert-on-conflict `do update set hours`) touching such
-- a row will fail 23514 naming the date. That is the honest outcome — the row is corrupt — and DELETE
-- is unaffected, so the cell can always be cleared and re-entered on the right week.
--
-- ── ERRCODES ────────────────────────────────────────────────────────────────────────────────────────
-- 23514 (CHECK-violation) for every "this date does not belong to that week" rejection — the same code
-- 0168 chose and the same one the hours>24 CHECK surfaces, so the FE's classifyMutationError keeps
-- landing them in the existing generic "Update failed" bucket with the verbatim reason. 22023
-- (invalid_parameter_value) for the mismatched p_week_start_date: it is a bad ARGUMENT, not a bad row,
-- and conflating the two would let a mismatch masquerade as an out-of-week date. No FE change is
-- needed for it — the FE always passes the selected week together with that week's sheet id, so it
-- cannot produce the mismatch; it lands in the same generic bucket if it ever does.
-- Every message is built with to_char(…,'YYYY-MM-DD') so it does not vary with the session DateStyle
-- (the pgTAP proofs assert the message TEXT, not just the errcode).
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────────
-- v0.8.0 is IN PRODUCTION, so `supabase db reset` is NOT a rollback path (0168's note saying so was
-- copied from 0055 and is stale). Rollback is a forward migration:
--     drop trigger timesheet_entries_week_bounds on public.timesheet_entries;
--     drop trigger timesheets_week_start_bounds  on public.timesheets;
--     drop function public.timesheet_entry_week_bounds_guard();
--     drop function public.timesheets_week_start_bounds_guard();
--   then re-apply the 0168 body of save_timesheet_week.
-- No table shape changes, no data is written or migrated, so rollback loses nothing.
--
-- SECURITY: both trigger functions are SECURITY DEFINER with `set search_path = public` — they must
-- read the counterpart row (parent sheet / child entries) regardless of the caller's RLS visibility,
-- or an invisible parent would read as "no week" and fail open. They are read-only apart from
-- returning NEW unmodified, take no caller-supplied identifiers beyond the row being written, and add
-- no callable surface (a trigger fires without EXECUTE on its function). save_timesheet_week is
-- re-stated from 0168 with every guard preserved (auth, `for update` ownership, org tenancy,
-- Draft-only, project tenancy, delete-pinning); the deltas are exactly the three marked blocks.
-- Proofs: supabase/tests/0165_timesheet_entry_date_bound_to_sheet_week.test.sql.

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §0 — Report (do not hide) any row that already violates the invariant.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad
    from public.timesheet_entries e
    join public.timesheets t on t.id = e.timesheet_id
   where e.entry_date < t.week_start_date or e.entry_date > t.week_start_date + 6;
  if v_bad > 0 then
    raise warning '0172: % pre-existing timesheet_entries row(s) lie outside their sheet''s week. They are left in place (this migration writes no data); any UPDATE touching one will now be refused 23514 until the cell is deleted and re-entered on the correct week.', v_bad;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — The table-level binding: an entry's entry_date lies in its sheet's [week_start_date, +6].
--      This is the authority. Everything below is defence in depth on top of it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.timesheet_entry_week_bounds_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v_week date;
begin
  select t.week_start_date into v_week
    from public.timesheets t where t.id = new.timesheet_id;

  -- No parent row: the FK will reject this anyway, but the guard must not fail OPEN in the window
  -- before it does (and a NULL timesheet_id would otherwise leave v_week NULL and skip the compare).
  if v_week is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- `null < x or null > y` is NULL, not TRUE, so a missing entry_date must be named explicitly or it
  -- slips past a two-sided comparison (the same three-valued-logic trap as `NaN >= 0` in Postgres).
  if new.entry_date is null then
    raise exception 'entry_date is required and must fall in the timesheet week (% .. %)',
      to_char(v_week, 'YYYY-MM-DD'), to_char(v_week + 6, 'YYYY-MM-DD') using errcode = '23514';
  end if;

  if new.entry_date < v_week or new.entry_date > v_week + 6 then
    raise exception 'entry_date % is outside the timesheet week (% .. %)',
      to_char(new.entry_date, 'YYYY-MM-DD'), to_char(v_week, 'YYYY-MM-DD'),
      to_char(v_week + 6, 'YYYY-MM-DD') using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists timesheet_entries_week_bounds on public.timesheet_entries;
create trigger timesheet_entries_week_bounds
  before insert or update on public.timesheet_entries
  for each row execute function public.timesheet_entry_week_bounds_guard();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — The parent side (C): a sheet's week may not move out from under its entries.
--      Fires only when week_start_date actually changes, so it costs nothing on the ordinary
--      status/approval updates that never touch it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.timesheets_week_start_bounds_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if exists (
    select 1 from public.timesheet_entries e
     where e.timesheet_id = new.id
       and (e.entry_date < new.week_start_date or e.entry_date > new.week_start_date + 6)) then
    raise exception 'cannot change week_start_date: entries fall outside the new week (% .. %)',
      to_char(new.week_start_date, 'YYYY-MM-DD'), to_char(new.week_start_date + 6, 'YYYY-MM-DD')
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists timesheets_week_start_bounds on public.timesheets;
create trigger timesheets_week_start_bounds
  before update on public.timesheets
  for each row when (new.week_start_date is distinct from old.week_start_date)
  execute function public.timesheets_week_start_bounds_guard();

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — save_timesheet_week: bound against the SHEET, and refuse a disagreeing argument.
--      Re-stated from 0168 with THREE deltas, all inside the marked blocks:
--        (i)   step 2's `for update` select also reads week_start_date into v_sheet_week;
--        (ii)  a mismatched p_week_start_date on the existing-sheet path is REFUSED (22023) rather
--              than silently re-interpreted — the caller and the server must agree on which week is
--              being written before any row is touched;
--        (iii) the bounds guard compares against v_sheet_week and counts a NULL entry_date.
--      Everything else is 0168 verbatim.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function save_timesheet_week(
  p_timesheet_id    uuid,               -- null ⇒ create the caller's Draft for the week
  p_week_start_date date,
  p_upserts         jsonb default '[]'::jsonb,  -- [{project_id, entry_date, hours, notes}]
  p_delete_ids      uuid[] default '{}')
  returns uuid                          -- the resolved timesheet id
  language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_org        uuid := auth_org_id();
  v_sheet_id   uuid := p_timesheet_id;
  v_owner      uuid;
  v_status     timesheet_status;
  v_sheet_org  uuid;
  v_sheet_week date;
  v_bad_proj   int;
  v_bad_date   int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'no org context' using errcode = '42501';
  end if;

  -- 1. Resolve (or create) the Draft sheet. Creating self-stamps user_id = caller.
  if v_sheet_id is null then
    insert into public.timesheets (org_id, user_id, week_start_date, status)
    values (v_org, v_uid, p_week_start_date, 'Draft')
    returning id into v_sheet_id;
  end if;

  -- 2. Ownership + Draft + tenancy re-assertion (mirrors timesheets_insert / entries_write RLS).
  --    (i) week_start_date is read HERE: the sheet — not the caller's argument — defines the week.
  select user_id, status, org_id, week_start_date
    into v_owner, v_status, v_sheet_org, v_sheet_week
    from public.timesheets where id = v_sheet_id for update;
  if v_owner is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;
  if v_sheet_org is distinct from v_org or v_owner is distinct from v_uid then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status <> 'Draft' then
    raise exception 'timesheet is not editable (status %)', v_status using errcode = 'P0001';
  end if;

  -- 2b. (ii) The caller named a sheet AND a week; if they disagree, one of them is wrong and the
  --     server must not pick. Silently using v_sheet_week would honour a call whose entries were
  --     authored against a different week — the FE's own week is what it renders and diffs against.
  if p_timesheet_id is not null and p_week_start_date is distinct from v_sheet_week then
    raise exception 'p_week_start_date % does not match the timesheet week %',
      to_char(p_week_start_date, 'YYYY-MM-DD'), to_char(v_sheet_week, 'YYYY-MM-DD')
      using errcode = '22023';
  end if;

  -- 3. Upserts. Every referenced project must be in the caller's org (parent-project
  --    tenancy guard from 0011). Reject BEFORE any write if a foreign project appears.
  if jsonb_array_length(p_upserts) > 0 then
    select count(*) into v_bad_proj
      from jsonb_to_recordset(p_upserts) as u(project_id uuid)
     where not exists (
       select 1 from public.projects p where p.id = u.project_id and p.org_id = v_org);
    if v_bad_proj > 0 then
      raise exception 'not authorized' using errcode = '42501';
    end if;

    -- 3b. (iii) Week-bounds preflight against the SHEET's week. Rejecting before any write keeps
    --     0168's all-or-nothing guarantee (no partial draft). `u.entry_date is null` is explicit:
    --     a missing key compares as NULL, which is not TRUE, so a two-sided comparison alone would
    --     let it through to surface as a bare 23502 not-null violation instead of this reason.
    select count(*) into v_bad_date
      from jsonb_to_recordset(p_upserts) as u(entry_date date)
     where u.entry_date is null
        or u.entry_date < v_sheet_week
        or u.entry_date > (v_sheet_week + 6);
    if v_bad_date > 0 then
      raise exception 'entry_date is outside the timesheet week (%)',
        to_char(v_sheet_week, 'YYYY-MM-DD') using errcode = '23514';
    end if;

    insert into public.timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours, notes)
    select v_org, v_sheet_id, u.project_id, u.entry_date, u.hours, u.notes
      from jsonb_to_recordset(p_upserts)
             as u(project_id uuid, entry_date date, hours numeric, notes text)
    on conflict (timesheet_id, project_id, entry_date)
      do update set hours = excluded.hours, notes = excluded.notes;
  end if;

  -- 4. Deletes — pinned to entries on the RESOLVED (own) sheet, so a caller can never
  --    delete another sheet's rows by passing foreign ids (they simply match nothing).
  if array_length(p_delete_ids, 1) is not null then
    delete from public.timesheet_entries
     where id = any(p_delete_ids) and timesheet_id = v_sheet_id;
  end if;

  return v_sheet_id;
end; $$;

revoke all     on function save_timesheet_week(uuid, date, jsonb, uuid[]) from public;
grant  execute on function save_timesheet_week(uuid, date, jsonb, uuid[]) to   authenticated;
revoke execute on function save_timesheet_week(uuid, date, jsonb, uuid[]) from anon;
