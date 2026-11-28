-- Speed only: deleting a project checks every child table that references it by project_id.
-- These three tables grow with daily use and had no index led by project_id, so each delete
-- scanned them sequentially. No rows, policies, grants or figures change.
-- Rollback: rollback/2794_child_fk_project_indexes_down.sql
begin;
create index if not exists attendance_days_project_idx on public.attendance_days (project_id);
create index if not exists daily_site_reports_project_fk_idx on public.daily_site_reports (project_id);
create index if not exists material_requests_project_idx on public.material_requests (project_id);
commit;
