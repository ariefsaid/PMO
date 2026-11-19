-- 0975_spend_route_recorded_spending.sql — spend_approval_route judges a request against what the line and the
-- project have spent, as well as what they have committed.
-- Rollback: supabase/migrations/rollback/0975_spend_route_recorded_spending_down.sql.
-- Redefines public.spend_approval_route (from 0247, the highest migration that defines it),
--          public.get_procurement_approval_routes (from 0724) and public.get_expense_claim_approval_routes (from 0426).
--
-- Line used = recorded spending on the line + open orders + reserved + approved claims not yet in recorded spending,
-- each cost counted once:
--   recorded spending  project_finance_actuals (the Budget tab's by-category Actual: the ledger actual for an
--                      organisation that reads an accounting system, otherwise paid purchases before tax plus
--                      internal hire charges)
--   open orders        procurement_open_commitment on Ordered..Paid (order total less what recorded spending holds)
--   reserved           Approved, Vendor Quoted, Quote Selected: greatest of header total and items, never below zero
--   claims             Approved and Paid claims; with an accounting system, a claim whose approval is posted to the
--                      ledger is in recorded spending already
-- A request is `exceeds_line` when line used + request is over the line budget. When the line fits, the project's
-- whole budget is tested the same way: project budget − recorded spending − claims − open orders − reserved − request < 0 is
-- `exceeds_project`, read from project_budget_positions (the figures the approval panel shows), the committed-spend
-- and the project-wide claim and reservation reads. Both reasons route to the senior set.
--
-- Reason order: no_project, no_category, amount_invalid, no_active_budget, currency_mismatch (the request's own
-- currency), spending_not_visible, currency_mismatch (the figures), spending_unknown, exceeds_line,
-- exceeds_project, budget_changed, within_budget.
--   spending_unknown      what is spent is not known (no ledger reading, an unmapped category, an unusable amount)
--   no senior set        a senior outcome (any reason) goes to the project's named approvers; flat applies only when the
--                         project has none either, and nobody eligible among them leaves it to an Admin.
--   spending_not_visible  the caller is below approval rank, or not an active member, so spending is not read for
--                         them: no figures are returned and the route names everyone who could decide (the project
--                         approvers and the senior set together), so a submit notifies the person who will decide.
--
-- Shape. All of these are SECURITY INVOKER; none is a definer.
--   spend_approval_project_figures(project ids)   the project-level figures, read once for a list of projects
--   spend_approval_line_figures(project ids)      the lines' open orders, reserved and claims, per list
--   spend_approval_route_from_figures(... , figures)  the decision logic; reads no spending, order, reserve or claim
--                         figure itself, and decides who may see figures from the caller's real rank
--   spend_approval_route(...)                      reads its own figures (the two functions above) and calls the
--                         logic; the ONLY path every decision, notification and eligibility check uses
--   get_procurement_approval_routes / get_expense_claim_approval_routes  read the project figures once per list
--                         and call the logic per row; display only

