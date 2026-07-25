-- 0155_command_held_generation.test.sql
-- AC-OBX-064 (Luna FU-1a round-6, BLOCK 2) — the fence is a GENERATION-EXACT CAS, not an `EXISTS`.
--
-- ⚑ WHY (round-5's `EXISTS` matched a NEWER approval generation). Round-5 asked only "does ANY held
-- timesheet outbox for (org, sheet) exist?". After the original hold is released (terminal `failed`,
-- generation bumped), 0134's partial-unique index admits a SUCCESSOR command (a new id, a new
-- generation) which can itself reach `held`. A DELAYED writer for the OLD generation then found the
-- SUCCESSOR via `EXISTS` and recorded `held` carrying the OLD generation's witness — attributing the
-- successor's unknown ERP outcome to the wrong week. That is not a compare-and-set.
--
-- The fix takes the EXACT outbox id + the claim generation the hold was produced under, and records
-- `held` ONLY while THAT row is still `held` at THAT generation. Two ways the generation can move — a
-- SUCCESSOR row (different id) and a RECLAIM (same row, bumped generation) — and this file covers both.
begin;
select plan(5);

insert into organizations (id, name) values
  ('01564000-0000-0000-0000-000000000001','TS Generation Org');

insert into auth.users (id, email) values
  ('01564000-0000-0000-0000-0000000000a1','g-owner@example.com'),
  ('01564000-0000-0000-0000-0000000000a2','g-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01564000-0000-0000-0000-0000000000a1','01564000-0000-0000-0000-000000000001',
   'Owner G','g-owner@example.com','Engineer','01564000-0000-0000-0000-0000000000a2'),
  ('01564000-0000-0000-0000-0000000000a2','01564000-0000-0000-0000-000000000001',
   'Admin G','g-admin@example.com','Admin', null);

-- Two sheets: S1 exercises the SUCCESSOR-ROW case, S2 the SAME-ROW-RECLAIM (bumped generation) case.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01564000-0000-0000-0000-000000000010','01564000-0000-0000-0000-000000000001',
   '01564000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01564000-0000-0000-0000-0000000000a2','2026-06-01 09:00:00+00'),
  ('01564000-0000-0000-0000-000000000020','01564000-0000-0000-0000-000000000001',
   '01564000-0000-0000-0000-0000000000a1','2026-06-08','Approved','01564000-0000-0000-0000-0000000000a2','2026-06-08 09:00:00+00');

-- The idempotency key must carry the sheet's CURRENT approval witness — both the shipped mint and claim
-- fence refuse a key whose witness is not `timesheets.approved_at` (0151 §B/§C). So the helper reads the
-- sheet's live `approved_at` and builds `ts:<sheet>:<approved_at>` exactly as the originators do.
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
  perform public.mark_outbox_held(v_id, v_gen, 'recovery-probe-failed: deterministic');
  insert into pg_temp.h values (p_label, v_id, v_gen);
end; $fn$;
grant select on pg_temp.h to authenticated;   -- the release below runs under an authenticated role

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CASE A — SUCCESSOR ROW. T1 held → released → T2 (a new row) held → T1's delayed writer must NOT
-- attribute T2's outcome to itself.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- T1: the FIRST generation's held command (keyed on the sheet's current approved_at = 2026-06-01 09:00).
select pg_temp.mint_held('t1', '01564000-0000-0000-0000-000000000010');

-- Release T1 → failed, generation bumped (0152 §A). 0134 now admits a successor.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01564000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select release_outbox_hold((select id from pg_temp.h where label = 't1'), 'probe fixed');
reset role;

-- Re-open + re-approve as a LATER generation: the sheet's approval witness advances to 2026-06-05 09:00
-- (a real correction cycle re-stamps `approved_at`; here we advance it directly for the fixture).
update timesheets set approved_at = '2026-06-05 09:00:00+00' where id = '01564000-0000-0000-0000-000000000010';

-- T2: the SUCCESSOR generation's held command (a NEW row, keyed on the new witness). It records its held
-- mirror with ITS witness.
select pg_temp.mint_held('t2', '01564000-0000-0000-0000-000000000010');
select record_timesheet_command_held(
  '01564000-0000-0000-0000-000000000001','01564000-0000-0000-0000-000000000010',
  '2026-06-05 09:00:00+00',   -- T2's (later) approval witness
  'command-held: recovery probe failed deterministically',
  (select id from pg_temp.h where label = 't2'), (select gen from pg_temp.h where label = 't2'));

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01564000-0000-0000-0000-000000000010'),
  'held',
  'AC-OBX-064-A: T2 recorded its own `held` mirror');

-- ⚑ THE STALE WRITER: T1's delayed handler runs with T1's EXACT id + generation. T1's row is `failed`
-- (released), so the fence records the RELEASED outcome (`failed`), and its OLDER witness cannot
-- overwrite T2's newer row. It must be a no-op on T2's mirror.
select is(
  (select record_timesheet_command_held(
     '01564000-0000-0000-0000-000000000001','01564000-0000-0000-0000-000000000010',
     '2026-06-01 09:00:00+00',   -- T1's (earlier) approval witness
     'command-held: recovery probe failed deterministically',
     (select id from pg_temp.h where label = 't1'), (select gen from pg_temp.h where label = 't1'))),
  'failed',
  'AC-OBX-064-A: T1''s released generation records `failed`, never `held` — it cannot match T2''s row/generation');

select is(
  (select approved_at_pushed from timesheet_erp_mirror where timesheet_id = '01564000-0000-0000-0000-000000000010'),
  '2026-06-05 09:00:00+00'::timestamptz,
  'AC-OBX-064-A: the mirror still reflects T2 — T1''s stale write did NOT clobber the successor generation''s witness (the round-5 EXISTS bug)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CASE B — SAME ROW, BUMPED GENERATION (a reclaim). The row stays `held` but at a HIGHER generation
-- than the one this writer was produced under. The generation compare — not just the state — must reject.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.mint_held('r', '01564000-0000-0000-0000-000000000020');
-- Simulate a reclaim that re-held the SAME row at a higher generation (claim_outbox_for_commit bumps the
-- token; here we advance it directly while leaving the row `held`).
update external_command_outbox
   set claim_generation = claim_generation + 3
 where id = (select id from pg_temp.h where label = 'r');

select is(
  (select record_timesheet_command_held(
     '01564000-0000-0000-0000-000000000001','01564000-0000-0000-0000-000000000020',
     '2026-06-08 09:00:00+00',
     'command-held: recovery probe failed deterministically',
     (select id from pg_temp.h where label = 'r'), (select gen from pg_temp.h where label = 'r'))),
  'failed',
  'AC-OBX-064-B: a still-`held` row at a BUMPED generation is NOT this writer''s hold — the generation compare records `failed` (delete `and v_out_gen = p_claim_generation` and it records `held`)');

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01564000-0000-0000-0000-000000000020'),
  'failed',
  'AC-OBX-064-B: and the mirror ends `failed`, matching the fence decision');

select * from finish();
rollback;
