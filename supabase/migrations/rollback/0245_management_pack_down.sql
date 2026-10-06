-- Reverses 0245_management_pack.sql. Order: functions that read the table, the table (takes its policies,
-- triggers and indexes with it), then the helpers and the sales_invoices index.
drop function if exists public.get_management_pack(date, date);
drop function if exists public.record_project_progress(uuid, date, numeric, text);
drop table if exists public.project_progress_entries;
drop function if exists public.may_record_project_progress(uuid);
drop function if exists public.stamp_project_progress_entry();
drop function if exists public.org_current_month(text, timestamptz);
drop index if exists public.sales_invoices_org_invoice_date_idx;
