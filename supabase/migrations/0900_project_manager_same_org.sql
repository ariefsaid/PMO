-- 0900_project_manager_same_org.sql — a project's manager belongs to the project's organisation.
--
-- The database is the enforcement authority: a SECURITY DEFINER, search-path-pinned
-- `BEFORE INSERT OR UPDATE OF project_manager_id, org_id` trigger requires any non-null manager
-- to be a profile of the row's OWN org. A mismatch raises `42501` (never `23503`, so the error does
-- not leak whether the referenced profile exists). Same shape as 0223's end-customer guard.
--
-- Rollback: supabase/migrations/rollback/0900_project_manager_same_org_down.sql

create or replace function public.check_project_manager_same_org()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_manager_id is not null
     and not exists (
       select 1 from public.profiles p
       where p.id = new.project_manager_id and p.org_id = new.org_id)
  then
    raise exception 'project manager not in this organization' using errcode = '42501';
  end if;
  return new;
end $$;

-- Trigger functions need no EXECUTE grant; revoke broadly so the direct-call surface stays closed.
revoke all on function public.check_project_manager_same_org() from public, anon, authenticated;

-- `zz_` slot: fires AFTER `projects_stamp_org_id` (triggers fire alphabetically; the org stamp runs first).
create trigger projects_zz_project_manager_same_org
  before insert or update of project_manager_id, org_id
  on public.projects
  for each row execute function public.check_project_manager_same_org();
