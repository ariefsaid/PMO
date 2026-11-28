alter policy procurements_engineer_read_scope on public.procurements
 using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
        or (select public.actor_may_order_purchases()) or requested_by_id = (select auth.uid()));
alter policy procurement_invoices_engineer_read_scope on public.procurement_invoices
 using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance'));
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

create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null,
  p_withheld_amount numeric default 0,
  p_withheld_pph_type text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_row public.procurement_invoices; v_currency text;                                 -- 0373
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select org_id, currency into v_org, v_currency from public.procurements where id = p_procurement_id;  -- 0373
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  if public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_procurement_id), false) then   -- ECA-4 (PD-ECA-9)
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  if coalesce(p_withheld_amount, 0) <> 0
     and (p_withheld_pph_type is null or btrim(p_withheld_pph_type) not in ('pph23', 'pph4_2')) then
    raise exception 'a vendor invoice that withholds tax must state the withholding type: pph23 or pph4_2'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator, external_ref,
     withheld_amount, withheld_pph_type, currency)                                                       -- 0373
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator, nullif(btrim(p_external_ref), ''),
            coalesce(p_withheld_amount, 0),
            case when coalesce(p_withheld_amount, 0) <> 0 then btrim(p_withheld_pph_type) end,
            v_currency)                                                                                  -- 0373
    returning * into v_row;
  return v_row;
end; $$;

CREATE OR REPLACE FUNCTION public.get_bill_match(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_catalog, pg_temp
AS $function$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.procurement_invoices where id = p_invoice_id and org_id = public.auth_org_id())
     or not public.project_money_in_scope((select x.project_id from public.procurements x join public.procurement_invoices i on i.procurement_id = x.id where i.id = p_invoice_id)) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  return public.bill_match_evaluate(p_invoice_id);
end $function$;

drop function public.actor_bill_purchase_scope(uuid);
