-- 1243_leave_requestable_people.sql — #2708: the people the caller may enter a leave request for (the picker on the form).
-- Mirrors the authority in leave_request_submit: themselves, their reports, and everyone for an office user.
--
-- ── REVERSE (also supabase/migrations/rollback/1243_leave_requestable_people_down.sql) ── drop function leave_requestable_people.
create function public.leave_requestable_people()
  returns table (id uuid, name text, is_self boolean)
  language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, coalesce(w.profile_id = auth.uid(), false)
    from public.people w
   where public.is_active_member() and w.org_id = public.auth_org_id() and w.archived_at is null
     and (coalesce(w.profile_id = auth.uid(), false) or public.crew_can_manage()
          or exists (select 1 from public.profiles p where p.id = w.profile_id and p.manager_id = auth.uid()))
   order by 3 desc, w.name
$$;
revoke all on function public.leave_requestable_people() from public, anon;
grant execute on function public.leave_requestable_people() to authenticated;
