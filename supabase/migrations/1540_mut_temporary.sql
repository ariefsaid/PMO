-- temporary mutation run, removed in the next commit
create or replace function public.may_see_medical_documents(p_profile uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles p where p.id = p_profile and public.is_active_member(p_profile) and p.role = 'Admin')
$$;
create or replace function public.actor_has_person_documents_access() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$ select false $$;
alter table public.built_in_role_capabilities drop constraint built_in_role_capabilities_capability_check;
alter table public.built_in_role_capabilities add constraint built_in_role_capabilities_capability_check
  check (capability in ('sees_prices', 'daily_report_enter', 'daily_report_validate', 'people_documents_view', 'medical_documents_view', 'zzz_probe'));
create function public.zzz_probe_direct() returns boolean language sql stable as $$
  select exists (select 1 from public.built_in_role_capabilities where capability = 'sees_prices') $$;
create function public.zzz_probe_second() returns boolean language sql stable as $$
  select public.actor_has_role_capability('people_documents_view') $$;
create function public.zzz_probe_held() returns boolean language sql stable as $$
  select public.actor_has_role_capability('daily_report_enter') $$;
