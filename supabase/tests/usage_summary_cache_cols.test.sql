-- usage_summary_cache_cols.test.sql — org_usage_summary()/operator_usage_summary() gain Σcached_tokens
-- + Σreasoning_tokens (migration 0086, agent cost dashboard). AGGREGATES ONLY over agent_usage
-- (NFR-PRIV-001). Models on 0120_usage_aggregate_columns + 0124_usage_summary_provider_cost_role_split.
--   AC-ACD-003  org_usage_summary() returns Σcached_tokens/Σreasoning_tokens, owner-scoped, own-org only.
--   AC-ACD-004  operator_usage_summary() returns the same two + provider_cost_usd, operator-only.
begin;
select plan(8);

-- ── return-shape: both new columns present on both fns (pinned via pg_proc, data-independent) ──
select ok(
  exists (select 1 from pg_proc, unnest(proargnames) as col
           where proname = 'org_usage_summary' and pronamespace = 'public'::regnamespace and col = 'cached_tokens'),
  'AC-ACD-003 org_usage_summary() returns cached_tokens');
select ok(
  exists (select 1 from pg_proc, unnest(proargnames) as col
           where proname = 'org_usage_summary' and pronamespace = 'public'::regnamespace and col = 'reasoning_tokens'),
  'AC-ACD-003 org_usage_summary() returns reasoning_tokens');
select ok(
  exists (select 1 from pg_proc, unnest(proargnames) as col
           where proname = 'operator_usage_summary' and pronamespace = 'public'::regnamespace and col = 'cached_tokens'),
  'AC-ACD-004 operator_usage_summary() returns cached_tokens');
select ok(
  exists (select 1 from pg_proc, unnest(proargnames) as col
           where proname = 'operator_usage_summary' and pronamespace = 'public'::regnamespace and col = 'reasoning_tokens'),
  'AC-ACD-004 operator_usage_summary() returns reasoning_tokens');

-- Fixtures: org X (owner A1 + operator F1) and org Y (owner B1, isolation control).
insert into organizations (id, name) values
  ('acd20000-0000-0000-0000-000000000001', 'AC-ACD Summary Org X'),
  ('acd20000-0000-0000-0000-000000000002', 'AC-ACD Summary Org Y');
insert into auth.users (id, email) values
  ('acd20000-0000-0000-0000-0000000000a1', 'acd-sum-a1@example.com'),
  ('acd20000-0000-0000-0000-0000000000f1', 'acd-sum-operator@example.com'),
  ('acd20000-0000-0000-0000-0000000000b1', 'acd-sum-b1@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('acd20000-0000-0000-0000-0000000000a1','acd20000-0000-0000-0000-000000000001','Sum A1','acd-sum-a1@example.com','Engineer'),
  ('acd20000-0000-0000-0000-0000000000f1','acd20000-0000-0000-0000-000000000001','Sum Operator','acd-sum-operator@example.com','Admin'),
  ('acd20000-0000-0000-0000-0000000000b1','acd20000-0000-0000-0000-000000000002','Sum B1','acd-sum-b1@example.com','Engineer');
insert into platform_operators (user_id) values ('acd20000-0000-0000-0000-0000000000f1');

-- Org X, owner A1, two 'chat' rows same month: Σcached = 700+300 = 1000, Σreasoning = 30+20 = 50.
insert into agent_usage (org_id, owner_id, model, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, provider_cost_usd, cost, action, created_at) values
  ('acd20000-0000-0000-0000-000000000001','acd20000-0000-0000-0000-0000000000a1','m', 1000, 100, 700, 30, 0.02, 0.05, 'chat', '2026-07-01T00:00:00Z'),
  ('acd20000-0000-0000-0000-000000000001','acd20000-0000-0000-0000-0000000000a1','m',  500,  50, 300, 20, 0.03, 0.07, 'chat', '2026-07-15T00:00:00Z');
-- Org Y row (isolation control) — org X's Admin must NEVER see these 9999s.
insert into agent_usage (org_id, owner_id, model, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, provider_cost_usd, cost, action, created_at) values
  ('acd20000-0000-0000-0000-000000000002','acd20000-0000-0000-0000-0000000000b1','m', 9999, 9999, 9999, 9999, 9.99, 9.99, 'chat', '2026-07-10T00:00:00Z');

-- ── AC-ACD-003: org-Admin (A1) own-org aggregate ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"acd20000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select cached_tokens from org_usage_summary() where action = 'chat'),
  1000::bigint, 'AC-ACD-003 chat Σcached_tokens = 1000 (owner-scoped)');
select is(
  (select reasoning_tokens from org_usage_summary() where action = 'chat'),
  50::bigint, 'AC-ACD-003 chat Σreasoning_tokens = 50 (owner-scoped)');
-- own-org isolation: the org Y 9999s never enter A1's totals.
select is(
  (select coalesce(sum(cached_tokens),0)::bigint from org_usage_summary()),
  1000::bigint, 'AC-ACD-003 org-Admin cached total excludes other orgs (own-org only)');
reset role;

-- ── AC-ACD-004: Operator (F1) sees org X's Σcached/Σreasoning ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"acd20000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(
  (select cached_tokens from operator_usage_summary() where action = 'chat' and org_id = 'acd20000-0000-0000-0000-000000000001'),
  1000::bigint, 'AC-ACD-004 operator sees org X chat Σcached_tokens = 1000');
reset role;

select * from finish();
rollback;
