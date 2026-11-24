-- 2290_daily_report_validate_roles.sql — Admin assigns the daily_report_validate capability to job roles per organisation.
-- Spec: docs/specs/daily-report-validate-roles.spec.md (FR-DRVR-001..007, AC-DRVR-001..008).
-- Rollback: supabase/migrations/rollback/2290_daily_report_validate_roles_down.sql
-- drops: actor_has_role_capability (1203) wraps role_has_capability in an org daily_report_validate_roles union; dsr_validation_queue (1110/1209) masks total_revenue behind dsr_may_see_revenue and counts active non-light assigned validator roles in waiting_for_validator; get_dsr_validation_route (1567) adds active non-author assigned validator job roles (route_kind = 'job_roles' when no eligible PM or Finance/Admin exists).

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

-- Restate dsr_validation_queue (from 1110 + 1209 light-account guard): mask total_revenue unless dsr_may_see_revenue holds,
-- and count active non-light holders of daily_report_validate_roles in waiting_for_validator.
create or replace function public.dsr_validation_queue()
returns table (report_id uuid, project_id uuid, work_order_id uuid, work_order_label text, work_date date, author_id uuid,
               author_name text, submitted_at timestamptz, total_revenue numeric, unrated_lines integer, age_days integer,
               waiting_for_validator boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.dsr_require_member();
  return query
  select d.id, d.project_id, d.work_order_id, coalesce(w.wo_number || ' · ', '') || w.title, d.work_date, d.author_id,
         a.full_name, d.submitted_at,
         case
           when public.dsr_may_see_revenue(d.project_id) then -- mut:dsr_queue_revenue_mask
             coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                       left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date) v on true
                       where l.report_id = d.id), 0)
           else null::numeric
         end,
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date))),
         greatest(0, (public.equipment_org_today(d.org_id) - d.work_date) - 1),
         not exists (select 1 from public.profiles pr join public.projects p on p.id = d.project_id
                      where pr.org_id = d.org_id and pr.status = 'active' and pr.id <> d.author_id
                        and not public.is_light_role_key(pr.built_in_role)
                        and (pr.role in ('Admin','Finance')
                             or (pr.role = 'Project Manager' and p.project_manager_id = pr.id)
                             or (public.org_built_in_roles_enabled(d.org_id)
                                 and exists (select 1 from public.organizations o
                                              where o.id = d.org_id
                                                and pr.built_in_role = any (o.daily_report_validate_roles)))))
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
    left join public.profiles a on a.id = d.author_id
   where d.org_id = public.auth_org_id() and d.status = 'submitted' and d.archived_at is null
     and public.dsr_may_validate(d.project_id)
   order by d.submitted_at, d.id
   limit 500;
end $$;

revoke all on function public.dsr_validation_queue() from public, anon;
grant execute on function public.dsr_validation_queue() to authenticated;

-- Restate get_dsr_validation_route (from 1567): project active non-light non-author holders of daily_report_validate_roles.
create or replace function public.get_dsr_validation_route(p_report_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid            uuid := auth.uid();
  v_org            uuid;
  v_author         uuid;
  v_status         text;
  v_project        uuid;
  v_pm             uuid;
  v_pm_found       boolean := false;
  v_pm_name        text;
  v_pm_role        public.user_role;
  v_pm_active      boolean := false;
  v_pm_light       boolean := true;
  v_finance_admin  boolean;
  v_validate_roles text[];
begin
  if v_uid is null or not coalesce(public.is_active_member(), false) then
    raise exception 'your account is not an active member of this organisation, so it cannot read a validation route'
      using errcode = '42501';
  end if;

  select r.org_id, r.author_id, r.status, r.project_id
    into v_org, v_author, v_status, v_project
    from public.daily_site_reports r
   where r.id = p_report_id;

  if v_org is null or v_status is distinct from 'submitted' then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  select p.project_manager_id into v_pm
    from public.projects p
   where p.id = v_project and p.org_id = v_org;
  if not found then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  if v_pm is not null then
    select pr.full_name, pr.role, (pr.status = 'active'), public.is_light_role_key(pr.built_in_role)
      into v_pm_name, v_pm_role, v_pm_active, v_pm_light
      from public.profiles pr
     where pr.id = v_pm and pr.org_id = v_org;
    v_pm_found := found;
  end if;

  select coalesce(array_agg(distinct pr.built_in_role order by pr.built_in_role), '{}'::text[])
    into v_validate_roles
    from public.organizations o
    join public.profiles pr
      on pr.org_id = o.id
     and pr.status = 'active'
     and pr.id <> v_author
     and not public.is_light_role_key(pr.built_in_role)
     and pr.built_in_role = any (o.daily_report_validate_roles) -- mut:dsr_route_validate_roles
   where o.id = v_org
     and o.built_in_roles_enabled is true;

  if v_pm_found
     and v_pm_role = 'Project Manager'
     and v_pm_active
     and not v_pm_light
     and v_pm is distinct from v_author
     and btrim(coalesce(v_pm_name, '')) <> '' then
    return jsonb_build_object(
      'approvers', jsonb_build_array(
        jsonb_build_object('id', v_pm, 'name', v_pm_name, 'role', v_pm_role::text)),
      'route_kind', 'project_manager')
      || case when cardinality(v_validate_roles) > 0
              then jsonb_build_object('validate_roles', to_jsonb(v_validate_roles))
              else '{}'::jsonb end;
  end if;

  select exists (
    select 1
      from public.profiles pr
     where pr.org_id = v_org
       and pr.status = 'active'
       and pr.role in ('Admin', 'Finance')
       and not public.is_light_role_key(pr.built_in_role)
       and pr.id <> v_author)
    into v_finance_admin;

  return jsonb_build_object(
    'approvers', '[]'::jsonb,
    'route_kind', case
      when v_finance_admin then 'finance_admin'
      when cardinality(v_validate_roles) > 0 then 'job_roles'
      else 'nobody'
    end)
    || case when cardinality(v_validate_roles) > 0
            then jsonb_build_object('validate_roles', to_jsonb(v_validate_roles))
            else '{}'::jsonb end;
end $$;

revoke all on function public.get_dsr_validation_route(uuid) from public, anon;
grant execute on function public.get_dsr_validation_route(uuid) to authenticated;
