-- 0655_profiles_rls_and_features_set_based.test.sql
-- AC-PERF-001 resolved_org_features() returns exactly resolve_feature_internal(org, key) for every key, in every
--             entitlement state (default, org override on/off, starter plan, global off, revenue under an ERP, feedback_surveys).
-- AC-PERF-002 profiles reads keep their tenant + active-member scope after the policies went to statement-level InitPlans.
-- AC-PERF-003 profiles writes keep their rules after the self-references were replaced by auth_manager_id() / profile_prefs_unchanged().
-- AC-PERF-004 the two new definer helpers are not reachable by anon and cannot be used as a cross-tenant oracle.
-- pgTAP runs as the superuser (bypasses RLS), so authz assertions run under `set local role authenticated` + jwt claims.
begin;
select plan(26);

insert into organizations (id, name) values
  ('06550000-0000-0000-0000-00000000000a', 'PERF Org A'),
  ('06550000-0000-0000-0000-00000000000b', 'PERF Org B');
insert into auth.users (id, email) values
  ('06550000-0000-0000-0000-0000000000a1','perf-admin@example.com'),
  ('06550000-0000-0000-0000-0000000000a2','perf-eng@example.com'),
  ('06550000-0000-0000-0000-0000000000a3','perf-off@example.com'),
  ('06550000-0000-0000-0000-0000000000b1','perf-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status, manager_id, locale) values
  ('06550000-0000-0000-0000-0000000000a1','06550000-0000-0000-0000-00000000000a','Admin A','perf-admin@example.com','Admin','active',null,'id'),
  ('06550000-0000-0000-0000-0000000000a2','06550000-0000-0000-0000-00000000000a','Eng A','perf-eng@example.com','Engineer','active','06550000-0000-0000-0000-0000000000a1','en'),
  ('06550000-0000-0000-0000-0000000000a3','06550000-0000-0000-0000-00000000000a','Off A','perf-off@example.com','Engineer','disabled',null,'en'),
  ('06550000-0000-0000-0000-0000000000b1','06550000-0000-0000-0000-00000000000b','Eng B','perf-b@example.com','Engineer','active',null,'en');

-- ═══ AC-PERF-001 — set-based resolved_org_features() == the per-key oracle ═══
-- Both sides run as the same caller (claims set; the function is a definer, so no role switch is needed). The oracle
-- is resolve_feature_internal(), which 0655 does not touch.
create function pg_temp.features_diff(p_user uuid) returns integer language plpgsql as $$
declare v_org uuid; n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select org_id into v_org from public.profiles where id = p_user;
  create temp table if not exists f_new (feature_key text, enabled boolean, display_enabled boolean, source text) on commit drop;
  create temp table if not exists f_old (feature_key text, enabled boolean, display_enabled boolean, source text) on commit drop;
  truncate f_new, f_old;
  insert into f_new select * from public.resolved_org_features();
  insert into f_old select k.feature_key, r.enabled, r.display_enabled, r.source
    from (select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'
          union all select unnest(public.core_feature_keys())) k
    cross join lateral public.resolve_feature_internal(v_org, k.feature_key) r;
  select (select count(*) from (select * from f_new except all select * from f_old) a)
       + (select count(*) from (select * from f_old except all select * from f_new) b) into n;
  return n;
end $$;

select is(pg_temp.features_diff('06550000-0000-0000-0000-0000000000a1'), 0, 'AC-PERF-001 default org: same rows as the per-key oracle');
select is((select count(*)::int from f_new), (select count(*)::int from plan_features where plan_id='enterprise') + 8,
  'AC-PERF-001 one row per enterprise key plus the eight core keys');

insert into org_features (org_id, feature_key, enabled) values
  ('06550000-0000-0000-0000-00000000000a', 'crm', false),
  ('06550000-0000-0000-0000-00000000000a', 'feedback_surveys', false);
insert into org_plans (org_id, plan_id) values ('06550000-0000-0000-0000-00000000000a', 'starter');
update global_features set enabled = false where feature_key = 'stock';
select is(pg_temp.features_diff('06550000-0000-0000-0000-0000000000a1'), 0,
  'AC-PERF-001 override off + starter plan + global off + feedback_surveys override: same rows as the oracle');
select ok((select count(*) from f_new where source = 'override') >= 2 and (select count(*) from f_new where source = 'global') = 1
          and (select count(*) from f_new where enabled is false and source = 'plan') > 0,
  'AC-PERF-001 that state exercises override, global and plan-disabled sources (the comparison is not vacuous)');

insert into org_features (org_id, feature_key, enabled) values ('06550000-0000-0000-0000-00000000000a', 'procurement', true);
select is(pg_temp.features_diff('06550000-0000-0000-0000-0000000000a2'), 0, 'AC-PERF-001 plan-disabled key switched on by override: same rows (Engineer caller)');

delete from org_plans where org_id = '06550000-0000-0000-0000-00000000000a';
insert into org_features (org_id, feature_key, enabled) values ('06550000-0000-0000-0000-00000000000a', 'revenue', true);
select is(pg_temp.features_diff('06550000-0000-0000-0000-0000000000a1'), 0, 'AC-PERF-001 revenue override with no ERP owner: same rows');
insert into external_domain_ownership (org_id, external_tier, domain) values ('06550000-0000-0000-0000-00000000000a', 'erpnext', 'revenue');
select is(pg_temp.features_diff('06550000-0000-0000-0000-0000000000a1'), 0, 'AC-PERF-001 revenue override while an ERP owns revenue: same rows');
delete from org_features where org_id = '06550000-0000-0000-0000-00000000000a' and feature_key = 'revenue';
select is(pg_temp.features_diff('06550000-0000-0000-0000-0000000000a1'), 0, 'AC-PERF-001 revenue from the plan while an ERP owns revenue: same rows');
select is((select display_enabled from f_new where feature_key = 'revenue'), false,
  'AC-PERF-001 ... and revenue is hidden from display (display_enabled false) in that state');

select set_config('request.jwt.claims', '{"sub":"06550000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
select throws_ok($$select * from public.resolved_org_features()$$, '42501', 'inactive', 'AC-PERF-001 a disabled member is refused (unchanged guard)');

-- rows an UPDATE touches for the current caller (RLS hides, not errors, rows a USING clause rejects)
create function pg_temp.rows_updated(p_id uuid) returns integer language plpgsql as $$
declare n integer;
begin update profiles set title = 'x' where id = p_id; get diagnostics n = row_count; return n; end $$;

-- ═══ AC-PERF-002 — profiles reads: tenant and active-member scope ═══
set local role authenticated;
set local request.jwt.claims = '{"sub":"06550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from profiles where org_id = '06550000-0000-0000-0000-00000000000a'), 3, 'AC-PERF-002 an active member sees every profile of their own org');
select is((select count(*)::int from profiles where org_id = '06550000-0000-0000-0000-00000000000b'), 0, 'AC-PERF-002 another org''s profiles are invisible');
select is((select count(*)::int from profiles where id = '06550000-0000-0000-0000-0000000000b1'), 0, 'AC-PERF-002 ... also by id');
set local request.jwt.claims = '{"sub":"06550000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from profiles), 0, 'AC-PERF-002 a disabled member reads no profile at all');

-- ═══ AC-PERF-003 — profiles writes keep their rules ═══
set local request.jwt.claims = '{"sub":"06550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$update profiles set title = 'Site engineer' where id = '06550000-0000-0000-0000-0000000000a2'$$, 'AC-PERF-003 self may edit own title');
select throws_ok($$update profiles set role = 'Admin' where id = '06550000-0000-0000-0000-0000000000a2'$$, '42501', null, 'AC-PERF-003 self may not change own role');
select throws_ok($$update profiles set manager_id = null where id = '06550000-0000-0000-0000-0000000000a2'$$, '42501', null, 'AC-PERF-003 self may not change own manager');
select throws_ok($$update profiles set org_id = '06550000-0000-0000-0000-00000000000b' where id = '06550000-0000-0000-0000-0000000000a2'$$, '42501', null, 'AC-PERF-003 self may not change own org');
set local request.jwt.claims = '{"sub":"06550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update profiles set locale = 'de' where id = '06550000-0000-0000-0000-0000000000a2'$$, '42501', null, 'AC-PERF-003 even an Admin may not change another person''s locale');
select lives_ok($$update profiles set title = 'Lead' where id = '06550000-0000-0000-0000-0000000000a2'$$, 'AC-PERF-003 an Admin may edit a peer''s title (locale untouched)');

-- ═══ AC-PERF-004 — the new helpers ═══
select is(public.profile_prefs_unchanged('06550000-0000-0000-0000-0000000000a2', 'en', null, null), true, 'AC-PERF-004 own-org profile: stored prefs equal -> true');
select is(public.profile_prefs_unchanged('06550000-0000-0000-0000-0000000000b1', 'en', null, null), false, 'AC-PERF-004 other-org profile: false, never an equality oracle');
set local request.jwt.claims = '{"sub":"06550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.rows_updated('06550000-0000-0000-0000-0000000000a1'), 0,
  'AC-PERF-003 an Engineer may not update a peer''s profile');
set local request.jwt.claims = '{"sub":"06550000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(pg_temp.rows_updated('06550000-0000-0000-0000-0000000000a3'), 0,
  'AC-PERF-003 a disabled member''s UPDATE of their own profile is refused');
select is(public.profile_prefs_unchanged('06550000-0000-0000-0000-0000000000a2', 'en', null, null), false,
  'AC-PERF-004 a disabled member gets false from the helper (not an equality oracle)');
reset role;
select ok(not has_function_privilege('anon', 'public.auth_manager_id()', 'execute')
      and not has_function_privilege('anon', 'public.profile_prefs_unchanged(uuid,text,text,text)', 'execute'),
  'AC-PERF-004 anon cannot execute either new definer');

select * from finish();
rollback;
