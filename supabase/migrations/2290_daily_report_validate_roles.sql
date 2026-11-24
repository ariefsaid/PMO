-- 2290_daily_report_validate_roles.sql — Admin assigns the daily_report_validate capability to job roles per organisation.
-- Spec: docs/specs/daily-report-validate-roles.spec.md (FR-DRVR-001..005, AC-DRVR-001..003).
-- Rollback: supabase/migrations/rollback/2290_daily_report_validate_roles_down.sql
-- drops: single-expression select in actor_has_role_capability (1203) replaced with org daily_report_validate_roles union; coalesce(role_has_capability(...), false) retained.

alter table public.organizations
  add column daily_report_validate_roles text[] not null default '{}'::text[]
    check (cardinality(daily_report_validate_roles) <= 28);

comment on column public.organizations.daily_report_validate_roles is
  'Built-in manager/officer job role keys whose active holders may validate daily site reports in this organisation (default empty: today''s validators only). Written only through set_daily_report_validate_roles.';

create function public.guard_daily_report_validate_roles()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_clean text[];
begin
  if new.daily_report_validate_roles is null
     or exists (
       select 1
         from unnest(new.daily_report_validate_roles) as k
        where k is null
           or not exists (
                select 1
                  from public.built_in_roles r
                 where r.key = k
                   and r.tier in ('manager', 'officer')
              )
     ) then
    raise exception 'DSR_VALIDATE_ROLE_INVALID: choose manager or officer job roles from the built-in list'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct k order by k), '{}'::text[])
    into v_clean
    from unnest(new.daily_report_validate_roles) as k;

  if cardinality(v_clean) > 0 and new.built_in_roles_enabled is not true then
    raise exception 'DSR_VALIDATE_ROLE_OFF: turn on built-in roles before naming roles that validate site reports'
      using errcode = 'P0001';
  end if;

  new.daily_report_validate_roles := v_clean;
  return new;
end;
$$;

revoke all on function public.guard_daily_report_validate_roles() from public, anon, authenticated;

create trigger trg_organizations_guard_daily_report_validate_roles
  before insert or update of daily_report_validate_roles on public.organizations
  for each row execute function public.guard_daily_report_validate_roles();

create function public.set_daily_report_validate_roles(p_roles text[])
  returns text[]
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
declare
  v_org   uuid := public.auth_org_id();
  v_roles text[];
begin
  perform public.assert_not_light(); -- mut:dsr_validate_roles_light
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then -- mut:dsr_validate_roles_admin
    raise exception 'DSR_VALIDATE_ROLE_ADMIN: only an Admin can set who validates daily site reports'
      using errcode = '42501';
  end if;

  if p_roles is null
     or exists (
       select 1
         from unnest(p_roles) as k
        where k is null
           or not exists (
                select 1
                  from public.built_in_roles r
                 where r.key = k
                   and r.tier in ('manager', 'officer') -- mut:dsr_validate_roles_valid
              )
     ) then
    raise exception 'DSR_VALIDATE_ROLE_INVALID: choose manager or officer job roles from the built-in list'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct k order by k), '{}'::text[])
    into v_roles
    from unnest(p_roles) as k;

  if cardinality(v_roles) > 0 and not public.org_built_in_roles_enabled(v_org) then -- mut:dsr_validate_roles_on
    raise exception 'DSR_VALIDATE_ROLE_OFF: turn on built-in roles before naming roles that validate site reports'
      using errcode = 'P0001';
  end if;

  update public.organizations o
     set daily_report_validate_roles = v_roles
   where o.id = v_org;

  perform public.log_audit(
    'daily_site_reports.validate_roles',
    v_org,
    auth.uid(),
    v_org,
    jsonb_build_object('roles', v_roles)
  );

  return v_roles;
end;
$$;

revoke all on function public.set_daily_report_validate_roles(text[]) from public, anon;
grant execute on function public.set_daily_report_validate_roles(text[]) to authenticated;

create or replace function public.actor_has_role_capability(p_capability text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select (
    p_capability = 'daily_report_validate'
    and public.org_built_in_roles_enabled(public.auth_org_id())
    and exists (
      select 1
        from public.organizations o
       where o.id = public.auth_org_id()
         and public.actor_built_in_role() = any (o.daily_report_validate_roles) -- mut:dsr_validate_org_role
    )
  ) or coalesce(public.role_has_capability(public.actor_built_in_role(), p_capability), false)
$$;

revoke all on function public.actor_has_role_capability(text) from public, anon;
grant execute on function public.actor_has_role_capability(text) to authenticated, service_role;
