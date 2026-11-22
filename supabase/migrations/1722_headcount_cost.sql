-- 1722_headcount_cost.sql — approved daily head counts become work-order labour cost (docs/specs/guard-headcount.spec.md
-- FR-HC-005, FR-HC-006, FR-HC-009). Plan: docs/plans/2026-11-22-guard-headcount.md (T3). Follows 1721 (the reader it restates).
--   labour_cost_class_lines restated from the database at head (1721) with a second branch: source 'headcount_day', one
--   row per approved line, gated on the labour cost switch. work_order_cost_amounts is NOT restated: it maps class lines
--   generically (per row for Admin/Executive/Finance; aggregate per source, work order, discipline, class and unit for a
--   Project Manager), and idle cost already reads every counted hourly labour row.
-- drops: none (the attendance branch is kept verbatim)
-- Proven by supabase/tests/1722_headcount_cost.test.sql. Reverse: rollback/1722_headcount_cost_down.sql.

create or replace function public.labour_cost_class_lines(p_project_id uuid)
returns table(source text, record_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date, class_id uuid,
              quantity numeric, quantity_unit text, amount numeric, worker_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with org as (select public.auth_org_id() as id),
  proj_days as (
    select distinct d.worker_id, d.work_date
      from public.labour_cost_attendance_days d, org
     where d.org_id = org.id and d.project_id = p_project_id and public.labour_cost_enabled(org.id)
  ), ent as (
    select d.* from public.labour_cost_attendance_days d
      join proj_days p on p.worker_id = d.worker_id and p.work_date = d.work_date, org
     where d.org_id = org.id
  ), rated as (
    select ent.*, x.class_id, r.basis, r.amount as rate_amount, r.overtime_multiplier, r.day_hours, r.month_hours
      from ent cross join org
     cross join lateral public.labour_class_for(org.id, ent.worker_id, ent.work_date) x
     cross join lateral public.labour_class_rate_for(org.id, x.class_id, ent.work_date) r
  ), cum as (
    select rated.*, coalesce(sum(rated.hours) over (partition by rated.worker_id, rated.work_date
             order by rated.project_id, rated.id rows between unbounded preceding and 1 preceding), 0) as prior
      from rated
  ), split as (
    select cum.*, greatest(0, least(cum.hours, cum.day_hours - cum.prior)) as regular_hours,
           case cum.basis when 'hourly' then cum.rate_amount when 'daily' then cum.rate_amount / cum.day_hours
                          else cum.rate_amount / cum.month_hours end as hourly
      from cum
  )
  select 'attendance_day'::text, s.id, s.work_order_id, c.discipline_id, s.work_date, s.class_id, s.hours, 'hours'::text,
         round(s.hourly * (s.regular_hours + (s.hours - s.regular_hours) * s.overtime_multiplier), 2), s.worker_id
    from split s left join public.crews c on c.id = s.crew_id
   where s.project_id = p_project_id
  union all
  select 'attendance_day'::text, e.id, e.work_order_id, c.discipline_id, e.work_date, null::uuid, e.hours, 'hours'::text,
         null::numeric, e.worker_id
    from ent e left join public.crews c on c.id = e.crew_id
   where e.project_id = p_project_id and not exists (select 1 from rated x where x.id = e.id)
  union all
  -- 1722: approved head-count lines (docs/specs/guard-headcount.spec.md FR-HC-005). Priced at count x the daily
  -- equivalent of the class rate in force on the date, no overtime; quantity is PERSON-HOURS (count x the rate's day
  -- length), so labour by class and idle hourly cost read it like any hourly labour row. No person (worker_id null).
  select 'headcount_day'::text, h.id, h.work_order_id, c.discipline_id, h.work_date, h.class_id,
         h.head_count * r.day_hours, 'hours'::text,
         round(h.head_count * case r.basis when 'daily' then r.amount when 'hourly' then r.amount * r.day_hours
                                           else r.amount / r.month_hours * r.day_hours end, 2), null::uuid
    from public.headcount_days h
    join public.work_orders w on w.id = h.work_order_id and w.project_id = p_project_id
    join org on org.id = h.org_id and public.labour_cost_enabled(org.id)
    left join public.crews c on c.id = h.crew_id
   cross join lateral public.labour_class_rate_for(org.id, h.class_id, h.work_date) r
   where h.approved_at is not null
  union all
  select 'headcount_day'::text, h.id, h.work_order_id, c.discipline_id, h.work_date, null::uuid, null::numeric, 'hours'::text,
         null::numeric, null::uuid
    from public.headcount_days h
    join public.work_orders w on w.id = h.work_order_id and w.project_id = p_project_id
    join org on org.id = h.org_id and public.labour_cost_enabled(org.id)
    left join public.crews c on c.id = h.crew_id
   where h.approved_at is not null
     and not exists (select 1 from public.labour_class_rate_for(org.id, h.class_id, h.work_date))
$$;
revoke all on function public.labour_cost_class_lines(uuid) from public, anon, authenticated;
