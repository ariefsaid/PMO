-- 0095_agent_usage_credits_tenancy.test.sql — agent_usage/credits RLS
-- (docs/specs/agent-usage-credits.spec.md, ADR-0044 §6). AMENDED by ADR-0049 / ops-admin-surface:
-- credits are now an ORG POOL (FR-CRE-001/003) — credits SELECT is own-org Admin+Executive (the
-- grants view) and credits INSERT is Operator-ONLY (the 0047 revenue-hole fix). agent_usage is
-- UNCHANGED (owner-only SELECT/INSERT, append-only). This test proves both the unchanged
-- agent_usage tenancy AND the new credits org-pool RLS. Fixtures inserted as the table owner
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
  ('00950000-0000-0000-0000-0000000000a4','auc-owen@example.com'),
  ('00950000-0000-0000-0000-0000000000b1','auc-carol@example.com'),
  ('00950000-0000-0000-0000-0000000000b2','auc-erin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00950000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AUC Ann','auc-ann@example.com','Engineer'),
  ('00950000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AUC Bob','auc-bob@example.com','Engineer'),
  ('00950000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','AUC Dana','auc-dana@example.com','Admin'),
  ('00950000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000001','AUC Owen','auc-owen@example.com','Admin'),
  ('00950000-0000-0000-0000-0000000000b1','00950000-0000-0000-0000-000000000002','AUC Carol','auc-carol@example.com','Engineer'),
  ('00950000-0000-0000-0000-0000000000b2','00950000-0000-0000-0000-000000000002','AUC Erin','auc-erin@example.com','Admin');
-- Owen is the org-A Operator (platform grant; ADR-0049).
insert into platform_operators (user_id) values ('00950000-0000-0000-0000-0000000000a4');

-- Ann (org A) owns a thread + run so agent_usage.run_id has a legitimate FK target, one agent_usage
-- row, and one credits grant (legacy per-user grant, owner_id=Ann — still counts in the org pool).
insert into agent_threads (id, owner_id, title) values
  ('00950000-0000-0000-0000-000000000010','00950000-0000-0000-0000-0000000000a1','Ann Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('00950000-0000-0000-0000-000000000020','00950000-0000-0000-0000-000000000010','00950000-0000-0000-0000-0000000000a1','completed');
insert into agent_usage (id, owner_id, run_id, model, cost) values
  ('00950000-0000-0000-0000-000000000030','00950000-0000-0000-0000-0000000000a1','00950000-0000-0000-0000-000000000020','test-model', 10);
insert into credits (id, org_id, owner_id, amount, granted_by) values
  ('00950000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','00950000-0000-0000-0000-0000000000a1', 50, '00950000-0000-0000-0000-0000000000a3');

-- Bob (org A) owns his own thread + run (agent_usage INSERT run_id FK-ownership fixture) so the
-- run_id-ownership WITH CHECK can be proven both ways.
insert into agent_threads (id, owner_id, title) values
  ('00950000-0000-0000-0000-000000000011','00950000-0000-0000-0000-0000000000a2','Bob Thread');
insert into agent_runs (id, thread_id, owner_id, status) values
  ('00950000-0000-0000-0000-000000000021','00950000-0000-0000-0000-000000000011','00950000-0000-0000-0000-0000000000a2','completed');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-004: owner reads own usage rows; non-owner in the SAME org reads zero. (UNCHANGED)
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
-- AC-AUC-005: cross-org read returns zero regardless of role, including Admin. (UNCHANGED)
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
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from agent_usage where id = '00950000-0000-0000-0000-000000000030'), 0,
  'AC-AUC-005 same-org Admin (Dana), not owner, reads zero agent_usage rows (no Admin-widened read)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-006 (AMENDED by ADR-0049): credits SELECT is own-org Admin+Executive (the grants view).
