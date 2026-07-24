-- 0157_reopen_refuses_unknown_erp_outcome.test.sql
-- AC-TSC-R8 (Luna FU-1a round-8 BLOCK) — A RELEASE ANSWERS "CAN THE BACKSTOP RETRY THIS?", AND NOTHING
-- ELSE. It says nothing about whether ERPNext holds a Timesheet, so it must not open the re-open path.
--
-- ⚑ THE DEFECT THIS FILE PINS (reproduced end-to-end by round 8 against the migrated DB). A `held`
-- outbox + a `held` mirror mean the ERP submit SUCCEEDED and the read-back did not: PMO does not know
-- whether ERPNext holds a document for this week. `release_outbox_hold` (0152 §A) clears BOTH of those
-- states in ONE transaction — deliberately, so the backstop can re-drive — but it LEARNS NOTHING about
-- ERP. Before 0157 the re-open then saw `failed`/`failed`/no `ts_number` and ADMITTED, so a re-approve
-- minted a SECOND ERP Timesheet for the same week and the client's hours double-counted permanently
-- (the original command can never be adopted afterwards: `claim_outbox_for_commit` refuses a superseded
-- approval generation forever).
--
-- Two questions were conflated into one `held → failed` transition. 0157 separates them:
--   • "can the BACKSTOP retry this?"        → the release answers YES (mirror `failed` is its queue).
--   • "do we KNOW what ERP holds?"          → the release answers NOTHING, so `post_submit_unknown_at`
--                                             STAYS SET and the re-open keeps refusing.
-- The witness is cleared by exactly two things: learning a real `ts_number`, or an AUDITED Admin
-- attestation that ERPNext holds no Timesheet for this week.
begin;
select plan(14);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01570000-0000-0000-0000-00000000000a','Unknown Outcome Org');

insert into auth.users (id, email) values
  ('01570000-0000-0000-0000-0000000000a1','uo-owner@example.com'),
  ('01570000-0000-0000-0000-0000000000a2','uo-mgr@example.com'),
  ('01570000-0000-0000-0000-0000000000a3','uo-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01570000-0000-0000-0000-0000000000a1','01570000-0000-0000-0000-00000000000a',
   'Owner U','uo-owner@example.com','Engineer','01570000-0000-0000-0000-0000000000a2'),
  ('01570000-0000-0000-0000-0000000000a2','01570000-0000-0000-0000-00000000000a',
   'Manager M','uo-mgr@example.com','Engineer', null),
  ('01570000-0000-0000-0000-0000000000a3','01570000-0000-0000-0000-00000000000a',
   'Admin A','uo-admin@example.com','Admin', null);

insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01570000-0000-0000-0000-000000000010','01570000-0000-0000-0000-00000000000a',
   '01570000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01570000-0000-0000-0000-0000000000a2','2026-06-08 09:00:00+00');

-- The hold is produced by the SHIPPED writers, exactly as the recovery branch produces it: the fenced
-- mint → the shipped claim → `mark_outbox_held`, then the shipped `record_timesheet_command_held`
-- records the mirror outcome under the generation-exact CAS (round 7). Nothing is hand-written.
create table pg_temp.h (label text primary key, id uuid, gen int);
create function pg_temp.mint_held(p_label text, p_sheet uuid) returns void
  language plpgsql as $fn$
declare v_id uuid; v_gen int; v_key text;
begin
  v_key := 'ts:' || p_sheet::text || ':' || (select approved_at::text from public.timesheets where id = p_sheet);
  select id into v_id from public.insert_timesheet_outbox_pending(
    p_org := (select org_id from public.timesheets where id = p_sheet),
    p_domain := 'timesheets', p_record_id := p_sheet::text, p_key := v_key,
    p_tier := 'erpnext', p_operation := 'create', p_payload := null, p_digest := null, p_actor := null);
  select claim_generation into v_gen from public.claim_outbox_for_commit(v_id);
  if v_gen is null then raise exception 'fixture: the shipped claim refused %', p_sheet; end if;
  if public.mark_outbox_held(v_id, v_gen, 'recovery-probe-failed: deterministic') <> 1 then
    raise exception 'fixture: the shipped hold refused %', p_sheet;
  end if;
  insert into pg_temp.h values (p_label, v_id, v_gen);
end; $fn$;
grant select on pg_temp.h to authenticated;

