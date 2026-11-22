-- Fix-forward for 1395: task_groups.org_id carries the seed default, so without the stamp a second organisation's
-- insert would take the wrong org. Attach the shared org-stamp trigger like every other seed-default table.
-- Reversal: rollback/1419_task_groups_org_stamp_down.sql.
create trigger task_groups_stamp_org_id before insert on public.task_groups
  for each row execute function public.stamp_org_id();
