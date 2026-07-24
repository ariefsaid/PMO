-- 0155_command_held_fenced_on_release.test.sql
-- AC-OBX-062 — a released generation can no longer write `held`; a still-held one still can.
--
-- ⚑ WHY THIS EXISTS (Luna FU-1a round-6). `record_timesheet_command_held` no longer decides with an
-- `EXISTS` heuristic; it takes the EXACT outbox id + claim generation the hold was produced under, locks
-- that row, and records `held` ONLY while it is STILL `held` at that SAME generation — otherwise it
-- records the RELEASED outcome (`failed`). This file proves the SERIAL release-then-record case (the
-- released row's stale generation writes `failed`, not `held`) and the CONTROL (a still-held row at the
-- right generation records `held`). The genuine interleaving + generation + empty-then-held oracles live
-- in the sibling files (0155_command_held_interleave / _generation / _empty_then_held).
--
-- Fixtures are minted by the SHIPPED writers: `insert_timesheet_outbox_pending` + `claim_outbox_for_commit`
-- + `mark_outbox_held` drive the outbox to `held` exactly as the recovery branch does; the mirror outcome
-- is recorded by the shipped `record_timesheet_command_held` RPC (not a hand-written row).
begin;
select plan(4);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01550000-0000-0000-0000-00000000000a','Fenced Held Org');

insert into auth.users (id, email) values
  ('01550000-0000-0000-0000-0000000000a1','fence-admin@example.com'),
  ('01550000-0000-0000-0000-0000000000a2','fence-owner@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01550000-0000-0000-0000-0000000000a1','01550000-0000-0000-0000-00000000000a',
   'Admin F','fence-admin@example.com','Admin', null),
  ('01550000-0000-0000-0000-0000000000a2','01550000-0000-0000-0000-00000000000a',
   'Owner F','fence-owner@example.com','Engineer','01550000-0000-0000-0000-0000000000a1');

-- Two approved sheets: (A) the RACE sheet — released before its mirror is recorded; (B) the CONTROL —
-- its outbox is still held when the late writer runs.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01550000-0000-0000-0000-0000000000a0','01550000-0000-0000-0000-00000000000a',
   '01550000-0000-0000-0000-0000000000a2','2026-06-01','Approved','01550000-0000-0000-0000-0000000000a1', now()),
  ('01550000-0000-0000-0000-0000000000b0','01550000-0000-0000-0000-00000000000a',
   '01550000-0000-0000-0000-0000000000a2','2026-06-08','Approved','01550000-0000-0000-0000-0000000000a1', now());

-- Mint a held command via the SHIPPED writers, keyed exactly as the originators derive it. Records BOTH
-- the row id and the generation the hold was produced under — the recorder now needs both.
create table pg_temp.ids (label text primary key, id uuid, gen int);
create function pg_temp.seed_held_command(p_label text, p_sheet uuid) returns void
  language plpgsql as $fn$
declare v_id uuid; v_gen int; v_key text;
begin
  v_key := 'ts:' || p_sheet::text || ':'
           || (select approved_at::text from public.timesheets where id = p_sheet);
  select id into v_id from public.insert_timesheet_outbox_pending(
    p_org := (select org_id from public.timesheets where id = p_sheet),
    p_domain := 'timesheets', p_record_id := p_sheet::text, p_key := v_key,
    p_tier := 'erpnext', p_operation := 'create', p_payload := null, p_digest := null, p_actor := null);
  select claim_generation into v_gen from public.claim_outbox_for_commit(v_id);
  if v_gen is null then raise exception 'fixture: the shipped claim refused %', p_sheet; end if;
  if public.mark_outbox_held(v_id, v_gen, 'recovery-probe-failed: deterministic') <> 1 then
    raise exception 'fixture: the shipped hold refused %', p_sheet;
  end if;
  insert into pg_temp.ids values (p_label, v_id, v_gen);
end; $fn$;

select pg_temp.seed_held_command('race',    '01550000-0000-0000-0000-0000000000a0');
select pg_temp.seed_held_command('control', '01550000-0000-0000-0000-0000000000b0');
grant select on pg_temp.ids to authenticated;

-- ── A) THE RACE: release runs BEFORE the mirror OUTCOME is ever recorded ──────────────────────────
-- Precondition: ⚑ migration 0158 — the hold itself now creates the mirror row `held` + the
-- unknown-outcome witness (the round-10 BLOCK: a sweep-created hold reaches no recorder at all). What has
-- NOT run is the late RECORDER, which is what this file is about — so the row carries the HOLD's reason,
-- not a recorded `command-held` outcome.
select is(
  (select push_state || '|' || (push_error like 'recovery-probe-failed%')::text
     from timesheet_erp_mirror where timesheet_id = '01550000-0000-0000-0000-0000000000a0'),
  'held|true',
  'AC-OBX-062: precondition — the mirror row exists `held` from the HOLD itself (0158); the late recorder has not run');

-- The Admin releases the still-held outbox (0152 §A) — updates zero mirror rows because none exists,
-- and BUMPS the row's claim_generation (0152 §A) so the stale writer's token no longer matches.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select release_outbox_hold((select id from pg_temp.ids where label = 'race'), 'probe fixed; safe to re-drive');
reset role;

select is(
  (select state from external_command_outbox where id = (select id from pg_temp.ids where label = 'race')),
  'failed',
  'AC-OBX-062: the release moved the outbox to `failed` (its generation is now superseded)');

-- NOW the delayed dispatch-catch handler records the `command-held` mirror outcome, threading the EXACT
-- (now stale) id + generation it was produced under.
select record_timesheet_command_held(
  '01550000-0000-0000-0000-00000000000a',
  '01550000-0000-0000-0000-0000000000a0',
  now(),
  'command-held: the recovery probe failed deterministically',
  (select id from pg_temp.ids where label = 'race'),
  (select gen from pg_temp.ids where label = 'race'));

-- ⚑ THE ORACLE: the released generation must NOT resurrect the hold. The mirror ends `failed`, matching
-- the released outbox — so the backstop re-queues it and re-open behaves by the ordinary rules.
select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01550000-0000-0000-0000-0000000000a0'),
  'failed',
  'AC-OBX-062: a released generation CANNOT write `held` afterward — the mirror ends `failed`, never `held`, so the dead end never re-forms');

-- ── B) THE CONTROL: the outbox is still held at the right generation → records `held` ──────────────
select record_timesheet_command_held(
  '01550000-0000-0000-0000-00000000000a',
  '01550000-0000-0000-0000-0000000000b0',
  now(),
  'command-held: the recovery probe failed deterministically',
  (select id from pg_temp.ids where label = 'control'),
  (select gen from pg_temp.ids where label = 'control'));

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01550000-0000-0000-0000-0000000000b0'),
  'held',
  'AC-OBX-062: with the outbox STILL held at the produced generation, the late writer records `held` — the fence only suppresses a released/superseded write');

select * from finish();
rollback;
