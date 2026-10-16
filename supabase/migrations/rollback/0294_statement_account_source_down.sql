alter table public.external_org_bindings
  drop column if exists statement_calendar,
  drop column if exists statement_last_attempt_at,
  drop column if exists statement_update_delayed,
  drop column if exists statement_full_ledger_replay_needed;
drop trigger if exists erp_account_mirror_stamp_org_id on public.erp_account_mirror;
drop table if exists public.erp_account_mirror;
drop function if exists public.release_erp_sweep_lock(uuid, uuid);
drop function if exists public.claim_erp_sweep_lock(uuid, uuid, interval);
drop table if exists public.erp_sweep_lock;
