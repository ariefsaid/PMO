-- 0120_usage_aggregate_columns.test.sql
-- AC-USE-002 [pgTAP]: aggregate columns are correct. Pins FR-USE-001/002: agent_usage gains
-- provider_cost_usd + action; org_usage_summary()/operator_usage_summary() return run-count,
-- Σprompt_tokens, Σcompletion_tokens, Σcost per (owner_id, action, month) exactly, plus margin_usd
-- (null when CREDITS_PER_USD unset). AC-USE-007 (owner decision): provider_cost_usd is Operator-only
-- — org_usage_summary() does NOT return it (asserted in 0124); this test checks Σprovider_cost_usd
-- via operator_usage_summary() instead, the surface that IS entitled to it.
begin;
select plan(6);

insert into organizations (id, name) values
  ('01200000-0000-0000-0000-000000000001','AC-USE-002 Org X');
insert into auth.users (id, email) values
  ('01200000-0000-0000-0000-0000000000a1','use002-a1@example.com'),
  ('01200000-0000-0000-0000-0000000000f1','use002-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01200000-0000-0000-0000-0000000000a1','01200000-0000-0000-0000-000000000001','Use002 A1','use002-a1@example.com','Engineer'),
  ('01200000-0000-0000-0000-0000000000f1','01200000-0000-0000-0000-000000000001','Use002 Operator','use002-operator@example.com','Admin');
insert into platform_operators (user_id) values ('01200000-0000-0000-0000-0000000000f1');

-- Two 'chat' rows in the same month for the same owner; one 'compose' row.
insert into agent_usage (org_id, owner_id, model, prompt_tokens, completion_tokens, provider_cost_usd, cost, action, created_at) values
  ('01200000-0000-0000-0000-000000000001','01200000-0000-0000-0000-0000000000a1','gpt-test', 10, 5, 0.02, 0.05, 'chat',    '2026-07-01T00:00:00Z'),
  ('01200000-0000-0000-0000-000000000001','01200000-0000-0000-0000-0000000000a1','gpt-test', 20, 8, 0.03, 0.07, 'chat',    '2026-07-15T00:00:00Z'),
  ('01200000-0000-0000-0000-000000000001','01200000-0000-0000-0000-0000000000a1','gpt-test',  5, 2, 0.01, 0.02, 'compose', '2026-07-20T00:00:00Z');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01200000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 'chat' aggregate: run_count=2, prompt=30, completion=13, cost=0.12.
select is(
  (select run_count from org_usage_summary() where action = 'chat'),
  2::bigint, 'AC-USE-002 chat run_count = 2');
select is(
  (select prompt_tokens from org_usage_summary() where action = 'chat'),
  30::bigint, 'AC-USE-002 chat Σprompt_tokens = 30');
select is(
  (select completion_tokens from org_usage_summary() where action = 'chat'),
  13::bigint, 'AC-USE-002 chat Σcompletion_tokens = 13');
select is(
  (select cost from org_usage_summary() where action = 'chat'),
  0.12::numeric, 'AC-USE-002 chat Σcost = 0.12');

-- margin_usd is null while app.credits_per_usd is unset (FR-USE-006, AC-USE-003 premise).
select is(
  (select margin_usd from org_usage_summary() where action = 'compose'),
  null::numeric, 'AC-USE-002 margin_usd is null when CREDITS_PER_USD is unset');
reset role;

-- Σprovider_cost_usd is proven on the Operator-facing summary (AC-USE-007: the org-Admin surface
-- doesn't carry the column at all).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01200000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(
  (select provider_cost_usd from operator_usage_summary() where action = 'chat'),
  0.05::numeric, 'AC-USE-002 chat Σprovider_cost_usd = 0.05 (operator_usage_summary)');
reset role;

select * from finish();
rollback;