select pg_temp.mint_held('h', '01570000-0000-0000-0000-000000000010');
select is(
  (select record_timesheet_command_held(
     '01570000-0000-0000-0000-00000000000a','01570000-0000-0000-0000-000000000010',
     '2026-06-08 09:00:00+00',
     'command-held: the recovery probe failed deterministically',
     (select id from pg_temp.h where label = 'h'), (select gen from pg_temp.h where label = 'h'))),
  'held',
  'AC-TSC-R8 fixture: the shipped recorder recorded the hold through the round-7 CAS');

-- ⚑ THE WITNESS. A `command-held` outcome means the submit reached ERPNext and its result was never
-- read back — a POST-SUBMIT UNKNOWN. That fact is now DURABLE on the mirror, independent of push_state.
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01570000-0000-0000-0000-000000000010'),
  null,
  'AC-TSC-R8: the held recorder stamps `post_submit_unknown_at` — the unknown ERP outcome is durable, not implied by push_state');

-- ── STATE A: before any release, the re-open is refused (round-4/round-5 behaviour, unchanged) ────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01570000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01570000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R8 STATE A: a live hold refuses the re-open');
reset role;

-- ── THE RELEASE: the operator's documented route back to the backstop ────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01570000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold((select id from pg_temp.h where label = 'h'), 'probe fixed; safe to re-drive') $$,
  'AC-TSC-R8: the Admin releases the hold');
reset role;

-- (a) THE RELEASE DOES ITS JOB — the backstop route is restored. Both rows are terminal `failed`, which
-- is exactly the state `listPendingTimesheetPushes` re-queues. Round 4's ask is intact.
select is(
  (select state from external_command_outbox where id = (select id from pg_temp.h where label = 'h')),
  'failed',
  'AC-TSC-R8: the release moved the OUTBOX to `failed` — the recovery route is open');
select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01570000-0000-0000-0000-000000000010'),
  'failed',
  'AC-TSC-R8: and the MIRROR to `failed` — the backstop queue (`pending`/`failed`) can re-drive it');

-- (b) ⚑ AND IT ANSWERS NOTHING ABOUT ERP. The witness survives the release: the release re-queued a
-- command, it did not go and look in ERPNext.
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01570000-0000-0000-0000-000000000010'),
  null,
  'AC-TSC-R8: `post_submit_unknown_at` SURVIVES the release — a release learns nothing about ERPNext');

-- ⚑ STATE B — THE BLOCK. Pre-0157 this admitted and flipped the sheet to Draft while ERPNext may hold a
-- live Timesheet; the re-approve then minted a second one and the week double-counted.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01570000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01570000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R8 STATE B: after the release the re-open STILL refuses — releasing for the backstop must not open the correction path while the ERP outcome is unknown');
reset role;

select is(
  (select status from timesheets where id = '01570000-0000-0000-0000-000000000010'),
  'Approved'::timesheet_status,
  'AC-TSC-R8 STATE B: the sheet stays Approved — no silent flip into a second push');

-- ── THE ROUTE OUT IS AN AUDITED ATTESTATION, NOT A RELEASE ───────────────────────────────────────
-- Only an Admin may attest, and only with a stated reason: this is a human asserting a fact about the
-- external system, so it is authorized and audited like any other money-adjacent operator action.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01570000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select attest_timesheet_no_erp_document('01570000-0000-0000-0000-000000000010','I looked') $$,
  '42501', 'not authorized',
  'AC-TSC-R8: a non-Admin approver cannot attest away an unknown ERP outcome');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01570000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select attest_timesheet_no_erp_document('01570000-0000-0000-0000-000000000010','   ') $$,
  'P0001', 'an attestation must state what was checked in ERPNext',
  'AC-TSC-R8: an attestation with no stated reason is refused — the audit row must say what was checked');
select lives_ok(
  $$ select attest_timesheet_no_erp_document('01570000-0000-0000-0000-000000000010',
       'checked ERPNext Timesheet list for employee/week: no document exists') $$,
  'AC-TSC-R8: the Admin attests that ERPNext holds no Timesheet for this week');

-- Only NOW does the fence lift, and the correction path opens.
select lives_ok(
  $$ select transition_timesheet('01570000-0000-0000-0000-000000000010','Draft') $$,
  'AC-TSC-R8: with the unknown resolved by attestation, the re-open ADMITS — the fence has a route out, it is not a dead end');
reset role;

select is(
  (select status from timesheets where id = '01570000-0000-0000-0000-000000000010'),
  'Draft'::timesheet_status,
  'AC-TSC-R8: the attested sheet actually flips to Draft');

select * from finish();
rollback;
