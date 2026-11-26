-- Rollback of 2745: remove the supplier-organisation guard.
drop trigger zzzzz_supplier_in_own_organisation_ins on public.procurement_quotations;
drop trigger zzzzz_supplier_in_own_organisation_upd on public.procurement_quotations;
drop trigger zzzzz_supplier_in_own_organisation_ins on public.procurements;
drop trigger zzzzz_supplier_in_own_organisation_upd on public.procurements;
drop function public.guard_supplier_in_own_organisation();
