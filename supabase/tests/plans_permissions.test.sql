-- AC-PLN-003 [pgTAP]: registry writes are Operator-only, service reads use the narrow RPC,
-- and the Admin-owned feedback control stays separate.
begin;
create extension if not exists pgtap;
select plan(36);

insert into organizations (id, name) values
  ('05330000-0000-0000-0000-000000000001', 'Plans Permissions A'),
  ('05330000-0000-0000-0000-000000000002', 'Plans Permissions B');
insert into auth.users (id, email) values
  ('05330000-0000-0000-0000-0000000000a1', 'plans-permissions-operator@example.invalid'),
  ('05330000-0000-0000-0000-0000000000a2', 'plans-permissions-admin@example.invalid'),
  ('05330000-0000-0000-0000-0000000000a3', 'plans-permissions-member@example.invalid'),
  ('05330000-0000-0000-0000-0000000000a4', 'plans-permissions-disabled@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05330000-0000-0000-0000-0000000000a1', '05330000-0000-0000-0000-000000000001', 'Fixture Operator', 'plans-permissions-operator@example.invalid', 'Admin', 'active'),
  ('05330000-0000-0000-0000-0000000000a2', '05330000-0000-0000-0000-000000000001', 'Fixture Admin', 'plans-permissions-admin@example.invalid', 'Admin', 'active'),
  ('05330000-0000-0000-0000-0000000000a3', '05330000-0000-0000-0000-000000000002', 'Fixture Member', 'plans-permissions-member@example.invalid', 'Finance', 'active'),
  ('05330000-0000-0000-0000-0000000000a4', '05330000-0000-0000-0000-000000000001', 'Fixture Disabled Operator', 'plans-permissions-disabled@example.invalid', 'Admin', 'disabled');
insert into platform_operators (user_id) values
  ('05330000-0000-0000-0000-0000000000a1'),
  ('05330000-0000-0000-0000-0000000000a4');

-- Catalog authority: none of the API roles can inspect or mutate the private registry directly.
select is((select count(*)::int from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('plans', 'plan_features', 'org_plans', 'global_features')
    and grantee in ('anon', 'authenticated', 'service_role')), 0,
  'AC-PLN-003 registry tables grant no direct privileges to API roles');
select ok(not has_function_privilege('anon', 'public.operator_set_org_plan(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_set_global_feature(text,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_clear_feature_override(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_set_plan_feature(text,text,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_set_plan_limits(text,integer,integer,integer)', 'EXECUTE'),
  'AC-PLN-003 anon cannot execute any new Operator writer');
select ok(has_function_privilege('authenticated', 'public.operator_set_org_plan(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_set_global_feature(text,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_clear_feature_override(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_set_plan_feature(text,text,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_set_plan_limits(text,integer,integer,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_toggle_feature(uuid,text,boolean)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_set_org_plan(uuid,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_set_global_feature(text,boolean)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_clear_feature_override(uuid,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_set_plan_feature(text,text,boolean)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_set_plan_limits(text,integer,integer,integer)', 'EXECUTE'),
  'AC-PLN-003 authenticated can reach the guarded Operator RPC surface');
select ok(has_function_privilege('authenticated', 'public.resolved_org_features()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_resolved_org_features(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolved_org_features()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_resolved_org_features(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.resolved_org_features()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_resolved_org_features(uuid)', 'EXECUTE'),
  'authenticated projections are callable while anon is excluded');
select ok(has_function_privilege('service_role', 'public.service_resolved_org_features(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.service_resolved_org_features(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.service_resolved_org_features(uuid)', 'EXECUTE'),
  'the service projection is callable only by service_role');
select ok(not has_function_privilege('anon', 'public.resolve_feature_internal(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.resolve_feature_internal(uuid,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.resolve_feature_internal(uuid,text)', 'EXECUTE'),
  'the shared resolver remains private to definer-owned callers');
