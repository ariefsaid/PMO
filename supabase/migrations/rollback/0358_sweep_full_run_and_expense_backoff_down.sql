-- Down for 0358. Roll back 0356 (the one-minute tick) before or together with this file, and deploy the
-- erpnext-sweep build that predates 0358 first: it reads the full-run marker and the expense queue.
drop function if exists public.expense_posting_queue(uuid, int);
alter table public.expense_posting_erp_mirror drop column if exists attempt_count;
drop function if exists public.mark_erp_full_sweep_done(uuid, uuid);
drop table if exists public.erp_sweep_full_run;
