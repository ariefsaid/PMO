-- 0951_work_order_cost_attribution_down.sql — reverse 0951: drop the read seam, the write path, the rule triggers and
-- the attribution columns; restore 0413's posted-stock-document guard. No status, approval or money data is touched.
update public.record_history_config set captured = captured - 'work_order_id' - 'discipline_id'
 where table_name in ('purchase_requests', 'purchase_orders', 'procurement_invoices');
drop view if exists public.work_order_cost_lines;
drop function if exists public.set_cost_attribution(text, uuid[], uuid, uuid);

create or replace function public.guard_stock_document_immutable() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be changed' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function public.guard_stock_document_immutable() from public, anon, authenticated;

drop trigger if exists a0_warehouse_work_order_move_guard on public.stock_warehouses;
drop function if exists public.guard_warehouse_move_with_work_orders();
drop trigger if exists a0_procurements_work_order_move_guard on public.procurements;
drop function if exists public.guard_procurement_move_with_work_orders();
drop trigger if exists zz_cost_attribution_check on public.purchase_requests;
drop trigger if exists zz_cost_attribution_check on public.purchase_orders;
drop trigger if exists zz_cost_attribution_check on public.procurement_receipts;
drop trigger if exists zz_cost_attribution_check on public.procurement_invoices;
drop trigger if exists zz_cost_attribution_audit on public.timesheet_entries;
drop function if exists public.audit_timesheet_cost_attribution();
drop trigger if exists zz_cost_attribution_check on public.timesheet_entries;
drop trigger if exists zz_cost_attribution_check on public.stock_documents;
drop trigger if exists zz_cost_attribution_check on public.equipment_usage_entries;
drop function if exists public.check_cost_attribution();
alter table public.purchase_requests drop column if exists work_order_id, drop column if exists discipline_id;
alter table public.purchase_orders drop column if exists work_order_id, drop column if exists discipline_id;
alter table public.procurement_receipts drop column if exists work_order_id, drop column if exists discipline_id;
alter table public.procurement_invoices drop column if exists work_order_id, drop column if exists discipline_id;
alter table public.timesheet_entries drop column if exists work_order_id, drop column if exists discipline_id;
alter table public.stock_documents drop column if exists work_order_id, drop column if exists discipline_id;
alter table public.equipment_usage_entries drop column if exists work_order_id, drop column if exists discipline_id;
