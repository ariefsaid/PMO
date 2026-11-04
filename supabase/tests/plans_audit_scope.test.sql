-- S1 follow-up #1734 item 3 [pgTAP]: a global switch or plan change is a PLATFORM-wide event, so its
-- audit row must be platform-level — no operator home-org stamp — and must be distinguishable from an
-- org-scoped change. An org plan assignment or a per-org override keeps its org stamp.
--
-- Proves: (a) `audit_events.scope` pairs platform scope with a null org and org scope with an org;
-- (b) the three platform writers record platform rows and the two org writers record org rows;
-- (c) the platform Operator alone can read platform rows, and a customer Admin (including the
-- operator's own home org) cannot; (d) the platform audit writer is definer-only, search_path-pinned
-- and not client-callable.
begin;
create extension if not exists pgtap;
select plan(23);

insert into organizations (id, name) values
  ('05330300-0000-0000-0000-000000000001', 'Plans Audit Home Org'),
  ('05330300-0000-0000-0000-000000000002', 'Plans Audit Customer Org');
insert into auth.users (id, email) values
  ('05330300-0000-0000-0000-0000000000a1', 'plans-audit-operator@example.invalid'),
  ('05330300-0000-0000-0000-0000000000a2', 'plans-audit-home-admin@example.invalid'),
  ('05330300-0000-0000-0000-0000000000a3', 'plans-audit-customer-admin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05330300-0000-0000-0000-0000000000a1', '05330300-0000-0000-0000-000000000001', 'Audit Operator', 'plans-audit-operator@example.invalid', 'Admin', 'active'),
  ('05330300-0000-0000-0000-0000000000a2', '05330300-0000-0000-0000-000000000001', 'Audit Home Admin', 'plans-audit-home-admin@example.invalid', 'Admin', 'active'),
  ('05330300-0000-0000-0000-0000000000a3', '05330300-0000-0000-0000-000000000002', 'Audit Customer Admin', 'plans-audit-customer-admin@example.invalid', 'Admin', 'active');
insert into platform_operators (user_id) values ('05330300-0000-0000-0000-0000000000a1');

-- ── Structure: the table can express a platform row, and the writer is definer-only. ──────────────
select is((select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'audit_events' and column_name = 'org_id'),
  'YES', 'a platform audit row carries no operator home org (audit_events.org_id is nullable)');
select ok((select is_nullable = 'NO' and column_default = '''org''::text'
             from information_schema.columns
            where table_schema = 'public' and table_name = 'audit_events' and column_name = 'scope'),
  'every audit row declares a scope and an org-scoped row is the default');
select ok(exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%platform%' and pg_get_constraintdef(oid) like '%org_id%'
  ), 'a check constraint pairs platform scope with a null org and org scope with an org');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'log_platform_audit'
              and p.prosecdef and p.proconfig @> array['search_path=public']::text[]),
  1, 'the platform audit writer exists as a security definer with a pinned search_path');
select ok(not has_function_privilege('anon', 'public.log_platform_audit(text,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.log_platform_audit(text,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.log_platform_audit(text,uuid,jsonb)', 'EXECUTE'),
  'no API role may forge a platform audit row');

-- ── The write path: three platform changes and two org-scoped changes. ────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"05330300-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.operator_set_global_feature('stock', false) $$,
  'the Operator switches one key off for every organisation');
select lives_ok($$ select public.operator_set_plan_feature('starter', 'stock', true) $$,
  'the Operator edits a plan default');
select lives_ok($$ select public.operator_set_plan_limits('starter', 12, 27, 302) $$,
  'the Operator edits plan limits');
select lives_ok($$ select public.operator_set_org_plan('05330300-0000-0000-0000-000000000002', 'growth') $$,
  'the Operator assigns one organisation a plan');
select lives_ok($$ select public.operator_toggle_feature('05330300-0000-0000-0000-000000000002', 'stock', true) $$,
  'the Operator sets one organisation an override');
reset role;

-- ── The recorded home: platform changes carry no org, org changes keep theirs. ───────────────────
select is((select count(*)::int from public.audit_events
            where action = 'plans.global_feature.set'
              and scope = 'platform' and org_id is null
              and actor_id = '05330300-0000-0000-0000-0000000000a1'
              and detail ? 'from' and detail ? 'to'),
  1, 'a global switch change is a platform row with the actor, old and new values and no home org');
select is((select count(*)::int from public.audit_events
            where action = 'plans.plan_feature.set' and scope = 'platform' and org_id is null),
  1, 'a plan default change is a platform row');
select is((select count(*)::int from public.audit_events
            where action = 'plans.plan_limits.set' and scope = 'platform' and org_id is null),
  1, 'a plan limits change is a platform row');
select is((select count(*)::int from public.audit_events
            where scope = 'platform' and org_id is not null),
  0, 'no platform row is stamped with an organisation, not even the operator home org');
select is((select count(*)::int from public.audit_events
            where scope = 'org' and org_id is null),
  0, 'no org row loses its organisation stamp');
select is((select count(*)::int from public.audit_events
            where action = 'plans.org_plan.set'
              and scope = 'org' and org_id = '05330300-0000-0000-0000-000000000002'),
  1, 'a plan assignment stays an org-scoped row on the affected organisation');
select is((select count(*)::int from public.audit_events
            where action = 'plans.org_feature.change'
              and scope = 'org' and org_id = '05330300-0000-0000-0000-000000000002'),
  1, 'a per-org override stays an org-scoped row on the affected organisation');

-- ── Read scope: the platform Operator alone reads platform rows. ────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"05330300-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.audit_events where scope = 'platform'),
  0, 'an org Admin in the operator home org reads ZERO platform rows');
select is((select count(*)::int from public.audit_events
            where action = 'plans.org_plan.set' and org_id = '05330300-0000-0000-0000-000000000002'),
  0, 'the operator home org does not receive another organisation plan change');

set local request.jwt.claims = '{"sub":"05330300-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.audit_events where scope = 'platform'),
  0, 'the affected organisation Admin reads ZERO platform rows (no platform leak to a customer)');
select is((select count(*)::int from public.audit_events
            where action = 'plans.org_plan.set' and scope = 'org'),
  1, 'the affected organisation sees its own plan change on its own audit trail');

set local request.jwt.claims = '{"sub":"05330300-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.audit_events where scope = 'platform'),
  3, 'the platform Operator reads the three platform rows');
select is((select count(*)::int from public.audit_events
            where scope = 'org' and org_id = '05330300-0000-0000-0000-000000000002'),
  0, 'platform-level reads do not widen the Operator into another organisation audit trail');
reset role;

select * from finish();
rollback;
