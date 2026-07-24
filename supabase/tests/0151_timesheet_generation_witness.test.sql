-- 0151_timesheet_generation_witness.test.sql
-- AC-TSC-R7 (Luna round-2 BLOCK 1) — THE FENCE KEYS ON THE APPROVAL GENERATION, NOT THE STATUS.
--
-- Every fence in this slice validated `status = 'Approved'`. Status is the wrong unit of safety: after
-- one correction cycle the sheet is `Approved` AGAIN — a DIFFERENT generation, the same status. So a
-- command that was decided on generation T1 (a paused sweep pass, a foreground retry of a `failed` T1
-- row) passes a status check after T2 has been approved, and POSTs the ORIGINAL hours; T2's corrected
-- hours are pushed too. That is the exact double-count this slice exists to prevent, walking in through
-- a door the status check left open. Luna reproduced it: with a `failed` T1 row, running
-- `Approved → Draft → Submitted → Approved` and then claiming returned `state = committing`.
--
-- `timesheets.approved_at` is the generation witness — deliberately retained across `Approved → Draft`
-- and REPLACED on the next approval (0151 §A) — and it is carried on every command: the deterministic
-- key is `ts:<uuid>:<approved_at>` and the payload repeats it. So BOTH fences compare the command's
-- persisted witness against the sheet's CURRENT `approved_at`, and FAIL CLOSED when a row carries no
-- witness at all (an old/forged row cannot prove which generation it belongs to).
--
-- What this proves, with fixtures built by the SHIPPED writers and generations advanced by the SHIPPED
-- `transition_timesheet` RPC:
--   (a) the CURRENT generation's insert still succeeds — the ordinary push is untouched;
--   (b) ⚑ MONEY ORACLE (insert): after `Draft → Submitted → Approved` (T2), a T1-witness insert REFUSES;
--   (c) ⚑ MONEY ORACLE (claim): after the same cycle, the claim of a stale `failed` T1 row REFUSES and
--       the row is left unclaimed — Luna's exact reproduction, now closed;
--   (d) the CURRENT generation's failed row still claims (retry/backstop intact across a re-approval);
--   (e) FAIL CLOSED: a row whose key carries no witness (a pre-0151 / hand-written row) cannot claim;
--   (f) an insert whose key carries no witness is refused before any row is written;
--   (g) every other domain is untouched (no witness coupling).
begin;
select plan(12);

insert into organizations (id, name) values
  ('01517000-0000-0000-0000-000000000001','TS Generation Witness Org (R7)');

insert into auth.users (id, email) values
  ('01517000-0000-0000-0000-0000000000a1','genw-owner@example.com'),
  ('01517000-0000-0000-0000-0000000000a2','genw-mgr@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01517000-0000-0000-0000-0000000000a1','01517000-0000-0000-0000-000000000001',
   'Owner U','genw-owner@example.com','Engineer','01517000-0000-0000-0000-0000000000a2'),
  ('01517000-0000-0000-0000-0000000000a2','01517000-0000-0000-0000-000000000001',
   'Manager M','genw-mgr@example.com','Engineer', null);

-- T1's witness is an EXPLICIT past instant: `now()` is frozen for the whole transaction, so a witness
-- stamped `now()` here would be indistinguishable from the one the re-approval below stamps — the test
-- would pass for the wrong reason.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01517000-0000-0000-0000-000000000010','01517000-0000-0000-0000-000000000001',
   '01517000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01517000-0000-0000-0000-0000000000a2', now() - interval '1 day'),   -- (a)(b) the insert-side sheet
  ('01517000-0000-0000-0000-000000000011','01517000-0000-0000-0000-000000000001',
   '01517000-0000-0000-0000-0000000000a1','2026-06-08','Approved',
   '01517000-0000-0000-0000-0000000000a2', now() - interval '1 day'),   -- (c) the stale-claim sheet
  ('01517000-0000-0000-0000-000000000012','01517000-0000-0000-0000-000000000001',
   '01517000-0000-0000-0000-0000000000a1','2026-06-15','Approved',
   '01517000-0000-0000-0000-0000000000a2', now() - interval '1 day'),   -- (d) still-current sheet
  ('01517000-0000-0000-0000-000000000013','01517000-0000-0000-0000-000000000001',
   '01517000-0000-0000-0000-0000000000a1','2026-06-22','Approved',
   '01517000-0000-0000-0000-0000000000a2', now() - interval '1 day'),   -- (e) the witness-less claim probe
  ('01517000-0000-0000-0000-000000000014','01517000-0000-0000-0000-000000000001',
   '01517000-0000-0000-0000-0000000000a1','2026-06-29','Approved',
   '01517000-0000-0000-0000-0000000000a2', now() - interval '1 day');   -- (f) the witness-less insert probe

