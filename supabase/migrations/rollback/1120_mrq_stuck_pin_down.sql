-- Reverses 1120_mrq_stuck_pin.sql: restores the 1045 mrq_pinned_to body (a pin binds regardless of its person's state).
create or replace function public.mrq_pinned_to(p_project_id uuid, p_position integer, p_role public.user_role) returns uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select pin.approver_id from public.approval_step_pins pin
   where pin.project_id = p_project_id and pin.position = p_position and pin.role = p_role;
$$;
