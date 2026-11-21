-- 1251_labour_cost_pricing.sql — #2670: price Approved timesheet hours of one project at the rate in force.
-- hourly equivalent = amount (hourly) | amount / day length (daily) | amount / month length (monthly);
-- cost = hourly equivalent x (regular hours + overtime hours x multiplier), rounded to 2 decimals per line.
-- Overtime = a person's hours beyond the rate's day length on one date, counted across all their Approved lines that
-- date (any project), lines ordered by project then id so no hour is priced twice. Switch off = no rows.
-- Internal: called only by work_order_cost_amounts (1252). Proven by supabase/tests/1251_labour_cost_amounts.test.sql.
-- Reverse: supabase/migrations/rollback/1251_labour_cost_pricing_down.sql.
create function public.labour_cost_priced_lines(p_project_id uuid)
returns table(entry_id uuid, work_order_id uuid, discipline_id uuid, entry_date date, class_id uuid, hours numeric,
              amount numeric, person_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with org as (select public.auth_org_id() as id),
  proj_days as (
    select distinct t.user_id, e.entry_date
      from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id, org
     where e.org_id = org.id and t.org_id = org.id and e.project_id = p_project_id and t.status = 'Approved' and e.hours > 0
       and public.labour_cost_enabled(org.id)
  ), ent as (
    select e.id, e.project_id, e.work_order_id, e.discipline_id, e.entry_date, e.hours, t.user_id
      from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
      join proj_days d on d.user_id = t.user_id and d.entry_date = e.entry_date, org
     where e.org_id = org.id and t.org_id = org.id and t.status = 'Approved' and e.hours > 0
  ), rated as (
    select ent.*, r.class_id, r.basis, r.amount as rate_amount, r.overtime_multiplier, r.day_hours, r.month_hours
      from ent cross join org cross join lateral public.labour_rate_for(org.id, ent.user_id, ent.entry_date) r
  ), cum as (
    select rated.*, coalesce(sum(rated.hours) over (partition by rated.user_id, rated.entry_date
             order by rated.project_id, rated.id rows between unbounded preceding and 1 preceding), 0) as prior
      from rated
  ), split as (
    select cum.*, greatest(0, least(cum.hours, cum.day_hours - cum.prior)) as regular_hours,
           case cum.basis when 'hourly' then cum.rate_amount when 'daily' then cum.rate_amount / cum.day_hours
                          else cum.rate_amount / cum.month_hours end as hourly
      from cum
  )
  select s.id, s.work_order_id, s.discipline_id, s.entry_date, s.class_id, s.hours,
         round(s.hourly * (s.regular_hours + (s.hours - s.regular_hours) * s.overtime_multiplier), 2), s.user_id
    from split s
   where s.project_id = p_project_id
$$;
revoke all on function public.labour_cost_priced_lines(uuid) from public, anon, authenticated;
