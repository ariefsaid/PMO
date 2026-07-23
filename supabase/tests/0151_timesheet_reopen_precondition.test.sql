-- 0151_timesheet_reopen_precondition.test.sql
-- AC-TSC-R1 (≈ scoped AC-TSC-008/009/010/012) — the race-safe "no confirmed ERP document"
-- precondition for `Approved → Draft` (FENCE 2). The precondition considers the MIRROR (a live doc ⇒
-- refuse) AND EVERY non-terminal outbox state (the after-commit-before-mirror seam + a bare pending),
-- serialized by the named per-timesheet advisory lock shared with the timesheet push insert.
--
-- This is the money boundary of Slice A (Luna review findings 1 & 2). The four refusal cases each have
-- a passing pgTAP assertion here:
--   (a) a LIVE mirror doc (ts_number set, erp_cancelled_at null)              → 'reopen-erp-document-held'
--   (b) a `committed` outbox row with NO mirror (the after-commit-before-mirror   → 'reopen-push-in-flight'
--       seam, Luna f1 — ERP may already hold T1 while the mirror is still empty)
--   (c) a bare `pending` outbox row, no mirror (Luna f2 — a queued push that can  → 'reopen-push-in-flight'
--       still be claimed and POSTed while the re-open commits)
--   (d) a `quarantined`/`held` outbox row                                       → 'reopen-push-in-flight'
-- And the two ADMIT cases:
--   (e) a `failed` outbox row + no mirror (push rejected, no doc ever reached ERP) → ADMITS (AC-TSC-012)
--   (f) no mirror + no outbox row (un-pushed, non-ERPNext org)                     → ADMITS (FR-TSC-060)
--
-- A REFUSAL is CORRECT behaviour, not a bug — it is the entry point for the deferred Slice B. If there
-- is any doubt ERP holds a document, this arm REFUSES. Fail closed.
begin;
select plan(17);

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01512000-0000-0000-0000-000000000001','TS Reopen Precondition Org');

insert into auth.users (id, email) values
  ('01512000-0000-0000-0000-0000000000a1','reopen-pc-owner@example.com'),
  ('01512000-0000-0000-0000-0000000000a2','reopen-pc-mgr@example.com');

-- U = owner; M = U's line manager (Engineer-role — the approver who re-opens in every case).
insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01512000-0000-0000-0000-0000000000a1','01512000-0000-0000-0000-000000000001',
   'Owner U','reopen-pc-owner@example.com','Engineer','01512000-0000-0000-0000-0000000000a2'),
  ('01512000-0000-0000-0000-0000000000a2','01512000-0000-0000-0000-000000000001',
   'Manager M','reopen-pc-mgr@example.com','Engineer', null);

-- Seven independent Approved sheets (owned by U, approved by M). Each exercises ONE precondition.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01512000-0000-0000-0000-000000000010','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01512000-0000-0000-0000-0000000000a2', now()),   -- (a) live mirror
  ('01512000-0000-0000-0000-000000000011','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-06-08','Approved',
   '01512000-0000-0000-0000-0000000000a2', now()),   -- (b) committed outbox, no mirror
  ('01512000-0000-0000-0000-000000000012','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-06-15','Approved',
   '01512000-0000-0000-0000-0000000000a2', now()),   -- (c) bare pending, no mirror
  ('01512000-0000-0000-0000-000000000013','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-06-22','Approved',
   '01512000-0000-0000-0000-0000000000a2', now()),   -- (d) quarantined
  ('01512000-0000-0000-0000-000000000014','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-06-29','Approved',
   '01512000-0000-0000-0000-0000000000a2', now()),   -- (d) held
  ('01512000-0000-0000-0000-000000000015','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-07-06','Approved',
   '01512000-0000-0000-0000-0000000000a2', now()),   -- (e) failed outbox, no mirror → ADMIT
  ('01512000-0000-0000-0000-000000000016','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-07-13','Approved',
   '01512000-0000-0000-0000-0000000000a2', now()),    -- (f) no mirror, no outbox → ADMIT
  ('01512000-0000-0000-0000-000000000017','01512000-0000-0000-0000-000000000001',
   '01512000-0000-0000-0000-0000000000a1','2026-07-20','Approved',
   '01512000-0000-0000-0000-0000000000a2', now());    -- (g) committing outbox, no mirror

-- (a) a LIVE mirror doc (ts_number set, erp_cancelled_at null). Inserted as the test owner (the
-- service-role writer's stand-in — migration 0136's pattern); the security-definer RPC reads it
-- bypassing RLS.
insert into timesheet_erp_mirror (org_id, timesheet_id, ts_number, push_state, erp_cancelled_at) values
  ('01512000-0000-0000-0000-000000000001','01512000-0000-0000-0000-000000000010',
   'TS-LIVE-0001','pushed', null);

-- (b) a `committed` outbox row with external_record_id set, NO mirror (the after-commit-before-mirror
-- seam — Luna f1: ERP already holds T1 while the mirror finalize has not run).
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, external_record_id) values
  ('01512000-0000-0000-0000-000000000001','timesheets','01512000-0000-0000-0000-000000000011',
   'tsc-pc-b','erpnext','create','committed','TS-SEAM-0002');

