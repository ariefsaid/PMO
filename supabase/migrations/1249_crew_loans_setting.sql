-- 1249_crew_loans_setting.sql — #2704: the organisation setting that shows crew loans on the crew page.
-- Off by default: an existing organisation's crew page is unchanged. The database rules (1245 to 1248) apply
-- regardless; without loans they are inert. Written only through set_org_crew_loans_enabled (Admin, audited).
alter table public.organizations add column crew_loans_enabled boolean not null default false;
comment on column public.organizations.crew_loans_enabled is
  'Shows "Lend to another crew" and the loans list on the crew page (#2704). Default false. Written only through set_org_crew_loans_enabled (Admin).';

create function public.set_org_crew_loans_enabled(p_enabled boolean)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_old boolean;
begin
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can change crew loans' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'crew loans must be on or off' using errcode = '22023';
  end if;
  select o.crew_loans_enabled into v_old from public.organizations o where o.id = v_org for update;
  if v_old is distinct from p_enabled then
    update public.organizations set crew_loans_enabled = p_enabled where id = v_org;
    perform public.log_audit('org.crew_loans_enabled.change', v_org, auth.uid(), v_org,
                             jsonb_build_object('from', v_old, 'to', p_enabled));
  end if;
  return p_enabled;
end $$;
revoke all on function public.set_org_crew_loans_enabled(boolean) from public, anon;
grant execute on function public.set_org_crew_loans_enabled(boolean) to authenticated;
