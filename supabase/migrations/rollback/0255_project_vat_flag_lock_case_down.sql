-- Reverses 0255: restores 0253's case-sensitive guard_project_vat_flag_lock verbatim.
create or replace function public.guard_project_vat_flag_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.sales_invoices where project_id = new.id)
     or exists (select 1 from public.external_command_outbox o
                 where o.org_id = new.org_id and o.domain = 'revenue' and o.operation = 'create'
                   and o.payload->>'erp_doc_kind' = 'sales-invoice' and o.payload->>'projectId' = new.id::text
                   and o.state not in ('confirmed','failed')) then
    raise exception 'whether this project is subject to VAT is locked once the project has an invoice'
      using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_project_vat_flag_lock() from public, anon, authenticated;
