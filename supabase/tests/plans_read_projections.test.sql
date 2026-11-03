-- Plans S3 — the read projections the Operator console and the Admin "Your plan" page need.
--
-- 0537 adds four read-only functions and nothing else:
--   * operator_plan_catalogue()   — plans + limits + the plan matrix + the all-orgs flags, one row
--                                   per (plan, feature) so the console renders from ONE call;
--   * operator_org_plan(uuid)     — the selected org's assigned plan (null = unassigned, which the
--                                   resolver treats as Enterprise);
--   * operator_org_overrides(uuid)— which per-org override rows exist, even when a global off
--                                   currently outranks them (the resolver then reports source
--                                   'global', so presence has to be answered separately);
--   * resolved_org_plan()         — the caller's OWN org plan + limits, for the read-only Admin page
--                                   (FR-PLN-014). Its signature is frozen: S4 consumes it.
--
-- The registry tables themselves stay revoked from every API role (0530); these functions are the
-- only client path, they are read-only, and each one re-asserts membership/Operator inside its body
-- (clarity projections in the FE are never the boundary — ADR-0016).
begin;
create extension if not exists pgtap;
select plan(29);

insert into organizations (id, name) values
  ('05370000-0000-0000-0000-000000000001', 'Plans Reads A'),
  ('05370000-0000-0000-0000-000000000002', 'Plans Reads B'),
  ('05370000-0000-0000-0000-000000000003', 'Plans Reads Unassigned');
insert into auth.users (id, email) values
  ('05370000-0000-0000-0000-0000000000a1', 'plans-reads-operator@example.invalid'),
  ('05370000-0000-0000-0000-0000000000a2', 'plans-reads-admin@example.invalid'),
  ('05370000-0000-0000-0000-0000000000a3', 'plans-reads-member-b@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05370000-0000-0000-0000-0000000000a1', '05370000-0000-0000-0000-000000000001', 'Fixture Operator', 'plans-reads-operator@example.invalid', 'Admin', 'active'),
  ('05370000-0000-0000-0000-0000000000a2', '05370000-0000-0000-0000-000000000001', 'Fixture Admin', 'plans-reads-admin@example.invalid', 'Admin', 'active'),
  ('05370000-0000-0000-0000-0000000000a3', '05370000-0000-0000-0000-000000000002', 'Fixture Member B', 'plans-reads-member-b@example.invalid', 'Finance', 'active');
insert into platform_operators (user_id) values ('05370000-0000-0000-0000-0000000000a1');

-- A starts on Starter, B on Pro; the third org keeps whatever the migration backfilled (Enterprise)
-- and is re-pointed at no row below to prove the Enterprise fallback.
insert into org_plans (org_id, plan_id) values
  ('05370000-0000-0000-0000-000000000001', 'starter'),
  ('05370000-0000-0000-0000-000000000002', 'pro')
on conflict (org_id) do update set plan_id = excluded.plan_id;
delete from org_plans where org_id = '05370000-0000-0000-0000-000000000003';

-- ── Privileges: read-only, authenticated-only, never anon/service ------------------------------
select ok(has_function_privilege('authenticated', 'public.operator_plan_catalogue()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_org_plan(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.operator_org_overrides(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.resolved_org_plan()', 'EXECUTE'),
  'the four read projections are reachable by authenticated');
select ok(not has_function_privilege('anon', 'public.operator_plan_catalogue()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_org_plan(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.operator_org_overrides(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolved_org_plan()', 'EXECUTE'),
  'no read projection is anon-executable');
select ok(not has_function_privilege('service_role', 'public.operator_plan_catalogue()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_org_plan(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.operator_org_overrides(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.resolved_org_plan()', 'EXECUTE'),
  'the reads are Operator/member surfaces, not service surfaces');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('operator_plan_catalogue', 'operator_org_plan', 'operator_org_overrides', 'resolved_org_plan')
    and p.proconfig @> array['search_path=public']::text[]),
  4, 'every read projection pins search_path and is a definer');
select is((select count(*)::int from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('plans', 'plan_features', 'org_plans', 'global_features')
    and grantee in ('anon', 'authenticated', 'service_role')),
  0, 'the registry tables stay unreachable for API roles — the functions are the only path');

-- ── operator_plan_catalogue(): the console's one read -------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"05370000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.operator_plan_catalogue()), 100,
  'the catalogue returns one row per (plan, feature): 4 plans x 25 catalogue keys');
select is((select count(distinct c.plan_id)::int from public.operator_plan_catalogue() c), 4,
  'the catalogue carries all four plans');
select is((select c.seat_limit from public.operator_plan_catalogue() c
  where c.plan_id = 'starter' limit 1), 10,
  'the catalogue carries the plan limits (starter seats)');
