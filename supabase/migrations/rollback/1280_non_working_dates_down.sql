-- Reverses 1280_non_working_dates.sql (#2672): restores the 1275 working-day body, drops the RPCs and the list.
drop function if exists public.non_working_date_add(date, text);
drop function if exists public.non_working_date_remove(date);
create or replace function public.org_is_working_day(p_org uuid, p_date date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_date)::smallint = any (
    coalesce((select s.working_weekdays from public.org_revenue_plan_settings s where s.org_id = p_org),
             '{1,2,3,4,5}'::smallint[]))
$$;
revoke all on function public.org_is_working_day(uuid, date) from public, anon, authenticated;
drop table if exists public.org_non_working_dates;
