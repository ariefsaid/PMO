-- Rollback for 1149_vendor_supply_risk_columns.sql (#2583). Revert 1150/1151 and the FE first. The recorded status,
-- reasons and stamps are lost with their columns; the audit events (company.supply_risk.change) keep from/to/reason.

update public.record_history_config
   set captured  = captured - 'supply_risk_status' - 'supply_risk_set_at',
       flag_cols = array(select c from unnest(flag_cols) c where c <> 'supply_risk_reason'),
       omit_cols = array(select c from unnest(omit_cols) c where c <> 'supply_risk_set_by')
 where entity_type = 'company';

drop trigger if exists companies_supply_risk_guard on public.companies;
drop function if exists public.companies_supply_risk_guard();
alter table public.companies
  drop constraint if exists companies_supply_risk_reason_required,
  drop constraint if exists companies_supply_risk_reason_shape,
  drop constraint if exists companies_supply_risk_status_domain,
  drop column if exists supply_risk_set_at,
  drop column if exists supply_risk_set_by,
  drop column if exists supply_risk_reason,
  drop column if exists supply_risk_status;

notify pgrst, 'reload schema';
