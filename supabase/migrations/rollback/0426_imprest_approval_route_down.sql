-- 0426_imprest_approval_route_down.sql — reverse of 0426: the 0247 §8b function and the 0424 §2 position, verbatim.
drop function if exists public.get_expense_claim_approval_routes(uuid[]);
create function public.get_expense_claim_approval_routes(p_ids uuid[])
returns table (claim_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select c.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         c.amount, r.line_budget, r.line_used
    from public.expense_claims c
    cross join lateral public.spend_approval_route(c.org_id, c.project_id, c.budget_category, c.amount, c.currency,
                                                   c.claimant_id, nullif(auth.uid(), c.claimant_id), c.submitted_at) r
   where c.id = any (p_ids) and c.status = 'Submitted'
$$;
revoke all on function public.get_expense_claim_approval_routes(uuid[]) from public, anon;
grant execute on function public.get_expense_claim_approval_routes(uuid[]) to authenticated;

drop function if exists public.get_imprest_position(uuid);
create function public.get_imprest_position(p_float uuid)
returns table (float_id uuid, float_amount numeric, cash_book numeric, advances_out numeric, receipts_waiting numeric,
               replenishment_in_flight numeric, gap numeric, last_count_at timestamptz, last_count_variance numeric,
               month date, plan_lines jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with f as (select fl.*, date_trunc('month', now() at time zone coalesce(o.default_timezone, 'UTC'))::date as m
               from public.imprest_floats fl join public.organizations o on o.id = fl.org_id where fl.id = p_float),
       n as (select public.imprest_cash_book(p_float) cb, public.imprest_advances_out(p_float) ao,
                    public.imprest_receipts_waiting(p_float) rw)
  select f.id, f.float_amount, n.cb, n.ao, n.rw,
         coalesce((select sum(r.amount) from public.imprest_replenishments r
                    where r.float_id = p_float and r.status in ('Requested','Approved')), 0),
         f.float_amount - (n.cb + n.ao + n.rw),
         (select c.counted_at from public.imprest_cash_counts c where c.float_id = p_float order by c.counted_at desc limit 1),
         (select c.variance   from public.imprest_cash_counts c where c.float_id = p_float order by c.counted_at desc limit 1),
         f.m,
         (select coalesce(jsonb_agg(u order by u.budget_category), '[]'::jsonb)
            from public.get_imprest_plan_usage(p_float, f.m) u)
    from f, n
$$;
revoke all on function public.get_imprest_position(uuid) from public, anon;
grant execute on function public.get_imprest_position(uuid) to authenticated;
