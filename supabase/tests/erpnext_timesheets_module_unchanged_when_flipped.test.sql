-- erpnext_timesheets_module_unchanged_when_flipped.test.sql
-- AC-TSP-004 (FR-TSP-004(ii), ADR-0059 Posture B, spec §13) — P3b's single most important test.
--
-- Unlike P2/P3a's `companies`/`procurement`/`revenue` domains, PMO is the SoT for timesheet ENTRY AND
-- APPROVAL. There is deliberately NO per-command RLS flip for `timesheets`/`timesheet_entries`/`profiles`
-- (migration 0136's docstring: "DO NOT add `alter table public.timesheets` / `public.timesheet_entries` /
-- `public.profiles`"). This test is the regression proof of that invariant: flipping an org's `timesheets`
-- domain to externally-owned (via `external_domain_ownership`, the SAME mechanism `companies` uses) must
-- change **nothing** about the shipped timesheet module's schema, RLS, or behavior — every existing client
-- keeps the exact module they have today, byte-for-byte.
--
-- Modelled on `erpnext_companies_flip_rls.test.sql` (the per-table flip proof pattern) with the crucial
-- CONTRAST: `companies` asserts native writes are DENIED while flipped; this asserts the timesheets module
-- is COMPLETELY INERT to the flip — no schema drift, no RLS drift, no behavior drift at all.
begin;
select plan(16);

-- ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('0aac0000-0000-0000-0000-000000000001','AC-TSP-004 Org A (flipped on timesheets)');

insert into auth.users (id, email) values
  ('0aac0000-0000-0000-0000-0000000000a1','u-flip@example.com'),
  ('0aac0000-0000-0000-0000-0000000000a2','m-flip@example.com'),
  ('0aac0000-0000-0000-0000-0000000000a3','x-flip@example.com');

-- M is U's line manager (an Engineer-role one — the shipped 0007 A2/A4 posture).
insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('0aac0000-0000-0000-0000-0000000000a2','0aac0000-0000-0000-0000-000000000001','Mgr Flip','m-flip@example.com','Engineer', null),
  ('0aac0000-0000-0000-0000-0000000000a1','0aac0000-0000-0000-0000-000000000001','User Flip','u-flip@example.com','Engineer','0aac0000-0000-0000-0000-0000000000a2'),
  ('0aac0000-0000-0000-0000-0000000000a3','0aac0000-0000-0000-0000-000000000001','Bystander Flip','x-flip@example.com','Engineer', null);

insert into projects (id, org_id, name, status) values
  ('0aac0000-0000-0000-0000-000000000030','0aac0000-0000-0000-0000-000000000001','AC-TSP-004 Project','Ongoing Project');

-- ⚑ THE FLIP — the exact same mechanism `companies` uses (0087's table; no `timesheets`-specific code
-- reads it anywhere in the codebase, which is precisely what this test proves).
insert into external_domain_ownership (org_id, external_tier, domain)
values ('0aac0000-0000-0000-0000-000000000001','erpnext','timesheets');

-- ── A) No schema drift: column set, policy names, and triggers are EXACTLY the pre-P3b set ─────────
-- (FR-TSP-004(ii) — migration 0136 must never `alter table` any of these three; this is the proof.)
select is(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns where table_schema = 'public' and table_name = 'timesheets'),
  'approved_at,approved_by,id,org_id,status,submitted_at,user_id,week_start_date',
  'AC-TSP-004: timesheets column set unchanged on a flipped org');
select is(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_entries'),
  'entry_date,hours,id,notes,org_id,project_id,timesheet_id',
  'AC-TSP-004: timesheet_entries column set unchanged on a flipped org');
select is(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.columns where table_schema = 'public' and table_name = 'profiles'),
  'avatar_url,company_id,created_at,email,full_name,id,location,manager_id,org_id,role,skills,status,title,updated_at,utilization',
  'AC-TSP-004: profiles column set unchanged on a flipped org');

