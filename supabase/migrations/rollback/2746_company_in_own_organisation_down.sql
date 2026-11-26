-- Reverses 2746_company_in_own_organisation.sql.
drop trigger zzzzz_company_in_own_org_ins on public.projects;
drop trigger zzzzz_company_in_own_org_upd on public.projects;
drop trigger zzzzz_company_in_own_org_ins on public.sales_invoices;
drop trigger zzzzz_company_in_own_org_upd on public.sales_invoices;
drop trigger zzzzz_company_in_own_org_ins on public.incoming_payments;
drop trigger zzzzz_company_in_own_org_upd on public.incoming_payments;
drop trigger zzzzz_company_in_own_org_ins on public.crm_activities;
drop trigger zzzzz_company_in_own_org_upd on public.crm_activities;
drop function public.guard_company_in_own_organisation();
