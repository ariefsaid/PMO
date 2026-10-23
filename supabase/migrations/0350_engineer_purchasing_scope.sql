-- 0350 — Engineer purchasing read scope (owner ruling 2026-10-23: "Engineers see own requests only, no
-- invoices or payments"). Proven by supabase/tests/0350_engineer_purchasing_scope.test.sql.
-- Rollback: supabase/migrations/rollback/0350_engineer_purchasing_scope_down.sql
--
-- An Engineer reads:
--   • a procurement only when they raised it (requested_by_id = auth.uid()), and that request's records
--     and files (items, quotations, receipts, status events, document links, purchase requests, RFQs,
--     purchase orders, and the file rows under them);
--   • no vendor bills, outgoing payments, sales invoices, incoming receipts, or the records that are the
--     same money by another name (their file rows, sales-invoice author/authorization rows, vendor
--     withholding slips and slip-bill links, ERP AP/AR aging snapshots, and revenue/procurement commands
--     queued for the ERP, whose payloads carry those documents);
--   • procurement-files storage objects only under their own requests, excluding bill and payment files.
--
-- Every other role keeps exactly its current read. The table policies are RESTRICTIVE, so they only narrow:
-- the existing permissive policies (org + active membership) still apply to every row. `to authenticated`:
-- anon reads nothing here already, and service_role bypasses RLS (sweeps, adapters, definer writers).
-- `(select …)` wraps the per-statement helpers so they are evaluated once per query, not once per row.

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — procurements: an Engineer reads only the requests they raised.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create policy procurements_engineer_read_scope on public.procurements
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or requested_by_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — direct children of a procurement: visible to an Engineer only under their own request.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create policy procurement_items_engineer_read_scope on public.procurement_items
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = procurement_items.procurement_id
                       and p.requested_by_id = (select auth.uid())));

create policy procurement_quotations_engineer_read_scope on public.procurement_quotations
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = procurement_quotations.procurement_id
                       and p.requested_by_id = (select auth.uid())));

create policy procurement_receipts_engineer_read_scope on public.procurement_receipts
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = procurement_receipts.procurement_id
                       and p.requested_by_id = (select auth.uid())));

create policy procurement_status_events_engineer_read_scope on public.procurement_status_events
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = procurement_status_events.procurement_id
                       and p.requested_by_id = (select auth.uid())));

create policy procurement_documents_engineer_read_scope on public.procurement_documents
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = procurement_documents.procurement_id
                       and p.requested_by_id = (select auth.uid())));

create policy purchase_requests_engineer_read_scope on public.purchase_requests
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = purchase_requests.procurement_id
                       and p.requested_by_id = (select auth.uid())));

create policy rfqs_engineer_read_scope on public.rfqs
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = rfqs.procurement_id
                       and p.requested_by_id = (select auth.uid())));

create policy purchase_orders_engineer_read_scope on public.purchase_orders
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurements p
                     where p.id = purchase_orders.procurement_id
                       and p.requested_by_id = (select auth.uid())));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — file rows under those children: visible to an Engineer only under their own request.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create policy procurement_quotation_files_engineer_read_scope on public.procurement_quotation_files
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurement_quotations q
                      join public.procurements p on p.id = q.procurement_id
                     where q.id = procurement_quotation_files.quotation_id
                       and p.requested_by_id = (select auth.uid())));

create policy procurement_receipt_files_engineer_read_scope on public.procurement_receipt_files
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.procurement_receipts r
                      join public.procurements p on p.id = r.procurement_id
                     where r.id = procurement_receipt_files.receipt_id
                       and p.requested_by_id = (select auth.uid())));

create policy purchase_request_files_engineer_read_scope on public.purchase_request_files
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.purchase_requests r
                      join public.procurements p on p.id = r.procurement_id
                     where r.id = purchase_request_files.purchase_request_id
                       and p.requested_by_id = (select auth.uid())));

create policy rfq_files_engineer_read_scope on public.rfq_files
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.rfqs r
                      join public.procurements p on p.id = r.procurement_id
                     where r.id = rfq_files.rfq_id
                       and p.requested_by_id = (select auth.uid())));

create policy purchase_order_files_engineer_read_scope on public.purchase_order_files
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or exists (select 1 from public.purchase_orders r
                      join public.procurements p on p.id = r.procurement_id
                     where r.id = purchase_order_files.purchase_order_id
                       and p.requested_by_id = (select auth.uid())));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — invoices, payments and the same money by another name: no Engineer reads.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
create policy procurement_invoices_engineer_read_scope on public.procurement_invoices
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy procurement_invoice_files_engineer_read_scope on public.procurement_invoice_files
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy payments_engineer_read_scope on public.payments
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy payment_files_engineer_read_scope on public.payment_files
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy sales_invoices_engineer_read_scope on public.sales_invoices
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy sales_invoice_authors_engineer_read_scope on public.sales_invoice_authors
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy sales_invoice_submit_authorizations_engineer_read_scope on public.sales_invoice_submit_authorizations
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy incoming_payments_engineer_read_scope on public.incoming_payments
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy vendor_withholding_slips_engineer_read_scope on public.vendor_withholding_slips
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);
-- vendor_withholding_slip_bills needs no policy of its own: its select policy admits a row only when the
-- linked vendor bill is visible to the reader, so the procurement_invoices scope above already hides it.

create policy erp_ap_aging_snapshot_engineer_read_scope on public.erp_ap_aging_snapshot
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

create policy erp_ar_aging_snapshot_engineer_read_scope on public.erp_ar_aging_snapshot
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role);

-- ERP commands queued for the revenue and procurement domains carry invoice, payment and purchase
-- document bodies in their payload. Other domains (budget, timesheets, tasks, companies) are unchanged.
create policy external_command_outbox_engineer_read_scope on public.external_command_outbox
  as restrictive for select to authenticated
  using ((select public.auth_role()) is distinct from 'Engineer'::public.user_role
         or domain not in ('revenue', 'procurement'));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — procurement-files storage: an Engineer reads objects only under their own request
-- ({org}/{procurement}/{phase}/{file}/{name}), never a bill or payment file. Other roles: the 0310 rule.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
alter policy storage_objects_proc_file_read on storage.objects using (
 bucket_id = 'procurement-files' and auth.uid() is not null
 and split_part(name, '/', 1) = public.auth_org_id()::text
 and array_length(string_to_array(name, '/'), 1) = 5
 and public.is_active_member()
 and (public.auth_role() is distinct from 'Engineer'::public.user_role
      or (split_part(name, '/', 3) not in ('invoice', 'payment')
          and exists (select 1 from public.procurements p
                       where p.id::text = split_part(name, '/', 2)
                         and p.requested_by_id = auth.uid()))));

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the one definer read that returns bill amounts to a client: an Engineer caller gets no row.
-- Body is 0349's with the Engineer clause added to the caller check. Server callers (auth.uid() null)
-- and every other role are unchanged.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════
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
     and (v_org is distinct from public.auth_org_id() or not public.is_active_member()
          or public.auth_role() is not distinct from 'Engineer'::public.user_role) then
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