-- ── Project-level figures, for a list of projects at once. Empty for a caller below approval rank.
create or replace function public.spend_approval_project_figures(p_project_ids uuid[])
returns table (project_id uuid, figures jsonb)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with g as materialized (
    select public.is_active_member() and public.holds_spend_approval_authority(public.auth_role()) as ok
  ), pos as materialized (
    select pp.* from public.project_budget_positions(p_project_ids) pp where (select ok from g)
  ), erp_rec as materialized (
    -- With an accounting system the by-category Actual of every project is read once (project_mapped_actuals_all is
    -- project_finance_actuals' ledger branch for every visible project, proven row for row).
    select a.project_id,
           jsonb_object_agg(a.category::text, jsonb_build_object('mapped', a.mapped, 'amount', a.actuals_to_date)) as by_category
      from (select 1 where exists (select 1 from pos where pos.ledger_basis = 'erp')) one
      cross join lateral public.project_mapped_actuals_all(null) a
     where a.project_id in (select pos.project_id from pos where pos.ledger_basis = 'erp')
     group by a.project_id
  )
  select pp.project_id,
         jsonb_build_object(
           'basis', pp.ledger_basis,
           'ledger_currency', pp.currency,
           'budget_currency', pp.budget_currency,
           'proj_budget', pp.active_budget_amount::numeric,
           'proj_spent', pp.spent::numeric + cl.amount,
           'proj_open', case when pp.ledger_basis = 'erp' then cs.open else pp.open_commitment::numeric end,
           'proj_reserved', rs.reserved,
           'proj_foreign', coalesce(cs.foreign_amount, false) or rs.foreign_amount or cl.foreign_amount,
           'recorded', coalesce(er.by_category, rec.by_category, '{}'::jsonb))
    from pos pp
    left join lateral (
      select coalesce(sum(c.amount) filter (where c.currency = pp.budget_currency), 0) as open,
             coalesce(bool_or(c.currency is distinct from pp.budget_currency and c.amount <> 0), false) as foreign_amount
        from public.project_committed_spend(pp.project_id) c
       where pp.ledger_basis = 'erp') cs on true
    cross join lateral (
      select coalesce(sum(greatest(0, pr.total_value,
                    coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = pr.id), 0)))
                    filter (where pr.currency = pp.budget_currency), 0) as reserved,
             coalesce(bool_or(pr.currency is distinct from pp.budget_currency), false) as foreign_amount
        from public.procurements pr
       where pr.org_id = public.auth_org_id() and pr.project_id = pp.project_id
         and pr.status in ('Approved','Vendor Quoted','Quote Selected')) rs
    cross join lateral (
      select coalesce(sum(greatest(0, c.amount)) filter (where c.currency = pp.budget_currency), 0) as amount,
             coalesce(bool_or(c.currency is distinct from pp.budget_currency), false) as foreign_amount
        from public.expense_claims c
       where c.org_id = public.auth_org_id() and c.project_id = pp.project_id
         and c.kind = 'claim' and c.status in ('Approved','Paid')
         and not (pp.ledger_basis = 'erp' and exists (
           select 1 from public.expense_posting_erp_mirror m
            where m.claim_id = c.id and m.posting = 'approval' and m.push_state = 'pushed'
              and m.erp_cancelled_at is null and coalesce(m.erp_docstatus, 1) <> 2))) cl
    left join erp_rec er on er.project_id = pp.project_id
    left join lateral (
      select jsonb_object_agg(a.category::text, jsonb_build_object('mapped', a.mapped, 'amount', a.actuals_to_date)) as by_category
        from public.project_finance_actuals(pp.project_id) a
       where pp.ledger_basis = 'pmo' and a.category is not null) rec on true
$$;
revoke all on function public.spend_approval_project_figures(uuid[]) from public, anon;
grant execute on function public.spend_approval_project_figures(uuid[]) to authenticated;
comment on function public.spend_approval_project_figures(uuid[]) is
  'Display-path read of a project''s spending figures for spend_approval_route_from_figures. Empty below approval rank. Decisions use spend_approval_route, which calls it for one project.';

