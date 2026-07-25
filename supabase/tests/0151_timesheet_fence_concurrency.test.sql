-- 0151_timesheet_fence_concurrency.test.sql
-- AC-TSC-R6 (Luna SHOULD-FIX 5a) — THE LOCK IS UNDER TEST, IN TWO REAL SESSIONS.
--
-- Every other assertion about the re-open fence is SEQUENTIAL, so deleting both
-- `pg_advisory_xact_lock` calls left them all green: they prove the STATUS predicates, never the
-- serialization. But the money property here is precisely the serialization — a status check that is
-- not inside the same lock as the write it guards is a TOCTOU, and PMO going `Draft` while ERPNext is
-- handed the same week's hours is how a client's project cost double-counts.
--
-- So this file uses a SECOND, genuinely concurrent session (`dblink`) that holds the sheet's
-- `ts-correct:` advisory lock in its own open transaction. Under a short `lock_timeout`, each guarded
-- entry point must BLOCK (55P03 — it waited for that lock and never got it). Delete the
-- `pg_advisory_xact_lock` from any of the three and that call sails through instead: `lock_timeout`
-- only ever fires on a LOCK WAIT, so there is nothing else it could report. That is the mutation this
-- file exists to catch.
--
-- Entry points covered — all three doors into a timesheet's ERP identity:
--   (1) `transition_timesheet(... ,'Draft')`        — the re-open;
--   (2) `insert_timesheet_outbox_pending(...)`      — the push MINT (sync dispatch + sweep absent queue);
--   (3) `claim_outbox_for_commit(...)`              — the push RE-DRIVE (foreground Retry + sweep).
--
-- ⚑ Limitation, stated plainly: the concurrent session holds the lock and never releases it, so what is
-- proven is "the guarded path waits for THIS sheet's lock" (and, by the key, that it is the SAME lock
-- the other paths take — see 0151_timesheet_uuid_identity / _claim_guard for the key identity). It does
-- not simulate a full interleaved commit ordering; the status re-check inside the lock is proven by the
-- precondition/claim-guard files.
begin;
select plan(6);

create extension if not exists dblink;

insert into organizations (id, name) values
  ('01516000-0000-0000-0000-000000000001','TS Fence Concurrency Org');

insert into auth.users (id, email) values
  ('01516000-0000-0000-0000-0000000000a1','fence-owner@example.com'),
  ('01516000-0000-0000-0000-0000000000a2','fence-mgr@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01516000-0000-0000-0000-0000000000a1','01516000-0000-0000-0000-000000000001',
   'Owner U','fence-owner@example.com','Engineer','01516000-0000-0000-0000-0000000000a2'),
  ('01516000-0000-0000-0000-0000000000a2','01516000-0000-0000-0000-000000000001',
   'Manager M','fence-mgr@example.com','Engineer', null);

insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01516000-0000-0000-0000-000000000010','01516000-0000-0000-0000-000000000001',
   '01516000-0000-0000-0000-0000000000a1','2026-06-01','Approved',
   '01516000-0000-0000-0000-0000000000a2', now()),   -- (1) the re-open
  ('01516000-0000-0000-0000-000000000011','01516000-0000-0000-0000-000000000001',
   '01516000-0000-0000-0000-0000000000a1','2026-06-08','Approved',
   '01516000-0000-0000-0000-0000000000a2', now()),   -- (2) the push mint
  ('01516000-0000-0000-0000-000000000012','01516000-0000-0000-0000-000000000001',
   '01516000-0000-0000-0000-0000000000a1','2026-06-15','Approved',
   '01516000-0000-0000-0000-0000000000a2', now());   -- (3) the push re-drive

-- The row the re-drive claims. Inserted directly: it stands for a row a service-role writer created in
-- an EARLIER transaction (using the guard RPC here would take this session's own ts-correct lock and
-- the claim would then never contend for it — the test would prove nothing).
insert into external_command_outbox
  (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('01516000-0000-0000-0000-000000000001','timesheets','01516000-0000-0000-0000-000000000012',
   'ts-fence-3','erpnext','create','failed');

-- ── The concurrent session: takes each sheet's ts-correct lock and HOLDS it ──
-- The connection is built from THIS session's own server address, so it works wherever the local stack
-- runs (dev machine or CI) without a hard-coded host. `password=postgres` is the Supabase LOCAL default
-- and nothing else: this file only ever runs against `supabase test db` on the local/CI stack, and
-- dblink REFUSES a passwordless connect for a non-superuser anyway (so a loopback/trust route cannot be
-- used here even if one existed). No production credential is involved.
select dblink_connect('fence', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('fence', 'begin');
select ok(
  (select count(*)::int from dblink('fence', format(
     $q$select pg_advisory_xact_lock(%s), pg_advisory_xact_lock(%s), pg_advisory_xact_lock(%s)$q$,
     hashtextextended('ts-correct:01516000-0000-0000-0000-000000000010', 0),
     hashtextextended('ts-correct:01516000-0000-0000-0000-000000000011', 0),
     hashtextextended('ts-correct:01516000-0000-0000-0000-000000000012', 0)))
     as t(a text, b text, c text)) = 1,
  'AC-TSC-R6 setup: a second session holds all three sheets'' ts-correct advisory locks');

-- A guarded path must WAIT for that lock. `lock_timeout` (NOT statement_timeout): it fires ONLY on a
-- lock wait, so the assertion cannot be satisfied by a slow query — and unlike a query cancel it is an
-- ordinary trappable error, which is what lets `throws_ok` assert it.
set local lock_timeout = '1500ms';

-- ── (1) the RE-OPEN blocks ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01516000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_timesheet('01516000-0000-0000-0000-000000000010','Draft') $$,
  '55P03',
  'canceling statement due to lock timeout',
  'AC-TSC-R6(1): the Approved→Draft re-open WAITS for the sheet''s ts-correct lock (delete the lock and it commits Draft instead)');
reset role;
select is(
  (select status from timesheets where id = '01516000-0000-0000-0000-000000000010'),
  'Approved'::timesheet_status,
  'AC-TSC-R6(1): the blocked re-open changed nothing');

-- ── (2) the push MINT blocks ──────────────────────────────────────────────
select throws_ok(
  $$ select public.insert_timesheet_outbox_pending(
       p_org:='01516000-0000-0000-0000-000000000001'::uuid, p_domain:='timesheets',
       p_record_id:='01516000-0000-0000-0000-000000000011', p_key:='ts-fence-2',
       p_tier:='erpnext', p_operation:='create', p_payload:=null, p_digest:=null, p_actor:=null) $$,
  '55P03',
  'canceling statement due to lock timeout',
  'AC-TSC-R6(2): the push INSERT waits for the same lock (delete it and a re-opened week''s hours get minted)');
select is(
  (select count(*)::int from external_command_outbox where idempotency_key = 'ts-fence-2'),
  0,
  'AC-TSC-R6(2): the blocked mint wrote no outbox row');

-- ── (3) the push RE-DRIVE (claim) blocks ──────────────────────────────────
select throws_ok(
  $$ select public.claim_outbox_for_commit(
       (select id from external_command_outbox where idempotency_key = 'ts-fence-3')) $$,
  '55P03',
  'canceling statement due to lock timeout',
  'AC-TSC-R6(3): the CLAIM waits for the same lock (delete it and a stale failed row is re-driven past a re-open)');

set local lock_timeout = 0;
select dblink_disconnect('fence');

select * from finish();
rollback;
