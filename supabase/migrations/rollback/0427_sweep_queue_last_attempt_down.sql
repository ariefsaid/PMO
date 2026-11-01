-- 0427_sweep_queue_last_attempt_down.sql — reverse of 0427. The stamp is operational ordering state
-- only; dropping it returns the queues to oldest-first.
drop index if exists public.budget_archive_cancel_attempt_idx;
drop index if exists public.timesheet_erp_mirror_attempt_idx;
drop index if exists public.budget_version_account_erp_mirror_attempt_idx;
drop index if exists public.budget_version_erp_mirror_attempt_idx;
alter table public.budget_archive_cancel_intents     drop column if exists last_attempt_at;
alter table public.timesheet_erp_mirror              drop column if exists last_attempt_at;
alter table public.budget_version_account_erp_mirror drop column if exists last_attempt_at;
alter table public.budget_version_erp_mirror         drop column if exists last_attempt_at;
