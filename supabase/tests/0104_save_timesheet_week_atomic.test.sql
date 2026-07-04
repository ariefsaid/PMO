-- 0104_save_timesheet_week_atomic.test.sql
-- Reliability harden #1 — atomic timesheet-week save (migration 0055_save_timesheet_week.sql).
--
-- The Save was three separate FE writes (create-draft → upsert → delete). A mid-op failure
-- left a PARTIAL commit. save_timesheet_week() does all three in ONE transaction, all-or-nothing,
-- while re-asserting the ownership/tenancy/Draft guards RLS (0011) enforces.
--
-- Proofs:
--   1. Happy path: create-draft + upsert + delete in one call → correct final state.
--   2. Atomicity: a mid-op failure (a cell violating the hours<=24 CHECK) rolls back EVERYTHING —
--      the just-created draft AND the earlier upserts leave NO partial state.
--   3. SoD/tenancy preserved: a foreign-org project in the upserts is rejected (42501),
--      and again NO draft/entries persist.
--   4. Delete-pinning: foreign entry ids passed to p_delete_ids do NOT touch another sheet's rows.
begin;
select plan(8);

-- Fixtures (as table owner; RLS not enforced for owner).
insert into organizations (id, name) values
  ('01040000-0000-0000-0000-000000000001','TS Save Org A'),
  ('01040000-0000-0000-0000-000000000002','TS Save Org B');

insert into auth.users (id, email) values
  ('01040000-0000-0000-0000-0000000000a1','eng-a@example.com'),
  ('01040000-0000-0000-0000-0000000000b1','eng-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01040000-0000-0000-0000-0000000000a1','01040000-0000-0000-0000-000000000001','Eng A','eng-a@example.com','Engineer'),
  ('01040000-0000-0000-0000-0000000000b1','01040000-0000-0000-0000-000000000002','Eng B','eng-b@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('01040000-0000-0000-0000-0000000000f1','01040000-0000-0000-0000-000000000001','Proj A','Active'),
  ('01040000-0000-0000-0000-0000000000f2','01040000-0000-0000-0000-000000000002','Proj B (foreign org)','Active');

-- A pre-existing sheet + entry owned by Eng B (used for the delete-pinning proof).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('01040000-0000-0000-0000-0000000000d2','01040000-0000-0000-0000-000000000002',
   '01040000-0000-0000-0000-0000000000b1','2026-06-01','Draft');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('01040000-0000-0000-0000-0000000000e2','01040000-0000-0000-0000-000000000002',
   '01040000-0000-0000-0000-0000000000d2','01040000-0000-0000-0000-0000000000f2','2026-06-01', 5);

-- Act as Eng A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01040000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── Proof 1: happy path — create draft + upsert two cells, delete none ──────────────
select lives_ok(
  $$ select save_timesheet_week(
       null, '2026-06-08'::date,
       '[{"project_id":"01040000-0000-0000-0000-0000000000f1","entry_date":"2026-06-08","hours":8,"notes":"mon"},
         {"project_id":"01040000-0000-0000-0000-0000000000f1","entry_date":"2026-06-09","hours":6,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  'harden #1: save_timesheet_week creates the Draft + upserts in one call');

select is(
  (select count(*)::int from timesheets t
     where t.user_id = '01040000-0000-0000-0000-0000000000a1' and t.week_start_date = '2026-06-08'),
  1, 'harden #1: exactly one Draft sheet was created for the week');

select is(
  (select count(*)::int from timesheet_entries e
     join timesheets t on t.id = e.timesheet_id
    where t.user_id = '01040000-0000-0000-0000-0000000000a1' and t.week_start_date = '2026-06-08'),
  2, 'harden #1: both upserted cells persisted');

-- ── Proof 2: atomicity — a mid-op failure rolls back the whole call ─────────────────
-- The second cell violates the hours<=24 CHECK, which fires DURING the insert (after the
-- draft was created in the same call). All-or-nothing ⇒ NO new draft, NO entries.
select throws_ok(
  $$ select save_timesheet_week(
       null, '2026-06-15'::date,
       '[{"project_id":"01040000-0000-0000-0000-0000000000f1","entry_date":"2026-06-15","hours":8,"notes":null},
         {"project_id":"01040000-0000-0000-0000-0000000000f1","entry_date":"2026-06-16","hours":99,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '23514', null,
  'harden #1: a cell violating hours<=24 aborts the whole save (CHECK 23514)');

select is(
  (select count(*)::int from timesheets t
     where t.user_id = '01040000-0000-0000-0000-0000000000a1' and t.week_start_date = '2026-06-15'),
  0, 'harden #1 ATOMICITY: the mid-op failure left NO partial draft for the week');

-- ── Proof 3: tenancy/SoD preserved — foreign-org project rejected, nothing persists ─
select throws_ok(
  $$ select save_timesheet_week(
       null, '2026-06-22'::date,
       '[{"project_id":"01040000-0000-0000-0000-0000000000f2","entry_date":"2026-06-22","hours":4,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  '42501', null,
  'harden #1: an upsert onto a foreign-org project is rejected (42501)');

select is(
  (select count(*)::int from timesheets t
     where t.user_id = '01040000-0000-0000-0000-0000000000a1' and t.week_start_date = '2026-06-22'),
  0, 'harden #1: the rejected save left NO partial draft');

-- ── Proof 4: delete-pinning — foreign entry ids cannot delete another sheet's rows ──
-- Eng A saves their own week and passes Eng B's entry id in p_delete_ids. It matches
-- nothing on Eng A's resolved sheet, so Eng B's row survives (no cross-sheet delete).
select save_timesheet_week(
  null, '2026-06-29'::date, '[]'::jsonb,
  array['01040000-0000-0000-0000-0000000000e2']::uuid[]);
reset role;
select is(
  (select count(*)::int from timesheet_entries where id = '01040000-0000-0000-0000-0000000000e2'),
  1, 'harden #1: foreign entry id in p_delete_ids does NOT delete another sheet''s row');

select * from finish();
rollback;
