-- 0900_project_manager_same_org_down.sql — remove the project-manager same-organisation guard.
drop trigger if exists projects_zz_project_manager_same_org on public.projects;
drop function if exists public.check_project_manager_same_org();
