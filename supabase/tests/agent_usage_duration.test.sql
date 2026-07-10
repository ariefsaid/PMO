-- agent_usage_duration.test.sql — agent_usage.duration_ms (migration 0085, agent cost dashboard).
-- Schema-shape only, not RLS — fixtures insert as the table owner (bypassing RLS), mirroring
-- 0139_agent_usage_cache_tokens.test.sql.
--   AC-ACD-001  duration_ms exists, integer, NOT NULL, default 0.
--   AC-ACD-001  a row inserted WITHOUT the column defaults to 0 (edge-fn back-compat).
--   AC-ACD-001  a row inserted WITH an explicit value persists it verbatim.
begin;
select plan(6);

-- ── column shape ────────────────────────────────────────────────────────────
select has_column('agent_usage', 'duration_ms', 'AC-ACD-001 agent_usage.duration_ms exists');
select col_type_is('agent_usage', 'duration_ms', 'integer', 'AC-ACD-001 duration_ms is integer');
select col_not_null('agent_usage', 'duration_ms', 'AC-ACD-001 duration_ms is not null');
select col_default_is('agent_usage', 'duration_ms', '0', 'AC-ACD-001 duration_ms defaults to 0');

-- Fixtures: one org + owner to satisfy the FKs.
insert into organizations (id, name) values
  ('acd10000-0000-0000-0000-000000000001', 'AC-ACD Duration Org');
insert into auth.users (id, email) values
  ('acd10000-0000-0000-0000-0000000000a1', 'acd-duration-a1@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('acd10000-0000-0000-0000-0000000000a1', 'acd10000-0000-0000-0000-000000000001',
   'ACD A1', 'acd-duration-a1@example.com', 'Engineer');

-- omitted → defaults to 0 (edge-fn insert path keeps working before it passes duration_ms).
insert into agent_usage (org_id, owner_id, model, prompt_tokens, completion_tokens, cost, action)
  values ('acd10000-0000-0000-0000-000000000001', 'acd10000-0000-0000-0000-0000000000a1',
          'dur-omitted', 100, 20, 0.01, 'chat');
select is(
  (select duration_ms from agent_usage where model = 'dur-omitted'),
  0, 'AC-ACD-001 duration_ms defaults to 0 when omitted');

-- explicit value persists verbatim.
insert into agent_usage (org_id, owner_id, model, prompt_tokens, completion_tokens, duration_ms, cost, action)
  values ('acd10000-0000-0000-0000-000000000001', 'acd10000-0000-0000-0000-0000000000a1',
          'dur-explicit', 1000, 200, 4200, 0.02, 'chat');
select is(
  (select duration_ms from agent_usage where model = 'dur-explicit'),
  4200, 'AC-ACD-001 explicit duration_ms persists verbatim');

select * from finish();
rollback;
