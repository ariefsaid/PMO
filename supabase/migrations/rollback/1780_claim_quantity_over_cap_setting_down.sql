-- Reverses 1780_claim_quantity_over_cap_setting.sql.
drop trigger if exists organizations_audit_claim_quantity_over_cap on public.organizations;
drop function if exists public.audit_org_claim_quantity_over_cap();
drop policy if exists organizations_update_claim_quantity_over_cap on public.organizations;
alter table public.organizations drop column if exists claim_quantity_over_cap;
