-- 0095_agent_usage_credits_tenancy.test.sql — agent_usage/credits owner-only RLS
-- (docs/specs/agent-usage-credits.spec.md, ADR-0044 §6). Proves: owner isolation, cross-org wall
-- (incl. Admin), Admin does NOT get a same-org cross-owner read on agent_usage (identical to a
-- non-Admin non-owner — no divergence like agent_persistence's), credits INSERT is Admin-only
-- (the family's first Admin-only INSERT policy), agent_usage INSERT is owner-pinned (spoofed
-- owner_id denied), and credits permits no UPDATE/DELETE for any role (append-only by omission).
-- Modeled on 0092_agent_persistence_tenancy.test.sql. Fixtures inserted as the table owner
-- (bypassing RLS), then `set local role authenticated` + `set local request.jwt.claims`.
-- Fixture namespace: 00950000-…. Org A = default '00000000-…-0001'; Org B = '00950000-…-0002'.
begin;
select plan(22);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into organizations (id, name) values
  ('00950000-0000-0000-0000-000000000002','Agent Usage Credits Tenancy Org B');

insert into auth.users (id, email) values
  ('00950000-0000-0000-0000-0000000000a1','auc-ann@example.com'),
  ('00950000-0000-0000-0000-0000000000a2','auc-bob@example.com'),
  ('00950000-0000-0000-0000-0000000000a3','auc-dana@example.com'),
  ('00950000-0000-0000-0000-0000000000b1','auc-carol@example.com'),
  ('00950000-0000-0000-0000-0000000000b2','auc-erin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00950000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AUC Ann','auc-ann@example.com','Engineer'),
  ('00950000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AUC Bob','auc-bob@example.com','Engineer'),
  ('00950000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','AUC Dana','auc-dana@example.com','Admin'),
  ('00950000-0000-0000-0000-0000000000b1','00950000-0000-0000-0000-000000000002','AUC Carol','auc-carol@example.com','Engineer'),
  ('00950000-0000-0000-0000-0000000000b2','00950000-0000-0000-0000-000000000002','AUC Erin','auc-erin@example.com','Admin');

-- Ann (org A) owns a thread + run so agent_usage.run_id has a legitimate FK target, one agent_usage
-- row, and one credits grant.
insert into agent_threads (id, owner_id, title) values
  ('00950000-0000-0000-0000-000000000010','00950000-0000-0000-0000-0000000000a1','Ann Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('00950000-0000-0000-0000-000000000020','00950000-0000-0000-0000-000000000010','00950000-0000-0000-0000-0000000000a1','completed');
insert into agent_usage (id, owner_id, run_id, model, cost) values
  ('00950000-0000-0000-0000-000000000030','00950000-0000-0000-0000-0000000000a1','00950000-0000-0000-0000-000000000020','test-model', 10);
insert into credits (id, owner_id, amount, granted_by) values
  ('00950000-0000-0000-0000-000000000040','00950000-0000-0000-0000-0000000000a1', 50, '00950000-0000-0000-0000-0000000000a3');

-- Bob (org A) owns his own thread + run (Task 3 — agent_usage INSERT run_id FK-ownership fixture,
-- modeled on 0092's fixture style) so the run_id-ownership WITH CHECK can be proven both ways:
-- a caller-owned run succeeds, another user's run (Ann's, above) is denied.
insert into agent_threads (id, owner_id, title) values
  ('00950000-0000-0000-0000-000000000011','00950000-0000-0000-0000-0000000000a2','Bob Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('00950000-0000-0000-0000-000000000021','00950000-0000-0000-0000-000000000011','00950000-0000-0000-0000-0000000000a2','completed');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-004: owner reads own usage rows; non-owner in the SAME org reads zero.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from agent_usage where id = '00950000-0000-0000-0000-000000000030'), 1,
  'AC-AUC-004 owner (Ann) reads her own agent_usage row');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from agent_usage where id = '00950000-0000-0000-0000-000000000030'), 0,
  'AC-AUC-004 non-owner same-org (Bob) reads zero agent_usage rows');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-005: cross-org read returns zero regardless of role, including Admin.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is((select count(*)::int from agent_usage where id = '00950000-0000-0000-0000-000000000030'), 0,
  'AC-AUC-005 cross-org (Carol, org B, Engineer) reads zero agent_usage rows');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000b2","role":"authenticated"}';

select is((select count(*)::int from agent_usage where id = '00950000-0000-0000-0000-000000000030'), 0,
  'AC-AUC-005 cross-org Admin (Erin, org B) reads zero agent_usage rows');

reset role;

-- Same-org Admin (Dana), not owner: behaves identically to Bob — no Admin-widened read (unlike
-- agent_persistence's own explicit divergence note, this spec never calls out a grant either).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select is((select count(*)::int from agent_usage where id = '00950000-0000-0000-0000-000000000030'), 0,
  'AC-AUC-005 same-org Admin (Dana), not owner, reads zero agent_usage rows (no Admin-widened read)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-006: a user can read their own credits grants; cannot read another user's.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from credits where id = '00950000-0000-0000-0000-000000000040'), 1,
  'AC-AUC-006 owner (Ann) reads her own credits grant');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from credits where id = '00950000-0000-0000-0000-000000000040'), 0,
  'AC-AUC-006 non-owner same-org (Bob) reads zero of Ann''s credits grants');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-007: only an Admin can INSERT a credits row; a non-Admin insert is denied.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into credits (owner_id, amount) values ('00950000-0000-0000-0000-0000000000a2', 50) $$,
  '42501', null,
  'AC-AUC-007 non-Admin (Bob) inserting a credits grant for himself is denied');
