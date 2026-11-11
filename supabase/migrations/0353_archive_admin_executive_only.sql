-- 0353: only Admin and Executive archive or restore projects and companies (owner ruling 2026-10-23),
-- matching the app's archive affordance. Other writers keep their ordinary edit rights.
-- Rollback: rollback/0353_archive_admin_executive_only_down.sql

create or replace function public.assert_archive_admin_executive()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if new.archived_at is distinct from old.archived_at
     and public.auth_role() not in ('Admin', 'Executive') then
    raise exception 'Archiving is limited to Admin and Executive.' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger projects_archive_admin_executive before update of archived_at on public.projects
  for each row execute function public.assert_archive_admin_executive();
create trigger companies_archive_admin_executive before update of archived_at on public.companies
  for each row execute function public.assert_archive_admin_executive();
