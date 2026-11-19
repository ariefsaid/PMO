-- 0953_spend_route_recorded_spending_down.sql — restore the 0247 spend_approval_route, the 0724 get_procurement_approval_routes and the 0426 get_expense_claim_approval_routes (function text verbatim), then drop the 0953 functions.

create or replace function public.spend_approval_route(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid,
  p_decider_id   uuid        default null,
  p_submitted_at timestamptz default null
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
begin
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
      -- Reserved (ADR-0034) ∪ Committed (OD-BUDGET-2) on this line. The request being decided is
      -- 'Requested', so it is never in its own sum. DD-APR-5: each request counts at least zero, so a
      -- negative row that predates the CHECKs cannot make room on the line.
      select coalesce(sum(greatest(0, pr.total_value,
               coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = pr.id), 0))), 0),
             coalesce(bool_or(pr.currency is distinct from v_currency), false)
        into v_used, v_foreign
        from public.procurements pr
       where pr.org_id = p_org_id and pr.project_id = p_project_id and pr.budget_category = p_category
         and pr.status in ('Approved','Vendor Quoted','Quote Selected','Ordered','Received','Vendor Invoiced','Paid');
      -- 0247 (#775, DD-EXP-2): approved and paid expense CLAIMS on this line are spend too. Advances are not:  -- 0247
      -- cash in custody is not cost, and counting it and the claims that settle it would count twice.          -- 0247
      -- The claim being decided is 'Submitted', so it is never in its own sum.                                  -- 0247
      select v_used + coalesce(sum(greatest(0, c.amount)), 0),                                                  -- 0247
             v_foreign or coalesce(bool_or(c.currency is distinct from v_currency), false)                      -- 0247
        into v_used, v_foreign                                                                                   -- 0247
        from public.expense_claims c                                                                             -- 0247
       where c.org_id = p_org_id and c.project_id = p_project_id and c.budget_category = p_category              -- 0247
         and c.kind = 'claim' and c.status in ('Approved','Paid');                                               -- 0247
      -- Explicit `<=` for "within": anything not provably within (a NULL included) is not within.
      if p_currency is distinct from v_currency or v_foreign then
        v_reason := 'currency_mismatch';
      elsif v_used + p_amount <= v_budget then
        -- DD-APR-3: the budget the request fits must not have been set by the decider, or after submission.
        if (p_submitted_at is not null and v_activated_at > p_submitted_at)
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
      else
        v_reason := 'exceeds_line';
      end if;
    end if;
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
      from public.spend_approvers sa
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
    from public.spend_approvers sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id is null;
  if cardinality(v_eligible) > 0 then
    return query select 'org'::text, v_reason, v_eligible, v_budget, v_used;
    return;
  elsif v_rows > 0 then
    return query select 'admin'::text, v_reason, '{}'::uuid[], v_budget, v_used;
    return;
  end if;
  return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;
end; $$;
revoke all on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) to authenticated;

create or replace function public.get_procurement_approval_routes(p_ids uuid[])
returns table (procurement_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with req as materialized (
    select p.id, p.org_id, p.project_id, p.budget_category, p.currency, p.requested_by_id, p.total_value
      from public.procurements p
     where p.id = any (p_ids) and p.status = 'Requested'
  ), it as materialized (
    select i.procurement_id, sum(i.amount) as total, bool_or(i.amount < 0) as has_negative
      from public.procurement_items i
     where i.procurement_id in (select id from req)
     group by i.procurement_id
  ), ev as materialized (
    select e.procurement_id, max(e.created_at) as submitted_at
      from public.procurement_status_events e
     where e.to_status = 'Requested' and e.procurement_id in (select id from req)
     group by e.procurement_id
  )
  select req.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (r.approver_ids)), '[]'::jsonb),
         a.amount, r.line_budget, r.line_used
    from req
    left join it on it.procurement_id = req.id
    left join ev on ev.procurement_id = req.id
    -- Same CASE as procurement_request_amount (0243): a negative header or line is untrustworthy -> NULL.
    cross join lateral (select case when req.total_value < 0 or coalesce(it.has_negative, false) then null
                                    else greatest(req.total_value, coalesce(it.total, 0)) end as amount) a
    -- Decider = the viewer, unless the viewer is the requester (who never decides: SoD-a).
    cross join lateral public.spend_approval_route(req.org_id, req.project_id, req.budget_category,
                                                   a.amount, req.currency, req.requested_by_id,
                                                   nullif(auth.uid(), req.requested_by_id),
                                                   ev.submitted_at) r
$$;

create or replace function public.get_expense_claim_approval_routes(p_ids uuid[])
returns table (claim_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric, is_exception boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with base as (
    select c.id, c.org_id, c.claimant_id, c.amount, r.route as p_route, r.reason, r.approver_ids, r.line_budget, r.line_used,
           (c.imprest_float_id is not null and public.holds_spend_approval_authority(public.auth_role())
            and c.amount > public.imprest_remaining(c.imprest_float_id, c.imprest_month, c.budget_category)) as exc,
           (select pl.approved_by from public.imprest_plans pl
             where pl.float_id = c.imprest_float_id and pl.month = c.imprest_month and pl.status = 'Approved') as plan_by
      from public.expense_claims c
      cross join lateral public.spend_approval_route(c.org_id, c.project_id, c.budget_category, c.amount, c.currency,
                                                     c.claimant_id, nullif(auth.uid(), c.claimant_id), c.submitted_at) r
     where c.id = any (p_ids) and c.status = 'Submitted'),
  routed as (
    select b.*, case when b.exc then s.ids else b.approver_ids end as ids
      from base b
      left join lateral (
        select coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
                 where sa.profile_id is distinct from b.claimant_id and sa.profile_id is distinct from b.plan_by
                   and pf.status = 'active' and pf.org_id = b.org_id and public.holds_spend_approval_authority(pf.role)), '{}') as ids
          from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
         where sa.org_id = b.org_id and sa.project_id is null) s on b.exc)
  select b.id,
         case when not b.exc then b.p_route when cardinality(b.ids) > 0 then 'org' else 'admin' end,
         b.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf.id, 'full_name', pf.full_name) order by pf.full_name)
                     from public.profiles pf where pf.id = any (b.ids)), '[]'::jsonb),
         b.amount, b.line_budget, b.line_used, b.exc
    from routed b
$$;
revoke all on function public.get_expense_claim_approval_routes(uuid[]) from public, anon;
grant execute on function public.get_expense_claim_approval_routes(uuid[]) to authenticated;

drop function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb);
drop function public.spend_approval_line_figures(uuid[]);
drop function public.spend_approval_project_figures(uuid[]);
