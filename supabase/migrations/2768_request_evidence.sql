-- Request planning and evidence reads.
create or replace view public.procurements_masked with (security_invoker = false, security_barrier = true) as
select
  x.amount_approved_by_id,
  x.approval_notes,
  x.approved_by_id,
  case when (select public.actor_may_see_prices_now()) then x.approved_total_value end as approved_total_value,
  x.budget_category,
  x.code,
  x.created_at,
  x.currency,
  x.id,
  x.import_batch_id,
  x.import_key,
  x.import_normalized_ref,
  x.imported_at,
  x.is_subcontract,
  x.org_id,
  x.origin,
  x.po_number,
  x.pr_number,
  x.project_id,
  x.rejection_notes,
  x.requested_by_id,
  x.status,
  x.title,
  case when (select public.actor_may_see_prices_now()) then x.total_value end as total_value,
  x.updated_at,
  case when (select public.actor_may_see_prices_now()) then x.vendor_id end as vendor_id,
  x.vendor_invoiced_at,
  x.purchase_type_id, x.rental_from, x.rental_to, x.extends_procurement_id, x.needed_by
from public.procurements x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases()) or x.requested_by_id = (select auth.uid()));

create policy purchase_request_files_requester_insert on public.purchase_request_files for insert to authenticated
with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
 and not (select public.actor_is_light()) and public.org_feature_enabled((select public.auth_org_id()), 'procurement')
 and uploaded_by_id = (select auth.uid())
 and exists (select 1 from public.purchase_requests_masked r join public.procurements_masked p on p.id = r.procurement_id
 where r.id = purchase_request_id and p.requested_by_id = (select auth.uid())));

alter policy purchase_request_files_engineer_read_scope on public.purchase_request_files
using ((select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')
 or (select public.actor_may_order_purchases())
 or exists (select 1 from public.purchase_requests_masked r join public.procurements_masked p on p.id = r.procurement_id
 where r.id = purchase_request_id and p.requested_by_id = (select auth.uid())));

create policy storage_objects_requester_request_insert on storage.objects for insert to authenticated
with check (bucket_id = 'procurement-files' and split_part(name, '/', 1) = (select public.auth_org_id())::text
 and array_length(string_to_array(name, '/'), 1) = 5 and split_part(name, '/', 3) = 'purchase_request'
 and (select public.is_active_member()) and not (select public.actor_is_light())
 and public.org_feature_enabled((select public.auth_org_id()), 'procurement')
 and exists (select 1 from public.procurements_masked p where p.id::text = split_part(name, '/', 2)
 and p.requested_by_id = (select auth.uid())));

create policy storage_objects_requester_request_read on storage.objects for select to authenticated
using (bucket_id = 'procurement-files' and split_part(name, '/', 1) = (select public.auth_org_id())::text
 and array_length(string_to_array(name, '/'), 1) = 5 and split_part(name, '/', 3) = 'purchase_request'
 and (select public.is_active_member()) and not (select public.actor_is_light())
 and exists (select 1 from public.procurements_masked p where p.id::text = split_part(name, '/', 2)
 and p.requested_by_id = (select auth.uid())));
