-- 1100_mrq_prior_quantity_posted_stock.sql — #2611 (spec docs/specs/material-requests.spec.md FR-MRQ-002).
-- Proven by supabase/tests/1100_mrq_prior_quantity_posted_stock.test.sql. REVERSE: rollback/1100_mrq_prior_quantity_posted_stock_down.sql

create or replace function public.mrq_prior_quantity(p_work_order_id uuid, p_item_id uuid, p_exclude_request uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  -- FR-MRQ-002 (site stock landed): stock already moved to the work order, by posted movements, plus the pending or approved
  -- requests of OTHER people not yet fulfilled. A fulfilled request is represented by its posted transfer, so it is never counted twice.
  select coalesce((
           select sum(l.qty_delta)
             from public.stock_ledger l
             join public.stock_documents d on d.id = l.document_id
             join public.stock_warehouses w on w.id = l.warehouse_id
            where d.work_order_id = p_work_order_id and l.item_id = p_item_id
              and d.kind = 'transfer' and l.qty_delta > 0 and w.kind in ('site', 'yard', 'staging')), 0)
       + coalesce((
           select sum(ml.quantity)
             from public.material_request_lines ml
             join public.material_requests r on r.id = ml.request_id
            where r.work_order_id = p_work_order_id and ml.item_id = p_item_id and r.id <> p_exclude_request
              and r.status in ('pending', 'approved')
              and not exists (
                select 1 from public.stock_documents d
                 where d.id = r.transfer_document_id and d.status = 'Posted'
              )), 0)
$$;
