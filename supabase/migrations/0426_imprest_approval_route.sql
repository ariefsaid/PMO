-- 0426_imprest_approval_route.sql — #1515 fix round. get_expense_claim_approval_routes is plan-aware (FR-IMP-024/025).
-- A Submitted float record above the month's remaining reads as the senior route (the org's spend_approvers set, or an Admin
-- when none is eligible), minus the claimant and the approver of the month's plan, and carries `is_exception`. This is the
-- decision transition_expense_claim makes at approval time (0423 §3); the read now agrees, so the approvals inbox and the record
-- page show the same approvers and the "Out of plan" tag, and the client no longer derives the route.
--
-- SECURITY INVOKER as in 0247 §8b: RLS on expense_claims is the org boundary. Only an approval-rank viewer reads the plan
-- (a claimant cannot), so only they get an exception; for a claimant the read is the project route as before.
--
-- Also: get_imprest_position gains `funded_total` (Σ Paid fundings, imprest_funded). `gap` keeps its meaning (float amount minus
-- holdings: what funding would top up). The books balance when funded_total equals cash + advances out + receipts waiting;
-- the screens flag only a break in THAT, and show an unfunded float as "Not yet funded" rather than as a defect.
--
-- ── REVERSE: supabase/migrations/rollback/0426_imprest_approval_route_down.sql (restores 0247 §8b and 0424 §2). ────
drop function if exists public.get_expense_claim_approval_routes(uuid[]);
create function public.get_expense_claim_approval_routes(p_ids uuid[])
returns table (claim_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric, is_exception boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with base as (
    select c.id, c.org_id, c.claimant_id, c.amount, r.route as p_route, r.reason, r.approver_ids, r.line_budget, r.line_used,
           (c.imprest_float_id is not null and public.holds_spend_approval_authority(public.auth_role())
            and c.amount > public.imprest_remaining(c.imprest_float_id, c.imprest_month, c.budget_category)) as exc,
           (select pl.approved_by from public.imprest_plans pl
             where pl.float_id = c.imprest_float_id and pl.month = c.imprest_month and pl.status = 'Approved') as plan_by
      from public.expense_claims c
      cross join lateral public.spend_approval_route(c.org_id, c.project_id, c.budget_category, c.amount, c.currency,
                                                     c.claimant_id, nullif(auth.uid(), c.claimant_id), c.submitted_at) r
     where c.id = any (p_ids) and c.status = 'Submitted'),
  routed as (
    select b.*, case when b.exc then s.ids else b.approver_ids end as ids
      from base b
      left join lateral (
        select coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
                 where sa.profile_id is distinct from b.claimant_id and sa.profile_id is distinct from b.plan_by
                   and pf.status = 'active' and pf.org_id = b.org_id and public.holds_spend_approval_authority(pf.role)), '{}') as ids
          from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
         where sa.org_id = b.org_id and sa.project_id is null) s on b.exc)
  select b.id,
         case when not b.exc then b.p_route when cardinality(b.ids) > 0 then 'org' else 'admin' end,
         b.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (b.ids)), '[]'::jsonb),
         b.amount, b.line_budget, b.line_used, b.exc
    from routed b
$$;
revoke all on function public.get_expense_claim_approval_routes(uuid[]) from public, anon;
grant execute on function public.get_expense_claim_approval_routes(uuid[]) to authenticated;

-- get_imprest_position: 0424 §2 verbatim plus `funded_total` (marked -- 0426). A new output column needs drop + create.
drop function if exists public.get_imprest_position(uuid);
create function public.get_imprest_position(p_float uuid)
returns table (float_id uuid, float_amount numeric, cash_book numeric, advances_out numeric, receipts_waiting numeric,
               replenishment_in_flight numeric, gap numeric, last_count_at timestamptz, last_count_variance numeric,
               month date, plan_lines jsonb, funded_total numeric)                                    -- 0426
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
            from public.get_imprest_plan_usage(p_float, f.m) u),
         public.imprest_funded(p_float)                                                              -- 0426
    from f, n
$$;
revoke all on function public.get_imprest_position(uuid) from public, anon;
grant execute on function public.get_imprest_position(uuid) to authenticated;
