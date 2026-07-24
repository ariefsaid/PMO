-- 0158_hold_stamps_witness_at_creation.test.sql
-- AC-TSC-R10 (Luna FU-1a round-10 BLOCK) — THE WITNESS IS STAMPED WHERE THE HOLD IS BORN, so coverage is
-- by CONSTRUCTION rather than by enumerating producers.
--
-- ⚑ THE DEFECT THIS FILE PINS (reproduced end-to-end by round 10 against the migrated DB). 0157 made the
-- unknown ERP outcome durable, but it stamped the witness in the two DOWNSTREAM RECORDERS —
-- `record_timesheet_command_held` (reached only from the SERVED dispatch's best-effort
-- `recordTimesheetPushFailure`) and the sweep's LATER-tick park. The hold itself is created by
-- `money.markOutboxHeld` → `mark_outbox_held`, and when that runs under the SWEEP the `command-held`
-- throw is only `console.warn`'d: the sweep has NO mirror failure recorder at all. So a sweep-created
-- hold was fenced by nothing but the OUTBOX state — precisely the state `release_outbox_hold` clears:
--
--   mark_outbox_held -> outbox=held mirror=failed NO WITNESS
--   re-open refused  -> by the outbox alone
--   release          -> outbox=failed (0152 §A's mirror CAS is `where push_state='held'`, so on a
--                       `failed` mirror it matches 0 rows and the release learns nothing to preserve)
--   re-open ADMITTED with an unknown ERP outcome -> re-approve -> a SECOND ERPNext Timesheet for the week.
--
-- One producer is STRUCTURALLY sweep-exclusive: the `recovery-reissue-unauthorized` hold
-- (`dispatch.ts:391`) is wired only at `erpnext-sweep/index.ts:1793`, so that hold could NEVER stamp a
-- witness at the moment it occurred.
--
-- 0158 moves the stamp INTO `mark_outbox_held`, same statement, same transaction as the hold. Every
-- producer of a timesheets hold — present and future, served or sweep-driven — therefore witnesses the
-- unknown, and no recorder has to be reached for the money fence to be true.
--
-- ⚑ EVERY HOLD BELOW IS DRIVEN THE WAY THE SWEEP DRIVES IT: the shipped mint → the shipped claim →
-- `mark_outbox_held`, and `record_timesheet_command_held` IS NEVER CALLED. That is the whole point.
begin;
select plan(23);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01580000-0000-0000-0000-00000000000a','Hold Witness Org');

insert into auth.users (id, email) values
  ('01580000-0000-0000-0000-0000000000a1','hw-owner@example.com'),
  ('01580000-0000-0000-0000-0000000000a2','hw-mgr@example.com'),
  ('01580000-0000-0000-0000-0000000000a3','hw-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01580000-0000-0000-0000-0000000000a1','01580000-0000-0000-0000-00000000000a',
   'Owner W','hw-owner@example.com','Engineer','01580000-0000-0000-0000-0000000000a2'),
  ('01580000-0000-0000-0000-0000000000a2','01580000-0000-0000-0000-00000000000a',
   'Manager W','hw-mgr@example.com','Engineer', null),
  ('01580000-0000-0000-0000-0000000000a3','01580000-0000-0000-0000-00000000000a',
   'Admin W','hw-admin@example.com','Admin', null);

-- A: the sweep-driven `recovery-probe-failed` hold (the reproduction's sheet).
-- B: the STRUCTURALLY sweep-exclusive `recovery-reissue-unauthorized` hold.
-- C: the domain negative control (a `budget` hold on the same shaped id must touch no timesheet mirror).
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01580000-0000-0000-0000-000000000010','01580000-0000-0000-0000-00000000000a',
   '01580000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01580000-0000-0000-0000-0000000000a2','2026-06-08 09:00:00+00'),
  ('01580000-0000-0000-0000-000000000011','01580000-0000-0000-0000-00000000000a',
   '01580000-0000-0000-0000-0000000000a1','2026-06-08','Approved','01580000-0000-0000-0000-0000000000a2','2026-06-15 09:00:00+00'),
  ('01580000-0000-0000-0000-000000000012','01580000-0000-0000-0000-00000000000a',
   '01580000-0000-0000-0000-0000000000a1','2026-06-15','Approved','01580000-0000-0000-0000-0000000000a2','2026-06-22 09:00:00+00'),
  ('01580000-0000-0000-0000-000000000013','01580000-0000-0000-0000-00000000000a',
   '01580000-0000-0000-0000-0000000000a1','2026-06-22','Approved','01580000-0000-0000-0000-0000000000a2','2026-06-29 09:00:00+00');

create table pg_temp.h (label text primary key, id uuid, gen int);
grant select on pg_temp.h to authenticated;

