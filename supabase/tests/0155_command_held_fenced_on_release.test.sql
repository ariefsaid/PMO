-- 0155_command_held_fenced_on_release.test.sql
-- AC-OBX-062 — a release-before-mirror interleaving can no longer leave the mirror `held`.
--
-- ⚑ WHY THIS EXISTS (Luna FU-1a round-5 BLOCK). 0152 made `release_outbox_hold` release BOTH the outbox
-- and the mirror. But the mirror `command-held` row is written LATER than the outbox hold — in the
-- dispatch catch, through `markTimesheetPushOutcome`. An Admin release can interleave in that window:
--   1. outbox `held`, NO mirror row yet.
--   2. release → outbox `failed`, ZERO mirror rows updated (none exists).
--   3. the delayed handler records the mirror as `held`.
-- Final state: outbox `failed` + mirror `held` — the exact dead end 0152 was meant to close, recreated.
--
-- The fix fences the late `command-held` write on a LIVE `held` outbox (`record_timesheet_command_held`):
-- once the outbox has been released to `failed`, the late writer records the RELEASED outcome (`failed`),
-- NEVER `held`. The 0152 test seeds the mirror BEFORE release, so it cannot see this ordering; this test
-- adds the no-mirror-first interleaving.
--
-- Fixtures are minted by the SHIPPED writers: `insert_timesheet_outbox_pending` + `claim_outbox_for_commit`
-- + `mark_outbox_held` drive the outbox to `held` exactly as the recovery branch does, and the mirror
-- outcome is recorded by the shipped `record_timesheet_command_held` RPC (not a hand-written row).
begin;
select plan(5);

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

-- Mint a held command via the SHIPPED writers, keyed exactly as the originators derive it.
create function pg_temp.seed_held_command(p_sheet uuid) returns uuid
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
  return v_id;
end; $fn$;

create table pg_temp.ids (label text primary key, id uuid);
insert into pg_temp.ids values
  ('race',    pg_temp.seed_held_command('01550000-0000-0000-0000-0000000000a0')),
  ('control', pg_temp.seed_held_command('01550000-0000-0000-0000-0000000000b0'));
grant select on pg_temp.ids to authenticated;

-- ── A) THE RACE: release runs BEFORE the mirror is ever written ───────────────────────────────────
-- Precondition: no mirror row exists for the race sheet yet.
select is(
  (select count(*)::int from timesheet_erp_mirror where timesheet_id = '01550000-0000-0000-0000-0000000000a0'),
  0,
  'AC-OBX-062: precondition — the mirror row does not exist yet (the late writer has not run)');

-- The Admin releases the still-held outbox (0152 §A) — updates zero mirror rows because none exists.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select release_outbox_hold((select id from pg_temp.ids where label = 'race'), 'probe fixed; safe to re-drive');
reset role;

select is(
  (select state from external_command_outbox where id = (select id from pg_temp.ids where label = 'race')),
  'failed',
  'AC-OBX-062: the release moved the outbox to `failed` (its generation is now superseded)');

-- NOW the delayed dispatch-catch handler records the `command-held` mirror outcome.
select record_timesheet_command_held(
  '01550000-0000-0000-0000-00000000000a',
  '01550000-0000-0000-0000-0000000000a0',
  now(),
  'command-held: the recovery probe failed deterministically');

-- ⚑ THE ORACLE: the late writer must NOT resurrect the hold. The mirror ends `failed`, matching the
-- released outbox — so the backstop re-queues it and re-open behaves by the ordinary rules.
select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01550000-0000-0000-0000-0000000000a0'),
  'failed',
  'AC-OBX-062: a released generation CANNOT write `held` afterward — the mirror ends `failed`, never `held`, so the dead end never re-forms');

-- ── B) THE CONTROL: the outbox is still held → the late writer legitimately records `held` ─────────
select record_timesheet_command_held(
  '01550000-0000-0000-0000-00000000000a',
  '01550000-0000-0000-0000-0000000000b0',
  now(),
  'command-held: the recovery probe failed deterministically');

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01550000-0000-0000-0000-0000000000b0'),
  'held',
  'AC-OBX-062: with the outbox STILL held, the late writer records `held` as before — the fence only suppresses a released-generation write');

select is(
  (select state from external_command_outbox where id = (select id from pg_temp.ids where label = 'control')),
  'held',
  'AC-OBX-062: the control command was never released — it is still held');

select * from finish();
rollback;
