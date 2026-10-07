-- Rollback for 0272_vendor_tax_defaults.sql (#876 slice 2). Revert the slice-2 adapter-dispatch and FE FIRST (they read
-- §4's columns and send §5's parameters). Restores 0238's two create functions, 0178's create audit and 0269's
-- procurement mirror guard, then drops the org settings, the bill's PPh type column, the vendor-defaults function, guard
-- and columns. Standalone bills that recorded a withholding keep the amount (withheld_amount is 0269's column); the
-- recorded PPh TYPE is lost with its column — export it first if any bill carries one.

drop trigger if exists organizations_audit_vendor_tax_accounts on public.organizations;
drop function if exists public.audit_org_vendor_tax_accounts();
alter table public.organizations
  drop column if exists input_vat_account,
  drop column if exists pph23_payable_account,
  drop column if exists pph4_2_payable_account;

create or replace function public.audit_procurement_invoice_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_invoice.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',         new.status::text,
                                              'amount',         new.amount,
                                              'vi_number',      new.vi_number,
                                              'procurement_id', new.procurement_id));
  return new;
end; $$;

drop function if exists public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text);
drop function if exists public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric,text);
create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null)
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
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator, external_ref)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator, nullif(btrim(p_external_ref), ''))
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text) from public;
grant  execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text) to   authenticated;
revoke execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text) from anon;

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
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null)
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
    p_tax_base_denominator => p_tax_base_denominator,
    p_external_ref   => p_external_ref);

  return v_invoice;
end; $$;
revoke all     on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text) from public;
grant  execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text) to   authenticated;
revoke execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text) from anon;

-- 0269 §2's procurement mirror guard (without withheld_pph_type), then the column.
create or replace function public.procurement_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.vi_number             is distinct from old.vi_number
     or new.invoice_date          is distinct from old.invoice_date
     or new.reference_number      is distinct from old.reference_number
     or new.amount                is distinct from old.amount
     or new.po_id                 is distinct from old.po_id
     or new.status                is distinct from old.status
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.erp_docstatus         is distinct from old.erp_docstatus
     or new.erp_modified          is distinct from old.erp_modified
     or new.erp_amended_from      is distinct from old.erp_amended_from
     or new.erp_cancelled_at      is distinct from old.erp_cancelled_at
     or new.currency              is distinct from old.currency   -- 0187 (#478)
     or new.tax_treatment         is distinct from old.tax_treatment -- 0196 (#505)
     or new.tax_amount            is distinct from old.tax_amount    -- 0196 (#505)
     or new.tax_rate              is distinct from old.tax_rate      -- 0196 (#505)
     or new.tax_template          is distinct from old.tax_template  -- 0196 (#505)
     or new.withheld_amount       is distinct from old.withheld_amount -- 0269 (#876)
     or new.id                    is distinct from old.id
     or new.procurement_id        is distinct from old.procurement_id
     or new.org_id                is distinct from old.org_id
     or new.created_at            is distinct from old.created_at
  then
    raise exception 'procurement_invoices native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
alter table public.procurement_invoices drop column if exists withheld_pph_type;

drop function if exists public.set_vendor_tax_defaults(uuid, numeric, text, numeric);
drop trigger if exists companies_tax_defaults_guard on public.companies;
drop function if exists public.companies_tax_defaults_guard();
alter table public.companies
  drop constraint if exists companies_default_vat_rate_range,
  drop constraint if exists companies_default_pph_type_domain,
  drop constraint if exists companies_default_pph_pair,
  drop constraint if exists companies_default_pph_rate_range,
  drop column if exists default_vat_rate,
  drop column if exists default_pph_type,
  drop column if exists default_pph_rate;

notify pgrst, 'reload schema';
