-- Reverses 0507. The mirror rows keep what the feed wrote; only the functions go.
drop function if exists public.finish_odoo_purchase_census(uuid, text, timestamptz, text);
drop function if exists public.mark_odoo_purchase_census_seen(uuid, text, timestamptz, text[]);
drop function if exists public.apply_odoo_purchase_page(uuid, text, jsonb, text);
drop function if exists public.odoo_purchase_page_rows(jsonb);
drop function if exists public.odoo_num(text);
drop function if exists public.odoo_purchase_model(text);
-- 0378's body, as before 0507.
create or replace function public.erp_document_recorded_by_pmo(p_org uuid, p_doctype text, p_erp_name text)
returns boolean
language sql stable set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.external_refs x
     where x.org_id = p_org and x.domain = 'procurement' and x.external_tier = 'erpnext'
       and x.external_record_id = p_erp_name
       and case p_doctype
             when 'Purchase Order'   then exists (select 1 from public.purchase_orders r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             when 'Purchase Receipt' then exists (select 1 from public.procurement_receipts r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             when 'Purchase Invoice' then exists (select 1 from public.procurement_invoices r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             when 'Payment Entry'    then exists (select 1 from public.payments r
                                                   where r.org_id = p_org and r.id::text = x.pmo_record_id)
             else false end)
$$;
revoke all on function public.erp_document_recorded_by_pmo(uuid, text, text) from public, anon, authenticated;
