-- 0220_timesheet_push_actor_standing.sql — the timesheet push gate checks the resolved actor's whole
-- standing on the service_role sweep path too.
--
-- `approved_timesheet_for_push` (0138) applied `is_active_member()` only when a JWT was present, so on
-- the sweep path (`p_actor`, auth.uid() null) it checked `profiles.status` alone and missed 0095's
-- `auth.users.banned_until` (a ban applied outside `admin_set_user_status`). The fix uses 0180's
-- `is_active_member(uuid)` on the resolved actor for both paths. Grants are unchanged (`create or
-- replace` keeps them). Proof: supabase/tests/0143_timesheet_push_authz.test.sql (AC-TSP-013 raw ban).
--
-- Rollback: re-run the function definition from 0138_approved_timesheet_for_push.sql.

create or replace function public.approved_timesheet_for_push(p_timesheet_id uuid, p_actor uuid default null)
  returns table (timesheet_id uuid, user_id uuid, approved_at timestamptz, entries jsonb)
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_status timesheet_status; v_owner uuid; v_approved_by uuid; v_approved_at timestamptz;
  -- ⚑ auth.uid() FIRST — a JWT caller can NEVER override their own identity with `p_actor`.
  -- `coalesce(p_actor, auth.uid())` (the original order) was an impersonation hole: any authenticated
  -- org member could pass the sheet's `approved_by` as p_actor and satisfy actor-rule (c) below,
  -- defeating the check entirely. `p_actor` is ONLY for the service_role sweep, where auth.uid() is
  -- null — which this ordering expresses exactly.
  v_actor uuid := coalesce(auth.uid(), p_actor);
  v_actor_org uuid;
  v_role  user_role;
  v_actor_status text;
begin
  select t.org_id, t.status, t.user_id, t.approved_by, t.approved_at
    into v_org, v_status, v_owner, v_approved_by, v_approved_at
    from public.timesheets t where t.id = p_timesheet_id;
  if v_org is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- (a) tenancy — MUST STAY (definer bypasses RLS). Compared against the ACTOR's own org, never a payload.
  -- An actor that cannot be resolved at all (no JWT and no p_actor) is refused: fail closed.
  select p.org_id, p.role, p.status into v_actor_org, v_role, v_actor_status from public.profiles p where p.id = v_actor;
  if v_actor is null or v_actor_org is null or v_actor_org is distinct from v_org then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- (a2) OFFBOARDING GATE (0062/0095; the 0128/0129/0130 pass, now applied to P3b's definer function).
  -- This function is `grant execute … to authenticated`, i.e. reachable DIRECTLY over PostgREST, so the
  -- edge fn's auth guard is not in the path. Without this a just-disabled approver holding a valid JWT
  -- could keep pushing payroll-costing hours into the client's ERP until their token expired.
  --
  -- ⚑ Keyed on the RESOLVED actor, never a bare `is_active_member()`: that zero-argument helper reads
  -- `auth.uid()`, which is NULL on the service_role sweep path, so conjoining it would refuse every sweep
  -- call and silently disable the backstop. `is_active_member(v_actor)` (0180) applies the whole standing
  -- rule (status AND 0095's banned_until) to whoever the actor resolved to, on both paths (0220).
  if v_actor_status is distinct from 'active' or not public.is_active_member(v_actor) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- (b) THE OWNER'S RULING (FR-TSP-010): only an Approved sheet may ever reach the external system.
  if v_status is distinct from 'Approved' then
    raise exception 'timesheet-not-approved (status %)', v_status using errcode = 'P0001';
  end if;

  -- (c) actor rule (FR-TSP-011): the approver, or a privileged role. NOT the money-write set.
  if not (v_actor is not distinct from v_approved_by
          or v_role in ('Admin','Executive','Project Manager','Finance')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p_timesheet_id, v_owner, v_approved_at,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'project_id', e.project_id,
                       'entry_date', e.entry_date,
                       'hours', e.hours::text,        -- decimal STRING (FR-TSP-070) — never a float
                       'project_org_id', pr.org_id)   -- for the same-org pre-flight (FR-TSP-054)
                     order by e.entry_date, e.project_id)  -- stable total order (FR-TSP-062 determinism)
                     from public.timesheet_entries e
                     join public.projects pr on pr.id = e.project_id
                    where e.timesheet_id = p_timesheet_id and e.hours > 0), '[]'::jsonb);
end; $$;
