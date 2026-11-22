-- 1610_person_mark_left.sql — fix/walk-people item 1: "Mark as left" with a date.
-- A person who has left moves to former staff (archived_at set to the leaving day) and leaves every crew roster from that day:
-- a crew membership that was running ends the day before; one that had not started yet is removed (it never happened).
-- Their history stays. Only an Admin may do it, the same rule as archiving a person today (people_archive_admin_only).
--
-- ── REVERSE (also supabase/migrations/rollback/1610_person_mark_left_down.sql) ─────────────────────────────
--   drop function public.person_mark_left(uuid, date). Memberships it ended are not restored.

create function public.person_mark_left(p_person_id uuid, p_left_on date)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_org is null or coalesce(public.auth_role()::text, '') <> 'Admin' then
    raise exception 'PPL_FORBIDDEN: only an Admin marks a person as having left' using errcode = '42501';
  end if;
  if p_left_on is null then
    raise exception 'PPL_DATE: choose the day the person left' using errcode = '23514';
  end if;
  update public.people set archived_at = p_left_on::timestamp at time zone 'UTC'
    where id = p_person_id and org_id = v_org and archived_at is null;
  if not found then
    raise exception 'PPL_NOT_FOUND: the person was not found, or has already left' using errcode = '23514';
  end if;
  delete from public.crew_members where worker_id = p_person_id and org_id = v_org and valid_from >= p_left_on;
  update public.crew_members set valid_to = p_left_on - 1
    where worker_id = p_person_id and org_id = v_org and (valid_to is null or valid_to >= p_left_on);
  perform public.log_audit('person.left', v_org, auth.uid(), p_person_id, jsonb_build_object('left_on', p_left_on));
end $$;
revoke all on function public.person_mark_left(uuid, date) from public, anon;
grant execute on function public.person_mark_left(uuid, date) to authenticated;
