-- 1567_dsr_validation_route.sql — fix-waiting item 3 (FR-WAIT-006): a Submitted site report says who it waits for.
-- REVERSE: supabase/migrations/rollback/1567_dsr_validation_route_down.sql
--
-- ONE READ for ONE visible Submitted report. It projects the population that the CURRENT write authority
-- (1041 dsr_may_validate + dsr_validate, plus the 1530/1461 light-account guard on dsr_validate) already
-- lets validate — it does not add, widen or change any write, approval or SoD rule:
--   * the AUTHOR is excluded for every role: dsr_validate refuses the author first (FR-DSR-015, ADR-0019);
--   * the assigned project manager is named ONLY when that profile is a real 'Project Manager', active,
--     not a light account (foreman / field_user, 1205) and not the author — the exact dsr_may_validate
--     conditions, which require auth_role() = 'Project Manager' AND projects.project_manager_id = auth.uid();
--   * Admin and Finance stay TRUE role-level alternatives for every other person in the organisation
--     (dsr_may_validate admits either role), and only the role words are spoken for them: the screen never
--     needs a people list, so this read returns no Admin/Finance names;
--   * when no eligible Admin/Finance exists besides the author, the route says so ('nobody') instead of
--     claiming a decider who is not there.
--
-- SECURITY INVOKER: the report, the project and the profiles are read through the EXISTING RLS policies
-- (daily_site_reports_select 1040, projects_select 0646, profiles_select 0655). No definer bypass, no
-- client org argument: an id the caller cannot see, a foreign/cross-tenant id and a report that is not
-- Submitted all return the SAME empty shape, so the read is not an existence oracle. A disabled session is
-- refused by the active-caller assert before any row is read. The caller's organisation comes from the
-- visible report row, never from the client.
--
-- DELIBERATE LIMIT: profiles.status is the app-visible disabled state this invoker read can see. An
-- out-of-band auth.users.banned_until set without a status change is not readable by `authenticated`
-- (is_active_member(uuid) is revoked, and the definer actor_authorization_state is self-only). Such a
-- person is still refused by dsr_validate's own active assert; this read can name their existing profile
-- row. The route never becomes the authority: dsr_validate keeps deciding.
--
-- This is the reviewer's minimum projection (docs/private/build-1215/deepseek-review-requester-ui-seam.md
-- §5.1), expressed as SECURITY INVOKER over the policies that already bound the same rows.

create function public.get_dsr_validation_route(p_report_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid           uuid := auth.uid();
  v_org           uuid;
  v_author        uuid;
  v_status        text;
  v_project       uuid;
  v_pm            uuid;
  v_pm_found      boolean := false;
  v_pm_name       text;
  v_pm_role       public.user_role;
  v_pm_active     boolean := false;
  v_pm_light      boolean := true;   -- fail closed: an unknown seat type is never named
  v_finance_admin boolean;
begin
  -- Active-caller assert before any read: a disabled/absent session gets the same refusal the write
  -- surface gives it, never a row-shaped answer.
  if v_uid is null or not coalesce(public.is_active_member(), false) then
    raise exception 'your account is not an active member of this organisation, so it cannot read a validation route'
      using errcode = '42501';
  end if;

  -- Existing RLS decides whether this report is visible at all. A hidden / foreign / nonexistent id leaves
  -- v_org null and returns the SAME empty shape as a report that is not Submitted.
  select r.org_id, r.author_id, r.status, r.project_id
    into v_org, v_author, v_status, v_project
    from public.daily_site_reports r
   where r.id = p_report_id;

  if v_org is null or v_status is distinct from 'submitted' then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  -- The project row, through projects_select. If it is not visible (it never should be for a visible
  -- report) fail closed rather than treat "unknown" as "no project manager".
  select p.project_manager_id into v_pm
    from public.projects p
   where p.id = v_project and p.org_id = v_org;
  if not found then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  -- The assignment is a raw profiles id; eligibility is decided by the profile's ACTUAL role/status, never
  -- by the mere presence of a name in a project DTO.
  if v_pm is not null then
    select pr.full_name, pr.role, (pr.status = 'active'), public.is_light_role_key(pr.built_in_role)
      into v_pm_name, v_pm_role, v_pm_active, v_pm_light
      from public.profiles pr
     where pr.id = v_pm and pr.org_id = v_org;
    v_pm_found := found;
  end if;

  if v_pm_found
     and v_pm_role = 'Project Manager'
     and v_pm_active
     and not v_pm_light
     and v_pm is distinct from v_author
     and btrim(coalesce(v_pm_name, '')) <> '' then
    return jsonb_build_object(
      'approvers', jsonb_build_array(
        jsonb_build_object('id', v_pm, 'name', v_pm_name, 'role', v_pm_role::text)),
      'route_kind', 'project_manager');
  end if;

  -- Admin/Finance remain genuine role-level alternatives: dsr_may_validate admits either role, and the
  -- author is refused by dsr_validate. Only existence is decided here — no people are named.
  select exists (
    select 1
      from public.profiles pr
     where pr.org_id = v_org
       and pr.status = 'active'
       and pr.role in ('Admin', 'Finance')
       and not public.is_light_role_key(pr.built_in_role)
       and pr.id <> v_author)
    into v_finance_admin;

  return jsonb_build_object(
    'approvers', '[]'::jsonb,
    'route_kind', case when v_finance_admin then 'finance_admin' else 'nobody' end);
end $$;

revoke all on function public.get_dsr_validation_route(uuid) from public, anon;
grant execute on function public.get_dsr_validation_route(uuid) to authenticated;

comment on function public.get_dsr_validation_route(uuid) is
  'fix-waiting item 3 (FR-WAIT-006): the validator population of ONE visible Submitted site report, '
  'projected exactly from dsr_may_validate + dsr_validate (1041) with the 1530/1461 light-account guard: '
  'the author is excluded for every role; the assigned project manager is named only when the profile is '
  'a real Project Manager, active, not light and not the author; Admin/Finance stay true role-level '
  'alternatives and nobody else can validate is reported as ''nobody''. SECURITY INVOKER so '
  'daily_site_reports_select, projects_select and profiles_select are the visibility boundary; no org_id '
  'argument. Returns {"approvers":[{"id","name","role"}],"route_kind":"project_manager"|"finance_admin"|"nobody"|"unavailable"}.';
