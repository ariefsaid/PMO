-- 1890_imprest_open_requests.sql — cash-advance-estimate: a read-only suggestion for a site cash plan, the open purchase
-- requests of the float's project (not yet ordered or paid), with their lines. Spec docs/specs/cash-advance-estimate.spec.md.
-- Proven by supabase/tests/1890_imprest_open_requests.test.sql (header: mutation check). Reverse: rollback/1890_imprest_open_requests_down.sql.
-- SECURITY INVOKER over the masked request views (1216): a person sees only the requests, lines and prices they already see on
-- the purchase list (org scope, the requester-only scope outside the four roles, the light-account policies, hidden prices).
-- A float the caller cannot see (approval rank only) yields no rows. No write, no table, no approval or routing change.
-- Open = Requested, Approved, Vendor Quoted or Quote Selected: submitted, and not yet Ordered, Received, Invoiced or Paid.
-- Bounded at 501 rows (the screen shows 500 and says when there are more): one row per request line, or one per request with no lines.

create or replace function public.get_imprest_open_requests(p_float uuid)
returns table (procurement_id uuid, pr_number text, title text, status public.procurement_status,
               budget_category public.budget_category, currency text, request_total numeric,
               work_order_id uuid, wo_number text, wo_title text,
               line_id uuid, line_name text, line_quantity numeric, line_amount numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  select p.id, p.pr_number, p.title, p.status, p.budget_category, p.currency, p.total_value,
         wo.id, wo.wo_number, wo.title,
         i.id, i.name, i.quantity, i.amount
    from public.imprest_floats f
    join public.procurements_masked p on p.project_id = f.project_id and p.org_id = f.org_id
    left join lateral (select pr.work_order_id from public.purchase_requests pr
                        where pr.procurement_id = p.id and pr.work_order_id is not null
                        order by pr.created_at, pr.id limit 1) w on true
    left join public.work_orders wo on wo.id = w.work_order_id and wo.org_id = f.org_id
    left join public.procurement_items_masked i on i.procurement_id = p.id
   where f.id = p_float and f.archived_at is null
     and p.status in ('Requested', 'Approved', 'Vendor Quoted', 'Quote Selected')
   order by p.created_at, p.id, i.name, i.id
   limit 501
$$;
revoke all on function public.get_imprest_open_requests(uuid) from public, anon;
grant execute on function public.get_imprest_open_requests(uuid) to authenticated;
