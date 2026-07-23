-- 0155_command_held_interleave.test.sql
-- AC-OBX-063 (Luna FU-1a round-6, BLOCK 1) — THE RELEASE-BEFORE-MIRROR INTERLEAVE, IN TWO REAL SESSIONS.
--
-- ⚑ WHY A SERIAL TEST IS INSUFFICIENT (and round-5's was serial). Round-5's recorder read the fence with
-- an un-locked `EXISTS` and INSERTed the mirror in a SEPARATE step. A release could interleave BETWEEN
-- the read and the write: the recorder sampled `EXISTS = true`, was descheduled, the release committed
-- the outbox to `failed`, and the recorder resumed and wrote `held` — outbox `failed` + mirror `held`,
-- the exact dead end. A serial "release fully, THEN record" test never exercises that window, so it
-- stayed green while the race was open.
--
-- The fix makes the recorder LOCK the exact outbox row (`SELECT … FOR UPDATE`) and re-read its COMMITTED
-- state before writing the mirror. `release_outbox_hold` (0152 §A) takes the SAME `FOR UPDATE` lock, so
-- the two serialize on the row: the recorder cannot read-and-write while a release holds it — it WAITS,
-- and once the release commits it re-reads `failed` and records `failed`. This file drives that ordering
-- with a genuinely concurrent session (`dblink`) holding the row lock, and asserts the two properties the
-- lock gives us:
--   (1) the recorder BLOCKS on the exact row while the second session holds it (delete the `FOR UPDATE`
--       and it sails through, reading stale `held` — the mutation this asserts catches);
--   (2) once that session commits the row to `failed` and releases the lock, the recorder re-reads the
--       committed state and records `failed`, NEVER `held`.
--
-- ⚑ VISIBILITY — why the fixtures are COMMITTED by the second session, not inserted in this txn. pgTAP's
-- own txn never commits (begin…rollback), so a second connection cannot SEE a row this session inserted —
-- a row-level `FOR UPDATE` needs the row visible to BOTH sessions (unlike 0151's advisory-lock test,
-- which locks a hash and needs no row). So the concurrent session both CREATES the fixture (committed,
-- autocommitted `dblink_exec`) and locks it, and this file DELETES it (also via the second session) at
-- the end. The ids are unique to this file; any leak from a mid-run failure is wiped by the next
-- `supabase db reset` (every run resets first).
begin;
select plan(4);

create extension if not exists dblink;

-- ── The concurrent session (loopback connect: same pattern as 0151_timesheet_fence_concurrency; built
-- from this server's own address; password=postgres is the Supabase LOCAL default; this file only runs
-- against the local/CI `supabase test db`). ──────────────────────────────────────────────────────────
select dblink_connect('il', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));

-- Fixtures COMMITTED by the second session so both sessions can see + row-lock them. A held timesheet
-- outbox row is inserted DIRECTLY (state='held', claim_generation=1) — this file tests the recorder's
-- lock/re-read, not the mint fences (those own their own tests).
select dblink_exec('il', $fx$
  insert into organizations (id, name) values
    ('01563000-0000-0000-0000-000000000001','TS Interleave Org');
  insert into auth.users (id, email) values
    ('01563000-0000-0000-0000-0000000000a1','il-owner@example.com');
  insert into profiles (id, org_id, full_name, email, role, manager_id) values
    ('01563000-0000-0000-0000-0000000000a1','01563000-0000-0000-0000-000000000001',
     'Owner I','il-owner@example.com','Engineer', null);
  insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
    ('01563000-0000-0000-0000-000000000010','01563000-0000-0000-0000-000000000001',
     '01563000-0000-0000-0000-0000000000a1','2026-06-01','Approved','01563000-0000-0000-0000-0000000000a1', now());
  insert into external_command_outbox
    (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation)
  values ('01563000-0000-0000-0000-0000000000c1','01563000-0000-0000-0000-000000000001','timesheets',
          '01563000-0000-0000-0000-000000000010','ts-interleave','erpnext','create','held',1);
$fx$);

