-- rollback/1202_profiles_built_in_role_down.sql
-- Refuse while anyone holds a key: dropping it would silently collapse their role to the base access level.
do $$
begin
  if exists (select 1 from public.profiles where built_in_role is not null) then
    raise exception 'refusing to roll back while profiles hold a built-in role' using errcode = 'P0001';
  end if;
end $$;
drop trigger if exists profiles_built_in_role_sync on public.profiles;
drop function if exists public.profiles_built_in_role_sync();
revoke update (built_in_role) on public.profiles from authenticated;
alter table public.profiles drop column if exists built_in_role;
