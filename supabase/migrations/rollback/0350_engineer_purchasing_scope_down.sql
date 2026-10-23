-- Reverse 0350. Drops the Engineer read-scope policies and restores verbatim the storage read policy
-- from 0310 and procurement_payment_within_ceiling from 0349.

drop policy if exists procurements_engineer_read_scope on public.procurements;
drop policy if exists procurement_items_engineer_read_scope on public.procurement_items;
drop policy if exists procurement_quotations_engineer_read_scope on public.procurement_quotations;
drop policy if exists procurement_receipts_engineer_read_scope on public.procurement_receipts;
drop policy if exists procurement_status_events_engineer_read_scope on public.procurement_status_events;
drop policy if exists procurement_documents_engineer_read_scope on public.procurement_documents;
drop policy if exists purchase_requests_engineer_read_scope on public.purchase_requests;
drop policy if exists rfqs_engineer_read_scope on public.rfqs;
drop policy if exists purchase_orders_engineer_read_scope on public.purchase_orders;
drop policy if exists procurement_quotation_files_engineer_read_scope on public.procurement_quotation_files;
drop policy if exists procurement_receipt_files_engineer_read_scope on public.procurement_receipt_files;
drop policy if exists purchase_request_files_engineer_read_scope on public.purchase_request_files;
drop policy if exists rfq_files_engineer_read_scope on public.rfq_files;
drop policy if exists purchase_order_files_engineer_read_scope on public.purchase_order_files;
drop policy if exists procurement_invoices_engineer_read_scope on public.procurement_invoices;
drop policy if exists procurement_invoice_files_engineer_read_scope on public.procurement_invoice_files;
drop policy if exists payments_engineer_read_scope on public.payments;
drop policy if exists payment_files_engineer_read_scope on public.payment_files;
drop policy if exists sales_invoices_engineer_read_scope on public.sales_invoices;
drop policy if exists sales_invoice_authors_engineer_read_scope on public.sales_invoice_authors;
drop policy if exists sales_invoice_submit_authorizations_engineer_read_scope on public.sales_invoice_submit_authorizations;
drop policy if exists incoming_payments_engineer_read_scope on public.incoming_payments;
drop policy if exists vendor_withholding_slips_engineer_read_scope on public.vendor_withholding_slips;
drop policy if exists erp_ap_aging_snapshot_engineer_read_scope on public.erp_ap_aging_snapshot;
drop policy if exists erp_ar_aging_snapshot_engineer_read_scope on public.erp_ar_aging_snapshot;
drop policy if exists external_command_outbox_engineer_read_scope on public.external_command_outbox;

-- storage read -> 0310
alter policy storage_objects_proc_file_read on storage.objects using (
 bucket_id = 'procurement-files' and auth.uid() is not null
 and split_part(name, '/', 1) = public.auth_org_id()::text
 and array_length(string_to_array(name, '/'), 1) = 5
 and public.is_active_member());

-- payment ceiling -> 0349
create or replace function public.procurement_payment_within_ceiling(p_procurement_id uuid)
returns table(ok boolean, reason text, billed_net numeric, approved_amount numeric)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid; v_currency text; v_ceiling numeric; v_total numeric; v_net numeric; v_count integer;
begin
  select p.org_id, p.currency, p.approved_total_value, p.total_value
    into v_org, v_currency, v_ceiling, v_total
    from public.procurements p where p.id = p_procurement_id;
  if not found then return; end if;
  if auth.uid() is not null
     and (v_org is distinct from public.auth_org_id() or not public.is_active_member()) then
    return;
  end if;
  if exists (select 1 from public.procurement_invoices i
              where i.procurement_id = p_procurement_id
                and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
                and i.currency is distinct from v_currency) then
    return query select false, 'bill currency differs from procurement currency', null::numeric, v_ceiling;
    return;
  end if;
  select coalesce(sum(case when i.tax_treatment = 'inclusive' then i.amount - i.tax_amount else i.amount end), 0),
         count(*)
    into v_net, v_count
    from public.procurement_invoices i
   where i.procurement_id = p_procurement_id
     and i.amount is not null
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     and not (i.vi_number is not null and exists (
       select 1 from public.procurement_invoices successor
        where successor.procurement_id = i.procurement_id
          and successor.erp_amended_from = i.vi_number
          and coalesce(successor.erp_docstatus, 1) <> 2 and successor.erp_cancelled_at is null));
  if v_count = 0 then v_net := v_total; end if;
  if v_ceiling is null then
    return query select false, 'approved amount is missing', v_net, null::numeric;
    return;
  end if;
  return query select v_net <= v_ceiling,
                      case when v_net <= v_ceiling then null else 'vendor bill exceeds approved amount' end,
                      v_net, v_ceiling;
end; $$;
revoke all on function public.procurement_payment_within_ceiling(uuid) from public, anon;
grant execute on function public.procurement_payment_within_ceiling(uuid) to authenticated, service_role;