select is(
  (select string_agg(policyname, ',' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'timesheets'),
  'timesheets_insert,timesheets_select,timesheets_update_own',
  'AC-TSP-004: timesheets RLS policy names unchanged on a flipped org (no new flip policy)');
select is(
  (select string_agg(policyname, ',' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'timesheet_entries'),
  'timesheet_entries_select,timesheet_entries_write',
  'AC-TSP-004: timesheet_entries RLS policy names unchanged on a flipped org');
select is(
  (select string_agg(policyname, ',' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  'profiles_admin_write,profiles_select,profiles_update_self',
  'AC-TSP-004: profiles RLS policy names unchanged on a flipped org');

select is(
  (select count(*)::int from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'timesheets'),
  1, 'AC-TSP-004: no new trigger on timesheets (still just the org_id stamp)');
select is(
  (select count(*)::int from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'timesheet_entries'),
  1, 'AC-TSP-004: no new trigger on timesheet_entries (still just the org_id stamp)');

-- ── B) Behavior parity — the shipped assertions re-run under a FLIPPED org ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0aac0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- U inserts an own-draft timesheet via the atomic RPC (0011/0055 write path) — succeeds.
select lives_ok(
  $$ select save_timesheet_week(null, '2026-02-02',
       '[{"project_id":"0aac0000-0000-0000-0000-000000000030","entry_date":"2026-02-02","hours":4,"notes":null}]'::jsonb,
       '{}'::uuid[]) $$,
  'AC-TSP-004: U inserts an own-draft timesheet_entries row on a flipped org (0011 WITH CHECK unweakened)');

select is(
  (select count(*)::int from timesheets
    where user_id = '0aac0000-0000-0000-0000-0000000000a1' and week_start_date = '2026-02-02'),
  1, 'AC-TSP-004: save_timesheet_week is atomic and created exactly one sheet on a flipped org');

-- U reads their own row.
select is(
  (select count(*)::int from timesheets
    where user_id = '0aac0000-0000-0000-0000-0000000000a1' and week_start_date = '2026-02-02'),
  1, 'AC-TSP-004: U reads their own timesheet on a flipped org');

-- Submit (owner-only, FR-TS-004): succeeds.
select lives_ok(
  $$ select transition_timesheet(
       (select id from timesheets where user_id = '0aac0000-0000-0000-0000-0000000000a1'
          and week_start_date = '2026-02-02'), 'Submitted') $$,
  'AC-TSP-004: U submits their own Draft sheet on a flipped org (unchanged)');
reset role;

-- M (the manager) reads U's now-Submitted sheet (0007 A2 read-widening) — unchanged on a flipped org.
set local role authenticated;
set local request.jwt.claims = '{"sub":"0aac0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select count(*)::int from timesheets
    where user_id = '0aac0000-0000-0000-0000-0000000000a1' and week_start_date = '2026-02-02'),
  1, 'AC-TSP-004: the line manager reads U''s submitted sheet on a flipped org (0007 A2 unchanged)');
reset role;

-- SoD still bites: U (self) may never approve their own sheet — even flipped, the rule is unweakened.
set local role authenticated;
set local request.jwt.claims = '{"sub":"0aac0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet(
       (select id from timesheets where user_id = '0aac0000-0000-0000-0000-0000000000a1'
          and week_start_date = '2026-02-02'), 'Approved') $$,
  '42501', null,
  'AC-TSP-004: SoD still bites on a flipped org — U cannot approve their own sheet (P3b must not weaken it)');
reset role;

-- M approves — succeeds, unchanged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"0aac0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet(
       (select id from timesheets where user_id = '0aac0000-0000-0000-0000-0000000000a1'
          and week_start_date = '2026-02-02'), 'Approved') $$,
  'AC-TSP-004: the line manager approves U''s sheet on a flipped org (unchanged)');

-- The map is unchanged — no re-open path was smuggled in (spec §13 / OQ-TSP-6): Approved -> Draft is illegal.
select throws_ok(
  $$ select transition_timesheet(
       (select id from timesheets where user_id = '0aac0000-0000-0000-0000-0000000000a1'
          and week_start_date = '2026-02-02'), 'Draft') $$,
  'P0001', null,
  'AC-TSP-004: an illegal Approved->Draft transition still P0001s on a flipped org (no re-open path smuggled in)');
reset role;

select * from finish();
rollback;
