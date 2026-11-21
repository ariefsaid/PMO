-- 1292 — spend_approval_route_from_figures reads each approver list through spend_approvers_for_amount (#2695).
-- Spec: docs/specs/approval-amount-tiers.spec.md. Proven by supabase/tests/spend_approval_tiers.test.sql.
-- The body is 1016's with exactly the five `from public.spend_approvers sa` reads changed to the tier filter. With
-- tiers off the filter returns every row, so the route is unchanged. Rollback: rollback/1292_spend_route_tiers_down.sql.

create or replace function public.spend_approval_route_from_figures(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid,
  p_decider_id   uuid,
  p_submitted_at timestamptz,
  p_figures      jsonb
) returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_reason       text;
  v_budget       numeric;
  v_used         numeric;
  v_currency     text;
  v_foreign      boolean;
  v_rows         int;
  v_eligible     uuid[];
  v_version      uuid;
  v_activated_at timestamptz;
  v_p_rows       int;
  v_p_ids        uuid[];
  v_rec          jsonb;
begin
  if p_figures is null then
    raise exception 'spend_approval_route_from_figures requires figures' using errcode = '22004';
  end if;

  -- 1. Classify (DD-APR-2). A missing or negative amount can never be "within" (DD-APR-5).
  if p_project_id is null then
    v_reason := 'no_project';
  elsif p_category is null then
    v_reason := 'no_category';
  elsif p_amount is null or p_amount < 0 then
    v_reason := 'amount_invalid';
  else
    select v.id, v.currency, v.activated_at into v_version, v_currency, v_activated_at
      from public.budget_versions v
     where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active';
    if not found then
      v_reason := 'no_active_budget';
    else
      select coalesce(sum(li.budgeted_amount), 0) into v_budget
        from public.budget_line_items li
        join public.budget_versions v on v.id = li.budget_version_id
       where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active'
         and li.category = p_category;
      if p_currency is distinct from v_currency then
        v_reason := 'currency_mismatch';
      elsif not (public.is_active_member() and public.holds_spend_approval_authority(public.auth_role())) then
        v_reason := 'spending_not_visible';
      else
        v_rec := p_figures->'recorded'->(p_category::text);
        -- Line used = recorded spending + reserved + open orders + claims not in recorded spending.
        v_used := (v_rec->>'amount')::numeric + (p_figures->>'other_used')::numeric;
        v_foreign := coalesce((p_figures->>'foreign')::boolean, false);
        -- Explicit `<=` for "within": anything not provably within (a NULL included) is not within.
        if not (p_figures ? 'basis') or not (p_figures ? 'other_used') then
          v_reason := 'spending_unknown';
        elsif (p_figures->>'ledger_currency') is distinct from v_currency or v_foreign
              or coalesce((p_figures->>'proj_foreign')::boolean, false) then
          v_reason := 'currency_mismatch';
        elsif (v_rec->>'mapped')::boolean is not true or v_used is null
              or (p_figures->>'proj_budget') is null or (p_figures->>'proj_spent') is null
              or (p_figures->>'proj_open') is null then
          v_reason := 'spending_unknown';
        elsif not (v_used + p_amount <= v_budget) then
          v_reason := 'exceeds_line';
        elsif (p_figures->>'proj_budget')::numeric - (p_figures->>'proj_spent')::numeric
              - (p_figures->>'proj_open')::numeric - (p_figures->>'proj_reserved')::numeric - p_amount < 0 then
          v_reason := 'exceeds_project';
        elsif (p_submitted_at is not null and v_activated_at > p_submitted_at)
           -- DD-APR-3: the budget the request fits must not have been set by the decider, or after submission.
           or (p_decider_id is not null and exists (
                 select 1 from public.audit_events a
                  where a.org_id = p_org_id and a.entity_id = v_version
                    and a.action = 'budget_version.update'
                    and a.detail->>'to_status' = 'Active'
                    and a.detail->>'from_status' is distinct from 'Active'
                    and a.actor_id = p_decider_id))
        then
          v_reason := 'budget_changed';
        else
          v_reason := 'within_budget';
        end if;
      end if;
    end if;
  end if;

  -- 1b. Below approval rank: no figures; everyone who could decide (the project's approvers and the senior set).
  if v_reason = 'spending_not_visible' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_p_rows, v_p_ids
      from public.spend_approvers_for_amount(p_org_id, p_project_id, p_amount, p_currency) sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers_for_amount(p_org_id, null::uuid, p_amount, p_currency) sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id is null;
    -- No project approver → flat. A project approver but no senior set → the project's approvers alone (the
    -- senior outcome falls to them, never wider); nobody eligible → an Admin. Both configured → both sets together.
    if v_p_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], null::numeric, null::numeric;
      return;
    elsif v_rows = 0 then
      if cardinality(v_p_ids) > 0 then
        return query select 'project'::text, v_reason, v_p_ids, null::numeric, null::numeric;
      else
        return query select 'admin'::text, v_reason, '{}'::uuid[], null::numeric, null::numeric;
      end if;
      return;
    end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v_eligible from unnest(v_p_ids || v_eligible) x;
    if cardinality(v_eligible) > 0 then
      return query select 'org'::text, v_reason, v_eligible, null::numeric, null::numeric;
    else
      return query select 'admin'::text, v_reason, '{}'::uuid[], null::numeric, null::numeric;
    end if;
    return;
  end if;

  -- 2. Within budget → the project's approvers (FR-APR-012/013/014).
  if v_reason = 'within_budget' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers_for_amount(p_org_id, p_project_id, p_amount, p_currency) sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    if v_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;  -- unconfigured
      return;
    elsif cardinality(v_eligible) > 0 then
      return query select 'project'::text, v_reason, v_eligible, v_budget, v_used;
      return;
    end if;
    -- configured, nobody eligible → escalate to the senior set (FR-APR-014)
  end if;

  -- 3. The senior set (FR-APR-012/015). DD-APR-4: the flat matrix applies only when no senior set is
  -- configured at all; a configured set with nobody eligible leaves the decision to an Admin.
  select count(*),
         coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_rows, v_eligible
    from public.spend_approvers_for_amount(p_org_id, null::uuid, p_amount, p_currency) sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id is null;
  if cardinality(v_eligible) > 0 then
    return query select 'org'::text, v_reason, v_eligible, v_budget, v_used;
    return;
  elsif v_rows > 0 then
    return query select 'admin'::text, v_reason, '{}'::uuid[], v_budget, v_used;
    return;
  end if;
  -- No senior set: the senior outcome falls to the project's named approvers, never to everyone; flat only when the
  -- project has none either. Nobody eligible among them → an Admin.
  select count(*),
         coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_p_rows, v_p_ids
    from public.spend_approvers_for_amount(p_org_id, p_project_id, p_amount, p_currency) sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id = p_project_id;
  if v_p_rows > 0 then
    if cardinality(v_p_ids) > 0 then
      return query select 'project'::text, v_reason, v_p_ids, v_budget, v_used;
    else
      return query select 'admin'::text, v_reason, '{}'::uuid[], v_budget, v_used;
    end if;
    return;
  end if;
  return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;
end; $$;
revoke all on function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb) to authenticated;
comment on function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb) is
  'DISPLAY ONLY. The route logic over figures read once for a list (get_procurement_approval_routes, get_expense_claim_approval_routes). It reads no spending figure itself and decides who may see figures from the caller''s real rank. Every decision, notification and eligibility check calls spend_approval_route, which reads its own figures.';
