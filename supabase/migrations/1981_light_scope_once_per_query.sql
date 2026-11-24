-- 1981_light_scope_once_per_query.sql -- the field-account read scope of crew_members is worked out once per query, not once
-- per row.
-- The restrictive light_account_scope_select policy on crew_members called light_can_see_crew_member(crew_id, worker_id), a
-- security-definer helper, for every row; each call also called auth_org_id(), itself a definer (about 40 us a row). A
-- foreman's phone home reads the organisation's placements for its add-a-person picker: with 3,220 placements that read took
-- 130 ms idle and 1.05 s mean under 500 users, the heaviest statement of the run (perf-1124).
-- The same scope is now written as two uncorrelated subqueries with select-wrapped auth helpers, which the planner runs once
-- per query (hashed SubPlan), the form the other policies already use: the crew is one the caller leads in their organisation,
-- or the placement is the caller's own person in their organisation (exactly light_can_see_crew_member's body, 1205).
-- The subqueries read crews and people as the caller. The rows they need are the caller's own led crews (visible to a field
-- account through light_can_see_crew, 1206) and the caller's own person (people_select: profile_id = auth.uid()); both
-- policies also require an active member of the organisation, as crew_members' own permissive policy already does. So the
-- visible rows are exactly the same; non-field accounts are unaffected (first operand). The helper stays (other code calls it).
-- work_order_crews keeps its per-row helper: its reads are by work order (one or two rows), where the per-query form measured
-- slower, not faster.
-- Rollback: supabase/migrations/rollback/1981_light_scope_once_per_query_down.sql

alter policy light_account_scope_select on public.crew_members using (
  (select public.actor_is_light()) is not true
  or crew_id in (select c.id from public.crews c
                  where c.org_id = (select public.auth_org_id()) and c.field_controller_id = (select auth.uid()))
  or worker_id in (select w.id from public.people w
                    where w.org_id = (select public.auth_org_id()) and w.profile_id = (select auth.uid())));
