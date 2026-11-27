begin;
drop index if exists public.attendance_days_project_idx;
drop index if exists public.daily_site_reports_project_fk_idx;
drop index if exists public.material_requests_project_idx;
commit;
