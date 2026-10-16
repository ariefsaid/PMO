drop function if exists public.release_erp_sweep_lock(uuid, uuid);
drop function if exists public.claim_erp_sweep_lock(uuid, uuid, interval);
drop table if exists public.erp_sweep_lock;