select ok(not has_function_privilege('anon', 'public.assert_active_operator()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.assert_active_operator()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.assert_active_operator()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.assert_switchable_feature_key(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.assert_switchable_feature_key(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.assert_switchable_feature_key(text)', 'EXECUTE'),
  'internal authorization helpers are not client-callable');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('resolve_feature_internal', 'org_has_feature', 'org_feature_enabled',
      'resolved_org_features', 'operator_resolved_org_features', 'service_resolved_org_features',
      'operator_set_org_plan', 'operator_set_global_feature', 'operator_clear_feature_override',
      'operator_set_plan_feature', 'operator_set_plan_limits', 'operator_toggle_feature',
      'audit_org_feature_change')
    and p.proconfig @> array['search_path=public']::text[]),
  13, 'every feature resolver and writer definer pins search_path');
select ok((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not p.prosecdef
    and p.proname in ('assert_active_operator', 'assert_switchable_feature_key')
    and p.proconfig @> array['search_path=public']::text[]) = 2,
  'private invoker helpers also pin search_path');

-- A client Admin has no table path and cannot turn the Operator RPC into a client write.
set local role authenticated;
set local request.jwt.claims = '{"sub":"05330000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ insert into public.org_plans (org_id, plan_id) values ('05330000-0000-0000-0000-000000000001', 'starter') $$,
  '42501', null, 'AC-PLN-003 an Admin cannot assign a plan directly');
select throws_ok($$ select public.operator_set_org_plan('05330000-0000-0000-0000-000000000001', 'starter') $$,
  '42501', 'operator_only', 'AC-PLN-003 an Admin cannot assign a plan through RPC');
select lives_ok($$ select public.admin_set_feedback_surveys(true) $$,
  'AC-PLN-003 an Admin retains the own-org feedback switch path');
reset role;

-- The active Operator can assign an org plan and set each switch layer through the RPCs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"05330000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.operator_set_org_plan('05330000-0000-0000-0000-000000000001', 'starter') $$,
  'AC-PLN-003 the active Operator can assign a plan');
select throws_ok($$ select public.operator_set_org_plan('05330000-0000-0000-0000-000000000099', 'starter') $$,
  '23503', 'unknown_org', 'the Operator cannot assign a plan to a nonexistent org');
select throws_ok($$ select public.operator_set_org_plan('05330000-0000-0000-0000-000000000001', 'unlisted') $$,
  '23503', 'unknown_plan', 'the Operator cannot assign an unknown plan');
select lives_ok($$ select public.operator_set_global_feature('stock', false) $$,
  'AC-PLN-003 the active Operator can set a global feature');
select lives_ok($$ select public.operator_toggle_feature('05330000-0000-0000-0000-000000000001', 'stock', true) $$,
  'AC-PLN-003 the active Operator can set an org override');
select lives_ok($$ select public.operator_clear_feature_override('05330000-0000-0000-0000-000000000001', 'stock') $$,
  'AC-PLN-003 the active Operator can clear an org override');
select lives_ok($$ select public.operator_set_plan_feature('starter', 'stock', true) $$,
  'AC-PLN-003 the active Operator can edit a plan feature');
select lives_ok($$ select public.operator_set_plan_limits('starter', 11, 26, 301) $$,
  'AC-PLN-003 the active Operator can edit plan limits');
select throws_ok($$ select public.operator_set_plan_limits('starter', -1, 26, 301) $$,
  'P0001', 'invalid_limit', 'negative plan limits are rejected');
select throws_ok($$ select public.operator_set_global_feature('feedback_surveys', false) $$,
  'P0001', 'admin_owned_feature', 'feedback_surveys remains outside the global switch path');
select throws_ok($$ select public.operator_toggle_feature('05330000-0000-0000-0000-000000000001', 'feedback_surveys', false) $$,
  'P0001', 'admin_owned_feature', 'feedback_surveys remains outside the Operator override path');
