-- 0655 down: restore the pre-0655 profiles policy expressions (captured from pg_policy) and the per-key
-- resolved_org_features(); drop the two helpers.
begin;

alter policy profiles_select on public.profiles
  using (((org_id = auth_org_id()) AND is_active_member()));
alter policy profiles_admin_insert on public.profiles
  with check (((org_id = auth_org_id()) AND (auth_role() = 'Admin'::user_role) AND is_active_member()));
alter policy profiles_admin_delete on public.profiles
  using (((org_id = auth_org_id()) AND (auth_role() = 'Admin'::user_role) AND is_active_member()));
alter policy profiles_hierarchy_update on public.profiles
  using (((org_id = auth_org_id()) AND is_active_member() AND (id IS DISTINCT FROM ( SELECT auth.uid() AS uid)) AND may_administer_profile(auth_role(), role)))
  with check (((org_id = auth_org_id()) AND is_active_member() AND (id IS DISTINCT FROM ( SELECT auth.uid() AS uid)) AND may_administer_profile(auth_role(), role)));
alter policy profiles_update_self on public.profiles
  using (((id = ( SELECT auth.uid() AS uid)) AND is_active_member()))
  with check (((org_id = ( SELECT p.org_id FROM profiles p WHERE (p.id = ( SELECT auth.uid() AS uid))))
    AND (role = ( SELECT p.role FROM profiles p WHERE (p.id = ( SELECT auth.uid() AS uid))))
    AND (NOT (manager_id IS DISTINCT FROM ( SELECT p.manager_id FROM profiles p WHERE (p.id = ( SELECT auth.uid() AS uid)))))
    AND is_active_member()));
alter policy profiles_locale_self_only on public.profiles
  with check (((id = ( SELECT auth.uid() AS uid)) OR ((NOT (locale IS DISTINCT FROM ( SELECT p.locale FROM profiles p WHERE (p.id = profiles.id))))
    AND (NOT (number_locale IS DISTINCT FROM ( SELECT p.number_locale FROM profiles p WHERE (p.id = profiles.id))))
    AND (NOT (timezone IS DISTINCT FROM ( SELECT p.timezone FROM profiles p WHERE (p.id = profiles.id)))))));

drop function public.profile_prefs_unchanged(uuid, text, text, text);
drop function public.auth_manager_id();

create or replace function public.resolved_org_features()
 returns table(feature_key text, enabled boolean, display_enabled boolean, source text)
 language plpgsql stable security definer set search_path to 'public'
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
  return query
    select k.feature_key, r.enabled, r.display_enabled, r.source
      from (
        select f.feature_key from public.plan_features f where f.plan_id = 'enterprise'
        union all select unnest(public.core_feature_keys())
      ) k
      cross join lateral public.resolve_feature_internal(v_org_id, k.feature_key) r;
end $function$;

commit;