-- The T1 command for sheet …11, minted by the SHIPPED writer with the SHIPPED key derivation, then
-- driven to `failed` exactly as `markOutboxFailed` does. Slice A admits a re-open while it exists.
select public.insert_timesheet_outbox_pending(
  p_org:='01517000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
  p_record_id:='01517000-0000-0000-0000-000000000011',
  p_key:=(select 'ts:01517000-0000-0000-0000-000000000011:' || approved_at::text
            from timesheets where id = '01517000-0000-0000-0000-000000000011'),
  p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null);
update public.external_command_outbox
   set state = 'failed', last_error = 'activity-type-unconfigured'
 where domain = 'timesheets' and pmo_record_id = '01517000-0000-0000-0000-000000000011';

-- ── (a) the CURRENT generation inserts as usual ────────────────────────────
select lives_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01517000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
       p_record_id:='01517000-0000-0000-0000-000000000010',
       p_key:=(select 'ts:01517000-0000-0000-0000-000000000010:' || approved_at::text
                 from timesheets where id = '01517000-0000-0000-0000-000000000010'),
       p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'AC-TSC-R7(a): a command carrying the sheet''s CURRENT witness inserts — the ordinary push is untouched');

-- The T1 keys are captured BEFORE the correction cycle: this is precisely what a paused sweep pass or a
-- foreground retry still holds after the sheet has moved on.
create temporary table t1_witness on commit drop as
  select id, 'ts:' || id::text || ':' || approved_at::text as key from timesheets
   where id in ('01517000-0000-0000-0000-000000000010','01517000-0000-0000-0000-000000000011');

-- ── the CORRECTION CYCLE (the shipped RPC, both sheets): Approved → Draft → Submitted → Approved ──
-- The insert-side sheet's own T1 row is removed first: a `pending` row would (correctly) block its
-- re-open, and the case under test is the one Slice A ADMITS.
delete from external_command_outbox where pmo_record_id = '01517000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"01517000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_timesheet('01517000-0000-0000-0000-000000000010','Draft');
select transition_timesheet('01517000-0000-0000-0000-000000000011','Draft');
set local request.jwt.claims = '{"sub":"01517000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select transition_timesheet('01517000-0000-0000-0000-000000000010','Submitted');
select transition_timesheet('01517000-0000-0000-0000-000000000011','Submitted');
set local request.jwt.claims = '{"sub":"01517000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_timesheet('01517000-0000-0000-0000-000000000010','Approved');
select transition_timesheet('01517000-0000-0000-0000-000000000011','Approved');
reset role;

select is(
  (select status from timesheets where id = '01517000-0000-0000-0000-000000000011'),
  'Approved'::timesheet_status,
  'AC-TSC-R7 setup: the corrected sheet is APPROVED again — same status, DIFFERENT generation');
select isnt(
  (select 'ts:' || id::text || ':' || approved_at::text from timesheets
     where id = '01517000-0000-0000-0000-000000000011'),
  (select key from t1_witness where id = '01517000-0000-0000-0000-000000000011'),
  'AC-TSC-R7 setup: the T2 approval stamped a NEW witness — the stale T1 command''s key is no longer current');