-- (c) a bare `pending` outbox row, NO mirror (Luna f2 — a queued push still claimable/POSTable).
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01512000-0000-0000-0000-000000000001','timesheets','01512000-0000-0000-0000-000000000012',
   'tsc-pc-c','erpnext','create','pending');

-- (d) a `quarantined` outbox row, NO mirror.
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01512000-0000-0000-0000-000000000001','timesheets','01512000-0000-0000-0000-000000000013',
   'tsc-pc-d1','erpnext','create','quarantined');

-- (d) a `held` outbox row, NO mirror.
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01512000-0000-0000-0000-000000000001','timesheets','01512000-0000-0000-0000-000000000014',
   'tsc-pc-d2','erpnext','create','held');

-- (g) a `committing` outbox row, NO mirror — a CLAIMED, IN-FLIGHT POST. The most dangerous state of
-- the five: the worker may be inside the ERPNext call at this instant, so ERP may hold a document that
-- no PMO row records yet. The predicate already lists it; without this fixture a mutation deleting
-- ONLY 'committing' from that list survives every other case here.
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01512000-0000-0000-0000-000000000001','timesheets','01512000-0000-0000-0000-000000000017',
   'tsc-pc-g','erpnext','create','committing');

-- (e) a `failed` outbox row, NO mirror (push rejected — no doc reached ERP; `failed` is terminal for
-- the inflight index, so it does NOT block the next generation).
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01512000-0000-0000-0000-000000000001','timesheets','01512000-0000-0000-0000-000000000015',
   'tsc-pc-e','erpnext','create','failed');

-- The re-open caller is always M (the approver). authz passes; the PRECONDITION is what is asserted.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── (a) LIVE mirror doc → 'reopen-erp-document-held' (AC-TSC-010 scoped) ───
select throws_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-erp-document-held',
  'AC-TSC-R1(a): a live ERP mirror doc (ts_number set, erp_cancelled_at null) refuses re-open with reopen-erp-document-held');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000010'),
  'Approved'::timesheet_status,
  'AC-TSC-R1(a): the live-doc sheet stays Approved');

-- ── (b) `committed` outbox, no mirror → 'reopen-push-in-flight' (Luna f1 seam) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000011','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R1(b): a committed outbox row with no mirror (after-commit-before-mirror seam) refuses with reopen-push-in-flight');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000011'),
  'Approved'::timesheet_status,
  'AC-TSC-R1(b): the committed-seam sheet stays Approved');

-- ── (c) bare `pending` outbox, no mirror → 'reopen-push-in-flight' (Luna f2) ─
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000012','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R1(c): a bare pending outbox row with no mirror refuses with reopen-push-in-flight (Luna f2)');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000012'),
  'Approved'::timesheet_status,
  'AC-TSC-R1(c): the bare-pending sheet stays Approved');

-- ── (d) `quarantined` outbox → 'reopen-push-in-flight' ─────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000013','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R1(d): a quarantined outbox row refuses re-open with reopen-push-in-flight');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000013'),
  'Approved'::timesheet_status,
  'AC-TSC-R1(d): the quarantined sheet stays Approved');

-- ── (d) `held` outbox → 'reopen-push-in-flight' ────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000014','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R1(d): a held outbox row refuses re-open with reopen-push-in-flight');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000014'),
  'Approved'::timesheet_status,
  'AC-TSC-R1(d): the held sheet stays Approved');

-- ── (e) `failed` outbox, no mirror → ADMITS (AC-TSC-012: push rejected, no doc) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000015','Draft') $$,
  'AC-TSC-012: a failed push (no doc reached ERP) ADMITS re-open — failed is terminal, it does not block');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000015'),
  'Draft'::timesheet_status,
  'AC-TSC-012: the failed-push sheet flips to Draft');

-- ── (f) no mirror, no outbox → ADMITS (FR-TSC-060: un-pushed, non-ERPNext org) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000016','Draft') $$,
  'AC-TSC-012 / FR-TSC-060: an un-pushed sheet (no mirror, no outbox) ADMITS re-open');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000016'),
  'Draft'::timesheet_status,
  'AC-TSC-012 / FR-TSC-060: the un-pushed sheet flips to Draft');
select is(
  (select approved_by from timesheets where id = '01512000-0000-0000-0000-000000000016'),
  '01512000-0000-0000-0000-0000000000a2'::uuid,
  'AC-TSC-012: Approved→Draft leaves approved_by as-is (no stamp churn, OD-TS-4-A)');

-- ── (g) a CLAIMED, IN-FLIGHT push (`committing`), no mirror → REFUSES ──
-- The worker may be inside the ERPNext POST right now, so ERP may already hold a document that no PMO
-- row records. Refusing is the only honest answer; admitting here is the double-count.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01512000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01512000-0000-0000-0000-000000000017','Draft') $$,
  'P0001', 'reopen-push-in-flight',
  'AC-TSC-R1: a `committing` (claimed, in-flight POST) outbox row REFUSES re-open');
reset role;
select is(
  (select status from timesheets where id = '01512000-0000-0000-0000-000000000017'),
  'Approved'::timesheet_status,
  'AC-TSC-R1: the in-flight sheet stays Approved — fail closed, never a silent flip');

select * from finish();
rollback;
