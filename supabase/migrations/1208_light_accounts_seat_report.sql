-- 1208 (#2710): seat report split by seat type. Additive and read-only; seat_limit enforcement (0535) is unchanged and counts both.
-- Price and counts stay the owner's (#2539). Rollback: supabase/migrations/rollback/1208_light_accounts_seat_report_down.sql
create function public.org_seat_report() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() or public.auth_role() not in ('Admin', 'Executive') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
            'full',  count(*) filter (where not public.is_light_role_key(p.built_in_role)),
            'light', count(*) filter (where public.is_light_role_key(p.built_in_role)),
            'total', count(*))
            from public.profiles p where p.org_id = v_org and p.status = 'active');
end $$;
revoke all on function public.org_seat_report() from public, anon;
grant execute on function public.org_seat_report() to authenticated;
