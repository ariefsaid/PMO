-- Rollback for 1067_set_vendor_supply_status.sql (#2583). Revert the FE first. Notifications already sent remain.
drop function if exists public.set_vendor_supply_status(uuid, text, text);
notify pgrst, 'reload schema';
