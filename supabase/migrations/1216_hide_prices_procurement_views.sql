-- 1216 (#2699): masked views for procurement, orders, bills and payments. Each view is the base table with the price columns NULL unless actor_may_see_prices() (1215).
-- security_invoker: the base table's RLS still decides which rows. These are the read path for the request screens.
-- Rollback: rollback/1216_hide_prices_procurement_views_down.sql

create view public.procurements_masked with (security_invoker = true) as
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
  x.vendor_id,
  x.vendor_invoiced_at
from public.procurements x;
grant select on public.procurements_masked to authenticated;

create view public.procurement_items_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.description,
  x.erp_docstatus,
  case when (select public.actor_may_see_prices_now()) then x.erp_line_amount end as erp_line_amount,
  x.erp_modified,
  x.id,
  x.name,
  x.org_id,
  x.procurement_id,
  x.quantity,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate
from public.procurement_items x;
grant select on public.procurement_items_masked to authenticated;

create view public.procurement_invoices_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.created_at,
  x.currency,
  x.discipline_id,
  x.efaktur_date,
  x.efaktur_number,
  x.erp_amended_from,
  x.erp_cancelled_at,
  x.erp_docstatus,
  x.erp_modified,
  x.erp_attention,
  x.erp_census_seen_at,
  x.erp_read_at,
  x.erp_state,
  case when (select public.actor_may_see_prices_now()) then x.erp_outstanding_amount end as erp_outstanding_amount,
  x.external_ref,
  x.id,
  x.import_batch_id,
  x.import_identity_facts,
  x.import_identity_version,
  x.import_key,
  x.imported_at,
  x.invoice_date,
  x.org_id,
  x.po_id,
  x.procurement_id,
  x.reference_number,
  x.status,
  case when (select public.actor_may_see_prices_now()) then x.tax_amount end as tax_amount,
  x.tax_base_denominator,
  x.tax_base_numerator,
  x.tax_rate,
  x.tax_template,
  x.tax_treatment,
  x.vi_number,
  x.void_reason,
  x.voided_at,
  x.voided_by,
  case when (select public.actor_may_see_prices_now()) then x.withheld_amount end as withheld_amount,
  x.withheld_pph_type,
  x.work_order_id
from public.procurement_invoices x;
grant select on public.procurement_invoices_masked to authenticated;

create view public.purchase_orders_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.created_at,
  x.currency,
  x.date,
  x.discipline_id,
  x.erp_amended_from,
  x.erp_cancelled_at,
  x.erp_docstatus,
  x.erp_modified,
  x.erp_attention,
  x.erp_census_seen_at,
  x.erp_read_at,
  x.erp_state,
  x.external_ref,
  x.id,
  x.import_batch_id,
  x.import_identity_facts,
  x.import_identity_version,
  x.import_key,
  x.imported_at,
  x.org_id,
  x.po_number,
  x.procurement_id,
  x.reference_number,
  x.status,
  x.work_order_id
from public.purchase_orders x;
grant select on public.purchase_orders_masked to authenticated;

create view public.purchase_requests_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.created_at,
  x.currency,
  x.date,
  x.discipline_id,
  x.erp_amended_from,
  x.erp_cancelled_at,
  x.erp_docstatus,
  x.erp_modified,
  x.external_ref,
  x.id,
  x.import_batch_id,
  x.import_identity_facts,
  x.import_identity_version,
  x.import_key,
  x.imported_at,
  x.org_id,
  x.pr_number,
  x.procurement_id,
  x.reference_number,
  x.status,
  x.work_order_id
from public.purchase_requests x;
grant select on public.purchase_requests_masked to authenticated;

create view public.payments_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.created_at,
  x.currency,
  x.date,
  x.erp_amended_from,
  x.erp_cancelled_at,
  x.erp_docstatus,
  x.erp_modified,
  x.erp_attention,
  x.erp_census_seen_at,
  x.erp_read_at,
  x.erp_state,
  x.id,
  x.import_batch_id,
  x.import_identity_facts,
  x.import_identity_version,
  x.import_key,
  x.imported_at,
  x.invoice_id,
  x.org_id,
  x.pay_number,
  x.procurement_id,
  x.recorded_by_id,
  x.reference_number,
  x.status
from public.payments x;
grant select on public.payments_masked to authenticated;

create view public.purchase_order_lines_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.boq_item_id,
  x.created_at,
  x.id,
  x.org_id,
  x.po_id,
  x.quantity,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate,
  x.revision,
  x.unit
from public.purchase_order_lines x;
grant select on public.purchase_order_lines_masked to authenticated;

create view public.po_variation_lines_masked with (security_invoker = true) as
select
  x.additional_quantity,
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.boq_item_id,
  x.org_id,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate,
  x.variation_id
from public.po_variation_lines x;
grant select on public.po_variation_lines_masked to authenticated;
