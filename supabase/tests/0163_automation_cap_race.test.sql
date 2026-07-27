-- 0163_automation_cap_race.test.sql
-- FR-HRD-041 [pgTAP]: enforce_automation_owner_cap must not be a bare count-then-insert.
-- Evidence: 0059_agent_automation_bounds.sql:31 counts with no lock; two concurrent inserts can both
-- observe a count below the cap. 0059's own comment names the fix ("row-lock the owner's profile row
-- here if an exact cap ever matters"). The SHARE ROW EXCLUSIVE exemplar at 0065_admin_set_user_status.sql:69
-- shows the intended pattern -- note 0065:69 is the EXEMPLAR, not the defect.
--
-- Assertion 1 is anchored to BOTH the statement and its ORDER (lock before count), not just the
-- phrase "for update" — a regex over just the phrase passes when the lock is taken AFTER the count
-- (the race stays fully open) or when the phrase appears only inside a comment. Assertion 3 onward is
-- the real proof: a genuine second session (`dblink`) holds the SAME profiles-row lock this trigger
-- takes, and a concurrent INSERT is asserted to actually BLOCK on it (55P03 under a short
-- lock_timeout) — proving the serialization, not just the lock statement's presence.
--
-- ⚑ VISIBILITY (mirrors 0155_command_held_interleave's own note): pgTAP's own txn never commits
-- (begin…rollback), so a second connection cannot SEE a row this session merely INSERTed — a
-- row-level FOR UPDATE needs the row visible to BOTH sessions (unlike 0151's advisory-lock test,
-- which locks a hash and needs no row). So the org/profiles fixtures are CREATED AND COMMITTED by the
-- second session (autocommitted `dblink_exec`), and this file deletes them (also via the second
-- session) at the end; the pre-clean at the top makes a mid-run failure self-healing (a leak survives
-- at most one run, per 0155's S5 lesson). The ids are unique to this file.
--
-- ⚑ The extension is created BEFORE `begin` (not after, unlike 0151/0155) — deliberately, because
-- this file's cleanup runs AFTER this session's own `rollback` (see the note down there for why), and
-- `create extension` inside the transaction would itself be rolled back, leaving `dblink_exec`
-- undefined exactly when cleanup needs it.
create extension if not exists dblink;

begin;
select plan(7);

-- ── The concurrent session ────────────────────────────────────────────────────────────────────
select dblink_connect('cap', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));

-- Idempotent pre-clean: erase a leaked previous run before re-creating.
select dblink_exec('cap', $pre$
  delete from agent_automations where org_id = '01630000-0000-0000-0000-000000000001';
  delete from profiles          where org_id = '01630000-0000-0000-0000-000000000001';
  delete from organizations     where id     = '01630000-0000-0000-0000-000000000001';
  delete from auth.users        where id in ('01630000-0000-0000-0000-0000000000a1',
                                              '01630000-0000-0000-0000-0000000000a2');
$pre$);

-- Fixtures COMMITTED by the second session so both sessions can see + row-lock them.
select dblink_exec('cap', $fx$
  insert into organizations (id, name) values
    ('01630000-0000-0000-0000-000000000001','FR-HRD-041 Org');
  insert into auth.users (id, email) values
    ('01630000-0000-0000-0000-0000000000a1','cap-race@example.com'),
    ('01630000-0000-0000-0000-0000000000a2','cap-race-other@example.com');
  insert into profiles (id, org_id, full_name, email, role) values
    ('01630000-0000-0000-0000-0000000000a1','01630000-0000-0000-0000-000000000001',
     'Cap Race','cap-race@example.com','Admin'),
    ('01630000-0000-0000-0000-0000000000a2','01630000-0000-0000-0000-000000000001',
     'Cap Race Other','cap-race-other@example.com','Admin');
$fx$);

-- 1. The cap trigger locks the owner's profiles row BEFORE counting — anchored to statement AND
-- order, so "lock after count" and "the phrase inside a comment only" both still fail this.
select matches(
  pg_get_functiondef('public.enforce_automation_owner_cap()'::regprocedure),
  'from public\.profiles where id = new\.owner_id for update(.|\n)*count\(\*\)',
  'FR-HRD-041 the cap trigger locks the owner row BEFORE counting (no bare count-then-insert, no reordering)');

select is(
  (select prosecdef from pg_proc where oid = 'public.enforce_automation_owner_cap()'::regprocedure),
  true,
  'FR-HRD-041 the cap trigger is security definer (RLS cannot hide the owner row and skip the lock)');

-- ── 3. THE REAL PROOF: the second session opens a txn and holds the owner row's FOR UPDATE lock ──
select dblink_exec('cap', 'begin');
select ok(
  (select count(*)::int from dblink('cap', format(
     $q$select id from public.profiles where id = %L for update$q$,
     '01630000-0000-0000-0000-0000000000a1'))
     as t(id uuid)) = 1,
  'FR-HRD-041 setup: a second session holds the owner''s profiles row FOR UPDATE');

-- A concurrent automation INSERT for the SAME owner must WAIT for that lock. lock_timeout (not
-- statement_timeout) fires ONLY on a lock wait, so this cannot be satisfied by a merely-slow insert.
set local lock_timeout = '1500ms';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01630000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
     values ('01630000-0000-0000-0000-000000000001',
             '01630000-0000-0000-0000-0000000000a1','schedule','concurrent insert','0 0 * * *',120) $$,
  '55P03', 'canceling statement due to lock timeout',
  'FR-HRD-041 a concurrent INSERT for the SAME owner WAITS for the row lock (delete the lock and it sails through instead)');
