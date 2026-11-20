-- 1008_people_register.sql — #2542 follow-up: the People register (spec docs/specs/people-register.spec.md).
-- Adds a database-assigned person code (P-0001, P-0002, ...) per organisation when the code is left blank.
-- The optional job title column and its insert/update grants belong to 0988_crews_roster (one owner).

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
