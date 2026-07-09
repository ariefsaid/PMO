-- 0139_agent_usage_cache_tokens.test.sql — agent_usage.cached_tokens + reasoning_tokens
-- (telemetry hardening, migration 0084). Schema-shape only, not RLS — fixtures insert as the
-- table owner (bypassing RLS), mirroring 0094_agent_usage_credits_schema.test.sql.
--   AC-AUC-CACHE-001  both columns exist, are integer, NOT NULL, default 0.
--   AC-AUC-CACHE-002  a row inserted WITHOUT the columns defaults both to 0 (back-compat: the
--                     existing edge-fn insert path keeps working before it is updated to pass them).
--   AC-AUC-CACHE-003  a row inserted WITH explicit values persists them verbatim.
begin;
select plan(11);

-- ── AC-AUC-CACHE-001: column shape ──────────────────────────────────────────
select has_column('agent_usage', 'cached_tokens', 'AC-AUC-CACHE-001 agent_usage.cached_tokens exists');
select col_type_is('agent_usage', 'cached_tokens', 'integer', 'AC-AUC-CACHE-001 cached_tokens is integer');
select col_not_null('agent_usage', 'cached_tokens', 'AC-AUC-CACHE-001 cached_tokens is not null');
select col_default_is('agent_usage', 'cached_tokens', '0', 'AC-AUC-CACHE-001 cached_tokens defaults to 0');

select has_column('agent_usage', 'reasoning_tokens', 'AC-AUC-CACHE-001 agent_usage.reasoning_tokens exists');
select col_type_is('agent_usage', 'reasoning_tokens', 'integer', 'AC-AUC-CACHE-001 reasoning_tokens is integer');
select col_not_null('agent_usage', 'reasoning_tokens', 'AC-AUC-CACHE-001 reasoning_tokens is not null');
select col_default_is('agent_usage', 'reasoning_tokens', '0', 'AC-AUC-CACHE-001 reasoning_tokens defaults to 0');

-- Fixtures: one org + owner to satisfy the FKs.
insert into organizations (id, name) values
  ('01390000-0000-0000-0000-000000000001', 'AC-AUC-CACHE Org');
insert into auth.users (id, email) values
  ('01390000-0000-0000-0000-0000000000a1', 'cache-tokens-a1@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01390000-0000-0000-0000-0000000000a1', '01390000-0000-0000-0000-000000000001',
   'Cache A1', 'cache-tokens-a1@example.com', 'Engineer');

-- ── AC-AUC-CACHE-002: omitted → defaults to 0 (back-compat) ─────────────────
insert into agent_usage (org_id, owner_id, model, prompt_tokens, completion_tokens, cost, action)
  values ('01390000-0000-0000-0000-000000000001', '01390000-0000-0000-0000-0000000000a1',
          'cache-test', 100, 20, 0.01, 'chat');
select is(
  (select cached_tokens from agent_usage where model = 'cache-test'),
  0, 'AC-AUC-CACHE-002 cached_tokens defaults to 0 when omitted');
select is(
  (select reasoning_tokens from agent_usage where model = 'cache-test'),
  0, 'AC-AUC-CACHE-002 reasoning_tokens defaults to 0 when omitted');

-- ── AC-AUC-CACHE-003: explicit values persist verbatim ──────────────────────
insert into agent_usage (org_id, owner_id, model, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, cost, action)
  values ('01390000-0000-0000-0000-000000000001', '01390000-0000-0000-0000-0000000000a1',
          'cache-hit-test', 1000, 200, 768, 64, 0.02, 'chat');
select results_eq(
  $$ select cached_tokens, reasoning_tokens from agent_usage where model = 'cache-hit-test' $$,
  $$ values (768, 64) $$,
  'AC-AUC-CACHE-003 explicit cached_tokens/reasoning_tokens persist verbatim');

select * from finish();
rollback;