select throws_ok($$ insert into public.org_features (org_id, feature_key, enabled)
    values ('05330000-0000-0000-0000-000000000002', 'feedback_surveys', false) $$,
  '42501', null, 'AC-PLN-003 the Operator table policy cannot change another org Admin feedback switch');
select throws_ok($$ select public.operator_set_plan_feature('starter', 'feedback_surveys', false) $$,
  'P0001', 'admin_owned_feature', 'feedback_surveys remains outside plan defaults');
select is((select count(*)::int from public.operator_resolved_org_features('05330000-0000-0000-0000-000000000001')
            where feature_key = 'stock' and enabled),
  0, 'the Operator projection reflects the resolved entitlement');
reset role;

-- Admin feedback state remains independently stored, with no global_features entry.
select is((select enabled from public.org_features where org_id = '05330000-0000-0000-0000-000000000001'
            and feature_key = 'feedback_surveys'), true,
  'the Admin feedback path writes only the org feedback row');
select is((select count(*)::int from public.global_features where feature_key = 'feedback_surveys'), 0,
  'the Admin feedback key has no global switch row');
select is((select count(*)::int from public.plan_features where feature_key = 'feedback_surveys' and enabled), 4,
  'feedback_surveys plan rows remain on but do not control the Admin switch');

-- Active status is checked independently from platform-operator membership.
set local role authenticated;
set local request.jwt.claims = '{"sub":"05330000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.operator_set_global_feature('stock', true) $$,
  '42501', 'operator_only', 'AC-PLN-003 a non-Operator member is denied');
set local request.jwt.claims = '{"sub":"05330000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.operator_set_org_plan('05330000-0000-0000-0000-000000000002', 'growth') $$,
  '42501', 'inactive', 'AC-PLN-003 an inactive Operator is denied');
reset role;

-- Service workers use the audited projection, without direct registry reads or writes.
select ok(not has_table_privilege('service_role', 'public.plans', 'SELECT')
  and not has_table_privilege('service_role', 'public.plan_features', 'SELECT')
  and not has_table_privilege('service_role', 'public.org_plans', 'SELECT')
  and not has_table_privilege('service_role', 'public.global_features', 'SELECT')
  and not has_table_privilege('service_role', 'public.plans', 'INSERT')
  and not has_table_privilege('service_role', 'public.plan_features', 'INSERT')
  and not has_table_privilege('service_role', 'public.org_plans', 'INSERT')
  and not has_table_privilege('service_role', 'public.global_features', 'INSERT'),
  'service_role has no direct registry access');
select ok(has_table_privilege('service_role', 'public.org_features', 'SELECT')
  and not has_table_privilege('service_role', 'public.org_features', 'INSERT')
  and not has_table_privilege('service_role', 'public.org_features', 'UPDATE')
  and not has_table_privilege('service_role', 'public.org_features', 'DELETE')
  and not has_table_privilege('service_role', 'public.org_features', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.org_features', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.org_features', 'TRUNCATE'),
  'the legacy override table keeps only its service read path and cannot be truncated by API roles');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.service_resolved_org_features('05330000-0000-0000-0000-000000000001')
            where feature_key = 'stock' and enabled),
  0, 'AC-PLN-003 service_role reads resolved features through its server-only entry point');
reset role;

-- Every operator mutation leaves the actor, timestamp and old/new values in the same audit transaction.
select ok((select count(*)::int from public.audit_events
  where actor_id = '05330000-0000-0000-0000-0000000000a1'
    and action like 'plans.%'
    and created_at is not null) >= 5,
  'AC-PLN-003 Operator mutations are audit-logged with actor and timestamp');
select ok(exists (select 1 from public.audit_events
  where actor_id = '05330000-0000-0000-0000-0000000000a1'
    and action = 'plans.global_feature.set'
    and detail ? 'from' and detail ? 'to'),
  'AC-PLN-003 global switch audit includes old and new values');

select * from finish();
rollback;
