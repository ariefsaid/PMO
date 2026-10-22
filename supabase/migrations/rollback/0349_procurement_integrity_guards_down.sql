drop trigger if exists zz_payment_file_path_guard on public.payment_files;
drop trigger if exists zz_purchase_order_file_path_guard on public.purchase_order_files;
drop trigger if exists zz_rfq_file_path_guard on public.rfq_files;
drop trigger if exists zz_purchase_request_file_path_guard on public.purchase_request_files;
drop trigger if exists zz_procurement_invoice_file_path_guard on public.procurement_invoice_files;
drop trigger if exists zz_procurement_receipt_file_path_guard on public.procurement_receipt_files;
drop trigger if exists zz_procurement_quotation_file_path_guard on public.procurement_quotation_files;
drop function if exists public.guard_procurement_file_path();
drop trigger if exists procurements_quote_reroute_event on public.procurements;
drop function if exists public.log_procurement_quote_reroute();
drop trigger if exists procurements_approved_total_guard on public.procurements;
drop function if exists public.guard_procurement_approved_total();
drop function if exists public.procurement_payment_within_ceiling(uuid);
update public.record_history_config set omit_cols = array_remove(omit_cols, 'approved_total_value') where table_name = 'procurements';
alter table public.procurements drop column if exists approved_total_value;
drop policy if exists storage_objects_proc_file_insert on storage.objects;
drop policy if exists storage_objects_proc_file_delete on storage.objects;
create policy storage_objects_proc_file_write on storage.objects for all
using (
 bucket_id='procurement-files' and auth.uid() is not null
 and split_part(name,'/',1)=auth_org_id()::text and array_length(string_to_array(name,'/'),1)=5
 and auth_role() in ('Admin','Executive','Project Manager','Finance')
 and exists(select 1 from public.procurements p where p.id::text=split_part(name,'/',2) and p.org_id=auth_org_id())
)
with check (
 bucket_id='procurement-files' and auth.uid() is not null
 and split_part(name,'/',1)=auth_org_id()::text and array_length(string_to_array(name,'/'),1)=5
 and auth_role() in ('Admin','Executive','Project Manager','Finance')
 and exists(select 1 from public.procurements p where p.id::text=split_part(name,'/',2) and p.org_id=auth_org_id())
);
