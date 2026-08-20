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
  -- ⚑ RE-BASELINED at 0198, and the ORACLE IS UNWEAKENED — the same treatment 0179 got below, for
  -- the same reason. `locale`/`number_locale`/`timezone` are a LOCAL user preference (FR-L10N-002):
  -- nothing reads `external_domain_ownership`, no adapter, no outbox, so flipping the org still
  -- changes nothing about them. Any column NOT in this list — an ERP-driven one included — still
  -- fails this assertion, which is the AC's goal. The list is the oracle; growing it deliberately is
  -- not the same as loosening it, and a `like`/count check would have been the weakening.
  'avatar_url,company_id,created_at,email,full_name,id,locale,location,manager_id,number_locale,org_id,role,skills,status,timezone,title,updated_at,utilization',
  'AC-TSP-004: profiles column set unchanged on a flipped org (0198 preference columns included)');

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
-- ⚑ The expected set changed at 0179 and the ORACLE IS UNWEAKENED. `profiles_admin_write` (FOR ALL)
-- was split into `profiles_admin_insert` + `profiles_admin_delete` (both byte-for-byte the old
-- Admin-only predicate) + `profiles_hierarchy_update` (ADR-0070's rank rule) — a local authorization
-- change with no ERP input: none of the three reads `external_domain_ownership`, calls an adapter or
-- touches the outbox, so flipping the org still changes nothing about them. Any policy NOT in this
-- list — an ERP-driven one included — still fails this assertion, which is the AC's goal.
select is(
  (select string_agg(policyname, ',' order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  -- 0198 adds `profiles_locale_self_only` — a RESTRICTIVE policy narrowing who may write the three
  -- preference columns. Local authorization again: no ERP input, so the flip-inertness claim holds.
  'profiles_admin_delete,profiles_admin_insert,profiles_hierarchy_update,profiles_locale_self_only,profiles_select,profiles_update_self',
  'AC-TSP-004: profiles RLS policy names unchanged on a flipped org (0198 restrictive policy included)');

-- ⚑ These two assert the trigger NAME SET, not a count (changed 0172). A count answers "how many
-- triggers exist", which is not the question — the question is "did the integration attach anything to
-- this module". A name set answers exactly that: any trigger not listed here fails the test and has to
-- be justified, and an ERP-driven trigger (sync/mirror/outbox) would still fail it, so the AC's goal is
-- unweakened — while a purely local invariant guard can be admitted by NAME rather than by relaxing the
-- oracle. `timesheet{s,_entries}_week_bounds` (0172) bind entry_date to the sheet's own week; they read
-- nothing outside these two tables and are inert to `external_domain_ownership`.
-- `timesheets_origination_guard` + `timesheets_audit_insert` (0174) are admitted on the same terms:
-- the first refuses a client-role INSERT that is not at the origination status (a local SoD invariant
-- on this one table), the second writes an audit_events row for the create. Neither reads
-- `external_domain_ownership`, calls an adapter, or touches the outbox — flipping the org changes
-- nothing about either.
-- (`information_schema.triggers` yields one row per event, hence `distinct`.)
select is(
  (select string_agg(distinct trigger_name, ',' order by trigger_name)
     from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'timesheets'),
  'timesheets_audit_insert,timesheets_origination_guard,timesheets_stamp_org_id,timesheets_week_start_bounds',
  'AC-TSP-004: no ERP-driven trigger on timesheets (org_id stamp + the local week-bounds, origination and audit guards only)');
select is(
  (select string_agg(distinct trigger_name, ',' order by trigger_name)
     from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'timesheet_entries'),
  'timesheet_entries_stamp_org_id,timesheet_entries_week_bounds',
  'AC-TSP-004: no ERP-driven trigger on timesheet_entries (org_id stamp + the local week-bounds guard only)');

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

-- Slice A (migration 0151) RETIRED the P3b "no re-open path" fence (spec §1: this issue is the thing
-- that fence deferred; FR-TSC-001): `Approved → Draft` is now a legal, GLOBAL transition — the approver
-- population may re-open an Approved sheet that has no confirmed ERP document. This is NOT smuggled in
-- by the integration flip: it is a global map change, so it behaves IDENTICALLY flipped or unflipped —
-- which is the invariant this test guards (the flip is inert to the approval module). M (the line
-- manager, ≠ owner) re-opens U's Approved sheet; the sheet has no mirror / outbox row so the
-- un-pushed admit branch (FR-TSC-060) applies. (The race-safe precondition itself is proven in
-- 0151_timesheet_reopen_precondition.test.sql.)
select lives_ok(
  $$ select transition_timesheet(
       (select id from timesheets where user_id = '0aac0000-0000-0000-0000-0000000000a1'
          and week_start_date = '2026-02-02'), 'Draft') $$,
  'AC-TSP-004 / AC-TSC-021: the approver may re-open an Approved sheet on a flipped org (the Slice-A Approved→Draft edge is global; the flip stays inert)');
reset role;

select * from finish();
rollback;
