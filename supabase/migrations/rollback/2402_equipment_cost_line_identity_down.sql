create or replace view public.work_order_cost_lines with (security_invoker = true) as
  select 'purchase_request'::text as source, r.id as record_id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date as occurred_on, coalesce(r.pr_number, r.reference_number) as reference,
         null::numeric as quantity, null::text as quantity_unit
    from public.purchase_requests r join public.procurements p on p.id = r.procurement_id
  union all
  select 'purchase_order', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date, coalesce(r.po_number, r.reference_number), null, null
    from public.purchase_orders r join public.procurements p on p.id = r.procurement_id
  union all
  select 'goods_receipt', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.receipt_date, r.gr_number, null, null
    from public.procurement_receipts r join public.procurements p on p.id = r.procurement_id
  union all
  select 'vendor_bill', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.invoice_date, r.vi_number, null, null
    from public.procurement_invoices r join public.procurements p on p.id = r.procurement_id
  union all
  select 'timesheet_entry', e.id, e.org_id, e.project_id, e.work_order_id, e.discipline_id,
         e.entry_date, null, e.hours, 'hours'
    from public.timesheet_entries e
  union all
  select 'stock_document', d.id, d.org_id,
         case when d.kind = 'transfer' then w.project_id else d.project_id end, d.work_order_id, d.discipline_id,
         d.occurred_on, d.number, null, null
    from public.stock_documents d left join public.stock_warehouses w on w.id = d.to_warehouse_id
   where d.kind in ('issue', 'return', 'transfer')
  union all
  select 'equipment_usage', u.id, u.org_id, u.project_id, u.work_order_id, u.discipline_id,
         u.work_date, null, u.quantity, u.unit
    from public.equipment_usage_entries u
   where u.archived_at is null
  union all
  -- 1037 (#2528, FR-CRW-016): approved hours of people with no login live on the attendance record itself. A login's
  -- hours reach cost through its timesheet line above, so a row linked to a timesheet line is never counted here.
  select 'attendance_day', a.id, a.org_id, a.project_id, a.work_order_id, c.discipline_id,
         a.work_date, null, a.hours + coalesce(a.overtime_hours, 0), 'hours'
    from public.attendance_days a left join public.crews c on c.id = a.crew_id
   where a.status = 'present' and a.approved_at is not null and a.timesheet_entry_id is null
  union all
  -- 1262 (#2732, FR-SCWO-007): an expense claim (kind claim) names its work order and discipline; a cash advance is
  -- not a cost (DD-SCWO-2). Money is not here, as for every source; the claim's own RLS decides who sees the row.
  select 'expense_claim', c.id, c.org_id, c.project_id, c.work_order_id, c.discipline_id,
         c.created_at::date, c.claim_number, null, null
    from public.expense_claims c
   where c.kind = 'claim';
