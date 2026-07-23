-- 0151_timesheet_claim_guard.test.sql
-- AC-TSC-R5 (Luna code review BLOCK 1, the `failed`-row half) — THE CLAIM IS GUARDED TOO.
--
-- Slice A deliberately ADMITS a re-open while a `failed` push row exists (a rejected push minted no ERP
-- document). The plan asserted such a row "is therefore never re-driven". That is FALSE: BOTH the
-- foreground retry and the sweep reach `dispatchMoneyWrite`, which SKIPS insertion when a row already
-- exists and goes straight to `claim_outbox_for_commit` — and that claim had no timesheet status check
-- and took no lock. So a gate read that saw `Approved` could claim and POST the original 40 hours AFTER
-- the re-open committed `Draft`; the corrected 32 are pushed later ⇒ 72 hours on the client's project.
--
-- The insert-side guard cannot close this: there is no insert on this path. The claim itself must enter
-- the same named lock and re-check the status, in ONE transaction.
--
-- What this proves (fixtures built by the SHIPPED writers — the guard RPC mints the row, and the
-- `failed` state is written by the same guarded `state='failed'` update `markOutboxFailed` issues):
--   (a) an Approved sheet's failed row still claims — the retry/backstop path is intact;
--   (b) ⚑ THE MONEY ORACLE: after the shipped `transition_timesheet(...,'Draft')` re-open, the claim
--       REFUSES `timesheet-no-longer-approved` and the row is left unclaimed (no POST, no second doc);
--   (c) the guarded claim holds the CANONICAL `ts-correct:` advisory lock — the same one the re-open
--       takes — so the check and the claim are one serialized critical section, not two reads;
--   (d) every other domain's claim is byte-for-byte unchanged (no lock, no status coupling).
begin;
select plan(10);

insert into organizations (id, name) values
  ('01515000-0000-0000-0000-000000000001','TS Claim Guard Org');

insert into auth.users (id, email) values
  ('01515000-0000-0000-0000-0000000000a1','claimg-owner@example.com'),
  ('01515000-0000-0000-0000-0000000000a2','claimg-mgr@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01515000-0000-0000-0000-0000000000a1','01515000-0000-0000-0000-000000000001',
   'Owner U','claimg-owner@example.com','Engineer','01515000-0000-0000-0000-0000000000a2'),
  ('01515000-0000-0000-0000-0000000000a2','01515000-0000-0000-0000-000000000001',
   'Manager M','claimg-mgr@example.com','Engineer', null);

insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01515000-0000-0000-0000-000000000010','01515000-0000-0000-0000-000000000001',
   '01515000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01515000-0000-0000-0000-0000000000a2', '2026-06-01 09:00:00+00'),  -- (a) stays Approved → claimable
  ('01515000-0000-0000-0000-000000000011','01515000-0000-0000-0000-000000000001',
   '01515000-0000-0000-0000-0000000000a1','2026-06-08','Approved',
   '01515000-0000-0000-0000-0000000000a2', '2026-06-08 09:00:00+00'),  -- (b) re-opened below → claim must refuse
  ('01515000-0000-0000-0000-000000000012','01515000-0000-0000-0000-000000000001',
   '01515000-0000-0000-0000-0000000000a1','2026-06-15','Approved',
   '01515000-0000-0000-0000-0000000000a2', '2026-06-15 09:00:00+00');  -- (c) the lock-identity probe

-- ⚑ Every timesheet command's key carries its approval GENERATION (`ts:<uuid>:<approved_at>`,
-- migration 0151 §A2): both fences compare that witness against the sheet's CURRENT `approved_at`
-- and fail closed without one. So these fixtures use the SHIPPED key derivation — a made-up key
-- would be refused as a stale generation and the property under test would never be reached.
-- Both outbox rows are minted by the SHIPPED push-side writer, then driven to `failed` exactly as
-- `markOutboxFailed` does (the guarded state write the ERP rejection path issues).
select public.insert_timesheet_outbox_pending(
  p_org:='01515000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
  p_record_id:='01515000-0000-0000-0000-000000000010',
  p_key:='ts:01515000-0000-0000-0000-000000000010:2026-06-01 09:00:00+00',
  p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null);
select public.insert_timesheet_outbox_pending(
  p_org:='01515000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
  p_record_id:='01515000-0000-0000-0000-000000000011',
  p_key:='ts:01515000-0000-0000-0000-000000000011:2026-06-08 09:00:00+00',
  p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null);
