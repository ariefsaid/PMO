-- 1564_timesheet_approval_route.sql — fix-waiting item 3: a submitted week names who it waits for.
-- REVERSE: supabase/migrations/rollback/1564_timesheet_approval_route_down.sql
--
-- ONE READ for ONE visible Submitted timesheet. It projects the approver population that the CURRENT
-- write authority, public.transition_timesheet (newest body 0855, plus the 1461 light-account guard),
-- already enforces for the approve/reject arm — it does not add, widen or change any write or approve
-- rule:
--   * owner SoD is excluded for EVERY role (even Admin), exactly as transition_timesheet refuses it first;
--   * the assigned line manager is eligible whenever the owner's RAW profiles.manager_id is non-null;
--   * Admin break-glass is always eligible, whether or not a manager is assigned;
--   * Executive is a fallback ONLY when the RAW manager_id is null. A non-null but inactive / missing /
--     cross-organisation manager does NOT open the Executive fallback (the 0855 comment: the fallback is
--     gated STRICTLY to a null manager);
--   * a light account (foreman / field_user, 1205) is never named: 1461 put assert_not_light() at the top
--     of transition_timesheet, so such a person cannot decide.
--
-- SECURITY INVOKER: the timesheet and every profile are read through the EXISTING RLS policies
-- (timesheets_select 0007 A2, profiles_select 0655). No definer bypass, no client org argument: an id the
-- caller cannot see, a foreign/cross-tenant id, and a sheet that is not Submitted all return the SAME
-- empty shape, so the read is not an existence oracle. A disabled caller is refused by the active-member
-- assert before any row is read.
--
-- The candidate rows are server-computed facts about THIS one sheet, never a client profile crawl: the
-- caller's org comes from the visible timesheet row, inactive profiles are not named, and only the
-- smallest projection needed by the sentence (id, full name, coarse role) leaves the database. Sorting is
-- deterministic (name, then id).
--
-- DELIBERATE LIMIT: profiles.status is the app-visible disabled state this invoker read can see. An
-- out-of-band auth.users.banned_until set without a status change is not readable by `authenticated`
-- (is_active_member(uuid) is revoked, and the definer actor_authorization_state is self-only). Such a
-- person is still refused by the write's active assert; this read can name their existing profile row.
-- The route never becomes the authority: transition_timesheet keeps deciding.

create function public.get_timesheet_approval_route(p_timesheet_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid         uuid := auth.uid();
  v_org         uuid;
  v_owner       uuid;
  v_status      public.timesheet_status;
  v_manager     uuid;
  v_route_kind  text;
  v_approvers   jsonb;
begin
  -- Active-caller assert before any read: a disabled/absent session gets the same refusal the write
  -- surface gives it, never a row-shaped answer.
  if v_uid is null or not coalesce(public.is_active_member(), false) then
    raise exception 'your account is not an active member of this organisation, so it cannot read an approval route'
      using errcode = '42501';
  end if;

  -- Existing RLS decides whether this sheet is visible at all. A hidden / foreign / nonexistent id leaves
  -- v_org null and returns the SAME empty shape as a non-Submitted sheet.
  select t.org_id, t.user_id, t.status
    into v_org, v_owner, v_status
    from public.timesheets t
   where t.id = p_timesheet_id;

  if v_org is null or v_status is distinct from 'Submitted' then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  -- The RAW manager assignment, exactly the value 0855 compares the caller against. profiles_select
  -- scopes this to the caller's organisation. If the owner's own profile is not visible, fail closed to
  -- the empty shape rather than treating "unknown" as "no manager" and inventing the Executive fallback.
  select p.manager_id into v_manager from public.profiles p where p.id = v_owner;
  if not found then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  v_route_kind := case when v_manager is null then 'admin_executive' else 'line_manager' end;

  with candidates as (
    -- Assigned manager: only when the raw assignment is non-null, active, in this organisation and not
    -- the owner (owner SoD). Never widened by a role.
    select p.id, p.full_name as name, 'line_manager'::text as role
      from public.profiles p
     where v_manager is not null
       and p.id = v_manager
       and p.org_id = v_org
       and p.status = 'active'
       and not public.is_light_role_key(p.built_in_role)   -- 1461: a light account cannot decide
       and p.id is distinct from v_owner
    union all
    -- Admin break-glass: ALWAYS eligible, also when a manager is assigned. The manager is not repeated.
    select p.id, p.full_name, p.role::text
      from public.profiles p
     where p.role = 'Admin'
       and p.org_id = v_org
       and p.status = 'active'
       and not public.is_light_role_key(p.built_in_role)   -- 1461: a light account cannot decide
       and p.id is distinct from v_owner
       and (v_manager is null or p.id is distinct from v_manager)
    union all
    -- Executive fallback: ONLY on a RAW null manager_id, never because the manager is inactive/missing.
    select p.id, p.full_name, p.role::text
      from public.profiles p
     where v_manager is null
       and p.role = 'Executive'
       and p.org_id = v_org
       and p.status = 'active'
       and not public.is_light_role_key(p.built_in_role)   -- 1461: a light account cannot decide
       and p.id is distinct from v_owner
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role)
                     order by lower(c.name) collate "C", c.id),
           '[]'::jsonb)
    into v_approvers
    from candidates c;

  return jsonb_build_object('approvers', v_approvers, 'route_kind', v_route_kind);
end $$;

revoke all on function public.get_timesheet_approval_route(uuid) from public, anon;
grant execute on function public.get_timesheet_approval_route(uuid) to authenticated;

comment on function public.get_timesheet_approval_route(uuid) is
  'fix-waiting item 3 (FR-WAIT-006): the approver population of ONE visible Submitted timesheet, '
  'projected exactly from transition_timesheet''s current approve/reject authority (0855 + the 1461 '
  'light-account guard): owner SoD excluded for every role; the raw assigned manager; Admin break-glass '
  'always; Executive only when the RAW manager_id is null; a light account excluded. SECURITY INVOKER so '
  'timesheets_select and profiles_select are the visibility boundary; no org_id argument. Returns '
  '{"approvers":[{"id","name","role"}],"route_kind":"line_manager"|"admin_executive"|"unavailable"}, '
  'deterministically ordered by name then id.';
