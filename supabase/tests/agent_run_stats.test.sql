-- agent_run_stats.test.sql — org_agent_run_stats()/operator_agent_run_stats(uuid) per-run cost/latency
-- percentiles + cache-hit % (migration 0086, agent cost dashboard). AGGREGATES ONLY over agent_usage
-- (NFR-PRIV-001) — grouped by run_id in an inner CTE. Models on 0120_usage_aggregate_columns.
--   AC-ACD-005  org_agent_run_stats() per-run percentiles correct (cost p50/p95/max, cache_hit_pct,
--               p50/p95 ms), own-org only.
--   AC-ACD-006  operator_agent_run_stats() operator-only + org filter; a non-operator is denied (0 rows).
begin;
select plan(11);

-- ── Fixtures: org R (owner A1 + operator F1) and org S (owner B1, isolation control). ──
insert into organizations (id, name) values
  ('acd30000-0000-0000-0000-000000000001', 'AC-ACD RunStats Org R'),
  ('acd30000-0000-0000-0000-000000000002', 'AC-ACD RunStats Org S');
insert into auth.users (id, email) values
  ('acd30000-0000-0000-0000-0000000000a1', 'acd-rs-a1@example.com'),
  ('acd30000-0000-0000-0000-0000000000f1', 'acd-rs-operator@example.com'),
  ('acd30000-0000-0000-0000-0000000000b1', 'acd-rs-b1@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('acd30000-0000-0000-0000-0000000000a1','acd30000-0000-0000-0000-000000000001','RS A1','acd-rs-a1@example.com','Engineer'),
  ('acd30000-0000-0000-0000-0000000000f1','acd30000-0000-0000-0000-000000000001','RS Operator','acd-rs-operator@example.com','Admin'),
  ('acd30000-0000-0000-0000-0000000000b1','acd30000-0000-0000-0000-000000000002','RS B1','acd-rs-b1@example.com','Engineer');
insert into platform_operators (user_id) values ('acd30000-0000-0000-0000-0000000000f1');

-- Run A is a multi-round run (2 rows) — needs a real agent_runs id to group its rows together.
insert into agent_threads (id, org_id, owner_id, title) values
  ('acd30000-0000-0000-0000-0000000000c1','acd30000-0000-0000-0000-000000000001','acd30000-0000-0000-0000-0000000000a1','RS thread');
insert into agent_runs (id, thread_id, org_id, owner_id, status) values
  ('acd30000-0000-0000-0000-0000000000d1','acd30000-0000-0000-0000-0000000000c1','acd30000-0000-0000-0000-000000000001','acd30000-0000-0000-0000-0000000000a1','completed');

-- Org R, action 'chat', month 2026-07 — three runs:
--   Run A (run_id d1): 2 rounds, cost 0.05, ms 300, cached 800/prompt 1500
--   Run B (null run_id → own run): 1 round, cost 0.10, ms 500, cached 500/prompt 500
--   Run C (null run_id → own run): 1 round, cost 0.20, ms 900, cached 200/prompt 1000
-- Group expectations: runs=3, avg_rounds=1.3333, cost p50=0.10 p95=0.19 max=0.20,
--   cache_hit_pct = 100*(800+500+200)/(1500+500+1000) = 100*1500/3000 = 50.00,
--   ms p50=500, p95=860.
insert into agent_usage (org_id, owner_id, run_id, model, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, duration_ms, cost, action, created_at) values
  ('acd30000-0000-0000-0000-000000000001','acd30000-0000-0000-0000-0000000000a1','acd30000-0000-0000-0000-0000000000d1','m', 1000, 100, 800, 10, 100, 0.02, 'chat', '2026-07-01T00:00:00Z'),
  ('acd30000-0000-0000-0000-000000000001','acd30000-0000-0000-0000-0000000000a1','acd30000-0000-0000-0000-0000000000d1','m',  500,  50,   0,  5, 200, 0.03, 'chat', '2026-07-01T00:01:00Z'),
  ('acd30000-0000-0000-0000-000000000001','acd30000-0000-0000-0000-0000000000a1', null,'m',  500,  50, 500, 10, 500, 0.10, 'chat', '2026-07-10T00:00:00Z'),
  ('acd30000-0000-0000-0000-000000000001','acd30000-0000-0000-0000-0000000000a1', null,'m', 1000, 100, 200, 20, 900, 0.20, 'chat', '2026-07-20T00:00:00Z');

-- Org S control — one chat run; must never leak into org R's stats.
insert into agent_usage (org_id, owner_id, run_id, model, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, duration_ms, cost, action, created_at) values
  ('acd30000-0000-0000-0000-000000000002','acd30000-0000-0000-0000-0000000000b1', null,'m', 100, 100, 100, 10, 1000, 0.50, 'chat', '2026-07-05T00:00:00Z');

-- ── AC-ACD-005: org-Admin (A1) own-org per-run stats ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"acd30000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select runs from org_agent_run_stats() where action='chat'),
  3::bigint, 'AC-ACD-005 chat runs = 3 (own-org; org S excluded)');
select is((select round(avg_rounds,4) from org_agent_run_stats() where action='chat'),
  1.3333::numeric, 'AC-ACD-005 chat avg_rounds = 1.3333');
select is((select round(p50_cost,2) from org_agent_run_stats() where action='chat'),
  0.10::numeric, 'AC-ACD-005 chat p50_cost = 0.10');
select is((select round(p95_cost,2) from org_agent_run_stats() where action='chat'),
  0.19::numeric, 'AC-ACD-005 chat p95_cost = 0.19');
select is((select max_cost from org_agent_run_stats() where action='chat'),
  0.20::numeric, 'AC-ACD-005 chat max_cost = 0.20');
select is((select cache_hit_pct from org_agent_run_stats() where action='chat'),
  50.00::numeric, 'AC-ACD-005 chat cache_hit_pct = 50.00');
select is((select p50_ms from org_agent_run_stats() where action='chat'),
  500, 'AC-ACD-005 chat p50_ms = 500');
select is((select p95_ms from org_agent_run_stats() where action='chat'),
  860, 'AC-ACD-005 chat p95_ms = 860');
-- non-operator A1 calling the operator RPC → denied (0 rows).
select is((select count(*) from operator_agent_run_stats()),
  0::bigint, 'AC-ACD-006 non-operator gets 0 rows from operator_agent_run_stats()');
reset role;

-- ── AC-ACD-006: Operator (F1) — org filter + cross-org visibility ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"acd30000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(
  (select runs from operator_agent_run_stats('acd30000-0000-0000-0000-000000000001') where action='chat'),
  3::bigint, 'AC-ACD-006 operator sees org R chat runs = 3 (p_org_id filter)');
select is(
  (select runs from operator_agent_run_stats() where action='chat' and org_id='acd30000-0000-0000-0000-000000000002'),
  1::bigint, 'AC-ACD-006 operator (unfiltered) sees org S chat runs = 1');
reset role;

select * from finish();
rollback;
