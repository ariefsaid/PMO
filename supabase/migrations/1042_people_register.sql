-- 1042_people_register.sql — #2542 follow-up: the People register (spec docs/specs/people-register.spec.md).
-- Adds a database-assigned person code (P-0001, P-0002, ...) per organisation when the code is left blank.
-- The optional job title column and its grants belong to 1035_crews_roster; this migration is the one owner of person-code
-- generation (crews sets no column default, so a blank code always reaches this trigger).

-- Blank code on insert -> next P-NNNN for the org. Serialised per org by a transaction advisory lock; scans archived rows too,
-- so a number is never reused. Named z_ so it fires after people_stamp_org_id has fixed org_id.
create or replace function public.people_assign_code() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_next numeric;
begin
  if new.code is not null and btrim(new.code) <> '' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('people_code:' || new.org_id::text, 0));
  select coalesce(max(substring(code from '^P-([0-9]{1,38})$')::numeric), 0) + 1 into v_next
    from public.people where org_id = new.org_id and code ~ '^P-[0-9]{1,38}$';
  new.code := 'P-' || lpad(v_next::text, greatest(4, length(v_next::text)), '0');
  return new;
end $$;
revoke all on function public.people_assign_code() from public, anon, authenticated;
create trigger people_z_code_trg before insert on public.people for each row execute function public.people_assign_code();

-- AC-PPL-003: Admin and Project Manager add and edit (1035's people policies); only an Admin archives or restores.
-- A trigger, because the update policy and the archived_at column grant are shared by both roles.
create or replace function public.people_archive_admin_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.archived_at is distinct from old.archived_at
     and current_user = 'authenticated' and coalesce(public.auth_role()::text, '') <> 'Admin' then
    raise exception 'only an Admin archives a person' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.people_archive_admin_only() from public, anon, authenticated;
create trigger people_archive_admin_only_trg before update of archived_at on public.people
  for each row execute function public.people_archive_admin_only();
