-- 1741_manpower_need_progress.sql — asked, linked, filled, in progress and open per need (FR-MPN-004).
-- COUNTS ONLY. SECURITY DEFINER so the people team sees progress for the needs they fill even where the clearance policies (1236) do not
-- let them read a person's checklist; no per-person clearance detail leaves this function. Scoped to callers who can read the need: the
-- same predicate as manpower_needs_select (same organisation, active member), so another organisation or a disabled member gets no row.
-- "Cleared" is computed only by person_clearance_summary() (1237), which this joins. The 1236 clearance policies are untouched.
-- WHO SEES WHAT: asked, linked and open go to everyone who can read the need. filled and in_progress (which tell whether a named person
-- is cleared) go only to manpower_can_manage() holders and to the roles that read clearances today (the person_clearances select policy,
-- 1236: Admin, Project Manager, Finance, Executive); for everyone else they are null and the screen shows a dash.
-- filled = linked and cleared · in_progress = linked, not cleared · open = asked - linked.
-- Mutation check (break the rule, the named pgTAP assertions must go red): drop the `is_active_member()` / org predicate in the where
-- clause (AC-MPN-004 "no row" assertions); count every linked person as filled (AC-MPN-004 figures); drop the `ok.v` test so an Engineer
-- gets numbers (AC-MPN-004 "null for an Engineer" assertion).
-- REVERSE: supabase/migrations/rollback/1741_manpower_need_progress_down.sql

create function public.manpower_need_progress()
  returns table (need_id uuid, asked integer, linked integer, filled integer, in_progress integer, open_count integer)
  language sql stable security definer set search_path = public, pg_temp as $$
  with cl as (select s.person_id, s.cleared from public.person_clearance_summary() s),
       ok as (select (public.manpower_can_manage()                                                              -- mut:counts_audience
                      or coalesce(public.auth_role()::text in ('Admin', 'Project Manager', 'Finance', 'Executive'), false)) as v)
  select n.id, n.headcount,
         count(l.id)::integer,
         case when ok.v then (count(l.id) filter (where coalesce(cl.cleared, false)))::integer end,             -- mut:filled_is_cleared
         case when ok.v then (count(l.id) filter (where not coalesce(cl.cleared, false)))::integer end,
         greatest(n.headcount - count(l.id), 0)::integer
    from public.manpower_needs n
    cross join ok
    left join public.manpower_need_people l on l.need_id = n.id
    left join cl on cl.person_id = l.person_id
   where public.assert_not_light()                                                                            -- field account refused by body (2711, 1530)
     and n.org_id = (select public.auth_org_id()) and (select public.is_active_member())                       -- mut:read_predicate
   group by n.id, n.headcount, ok.v
$$;
revoke all on function public.manpower_need_progress() from public, anon;
grant execute on function public.manpower_need_progress() to authenticated;
