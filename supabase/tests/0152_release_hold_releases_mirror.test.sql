-- 0152_release_hold_releases_mirror.test.sql
-- AC-OBX-061 — releasing a HELD TIMESHEET command also releases its `timesheet_erp_mirror` hold.
--
-- ⚑ WHY THIS EXISTS (Luna FU-1a round-4 BLOCK). A Timesheet POST/submit succeeds, recovery finds the
-- ERP document, and `fromDoc`/`mirrorMoney` then fails DETERMINISTICALLY. Two rows record that hold:
-- the outbox (`dispatch.ts`, fenced → `held`) and the mirror (`markTimesheetPushOutcome`, the
-- `command-held` arm → `push_state='held'`). `release_outbox_hold` moved only the OUTBOX back to
-- `failed`. The mirror stayed `held` — and the Timesheet backstop selects ONLY mirror
-- `pending`/`failed` (`erpnext-sweep/index.ts`), generic recovery skips timesheets, and the UI renders
-- no Retry for `command-held`. So the "release" produced a DEAD END: the mirror could never re-probe or
-- adopt, while the outbox became terminal and the re-open surface began admitting — a re-approve then
-- posts a SECOND ERP Timesheet for a week ERPNext already holds. The client's hours double-count.
--
-- The release is therefore ONE atomic operator action over BOTH rows: an outbox `held → failed` plus a
-- CAS of the matching mirror `held → failed`, scoped to the released command's own record + org, and
-- audited in the same audit row. `failed` is deliberate on both sides — it is what puts the record back
-- in the backstop's queue without ever fabricating a success.
--
-- NOT touched: any other domain (a budget/revenue release must leave every mirror alone), any mirror
-- that is not `held` (a `pushed` mirror is a real ERP document — never re-queue it), and any other
-- sheet's mirror.
begin;
select plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01520000-0000-0000-0000-00000000000a','Release Mirror Org');

insert into auth.users (id, email) values
  ('01520000-0000-0000-0000-0000000000a1','rel-mirror-admin@example.com'),
  ('01520000-0000-0000-0000-0000000000a2','rel-mirror-owner@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01520000-0000-0000-0000-0000000000a1','01520000-0000-0000-0000-00000000000a',
   'Admin R','rel-mirror-admin@example.com','Admin', null),
  ('01520000-0000-0000-0000-0000000000a2','01520000-0000-0000-0000-00000000000a',
   'Owner R','rel-mirror-owner@example.com','Engineer','01520000-0000-0000-0000-0000000000a1');

-- Three approved sheets: (1) the held one being released, (2) a bystander whose mirror is ALSO held,
-- (3) a sheet whose mirror is `pushed` (a real ERP document) and whose command is held.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01520000-0000-0000-0000-000000000010','01520000-0000-0000-0000-00000000000a',
   '01520000-0000-0000-0000-0000000000a2','2026-06-01','Approved','01520000-0000-0000-0000-0000000000a1', now()),
  ('01520000-0000-0000-0000-000000000011','01520000-0000-0000-0000-00000000000a',
   '01520000-0000-0000-0000-0000000000a2','2026-06-08','Approved','01520000-0000-0000-0000-0000000000a1', now()),
  ('01520000-0000-0000-0000-000000000012','01520000-0000-0000-0000-00000000000a',
   '01520000-0000-0000-0000-0000000000a2','2026-06-15','Approved','01520000-0000-0000-0000-0000000000a1', now());

-- ⚑ FIXTURES COME FROM THE SHIPPED WRITERS. The outbox rows are minted by the fenced guard RPC the
-- dispatch/sweep call and driven to `held` by the SAME `claim_outbox_for_commit` + `mark_outbox_held`
-- pair the recovery branch issues. The key is DERIVED exactly as both originators derive it
-- (`ts:<canonical uuid>:<approved_at>`) — a hand-written key is refused as a stale generation.
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
  if public.mark_outbox_held(v_id, v_gen, 'recovery-inconclusive') <> 1 then
    raise exception 'fixture: the shipped hold refused %', p_sheet;
  end if;
  return v_id;
end; $fn$;

create table pg_temp.ids (label text primary key, id uuid);
insert into pg_temp.ids values
  ('sheet-10', pg_temp.seed_held_command('01520000-0000-0000-0000-000000000010')),
  ('sheet-11', pg_temp.seed_held_command('01520000-0000-0000-0000-000000000011')),
  ('sheet-12', pg_temp.seed_held_command('01520000-0000-0000-0000-000000000012'));
