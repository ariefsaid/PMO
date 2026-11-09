-- 0724 get_procurement_approval_routes(p_ids): request amount and submission time read once for the whole list.
-- Rollback: supabase/migrations/rollback/0724_procurement_approval_routes_set_based_down.sql
--
-- 0243's body called procurement_request_amount(p.id) once per row, and the planner evaluated that lateral
-- expression twice (once as the resolver argument, once as the request_amount column): two function calls, each
-- with its own RLS reads of procurements + procurement_items, per Requested row. procurement_submitted_at(p.id)
-- was a third per-row call. Here the items are summed once for the listed rows (CTE `it`), the latest ->Requested
-- event is read once (CTE `ev`), and the amount is a single expression: the same CASE as procurement_request_amount,
-- row for row. The routing RULE is untouched: spend_approval_route (0247) is still CALLED per row with the same
-- eight inputs (ADR-0075 §3), decider = the viewer unless the viewer is the requester. SECURITY INVOKER as before:
-- RLS on procurements / items / events decides what the caller sees. Signature, columns and grants are unchanged.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

create or replace function public.get_procurement_approval_routes(p_ids uuid[])
returns table (procurement_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with req as materialized (
    select p.id, p.org_id, p.project_id, p.budget_category, p.currency, p.requested_by_id, p.total_value
      from public.procurements p
     where p.id = any (p_ids) and p.status = 'Requested'
  ), it as materialized (
    select i.procurement_id, sum(i.amount) as total, bool_or(i.amount < 0) as has_negative
      from public.procurement_items i
     where i.procurement_id in (select id from req)
     group by i.procurement_id
  ), ev as materialized (
    select e.procurement_id, max(e.created_at) as submitted_at
      from public.procurement_status_events e
     where e.to_status = 'Requested' and e.procurement_id in (select id from req)
     group by e.procurement_id
  )
  select req.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         a.amount, r.line_budget, r.line_used
    from req
    left join it on it.procurement_id = req.id
    left join ev on ev.procurement_id = req.id
    -- Same CASE as procurement_request_amount (0243): a negative header or line is untrustworthy -> NULL.
    cross join lateral (select case when req.total_value < 0 or coalesce(it.has_negative, false) then null
                                    else greatest(req.total_value, coalesce(it.total, 0)) end as amount) a
    -- Decider = the viewer, unless the viewer is the requester (who never decides: SoD-a).
    cross join lateral public.spend_approval_route(req.org_id, req.project_id, req.budget_category,
                                                   a.amount, req.currency, req.requested_by_id,
                                                   nullif(auth.uid(), req.requested_by_id),
                                                   ev.submitted_at) r
$$;
