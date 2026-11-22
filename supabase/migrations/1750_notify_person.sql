-- 1750_notify_person.sql — the shared "tell this person" helper. Callers: the medical release decision (1751) and the
-- expiry-to-manager notice. Resolves people.profile_id and writes the in-app notice through notify_workflow_user, so the
-- same rules apply: the recipient must be an active member of the person's organisation and is never the acting user.
-- A person with no login, an unknown person, an inactive member: nothing happens (no error, no row).
-- p_kind is the notice's entity type; p_link is carried as the notice label (the notification row has no link column).
-- Internal only: callers are definer functions; clients cannot execute it.
-- Reverse: supabase/migrations/rollback/1750_notify_person_down.sql
create function public.notify_person(p_person uuid, p_kind text, p_title text, p_body text, p_link text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_profile uuid;
begin
  select w.org_id, w.profile_id into v_org, v_profile from public.people w where w.id = p_person;
  if v_profile is null then return; end if;
  perform public.notify_workflow_user(v_org, v_profile, p_title, p_body, 'info', p_kind, null, p_link);
end $$;
revoke all on function public.notify_person(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_person(uuid, text, text, text, text) to service_role;
