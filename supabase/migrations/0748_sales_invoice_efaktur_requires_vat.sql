-- #1506 AC-OCI-081: set_sales_invoice_efaktur refuses a number on an invoice whose project is not subject to VAT.
-- Signature, security definer, search_path and grants unchanged from 0272.
create or replace function public.set_sales_invoice_efaktur(
  p_si_id uuid,
  p_efaktur_number text,
  p_efaktur_date date
)
returns public.sales_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sales_invoices;
  v_number text := nullif(btrim(p_efaktur_number), '');
  v_vat boolean;
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin', 'Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status = 'Cancelled' then
    raise exception 'cannot record e-Faktur facts on a cancelled sales invoice'
      using errcode = '23514', detail = 'efaktur-cancelled';
  end if;
  -- An e-Faktur is a VAT document: a sale outside VAT (project not subject to VAT) has none to record (AC-OCI-081).
  -- A zero-rated invoice on a VAT-subject project still needs one. No project = unknown = allowed. Clearing stays allowed.
  select p.subject_to_vat into v_vat from public.projects p where p.id = v_row.project_id;
  if v_number is not null and v_vat is false then
    raise exception 'a sales invoice outside VAT has no e-Faktur to record'
      using errcode = '23514', detail = 'efaktur-no-vat';
  end if;
  if (v_number is null) <> (p_efaktur_date is null) then
    raise exception 'an e-Faktur number and its date must be recorded together'
      using errcode = '23514', detail = 'efaktur-incomplete';
  end if;
  if v_number is not null and (char_length(v_number) > 32 or v_number !~ '^[0-9.-]+$') then
    raise exception 'invalid e-Faktur number' using errcode = '23514';
  end if;
  -- "Future" on the ORG's calendar (the 0247 pattern), not the session's: current_date would refuse
  -- an Asia/Jakarta morning's own date until 07:00 local.
  if p_efaktur_date is not null and p_efaktur_date > (now() at time zone coalesce(
       (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date then
    raise exception 'e-Faktur date cannot be in the future'
      using errcode = '23514', detail = 'efaktur-future-date';
  end if;
  update public.sales_invoices
     set efaktur_number = v_number, efaktur_date = p_efaktur_date
   where id = p_si_id
   returning * into v_row;
  return v_row;
end;
$$;