-- The SWEEP's exact sequence, and nothing else: mint through the shipped guard, claim through the
-- shipped claim, hold through `mark_outbox_held`. NO `record_timesheet_command_held` — the sweep imports
-- only the SUCCESS writer, so on that path nothing ever tells the mirror.
create function pg_temp.sweep_hold(p_label text, p_sheet uuid, p_reason text) returns void
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
  if public.mark_outbox_held(v_id, v_gen, p_reason) <> 1 then
    raise exception 'fixture: the shipped hold refused %', p_sheet;
  end if;
  insert into pg_temp.h values (p_label, v_id, v_gen);
end; $fn$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET A — the round-10 reproduction, step for step.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.sweep_hold('a', '01580000-0000-0000-0000-000000000010',
                          'recovery-probe-failed: deterministic');

-- ⚑ THE FIX. The hold and its witness are ONE transaction: no recorder ran, and the unknown is already
-- durable. Before 0158 there was no mirror row here at all.
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000010'),
  null,
  'AC-TSC-R10: `mark_outbox_held` itself stamps `post_submit_unknown_at` — the SWEEP path needs no recorder to witness the unknown');
select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000010'),
  'held',
  'AC-TSC-R10: the hold creates the mirror in the RESTRICTIVE state, so the two rows agree the moment the hold exists');

-- The stamp is FIRST-OBSERVED-WINS (0157 §2), so re-driving the same hold cannot move the clock forward.
create table pg_temp.w (t timestamptz);
insert into pg_temp.w select post_submit_unknown_at from timesheet_erp_mirror
  where timesheet_id = '01580000-0000-0000-0000-000000000010';
select is(
  (select public.mark_outbox_held(
     (select id from pg_temp.h where label = 'a'),
     (select gen from pg_temp.h where label = 'a'),
     'recovery-probe-failed: deterministic (second look)')),
  0,
  'AC-TSC-R10 control: a repeat hold on an already-held row is a CAS miss (0 rows) — the outbox transition is unchanged');
select is(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000010'),
  (select t from pg_temp.w),
  'AC-TSC-R10: the stamp is first-observed-wins — a later hold does not move the clock forward');

-- STATE A: before any release the re-open is refused (unchanged behaviour).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01580000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01580000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R10 STATE A: a live sweep-created hold refuses the re-open');
reset role;

-- THE RELEASE — the documented operator route back to the backstop.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01580000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold((select id from pg_temp.h where label = 'a'), 'probe fixed; safe to re-drive') $$,
  'AC-TSC-R10: the Admin releases the sweep-created hold');
reset role;

-- (a) the release does its job — BOTH rows terminal `failed`, the backstop queue restored. Because the
-- hold created the mirror `held`, 0152 §A's CAS now actually matches (round 10 observed it matching 0).
select is(
  (select state from external_command_outbox where id = (select id from pg_temp.h where label = 'a')),
  'failed',
  'AC-TSC-R10: the release moved the OUTBOX to `failed` — the recovery route is open');
select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000010'),
  'failed',
  'AC-TSC-R10: and the MIRROR to `failed` — 0152 §A''s CAS matches because the hold created a `held` mirror to release');

-- (b) ⚑ AND IT ANSWERS NOTHING ABOUT ERP. This is the assertion round 10 watched fail.
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000010'),
  null,
  'AC-TSC-R10: the witness SURVIVES the release — a release re-queues a command, it does not go and look in ERPNext');

-- ⚑ THE BLOCK. Round 10: `STEP6: *** RE-OPEN ADMITTED WITH AN UNKNOWN ERP OUTCOME *** -> Draft`.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01580000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01580000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R10 THE BLOCK: after the release a SWEEP-created hold STILL refuses the re-open — the fence never depended on a recorder being reached');
reset role;
select is(
  (select status from timesheets where id = '01580000-0000-0000-0000-000000000010'),
  'Approved'::timesheet_status,
  'AC-TSC-R10: the sheet stays Approved — no silent flip into a second ERP Timesheet for the week');

-- The route out is the audited attestation, exactly as for a served hold.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01580000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select attest_timesheet_no_erp_document('01580000-0000-0000-0000-000000000010',
       'checked ERPNext Timesheet list for employee/week: no document exists') $$,
  'AC-TSC-R10: the Admin attests that ERPNext holds no Timesheet for this week');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"01580000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_timesheet('01580000-0000-0000-0000-000000000010','Draft') $$,
  'AC-TSC-R10: with the unknown resolved by attestation the re-open ADMITS — the fence has a route out');
reset role;
select is(
  (select status from timesheets where id = '01580000-0000-0000-0000-000000000010'),
  'Draft'::timesheet_status,
  'AC-TSC-R10: the attested sheet actually flips to Draft');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET B — the STRUCTURALLY SWEEP-EXCLUSIVE producer. `reauthorizeRecoveryReissue`
