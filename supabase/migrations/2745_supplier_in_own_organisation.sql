-- 2745: a purchase or a quote may name only a company of its own organisation.
-- One trigger function on both tables (insert, and update that changes the supplier), so every path that sets the supplier (the quote function, the selection, the direct update)
-- reads an id outside the organisation as absent. drops: nothing; no function body is restated.
-- Proven by supabase/tests/2745_quote_supplier_org.test.sql. Rollback: rollback/2745_supplier_in_own_organisation_down.sql

create function public.guard_supplier_in_own_organisation() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.vendor_id is not null
     and not exists (select 1 from public.companies c where c.id = new.vendor_id and c.org_id = new.org_id) then
    raise exception 'supplier not found' using errcode = 'P0002';
  end if;
  return new;
end $$;
revoke all on function public.guard_supplier_in_own_organisation() from public, anon, authenticated;

-- Insert: any supplier named. Update: only a real change of supplier, so a row that already holds another organisation's company
-- (older data) still saves an unrelated edit, and a quote selection that leaves the supplier as it was does not trip the rule.
create trigger zzzzz_supplier_in_own_organisation_ins before insert on public.procurements
  for each row when (new.vendor_id is not null) execute function public.guard_supplier_in_own_organisation();
create trigger zzzzz_supplier_in_own_organisation_upd before update of vendor_id on public.procurements
  for each row when (new.vendor_id is not null and new.vendor_id is distinct from old.vendor_id) execute function public.guard_supplier_in_own_organisation();
create trigger zzzzz_supplier_in_own_organisation_ins before insert on public.procurement_quotations
  for each row when (new.vendor_id is not null) execute function public.guard_supplier_in_own_organisation();
create trigger zzzzz_supplier_in_own_organisation_upd before update of vendor_id on public.procurement_quotations
  for each row when (new.vendor_id is not null and new.vendor_id is distinct from old.vendor_id) execute function public.guard_supplier_in_own_organisation();
