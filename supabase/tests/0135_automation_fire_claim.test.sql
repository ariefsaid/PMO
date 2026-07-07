-- 0135_automation_fire_claim.test.sql — agent_automation_fires table guarantees at-most-once
-- automation firing per event via a UNIQUE (automation_id, event_id) primary key (migration
-- 0078). Proves: table exists + FORCE RLS + zero policies (service-role-only, mirrors the
-- 0048 watermark pattern), idempotent dedupe (first insert succeeds, second violates PK
-- with 23505, and insert ... on conflict do nothing keeps count at 1).
begin;
select plan(7);

-- ════════════════════════════════════════════════════════════════════════════
-- Table existence + RLS posture (mirrors 0048 agent_dispatch_watermarks pattern)
-- ════════════════════════════════════════════════════════════════════════════
select has_table('public', 'agent_automation_fires', 'AC-AUTOFIRE-001: table agent_automation_fires exists');

select is(
  (select relrowsecurity from pg_class where relname = 'agent_automation_fires'),
  true,
  'AC-AUTOFIRE-002: RLS is enabled on agent_automation_fires');

select is(
  (select relforcerowsecurity from pg_class where relname = 'agent_automation_fires'),
  true,
  'AC-AUTOFIRE-003: RLS is FORCEd on agent_automation_fires');

select is(
  (select count(*)::int from pg_policies where tablename = 'agent_automation_fires'),
  0,
  'AC-AUTOFIRE-004: agent_automation_fires has zero policies (service-role-only via RLS bypass)');

-- ════════════════════════════════════════════════════════════════════════════
-- Dedupe guarantee: UNIQUE (automation_id, event_id) primary key enforces at-most-once
-- ════════════════════════════════════════════════════════════════════════════

-- Fixture automation (needed for FK constraint)
insert into organizations (id, name) values
  ('01350000-0000-0000-0000-000000000001','Automation Fire Claim Org');
insert into auth.users (id, email) values
  ('01350000-0000-0000-0000-0000000000a1','afc-user@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01350000-0000-0000-0000-0000000000a1','01350000-0000-0000-0000-000000000001','AFC User','afc-user@example.com','Admin');

insert into agent_automations (id, owner_id, org_id, kind, prompt, enabled, trigger_on) values
  ('01350000-0000-0000-0000-0000000000a2','01350000-0000-0000-0000-0000000000a1','01350000-0000-0000-0000-000000000001','trigger','test',true,
   '{"source":"procurement_status_events","event":"status_change"}'::jsonb);

-- Fixture event id (not inserted into real table — just a UUID for the claim)
select '01350000-0000-0000-0000-0000000000e3'::uuid as fixture_event_id \gset

-- First insert: succeeds
insert into agent_automation_fires (automation_id, event_id)
values ('01350000-0000-0000-0000-0000000000a2', :'fixture_event_id');

select is(
  (select count(*)::int from agent_automation_fires),
  1,
  'AC-AUTOFIRE-005: first (automation_id, event_id) insert succeeds, count = 1');

-- Second identical insert: violates UNIQUE constraint with error 23505 (unique_violation)
select throws_ok(
  $$
  insert into agent_automation_fires (automation_id, event_id)
  values ('01350000-0000-0000-0000-0000000000a2', '01350000-0000-0000-0000-0000000000e3'::uuid)
  $$,
  '23505', null,
  'AC-AUTOFIRE-006: second identical insert violates primary key (23505)');

-- Idempotent path: insert ... on conflict do nothing inserts 0 rows on duplicate, keeps count at 1
with ins as (
  insert into agent_automation_fires (automation_id, event_id)
  values ('01350000-0000-0000-0000-0000000000a2', '01350000-0000-0000-0000-0000000000e3'::uuid)
  on conflict do nothing
  returning *
)
select is(
  (select count(*)::int from agent_automation_fires),
  1,
  'AC-AUTOFIRE-007: insert ... on conflict do nothing keeps count at 1 (idempotent dedupe)');

select * from finish();
rollback;