-- ── Line-level figures: reserved + open orders + claims not yet in recorded spending, per budget line, for a list of
-- projects at once. A line with none of them has no row (its figure is zero). Empty below approval rank.
create or replace function public.spend_approval_line_figures(p_project_ids uuid[])
returns table (project_id uuid, category public.budget_category, figures jsonb)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with g as materialized (
    select public.is_active_member() and public.holds_spend_approval_authority(public.auth_role()) as ok,
           public.auth_org_id() as org_id,
           public.org_reads_erp_ledger() as erp
  ), v as materialized (
    select bv.project_id, bv.currency from public.budget_versions bv, g
     where g.ok and bv.org_id = g.org_id and bv.project_id = any (p_project_ids) and bv.status = 'Active'
  ), reserved as (
    -- Reserved (ADR-0034). The request being decided is 'Requested', so it is never in its own sum. DD-APR-5: each
    -- request counts at least zero, so a negative row that predates the CHECKs cannot make room on the line.
    select pr.project_id, pr.budget_category as category,
           sum(greatest(0, pr.total_value,
             coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = pr.id), 0))) as amount,
           bool_or(pr.currency is distinct from v.currency) as foreign_amount
      from public.procurements pr join v on v.project_id = pr.project_id, g
     where pr.org_id = g.org_id and pr.budget_category is not null
       and pr.status in ('Approved','Vendor Quoted','Quote Selected')
     group by pr.project_id, pr.budget_category
  ), open_orders as (
    -- Open orders: what the order total holds beyond recorded spending (0560, 0858).
    select pr.project_id, pr.budget_category as category,
           sum(greatest(0, public.procurement_open_commitment(pr))) as amount,
           bool_or(pr.currency is distinct from v.currency) as foreign_amount
      from public.procurements pr join v on v.project_id = pr.project_id, g
     where pr.org_id = g.org_id and pr.budget_category is not null
       and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')
     group by pr.project_id, pr.budget_category
  ), claims as (
    -- 0247 (#775, DD-EXP-2): approved and paid expense CLAIMS on this line are spend too. Advances are not: cash in
    -- custody is not cost, and counting it and the claims that settle it would count twice. The claim being decided
    -- is 'Submitted', so it is never in its own sum. A claim whose approval is posted to the ledger (0270) is in the
    -- ledger actual already.
    select c.project_id, c.budget_category as category,
           sum(greatest(0, c.amount)) as amount,
           bool_or(c.currency is distinct from v.currency) as foreign_amount
      from public.expense_claims c join v on v.project_id = c.project_id, g
     where c.org_id = g.org_id and c.budget_category is not null
       and c.kind = 'claim' and c.status in ('Approved','Paid')
       and not (g.erp and exists (
             select 1 from public.expense_posting_erp_mirror m
              where m.claim_id = c.id and m.posting = 'approval' and m.push_state = 'pushed'
                and m.erp_cancelled_at is null and coalesce(m.erp_docstatus, 1) <> 2))
     group by c.project_id, c.budget_category
  ), keys as (
    select k.project_id, k.category from reserved k
    union select k.project_id, k.category from open_orders k
    union select k.project_id, k.category from claims k
  )
  select k.project_id, k.category,
         jsonb_build_object('other_used', coalesce(r.amount, 0) + coalesce(o.amount, 0) + coalesce(c.amount, 0),
                            'foreign', coalesce(r.foreign_amount, false) or coalesce(o.foreign_amount, false)
                                       or coalesce(c.foreign_amount, false))
    from keys k
    left join reserved r on r.project_id = k.project_id and r.category = k.category
    left join open_orders o on o.project_id = k.project_id and o.category = k.category
    left join claims c on c.project_id = k.project_id and c.category = k.category
$$;
revoke all on function public.spend_approval_line_figures(uuid[]) from public, anon;
grant execute on function public.spend_approval_line_figures(uuid[]) to authenticated;
comment on function public.spend_approval_line_figures(uuid[]) is
  'Display-path read of budget lines'' open orders, reserved and claims for spend_approval_route_from_figures. Empty below approval rank. Decisions use spend_approval_route, which calls it for one project.';

-- ── The decision logic. p_figures is required and is read only for a caller of approval rank; the caller's real
-- rank is decided here, so no figure supplied by a caller can reveal more than spend_approval_route shows them.
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
      from public.spend_approvers sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
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
  -- No senior set: the senior outcome falls to the project's named approvers, never to everyone; flat only when the
  -- project has none either. Nobody eligible among them → an Admin.
  select count(*),
         coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_p_rows, v_p_ids
    from public.spend_approvers sa
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

-- ── The route every decision uses. Same signature and result as before; it reads its own figures.
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
  language sql stable security invoker set search_path = public, pg_temp as $$
  select r.route, r.reason, r.approver_ids, r.line_budget, r.line_used
    from public.spend_approval_route_from_figures(p_org_id, p_project_id, p_category, p_amount, p_currency,
           p_requester_id, p_decider_id, p_submitted_at,
           case when p_project_id is not null and p_category is not null and p_amount >= 0
                     and public.is_active_member() and public.holds_spend_approval_authority(public.auth_role())
                then coalesce((select f.figures from public.spend_approval_project_figures(array[p_project_id]) f), '{}'::jsonb)
                     || coalesce((select l.figures from public.spend_approval_line_figures(array[p_project_id]) l where l.category = p_category),
                                 '{"other_used":0,"foreign":false}'::jsonb)
                else '{}'::jsonb end) r
$$;
revoke all on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) to authenticated;

