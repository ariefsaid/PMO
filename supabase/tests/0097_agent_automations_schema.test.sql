-- 0097_agent_automations_schema.test.sql — agent_automations schema (ADR-0044 §1, ADR-0046).
-- Proves:
--   AC-AAN-001  table exists with required columns.
--   AC-AAN-002  kind='schedule' requires a non-null schedule (CHECK).
--   AC-AAN-003  kind='trigger' requires a non-null trigger_on (CHECK).
--   AC-AAN-004  a valid schedule row and a valid trigger row both insert cleanly.
-- Fixtures/inserts run as the table owner (bypassing RLS) — this file is schema-shape only, not RLS
-- (RLS/tenancy is 0098_agent_automations_tenancy.test.sql). Modeled on
-- 0091_agent_persistence_schema.test.sql.
begin;
select plan(22);

-- A fixture user (owner_id has no meaningful default outside an authenticated session — as the
-- table owner running these inserts, auth.uid() is null, so owner_id is supplied explicitly).
insert into auth.users (id, email) values
  ('00940000-0000-0000-0000-0000000000a1','aan-schema-owner@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('00940000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AAN Schema Owner','aan-schema-owner@example.com','Engineer');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-001: table exists with required columns.
-- ════════════════════════════════════════════════════════════════════════════
select has_table('agent_automations', 'AC-AAN-001: agent_automations table exists');

select has_column('agent_automations', 'id',            'AC-AAN-001: agent_automations.id exists');
select has_column('agent_automations', 'org_id',         'AC-AAN-001: agent_automations.org_id exists');
select has_column('agent_automations', 'owner_id',       'AC-AAN-001: agent_automations.owner_id exists');
select has_column('agent_automations', 'kind',           'AC-AAN-001: agent_automations.kind exists');
select has_column('agent_automations', 'prompt',         'AC-AAN-001: agent_automations.prompt exists');
select has_column('agent_automations', 'schedule',       'AC-AAN-001: agent_automations.schedule exists');
select has_column('agent_automations', 'trigger_on',     'AC-AAN-001: agent_automations.trigger_on exists');
select has_column('agent_automations', 'condition',      'AC-AAN-001: agent_automations.condition exists');
select has_column('agent_automations', 'enabled',        'AC-AAN-001: agent_automations.enabled exists');
select has_column('agent_automations', 'timeout_s',      'AC-AAN-001: agent_automations.timeout_s exists');
select has_column('agent_automations', 'last_fired_at',  'AC-AAN-001: agent_automations.last_fired_at exists');
select has_column('agent_automations', 'created_at',     'AC-AAN-001: agent_automations.created_at exists');
select has_column('agent_automations', 'updated_at',     'AC-AAN-001: agent_automations.updated_at exists');
select has_column('agent_automations', 'archived_at',    'AC-AAN-001: agent_automations.archived_at exists');

select col_type_is('agent_automations', 'trigger_on', 'jsonb',   'AC-AAN-001: trigger_on is jsonb');
select col_type_is('agent_automations', 'enabled',    'boolean', 'AC-AAN-001: enabled is boolean');
select col_type_is('agent_automations', 'timeout_s',  'integer', 'AC-AAN-001: timeout_s is integer');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-002: kind='schedule' requires a non-null schedule (CHECK).
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into agent_automations (owner_id, kind, prompt, schedule)
       values ('00940000-0000-0000-0000-0000000000a1','schedule','p', null) $$,
  '23514', null,
  'AC-AAN-002: kind=schedule with null schedule is rejected by the CHECK constraint');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-003: kind='trigger' requires a non-null trigger_on (CHECK).
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into agent_automations (owner_id, kind, prompt, trigger_on)
       values ('00940000-0000-0000-0000-0000000000a1','trigger','p', null) $$,
  '23514', null,
  'AC-AAN-003: kind=trigger with null trigger_on is rejected by the CHECK constraint');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AAN-004: a valid schedule row and a valid trigger row both insert cleanly.
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ insert into agent_automations (owner_id, kind, prompt, schedule)
       values ('00940000-0000-0000-0000-0000000000a1','schedule', 'summarize overdue tasks', '0 8 * * 1') $$,
  'AC-AAN-004: a valid kind=schedule row inserts cleanly');

select lives_ok(
  $$ insert into agent_automations (owner_id, kind, prompt, trigger_on)
       values ('00940000-0000-0000-0000-0000000000a1','trigger', 'notify me', '{"source":"procurement_status_events","event":"Ordered"}'::jsonb) $$,
  'AC-AAN-004: a valid kind=trigger row inserts cleanly');

select * from finish();
rollback;