update public.external_command_outbox
   set state = 'failed', last_error = 'activity-type-unconfigured'
 where pmo_record_id in ('01515000-0000-0000-0000-000000000010','01515000-0000-0000-0000-000000000011');

-- (c) the lock-identity probe's row is inserted DIRECTLY, on purpose: a row minted by
-- `insert_timesheet_outbox_pending` in THIS transaction would already be holding that sheet's
-- `ts-correct:` lock, so the pg_locks assertion below could not tell the CLAIM's lock from the MINT's.
-- (A row created by the service-role writer in an earlier transaction is exactly this shape.)
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01515000-0000-0000-0000-000000000001','timesheets','01515000-0000-0000-0000-000000000012',
   'ts:01515000-0000-0000-0000-000000000012:2026-06-15 09:00:00+00','erpnext','create','failed');

-- (d) an unrelated domain's row — the generic claim must be untouched by the timesheets guard.
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01515000-0000-0000-0000-000000000001','procurement','PO-OPAQUE-KEY-NOT-A-UUID',
   'pr-claimg-d','erpnext','create','pending');

-- ── (a) an Approved sheet's failed row is still claimable (the retry path is intact) ──
select is(
  (select state from public.claim_outbox_for_commit(
     (select id from public.external_command_outbox where pmo_record_id = '01515000-0000-0000-0000-000000000010'))),
  'committing',
  'AC-TSC-R5(a): a failed row for a still-Approved sheet is claimed as usual (retry/backstop intact)');

-- ── (c) the guarded claim holds the CANONICAL ts-correct lock ──────────────
select is(
  (select count(*)::int from pg_locks l
     where l.locktype = 'advisory'
       and l.pid = pg_backend_pid()
       and (l.classid::bigint << 32 | l.objid::bigint)
           = hashtextextended('ts-correct:01515000-0000-0000-0000-000000000012', 0)),
  0,
  'AC-TSC-R5(c) baseline: nothing holds that sheet''s lock before the claim');
select is(
  (select state from public.claim_outbox_for_commit(
     (select id from public.external_command_outbox where pmo_record_id = '01515000-0000-0000-0000-000000000012'))),
  'committing',
  'AC-TSC-R5(c) setup: the probe row claims (its sheet is Approved)');
select is(
  (select count(*)::int from pg_locks l
     where l.locktype = 'advisory'
       and l.pid = pg_backend_pid()
       and (l.classid::bigint << 32 | l.objid::bigint)
           = hashtextextended('ts-correct:01515000-0000-0000-0000-000000000012', 0)),
  1,
  'AC-TSC-R5(c): the timesheets claim holds the same per-sheet advisory lock the re-open takes');

-- ── (b) THE MONEY ORACLE — re-open (shipped RPC) then try to claim ─────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01515000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01515000-0000-0000-0000-000000000011','Draft') $$,
  'AC-TSC-R5(b) setup: a failed push does not block the re-open (Slice A admits it — AC-TSC-012)');
reset role;
select is(
  (select status from timesheets where id = '01515000-0000-0000-0000-000000000011'),
  'Draft'::timesheet_status,
  'AC-TSC-R5(b) setup: the sheet is now Draft — ERP must never hear about the old generation again');

select throws_ok(
  $$ select public.claim_outbox_for_commit(
       (select id from public.external_command_outbox where pmo_record_id = '01515000-0000-0000-0000-000000000011')) $$,
  'P0001', 'timesheet-no-longer-approved',
  'AC-TSC-R5(b): the claim on a re-opened sheet REFUSES — the stale failed row can never be re-driven');
select is(
  (select state from public.external_command_outbox where pmo_record_id = '01515000-0000-0000-0000-000000000011'),
  'failed',
  'AC-TSC-R5(b): the row is left unclaimed (no committing, no attempt) — nothing is POSTed');
select is(
  (select attempt_count from public.external_command_outbox where pmo_record_id = '01515000-0000-0000-0000-000000000011'),
  0,
  'AC-TSC-R5(b): the refused claim consumed no attempt — the refusal is before the critical section');

-- ── (d) every other domain claims exactly as before ────────────────────────
select is(
  (select state from public.claim_outbox_for_commit(
     (select id from public.external_command_outbox where idempotency_key = 'pr-claimg-d'))),
  'committing',
  'AC-TSC-R5(d): a non-timesheets row (opaque, non-uuid pmo_record_id) claims byte-for-byte as before');

select * from finish();
rollback;
