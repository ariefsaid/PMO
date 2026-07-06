-- 0096_agent_usage_credits_balance.test.sql — org-pool balance (FR-AUC-010 AMENDED by ADR-0049 /
-- ops-admin-surface FR-CRE-002: balance scope is per-ORG, not per-owner). The balance is the
-- `org_credit_balance(p_org_id)` security-definer RPC = Σ credits.amount(org, any owner_id) −
-- Σ agent_usage.cost(org), computed fresh at check time (never stored). This pgTAP is the canonical
-- proof of the arithmetic; creditRateGuard.ts (S2-C) implements the same scope in TypeScript via
-- the same RPC. RED-1 (negative-cost forgery) is UNCHANGED — agent_usage stays owner-pinned with
-- the non-negative CHECK. Fixtures inserted as the table owner; namespace 00960000-….
begin;
select plan(6);

-- ── Fixtures: org A (default) has Fay + Gus; org B has Hal. ──
insert into organizations (id, name) values
  ('00960000-0000-0000-0000-000000000002','AUC Balance Org B');
insert into auth.users (id, email) values
  ('00960000-0000-0000-0000-0000000000a1','auc-bal-fay@example.com'),
  ('00960000-0000-0000-0000-0000000000a2','auc-bal-gus@example.com'),
  ('00960000-0000-0000-0000-0000000000b1','auc-bal-hal@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('00960000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AUC Bal Fay','auc-bal-fay@example.com','Engineer'),
  ('00960000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AUC Bal Gus','auc-bal-gus@example.com','Engineer'),
  ('00960000-0000-0000-0000-0000000000b1','00960000-0000-0000-0000-000000000002','AUC Bal Hal','auc-bal-hal@example.com','Admin');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-010 (AMENDED): org-pool balance = Σ credits.amount(org) − Σ agent_usage.cost(org).
-- Org A: one grant of 100 (owner Fay — legacy per-user grant still counts), usage 10+15 (Fay) +
-- 5 (Gus) = 30 → org A balance = 70. BOTH Fay and Gus (same org) read the SAME pool = 70
-- (the deputy invariant — any member's turn reads their own org pool, FR-CRE-004).
-- ════════════════════════════════════════════════════════════════════════════
insert into credits (org_id, owner_id, amount, granted_by) values
  ('00000000-0000-0000-0000-000000000001', '00960000-0000-0000-0000-0000000000a1', 100, '00960000-0000-0000-0000-0000000000a1');
insert into agent_usage (org_id, owner_id, model, cost) values
  ('00000000-0000-0000-0000-000000000001','00960000-0000-0000-0000-0000000000a1', 'test-model', 10),
  ('00000000-0000-0000-0000-000000000001','00960000-0000-0000-0000-0000000000a1', 'test-model', 15),
  ('00000000-0000-0000-0000-000000000001','00960000-0000-0000-0000-0000000000a2', 'test-model', 5);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.org_credit_balance('00000000-0000-0000-0000-000000000001'), 70::numeric,
  'AC-AUC-010 org-A balance = 100 − (10+15+5) = 70 (org-pool, owner_id-agnostic)');

set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.org_credit_balance('00000000-0000-0000-0000-000000000001'), 70::numeric,
  'AC-AUC-010 any org-A member (Gus) reads the same pool balance (deputy invariant)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-011 (AMENDED): an org with usage but NO grants has a negative balance.
-- Org B (Hal): zero credits, one agent_usage row costing 5 → org B balance = -5.
-- ════════════════════════════════════════════════════════════════════════════
insert into agent_usage (org_id, owner_id, model, cost) values
  ('00960000-0000-0000-0000-000000000002','00960000-0000-0000-0000-0000000000b1', 'test-model', 5);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.org_credit_balance('00960000-0000-0000-0000-000000000002'), -5::numeric,
  'AC-AUC-011 no-grant org balance = 0 − spent (5) = -5');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- RED-1 (UNCHANGED): negative cost / negative token forgery via a direct owner-JWT RLS insert
-- is rejected by the CHECK constraint (23514), not merely relied upon the edge fn's clamp.
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
