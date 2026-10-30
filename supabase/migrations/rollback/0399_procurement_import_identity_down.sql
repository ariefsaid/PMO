do $$
declare t text;
begin
  foreach t in array array['purchase_requests','rfqs','procurement_quotations','purchase_orders','procurement_receipts','procurement_invoices','payments'] loop
    execute format('drop trigger zzzz_import_identity on public.%I', t);
    execute format('drop index public.%I', t || '_import_identity_key_idx');
    execute format('alter table public.%I drop constraint %I, drop column import_identity_version, drop column import_identity_facts', t, t || '_import_identity_check');
  end loop;
end $$;
drop function public.procurement_import_identity_stamp();
drop function public.normalize_procurement_import_refs(text[]);
drop function public.lookup_procurement_import_cases(text[], text, uuid, integer, uuid);
drop index public.procurements_import_ref_lookup_idx;
alter table public.procurements drop column import_normalized_ref;
drop function public.start_procurement_import_run(uuid);
drop table public.procurement_import_runs;
