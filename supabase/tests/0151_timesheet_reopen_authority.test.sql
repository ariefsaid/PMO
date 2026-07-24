-- 0151_timesheet_reopen_authority.test.sql
-- AC-TSC-020 / AC-TSC-021 (Slice A): the `Approved → Draft` re-open authority + the legal map.
--
-- What this proves:
--   (a) `Approved → Draft` is a legal edge and it flips the status.
--   (b) the line manager M (an Engineer-role one — proves the path does NOT need a privileged role)
--       is admitted.
--   (c) Admin A (break-glass, not the owner) is admitted.
--   (d) the sheet's OWNER U is rejected with 42501 (SoD: an approver never re-opens their own sheet).
--   (e) an unrelated bystander B is rejected with 42501.
--   (f) Admin break-glass CANNOT re-open their OWN sheet — 42501 (proves the SoD check is ordered
--       BEFORE the role/manager check: an Admin WOULD pass the approver matrix, so a 42501 here can
--       only come from the owner-first ordering).
--   (g) `Rejected → Draft` stays OWNER-ONLY (the existing arm is narrowed, not widened): a manager
--       cannot rework a Rejected sheet; only the owner can.
--   (h) the four PMO states stay exactly four (FR-TSC-001 / NFR-TSC-REG-001).
--   (i) the `Submitted → Approved` arm is byte-for-byte: approved_by/approved_at are stamped.
--
-- Each actor operates on its OWN independent `Approved` fixture (the r1 NOTE: a shared sheet would
-- make A's call land on a sheet M already flipped to Draft — the AUTHORITY outcome, not a sequencing
-- artifact, is what is asserted). The precondition (FENCE 2) admits here because these sheets have
-- NO mirror row and NO outbox row (the un-pushed, non-ERPNext-org case — FR-TSC-060); the
-- precondition itself is exhaustively proven in 0151_timesheet_reopen_precondition.test.sql.
begin;
select plan(17);

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01510000-0000-0000-0000-000000000001','TS Reopen Authority Org');

insert into auth.users (id, email) values
  ('01510000-0000-0000-0000-0000000000a1','reopen-owner-u@example.com'),
  ('01510000-0000-0000-0000-0000000000a2','reopen-mgr-m@example.com'),
  ('01510000-0000-0000-0000-0000000000a3','reopen-admin-a@example.com'),
  ('01510000-0000-0000-0000-0000000000a4','reopen-bystander-b@example.com');

-- U = the owner (Engineer); M = U's line manager (Engineer-role — not privileged); A = Admin;
-- B = an unrelated in-org bystander (Engineer, manages no one, not U's manager).
insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01510000-0000-0000-0000-0000000000a1','01510000-0000-0000-0000-000000000001',
   'Owner U','reopen-owner-u@example.com','Engineer','01510000-0000-0000-0000-0000000000a2'),
  ('01510000-0000-0000-0000-0000000000a2','01510000-0000-0000-0000-000000000001',
   'Manager M','reopen-mgr-m@example.com','Engineer', null),
  ('01510000-0000-0000-0000-0000000000a3','01510000-0000-0000-0000-000000000001',
   'Admin A','reopen-admin-a@example.com','Admin', null),
  ('01510000-0000-0000-0000-0000000000a4','01510000-0000-0000-0000-000000000001',
   'Bystander B','reopen-bystander-b@example.com','Engineer', null);

-- Each actor's OWN Approved sheet (independent fixtures — the r1 NOTE fix). No mirror / outbox row ⇒
-- the un-pushed admit branch (FR-TSC-060) applies for the approver/Admin admit cases.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01510000-0000-0000-0000-000000000010','01510000-0000-0000-0000-000000000001',
   '01510000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01510000-0000-0000-0000-0000000000a2', now()),  -- sheet_m: M re-opens
  ('01510000-0000-0000-0000-000000000011','01510000-0000-0000-0000-000000000001',
   '01510000-0000-0000-0000-0000000000a1','2026-06-08','Approved',
   '01510000-0000-0000-0000-0000000000a2', now()),  -- sheet_a: A re-opens
  ('01510000-0000-0000-0000-000000000012','01510000-0000-0000-0000-000000000001',
   '01510000-0000-0000-0000-0000000000a1','2026-06-15','Approved',
   '01510000-0000-0000-0000-0000000000a2', now()),  -- sheet_u: U (owner) re-opens → 42501
  ('01510000-0000-0000-0000-000000000013','01510000-0000-0000-0000-000000000001',
   '01510000-0000-0000-0000-0000000000a1','2026-06-22','Approved',
   '01510000-0000-0000-0000-0000000000a2', now()),  -- sheet_b: B (bystander) re-opens → 42501
  ('01510000-0000-0000-0000-000000000014','01510000-0000-0000-0000-000000000001',
   '01510000-0000-0000-0000-0000000000a3','2026-06-29','Approved',
   '01510000-0000-0000-0000-0000000000a2', now());  -- sheet_own_admin: A re-opens OWN → 42501