-- ── The list reads (display): project figures once per list, the logic per row. 0724 plus the figures.
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
  ), amt as materialized (
    select req.*, a.amount, ev.submitted_at
      from req
      left join it on it.procurement_id = req.id
      left join ev on ev.procurement_id = req.id
      -- Same CASE as procurement_request_amount (0243): a negative header or line is untrustworthy -> NULL.
      cross join lateral (select case when req.total_value < 0 or coalesce(it.has_negative, false) then null
                                      else greatest(req.total_value, coalesce(it.total, 0)) end as amount) a
  ), pids as materialized (
    select array(select distinct x.project_id from amt x
                  where x.project_id is not null and x.budget_category is not null and x.amount >= 0) as ids
  ), pf as materialized (
    select f.project_id, f.figures from pids, public.spend_approval_project_figures(pids.ids) f
  ), lf as materialized (
    select l.project_id, l.category, l.figures from pids, public.spend_approval_line_figures(pids.ids) l
  )
  select amt.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf2.id, 'full_name', pf2.full_name) order by pf2.full_name)
                     from public.profiles pf2 where pf2.id = any (r.approver_ids)), '[]'::jsonb),
         amt.amount, r.line_budget, r.line_used
    from amt
    left join pf on pf.project_id = amt.project_id
    left join lf on lf.project_id = amt.project_id and lf.category = amt.budget_category
    -- Decider = the viewer, unless the viewer is the requester (who never decides: SoD-a).
    cross join lateral public.spend_approval_route_from_figures(
           amt.org_id, amt.project_id, amt.budget_category, amt.amount, amt.currency, amt.requested_by_id,
           nullif(auth.uid(), amt.requested_by_id), amt.submitted_at,
           case when pf.project_id is not null and amt.budget_category is not null and amt.amount >= 0
                then pf.figures || coalesce(lf.figures, '{"other_used":0,"foreign":false}'::jsonb)
                else '{}'::jsonb end) r
$$;

-- ── The claims list: 0426 plus the figures.
create or replace function public.get_expense_claim_approval_routes(p_ids uuid[])
returns table (claim_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric, is_exception boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with cl as materialized (
    select c.id, c.org_id, c.claimant_id, c.project_id, c.budget_category, c.amount, c.currency, c.submitted_at,
           c.imprest_float_id, c.imprest_month
      from public.expense_claims c
     where c.id = any (p_ids) and c.status = 'Submitted'
  ), pids as materialized (
    select array(select distinct x.project_id from cl x
                  where x.project_id is not null and x.budget_category is not null and x.amount >= 0) as ids
  ), pj as materialized (
    select f.project_id, f.figures from pids, public.spend_approval_project_figures(pids.ids) f
  ), lf as materialized (
    select l.project_id, l.category, l.figures from pids, public.spend_approval_line_figures(pids.ids) l
  ), base as (
    select c.id, c.org_id, c.claimant_id, c.amount, r.route as p_route, r.reason, r.approver_ids, r.line_budget, r.line_used,
           (c.imprest_float_id is not null and public.holds_spend_approval_authority(public.auth_role())
            and c.amount > public.imprest_remaining(c.imprest_float_id, c.imprest_month, c.budget_category)) as exc,
           (select pl.approved_by from public.imprest_plans pl
             where pl.float_id = c.imprest_float_id and pl.month = c.imprest_month and pl.status = 'Approved') as plan_by
      from cl c
      left join pj on pj.project_id = c.project_id
      left join lf on lf.project_id = c.project_id and lf.category = c.budget_category
      cross join lateral public.spend_approval_route_from_figures(
             c.org_id, c.project_id, c.budget_category, c.amount, c.currency,
             c.claimant_id, nullif(auth.uid(), c.claimant_id), c.submitted_at,
             case when pj.project_id is not null and c.budget_category is not null and c.amount >= 0
                  then pj.figures || coalesce(lf.figures, '{"other_used":0,"foreign":false}'::jsonb)
                  else '{}'::jsonb end) r),
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
