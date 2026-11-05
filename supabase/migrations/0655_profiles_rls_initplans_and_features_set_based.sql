-- 0655_profiles_rls_initplans_and_features_set_based.sql — the two per-row/per-key costs every page pays.
-- Rollback: rollback/0655_profiles_rls_initplans_and_features_set_based_down.sql
--
-- 1. public.profiles RLS. 0646 wrapped the caller helpers once per statement everywhere EXCEPT profiles: wrapping
--    profiles_select alone raised 42P17 on profiles UPDATEs, because profiles_update_self and
--    profiles_locale_self_only read `profiles` in sub-selects (a policy qual with a sub-link, on a relation that
--    is already being expanded, is PostgreSQL's recursion error). So profiles was filtered with two definer calls
--    PER ROW (auth_org_id(), is_active_member(): ~11 buffers a row) on every profiles read and every embed of a
--    profile (requested_by, assignee, ...).
--    Fix = remove the self-reference, then wrap:
--      * auth_manager_id()       — the caller's own manager_id, zero-arg definer, same shape as auth_org_id()/auth_role().
--      * profile_prefs_unchanged — "stored locale/number_locale/timezone equal these", org-guarded definer.
--    and every profiles policy goes through (select helper()) like the rest of the schema. Meaning is unchanged:
--    each replaced sub-select read the caller's own row (p.id = auth.uid()) or the row being written
--    (p.id = profiles.id) under the statement snapshot, which is exactly what the helpers read.
-- 2. resolved_org_features(): 108 keys x resolve_feature_internal() (5-6 queries each) -> one set-based statement.
--    resolve_feature_internal() is untouched and remains the single-key oracle (pgTAP compares the two).
begin;

create function public.auth_manager_id() returns uuid
  language sql stable security definer set search_path to 'public'
  as $$ select manager_id from profiles where id = auth.uid() $$;

-- Own-org, active members only: asking about a profile in another org (or none) answers false, never a cross-tenant equality oracle.
create function public.profile_prefs_unchanged(p_id uuid, p_locale text, p_number_locale text, p_timezone text) returns boolean
  language sql stable security definer set search_path to 'public'
  as $$
    select exists (
      select 1 from profiles p
       where p.id = p_id and p.org_id = (select auth_org_id()) and (select is_active_member())
         and not (p.locale is distinct from p_locale)
         and not (p.number_locale is distinct from p_number_locale)
         and not (p.timezone is distinct from p_timezone))
  $$;

revoke all on function public.auth_manager_id() from public, anon;
revoke all on function public.profile_prefs_unchanged(uuid, text, text, text) from public, anon;
grant execute on function public.auth_manager_id() to authenticated, service_role;
grant execute on function public.profile_prefs_unchanged(uuid, text, text, text) to authenticated, service_role;

-- Self-references first (no profiles sub-select may remain before profiles_select gets a sub-link).
alter policy profiles_update_self on public.profiles
  using ((id = (select auth.uid())) and (select public.is_active_member()))
  with check (
    (org_id = (select public.auth_org_id()))
    and (role = (select public.auth_role()))
    and (not (manager_id is distinct from (select public.auth_manager_id())))
    and (select public.is_active_member()));

alter policy profiles_locale_self_only on public.profiles
  with check ((id = (select auth.uid())) or public.profile_prefs_unchanged(id, locale, number_locale, timezone));

alter policy profiles_select on public.profiles
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member()));

alter policy profiles_admin_insert on public.profiles
  with check ((org_id = (select public.auth_org_id())) and ((select public.auth_role()) = 'Admin'::user_role) and (select public.is_active_member()));

alter policy profiles_admin_delete on public.profiles
  using ((org_id = (select public.auth_org_id())) and ((select public.auth_role()) = 'Admin'::user_role) and (select public.is_active_member()));

alter policy profiles_hierarchy_update on public.profiles
  using ((org_id = (select public.auth_org_id())) and (select public.is_active_member())
         and (id is distinct from (select auth.uid())) and public.may_administer_profile((select public.auth_role()), role))
  with check ((org_id = (select public.auth_org_id())) and (select public.is_active_member())
         and (id is distinct from (select auth.uid())) and public.may_administer_profile((select public.auth_role()), role));

-- resolved_org_features(): same rows as resolve_feature_internal(org, key) for every key, in one statement.
create or replace function public.resolved_org_features()
 returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
 language plpgsql stable security definer set search_path to 'public'
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

commit;