-- The concurrent session opens a txn and takes the outbox row's FOR UPDATE lock, holding it.
select dblink_exec('il', 'begin');
select ok(
  (select count(*)::int from dblink('il',
     $q$select id::text from external_command_outbox where id = '01563000-0000-0000-0000-0000000000c1' for update$q$)
     as t(id text)) = 1,
  'AC-OBX-063 setup: the second session holds the outbox row''s FOR UPDATE lock');

-- ── (1) the recorder BLOCKS on that exact row ──────────────────────────────
-- `lock_timeout` fires ONLY on a lock wait, so 55P03 here means the recorder tried to FOR-UPDATE the row
-- and could not — i.e. it locks the exact row before it decides. Delete the `FOR UPDATE` from the RPC and
-- this call returns instead (reading stale `held`) and the assertion fails: that is the mutation it catches.
set local lock_timeout = '1500ms';
select throws_ok(
  $$ select record_timesheet_command_held(
       '01563000-0000-0000-0000-000000000001'::uuid,
       '01563000-0000-0000-0000-000000000010'::uuid,
       now(),
       'command-held: recovery probe failed deterministically',
       '01563000-0000-0000-0000-0000000000c1'::uuid, 1) $$,
  '55P03',
  'canceling statement due to lock timeout',
  'AC-OBX-063(1): the recorder WAITS for the outbox row''s lock — it locks the exact row before it decides (delete FOR UPDATE and it reads stale `held` instead)');
set local lock_timeout = 0;

select is(
  (select count(*)::int from timesheet_erp_mirror where timesheet_id = '01563000-0000-0000-0000-000000000010'),
  0,
  'AC-OBX-063(1): the blocked recorder wrote NO mirror row (it never got past the lock)');

-- ── (2) the release wins the row, commits `failed`; the recorder then re-reads and records `failed` ──
select dblink_exec('il',
  $q$update external_command_outbox set state='failed', claim_generation=claim_generation+1, updated_at=now()
       where id='01563000-0000-0000-0000-0000000000c1'$q$);
select dblink_exec('il', 'commit');

-- The delayed recorder resumes with its (now stale) id + generation. ⚑ It runs IN THE SECOND SESSION
-- (committed context) so THIS pgTAP session never writes the mirror or holds the outbox row lock — a
-- record call in this session would leave an uncommitted child + a row lock, and the cleanup delete in
-- the other session would then wait on it while this session waits on the dblink call (a self-deadlock
-- across the dblink boundary that Postgres cannot detect). The recorder re-reads the committed `failed`
-- outbox and records `failed`; this session then reads that committed mirror row and asserts.
select record_r
  from dblink('il', $rec$
    select public.record_timesheet_command_held(
      '01563000-0000-0000-0000-000000000001'::uuid,
      '01563000-0000-0000-0000-000000000010'::uuid,
      now(),
      'command-held: recovery probe failed deterministically',
      '01563000-0000-0000-0000-0000000000c1'::uuid, 1)::text
  $rec$) as t(record_r text);

select is(
  (select push_state from timesheet_erp_mirror where timesheet_id = '01563000-0000-0000-0000-000000000010'),
  'failed',
  'AC-OBX-063(2): after the release committed the row, the recorder re-read it and recorded `failed`, never `held` — the release-before-mirror dead end is unreachable');

-- ── Cleanup: the second session removes the committed fixtures (this session holds none of them). ──
select dblink_exec('il', $cl$
  delete from timesheet_erp_mirror     where org_id = '01563000-0000-0000-0000-000000000001';
  delete from external_command_outbox  where org_id = '01563000-0000-0000-0000-000000000001';
  delete from timesheets               where org_id = '01563000-0000-0000-0000-000000000001';
  delete from profiles                 where org_id = '01563000-0000-0000-0000-000000000001';
  delete from organizations            where id     = '01563000-0000-0000-0000-000000000001';
  delete from auth.users               where id     = '01563000-0000-0000-0000-0000000000a1';
$cl$);
select dblink_disconnect('il');

select * from finish();
rollback;
