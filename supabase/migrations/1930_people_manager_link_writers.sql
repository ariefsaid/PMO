-- 1930_people_manager_link_writers.sql — who may set or change a person's direct manager.
-- An Admin, or a holder of the people-documents right (actor_has_person_documents_access, 1536); only an Admin may name
-- themselves as the manager. A trigger checks every client write of people (the person form, the people import, a direct
-- call): the signed-in role writes through the column grants, so this is the one path. A write that leaves the manager as
-- it is passes, so an existing person edits as before. The role and RLS rules for writing people are unchanged (1035).
-- Proven by supabase/tests/1765_people_import_update_roles.test.sql. Rollback: rollback/1930_people_manager_link_writers_down.sql

create function public.people_manager_link_guard() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  -- Definers and the service role write as their owner, not as a signed-in caller.
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'UPDATE' and new.manager_id is not distinct from old.manager_id then return new; end if;
  if tg_op = 'INSERT' and new.manager_id is null then return new; end if;
  if coalesce(public.auth_role() = 'Admin', false) then return new; end if;                                -- mut:admin
  if not coalesce(public.actor_has_person_documents_access(), false) then                                 -- mut:right
    raise exception 'PPL_MANAGER_RIGHT: only an Admin or the people team can set a person''s direct manager' using errcode = '42501';
  end if;
  if new.manager_id = auth.uid() then                                                                     -- mut:self
    raise exception 'PPL_MANAGER_SELF: only an Admin can name themselves a person''s direct manager' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.people_manager_link_guard() from public, anon, authenticated;

create trigger people_manager_link_guard before insert or update of manager_id on public.people
  for each row execute function public.people_manager_link_guard();