-- the RPC calls below run as `authenticated`, which must be able to read the fixture's id table.
grant select on pg_temp.ids to authenticated;

-- The mirror rows, written exactly as `markTimesheetPushOutcome` writes them: the `command-held` arm
-- sets push_state='held' + the classified reason and leaves ts_number/pushed_at alone.
insert into timesheet_erp_mirror (org_id, timesheet_id, push_state, push_error, approved_at_pushed) values
  ('01520000-0000-0000-0000-00000000000a','01520000-0000-0000-0000-000000000010','held',
   'command-held: the command is held pending operator review', now()),
  ('01520000-0000-0000-0000-00000000000a','01520000-0000-0000-0000-000000000011','held',
   'command-held: the command is held pending operator review', now());
-- Sheet 12's mirror records a REAL ERP document — a release must never re-queue it.
insert into timesheet_erp_mirror (org_id, timesheet_id, ts_number, push_state, pushed_at) values
  ('01520000-0000-0000-0000-00000000000a','01520000-0000-0000-0000-000000000012','TS-2026-00042','pushed', now());

-- A NON-timesheet held command keyed on the SAME record id as sheet 11 (whose mirror is held). A
-- release that ignored `domain` would release that mirror; a domain-scoped one cannot.
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, last_error)
values ('01520000-0000-0000-0000-0000000000f9','01520000-0000-0000-0000-00000000000a','budget',
        '01520000-0000-0000-0000-000000000011','bud:11:t0','erpnext','create','held','held');

-- ── A) Releasing a HELD TIMESHEET command releases BOTH rows ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold((select id from pg_temp.ids where label = 'sheet-10'), 'probe fixed; safe to re-drive') $$,
  'AC-OBX-061: an in-org active Admin releases the held timesheet command');
reset role;

select is(
  (select state from external_command_outbox where id = (select id from pg_temp.ids where label = 'sheet-10')),
  'failed',
  'AC-OBX-061: the OUTBOX lands in `failed` (unchanged behaviour)');

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01520000-0000-0000-0000-000000000010'),
  'failed',
  'AC-OBX-061: the MIRROR is released too — `failed` is the ONLY state the timesheet backstop re-queues, so the release restores the recovery route instead of dead-ending it');

select ok(
  (select push_error from timesheet_erp_mirror where timesheet_id = '01520000-0000-0000-0000-000000000010')
    like '%released by operator%',
  'AC-OBX-061: the mirror records that an operator cleared it — never a spontaneous-looking recovery');

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01520000-0000-0000-0000-000000000011'),
  'held',
  'AC-OBX-061: ANOTHER sheet''s held mirror is untouched — the CAS is scoped to the released command''s own record');

-- ── B) The audit row still names the Admin, the reason, and now the mirror effect ────────────────
select is(
  (select count(*)::int from audit_events
     where action = 'release_outbox_hold'
       and actor_id = '01520000-0000-0000-0000-0000000000a1'
       and entity_id = (select id from pg_temp.ids where label = 'sheet-10')),
  1,
  'AC-OBX-061: exactly one audit row, as before');

select is(
  (select detail->>'mirror_released' from audit_events
     where action = 'release_outbox_hold'
       and entity_id = (select id from pg_temp.ids where label = 'sheet-10')),
  '1',
  'AC-OBX-061: the audit row records that the mirror hold was released with it');

-- ── C) A NON-timesheet release leaves every mirror alone ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold('01520000-0000-0000-0000-0000000000f9'::uuid, 'budget hold cleared') $$,
  'AC-OBX-061: a budget hold still releases');
reset role;

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01520000-0000-0000-0000-000000000011'),
  'held',
  'AC-OBX-061: the budget release did NOT touch a timesheet mirror — even one keyed on the same record id (non-timesheet behaviour is unchanged)');

-- ── D) A mirror that is not `held` is never re-queued by a release ───────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01520000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select release_outbox_hold((select id from pg_temp.ids where label = 'sheet-12'), 'clearing the command only') $$,
  'AC-OBX-061: releasing a command whose mirror already holds a real ERP document is allowed');
reset role;

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01520000-0000-0000-0000-000000000012'),
  'pushed',
  'AC-OBX-061: a `pushed` mirror (a REAL ERPNext Timesheet) is NOT flipped to failed — the CAS is held→failed only, never a blind overwrite that would re-POST a settled document');

select is(
  (select ts_number from timesheet_erp_mirror where timesheet_id = '01520000-0000-0000-0000-000000000012'),
  'TS-2026-00042',
  'AC-OBX-061: the pushed mirror''s document number survives the release');

select * from finish();
rollback;
