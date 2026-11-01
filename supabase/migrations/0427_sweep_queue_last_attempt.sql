-- 0427_sweep_queue_last_attempt.sql — durable last-attempt stamps so the sweep's recovery queues are
-- served least-recently-attempted first (THEME-BACK-06; the expense queue's round-robin, 0270/0358).
--
-- The budget, timesheet and budget-archive passes each took the OLDEST 200 candidates every tick. A
-- candidate that is skipped (its version is no longer Active), waiting (an outbox retry window) or that
-- keeps failing stays in the queue and stays OLDEST, so 200 of them hide every newer eligible row and
-- those pushes never run. Each pass now stamps the rows it selects and orders by
-- `last_attempt_at nulls first, created_at, id`: never-attempted first, then the longest-waiting, so
-- one full page of unchanged candidates cannot starve the rest.
--
-- Columns only. No data is rewritten (NULL = never attempted sorts first), no policy or grant changes
-- (the sweep writes these through the service role), and the stamp is written by no other code path.
alter table public.budget_version_erp_mirror         add column if not exists last_attempt_at timestamptz;
alter table public.budget_version_account_erp_mirror add column if not exists last_attempt_at timestamptz;
alter table public.timesheet_erp_mirror              add column if not exists last_attempt_at timestamptz;
alter table public.budget_archive_cancel_intents     add column if not exists last_attempt_at timestamptz;

-- The queue reads are `org_id = ? and push_state/state in (...)` ordered by the new key; one partial
-- index per queue serves the order (the eligible states are the only rows the passes read).
create index if not exists budget_version_erp_mirror_attempt_idx
  on public.budget_version_erp_mirror (org_id, last_attempt_at nulls first, created_at, id)
  where push_state in ('pending','failed') and erp_cancelled_at is null;
create index if not exists budget_version_account_erp_mirror_attempt_idx
  on public.budget_version_account_erp_mirror (org_id, last_attempt_at nulls first, created_at, id)
  where push_state in ('pending','failed') and erp_cancelled_at is null;
create index if not exists timesheet_erp_mirror_attempt_idx
  on public.timesheet_erp_mirror (org_id, last_attempt_at nulls first, created_at, id)
  where push_state in ('pending','failed') and erp_cancelled_at is null;
create index if not exists budget_archive_cancel_attempt_idx
  on public.budget_archive_cancel_intents (org_id, last_attempt_at nulls first, created_at, id)
  where state = 'pending';
