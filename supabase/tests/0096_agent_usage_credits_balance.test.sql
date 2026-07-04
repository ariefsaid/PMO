-- 0096_agent_usage_credits_balance.test.sql — balance = sum(credits.amount) - sum(agent_usage.cost)
-- (docs/specs/agent-usage-credits.spec.md FR-AUC-010). This is a SQL-expression-level proof, not a
-- stored function/view — the balance is COMPUTED fresh at check time (never cached/stored).
-- creditRateGuard.ts (Phase B) implements the identical query shape in TypeScript against the same
-- tables; this pgTAP is the canonical proof of the arithmetic.
-- Fixtures inserted as the table owner (bypassing RLS), then `set local role authenticated` +
-- `set local request.jwt.claims`. Fixture namespace: 00960000-….
--
-- RED-1 (gpt-5.5 red-team audit, CRITICAL — credit forgery via negative cost): the clamp
-- previously lived ONLY in the edge fn (_shared/usage.ts insertUsageRow); RLS lets an owner
-- INSERT their own agent_usage row directly via PostgREST, and (pre-fix) the table had NO CHECK
-- constraint, so a forged `{cost: -1000000}` row inflated balance = granted - sum(cost) without
-- bound → unlimited free model spend. Migration 0050 adds
-- `CHECK (prompt_tokens >= 0 AND completion_tokens >= 0 AND cost >= 0)` to agent_usage — the
-- assertions below prove a direct RLS-permitted insert can no longer forge a negative cost/token
-- value, while a legitimate non-negative insert still succeeds.
begin;
select plan(5);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into auth.users (id, email) values
  ('00960000-0000-0000-0000-0000000000a1','auc-bal-fay@example.com'),
  ('00960000-0000-0000-0000-0000000000a2','auc-bal-gus@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00960000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AUC Bal Fay','auc-bal-fay@example.com','Engineer'),
  ('00960000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AUC Bal Gus','auc-bal-gus@example.com','Engineer');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-010: balance = granted minus spent, computed correctly.
-- Fay: one credits grant of 100, two agent_usage rows costing 10 and 15 → balance = 100-10-15 = 75.
-- ════════════════════════════════════════════════════════════════════════════
insert into credits (owner_id, amount, granted_by) values
  ('00960000-0000-0000-0000-0000000000a1', 100, '00960000-0000-0000-0000-0000000000a1');
insert into agent_usage (owner_id, model, cost) values
  ('00960000-0000-0000-0000-0000000000a1', 'test-model', 10),
  ('00960000-0000-0000-0000-0000000000a1', 'test-model', 15);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select coalesce((select sum(amount) from credits where owner_id = auth.uid()), 0)
        - coalesce((select sum(cost) from agent_usage where owner_id = auth.uid()), 0)),
  75::numeric,
  'AC-AUC-010 balance equals granted (100) minus spent (10+15) = 75');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-011: a user with no grants has a balance of 0 - spent (negative once any spend exists).
-- Gus: zero credits rows, one agent_usage row costing 5 → balance = 0-5 = -5.
-- ════════════════════════════════════════════════════════════════════════════
insert into agent_usage (owner_id, model, cost) values
  ('00960000-0000-0000-0000-0000000000a2', 'test-model', 5);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select coalesce((select sum(amount) from credits where owner_id = auth.uid()), 0)
        - coalesce((select sum(cost) from agent_usage where owner_id = auth.uid()), 0)),
  -5::numeric,
  'AC-AUC-011 no-grant balance is 0 minus spent (5) = -5');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- RED-1: negative cost / negative token forgery via a direct owner-JWT RLS insert
-- is rejected by the new CHECK constraint (23514), not merely relied upon the edge
-- fn's application-level clamp. A valid non-negative insert still succeeds.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into agent_usage (owner_id, model, cost) values ('00960000-0000-0000-0000-0000000000a1', 'test-model', -1000000) $$,
  '23514', null,
  'RED-1 agent_usage.cost = -1000000 (forged credit) rejected by the non-negative check constraint');

select throws_ok(
  $$ insert into agent_usage (owner_id, model, prompt_tokens, completion_tokens) values ('00960000-0000-0000-0000-0000000000a1', 'test-model', -1, -1) $$,
  '23514', null,
  'RED-1 agent_usage negative prompt_tokens/completion_tokens rejected by the non-negative check constraint');

select lives_ok(
  $$ insert into agent_usage (owner_id, model, prompt_tokens, completion_tokens, cost) values ('00960000-0000-0000-0000-0000000000a1', 'test-model', 10, 20, 0.05) $$,
  'RED-1 a valid non-negative agent_usage insert still succeeds');

reset role;

select * from finish();
rollback;
