-- 1037_attendance_timesheet_down.sql — reverse 1037: restore the 0951 cost read seam, drop the approval triggers and RPCs.
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
   where u.archived_at is null;
revoke all on public.work_order_cost_lines from public, anon, authenticated;
grant select on public.work_order_cost_lines to authenticated;
drop trigger if exists z9_timesheets_attendance_lock on public.timesheets;
drop trigger if exists a1_timesheets_attendance_sod on public.timesheets;
drop function if exists public.timesheet_attendance_lock();
drop function if exists public.timesheet_attendance_sod();
drop function if exists public.attendance_decide_week(uuid, date, text, text);
drop function if exists public.attendance_generate_timesheet(uuid, date);
