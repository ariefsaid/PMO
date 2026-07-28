-- 0165_timesheet_entry_date_bound_to_sheet_week.test.sql
--
-- 0168 claimed to clamp entry_date to "the timesheet's week". It does not. Two independent holes:
--
--   (A) THE RPC BOUNDS AGAINST AN ARGUMENT, NOT THE SHEET. 0168:70 loads the resolved sheet with
--       `select user_id, status, org_id into ...` — it never reads week_start_date — and the guard at
--       0168:98-105 bounds entry_date against `p_week_start_date`, a caller-controlled argument. On the
--       p_timesheet_id-is-not-null path (the FE's normal edit path: src/lib/db/timesheets.ts sends the
--       sheet id and the week as two INDEPENDENT client-supplied args) nothing ties the argument to the
--       sheet. save_timesheet_week(S /* week of 2026-06-08 */, '2026-05-04', [{entry_date:'2026-05-06'}])
--       passes the guard and lands May hours on a June sheet — exactly the corruption 0168's header
--       claims to close. `grant execute … to authenticated` makes it reachable over PostgREST with no FE.
--   (B) A DEFINER-FUNCTION GUARD CANNOT PROTECT A DIRECTLY-WRITABLE TABLE. 0075:255-256 grants
--       INSERT/UPDATE on public.timesheet_entries to `authenticated`, and timesheet_entries_write
--       (0018/0021) has NO entry_date predicate — only org / role / own-Draft-sheet / project-org. So
--       `POST /rest/v1/timesheet_entries {timesheet_id: <own draft>, entry_date: '2020-01-01'}` writes
--       straight through, whatever the RPC does.
--
-- Downstream this is money, not cosmetics: the grid indexes cells by `project|entry_date` over the
-- sheet's 7 days (src/lib/timesheet-edit.ts), so an out-of-week row has NO cell to render in — an
-- approver approves hours they cannot see — and 0138_approved_timesheet_for_push carries entry_date
-- verbatim into the client's ERPNext Timesheet, posting payroll costing into the wrong period.
--
-- The invariant this file pins, for EVERY writer: an entry's entry_date lies in
-- [its sheet's week_start_date, +6]. Proof 10 asserts it as a whole-database oracle.
--
-- ⚑ Why 0161 shipped green over the live defect: all five of its calls pass `null` for p_timesheet_id,
-- so the RPC creates the sheet FROM p_week_start_date and argument == sheet week by construction. None
-- of them exercise the reachable path. Every call below that targets the RPC passes a REAL sheet id.
-- Every rejection asserts the MESSAGE TEXT, not just the errcode — this repo has shipped "proofs" that
-- stayed green with the guard deleted because a neighbouring constraint raised the same errcode.
--
-- RED against 0168: proofs 1, 2, 4, 6, 8, 9, 10, 11 fail (the writes are accepted, or raise the wrong
-- errcode/message); proof 12 then finds the rows those calls left behind.
begin;
select plan(12);

-- ── Fixtures (as table owner; RLS is not enforced for the owner) ────────────────────────────
insert into organizations (id, name) values
  ('01650000-0000-0000-0000-000000000001','TS Week Binding Org');

insert into auth.users (id, email) values
  ('01650000-0000-0000-0000-0000000000a1','weekbind-eng@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01650000-0000-0000-0000-0000000000a1','01650000-0000-0000-0000-000000000001',
   'WeekBind Eng','weekbind-eng@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('01650000-0000-0000-0000-0000000000f1','01650000-0000-0000-0000-000000000001',
   'WeekBind Proj','Ongoing Project');

-- Three own Draft sheets on DISTINCT weeks (timesheets is unique on (user_id, week_start_date)):
--   S1 week 2026-06-08 → the RPC proofs;  S2 week 2026-06-15 → the direct-write proofs;
--   S3 week 2026-06-22 → the parent-side proof (it owns an in-week entry from the start).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('01650000-0000-0000-0000-00000000a001','01650000-0000-0000-0000-000000000001',
   '01650000-0000-0000-0000-0000000000a1','2026-06-08','Draft'),
  ('01650000-0000-0000-0000-00000000a002','01650000-0000-0000-0000-000000000001',
   '01650000-0000-0000-0000-0000000000a1','2026-06-15','Draft'),
  ('01650000-0000-0000-0000-00000000a003','01650000-0000-0000-0000-000000000001',
   '01650000-0000-0000-0000-0000000000a1','2026-06-22','Draft');

insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('01650000-0000-0000-0000-0000000000e3','01650000-0000-0000-0000-000000000001',
   '01650000-0000-0000-0000-00000000a003','01650000-0000-0000-0000-0000000000f1','2026-06-22',8);

-- Act as the sheets' owner (an Engineer — the role timesheet_entries_write admits).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01650000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- A. THE RPC — the week must come from the SHEET, and a mismatched argument must not be honoured
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── Proof 1: THE HEADLINE EXPLOIT. S1 is the week of 2026-06-08; the caller declares 2026-05-04
--    and dates the entry 2026-05-06 — consistent with the ARGUMENT, five weeks off the SHEET.
--    Under 0168 this is accepted (2026-05-06 ∈ [2026-05-04, 2026-05-10]) and 24h land on the June
--    sheet. It must be refused, and refused as a bad ARGUMENT (22023), not merely clamped.
select throws_ok(
  $$ select save_timesheet_week(
       '01650000-0000-0000-0000-00000000a001'::uuid, '2026-05-04'::date,
       '[{"project_id":"01650000-0000-0000-0000-0000000000f1","entry_date":"2026-05-06","hours":24,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '22023',
  'p_week_start_date 2026-05-04 does not match the timesheet week 2026-06-08',
  'RPC: a p_week_start_date that disagrees with the resolved sheet is REFUSED (22023), not honoured');

-- ── Proof 2: the same mismatch with an entry_date that is valid for the SHEET. This is the proof
--    that binds the raise itself rather than the bounds arithmetic: reading week_start_date from the
--    sheet alone would silently ACCEPT this call (the entry is in-week), so a "clamp only" fix leaves
--    the caller's declared week and the sheet's week disagreeing on a write that succeeded.
select throws_ok(
  $$ select save_timesheet_week(
       '01650000-0000-0000-0000-00000000a001'::uuid, '2026-05-04'::date,
       '[{"project_id":"01650000-0000-0000-0000-0000000000f1","entry_date":"2026-06-10","hours":8,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '22023',
  'p_week_start_date 2026-05-04 does not match the timesheet week 2026-06-08',
  'RPC: the mismatch is refused even when the entry_date IS in the sheet week (no silent honouring)');

-- ── Proof 3: argument agrees with the sheet, but the entry_date is out of that week → the bounds
--    guard still fires on the existing-sheet path (0161 only ever exercised the create path).
select throws_ok(
  $$ select save_timesheet_week(
       '01650000-0000-0000-0000-00000000a001'::uuid, '2026-06-08'::date,
       '[{"project_id":"01650000-0000-0000-0000-0000000000f1","entry_date":"2026-06-01","hours":8,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '23514',
  'entry_date is outside the timesheet week (2026-06-08)',
  'RPC: an out-of-week entry_date on an EXISTING sheet is rejected (23514)');

-- ── Proof 4: NULL entry_date. `null < x or null > y` is NULL, so a row with no entry_date key is not
--    counted by a two-sided comparison and falls through to the column's not-null as 23502 — the same
--    three-valued-logic class as `NaN >= 0` being TRUE. It must be caught by the week guard itself.
select throws_ok(
  $$ select save_timesheet_week(
       '01650000-0000-0000-0000-00000000a001'::uuid, '2026-06-08'::date,
       '[{"project_id":"01650000-0000-0000-0000-0000000000f1","hours":8,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '23514',
  'entry_date is outside the timesheet week (2026-06-08)',
  'RPC: an upsert row with NO entry_date is caught by the week guard (23514), not the not-null (23502)');

-- ── Proof 5: NO OVER-BLOCKING. The legitimate FE call — real sheet id, matching week, in-week date —
--    still succeeds. A guard that rejects everything would satisfy proofs 1-4 and break the product.
select lives_ok(
  $$ select save_timesheet_week(
       '01650000-0000-0000-0000-00000000a001'::uuid, '2026-06-08'::date,
       '[{"project_id":"01650000-0000-0000-0000-0000000000f1","entry_date":"2026-06-10","hours":8,"notes":"legit"}]'::jsonb,
       '{}'::uuid[]) $$,
  'RPC: the legitimate in-week save on an existing sheet still succeeds');

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- B. THE DIRECT TABLE PATH — `authenticated` holds INSERT/UPDATE on timesheet_entries (0075)
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── Proof 6: the raw PostgREST insert the RPC guard cannot see. S2 is the week of 2026-06-15; the
--    row is dated 2026-06-01. Every timesheet_entries_write predicate is satisfied (own org, Engineer,
--    own Draft sheet, in-org project) — only the week binding can refuse it.
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
     values ('01650000-0000-0000-0000-000000000001','01650000-0000-0000-0000-00000000a002',
             '01650000-0000-0000-0000-0000000000f1','2026-06-01',24) $$,
  '23514',
  'entry_date 2026-06-01 is outside the timesheet week (2026-06-15 .. 2026-06-21)',
  'DIRECT INSERT: an out-of-week entry_date is rejected at the table (23514)');

-- ── Proof 7: NO OVER-BLOCKING on the direct path either — an in-week direct insert still lands.
select lives_ok(
  $$ insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours)
     values ('01650000-0000-0000-0000-0000000000e2','01650000-0000-0000-0000-000000000001',
             '01650000-0000-0000-0000-00000000a002',
             '01650000-0000-0000-0000-0000000000f1','2026-06-16',8) $$,
  'DIRECT INSERT: an in-week entry_date is still accepted');

-- ── Proof 8: UPDATE is the same hole as INSERT. Moving proof 7's legitimate row out of its sheet's
--    week must be refused too, or the guard is a one-statement detour.
select throws_ok(
  $$ update timesheet_entries set entry_date = '2026-07-01'
      where id = '01650000-0000-0000-0000-0000000000e2' $$,
  '23514',
  'entry_date 2026-07-01 is outside the timesheet week (2026-06-15 .. 2026-06-21)',
  'DIRECT UPDATE: moving an entry out of its sheet''s week is rejected (23514)');

-- ── Proof 9: THE PARENT SIDE. timesheets_update_own (0002/0021) lets the owner UPDATE their own Draft
--    sheet, and 0075 grants UPDATE on timesheets — so week_start_date is client-writable. Moving the
--    sheet's week under its entries produces the identical corruption from the other direction: S3's
--    2026-06-22 entry would sit outside a sheet relabelled week-of-2026-06-29.
select throws_ok(
  $$ update timesheets set week_start_date = '2026-06-29'
      where id = '01650000-0000-0000-0000-00000000a003' $$,
  '23514',
  'cannot change week_start_date: entries fall outside the new week (2026-06-29 .. 2026-07-05)',
  'PARENT SIDE: moving a sheet''s week out from under its entries is rejected (23514)');

-- ── Proof 10: the direct path's NULL case. Without an explicit null branch in the trigger,
--    `null < x or null > y` is NULL — not TRUE — so the row falls through to the column's not-null and
--    surfaces as a bare 23502 that never says which week it should have been in.
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
     values ('01650000-0000-0000-0000-000000000001','01650000-0000-0000-0000-00000000a002',
             '01650000-0000-0000-0000-0000000000f1', null, 8) $$,
  '23514',
  'entry_date is required and must fall in the timesheet week (2026-06-15 .. 2026-06-21)',
  'DIRECT INSERT: a NULL entry_date is named by the week guard (23514), not left to the not-null (23502)');

-- ── Proof 11: the guard must not fail OPEN when the parent cannot be read. If the lookup returns no
--    row and that is not named, v_week is NULL, every comparison is NULL, and the trigger admits the
--    row — leaving only the FK to catch it. The guard must refuse first, on its own terms.
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
     values ('01650000-0000-0000-0000-000000000001','01650000-0000-0000-0000-00000000dead',
             '01650000-0000-0000-0000-0000000000f1','2026-06-16',8) $$,
  'P0002',
  'timesheet not found',
  'DIRECT INSERT: an unresolvable parent sheet fails CLOSED in the guard, not open to the FK');

-- ── Proof 12: THE ORACLE. Not "did each call raise" but "is the invariant true of the database" —
--    including the seed. Any row a rejected call actually managed to write shows up here.
reset role;
select is(
  (select count(*)::int
     from timesheet_entries e join timesheets t on t.id = e.timesheet_id
    where e.entry_date < t.week_start_date or e.entry_date > t.week_start_date + 6),
  0,
  'ORACLE: no timesheet_entry anywhere lies outside its own sheet''s week');

select * from finish();
rollback;
