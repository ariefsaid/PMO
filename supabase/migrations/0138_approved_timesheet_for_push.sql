-- 0138_approved_timesheet_for_push.sql (ERPNext P3b — the Approved-only gate read)
--
-- The ONE read the dispatch (and later the sweep backstop) uses to
--   (a) prove the sheet is APPROVED — the owner's ruling, FR-TSP-010,
--   (b) prove the CALLER may push it — FR-TSP-011,
--   (c) hand back the sheet's author, its approved_at witness, and its entries in one round trip,
-- so that NOTHING about the push is decided by the command payload (ADR-0059 §3.3: "the precondition is
-- re-asserted server-side, from the database, before any external call… the command payload is NEVER
-- trusted"). The entries come back FROM here, so a forged payload cannot decide which hours get posted.
--
-- SECURITY DEFINER so it can read across timesheets/timesheet_entries/projects/profiles in one call —
-- which means it MUST re-assert, internally and explicitly, every guard RLS would have applied
-- (the ADR-0011/0012 lesson: definer bypasses RLS, so deleting any check below leaks a cross-org or
-- unauthorized push):
--   • org: the sheet's org MUST equal the ACTOR's org                              (FR-TSP-054)
--   • status: MUST be 'Approved' — else P0001 'timesheet-not-approved'             (FR-TSP-010) ★
--   • actor: caller MUST be approved_by, OR Admin/Executive/Project Manager/Finance (FR-TSP-011)
--     ⚑ NOT the money-write role set: a legitimate approver is very often an ENGINEER-role LINE MANAGER
--       (profiles.manager_id; 0007 A2/A4). Narrowing this breaks the PRIMARY approval path.
--
-- ⚑ POSTURE B (ADR-0059 §3.1): this migration ADDS A READ. It does not touch `timesheets`,
--   `timesheet_entries`, `profiles`, their RLS, or `transition_timesheet` — PMO's process is untouched.
--
-- The sweep (a later slice) calls this as service_role passing `p_actor` = the sheet's `approved_by`
-- (the admin-connect `p_actor_id` precedent) — it never "trusts itself" past the status check.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual reverse:
--   drop function if exists public.approved_timesheet_for_push(uuid, uuid);

create or replace function approved_timesheet_for_push(p_timesheet_id uuid, p_actor uuid default null)
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
  -- ⚑ Deliberately NOT a bare `is_active_member()` conjunct. That helper keys on `auth.uid()`, which is
  -- NULL on the service_role sweep path — conjoining it would refuse every sweep call and silently
  -- disable the backstop. So: check the RESOLVED actor's status (covers BOTH the JWT and the `p_actor`
  -- sweep path uniformly), and additionally require `is_active_member()` only when there IS a JWT
  -- caller, which is what brings in 0095's `banned_until` (raw-ban) check for that path.
  if v_actor_status is distinct from 'active' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.is_active_member() then
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

revoke all     on function approved_timesheet_for_push(uuid, uuid) from public;
grant  execute on function approved_timesheet_for_push(uuid, uuid) to   authenticated, service_role;
revoke execute on function approved_timesheet_for_push(uuid, uuid) from anon;
