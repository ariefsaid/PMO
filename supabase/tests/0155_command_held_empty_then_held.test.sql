-- 0155_command_held_empty_then_held.test.sql
-- AC-OBX-065 (Luna FU-1a round-6, BLOCK 3) — a prior empty-sheet `pushed`/null row no longer masks a
-- later real held push.
--
-- ⚑ WHY (the `pushed` guard was too broad). The empty-approved-sheet path (FR-TSP-056) legitimately
-- records `push_state = 'pushed'` with `ts_number = NULL` — a SUCCESS with NO ERP document. The mirror is
-- one row per sheet, so that row survives the next approval generation. Round-5's recorder guarded its
-- write with `WHERE push_state <> 'pushed'`, so when a LATER generation was genuinely held, the update
-- matched ZERO rows and the mirror stayed `pushed`. The backstop excludes non-`failed` rows and re-open
-- sees no `held` mirror and no live document, so it admits ANOTHER approval while ERP may hold the held
-- generation's document — a DOUBLE-COUNT.
--
-- The fix distinguishes a LIVE ERP document (`ts_number` set, not cancelled — never clobbered) from the
-- documented no-document `pushed` (`ts_number` NULL), and lets a strictly-newer generation witness
-- overwrite the stale no-document row. This file: empty `pushed`/null → re-approve → a real held push →
-- the mirror must end `held`, and a release must then open the backstop route.
begin;
select plan(4);

insert into organizations (id, name) values
  ('01565000-0000-0000-0000-000000000001','TS Empty-Then-Held Org');

insert into auth.users (id, email) values
  ('01565000-0000-0000-0000-0000000000a1','e-owner@example.com'),
  ('01565000-0000-0000-0000-0000000000a2','e-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01565000-0000-0000-0000-0000000000a1','01565000-0000-0000-0000-000000000001',
   'Owner E','e-owner@example.com','Engineer','01565000-0000-0000-0000-0000000000a2'),
  ('01565000-0000-0000-0000-0000000000a2','01565000-0000-0000-0000-000000000001',
   'Admin E','e-admin@example.com','Admin', null);

-- The sheet is currently on its LATER (re-approved) generation — approved_at = 2026-06-12 09:00, after
-- the empty push's earlier 2026-06-01 witness.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01565000-0000-0000-0000-000000000010','01565000-0000-0000-0000-000000000001',
   '01565000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01565000-0000-0000-0000-0000000000a2','2026-06-12 09:00:00+00');

-- ── The prior EMPTY-approved-sheet outcome, written exactly as `markTimesheetPushOutcome`'s null arm
-- writes it (the edge-fn TS writer is not callable from pgTAP): `pushed`, ts_number NULL, keyed on the
-- FIRST generation's approval witness. ─────────────────────────────────────────────────────────────
insert into timesheet_erp_mirror (org_id, timesheet_id, ts_number, push_state, push_error, pushed_at, approved_at_pushed)
values ('01565000-0000-0000-0000-000000000001','01565000-0000-0000-0000-000000000010',
        null, 'pushed', null, now(), '2026-06-01 09:00:00+00');   -- T1's earlier witness

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01565000-0000-0000-0000-000000000010'),
  'pushed',
  'AC-OBX-065: precondition — the empty sheet is recorded `pushed` with a null ts_number (a no-document success)');

-- ── The sheet is re-opened, corrected, and re-approved as a LATER generation (T2) with real hours. Its
-- push POSTs, recovery fails deterministically, and the command is held. Mint that held command via the
-- SHIPPED writers and record its held outcome, keyed on T2's (later) witness. ──────────────────────
create table pg_temp.h (id uuid, gen int);
do $fn$
declare v_id uuid; v_gen int; v_key text;
begin
  v_key := 'ts:01565000-0000-0000-0000-000000000010:'
           || (select approved_at::text from public.timesheets where id = '01565000-0000-0000-0000-000000000010');
  select id into v_id from public.insert_timesheet_outbox_pending(
    p_org := '01565000-0000-0000-0000-000000000001', p_domain := 'timesheets',
    p_record_id := '01565000-0000-0000-0000-000000000010', p_key := v_key,
    p_tier := 'erpnext', p_operation := 'create', p_payload := null, p_digest := null, p_actor := null);
  select claim_generation into v_gen from public.claim_outbox_for_commit(v_id);
  perform public.mark_outbox_held(v_id, v_gen, 'recovery-probe-failed: deterministic');
  insert into pg_temp.h values (v_id, v_gen);
end; $fn$;
grant select on pg_temp.h to authenticated;   -- the release below runs under an authenticated role

select record_timesheet_command_held(
  '01565000-0000-0000-0000-000000000001','01565000-0000-0000-0000-000000000010',
  '2026-06-12 09:00:00+00',   -- T2's later approval witness (a NEW generation)
  'command-held: recovery probe failed deterministically',
  (select id from pg_temp.h), (select gen from pg_temp.h));

-- ⚑ THE ORACLE: the later held push OVERWRITES the stale empty-sheet `pushed`/null row — it must NOT be
-- masked. Delete the `ts_number IS NULL` allowance (revert to `push_state <> 'pushed'`) and this update
-- matches zero rows: the mirror stays `pushed` and this assertion fails.
select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01565000-0000-0000-0000-000000000010'),
  'held',
  'AC-OBX-065: the real held push overwrites the stale empty-sheet `pushed`/null row — the mirror ends `held`, not stuck `pushed`');

select is(
  (select approved_at_pushed from timesheet_erp_mirror where timesheet_id = '01565000-0000-0000-0000-000000000010'),
  '2026-06-12 09:00:00+00'::timestamptz,
  'AC-OBX-065: and it carries the NEW generation''s witness, not the empty sheet''s stale one');

-- ── The operator releases the held command → the mirror goes `held` → `failed`, re-opening the backstop
-- route (only `failed` is re-queued). Proves the fixed row is no longer a permanent mask. ──────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01565000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select release_outbox_hold((select id from pg_temp.h), 'probe fixed; safe to re-drive');
reset role;

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01565000-0000-0000-0000-000000000010'),
  'failed',
  'AC-OBX-065: releasing the held command moves the mirror `held` → `failed` — the backstop route is open again');

select * from finish();
rollback;
