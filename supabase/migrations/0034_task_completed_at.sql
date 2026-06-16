-- 0034_task_completed_at.sql
-- Purpose: Add tasks.completed_at (timestamptz), stamped by a BEFORE trigger, backfill existing Done rows.
-- Reversibility: reversible pre-prod via `supabase db reset`; forward-only rollback if already promoted:
--   alter table tasks drop column completed_at;
--   drop function if exists stamp_task_completed_at() cascade;
-- Security note: the trigger only stamps the column; RLS on tasks is UNCHANGED (NFR-SCA-006).
--   The BEFORE trigger overwrites any client-supplied value, so completed_at is never forgeable
--   and always agrees with status (NFR-SCA-003).

-- 1. Column
alter table tasks add column completed_at timestamptz;

-- 2. Trigger function
create or replace function stamp_task_completed_at() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'Done' then now() else null end;
  elsif new.status = 'Done' and old.status is distinct from 'Done' then
    new.completed_at := now();          -- entered Done
  elsif new.status is distinct from 'Done' and old.status = 'Done' then
    new.completed_at := null;            -- left Done
  else
    new.completed_at := old.completed_at; -- status unchanged → preserve (overwrites client value)
  end if;
  return new;
end $$;

-- 3. Bind trigger
create trigger trg_stamp_task_completed_at
  before insert or update on tasks
  for each row execute function stamp_task_completed_at();

-- 4. Backfill existing Done rows (disable trigger so the trigger's else-branch doesn't overwrite the explicit set).
--    `end_date` (the task's scheduled finish) is the honest completion proxy; `created_at` is the weaker
--    fallback only when end_date is null (it can pre-date the true completion) — both are ESTIMATES, surfaced
--    by the FR-SCA-014 "dates before today are estimated" chart caveat. Go-forward writes are real (trigger).
alter table tasks disable trigger trg_stamp_task_completed_at;

update tasks
  set completed_at = coalesce(end_date::timestamptz, created_at)
  where status = 'Done';

alter table tasks enable trigger trg_stamp_task_completed_at;