select throws_ok(
  $$ insert into credits (owner_id, amount) values ('00950000-0000-0000-0000-0000000000a1', 50) $$,
  '42501', null,
  'AC-AUC-007 non-Admin (Bob) inserting a credits grant for another user (Ann) is denied');

reset role;

-- An Admin (Dana, org A) CAN insert a credits grant — confirms the policy is affirmatively
-- Admin-gated, not merely "nobody can insert".
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ insert into credits (id, owner_id, amount) values
      ('00950000-0000-0000-0000-000000000041','00950000-0000-0000-0000-0000000000a2', 25) $$,
  'AC-AUC-007 Admin (Dana) inserting a credits grant for another user (Bob) succeeds');

-- Security review LOW-1: Dana (org A Admin) granting credits to Carol (org B owner_id) is denied —
-- org_id itself is caller-pinned, but owner_id must also resolve to a profile in the caller's org.
select throws_ok(
  $$ insert into credits (owner_id, amount) values ('00950000-0000-0000-0000-0000000000b1', 25) $$,
  '42501', null,
  'AC-AUC-SEC-LOW-1 Admin (Dana, org A) granting credits to a cross-org owner_id (Carol, org B) is denied');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-008: agent_usage INSERT is owner-pinned; a spoofed owner_id is rejected.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ insert into agent_usage (owner_id, model, cost) values ('00950000-0000-0000-0000-0000000000a1', 'test-model', 1) $$,
  '42501', null,
  'AC-AUC-008 Bob inserting agent_usage with a spoofed owner_id (Ann) is denied');

select lives_ok(
  $$ insert into agent_usage (owner_id, model, cost) values ('00950000-0000-0000-0000-0000000000a2', 'test-model', 1) $$,
  'AC-AUC-008 Bob inserting agent_usage with his own owner_id succeeds');

-- Spec Minor (item 3): agent_usage INSERT run_id FK-ownership, both directions.
select lives_ok(
  $$ insert into agent_usage (owner_id, run_id, model, cost) values
      ('00950000-0000-0000-0000-0000000000a2','00950000-0000-0000-0000-000000000021','test-model', 1) $$,
  'AC-AUC-008 Bob inserting agent_usage with a run_id of a run he owns succeeds');

select throws_ok(
  $$ insert into agent_usage (owner_id, run_id, model, cost) values
      ('00950000-0000-0000-0000-0000000000a2','00950000-0000-0000-0000-000000000020','test-model', 1) $$,
  '42501', null,
  'AC-AUC-008 Bob inserting agent_usage with a run_id of ANOTHER user''s run (Ann''s) is denied');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-009: no UPDATE/DELETE on credits is permitted (append-only), for any role including the
-- granting Admin. RLS has no UPDATE/DELETE policy on credits at all — the USING clause for those
-- commands defaults to "no rows visible", so the statement itself does not raise (no policy exists
-- to violate); it silently matches and mutates zero rows. The proof is that the row is UNCHANGED
-- afterward, not that the statement throws (contrast with agent_events, which has an explicit
-- UPDATE policy + a raise-exception trigger — a different mechanism).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ update credits set amount = 200 where id = '00950000-0000-0000-0000-000000000040' $$,
  'AC-AUC-009 Admin (Dana, the granting user) UPDATE statement runs but matches zero rows (no UPDATE policy)');
select lives_ok(
  $$ delete from credits where id = '00950000-0000-0000-0000-000000000040' $$,
  'AC-AUC-009 Admin (Dana, the granting user) DELETE statement runs but matches zero rows (no DELETE policy)');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update credits set amount = 200 where id = '00950000-0000-0000-0000-000000000040' $$,
  'AC-AUC-009 owner (Ann) UPDATE statement on her own credits grant runs but matches zero rows (no UPDATE policy)');

reset role;

-- Confirm the row genuinely survived every attempt above, unchanged (bypassing RLS as table owner).
select is(
  (select amount from credits where id = '00950000-0000-0000-0000-000000000040'),
  50::numeric,
  'AC-AUC-009 the credits row is unchanged after all UPDATE/DELETE attempts (append-only holds)');

-- AC-AUC-009 (schema-level twin, Task A5): no UPDATE/DELETE policy exists on credits at all
-- (append-only by omission).
select is(
  (select count(*)::int from pg_policies
     where tablename = 'credits' and cmd in ('UPDATE','DELETE')),
  0,
  'AC-AUC-009 no UPDATE/DELETE policy exists on credits (append-only by omission)');

-- ── Task A5: no unintended RLS widening on agent_usage/credits SELECT ───────
select is(
  (select count(*)::int from pg_policies
     where tablename in ('agent_usage','credits')
       and cmd = 'SELECT'
       and qual ilike '%owner_id = auth.uid()%'),
  2,
  'AC-AUC-005/007 every SELECT policy on agent_usage/credits gates on owner_id = auth.uid()');
select is(
  (select count(*)::int from pg_policies
     where tablename in ('agent_usage','credits')
       and cmd = 'SELECT'
       and qual ilike '%auth_role%'),
  0,
  'AC-AUC-005/007 no SELECT policy on agent_usage/credits references auth_role (owner-only wall)');

select * from finish();
rollback;
