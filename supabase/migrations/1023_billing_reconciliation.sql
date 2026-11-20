-- 1023_billing_reconciliation.sql — per bill-of-quantities item: scope, progress, measured and billed quantities (#2522).
-- FR-BST-040..042, AC-BST-020 (docs/specs/billing-stages.spec.md). One derivation; the screen renders it (NFR-BST-003).
--
-- billing_reconciliation(project, work_order default null), SECURITY INVOKER: RLS on every table it reads scopes it to the
-- caller's organisation (an Engineer, who cannot read claims, gets no claim quantities).
--   scope     the work order's line quantity, or the BoQ quantity for the project view;
--   progress  quantity to date on the latest monthly assessment that states the item. In a work-order view an item also
--             allocated to another work order has project-level progress only: null, never apportioned (FR-BST-042);
--   measured  quantity on claims not withdrawn, regardless of the invoice status;
--   billed    quantity on claims whose invoice exists and is not cancelled (any status: the claim is invoiced). The same
--             rows sales_invoice_work_billed counts, joined by the claim id that is the invoice id (FR-BST-041);
--   unbilled  progress less billed, not below 0 (null when progress is unknown);
--   surplus   the larger of progress and billed above scope, not below 0;
--   status    unbilled · partly_billed · fully_billed · surplus, from billed against scope.

create or replace function public.billing_reconciliation(p_project uuid, p_work_order uuid default null)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, line_no integer,
                 scope_qty numeric, progress_qty numeric, measured_qty numeric, billed_qty numeric, billed_amount numeric,
                 unbilled_qty numeric, surplus_qty numeric, status text)
  language sql stable security invoker set search_path = public as $$
  with scope as (
    select b.id, b.item_code, b.description, b.unit, b.rate, b.line_no,
           case when p_work_order is null then b.quantity else wl.quantity end as qty,
           p_work_order is not null
             and exists (select 1 from public.work_order_lines o where o.boq_item_id = b.id and o.work_order_id <> p_work_order) as shared
      from public.boq_items b
      left join public.work_order_lines wl on wl.boq_item_id = b.id and wl.work_order_id = p_work_order
     where b.project_id = p_project
       and (p_work_order is null or wl.id is not null)
  ),
  progress as (
    select distinct on (q.boq_item_id) q.boq_item_id, q.quantity_to_date
      from public.progress_assessment_quantities q
      join public.project_progress_entries e on e.id = q.entry_id
     where e.project_id = p_project
     order by q.boq_item_id, e.month desc
  ),
  claimed as (
    select l.boq_item_id,
           sum(l.quantity) filter (where pc.withdrawn_at is null) as measured,
           sum(l.quantity) filter (where si.id is not null and si.status <> 'Cancelled')                    as billed,
           sum(l.amount)   filter (where si.id is not null and si.status <> 'Cancelled')                    as billed_amount
      from public.progress_claim_lines l
      join public.progress_claims pc on pc.id = l.claim_id
      left join public.sales_invoices si on si.id = pc.id and si.org_id = pc.org_id
     where pc.project_id = p_project and pc.kind = 'progress'
       and (p_work_order is null or pc.work_order_id = p_work_order)
     group by l.boq_item_id
  )
  select s.id, s.item_code, s.description, s.unit, s.rate, s.line_no,
         s.qty,
         case when s.shared then null else coalesce(p.quantity_to_date, 0) end,
         coalesce(c.measured, 0),
         coalesce(c.billed, 0),
         coalesce(c.billed_amount, 0),
         case when s.shared then null else greatest(coalesce(p.quantity_to_date, 0) - coalesce(c.billed, 0), 0) end,
         greatest(greatest(case when s.shared then 0 else coalesce(p.quantity_to_date, 0) end, coalesce(c.billed, 0)) - s.qty, 0),
         case when coalesce(c.billed, 0) = 0 then 'unbilled'
              when c.billed > s.qty then 'surplus'
              when c.billed = s.qty then 'fully_billed'
              else 'partly_billed' end
    from scope s
    left join progress p on p.boq_item_id = s.id
    left join claimed c on c.boq_item_id = s.id
   order by s.line_no nulls last, s.item_code
$$;
revoke all on function public.billing_reconciliation(uuid, uuid) from public, anon;
grant execute on function public.billing_reconciliation(uuid, uuid) to authenticated, service_role;