-- A Rejected sheet owned by U (the (g) Rejected→Draft-stays-owner-only guard).
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01510000-0000-0000-0000-000000000015','01510000-0000-0000-0000-000000000001',
   '01510000-0000-0000-0000-0000000000a1','2026-07-06','Rejected',
   '01510000-0000-0000-0000-0000000000a2', now());

-- A Submitted sheet owned by U (the (i) byte-for-byte stamps guard).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('01510000-0000-0000-0000-000000000016','01510000-0000-0000-0000-000000000001',
   '01510000-0000-0000-0000-0000000000a1','2026-07-13','Submitted');

-- ── (a)+(b) line manager M (Engineer-role) re-opens sheet_m → Draft ─────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000010','Draft') $$,
  'AC-TSC-020: line manager M (Engineer-role) is admitted to re-open an Approved sheet');
reset role;
select is(
  (select status from timesheets where id = '01510000-0000-0000-0000-000000000010'),
  'Draft'::timesheet_status,
  'AC-TSC-021: Approved→Draft is a legal edge and flips the status');

-- ── (c) Admin A (break-glass, not the owner) re-opens sheet_a → Draft ──────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000011','Draft') $$,
  'AC-TSC-020: Admin A (break-glass, ≠ owner) is admitted to re-open an Approved sheet');
reset role;
select is(
  (select status from timesheets where id = '01510000-0000-0000-0000-000000000011'),
  'Draft'::timesheet_status,
  'AC-TSC-021: Admin re-open flips the status to Draft');

-- ── (d) the owner U re-opens their OWN Approved sheet → 42501 (SoD) ────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000012','Draft') $$,
  '42501', null,
  'AC-TSC-020: the owner cannot re-open their own Approved sheet (42501)');
reset role;
select is(
  (select status from timesheets where id = '01510000-0000-0000-0000-000000000012'),
  'Approved'::timesheet_status,
  'AC-TSC-020: the rejected-owner sheet stays Approved');

-- ── (e) an unrelated bystander B re-opens → 42501 ─────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000013','Draft') $$,
  '42501', null,
  'AC-TSC-020: an unrelated bystander cannot re-open an Approved sheet (42501)');
reset role;
select is(
  (select status from timesheets where id = '01510000-0000-0000-0000-000000000013'),
  'Approved'::timesheet_status,
  'AC-TSC-020: the bystander-targeted sheet stays Approved');

-- ── (f) Admin break-glass CANNOT re-open their OWN sheet → 42501 (SoD-ordered) ─
-- A is Admin, so A WOULD pass the approver matrix; a 42501 here can only come from the owner-first
-- SoD check firing before the role/manager check (FR-TSC-021).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000014','Draft') $$,
  '42501', null,
  'AC-TSC-021: Admin break-glass cannot re-open their OWN sheet (SoD is ordered before role)');
reset role;
select is(
  (select status from timesheets where id = '01510000-0000-0000-0000-000000000014'),
  'Approved'::timesheet_status,
  'AC-TSC-021: the Admin-own sheet stays Approved');

-- ── (g) `Rejected → Draft` stays OWNER-ONLY (the existing arm is narrowed, not widened) ──
-- A line manager (who CAN re-open an Approved sheet) must NOT be able to rework a Rejected sheet —
-- that arm remains owner-only (FR-TS-006 byte-for-byte).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000015','Draft') $$,
  '42501', null,
  'AC-TSC-021: Rejected→Draft stays owner-only — a manager cannot rework a Rejected sheet');
reset role;
-- The owner CAN rework their own Rejected sheet (byte-for-byte with 0007).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000015','Draft') $$,
  'AC-TSC-021: the owner CAN rework their own Rejected sheet (Rejected→Draft unchanged)');
reset role;
select is(
  (select status from timesheets where id = '01510000-0000-0000-0000-000000000015'),
  'Draft'::timesheet_status,
  'AC-TSC-021: the owner-reworked Rejected sheet is now Draft');

-- ── (i) `Submitted → Approved` arm is byte-for-byte (approved_by/approved_at stamped) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01510000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01510000-0000-0000-0000-000000000016','Approved') $$,
  'AC-TSC-021: Submitted→Approved arm unchanged (lives_ok)');
reset role;
select is(
  (select approved_by from timesheets where id = '01510000-0000-0000-0000-000000000016'),
  '01510000-0000-0000-0000-0000000000a2'::uuid,
  'AC-TSC-021: Submitted→Approved stamps approved_by = the approver (byte-for-byte)');
select is(
  (select approved_at is not null from timesheets where id = '01510000-0000-0000-0000-000000000016'),
  true,
  'AC-TSC-021: Submitted→Approved stamps approved_at atomically (byte-for-byte)');

-- ── (h) the four PMO states stay exactly four (FR-TSC-001 / NFR-TSC-REG-001) ──
select is(
  (select array_agg(enumlabel order by enumsortorder)::text[] from pg_enum e join pg_type t on e.enumtypid=t.oid
    where t.typname='timesheet_status'),
  array['Draft','Submitted','Approved','Rejected'],
  'AC-TSC-021: the timesheet_status enum stays exactly {Draft,Submitted,Approved,Rejected} — no new status');

select * from finish();
rollback;
