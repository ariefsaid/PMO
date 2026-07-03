-- 0092_agent_persistence_tenancy.test.sql — agent_threads/agent_runs/agent_events owner-only RLS
-- (ADR-0043 §1/§2, FR-AGP-007/008). Proves: owner isolation, cross-org wall (incl. Admin), the explicit
-- no-Admin-cross-owner-read divergence from user_views OD-2, INSERT org/owner pin, and soft-archive
-- hiding from the live index. Modeled on 0089_user_views_tenancy.test.sql. Fixtures inserted as the
-- table owner (bypassing RLS), then `set local role authenticated` + `set local request.jwt.claims`.
-- Fixture namespace: 00920000-…. Org A = default '00000000-…-0001'; Org B = '00920000-…-0002'.
begin;
select plan(23);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('00920000-0000-0000-0000-000000000002','Agent Persistence Tenancy Org B');

insert into auth.users (id, email) values
  ('00920000-0000-0000-0000-0000000000a1','agp-ann@example.com'),
  ('00920000-0000-0000-0000-0000000000a2','agp-bob@example.com'),
  ('00920000-0000-0000-0000-0000000000a3','agp-dana@example.com'),
  ('00920000-0000-0000-0000-0000000000b1','agp-carol@example.com'),
  ('00920000-0000-0000-0000-0000000000b2','agp-erin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00920000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AGP Ann','agp-ann@example.com','Engineer'),
  ('00920000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AGP Bob','agp-bob@example.com','Engineer'),
  ('00920000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','AGP Dana','agp-dana@example.com','Admin'),
  ('00920000-0000-0000-0000-0000000000b1','00920000-0000-0000-0000-000000000002','AGP Carol','agp-carol@example.com','Engineer'),
  ('00920000-0000-0000-0000-0000000000b2','00920000-0000-0000-0000-000000000002','AGP Erin','agp-erin@example.com','Admin');

-- Ann (org A) owns a thread + run + event.
insert into agent_threads (id, owner_id, title) values
  ('00920000-0000-0000-0000-000000000010','00920000-0000-0000-0000-0000000000a1','Ann Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('00920000-0000-0000-0000-000000000020','00920000-0000-0000-0000-000000000010','00920000-0000-0000-0000-0000000000a1','completed');
insert into agent_events (id, run_id, owner_id, seq, type, text) values
  ('00920000-0000-0000-0000-000000000030','00920000-0000-0000-0000-000000000020','00920000-0000-0000-0000-0000000000a1', 1, 'user', 'hello');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-004: owner reads own rows; non-owner in the SAME org reads zero.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00920000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from agent_threads where id = '00920000-0000-0000-0000-000000000010'), 1,
  'AC-AGP-004: owner (Ann) reads her own thread');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00920000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from agent_threads where id = '00920000-0000-0000-0000-000000000010'), 0,
  'AC-AGP-004: non-owner same-org (Bob) reads zero threads');
select is((select count(*)::int from agent_runs where id = '00920000-0000-0000-0000-000000000020'), 0,
  'AC-AGP-004: non-owner same-org (Bob) reads zero runs');
select is((select count(*)::int from agent_events where id = '00920000-0000-0000-0000-000000000030'), 0,
  'AC-AGP-004: non-owner same-org (Bob) reads zero events');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-005: cross-org read returns zero regardless of role, including Admin.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00920000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is((select count(*)::int from agent_threads where id = '00920000-0000-0000-0000-000000000010'), 0,
  'AC-AGP-005: cross-org (Carol, org B, Engineer) reads zero threads');
select is((select count(*)::int from agent_runs where id = '00920000-0000-0000-0000-000000000020'), 0,
  'AC-AGP-005: cross-org (Carol) reads zero runs');
select is((select count(*)::int from agent_events where id = '00920000-0000-0000-0000-000000000030'), 0,
  'AC-AGP-005: cross-org (Carol) reads zero events');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00920000-0000-0000-0000-0000000000b2","role":"authenticated"}';

-- Erin (org B, Admin) — cross-org Admin also gets zero.
select is((select count(*)::int from agent_threads where id = '00920000-0000-0000-0000-000000000010'), 0,
  'AC-AGP-005: cross-org Admin (Erin, org B) reads zero threads');
