-- 0151_timesheet_push_insert_recheck.test.sql
-- AC-TSC-R2 — the FENCE-2 push-side guard: `insert_timesheet_outbox_pending` serializes the
-- timesheet push INSERT against a concurrent re-open (the SAME named per-timesheet advisory lock as
-- the `Approved→Draft` arm) and RE-VERIFIES the sheet is still `Approved` immediately before
-- inserting. This is the residual-race fix: a SYNC push that passed its dispatch gate read but has
-- not yet inserted, concurrent with a re-open, must NOT create an ERP document for a sheet the
-- re-open just opened.
--
-- What this proves:
--   (a) on an `Approved` sheet the insert SUCCEEDS and persists a `pending` row (happy path intact);
--   (b) on a `Draft` sheet (a re-open flipped it) the insert RAISES `P0001
--       'timesheet-no-longer-approved'` BEFORE inserting — no orphan row, no POST, no reconcile loop;
--   (c) on a `Submitted` sheet it also raises (only Approved may receive a push insert);
--   (d) after a successful insert, `transition_timesheet(sheet,'Draft')` from the approver RAISES
--       `P0001 'reopen-push-in-flight'` — the re-open sees the `pending` row. This proves the two
--       sides observe each other: insert-wins ⇒ re-open sees `pending` ⇒ refuses.
--
-- Whichever side wins the named lock, the other sees its effect — so the double-count (PMO `Draft`
-- while ERP holds a live doc) is structurally unreachable.
begin;
select plan(8);

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01513000-0000-0000-0000-000000000001','TS Push Insert Recheck Org');

insert into auth.users (id, email) values
  ('01513000-0000-0000-0000-0000000000a1','pushins-owner@example.com'),
  ('01513000-0000-0000-0000-0000000000a2','pushins-mgr@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01513000-0000-0000-0000-0000000000a1','01513000-0000-0000-0000-000000000001',
   'Owner U','pushins-owner@example.com','Engineer','01513000-0000-0000-0000-0000000000a2'),
  ('01513000-0000-0000-0000-0000000000a2','01513000-0000-0000-0000-000000000001',
   'Manager M','pushins-mgr@example.com','Engineer', null);

insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01513000-0000-0000-0000-000000000010','01513000-0000-0000-0000-000000000001',
   '01513000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01513000-0000-0000-0000-0000000000a2', now()),   -- (a) insert succeeds + persists pending
  ('01513000-0000-0000-0000-000000000011','01513000-0000-0000-0000-000000000001',
   '01513000-0000-0000-0000-0000000000a1','2026-06-08','Draft',
   null, null),                                       -- (b) insert raises (no longer Approved)
  ('01513000-0000-0000-0000-000000000012','01513000-0000-0000-0000-000000000001',
   '01513000-0000-0000-0000-0000000000a1','2026-06-15','Submitted',
   null, null),                                       -- (c) insert raises (not Approved)
  ('01513000-0000-0000-0000-000000000013','01513000-0000-0000-0000-000000000001',
   '01513000-0000-0000-0000-0000000000a1','2026-06-22','Approved',
   '01513000-0000-0000-0000-0000000000a2', now());    -- (d) insert then re-open sees the pending row

-- ── (a) on an Approved sheet the insert SUCCEEDS and persists a pending row ─
-- (Call as the test runner; the RPC is security definer so caller role is irrelevant to its reads.)
select lives_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01513000-0000-0000-0000-000000000001'::uuid,
       p_domain:='timesheets',
       p_record_id:='01513000-0000-0000-0000-000000000010',
       p_key:='ts-ins-a',
       p_tier:='erpnext',
       p_operation:='create',
       p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'AC-TSC-R2(a): insert_timesheet_outbox_pending on an Approved sheet lives');
select is(
  (select count(*)::int from public.external_command_outbox
     where org_id='01513000-0000-0000-0000-000000000001' and domain='timesheets'
       and pmo_record_id='01513000-0000-0000-0000-000000000010' and state='pending'),
  1,
  'AC-TSC-R2(a): exactly one pending outbox row was persisted for the Approved sheet');

-- ── (b) on a Draft sheet the insert RAISES timesheet-no-longer-approved (no row) ──
select throws_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01513000-0000-0000-0000-000000000001'::uuid,
       p_domain:='timesheets',
       p_record_id:='01513000-0000-0000-0000-000000000011',
       p_key:='ts-ins-b',
       p_tier:='erpnext',
       p_operation:='create',
       p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'P0001', 'timesheet-no-longer-approved',
  'AC-TSC-R2(b): insert on a Draft sheet (re-open flipped it) raises timesheet-no-longer-approved');
select is(
  (select count(*)::int from public.external_command_outbox
     where org_id='01513000-0000-0000-0000-000000000001' and domain='timesheets'
       and pmo_record_id='01513000-0000-0000-0000-000000000011'),
  0,
  'AC-TSC-R2(b): NO orphan outbox row is left for the Draft sheet');

-- ── (c) on a Submitted sheet the insert also raises ────────────────────────
select throws_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01513000-0000-0000-0000-000000000001'::uuid,
       p_domain:='timesheets',
       p_record_id:='01513000-0000-0000-0000-000000000012',
       p_key:='ts-ins-c',
       p_tier:='erpnext',
       p_operation:='create',
       p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'P0001', 'timesheet-no-longer-approved',
  'AC-TSC-R2(c): insert on a Submitted sheet raises timesheet-no-longer-approved');

-- ── (d) a successful insert is then OBSERVED by the re-open precondition ───
-- First: the push insert succeeds on the Approved sheet_d (mirrors a sync push that just won the lock).
select lives_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01513000-0000-0000-0000-000000000001'::uuid,
       p_domain:='timesheets',
       p_record_id:='01513000-0000-0000-0000-000000000013',
       p_key:='ts-ins-d',
       p_tier:='erpnext',
       p_operation:='create',
       p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'AC-TSC-R2(d) setup: the push insert on sheet_d (Approved) succeeds');
-- Then: the approver M re-opens → the precondition SEES the pending row → reopen-push-in-flight.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01513000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01513000-0000-0000-0000-000000000013','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R2(d): after a push insert, the re-open sees the pending row and refuses with reopen-push-in-flight');
reset role;
select is(
  (select status from timesheets where id = '01513000-0000-0000-0000-000000000013'),
  'Approved'::timesheet_status,
  'AC-TSC-R2(d): the in-flight-push sheet stays Approved');

select * from finish();
rollback;
