-- 0161_save_timesheet_week_entry_date_bounds.test.sql
-- Defect fix — save_timesheet_week() never clamped entry_date to the sheet's week.
--
-- 0055_save_timesheet_week.sql inserts each upsert row's `entry_date` straight from the
-- caller's jsonb with NO bound against p_week_start_date. So a caller could save entries
-- dated the prior week, next month, or any date — onto a sheet labelled for a specific
-- week. That corrupts weekly rollups (a "week of 2026-06-08" sheet silently carrying a
-- 2026-05-01 row) and is money-adjacent (timesheet hours → project cost).
--
-- This test pins the fix: entry_date MUST fall in [p_week_start_date, p_week_start_date + 6].
--   1. An entry BEFORE the week (week_start - 1) is rejected.
--   2. An entry AFTER the week (week_start + 7) is rejected.
--   3. The boundary day week_start + 6 (Sunday) is ACCEPTED (the week is inclusive 7 days).
--   4. The rejection is ATOMIC — a bad date aborts the whole call, leaving no partial draft
--      (same all-or-nothing guarantee the hours<=24 CHECK gives in 0106).
--
-- Errcode: the guard reuses 23514 — the CHECK-violation code the hours>24 path surfaces
-- (that CHECK lives on the table, not the function). The foreign-org project case raises
-- 42501, NOT 23514 — a different code, do not conflate. The FE's classifyMutationError has
-- no explicit 23514 branch; it lands in the generic "Update failed" bucket, same as
-- hours>24 — no new wire shape.
--
-- RED against unfixed code: today steps 1 + 2 pass (the bad dates are silently accepted).
begin;
select plan(5);

-- Fixtures (as table owner; RLS not enforced for owner). Prefix 0168 to avoid collision
-- with 0106's fixtures when both run in the same suite.
insert into organizations (id, name) values
  ('01680000-0000-0000-0000-000000000001','TS EntryDate Bounds Org');

insert into auth.users (id, email) values
  ('01680000-0000-0000-0000-0000000000a1','entrydate-eng@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01680000-0000-0000-0000-0000000000a1','01680000-0000-0000-0000-000000000001',
   'EntryDate Eng','entrydate-eng@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('01680000-0000-0000-0000-0000000000f1','01680000-0000-0000-0000-000000000001',
   'EntryDate Proj','Ongoing Project');

-- Act as the engineer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01680000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Each proof uses a DISTINCT week so a prior proof's successful Draft (proof 3) cannot
-- collide on timesheets(user_id, week_start_date) and mask the real assertion. The week
-- is always Mon..Sun inclusive (7 days); entry_date must fall in [start, start+6].

-- ── Proof 1: an entry dated the DAY BEFORE the week is rejected ─────────────────────
-- Week of 2026-06-08; entry dated 2026-06-07 (prior Sunday) is out of range.
select throws_ok(
  $$ select save_timesheet_week(
       null, '2026-06-08'::date,
       '[{"project_id":"01680000-0000-0000-0000-0000000000f1","entry_date":"2026-06-07","hours":8,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '23514', null,
  'entry_date before the sheet week is rejected (23514)');

-- ── Proof 2: an entry dated 7+ days after the week start is rejected ────────────────
-- Distinct week (2026-06-15); entry dated 2026-06-22 (week_start + 7) is out of range.
select throws_ok(
  $$ select save_timesheet_week(
       null, '2026-06-15'::date,
       '[{"project_id":"01680000-0000-0000-0000-0000000000f1","entry_date":"2026-06-22","hours":8,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '23514', null,
  'entry_date after the sheet week is rejected (23514)');

-- ── Proof 3: the boundary day week_start + 6 (Sunday) IS accepted ───────────────────
-- Distinct week (2026-06-29); entry on the 7th day (2026-07-05). The week is 7 inclusive
-- days, so the clamp must not be off-by-one at the upper edge.
select lives_ok(
  $$ select save_timesheet_week(
       null, '2026-06-29'::date,
       '[{"project_id":"01680000-0000-0000-0000-0000000000f1","entry_date":"2026-07-05","hours":4,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  'entry_date on the week''s last day (week_start + 6) is accepted');

-- ── Proof 4: the rejection is atomic — a bad-date call leaves no partial draft ──────
-- Proof 2's failed call (week 2026-06-15) must NOT have created a Draft for that week.
-- (Only the in-range proof 3 call should have created a sheet, for week 2026-06-29.)
reset role;
select is(
  (select count(*)::int from timesheets t
     where t.user_id = '01680000-0000-0000-0000-0000000000a1' and t.week_start_date = '2026-06-15'),
  0, 'ATOMICITY: the rejected bad-date call (proof 2) left no partial Draft for its week');
select is(
  (select count(*)::int from timesheets t
     where t.user_id = '01680000-0000-0000-0000-0000000000a1' and t.week_start_date = '2026-06-29'),
  1, 'ATOMICITY: the accepted in-range call (proof 3) did create its Draft');

select * from finish();
rollback;
