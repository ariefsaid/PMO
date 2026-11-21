-- Rollback for 1150_vendor_supply_risk_reads.sql (#2583). Revert 1067 (it calls vendor_exposed_work_orders) and the FE first.
drop function if exists public.vendor_exposed_work_orders(uuid);
drop function if exists public.vendor_supply_risk_suggestion(uuid);
notify pgrst, 'reload schema';
