-- 1568_imprest_requester_route.sql — the requester's next-decision actor for ONE site-cash record (#1568 cash closure).
-- Spec: docs/specs/waiting-list.spec.md FR-WAIT-006 ("from the route the database computed"); the authority each
-- kind mirrors is named below and is NOT re-implemented here:
--   plan         transition_imprest_plan (0534:1115, route block :1197-1217) per line via
--                spend_approval_route (1016/1292) + spend_approvers_for_amount amount tiers (1291/1290)
--   limit_change decide_imprest_float_change (0534:1067) via imprest_senior_route (0422:44-53)
--   replenishment transition_imprest_replenishment (0855:407-450) — Finance/Admin; approve and pay are different
--                actors (pay excludes the requester, the custodian and the prior approver)
--
-- Shape (jsonb/JSON): { route_kind: 'named'|'flat'|'admin'|'finance_admin'|'unavailable',
--                       approvers: [{ id, name, role }], action: 'approve'|'pay'|null,
--                       admin_breakglass: boolean }
--   named         the exact people the database route names for this record, after the author/custodian/proposer
--                 exclusions; the INTERSECTION across every plan line, never the notification union.
--                 admin_breakglass is true only when a distinct, eligible, active full Admin exists — the write lets
--                 an Admin break-glass every line but never past its SoD refusals, so no Admin is ever fabricated.
--   flat          every line is the flat matrix (any approval-rank holder); no person is named
--   admin         the next decision is an Admin's (an admin-only line, or the configured set has nobody else
--                 eligible) AND an eligible active full Admin other than the record's excluded parties exists;
--                 otherwise `unavailable`
--   finance_admin Finance or Admin (replenishment); for the pay step `approvers` names the eligible payers
--   unavailable   the caller may not be told (not approval rank / record not visible), or nobody is eligible.
--                 Never the low-rank `spending_not_visible` union, and never a fabricated fallback person.
--
-- Rules kept:
--   * SECURITY DEFINER is required only because imprest_senior_route is revoked from authenticated and the plan route
--     must be readable when the caller is the author/custodian. It NEVER fakes auth: auth.uid()/auth_role() stay the
--     real caller's, so spend_approval_route reads figures on the caller's own rank (a below-rank caller is answered
--     'unavailable', not the union).
--   * Caller gate FIRST: active member, non-light (1209 convention), approval rank (the imprest read policies' own
--     predicate), then the record in the caller's org and a live float. Nothing is resolved before that.
--   * The read's own candidate filters use the resolved-actor rule the decision gate uses (`is_active_member(id)`:
--     status AND auth.users.banned_until) plus `profile_seat_type(id) <> 'light'`, on already record+org-scoped
--     candidates. This makes the read narrower than the route helpers; it changes no helper, tier or write rule.
--   * No figures, no amount, no budget category and no per-line routing detail leave this function: names only.
--   * budget_changed (DD-APR-3) is mirrored with the notification's p_decider_id = null facts; a named approver who
--     activated the active budget can still be refused at decision time. "Who next" is the next legal DECISION
--     (approve or reject), never a promise that approval will pass: a month-ended or over-ceiling plan can still be
--     rejected by its routed decider (0534:1138, :1193-1199), so those legal paths are preserved, not hidden.
-- Reads only: no table, policy or write change. REVERSE: rollback/1568_imprest_requester_route_down.sql

