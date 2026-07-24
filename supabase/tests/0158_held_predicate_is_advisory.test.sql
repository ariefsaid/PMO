-- 0158_held_predicate_is_advisory.test.sql
-- AC-TSC-R10b (Luna FU-1a round-10 SHOULD-FIX S1) — THE WITNESS IS THE FENCE; `push_state = 'held'` IS
-- ADVISORY.
--
-- S1: `markTimesheetPushOutcome`'s non-held path (`adapter-dispatch/readModelWriters.ts`) is an unguarded
-- blind upsert — no generation CAS, no `held`-preservation — so any later classified failure rewrites a
-- `held` mirror to `failed`. The review's objection was that the money invariant then survives only
-- because the witness outlives it, and that nothing recorded or tested that dependency.
--
-- This file records and tests it. After migration 0158, EVERY writer that can produce a `held` timesheet
-- mirror stamps the witness in the SAME statement:
--   • `mark_outbox_held`                  — 0158, at the moment the hold is created (every producer);
--   • `record_timesheet_command_held`     — 0157 §3, unconditionally, outside its outcome guard;
--   • `parkTimesheetMirrorRow` (the sweep) — stamps `post_submit_unknown_at` on a `held` park.
-- So `0157 §4`'s `push_state = 'held'` predicate fences only the PRE-0157 residue (a `held` row written
-- before the witness column existed), and for every row written from here on the witness — which no
-- ordinary writer can clear (0157 §2's trigger) — is what the re-open actually rests on.
--
-- The oracle below is deliberately the HARSHEST version of S1: the mirror's `push_state` is rewritten to
-- the most PERMISSIVE state there is, by exactly the shape of that blind upsert, and the re-open must
-- still refuse.
begin;
select plan(6);

insert into organizations (id, name) values
  ('0158b000-0000-0000-0000-00000000000a','Advisory Predicate Org');

insert into auth.users (id, email) values
  ('0158b000-0000-0000-0000-0000000000a1','ap-owner@example.com'),
  ('0158b000-0000-0000-0000-0000000000a2','ap-mgr@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('0158b000-0000-0000-0000-0000000000a1','0158b000-0000-0000-0000-00000000000a',
   'Owner AP','ap-owner@example.com','Engineer','0158b000-0000-0000-0000-0000000000a2'),
  ('0158b000-0000-0000-0000-0000000000a2','0158b000-0000-0000-0000-00000000000a',
   'Manager AP','ap-mgr@example.com','Engineer', null);

insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('0158b000-0000-0000-0000-000000000010','0158b000-0000-0000-0000-00000000000a',
   '0158b000-0000-0000-0000-0000000000a1','2026-06-01','Approved','0158b000-0000-0000-0000-0000000000a2','2026-06-08 09:00:00+00');

-- The hold, through the shipped writers only (mint → claim → hold). No recorder, as on the sweep path.
do $$
declare v_id uuid; v_gen int; v_key text;
begin
  v_key := 'ts:0158b000-0000-0000-0000-000000000010:'
        || (select approved_at::text from public.timesheets where id = '0158b000-0000-0000-0000-000000000010');
  select id into v_id from public.insert_timesheet_outbox_pending(
    p_org := '0158b000-0000-0000-0000-00000000000a', p_domain := 'timesheets',
    p_record_id := '0158b000-0000-0000-0000-000000000010', p_key := v_key,
    p_tier := 'erpnext', p_operation := 'create', p_payload := null, p_digest := null, p_actor := null);
  select claim_generation into v_gen from public.claim_outbox_for_commit(v_id);
  if public.mark_outbox_held(v_id, v_gen, 'recovery-probe-failed: deterministic') <> 1 then
    raise exception 'fixture: the shipped hold refused';
  end if;
  -- The outbox row is deliberately taken TERMINAL, so nothing but the mirror can fence the re-open:
  -- this test is about the mirror's two columns, not about the outbox predicate.
  update public.external_command_outbox set state = 'failed' where id = v_id;
end $$;

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '0158b000-0000-0000-0000-000000000010'),
  'held',
  'AC-TSC-R10b fixture: the hold created a `held` mirror carrying the witness');

-- ⚑ S1's write, verbatim in shape: `markTimesheetPushOutcome`'s non-held upsert
-- (`readModelWriters.ts` — no generation CAS, no `held` preservation) recording an ordinary later
-- failure. It rewrites `push_state` to the PERMISSIVE `failed` and clears `pushed_at`.
insert into timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, pushed_at, approved_at_pushed)
values ('0158b000-0000-0000-0000-00000000000a','0158b000-0000-0000-0000-000000000010',
        'failed','external-unreachable: connect ETIMEDOUT', null, '2026-06-08 09:00:00+00')
on conflict (timesheet_id) do update
  set push_state         = excluded.push_state,
      push_error         = excluded.push_error,
      pushed_at          = excluded.pushed_at,
      approved_at_pushed = excluded.approved_at_pushed;

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '0158b000-0000-0000-0000-000000000010'),
  'failed',
  'AC-TSC-R10b: the blind upsert DOES downgrade `held` → `failed` (S1 is real; the `held` predicate is erasable)');

select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '0158b000-0000-0000-0000-000000000010'),
  null,
  'AC-TSC-R10b: but it does not name the witness column, so the witness is untouched by the downgrade');

-- And a writer that DOES try to null it cannot either: 0157 §2's trigger silently preserves the witness
-- for every principal except the audited attestation. (Drop that trigger and this assertion fails.)
update timesheet_erp_mirror set post_submit_unknown_at = null, push_state = 'failed'
 where timesheet_id = '0158b000-0000-0000-0000-000000000010';
select isnt(
  (select post_submit_unknown_at from timesheet_erp_mirror where timesheet_id = '0158b000-0000-0000-0000-000000000010'),
  null,
  'AC-TSC-R10b: and a writer that explicitly NULLS the witness is silently refused — 0157 §2''s stickiness trigger');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0158b000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('0158b000-0000-0000-0000-000000000010','Draft') $$,
  'P0001', 'reopen-push-outcome-unknown',
  'AC-TSC-R10b: so the re-open still REFUSES with a terminal outbox AND a `failed` mirror — the witness, not push_state, is the fence');
reset role;

select is(
  (select status from timesheets where id = '0158b000-0000-0000-0000-000000000010'),
  'Approved'::timesheet_status,
  'AC-TSC-R10b: the sheet stays Approved');

select * from finish();
rollback;
