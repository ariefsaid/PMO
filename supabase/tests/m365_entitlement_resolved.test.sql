-- m365_entitlement_resolved.test.sql
-- AC-M365SS-003 [pgTAP] — the M365 connection write guard follows the RESOLVED plan switch (0816):
--   plan on + no override row → write accepted; plan off → 'org_not_entitled' (42501).
-- AC-M365SS-004 [pgTAP] — an operator override of enabled=false still wins over the plan.
begin;
create extension if not exists pgtap;
select plan(4);

insert into organizations (id, name) values
  ('08160000-0000-0000-0000-000000000001','M365SS Org Enterprise (no assignment, no override)'),
  ('08160000-0000-0000-0000-000000000002','M365SS Org Starter'),
  ('08160000-0000-0000-0000-000000000003','M365SS Org Enterprise + override off');

insert into auth.users (id, email) values
  ('08160000-0000-0000-0000-0000000000a1','m365ss-a@example.com'),
  ('08160000-0000-0000-0000-0000000000b1','m365ss-b@example.com'),
  ('08160000-0000-0000-0000-0000000000c1','m365ss-c@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08160000-0000-0000-0000-0000000000a1','08160000-0000-0000-0000-000000000001','A','m365ss-a@example.com','Admin','active'),
  ('08160000-0000-0000-0000-0000000000b1','08160000-0000-0000-0000-000000000002','B','m365ss-b@example.com','Admin','active'),
  ('08160000-0000-0000-0000-0000000000c1','08160000-0000-0000-0000-000000000003','C','m365ss-c@example.com','Admin','active');

-- Org 1: NO org_plans row (falls back to Enterprise) and NO org_features row.
-- Org 2: Starter (the matrix has m365_integration from Growth up), no override.
-- Org 3: Enterprise, operator override switched OFF.
insert into org_plans (org_id, plan_id) values
  ('08160000-0000-0000-0000-000000000002','starter'),
  ('08160000-0000-0000-0000-000000000003','enterprise');
insert into org_features (org_id, feature_key, enabled) values
  ('08160000-0000-0000-0000-000000000003','m365_integration',false);

select lives_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
     values ('08160000-0000-0000-0000-000000000001','08160000-0000-0000-0000-0000000000a1',
             '11111111-2222-3333-4444-555555555555', array['offline_access'],
             '\x10000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  'AC-M365SS-003 plan resolves M365 on and no override row exists: the connection write is accepted');

select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
     values ('08160000-0000-0000-0000-000000000002','08160000-0000-0000-0000-0000000000b1',
             '11111111-2222-3333-4444-555555555555', array['offline_access'],
             '\x11000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '42501', 'org_not_entitled',
  'AC-M365SS-003 plan resolves M365 off (Starter, no override): the connection write is rejected org_not_entitled');

select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
     values ('08160000-0000-0000-0000-000000000003','08160000-0000-0000-0000-0000000000c1',
             '11111111-2222-3333-4444-555555555555', array['offline_access'],
             '\x12000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '42501', 'org_not_entitled',
  'AC-M365SS-004 an operator override of enabled=false still wins over an Enterprise plan: write rejected');

-- An override of enabled=true switches a Starter org ON (override beats plan), so the guard accepts.
insert into org_features (org_id, feature_key, enabled) values
  ('08160000-0000-0000-0000-000000000002','m365_integration',true);
select lives_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
     values ('08160000-0000-0000-0000-000000000002','08160000-0000-0000-0000-0000000000b1',
             '11111111-2222-3333-4444-555555555555', array['offline_access'],
             '\x13000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  'AC-M365SS-004 an override of enabled=true on a plan without M365 is honoured (override beats plan)');

select * from finish();
rollback;
