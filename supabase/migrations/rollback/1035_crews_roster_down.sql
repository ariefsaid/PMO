-- 1035_crews_roster_down.sql — reverse 1035. Reverse 1037 and 1036 first. btree_gist stays (shared extension).
drop function if exists public.work_order_roster(uuid, date);
drop function if exists public.create_crew_with_roles(jsonb, jsonb);
drop function if exists public.place_new_crew_worker(jsonb, jsonb);
drop table if exists public.work_order_crews;
drop table if exists public.crew_members;
drop trigger if exists zz_people_crew_refs on public.people;
drop view if exists public.people_directory;
drop policy if exists people_insert on public.people;
drop policy if exists people_update on public.people;
create policy people_insert on public.people for insert with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy people_update on public.people for update using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()));
revoke insert (id) on public.people from authenticated;
alter table public.people drop constraint people_vendor_no_login, drop column kind, drop column id_reference, drop column vendor_company_id, drop column job_title;
drop table if exists public.crew_standard_roles;
drop table if exists public.crews;
drop function if exists public.crew_can_manage();
drop function if exists public.guard_crew_refs();
