-- 1565_equipment_plan_approval_route.sql — fix-waiting item 3 for the monthly equipment plan: the plan screen can say
-- who a Submitted plan waits for, from the database's own route, instead of the bare "Waiting for approval".
--
-- One READ, no new rule: get_equipment_plan_approval_route(plan) returns
--   {approvers: [{id, name, role}], route_kind} with route_kind one of
--   'project' | 'org' | 'admin' | 'senior_role' (a configured route that has somebody),
--   'disabled' | 'not_waiting' | 'unavailable' (an honest empty).
--
-- It mirrors equipment_plan_approver_ok (1358, the only definition; no later migration restates it) EXACTLY, because that
-- is the function that decides, and this one must never answer with a different route or a stricter one:
--   * the organisation switch must be on, and the author is out while allow_self_approval is off — every role, Admin included;
--   * approval_step 'senior_role' → anyone whose role holds spend-approval authority;
--   * otherwise the project's spend_approvers list when that level has an eligible (active, rank-holding) member,
--     else the organisation's senior set when that level has one, else an Admin (DD-APR-4).
-- ⚑ The level that answers is chosen by an ELIGIBLE member (the helper's `v_has`), but the level then decides by its RAW
-- list: a listed person whose role changed away from spend authority still decides. So a candidate here is the raw list
-- row whose person can reach the decision at all (same organisation, profile active), never a re-application of the rank
-- test — re-applying it would invent a stricter route than the decision function has.
-- The route names nobody when the elected level has no reachable person (only the author, everybody inactive): an honest
-- empty, NOT a fallback to the senior set or an Admin, which would change who decides.
--
-- Visibility is the plan's OWN row-level policy, first: the function is SECURITY INVOKER, so a plan of another
-- organisation, or one this account may not read, is simply not there, and a plan id that does not exist answers the same.
-- No organisation is ever passed in. The caller gates are the 1209 read-side pair (an active member, not a light account),
-- asked directly because an invoker body cannot call assert_is_active_member/assert_not_light (both are revoked from
-- authenticated; calling them here would be a privilege error, not a guard).
--
-- What it reads that an invoker can read: equipment_plans, org_equipment_plan_settings, spend_approvers and profiles are
-- all readable to an active member of the organisation; holds_spend_approval_authority is granted to authenticated.
-- A candidate's "active" is profiles.status — the same rule admin_set_user_status keeps in step with auth.users.banned_until
-- (an app-disabled account reads 'disabled'). auth.users is not readable to an invoker function, so a ban written straight
-- into GoTrue without the app's own status change is the one state this read cannot see; the decision function still
-- refuses that person (its own gate), so in that one out-of-band case the route could name someone who cannot approve.
--
-- ⚑ Mutation plan (NOT executed here — the owner batch runs the gates): delete the `status is distinct from 'Submitted'`
-- return and the 'not_waiting' tests go red; delete `and (v_set.allow_self_approval or pf.id is distinct from v_plan.created_by)`
-- from a candidate branch and its self-approval test goes red; change the plan lookup to `security definer` and the foreign
-- organisation / unknown-id tests go red (a plan the caller may not see becomes visible). Proven by
-- supabase/tests/1565_equipment_plan_approval_route.test.sql.
--
-- REVERSE: supabase/migrations/rollback/1565_equipment_plan_approval_route_down.sql

create function public.get_equipment_plan_approval_route(p_plan_id uuid) returns jsonb
  language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid := public.auth_org_id();
  v_plan public.equipment_plans%rowtype;
  v_set  public.org_equipment_plan_settings%rowtype;
  v_kind text;
  v_approvers jsonb;
begin
  -- The same caller gate the decision function opens with. Asserted, not assumed: an account that is not an active member
  -- is told so rather than shown "nobody approves", which would read as a configured route with no approvers.
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false) then
    raise exception 'EQP_DENIED: your account cannot read who approves this plan' using errcode = '42501';
  end if;

  -- The 1209 read-side convention: a light (field) account has one phone home screen and reads no list. assert_not_light
  -- is itself not executable by authenticated and this body runs as the caller, so ask its question directly.
  if public.actor_is_light() then
    raise exception 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this' using errcode = '42501';
  end if;

  -- EXISTING record visibility decides first (RLS: organisation, active member, the reader's role, the author, an Engineer
  -- on the project). Nothing new is granted here, and nothing is revealed about a plan the caller may not read.
  select * into v_plan from public.equipment_plans where id = p_plan_id;
  if not found then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  select * into v_set from public.org_equipment_plan_settings where org_id = v_org;
  if not found or not v_set.enabled then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'disabled');
  end if;

  -- Only a Submitted plan is waiting. Any other status has nobody to wait for; its own status line already says where it is.
  if v_plan.status is distinct from 'Submitted' then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'not_waiting');
  end if;

  if v_set.approval_step = 'senior_role' then
    select coalesce(jsonb_agg(jsonb_build_object('id', pf.id, 'name', pf.full_name, 'role', pf.role::text)
                              order by pf.full_name, pf.id), '[]'::jsonb)
      into v_approvers
      from public.profiles pf
     where pf.org_id = v_org
       and pf.status = 'active'
       and public.holds_spend_approval_authority(pf.role)
       and (v_set.allow_self_approval or pf.id is distinct from v_plan.created_by);
    return jsonb_build_object('approvers', v_approvers, 'route_kind', 'senior_role');
  end if;

  -- spend_approvers, exactly as the decision function chooses the level: the project's list when it holds an eligible
  -- member (active profile, spend rank — the helper's v_has), else the organisation's senior set when it does, else an Admin.
  if exists (select 1 from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
              where sa.org_id = v_org and sa.project_id = v_plan.project_id and pf.status = 'active'
                and public.holds_spend_approval_authority(pf.role)) then
    v_kind := 'project';
    select coalesce(jsonb_agg(jsonb_build_object('id', pf.id, 'name', pf.full_name, 'role', pf.role::text)
                              order by pf.full_name, pf.id), '[]'::jsonb)
      into v_approvers
      from public.spend_approvers sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = v_org and sa.project_id = v_plan.project_id
       and pf.org_id = v_org and pf.status = 'active'
       and (v_set.allow_self_approval or pf.id is distinct from v_plan.created_by);
  elsif exists (select 1 from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
                 where sa.org_id = v_org and sa.project_id is null and pf.status = 'active'
                   and public.holds_spend_approval_authority(pf.role)) then
    v_kind := 'org';
    select coalesce(jsonb_agg(jsonb_build_object('id', pf.id, 'name', pf.full_name, 'role', pf.role::text)
                              order by pf.full_name, pf.id), '[]'::jsonb)
      into v_approvers
      from public.spend_approvers sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = v_org and sa.project_id is null
       and pf.org_id = v_org and pf.status = 'active'
       and (v_set.allow_self_approval or pf.id is distinct from v_plan.created_by);
  else
    v_kind := 'admin';
    select coalesce(jsonb_agg(jsonb_build_object('id', pf.id, 'name', pf.full_name, 'role', pf.role::text)
                              order by pf.full_name, pf.id), '[]'::jsonb)
      into v_approvers
      from public.profiles pf
     where pf.org_id = v_org
       and pf.role = 'Admin'
       and pf.status = 'active'
       and (v_set.allow_self_approval or pf.id is distinct from v_plan.created_by);
  end if;

  return jsonb_build_object('approvers', v_approvers, 'route_kind', v_kind);
end $$;

comment on function public.get_equipment_plan_approval_route(uuid) is
  'DISPLAY ONLY — the people a Submitted equipment plan waits for, from equipment_plan_approver_ok''s own route '
  '(1358: the organisation switch, the author out while self-approval is off, the senior-role step, else the project senior '
  'set, else the organisation''s, else an Admin). SECURITY INVOKER: the plan''s own row-level policy decides whether there '
  'is a plan to answer about. It decides nothing and writes nothing; the approve and reject functions remain the authority.';

revoke all on function public.get_equipment_plan_approval_route(uuid) from public, anon, authenticated;
grant execute on function public.get_equipment_plan_approval_route(uuid) to authenticated;
