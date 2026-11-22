-- 1741_manpower_need_progress.sql — asked, filled, in progress and open per need (FR-MPN-004).
-- SECURITY INVOKER like person_clearance_summary (1237), which it joins: "cleared" is computed there and only there. A caller who cannot
-- read the clearances gets linked people as in progress, never as filled. The result is a pure read; nothing is stored.
-- filled = linked and cleared · in_progress = linked, not cleared · open = asked - linked.
-- REVERSE: supabase/migrations/rollback/1741_manpower_need_progress_down.sql

create function public.manpower_need_progress()
  returns table (need_id uuid, asked integer, linked integer, filled integer, in_progress integer, open_count integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with cl as (select s.person_id, s.cleared from public.person_clearance_summary() s)
  select n.id, n.headcount,
         count(l.id)::integer,
         (count(l.id) filter (where coalesce(cl.cleared, false)))::integer,                                      -- mut:filled_is_cleared
         (count(l.id) filter (where not coalesce(cl.cleared, false)))::integer,
         greatest(n.headcount - count(l.id), 0)::integer
    from public.manpower_needs n
    left join public.manpower_need_people l on l.need_id = n.id
    left join cl on cl.person_id = l.person_id
   where n.org_id = (select public.auth_org_id())
   group by n.id, n.headcount
$$;
revoke all on function public.manpower_need_progress() from public, anon;
grant execute on function public.manpower_need_progress() to authenticated;
