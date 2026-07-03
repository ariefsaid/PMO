-- 0094_agent_usage_credits_schema.test.sql — agent_usage (per-request spend ledger) + credits
-- (admin-grant ledger) schema (docs/specs/agent-usage-credits.spec.md, ADR-0044 §6):
--   AC-AUC-001  agent_usage table exists with required columns.
--   AC-AUC-002  credits table exists, positive-amount constraint enforced.
--   AC-AUC-003  required indexes exist.
-- Fixtures inserted as the table owner (bypassing RLS) — this file is schema-shape only, not RLS.
begin;
select plan(21);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-001: agent_usage table exists with required columns.
-- ════════════════════════════════════════════════════════════════════════════
select has_table('agent_usage', 'AC-AUC-001 agent_usage table exists with required columns');

select has_column('agent_usage', 'run_id', 'AC-AUC-001 agent_usage.run_id exists (nullable FK)');
select col_is_fk('agent_usage', 'run_id', 'AC-AUC-001 agent_usage.run_id is a foreign key');
select has_column('agent_usage', 'model', 'AC-AUC-001 agent_usage.model exists');
select col_type_is('agent_usage', 'model', 'text', 'AC-AUC-001 agent_usage.model is text');
select col_not_null('agent_usage', 'prompt_tokens', 'AC-AUC-001 agent_usage.prompt_tokens is not null');
select col_default_is('agent_usage', 'prompt_tokens', '0', 'AC-AUC-001 agent_usage.prompt_tokens defaults to 0');
select col_not_null('agent_usage', 'completion_tokens', 'AC-AUC-001 agent_usage.completion_tokens is not null');
select col_default_is('agent_usage', 'completion_tokens', '0', 'AC-AUC-001 agent_usage.completion_tokens defaults to 0');
select col_not_null('agent_usage', 'cost', 'AC-AUC-001 agent_usage.cost is not null');
select col_type_is('agent_usage', 'cost', 'numeric', 'AC-AUC-001 agent_usage.cost is numeric');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-002: credits table exists, positive-amount constraint enforced.
-- ════════════════════════════════════════════════════════════════════════════
select has_table('credits', 'AC-AUC-002 credits table exists with required columns');
select has_column('credits', 'amount', 'AC-AUC-002 credits.amount exists');
select col_not_null('credits', 'amount', 'AC-AUC-002 credits.amount is not null');
select has_column('credits', 'note', 'AC-AUC-002 credits.note exists (nullable)');
select col_not_null('credits', 'granted_by', 'AC-AUC-002 credits.granted_by is not null');
select col_default_is('credits', 'granted_by', 'auth.uid()', 'AC-AUC-002 credits.granted_by defaults to auth.uid()');

select throws_ok(
  $$ insert into credits (owner_id, amount) values ('00000000-0000-0000-0000-000000000000', 0) $$,
  '23514', null,
  'AC-AUC-002 credits.amount = 0 rejected by the positive-amount check constraint');
select throws_ok(
  $$ insert into credits (owner_id, amount) values ('00000000-0000-0000-0000-000000000000', -5) $$,
  '23514', null,
  'AC-AUC-002 credits.amount = -5 rejected by the positive-amount check constraint');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AUC-003: required indexes exist.
-- ════════════════════════════════════════════════════════════════════════════
select has_index('agent_usage', 'agent_usage_owner_created_idx', array['owner_id','created_at'],
  'AC-AUC-003 agent_usage (owner_id, created_at) index exists');
select has_index('agent_usage', 'agent_usage_run_id_idx', array['run_id'],
  'AC-AUC-003 agent_usage (run_id) index exists');

select * from finish();
rollback;
