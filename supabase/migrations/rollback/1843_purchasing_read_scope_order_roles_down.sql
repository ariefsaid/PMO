-- Reverses 1843: every read scope back to its text at head before 1843 (0350; procurement_documents 0361; storage 0696).

alter policy procurements_engineer_read_scope on public.procurements
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or requested_by_id = (select auth.uid()));

alter policy procurement_items_engineer_read_scope on public.procurement_items
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = procurement_items.procurement_id
                       and p.requested_by_id = (select auth.uid())));

alter policy procurement_quotations_engineer_read_scope on public.procurement_quotations
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = procurement_quotations.procurement_id
                       and p.requested_by_id = (select auth.uid())));

alter policy procurement_status_events_engineer_read_scope on public.procurement_status_events
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = procurement_status_events.procurement_id
                       and p.requested_by_id = (select auth.uid())));

alter policy purchase_requests_engineer_read_scope on public.purchase_requests
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = purchase_requests.procurement_id
                       and p.requested_by_id = (select auth.uid())));

alter policy rfqs_engineer_read_scope on public.rfqs
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = rfqs.procurement_id
                       and p.requested_by_id = (select auth.uid())));

alter policy purchase_orders_engineer_read_scope on public.purchase_orders
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = purchase_orders.procurement_id
                       and p.requested_by_id = (select auth.uid())));

alter policy procurement_quotation_files_engineer_read_scope on public.procurement_quotation_files
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurement_quotations q
                      join public.procurements p on p.id = q.procurement_id
                     where q.id = procurement_quotation_files.quotation_id
                       and p.requested_by_id = (select auth.uid())));

alter policy purchase_request_files_engineer_read_scope on public.purchase_request_files
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.purchase_requests r
                      join public.procurements p on p.id = r.procurement_id
                     where r.id = purchase_request_files.purchase_request_id
                       and p.requested_by_id = (select auth.uid())));

alter policy rfq_files_engineer_read_scope on public.rfq_files
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.rfqs r
                      join public.procurements p on p.id = r.procurement_id
                     where r.id = rfq_files.rfq_id
                       and p.requested_by_id = (select auth.uid())));

alter policy purchase_order_files_engineer_read_scope on public.purchase_order_files
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.purchase_orders r
                      join public.procurements p on p.id = r.procurement_id
                     where r.id = purchase_order_files.purchase_order_id
                       and p.requested_by_id = (select auth.uid())));

alter policy procurement_documents_engineer_read_scope on public.procurement_documents
  using ((select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or ((record_kind is null
                   or record_kind in ('purchase_request', 'rfq', 'quotation', 'purchase_order', 'goods_receipt'))
                  and exists (select 1 from public.procurements p
                               where p.id = procurement_documents.procurement_id
                                 and p.requested_by_id = (select auth.uid())))));

alter policy storage_objects_proc_file_read on storage.objects
  using (((bucket_id = 'procurement-files'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 5) AND ( SELECT is_active_member() AS is_active_member) AND ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR ((split_part(name, '/'::text, 3) <> ALL (ARRAY['invoice'::text, 'payment'::text])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE (((p.id)::text = split_part(objects.name, '/'::text, 2)) AND (p.requested_by_id = ( SELECT auth.uid() AS uid)))))))));