select is((select count(*)::int from public.operator_plan_catalogue() c
  where c.plan_id = 'starter' and c.feature_enabled), 8,
  'the catalogue carries the plan matrix (starter enables its eight tier-one keys)');
select is((select count(*)::int from public.operator_plan_catalogue() c
  where c.plan_id = 'enterprise' and not c.feature_enabled), 0,
  'Enterprise enables every catalogue key');
select ok((select c.global_enabled from public.operator_plan_catalogue() c
  where c.feature_key = 'stock' limit 1) is not null,
  'the all-orgs column reads the global switch for a normal key');
select ok((select c.global_enabled from public.operator_plan_catalogue() c
  where c.feature_key = 'feedback_surveys' limit 1) is null,
  'the Admin-owned feedback key has no global row (excluded from Operator global control)');

select is(public.operator_org_plan('05370000-0000-0000-0000-000000000001'), 'starter',
  'operator_org_plan returns the assigned plan');
select is(public.operator_org_plan('05370000-0000-0000-0000-000000000003'), null,
  'operator_org_plan returns null when no plan row exists (resolves as Enterprise)');
select throws_ok(
  $$ select public.operator_org_plan('05370000-0000-0000-0000-0000000000ff'::uuid) $$,
  '23503', null, 'operator_org_plan rejects an unknown organisation');

-- operator_org_overrides(): presence survives an all-orgs off that outranks the override.
reset role;
insert into global_features (feature_key, enabled) values ('stock', false)
on conflict (feature_key) do update set enabled = false;
insert into org_features (org_id, feature_key, enabled) values
  ('05370000-0000-0000-0000-000000000001', 'stock', true)
on conflict (org_id, feature_key) do update set enabled = excluded.enabled;
set local role authenticated;
select is(
  (select array_agg(o.feature_key order by o.feature_key)
     from public.operator_org_overrides('05370000-0000-0000-0000-000000000001') o),
  array['stock'],
  'operator_org_overrides lists an override the all-orgs off switch outranks');
select is(
  (select r.source
     from public.operator_resolved_org_features('05370000-0000-0000-0000-000000000001') r
    where r.feature_key = 'stock'),
  'global',
  'the same key still resolves as global, so presence cannot be inferred from source');
select is(
  (select count(*)::int from public.operator_org_overrides('05370000-0000-0000-0000-000000000002')),
  0, 'one organisation''s overrides never answer for another');
select throws_ok(
  $$ select public.operator_org_overrides('05370000-0000-0000-0000-0000000000ff'::uuid) $$,
  '23503', null, 'operator_org_overrides rejects an unknown organisation');

-- resolved_org_plan(): own org only, Enterprise when unassigned.
select is((select p.plan_id from public.resolved_org_plan() p), 'starter',
  'resolved_org_plan returns the caller''s own plan');
select is((select p.plan_name from public.resolved_org_plan() p), 'Starter',
  'resolved_org_plan carries the plan name');
select is((select p.seat_limit from public.resolved_org_plan() p), 10,
  'resolved_org_plan carries the limits');
select is((select count(*)::int from public.resolved_org_plan()), 1,
  'resolved_org_plan returns exactly one row');

-- A non-Operator Admin keeps the org read but gains no console read.
set local request.jwt.claims = '{"sub":"05370000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select * from public.operator_plan_catalogue() $$,
  '42501', null, 'a non-Operator Admin cannot read the plan catalogue');
select throws_ok($$ select public.operator_org_plan('05370000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a non-Operator Admin cannot read another org''s plan');
select throws_ok($$ select * from public.operator_org_overrides('05370000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a non-Operator Admin cannot read another org''s overrides');
select is((select p.plan_id from public.resolved_org_plan() p), 'starter',
  'a non-Operator Admin still reads the own-org plan (FR-PLN-014)');

-- Org B's member reads B, never A, and the unassigned org resolves to Enterprise.
set local request.jwt.claims = '{"sub":"05370000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select p.plan_id from public.resolved_org_plan() p), 'pro',
  'a member of another org reads that org''s plan, not the Operator''s');

reset role;
insert into auth.users (id, email) values
  ('05370000-0000-0000-0000-0000000000a4', 'plans-reads-unassigned@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05370000-0000-0000-0000-0000000000a4', '05370000-0000-0000-0000-000000000003', 'Fixture Unassigned', 'plans-reads-unassigned@example.invalid', 'Admin', 'active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"05370000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select p.plan_id from public.resolved_org_plan() p), 'enterprise',
  'an unassigned org resolves to the Enterprise row');

select * from finish();
rollback;
