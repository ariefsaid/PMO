-- 1120_mrq_stuck_pin.sql — #2605 a pinned approver who can no longer act must not leave the step stuck.
-- Spec docs/specs/material-requests.spec.md (FR-MRQ-026). Proven by supabase/tests/mrq_stuck_pin.test.sql.
--
-- A pin binds a step only while its person is an active member of the organisation who still holds the pin's role.
-- Otherwise the pin is dead: mrq_pinned_to returns null, so the authority check, the decision and the queue all use the
-- step's role rule (and stand-ins for role holders) as if the step were unpinned. The row is kept, so the project's
-- setting screen can flag it as needing attention until an Admin or the project's manager re-points or clears it.
--
-- REVERSE: supabase/migrations/rollback/1120_mrq_stuck_pin_down.sql (restores the 1045 body).

create or replace function public.mrq_pinned_to(p_project_id uuid, p_position integer, p_role public.user_role) returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select pin.approver_id from public.approval_step_pins pin
    join public.profiles who on who.id = pin.approver_id and who.org_id = pin.org_id
   where pin.project_id = p_project_id and pin.position = p_position and pin.role = p_role
     and who.status = 'active'                                                                        -- mut:pin_alive_status
     and who.role = pin.role;                                                                         -- mut:pin_alive_role
$$;
