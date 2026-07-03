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
select plan(18);

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

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-009: no UPDATE/DELETE on credits is permitted (append-only), for any role including the
-- granting Admin.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select throws_ok(
  $$ update credits set amount = 200 where id = '00950000-0000-0000-0000-000000000040' $$,
  '42501', null,
  'AC-AUC-009 Admin (Dana, the granting user) UPDATE on credits is denied');
select throws_ok(
  $$ delete from credits where id = '00950000-0000-0000-0000-000000000040' $$,
  '42501', null,
  'AC-AUC-009 Admin (Dana, the granting user) DELETE on credits is denied');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update credits set amount = 200 where id = '00950000-0000-0000-0000-000000000040' $$,
  '42501', null,
  'AC-AUC-009 owner (Ann) UPDATE on her own credits grant is denied');

reset role;

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