reset role;
set local lock_timeout = 0;

select is(
  (select count(*)::int from public.agent_automations
     where org_id = '01630000-0000-0000-0000-000000000001'),
  0,
  'FR-HRD-041 the blocked INSERT wrote no automation row (it never got past the lock)');

-- Release the second session's lock (nothing was modified there, so a rollback frees it cleanly).
select dblink_exec('cap', 'rollback');

-- 6. MEDIUM-1 (security-auditor, 2026-07-28): making the trigger SECURITY DEFINER lets its BEFORE ROW
-- body run (as postgres, bypassing RLS) before agent_automations_insert's WITH CHECK would reject an
-- owner_id the caller does not own -- without an explicit guard this becomes a cross-org existence
-- oracle (23503 unknown-owner vs P0001 at-cap vs eventual 42501 distinguish 3 states for an owner_id
-- that isn't the caller's). Assert the explicit guard rejects a mismatched owner_id BEFORE any of that.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01630000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
     values ('01630000-0000-0000-0000-000000000001',
             '01630000-0000-0000-0000-0000000000a2','schedule','not my owner','0 0 * * *',120) $$,
  '42501', 'not authorized',
  'FR-HRD-041 an authenticated caller cannot INSERT an automation for a DIFFERENT owner_id (no cross-org existence oracle)');

-- 7. No regression: with the lock free, 25 normal inserts succeed and the 26th still fails the cap.
insert into public.agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
select '01630000-0000-0000-0000-000000000001',
       '01630000-0000-0000-0000-0000000000a1',
       'schedule', 'cap fill ' || g, '0 0 * * *', 120
  from generate_series(1,25) g;

select throws_ok(
  $$ insert into public.agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
     values ('01630000-0000-0000-0000-000000000001',
             '01630000-0000-0000-0000-0000000000a1','schedule','over cap','0 0 * * *',120) $$,
  'P0001', null,
  'FR-HRD-041 the 26th active automation for an owner is still rejected (no regression)');
reset role;

select * from finish();
rollback;

-- ── Cleanup: AFTER this session's own rollback, not before (deliberately different from 0151/0155's
-- ordering). Unlike those files, THIS session's own regression inserts (the 25-fill + the 26th-over-
-- cap attempt, both above) each ran the trigger's `FOR UPDATE` on the SAME owner profiles row, and
-- that lock is held for the rest of the primary transaction (row locks release at COMMIT/ROLLBACK,
-- not at statement end). Deleting `profiles` from the second session BEFORE this session's own
-- rollback would deadlock across the dblink boundary: the second session waits on this session's
-- lock, while this session is blocked waiting on the dblink call to return — the exact self-deadlock
-- 0155's header warns about, just triggered by a different source (there, a stray record call; here,
-- the regression fixture itself). `rollback;` above releases every lock this session held, so the
-- second session's delete below is then uncontended.
select dblink_exec('cap', $cl$
  delete from agent_automations where org_id = '01630000-0000-0000-0000-000000000001';
  delete from profiles          where org_id = '01630000-0000-0000-0000-000000000001';
  delete from organizations     where id     = '01630000-0000-0000-0000-000000000001';
  delete from auth.users        where id in ('01630000-0000-0000-0000-0000000000a1',
                                              '01630000-0000-0000-0000-0000000000a2');
$cl$);
select dblink_disconnect('cap');
