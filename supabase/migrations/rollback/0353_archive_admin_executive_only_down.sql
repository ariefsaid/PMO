-- Down for 0353.
drop trigger if exists projects_archive_admin_executive on public.projects;
drop trigger if exists companies_archive_admin_executive on public.companies;
drop function if exists public.assert_archive_admin_executive();