-- ── (b) MONEY ORACLE — the paused T1 insert after T2 was approved ──────────
select throws_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01517000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
       p_record_id:='01517000-0000-0000-0000-000000000010',
       p_key:=(select key from t1_witness where id = '01517000-0000-0000-0000-000000000010'),
       p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'P0001', 'timesheet-approval-superseded',
  'AC-TSC-R7(b): a T1-witness insert after the T2 approval REFUSES — the old hours are never queued');
select is(
  (select count(*)::int from external_command_outbox where pmo_record_id = '01517000-0000-0000-0000-000000000010'),
  0,
  'AC-TSC-R7(b): nothing was written — the refusal is before the insert, so no row wedges the next push');

-- ── (c) MONEY ORACLE — the stale failed T1 row after T2 was approved ───────
select throws_ok(
  $$ select public.claim_outbox_for_commit(
       (select id from public.external_command_outbox
          where pmo_record_id = '01517000-0000-0000-0000-000000000011')) $$,
  'P0001', 'timesheet-approval-superseded',
  'AC-TSC-R7(c): the stale T1 failed row cannot be claimed after re-approval — Luna''s reproduction, closed');
select is(
  (select state from external_command_outbox where pmo_record_id = '01517000-0000-0000-0000-000000000011'),
  'failed',
  'AC-TSC-R7(c): the stale row is left unclaimed — no committing, nothing POSTed');
select is(
  (select attempt_count from external_command_outbox where pmo_record_id = '01517000-0000-0000-0000-000000000011'),
  0,
  'AC-TSC-R7(c): the refused claim consumed no attempt — it refuses before the critical section');

-- ── (d) the CURRENT generation's failed row still claims ───────────────────
select public.insert_timesheet_outbox_pending(
  p_org:='01517000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
  p_record_id:='01517000-0000-0000-0000-000000000012',
  p_key:=(select 'ts:01517000-0000-0000-0000-000000000012:' || approved_at::text
            from timesheets where id = '01517000-0000-0000-0000-000000000012'),
  p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null);
update public.external_command_outbox set state = 'failed'
 where pmo_record_id = '01517000-0000-0000-0000-000000000012';
select is(
  (select state from public.claim_outbox_for_commit(
     (select id from external_command_outbox where pmo_record_id = '01517000-0000-0000-0000-000000000012'))),
  'committing',
  'AC-TSC-R7(d): the CURRENT generation''s failed row still claims — retry/backstop intact');

-- ── (e)(f) FAIL CLOSED on a row/command with NO witness at all ─────────────
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01517000-0000-0000-0000-000000000001','timesheets','01517000-0000-0000-0000-000000000013',
   'ts-legacy-key-no-witness','erpnext','create','failed');
select throws_ok(
  $$ select public.claim_outbox_for_commit(
       (select id from external_command_outbox where idempotency_key = 'ts-legacy-key-no-witness')) $$,
  'P0001', 'timesheet-approval-superseded',
  'AC-TSC-R7(e): a row that carries NO witness cannot prove its generation — it FAILS CLOSED, never claims');
select throws_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01517000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
       p_record_id:='01517000-0000-0000-0000-000000000014', p_key:='ts-no-witness-at-all',
       p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null) $$,
  'P0001', 'timesheet-approval-superseded',
  'AC-TSC-R7(f): a witness-less command cannot be minted — the fence has nothing to compare and refuses');

-- ── (g) every other domain is untouched ────────────────────────────────────
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01517000-0000-0000-0000-000000000001','procurement','PO-OPAQUE-KEY-NOT-A-UUID',
   'pr-genw-g','erpnext','create','pending');
select is(
  (select state from public.claim_outbox_for_commit(
     (select id from external_command_outbox where idempotency_key = 'pr-genw-g'))),
  'committing',
  'AC-TSC-R7(g): a non-timesheets row (no witness anywhere) claims byte-for-byte as before');

select * from finish();
rollback;