create function public.get_imprest_requester_route(p_kind text, p_record_id text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org        uuid := public.auth_org_id();
  v_role       user_role := public.auth_role();
  v_kind       text := lower(btrim(coalesce(p_kind, '')));
  v_id         uuid;
  v_empty      json := json_build_object('route_kind', 'unavailable', 'approvers', '[]'::json, 'action', null,
                                         'admin_breakglass', false);
  v_plan       public.imprest_plans%rowtype;
  v_float      public.imprest_floats%rowtype;
  v_change     public.imprest_float_changes%rowtype;
  v_rep        public.imprest_replenishments%rowtype;
  v_line       record;
  v_route      record;
  v_named      uuid[];
  v_any_named  boolean := false;
  v_admin_only boolean := false;
  v_admin_ok   boolean := false;
  v_approvers  json;
  v_count      int;
  v_exclude    uuid[];
begin
  -- 1. The caller: active, not a light account, and an approval-rank member (the imprest SELECT policies' predicate).
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  if v_org is null or not public.holds_spend_approval_authority(v_role) then
    return v_empty;
  end if;
  if v_kind not in ('plan', 'limit_change', 'replenishment') then
    return v_empty;
  end if;
  begin
    v_id := p_record_id::uuid;
  exception when others then
    return v_empty;
  end;
  if v_id is null then
    return v_empty;
  end if;

  -- ── plan: Submitted only; per-line route, then the eligible intersection ───────────────────────────────────────
  if v_kind = 'plan' then
    select p.* into v_plan
      from public.imprest_plans p
     where p.id = v_id and p.org_id = v_org;
    if not found or v_plan.status <> 'Submitted' then
      return v_empty;
    end if;
    select f.* into v_float
      from public.imprest_floats f
     where f.id = v_plan.float_id and f.org_id = v_org;
    if not found or v_float.archived_at is not null then
      return v_empty;
    end if;

    -- Does a distinct, active, full Admin exist that the write would NOT refuse for SoD?
    select exists (
      select 1 from public.profiles pf
       where pf.org_id = v_org and pf.role = 'Admin'
         and public.is_active_member(pf.id)
         and public.profile_seat_type(pf.id) <> 'light'
         and pf.id is distinct from v_plan.author_id
         and pf.id is distinct from v_float.custodian_id)
      into v_admin_ok;

    for v_line in
      select l.budget_category, l.planned_amount
        from public.imprest_plan_lines l
       where l.plan_id = v_id and l.org_id = v_org
       order by l.budget_category
    loop
      select * into v_route
        from public.spend_approval_route(v_org, v_float.project_id, v_line.budget_category,
               v_line.planned_amount, v_float.currency, v_plan.author_id, null, v_plan.submitted_at);
      if v_route.route is null then
        return v_empty;
      end if;
      -- The caller is approval rank, so the figure-gated branch must not appear; if it ever does, never show its union.
      if v_route.reason = 'spending_not_visible' then
        return v_empty;
      end if;
      if v_route.route = 'admin' then
        v_admin_only := true;
      elsif v_route.route = 'flat' then
        null;  -- any approval-rank holder satisfies a flat line (the named sets below already hold that rank)
      else
        v_any_named := true;
        if v_named is null then
          v_named := v_route.approver_ids;
        else
          v_named := array(select unnest(v_named) intersect select unnest(v_route.approver_ids));
        end if;
      end if;
    end loop;

    if v_admin_only then
      if not v_admin_ok then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'admin', 'approvers', '[]'::json, 'action', 'approve',
                               'admin_breakglass', false);
    end if;

    if not v_any_named then
      -- Every line is flat: any active full approval-rank holder may decide, except the author and the custodian.
      select count(*) into v_count
        from public.profiles pf
       where pf.org_id = v_org
         and public.is_active_member(pf.id)
         and public.profile_seat_type(pf.id) <> 'light'
         and public.holds_spend_approval_authority(pf.role)
         and pf.id is distinct from v_plan.author_id and pf.id is distinct from v_float.custodian_id;
      if v_count = 0 then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'flat', 'approvers', '[]'::json, 'action', 'approve',
                               'admin_breakglass', false);
    end if;

    -- The intersection, minus the two people the decision gate always refuses (author, custodian).
    select coalesce(array_agg(distinct x), '{}') into v_named
      from unnest(coalesce(v_named, '{}')) x
     where x is distinct from v_plan.author_id and x is distinct from v_float.custodian_id;
    if cardinality(v_named) = 0 then
      if not v_admin_ok then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'admin', 'approvers', '[]'::json, 'action', 'approve',
                               'admin_breakglass', false);
    end if;
    select coalesce(json_agg(json_build_object('id', pf.id, 'name', pf.full_name, 'role', pf.role::text)
                             order by pf.full_name), '[]'::json)
      into v_approvers
      from public.profiles pf
     where pf.id = any(v_named) and pf.org_id = v_org
       and public.is_active_member(pf.id)
       and public.profile_seat_type(pf.id) <> 'light';
    if json_array_length(v_approvers) = 0 then
      if not v_admin_ok then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'admin', 'approvers', '[]'::json, 'action', 'approve',
                               'admin_breakglass', false);
    end if;
    return json_build_object('route_kind', 'named', 'approvers', v_approvers, 'action', 'approve',
                             'admin_breakglass', v_admin_ok);
  end if;

  -- ── limit_change: Proposed only; the named senior set, or the Admin fallback ───────────────────────────────────
  if v_kind = 'limit_change' then
    select c.* into v_change
      from public.imprest_float_changes c
     where c.id = v_id and c.org_id = v_org;
    if not found or v_change.status <> 'Proposed' then
      return v_empty;
    end if;
    select f.* into v_float
      from public.imprest_floats f
     where f.id = v_change.float_id and f.org_id = v_org;
    if not found or v_float.archived_at is not null then
      return v_empty;
    end if;

    select exists (
      select 1 from public.profiles pf
       where pf.org_id = v_org and pf.role = 'Admin'
         and public.is_active_member(pf.id)
         and public.profile_seat_type(pf.id) <> 'light'
         and pf.id is distinct from v_change.proposed_by
         and pf.id is distinct from v_float.custodian_id)
      into v_admin_ok;

    select * into v_route
      from public.imprest_senior_route(v_org, v_change.proposed_by);
    if v_route.route is null then
      return v_empty;
    end if;
    -- The proposer is already excluded by imprest_senior_route; the custodian is refused by the decision gate.
    select coalesce(array_agg(distinct x), '{}') into v_named
      from unnest(coalesce(v_route.approver_ids, '{}')) x
     where x is distinct from v_change.proposed_by and x is distinct from v_float.custodian_id;
    if v_route.route = 'admin' or cardinality(v_named) = 0 then
      if not v_admin_ok then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'admin', 'approvers', '[]'::json, 'action', 'approve',
                               'admin_breakglass', false);
    end if;
    select coalesce(json_agg(json_build_object('id', pf.id, 'name', pf.full_name, 'role', pf.role::text)
                             order by pf.full_name), '[]'::json)
      into v_approvers
      from public.profiles pf
     where pf.id = any(v_named) and pf.org_id = v_org
       and public.is_active_member(pf.id)
       and public.profile_seat_type(pf.id) <> 'light';
    if json_array_length(v_approvers) = 0 then
      if not v_admin_ok then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'admin', 'approvers', '[]'::json, 'action', 'approve',
                               'admin_breakglass', false);
    end if;
    return json_build_object('route_kind', 'named', 'approvers', v_approvers, 'action', 'approve',
                             'admin_breakglass', v_admin_ok);
  end if;

  -- ── replenishment: Requested waits for approval; Approved (unpaid) waits for a payer ───────────────────────────
  if v_kind = 'replenishment' then
    select r.* into v_rep
      from public.imprest_replenishments r
     where r.id = v_id and r.org_id = v_org;
    if not found then
      return v_empty;
    end if;
    select f.* into v_float
      from public.imprest_floats f
     where f.id = v_rep.float_id and f.org_id = v_org;
    if not found or v_float.archived_at is not null then
      return v_empty;
    end if;

    if v_rep.status = 'Requested' then
      -- Approval: Finance or Admin, never the requester or the custodian (0855:450). Role text, as before.
      v_exclude := array_remove(array[v_rep.requested_by, v_float.custodian_id], null);
      select count(*) into v_count
        from public.profiles pf
       where pf.org_id = v_org and pf.role in ('Finance', 'Admin')
         and public.is_active_member(pf.id)
         and public.profile_seat_type(pf.id) <> 'light'
         and pf.id <> all(v_exclude);
      if v_count = 0 then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'finance_admin', 'approvers', '[]'::json, 'action', 'approve',
                               'admin_breakglass', false);
    elsif v_rep.status = 'Approved' then
      -- Payment is a different actor: Finance/Admin, never the requester, the custodian or the prior approver.
      v_exclude := array_remove(array[v_rep.requested_by, v_float.custodian_id, v_rep.approved_by], null);
      select coalesce(json_agg(json_build_object('id', pf.id, 'name', pf.full_name, 'role', pf.role::text)
                               order by pf.full_name), '[]'::json)
        into v_approvers
        from public.profiles pf
       where pf.org_id = v_org and pf.role in ('Finance', 'Admin')
         and public.is_active_member(pf.id)
         and public.profile_seat_type(pf.id) <> 'light'
         and pf.id <> all(v_exclude);
      if json_array_length(v_approvers) = 0 then
        return v_empty;
      end if;
      return json_build_object('route_kind', 'finance_admin', 'approvers', v_approvers, 'action', 'pay',
                               'admin_breakglass', false);
    end if;
    return v_empty;
  end if;

  return v_empty;
end; $$;
revoke all on function public.get_imprest_requester_route(text, text) from public, anon;
grant execute on function public.get_imprest_requester_route(text, text) to authenticated;
comment on function public.get_imprest_requester_route(text, text) is
  'FR-WAIT-006 next-decision actor for one site-cash record. Mirrors transition_imprest_plan (per-line intersection), '
  'decide_imprest_float_change (imprest_senior_route) and transition_imprest_replenishment (Finance/Admin; pay excludes '
  'requester, custodian and prior approver). Names only, never amounts, categories or routing detail; a below-rank or '
  'invisible caller is answered unavailable, never the spending_not_visible union. The Admin fallback is returned only '
  'when an eligible active full Admin exists after the author/custodian/proposer exclusions; a named route reports the '
  'true Admin break-glass alternative in admin_breakglass.';
