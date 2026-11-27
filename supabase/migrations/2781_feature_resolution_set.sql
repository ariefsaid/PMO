-- drops: resolve_feature_internal(uuid,text) | "language plpgsql stable security definer set search_path = public as $$" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "declare" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_global_enabled boolean;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_override_enabled boolean;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_has_override boolean;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_plan_enabled boolean;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_plan_id text;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_enabled boolean;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_display_enabled boolean;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_source text;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "if p_key = any (public.core_feature_keys()) then" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "return query select true, true, 'core'::text;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "return;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "return;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "return;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "end if;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "end if;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "end if;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "end if;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "end if;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "if p_key = 'feedback_surveys' then" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "select f.enabled into v_override_enabled" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "select f.enabled into v_override_enabled" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "from public.org_features f" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "from public.org_features f" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "where f.org_id = p_org_id and f.feature_key = p_key;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "where f.org_id = p_org_id and f.feature_key = p_key;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_has_override := found;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_has_override := found;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_enabled := case when v_has_override then v_override_enabled else true end;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_source := case when v_has_override then 'override' else 'plan' end;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "return query select v_enabled, v_enabled, v_source;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "if p_key is null or not exists (" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "select 1 from public.plan_features f where f.feature_key = p_key" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | ") then" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "return query select false, false, 'unknown'::text;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "select g.enabled into v_global_enabled" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "from public.global_features g" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "where g.feature_key = p_key;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "select coalesce((select op.plan_id from public.org_plans op where op.org_id = p_org_id), 'enterprise')" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "into v_plan_id;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "select f.enabled into v_plan_enabled" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "from public.plan_features f" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "where f.plan_id = v_plan_id and f.feature_key = p_key;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "if v_global_enabled is false then" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_enabled := false;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_source := 'global';" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "elsif v_has_override then" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_enabled := v_override_enabled;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_source := 'override';" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "else" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_enabled := coalesce(v_plan_enabled, false);" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_source := 'plan';" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_display_enabled := v_enabled;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "if p_key = 'revenue'" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "and not v_has_override" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "and exists (select 1 from public.external_domain_ownership d" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "where d.org_id = p_org_id and d.domain = 'revenue') then" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "v_display_enabled := false;" | Resolution moves to the shared set core.
-- drops: resolve_feature_internal(uuid,text) | "return query select v_enabled, v_display_enabled, v_source;" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "language plpgsql stable security definer set search_path to 'public'" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "v_plan_id text;" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "v_revenue_external boolean;" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "select coalesce((select op.plan_id from public.org_plans op where op.org_id = v_org_id), 'enterprise') into v_plan_id;" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "select exists (select 1 from public.external_domain_ownership d where d.org_id = v_org_id and d.domain = 'revenue')" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "into v_revenue_external;" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "return query" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "select k.feature_key," | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "r.enabled," | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "r.enabled and not (k.feature_key = 'revenue' and r.source = 'plan' and v_revenue_external) as display_enabled," | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "r.source" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "from (" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "union all select unnest(public.core_feature_keys())" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | ") k" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "left join public.global_features g on g.feature_key = k.feature_key" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "left join public.org_features o on o.org_id = v_org_id and o.feature_key = k.feature_key" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "left join public.plan_features pf on pf.plan_id = v_plan_id and pf.feature_key = k.feature_key" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "cross join lateral (" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "select" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "case" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "case" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when k.feature_key = any (public.core_feature_keys()) then true" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when k.feature_key = 'feedback_surveys' then coalesce(o.enabled, true)" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when not exists (select 1 from public.plan_features x where x.feature_key = k.feature_key) then false" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when g.enabled is false then false" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when o.feature_key is not null then o.enabled" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "else coalesce(pf.enabled, false)" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "end as enabled," | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when k.feature_key = any (public.core_feature_keys()) then 'core'" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when k.feature_key = 'feedback_surveys' then case when o.feature_key is not null then 'override' else 'plan' end" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when not exists (select 1 from public.plan_features x where x.feature_key = k.feature_key) then 'unknown'" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when g.enabled is false then 'global'" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "when o.feature_key is not null then 'override'" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "else 'plan'" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | "end as source" | Resolution moves to the shared set core.
-- drops: resolved_org_features() | ") r;" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | "language plpgsql stable security definer set search_path = public as $$" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | "return query" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | "select k.feature_key, r.enabled, r.display_enabled, r.source" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | "from (" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | "select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | "union all select unnest(public.core_feature_keys())" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | ") k" | Resolution moves to the shared set core.
-- drops: service_resolved_org_features(uuid) | "cross join lateral public.resolve_feature_internal(p_org_id, k.feature_key) r;" | Resolution moves to the shared set core.
-- Resolve requested feature keys together; adapters retain their admission contracts.
begin;
create function public.resolve_features_internal(p_org_id uuid, p_keys text[])
returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare
  v_plan_id text;
  v_revenue_external boolean;
begin
  select coalesce((select op.plan_id from public.org_plans op where op.org_id = p_org_id), 'enterprise') into v_plan_id;
  select exists (select 1 from public.external_domain_ownership d where d.org_id = p_org_id and d.domain = 'revenue')
    into v_revenue_external;
  return query
    select k.feature_key,
           r.enabled,
           r.enabled and not (k.feature_key = 'revenue' and r.source = 'plan' and v_revenue_external) as display_enabled,
           r.source
      from (
        select unnest(p_keys) as feature_key
      ) k
      left join (select distinct f.feature_key from public.plan_features f
                  where f.feature_key = any(p_keys)) registered
        on registered.feature_key = k.feature_key
      left join public.global_features g on g.feature_key = k.feature_key
      left join public.org_features o on o.org_id = p_org_id and o.feature_key = k.feature_key
      left join public.plan_features pf on pf.plan_id = v_plan_id and pf.feature_key = k.feature_key
      cross join lateral (
        select
          case
            when k.feature_key = any (public.core_feature_keys()) then true
            when k.feature_key = 'feedback_surveys' then coalesce(o.enabled, true)
            when registered.feature_key is null then false
            when g.enabled is false then false
            when o.feature_key is not null then o.enabled
            else coalesce(pf.enabled, false)
          end as enabled,
          case
            when k.feature_key = any (public.core_feature_keys()) then 'core'
            when k.feature_key = 'feedback_surveys' then case when o.feature_key is not null then 'override' else 'plan' end
            when registered.feature_key is null then 'unknown'
            when g.enabled is false then 'global'
            when o.feature_key is not null then 'override'
            else 'plan'
          end as source
      ) r;
end $function$;
revoke all on function public.resolve_features_internal(uuid,text[]) from public, anon, authenticated, service_role;

create or replace function public.resolve_feature_internal(p_org_id uuid, p_key text)
returns table(enabled boolean, display_enabled boolean, source text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select r.enabled, r.display_enabled, r.source
    from public.resolve_features_internal(p_org_id, array[p_key]) r;
end $$;
create or replace function public.resolved_org_features()
 returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
 language plpgsql stable security definer set search_path = public, pg_temp
as $function$
declare
  v_org_id uuid;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  v_org_id := public.auth_org_id();
  if v_org_id is null then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  return query select * from public.resolve_features_internal(v_org_id, array(select f.feature_key from public.plan_features f where f.plan_id = 'enterprise' union all select unnest(public.core_feature_keys())));
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
  return query select * from public.resolve_features_internal(p_org_id, array(select f.feature_key from public.plan_features f where f.plan_id = 'enterprise' union all select unnest(public.core_feature_keys())));
end $$;
commit;
