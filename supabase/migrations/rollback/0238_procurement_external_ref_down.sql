-- Rollback for 0238_procurement_external_ref.sql (#769): restores the pre-0232 RPC signatures, drops the columns.

drop function if exists public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text);
drop function if exists public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text);
drop function if exists public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz, text);
drop function if exists public.create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz, text);

create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's PO writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

create or replace function public.create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_requests
    (procurement_id, pr_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function public.create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function public.create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if public.domain_externally_owned(v_org, 'procurement') then
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
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer) from public;
grant  execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer) to   authenticated;
revoke execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer) from anon;

create or replace function public.capture_vendor_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null,
  p_notes          text default null,
  p_tax_treatment  text default null,
  p_tax_amount     numeric default null,
  p_tax_rate       numeric default null,
  p_tax_template   text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1)
  returns procurement_invoices
  language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.procurement_invoices;
begin
  perform transition_procurement(p_procurement_id, 'Vendor Invoiced'::procurement_status, p_notes);

  v_invoice := create_procurement_invoice(
    p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount,
    p_tax_treatment  => p_tax_treatment,
    p_tax_amount     => p_tax_amount,
    p_tax_rate       => p_tax_rate,
    p_tax_template   => p_tax_template,
    p_tax_base_numerator => p_tax_base_numerator,
    p_tax_base_denominator => p_tax_base_denominator);

  return v_invoice;
end; $$;
revoke all     on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer) from public;
grant  execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer) to   authenticated;
revoke execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer) from anon;

alter table public.purchase_requests drop constraint if exists purchase_requests_external_ref_check, drop column if exists external_ref;
alter table public.purchase_orders drop constraint if exists purchase_orders_external_ref_check, drop column if exists external_ref;
alter table public.procurement_invoices drop constraint if exists procurement_invoices_external_ref_check, drop column if exists external_ref;

notify pgrst, 'reload schema';
