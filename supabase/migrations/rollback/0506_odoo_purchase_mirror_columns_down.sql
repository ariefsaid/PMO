-- Reverses 0506. Drops only what 0506 added; the mirror rows keep every other column.
drop trigger if exists payments_odoo_mirror_columns_guard_trg on public.payments;
drop trigger if exists procurement_invoices_odoo_mirror_columns_guard_trg on public.procurement_invoices;
drop trigger if exists procurement_receipts_odoo_mirror_columns_guard_trg on public.procurement_receipts;
drop trigger if exists purchase_orders_odoo_mirror_columns_guard_trg on public.purchase_orders;
drop function if exists public.odoo_mirror_columns_guard();
drop index if exists public.erp_purchase_documents_external_ref_idx;
alter table public.erp_purchase_documents
  drop column if exists erp_census_seen_at, drop column if exists erp_read_at, drop column if exists adoption_key,
  drop column if exists erp_attention, drop column if exists erp_state, drop column if exists external_ref;
alter table public.payments drop column if exists erp_census_seen_at, drop column if exists erp_read_at, drop column if exists erp_attention, drop column if exists erp_state;
alter table public.procurement_invoices drop column if exists erp_census_seen_at, drop column if exists erp_read_at, drop column if exists erp_attention, drop column if exists erp_state;
alter table public.procurement_receipts drop column if exists erp_census_seen_at, drop column if exists erp_read_at, drop column if exists erp_attention, drop column if exists erp_state;
alter table public.purchase_orders drop column if exists erp_census_seen_at, drop column if exists erp_read_at, drop column if exists erp_attention, drop column if exists erp_state;
