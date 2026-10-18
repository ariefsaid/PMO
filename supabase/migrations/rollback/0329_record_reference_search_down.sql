drop function if exists public.search_record_references(text, integer);

drop index if exists public.uxs40_projects_order_ref_idx;
drop index if exists public.uxs40_projects_code_ref_idx;
drop index if exists public.uxs40_projects_number_ref_idx;
drop index if exists public.uxs40_invoices_si_ref_idx;
drop index if exists public.uxs40_invoices_pmo_ref_idx;
drop index if exists public.uxs40_invoices_customer_ref_idx;
drop index if exists public.uxs40_receipts_ip_ref_idx;
drop index if exists public.uxs40_receipts_pmo_ref_idx;
drop index if exists public.uxs40_receipts_payment_ref_idx;
