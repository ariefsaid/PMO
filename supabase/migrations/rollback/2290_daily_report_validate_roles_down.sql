-- Rollback for 2290_daily_report_validate_roles.sql

create or replace function public.get_dsr_validation_route(p_report_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid           uuid := auth.uid();
  v_org           uuid;
  v_author        uuid;
  v_status        text;
  v_project       uuid;
  v_pm            uuid;
  v_pm_found      boolean := false;
  v_pm_name       text;
  v_pm_role       public.user_role;
  v_pm_active     boolean := false;
  v_pm_light      boolean := true;
  v_finance_admin boolean;
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

  if v_pm_found
     and v_pm_role = 'Project Manager'
     and v_pm_active
     and not v_pm_light
     and v_pm is distinct from v_author
     and btrim(coalesce(v_pm_name, '')) <> '' then
    return jsonb_build_object(
      'approvers', jsonb_build_array(
        jsonb_build_object('id', v_pm, 'name', v_pm_name, 'role', v_pm_role::text)),
      'route_kind', 'project_manager');
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
    'route_kind', case when v_finance_admin then 'finance_admin' else 'nobody' end);
end $$;

revoke all on function public.get_dsr_validation_route(uuid) from public, anon;
grant execute on function public.get_dsr_validation_route(uuid) to authenticated;

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
         coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                   left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date) v on true
                   where l.report_id = d.id), 0),
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date))),
         greatest(0, (public.equipment_org_today(d.org_id) - d.work_date) - 1),
         not exists (select 1 from public.profiles pr join public.projects p on p.id = d.project_id
                      where pr.org_id = d.org_id and pr.status = 'active' and pr.id <> d.author_id
                        and (pr.role in ('Admin','Finance') or (pr.role = 'Project Manager' and p.project_manager_id = pr.id)))
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

create or replace function public.actor_has_role_capability(p_capability text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.role_has_capability(public.actor_built_in_role(), p_capability), false)
$$;

revoke all on function public.actor_has_role_capability(text) from public, anon;
grant execute on function public.actor_has_role_capability(text) to authenticated, service_role;

drop function if exists public.set_daily_report_validate_roles(text[]);
drop trigger if exists trg_organizations_guard_daily_report_validate_roles on public.organizations;
drop function if exists public.guard_daily_report_validate_roles();
alter table public.organizations drop column if exists daily_report_validate_roles;