-- An Engineer reads ZERO; an org Admin reads ALL their org's grants (incl. another user's); a
-- cross-org Admin reads zero. Credits are an org pool, not per-owner.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from credits where id = '00950000-0000-0000-0000-000000000040'), 1,
  'AC-AUC-006 org-A Admin (Dana) reads org-A credits grant (own-org Admin grants view)');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from credits where id = '00950000-0000-0000-0000-000000000040'), 0,
  'AC-AUC-006 org-A Engineer (Ann) reads zero credits (no grants view for non-Admin/Exec)');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from credits where id = '00950000-0000-0000-0000-000000000040'), 0,
  'AC-AUC-006 cross-org Admin (Erin, org B) reads zero org-A credits');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-007 (AMENDED by ADR-0049): credits INSERT is Operator-ONLY (the 0047 revenue-hole fix).
-- An org-Admin can no longer self-grant credits; only a platform Operator can.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ insert into credits (owner_id, amount) values ('00950000-0000-0000-0000-0000000000a2', 25) $$,
  '42501', null,
  'AC-AUC-007 org-Admin (Dana) credits INSERT denied (Operator-only — revenue hole closed)');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ insert into credits (owner_id, amount) values ('00950000-0000-0000-0000-0000000000a2', 25) $$,
  '42501', null,
  'AC-AUC-007 non-Admin/non-Operator (Bob) credits INSERT denied');
reset role;
-- Owen (org-A Operator) CAN insert a credits grant — confirms the policy is affirmatively
-- Operator-gated, not merely "nobody can insert". New grants write owner_id IS NULL (org pool).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok(
  $$ insert into credits (id, owner_id, amount) values
      ('00950000-0000-0000-0000-000000000041', null, 25) $$,
  'AC-AUC-007 Operator (Owen) credits INSERT succeeds (owner_id NULL — org-pool grant)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-008: agent_usage INSERT is owner-pinned; a spoofed owner_id is rejected. (UNCHANGED)
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
-- AC-AUC-009: no UPDATE/DELETE on credits is permitted (append-only), for any role. (UNCHANGED)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00950000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ update credits set amount = 200 where id = '00950000-0000-0000-0000-000000000040' $$,
  'AC-AUC-009 Admin (Dana) UPDATE statement runs but matches zero rows (no UPDATE policy)');
select lives_ok(
  $$ delete from credits where id = '00950000-0000-0000-0000-000000000040' $$,
  'AC-AUC-009 Admin (Dana) DELETE statement runs but matches zero rows (no DELETE policy)');
reset role;
select is(
  (select amount from credits where id = '00950000-0000-0000-0000-000000000040'),
  50::numeric,
  'AC-AUC-009 the credits row is unchanged after all UPDATE/DELETE attempts (append-only holds)');

-- AC-AUC-009 (schema-level twin): no UPDATE/DELETE policy exists on credits (append-only by omission).
select is(
  (select count(*)::int from pg_policies where tablename = 'credits' and cmd in ('UPDATE','DELETE')),
  0,
  'AC-AUC-009 no UPDATE/DELETE policy exists on credits (append-only by omission)');

-- ── Schema twins (AMENDED by ADR-0049): the new credits org-pool policy shapes. ──
-- agent_usage SELECT stays owner-only (the privacy/ownership wall is unchanged).
select is(
  (select count(*)::int from pg_policies
     where tablename = 'agent_usage' and cmd = 'SELECT'
       and qual ilike '%owner_id = auth.uid()%'),
  1,
  'AC-AUC-005 agent_usage SELECT gates on owner_id = auth.uid() (owner-only wall unchanged)');
-- credits SELECT now gates on org_id (org-pool, own-org Admin+Exec) — NOT owner_id.
select is(
  (select count(*)::int from pg_policies
     where tablename = 'credits' and cmd = 'SELECT' and qual ilike '%org_id = auth_org_id()%'),
  1,
  'AC-AUC-006 credits SELECT gates on org_id (org-pool, own-org Admin+Exec grants view)');
-- credits INSERT now gates on is_operator() (Operator-only — the revenue-hole fix).
select is(
  (select count(*)::int from pg_policies
     where tablename = 'credits' and cmd = 'INSERT' and with_check ilike '%is_operator()%'),
  1,
  'AC-AUC-007 credits INSERT gates on is_operator() (Operator-only)');

select * from finish();
rollback;
