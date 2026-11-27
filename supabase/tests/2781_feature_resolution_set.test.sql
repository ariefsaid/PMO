begin;
create extension if not exists pgtap;
select no_plan();
create or replace function pg_temp.old_resolution(p_org_id uuid, p_key text)
returns table(enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_global_enabled boolean;
  v_override_enabled boolean;
  v_has_override boolean;
  v_plan_enabled boolean;
  v_plan_id text;
  v_enabled boolean;
  v_display_enabled boolean;
  v_source text;
begin
  if p_key = any (public.core_feature_keys()) then
    return query select true, true, 'core'::text;
    return;
  end if;

  -- The Admin-owned control stays independent of the all-org and plan layers. Its historical
  -- default is on; the presence of an Admin row (on or off) controls the value.
  if p_key = 'feedback_surveys' then
    select f.enabled into v_override_enabled
      from public.org_features f
     where f.org_id = p_org_id and f.feature_key = p_key;
    v_has_override := found;
    v_enabled := case when v_has_override then v_override_enabled else true end;
    v_source := case when v_has_override then 'override' else 'plan' end;
    return query select v_enabled, v_enabled, v_source;
    return;
  end if;

  -- Unknown reads fail closed. Known switch keys are registered by the Enterprise matrix.
  if p_key is null or not exists (
    select 1 from public.plan_features f where f.feature_key = p_key
  ) then
    return query select false, false, 'unknown'::text;
    return;
  end if;

  select g.enabled into v_global_enabled
    from public.global_features g
   where g.feature_key = p_key;
  select f.enabled into v_override_enabled
    from public.org_features f
   where f.org_id = p_org_id and f.feature_key = p_key;
  v_has_override := found;
  select coalesce((select op.plan_id from public.org_plans op where op.org_id = p_org_id), 'enterprise')
    into v_plan_id;
  select f.enabled into v_plan_enabled
    from public.plan_features f
   where f.plan_id = v_plan_id and f.feature_key = p_key;

  if v_global_enabled is false then
    v_enabled := false;
    v_source := 'global';
  elsif v_has_override then
    v_enabled := v_override_enabled;
    v_source := 'override';
  else
    v_enabled := coalesce(v_plan_enabled, false);
    v_source := 'plan';
  end if;

  v_display_enabled := v_enabled;
  if p_key = 'revenue'
     and not v_has_override
     and exists (select 1 from public.external_domain_ownership d
                  where d.org_id = p_org_id and d.domain = 'revenue') then
    v_display_enabled := false;
  end if;

  return query select v_enabled, v_display_enabled, v_source;
end $$;
select ok(to_regprocedure('public.resolve_features_internal(uuid,text[])') is not null, 'AC-G5-001 set core exists');
create temp table corpus as select ('27800000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid id, i from generate_series(1,30) i;
insert into organizations(id,name) select id,'Resolution fixture '||i from corpus;
insert into org_plans(org_id,plan_id) select id,(array['starter','growth','pro','enterprise'])[1+i%4] from corpus where i%5<>0;
insert into org_features(org_id,feature_key,enabled)
select c.id,k.feature_key,(c.i%2=0) from corpus c cross join (select distinct feature_key from plan_features) k where c.i%3<>0;
insert into external_domain_ownership(org_id,external_tier,domain) select id,'erpnext','revenue' from corpus where i%2=0;
update global_features set enabled=false where feature_key in ('stock','crm');
create temp table keys as select distinct feature_key from plan_features union select unnest(core_feature_keys()) union select 'unknown-fixture' union select null;
select is((select count(*) from corpus c cross join keys k
 cross join lateral pg_temp.old_resolution(c.id,k.feature_key) a
 cross join lateral public.resolve_feature_internal(c.id,k.feature_key) b
 where row(a.*) is distinct from row(b.*)),0::bigint,'AC-G5-001 scalar equals frozen oracle across generated orgs and every key');
select is((select count(*) from corpus c cross join keys k
 cross join lateral pg_temp.old_resolution(c.id,k.feature_key) a
 cross join lateral public.resolve_features_internal(c.id,array[k.feature_key]) b
 where row(a.enabled,a.display_enabled,a.source) is distinct from row(b.enabled,b.display_enabled,b.source)),0::bigint,'AC-G5-001 set core equals frozen oracle');
insert into auth.users(id,email) select id,'resolution-'||i||'@example.invalid' from corpus;
insert into profiles(id,org_id,full_name,email,role,status)
select id,id,'Resolution Fixture','resolution-'||i||'@example.invalid',
 (enum_range(null::public.user_role))[1+(i-1)%cardinality(enum_range(null::public.user_role))], 'active' from corpus;
create function pg_temp.session_diff() returns bigint language plpgsql as $$
declare c record; n bigint; total bigint := 0;
begin
 for c in select * from corpus loop
  perform set_config('request.jwt.claims',json_build_object('sub',c.id,'role','authenticated')::text,true);
  select count(*) into n from public.resolved_org_features() b
   cross join lateral pg_temp.old_resolution(c.id,b.feature_key) a
   where row(a.enabled,a.display_enabled,a.source) is distinct from row(b.enabled,b.display_enabled,b.source);
  total := total+n;
  select count(*) into n from public.resolved_org_features();
  if n <> (select count(*) from plan_features where plan_id='enterprise') + cardinality(core_feature_keys()) then total := total+1; end if;
 end loop;
 return total;
end $$;
select is(pg_temp.session_diff(),0::bigint,'AC-G5-001 session projection equals frozen oracle for generated organisations and every job role');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*) from corpus c cross join lateral public.service_resolved_org_features(c.id) b
 cross join lateral pg_temp.old_resolution(c.id,b.feature_key) a
 where row(a.enabled,a.display_enabled,a.source) is distinct from row(b.enabled,b.display_enabled,b.source)),0::bigint,'AC-G5-001 service equals frozen oracle');
select is((select count(*) from corpus c cross join lateral public.service_resolved_org_features(c.id) b), (select count(*) from corpus)*(select count(*) from (select feature_key from plan_features where plan_id='enterprise' union all select unnest(core_feature_keys())) k), 'AC-G5-001 service preserves projection multiplicity');
select ok((select provolatile='s' and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid='public.resolve_feature_internal(uuid,text)'::regprocedure),'AC-G5-002 scalar stays stable and non-inlinable');
select ok(not has_function_privilege('authenticated','public.resolve_features_internal(uuid,text[])','execute') and not has_function_privilege('anon','public.resolve_features_internal(uuid,text[])','execute') and not has_function_privilege('service_role','public.resolve_features_internal(uuid,text[])','execute'), 'AC-G5-002 shared core stays internal');
select set_config('request.jwt.claims',json_build_object('sub',(select id from corpus where i=1),'role','authenticated')::text,true);
select throws_ok($$select * from public.service_resolved_org_features((select id from corpus where i=1))$$,'42501','service_role_only','AC-G5-002 service projection refuses a non-service caller');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select * from public.service_resolved_org_features('27800000-0000-0000-0000-00000000dead')$$,'23503','unknown_org','AC-G5-002 service projection refuses an unknown organisation');
select * from finish();
rollback;
