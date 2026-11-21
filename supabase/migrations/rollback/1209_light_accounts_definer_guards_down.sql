-- The guard is a one-line prefix, inert for everyone but a light account. Reversal: re-apply the latest migration that defines each
-- function named in 1209 (reverse 1209's bodies before dropping 1205's assert_not_light).
drop index if exists public.incident_reports_reported_by_idx;
drop index if exists public.tasks_assignee_idx;
