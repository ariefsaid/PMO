-- 0356_erpnext_sweep_every_minute.sql — money postings reach ERPNext near-instantly (owner ruling
-- 2026-10-23). The erpnext-sweep tick moves from every five minutes (0102) to every minute. The
-- function decides per tick what to run: the outbound money passes run on every tick, while the
-- inbound and statement work keeps its hourly cadence (erpnext-sweep `sweepCadenceAt`).
--
-- Overlap: `erpnext_sweep_tick()` only queues an asynchronous pg_net request, so it finishes at once
-- and a database-side lock around it would not stop two sweeps running together. The sweep itself
-- takes the per-org `claim_erp_sweep_lock` (0294, 15-minute lease, released when the org is done)
-- before any pass; a tick that finds the lock held skips that org and reports `statement-lock-held`.
--
-- Same guarded helper as 0102 (no-ops until both Vault secrets exist). `cron.schedule` upserts by name.
-- Rollback: rollback/0356_erpnext_sweep_every_minute_down.sql

select cron.schedule('erpnext-sweep-tick', '* * * * *', 'select public.erpnext_sweep_tick()');
