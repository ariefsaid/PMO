-- 1376_billing_plan_candidates_read.sql — the billing plan's candidates (#2682).
-- Spec docs/specs/monthly-billing-plan.spec.md (FR-MBP-001..005); proven by supabase/tests/1376_billing_plan_candidates.test.sql.
-- "Progress not yet client-certified" = accepted-not-yet-claimed (the Cascade's "Unclaimed"). ONE definition: quantity lines come from
-- get_project_billing (accepted_quantity above claimed_quantity per work-order allocation, times the contract line rate) and money-only
-- orders from work_order_billing (line_count = 0, figures_complete, remaining > 0). Nothing is recomputed here, nothing is written.
-- SECURITY INVOKER: RLS decides what a caller sees (an Engineer gets nothing). Bounded: 501 rows (the caller shows 500 and says so).
-- Only projects with a confirmed acceptance are walked, so the per-project call stays proportional to billable work.
-- ── REVERSE: rollback/1376_billing_plan_candidates_read_down.sql ─────────────────────────────────────────────────────

create function public.billing_plan_candidates(p_project uuid default null)
  returns table (
    kind text, project_id uuid, project_name text, currency text, work_order_id uuid, wo_number text,
    boq_item_id uuid, item_code text, description text, unit text, earning_basis text, rate numeric,
    contract_quantity numeric, accepted_quantity numeric, claimed_quantity numeric, unclaimed_quantity numeric,
    value numeric, accepted_on date, today date)
  language sql stable security invoker set search_path = public as $$
  with tz as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as name
  ), lines as (
    select 'line'::text as kind, pr.id as project_id, pr.name as project_name, pr.currency::text as currency,
           wo.id as work_order_id, wo.wo_number, b.id as boq_item_id, b.item_code, b.description, b.unit, b.earning_basis::text,
           b.rate::numeric, b.quantity::numeric as contract_quantity,
           (a.x ->> 'accepted_quantity')::numeric as accepted_quantity, (a.x ->> 'claimed_quantity')::numeric as claimed_quantity,
           (a.x ->> 'accepted_quantity')::numeric - (a.x ->> 'claimed_quantity')::numeric as unclaimed_quantity,
           round(((a.x ->> 'accepted_quantity')::numeric - (a.x ->> 'claimed_quantity')::numeric) * b.rate, 2) as value
      from public.projects pr
      cross join lateral (select public.get_project_billing(pr.id) as j) g
      cross join lateral jsonb_array_elements(coalesce(g.j -> 'boq', '[]'::jsonb)) l(x)
      cross join lateral jsonb_array_elements(coalesce(l.x -> 'allocations', '[]'::jsonb)) a(x)
      join public.boq_items b on b.id = (a.x ->> 'boq_item_id')::uuid
      join public.work_orders wo on wo.id = (a.x ->> 'work_order_id')::uuid
     where pr.archived_at is null
       and (p_project is null or pr.id = p_project)
       and exists (select 1 from public.work_order_acceptances ac where ac.project_id = pr.id and ac.status = 'Confirmed')
       and (a.x ->> 'accepted_quantity') is not null
       and (a.x ->> 'accepted_quantity')::numeric > (a.x ->> 'claimed_quantity')::numeric
  ), orders as (
    select 'order'::text, pr.id, pr.name, b.currency::text, b.work_order_id, b.wo_number,
           null::uuid, null::text, b.title::text, null::text, null::text, null::numeric,
           null::numeric, null::numeric, null::numeric, null::numeric, b.remaining::numeric
      from public.work_order_billing b
      join public.projects pr on pr.id = b.project_id
     where pr.archived_at is null
       and (p_project is null or pr.id = p_project)
       and b.line_count = 0 and b.figures_complete and b.remaining > 0 and b.status in ('Issued', 'Closed')
  ), pool as (
    select * from lines union all select * from orders
  )
  select pool.kind, pool.project_id, pool.project_name, pool.currency, pool.work_order_id, pool.wo_number,
         pool.boq_item_id, pool.item_code, pool.description, pool.unit, pool.earning_basis, pool.rate,
         pool.contract_quantity, pool.accepted_quantity, pool.claimed_quantity, pool.unclaimed_quantity, pool.value,
         (select (max(ac.confirmed_at) at time zone tz.name)::date from public.work_order_acceptances ac
           where ac.work_order_id = pool.work_order_id and ac.status = 'Confirmed') as accepted_on,
         (now() at time zone tz.name)::date as today
    from pool cross join tz
   order by pool.value desc, pool.project_name, pool.work_order_id, pool.item_code nulls last, pool.boq_item_id nulls last
   limit 501
$$;
revoke all on function public.billing_plan_candidates(uuid) from public, anon;
grant execute on function public.billing_plan_candidates(uuid) to authenticated, service_role;