-- (`dispatch.ts:391-406`) is wired ONLY by the sweep (`erpnext-sweep/index.ts:1793`), so its hold can
-- reach no served recorder by construction. Its ONLY creator is `mark_outbox_held`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.sweep_hold('b', '01580000-0000-0000-0000-000000000011',
                          'recovery-reissue-unauthorized: the recorded actor is no longer authorized');
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000011'),
  null,
  'AC-TSC-R10: the SWEEP-EXCLUSIVE `recovery-reissue-unauthorized` hold stamps the witness at creation — the one producer that could never reach a recorder');
set local role authenticated;
set local request.jwt.claims = '{"sub":"01580000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold((select id from pg_temp.h where label = 'b'), 'actor re-authorized') $$,
  'AC-TSC-R10: the Admin releases the reissue-unauthorized hold');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"01580000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01580000-0000-0000-0000-000000000011','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R10: and its re-open is refused after the release too — no producer of a hold is exempt');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET D — THE STAMP IS UNCONDITIONAL, NOT GATED ON THE HOLD'S CAS LANDING. Every reachable call site
-- is a POST-WINDOW RECOVERY branch, so the claimant did not establish what ERPNext holds whether or not
-- its fencing token still wins the outbox transition. A witness that only appears when the CAS lands
-- would leave the fenced-out claimant's unknown unrecorded — and it is the SAME unknown.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table pg_temp.d (id uuid, gen int);
do $$
declare v_id uuid; v_gen int; v_key text;
begin
  v_key := 'ts:01580000-0000-0000-0000-000000000013:'
        || (select approved_at::text from public.timesheets where id = '01580000-0000-0000-0000-000000000013');
  select id into v_id from public.insert_timesheet_outbox_pending(
    p_org := '01580000-0000-0000-0000-00000000000a', p_domain := 'timesheets',
    p_record_id := '01580000-0000-0000-0000-000000000013', p_key := v_key,
    p_tier := 'erpnext', p_operation := 'create', p_payload := null, p_digest := null, p_actor := null);
  select claim_generation into v_gen from public.claim_outbox_for_commit(v_id);
  insert into pg_temp.d values (v_id, v_gen);
end $$;

select is(
  (select public.mark_outbox_held((select id from pg_temp.d), (select gen from pg_temp.d) + 7,
                                  'recovery-probe-failed: deterministic (superseded claimant)')),
  0,
  'AC-TSC-R10: a fenced-out claimant loses the outbox CAS (0 rows) — the hold transition is still generation-exact');
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000013'),
  null,
  'AC-TSC-R10: and its unknown is witnessed ANYWAY — losing the fencing token does not make the lost ERP outcome known');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SHEET C — NEGATIVE CONTROLS. The stamp is scoped to the timesheets domain, and it may NEVER make a
-- hold fail: `mark_outbox_held` is the money path's own write-back.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier,
                                     operation, state, claim_generation)
values ('01580000-0000-0000-0000-0000000000c1','01580000-0000-0000-0000-00000000000a','budget',
        '01580000-0000-0000-0000-000000000012','bud:c1','erpnext','create','committing',3),
       -- a timesheets row whose pmo_record_id is not a uuid at all (legacy/foreign shape)
       ('01580000-0000-0000-0000-0000000000c2','01580000-0000-0000-0000-00000000000a','timesheets',
        'not-a-uuid','ts:legacy','erpnext','create','committing',3),
       -- a timesheets row naming a uuid that is no timesheet
       ('01580000-0000-0000-0000-0000000000c3','01580000-0000-0000-0000-00000000000a','timesheets',
        '01580000-0000-0000-0000-0000000000ff','ts:ghost','erpnext','create','committing',3);

select is(
  (select public.mark_outbox_held('01580000-0000-0000-0000-0000000000c1', 3, 'recovery-inconclusive-absence')),
  1,
  'AC-TSC-R10 control: a NON-timesheets hold still holds');
select is(
  (select count(*)::int from timesheet_erp_mirror where timesheet_id = '01580000-0000-0000-0000-000000000012'),
  0,
  'AC-TSC-R10 control: and writes NO timesheet mirror — the stamp is scoped to the timesheets domain');

select is(
  (select public.mark_outbox_held('01580000-0000-0000-0000-0000000000c2', 3, 'recovery-probe-failed')),
  1,
  'AC-TSC-R10 control: a non-uuid `pmo_record_id` never breaks the hold (no 22P02 out of the money write-back)');
select is(
  (select public.mark_outbox_held('01580000-0000-0000-0000-0000000000c3', 3, 'recovery-probe-failed')),
  1,
  'AC-TSC-R10 control: a uuid that names no timesheet never breaks the hold (no FK violation out of the money write-back)');

select * from finish();
rollback;
