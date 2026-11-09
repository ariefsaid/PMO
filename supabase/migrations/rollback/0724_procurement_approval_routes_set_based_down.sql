-- Restores 0243 §6 verbatim.
create or replace function public.get_procurement_approval_routes(p_ids uuid[])
returns table (procurement_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select p.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         a.amount, r.line_budget, r.line_used
    from public.procurements p
    cross join lateral (select public.procurement_request_amount(p.id) as amount) a
    cross join lateral public.spend_approval_route(p.org_id, p.project_id, p.budget_category,
                                                   a.amount, p.currency, p.requested_by_id,
                                                   nullif(auth.uid(), p.requested_by_id),
                                                   public.procurement_submitted_at(p.id)) r
   where p.id = any (p_ids) and p.status = 'Requested'
$$;
