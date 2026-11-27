begin;
create or replace function public.resolve_feature_internal(p_org_id uuid, p_key text)
returns table(enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
create or replace function public.resolved_org_features()
 returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
 language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare
  v_org_id uuid;
  v_plan_id text;
  v_revenue_external boolean;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  v_org_id := public.auth_org_id();
  if v_org_id is null then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  select coalesce((select op.plan_id from public.org_plans op where op.org_id = v_org_id), 'enterprise') into v_plan_id;
  select exists (select 1 from public.external_domain_ownership d where d.org_id = v_org_id and d.domain = 'revenue')
    into v_revenue_external;
  return query
    select k.feature_key,
           r.enabled,
           r.enabled and not (k.feature_key = 'revenue' and r.source = 'plan' and v_revenue_external) as display_enabled,
           r.source
      from (
        select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'
        union all select unnest(public.core_feature_keys())
      ) k
      left join public.global_features g on g.feature_key = k.feature_key
      left join public.org_features o on o.org_id = v_org_id and o.feature_key = k.feature_key
      left join public.plan_features pf on pf.plan_id = v_plan_id and pf.feature_key = k.feature_key
      cross join lateral (
        select
          case
            when k.feature_key = any (public.core_feature_keys()) then true
            when k.feature_key = 'feedback_surveys' then coalesce(o.enabled, true)
            when not exists (select 1 from public.plan_features x where x.feature_key = k.feature_key) then false
            when g.enabled is false then false
            when o.feature_key is not null then o.enabled
            else coalesce(pf.enabled, false)
          end as enabled,
          case
            when k.feature_key = any (public.core_feature_keys()) then 'core'
            when k.feature_key = 'feedback_surveys' then case when o.feature_key is not null then 'override' else 'plan' end
            when not exists (select 1 from public.plan_features x where x.feature_key = k.feature_key) then 'unknown'
            when g.enabled is false then 'global'
            when o.feature_key is not null then 'override'
            else 'plan'
          end as source
      ) r;
end $function$;
create or replace function public.service_resolved_org_features(p_org_id uuid)
returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  return query
    select k.feature_key, r.enabled, r.display_enabled, r.source
      from (
        select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'
        union all select unnest(public.core_feature_keys())
      ) k
      cross join lateral public.resolve_feature_internal(p_org_id, k.feature_key) r;
end $$;
drop function if exists public.resolve_features_internal(uuid,text[]);
commit;
