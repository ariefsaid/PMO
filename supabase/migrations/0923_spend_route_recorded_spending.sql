-- 0923_spend_route_recorded_spending.sql — spend_approval_route judges a request against what the line and the
-- project have spent, as well as what they have committed.
-- Rollback: supabase/migrations/rollback/0923_spend_route_recorded_spending_down.sql (the 0247 body).
-- Redefines public.spend_approval_route (from 0247, the highest migration that defines it).
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
-- whole budget is tested the same way: project budget − recorded spending − open orders − reserved − request < 0 is
-- `exceeds_project`, read from project_budget_positions (the figures the approval panel shows), the committed-spend
-- and reserved-position reads, and nothing derived a second time. Both reasons route to the senior set.
--
-- Reason order: no_project, no_category, amount_invalid, no_active_budget, currency_mismatch (the request's own
-- currency), spending_not_visible, currency_mismatch (the figures), spending_unknown, exceeds_line,
-- exceeds_project, budget_changed, within_budget.
--   spending_unknown      what is spent is not known (no ledger reading, an unmapped category, an unusable amount)
--   spending_not_visible  the caller is below approval rank, or not an active member, so spending is not read for
--                         them: no figures are returned and the route names everyone who could decide (the project
--                         approvers and the senior set together), so a submit notifies the person who will decide.
-- A decider always holds approval rank. The function stays SECURITY INVOKER; it adds no definer.

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
  v_p_rows       int;                                            -- 0923
  v_p_ids        uuid[];                                         -- 0923
  v_known        boolean;                                        -- 0923
  v_basis        text;                                           -- 0923
  v_ledger_cur   text;                                           -- 0923
  v_proj_budget  numeric;                                        -- 0923
  v_proj_spent   numeric;                                        -- 0923
  v_proj_open    numeric;                                        -- 0923
  v_proj_resv    numeric;                                        -- 0923
  v_proj_foreign boolean;                                        -- 0923
  v_mapped       boolean;                                        -- 0923
  v_recorded     numeric;                                        -- 0923
  v_part         numeric;                                        -- 0923
  v_part_foreign boolean;                                        -- 0923
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
      if p_currency is distinct from v_currency then                                                          -- 0923
        v_reason := 'currency_mismatch';                                                                      -- 0923
      elsif not (public.is_active_member() and public.holds_spend_approval_authority(public.auth_role())) then -- 0923
        v_reason := 'spending_not_visible';                                                                   -- 0923
      else                                                                                                    -- 0923
        -- The project's budget position (the approval panel's figures) and the line's recorded spending.
        select true, pp.ledger_basis, pp.currency, pp.active_budget_amount::numeric, pp.spent::numeric,       -- 0923
               pp.open_commitment::numeric                                                                    -- 0923
          into v_known, v_basis, v_ledger_cur, v_proj_budget, v_proj_spent, v_proj_open                       -- 0923
          from public.project_budget_positions(array[p_project_id]) pp;                                       -- 0923
        select a.mapped, a.actuals_to_date into v_mapped, v_recorded                                          -- 0923
          from public.project_finance_actuals(p_project_id) a where a.category = p_category;                  -- 0923
        -- Reserved (ADR-0034) on this line. The request being decided is 'Requested', so it is never in its own
        -- sum. DD-APR-5: each request counts at least zero, so a negative row that predates the CHECKs cannot
        -- make room on the line.
        select coalesce(sum(greatest(0, pr.total_value,
                 coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = pr.id), 0))), 0),
               coalesce(bool_or(pr.currency is distinct from v_currency), false)
          into v_used, v_foreign
          from public.procurements pr
         where pr.org_id = p_org_id and pr.project_id = p_project_id and pr.budget_category = p_category
           and pr.status in ('Approved','Vendor Quoted','Quote Selected');
        -- Open orders on this line: what the order total holds beyond recorded spending (0560, 0858).
        select coalesce(sum(greatest(0, public.procurement_open_commitment(pr))), 0),                         -- 0923
               coalesce(bool_or(pr.currency is distinct from v_currency), false)                              -- 0923
          into v_part, v_part_foreign                                                                         -- 0923
          from public.procurements pr                                                                         -- 0923
         where pr.org_id = p_org_id and pr.project_id = p_project_id and pr.budget_category = p_category      -- 0923
           and pr.status in ('Ordered','Received','Vendor Invoiced','Paid');                                  -- 0923
        v_used := v_used + v_part;                                                                            -- 0923
        v_foreign := v_foreign or v_part_foreign;                                                             -- 0923
        -- 0247 (#775, DD-EXP-2): approved and paid expense CLAIMS on this line are spend too. Advances are not:
        -- cash in custody is not cost, and counting it and the claims that settle it would count twice.
        -- The claim being decided is 'Submitted', so it is never in its own sum. A claim whose approval is posted
        -- to the ledger (0270) is in the ledger actual already.
        select coalesce(sum(greatest(0, c.amount)), 0),
               coalesce(bool_or(c.currency is distinct from v_currency), false)
          into v_part, v_part_foreign
          from public.expense_claims c
         where c.org_id = p_org_id and c.project_id = p_project_id and c.budget_category = p_category
           and c.kind = 'claim' and c.status in ('Approved','Paid')
           and not (v_basis is not distinct from 'erp' and exists (                                                            -- 0923
                 select 1 from public.expense_posting_erp_mirror m                                            -- 0923
                  where m.claim_id = c.id and m.posting = 'approval' and m.push_state = 'pushed'              -- 0923
                    and m.erp_cancelled_at is null and coalesce(m.erp_docstatus, 1) <> 2));                   -- 0923
        v_used := v_recorded + v_used + v_part;                                                               -- 0923
        v_foreign := v_foreign or v_part_foreign;
        -- The project's open orders (ERP: the per-order position the panel reads) and reserved, in the budget's currency.
        v_proj_foreign := false;                                                                              -- 0923
        if v_basis = 'erp' then                                                                               -- 0923
          select coalesce(sum(c.amount) filter (where c.currency = v_currency), 0),                           -- 0923
                 coalesce(bool_or(c.currency is distinct from v_currency and c.amount <> 0), false)          -- 0923
            into v_proj_open, v_proj_foreign                                                                  -- 0923
            from public.project_committed_spend(p_project_id) c;                                              -- 0923
        end if;                                                                                               -- 0923
        select coalesce(sum((e->>'amount')::numeric) filter (where e->>'currency' = v_currency), 0),          -- 0923
               coalesce(bool_or(e->>'currency' is distinct from v_currency), false)                           -- 0923
          into v_proj_resv, v_part_foreign                                                                    -- 0923
          from public.project_reserved_position(p_project_id) rp, jsonb_array_elements(rp.positions) e;       -- 0923
        v_proj_foreign := v_proj_foreign or v_part_foreign;                                                   -- 0923
        -- Explicit `<=` for "within": anything not provably within (a NULL included) is not within.
        if v_known is not true then                                                                           -- 0923
          v_reason := 'spending_unknown';                                                                     -- 0923
        elsif v_ledger_cur is distinct from v_currency or v_foreign or v_proj_foreign then                    -- 0923
          v_reason := 'currency_mismatch';
        elsif v_mapped is not true or v_used is null or v_proj_budget is null                                 -- 0923
              or v_proj_spent is null or v_proj_open is null then                                             -- 0923
          v_reason := 'spending_unknown';                                                                     -- 0923
        elsif not (v_used + p_amount <= v_budget) then                                                        -- 0923
          v_reason := 'exceeds_line';
        elsif v_proj_budget - v_proj_spent - v_proj_open - v_proj_resv - p_amount < 0 then                    -- 0923
          v_reason := 'exceeds_project';                                                                      -- 0923
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
      end if;                                                                                                 -- 0923
    end if;
  end if;

  -- 1b. Below approval rank: no figures; everyone who could decide (the project's approvers and the senior set).  -- 0923
  if v_reason = 'spending_not_visible' then                                                                       -- 0923
    select count(*),                                                                                              -- 0923
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (                                      -- 0923
             where sa.profile_id is distinct from p_requester_id                                                  -- 0923
               and pf.status = 'active'                                                                           -- 0923
               and pf.org_id = p_org_id                                                                           -- 0923
               and public.holds_spend_approval_authority(pf.role)), '{}')                                         -- 0923
      into v_p_rows, v_p_ids                                                                                      -- 0923
      from public.spend_approvers sa                                                                              -- 0923
      join public.profiles pf on pf.id = sa.profile_id                                                            -- 0923
     where sa.org_id = p_org_id and sa.project_id = p_project_id;                                                 -- 0923
    select count(*),                                                                                              -- 0923
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (                                      -- 0923
             where sa.profile_id is distinct from p_requester_id                                                  -- 0923
               and pf.status = 'active'                                                                           -- 0923
               and pf.org_id = p_org_id                                                                           -- 0923
               and public.holds_spend_approval_authority(pf.role)), '{}')                                         -- 0923
      into v_rows, v_eligible                                                                                     -- 0923
      from public.spend_approvers sa                                                                              -- 0923
      join public.profiles pf on pf.id = sa.profile_id                                                            -- 0923
     where sa.org_id = p_org_id and sa.project_id is null;                                                        -- 0923
    -- Either outcome flat → flat; else the project's and the senior set's eligible ids together; nobody → an Admin.
    if v_p_rows = 0 or v_rows = 0 then                                                                            -- 0923
      return query select 'flat'::text, v_reason, null::uuid[], null::numeric, null::numeric;                     -- 0923
      return;                                                                                                     -- 0923
    end if;                                                                                                       -- 0923
    select coalesce(array_agg(distinct x order by x), '{}') into v_eligible from unnest(v_p_ids || v_eligible) x; -- 0923
    if cardinality(v_eligible) > 0 then                                                                           -- 0923
      return query select 'org'::text, v_reason, v_eligible, null::numeric, null::numeric;                        -- 0923
    else                                                                                                          -- 0923
      return query select 'admin'::text, v_reason, '{}'::uuid[], null::numeric, null::numeric;                    -- 0923
    end if;                                                                                                       -- 0923
    return;                                                                                                       -- 0923
  end if;                                                                                                         -- 0923

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