select is((select count(*)::int from agent_runs where id = '00920000-0000-0000-0000-000000000020'), 0,
  'AC-AGP-005: cross-org Admin (Erin) reads zero runs');
select is((select count(*)::int from agent_events where id = '00920000-0000-0000-0000-000000000030'), 0,
  'AC-AGP-005: cross-org Admin (Erin) reads zero events');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-006: Admin does NOT get cross-owner read within the SAME org (no user_views OD-2 grant).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00920000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select is((select count(*)::int from agent_threads where id = '00920000-0000-0000-0000-000000000010'), 0,
  'AC-AGP-006: same-org Admin (Dana), not owner, reads zero threads');
select is((select count(*)::int from agent_runs where id = '00920000-0000-0000-0000-000000000020'), 0,
  'AC-AGP-006: same-org Admin (Dana), not owner, reads zero runs');
select is((select count(*)::int from agent_events where id = '00920000-0000-0000-0000-000000000030'), 0,
  'AC-AGP-006: same-org Admin (Dana), not owner, reads zero events');

-- AC-AGP-006 (schema-level twin, Task A5): no SELECT policy on the three tables references auth_role —
-- the owner-only wall is total, not an Admin-widened predicate.
select is(
  (select count(*)::int from pg_policies
     where tablename in ('agent_threads','agent_runs','agent_events')
       and cmd = 'SELECT'
       and qual ilike '%auth_role%'),
  0,
  'AC-AGP-006: no SELECT policy references auth_role (owner-only wall)');
select is(
  (select count(*)::int from pg_policies
     where tablename in ('agent_threads','agent_runs','agent_events')
       and cmd = 'SELECT'
       and qual ilike '%owner_id = auth.uid()%'),
  3,
  'AC-AGP-006: every SELECT policy on the three tables gates on owner_id = auth.uid()');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-007: INSERT pins org_id and owner_id; a spoofed owner_id is rejected.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00920000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- Bob tries to insert a thread claiming Ann's owner_id — WITH CHECK rejects (owner_id must be caller's).
select throws_ok(
  $$ insert into agent_threads (owner_id, title) values ('00920000-0000-0000-0000-0000000000a1','Spoofed') $$,
  '42501', null,
  'AC-AGP-007: insert with a spoofed owner_id (another user) is denied by WITH CHECK');

-- Bob tries to insert a thread claiming Ann's org — WITH CHECK rejects (org_id must be caller's org).
select throws_ok(
  $$ insert into agent_threads (org_id, title) values ('00920000-0000-0000-0000-000000000002','Spoofed Org') $$,
  '42501', null,
  'AC-AGP-007: insert with a spoofed org_id (another org) is denied by WITH CHECK');

-- Bob's legitimate insert (no explicit owner_id/org_id) is stamped to himself.
select lives_ok(
  $$ insert into agent_threads (title) values ('Bob Own Thread') $$,
  'AC-AGP-007: insert with no explicit owner_id/org_id succeeds (stamped via defaults)');

reset role;

select is(
  (select owner_id::text from agent_threads where title = 'Bob Own Thread'),
  '00920000-0000-0000-0000-0000000000a2',
  'AC-AGP-007: the legitimate insert is stamped with the caller as owner_id');
select is(
  (select org_id::text from agent_threads where title = 'Bob Own Thread'),
  '00000000-0000-0000-0000-000000000001',
  'AC-AGP-007: the legitimate insert is stamped with the caller''s org_id');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AGP-008: soft-archive hides a thread from the live index.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00920000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into agent_threads (id, title, archived_at)
       values ('00920000-0000-0000-0000-000000000011','Archived Thread', now()) $$,
  'AC-AGP-008: owner inserts a thread with archived_at set');

select is(
  (select count(*)::int from agent_threads where owner_id = auth.uid() and archived_at is null and title = 'Archived Thread'),
  0,
  'AC-AGP-008: the live-index query (archived_at is null) excludes the archived thread');
select is(
  (select count(*)::int from agent_threads where owner_id = auth.uid() and title = 'Archived Thread'),
  1,
  'AC-AGP-008: the archived thread still exists (soft-archive, not hard-delete)');

reset role;

select * from finish();
rollback;
