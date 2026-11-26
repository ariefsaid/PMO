-- Organisation calendar and dated expense costs. Reverse: rollback/2755_org_day_remainder_down.sql
-- drops: duplicate calendar expressions, the inspection UTC-plus-one allowance, and UTC claim date casts;
-- dated performance expands each counted claim to its expense lines, while aggregate claim reads keep one row.
create or replace function public.get_executive_dashboard()
  returns json
  language plpgsql
  stable
  security invoker
  set search_path = public
as $$
begin
  return (
  with flag as materialized (                         -- 0656: the org's ledger basis is read once, not once per project and column
    select public.org_reads_erp_ledger() as erp,
           coalesce(public.holds_spend_approval_authority(public.auth_role()), false) as holds
  ),
  pma as materialized (                               -- 0376: one org-wide actuals read; 0656: only when the ledger is the basis
    select * from public.project_mapped_actuals_all(null) where (select erp from flag)
  ),
  pma_p as (
    select project_id, count(*) as n, bool_and(mapped and actuals_to_date is not null) as all_ok,
      sum(actuals_to_date) as actual_sum,
      (count(*) filter (where mapped and actuals_to_date is not null))::int as cov_count,
      (count(*) filter (where mapped))::int as cov_total
    from pma group by project_id
  ),
  pmo as materialized (                               -- 0770: the PMO spent/committed positions for every project in one pass, not one call per project
    select * from public.project_pmo_positions(coalesce((select array_agg(x.id) from public.projects x where x.archived_at is null), '{}')) where not (select erp from flag)
  ),
  av as (                                             -- latest Active budget version per project (its currency)
    select distinct on (v.project_id) v.project_id, v.currency as budget_currency
    from public.budget_versions v where v.status = 'Active'
    order by v.project_id, v.version desc, v.created_at desc, v.id desc
  ),
  ab as (
    select v.project_id, sum(li.budgeted_amount) as active_budget
    from public.budget_versions v join public.budget_line_items li on li.budget_version_id = v.id
    where v.status = 'Active' group by v.project_id
  ),
  cat_cov as (                                        -- Active-budget categories vs. mapped, read ledger categories
    select r.project_id, count(r.category) as n, count(ok.category) as n_ok
    from (select distinct v.project_id, li.category
            from public.budget_versions v join public.budget_line_items li on li.budget_version_id = v.id
           where v.status = 'Active') r
    left join (select project_id, category from pma where mapped and actuals_to_date is not null) ok
      on ok.project_id = r.project_id and ok.category = r.category
    group by r.project_id
  ),
  active as (
    select * from public.projects where status = 'Ongoing Project' and archived_at is null
  ),
  billed_work as (
    select si.project_id,si.currency,sum(w.net+w.recovery) as revenue,
      count(*) filter(where w.net is null or w.recovery is null
        or w.net::text in ('NaN','Infinity','-Infinity')
        or w.recovery::text in ('NaN','Infinity','-Infinity'))::int as missing_work
    from public.sales_invoice_work_billed w
    join public.sales_invoices si on si.id=w.id and si.org_id=w.org_id
    where si.org_id=public.auth_org_id() and si.status in ('Submitted','Unpaid','Paid')
      and coalesce(si.erp_docstatus,1)<>2 and si.erp_cancelled_at is null and not w.is_down_payment
    group by si.project_id,si.currency
  ),
  project_money_raw as (
    select p.id, p.org_id, p.name, p.status, p.currency, p.contract_value,
      case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0) else p.contract_value end as contract_net,
      ab.active_budget, av.budget_currency, (av.project_id is not null) as has_active,
      case when f.erp then o.default_currency else p.currency end as actual_currency,
      case when not f.erp then pmo.spent_complete
        -- 0381 (#1374): no Active budget → the project header's rule: every cost category mapped and read.
        when av.project_id is null then (coalesce(pp.n, 0) > 0 and pp.all_ok) and f.holds
        else coalesce(cc.n > 0 and cc.n = cc.n_ok, false) end as actual_complete,
      case when f.erp then (case when o.default_currency = p.currency then pp.actual_sum else null end)
           else pmo.spent end as actual,
      case when f.erp then null else pmo.committed end as committed,
      case when f.erp then true else coalesce(pmo.committed_complete, false) end as committed_complete,
      case when f.erp then coalesce(pp.cov_count, 0) else 1 end as actual_coverage_count,
      case when f.erp then coalesce(pp.cov_total, 0) else 1 end as actual_coverage_total,
      f.erp as ledger_owned
    from public.projects p
    cross join flag f
    left join public.organizations o on o.id = p.org_id
    left join av on av.project_id = p.id
    left join ab on ab.project_id = p.id
    left join pma_p pp on pp.project_id = p.id
    left join cat_cov cc on cc.project_id = p.id
    left join pmo on pmo.project_id = p.id
    where p.archived_at is null
  ),
  project_money as (
    select r.*,
      case when r.actual is null or not r.actual_complete or r.actual_currency <> r.currency
        or not exists (select 1 from billed_work b where b.project_id=r.id and b.currency=r.currency)
        or coalesce((select b.missing_work from billed_work b where b.project_id=r.id and b.currency=r.currency),0)>0 then null
        else coalesce((select b.revenue from billed_work b where b.project_id=r.id and b.currency=r.currency),0)-r.actual
      end as realized_margin,
      case when r.actual is null or not r.actual_complete or r.actual_currency <> r.currency
        or not exists (select 1 from billed_work b where b.project_id=r.id and b.currency=r.currency)
        or coalesce((select b.missing_work from billed_work b where b.project_id=r.id and b.currency=r.currency),0)>0 then null
        else coalesce((select b.revenue from billed_work b where b.project_id=r.id and b.currency=r.currency),0)
      end as known_billed_revenue
    from project_money_raw r
  ),
  on_hand as (
    select p.* from project_money p where p.status::text=any(public.on_hand_project_statuses())
  ),
  on_hand_currency as (
    select currency, sum(contract_net) as contract_value,
      sum(actual) filter(where actual_currency=currency and actual_complete) as actual_known,
      sum(contract_net - actual) filter(where actual_currency=currency and actual_complete) as contract_remaining,
      sum(actual_coverage_count) as actual_coverage_count,
      sum(actual_coverage_total) as actual_coverage_total,
      count(*) filter (where actual is not null and actual_complete and actual_currency=currency) as actual_project_count,
      count(*) as actual_project_total,
      sum(realized_margin) as realized_margin_known,
      sum(known_billed_revenue) as known_billed_revenue,
      count(*) filter (where actual is null or not actual_complete or actual_currency<>currency or realized_margin is null) as unknown_projects
    from on_hand group by currency
  ),
  pipeline as (
    select p.*, coalesce((select c.win_probability from public.pipeline_stage_config c where c.status=p.status),0) as win_prob,
      ab.active_budget
    from public.projects p left join ab on ab.project_id = p.id
    where p.status::text=any(public.pipeline_project_statuses()) and p.archived_at is null
  ),
  pipeline_currency as (
    select currency, sum(contract_value) as total_value,
      sum(contract_value*go_probability*get_probability) as weighted_value,
      sum(case when active_budget > 0 then contract_value-active_budget else null end) as forecast_margin,
      count(*) filter(where active_budget is null or active_budget<=0) as no_active_budget
    from pipeline group by currency
  ),
  active_currency as (select currency,sum(contract_value) as contract_value from active group by currency),
  delivery_risk_basis as (
    select p.* from project_money_raw p
    where p.status::text = any(public.active_delivery_project_statuses())
  ),
  delivery_risk_summary as (
    select count(*)::int as active_delivery_projects,
      count(*) filter (where actual is not null and actual_complete and actual_currency=currency)::int as active_delivery_actual_project_count,
      count(*)::int as active_delivery_actual_project_total,
      coalesce(sum(actual_coverage_count),0)::int as active_delivery_actual_coverage_count,
      coalesce(sum(actual_coverage_total),0)::int as active_delivery_actual_coverage_total,
      count(*) filter (where active_budget is null or active_budget <= 0
        or not actual_complete or actual is null
        or not committed_complete
        or actual_currency is distinct from budget_currency
        or actual_currency is distinct from currency)::int as risk_unchecked_projects
    from delivery_risk_basis
  ),
  attention as (
    select count(*)::int as n from project_money_raw r
    where r.status::text=any(public.active_delivery_project_statuses())
      and r.has_active and r.budget_currency = r.currency and r.actual_complete and r.committed_complete
      -- 0700: budget consumption. A PMO-basis figure is spent + open commitment (one order total, never twice);
      -- a ledger org keeps its ledger Actual. A NULL either side leaves the ratio NULL, i.e. not at risk.
      and (case when r.ledger_owned then r.actual else r.actual + r.committed end)
        / nullif(r.active_budget,0) >= 0.9
  ),
  -- 0732 (#1418): the attention ranking. "Today" is the org-local day (0441's inline rule), so an item is overdue
  -- on the same calendar day every screen calls it overdue.
  org_day as materialized (
    select public.native_org_today(public.auth_org_id()) as today
  ),
  -- Overdue tasks: the whats_overdue rule (agent-chat/overdue.ts) — open status, end_date before today, live row,
  -- and a leaf (#2807): a parent's own status and due date feed no figure.
  overdue_task_counts as (
    select t.project_id, count(*)::int as n
    from public.tasks t cross join org_day d
    where t.status in ('To Do','In Progress','Blocked')
      and t.end_date is not null and t.end_date < d.today
      and t.tombstoned_at is null and t.archived_at is null
      and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)
    group by t.project_id
  ),
  -- Milestone progress as get_project_milestones derives it (#2807: leaves only; archived tasks excluded).
  milestone_progress as (
    select m.id, m.project_id, m.target_date,
      coalesce(m.input_pct,
               count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
               0) as effective_pct,
      count(t.id)::int as task_count
    from public.project_milestones m
    left join public.tasks t on t.milestone_id = m.id and t.archived_at is null
                          and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)  -- #2807 leaf test, set-based
    where m.target_date is not null
    group by m.id
  ),
  -- Overdue milestone: the project-detail rule — target date past, effective % under 100, and the phase started.
  overdue_milestone_counts as (
    select mp.project_id, count(*)::int as n
    from milestone_progress mp cross join org_day d
    where mp.target_date < d.today
      and mp.effective_pct < 100
      and (mp.effective_pct > 0 or mp.task_count > 0)
    group by mp.project_id
  ),
  -- Overdue client invoices: the AR due-date rule (revenueDisplay.deriveArDueDate) over the open, unpaired rows.
  invoice_due as (
    select si.project_id,
      case when si.received_date is not null then si.received_date + coalesce(c.erp_payment_terms_days, 30)
           when si.erp_due_date is not null then si.erp_due_date
           else si.invoice_date + coalesce(c.erp_payment_terms_days, 30) end as due_date
    from public.sales_invoices si
    left join public.companies c on c.id = si.customer_id and c.org_id = si.org_id
    where si.status in ('Submitted','Unpaid') and si.paired_erp_invoice_id is null
  ),
  overdue_invoice_counts as (
    select i.project_id, count(*)::int as n
    from invoice_due i cross join org_day d
    where i.project_id is not null and i.due_date is not null and i.due_date < d.today
    group by i.project_id
  ),
  -- Waiting approvals: the project-scoped pending queues (a Requested procurement, a Submitted expense claim).
  approval_queue as (
    select q.project_id, sum(q.n)::int as n from (
      select pr.project_id, count(*) as n from public.procurements pr
       where pr.status = 'Requested' and pr.project_id is not null
       group by pr.project_id
      union all
      select ec.project_id, count(*) as n from public.expense_claims ec
       where ec.status = 'Submitted' and ec.project_id is not null
       group by ec.project_id
    ) q group by q.project_id
  ),
  -- The active population the screen lists (the active delivery set — the FE's ACTIVE_PROJECT_STATUSES, so Close
  -- Out is NOT in it), with each signal and the budget-consumption ratio on the same guards as the at-risk rule
  -- (null when it cannot be compared).
  attention_basis as (
    select p.id,
      coalesce(ot.n, 0) as overdue_tasks,
      coalesce(om.n, 0) as overdue_milestones,
      coalesce(oi.n, 0) as overdue_invoices,
      coalesce(aq.n, 0) as waiting_approvals,
      case when p.has_active and p.active_budget > 0
             and p.budget_currency = p.currency
             and p.actual_currency = p.currency
             and p.actual_complete and p.committed_complete
           then (case when p.ledger_owned then p.actual else p.actual + p.committed end) / p.active_budget
      end as budget_used_ratio
    from project_money p
    left join overdue_task_counts ot on ot.project_id = p.id
    left join overdue_milestone_counts om on om.project_id = p.id
    left join overdue_invoice_counts oi on oi.project_id = p.id
    left join approval_queue aq on aq.project_id = p.id
    where p.status::text = any(public.active_delivery_project_statuses())
  ),
  attention_scored as (
    select b.*, (b.overdue_tasks + b.overdue_milestones + b.overdue_invoices) as overdue_items
    from attention_basis b
  ),
  attention_ranked as (
    select s.*,
      (case when s.overdue_items > 0 then 1 else 0 end)
      + (case when s.budget_used_ratio > 1 then 1 else 0 end)
      + (case when s.waiting_approvals > 0 then 1 else 0 end) as attention_signals
    from attention_scored s
  )
  select json_build_object(
    'active_projects',(select count(*) from active),
    'total_contract_value',case when (select count(*) from active_currency)<=1
      then (select sum(contract_value) from active_currency) else null end,
    'total_contract_value_by_currency',coalesce((select json_object_agg(currency,contract_value) from active_currency),'{}'::json),
    'on_hand_value',case when (select count(*) from on_hand_currency)<=1
      then (select sum(contract_value) from on_hand_currency) else null end,
    'on_hand_value_by_currency',coalesce((select json_agg(to_jsonb(c) order by currency) from on_hand_currency c),'[]'::json),
    'on_hand_contract_remaining',case when (select count(*) from on_hand_currency)<=1
      then (select sum(contract_remaining) from on_hand_currency) else null end,
    'on_hand_margin',case when (select count(*) from on_hand_currency)=0 then 0
      when (select count(*) from on_hand_currency)=1
      then (select case when contract_value<>0 then contract_remaining/contract_value else null end from on_hand_currency)
      else null end,
    'on_hand_realized_margin',case when (select count(*) from on_hand_currency)<=1 then (select sum(realized_margin_known) from on_hand_currency) else null end,
    'on_hand_realized_margin_by_currency',coalesce((select json_agg(json_build_object('currency',currency,'known_amount',realized_margin_known,'known_billed_revenue',known_billed_revenue,'unknown_projects',unknown_projects) order by currency) from on_hand_currency),'[]'::json),
    'on_hand_actual_known',case when (select count(*) from on_hand_currency)<=1 then (select actual_known from on_hand_currency) else null end,
    'on_hand_actual_project_count',coalesce((select sum(actual_project_count) from on_hand_currency),0),
    'on_hand_actual_project_total',coalesce((select sum(actual_project_total) from on_hand_currency),0),
    'on_hand_actual_coverage_count',coalesce((select sum(actual_coverage_count) from on_hand_currency),0),
    'on_hand_actual_coverage_total',coalesce((select sum(actual_coverage_total) from on_hand_currency),0),
    'pipeline_total_value',case when (select count(*) from pipeline_currency)<=1 then (select sum(total_value) from pipeline_currency) else null end,
    'pipeline_total_value_by_currency',coalesce((select json_agg(to_jsonb(c) order by currency) from pipeline_currency c),'[]'::json),
    'pipeline_weighted_value',case when (select count(*) from pipeline_currency)=0 then 0 when (select count(*) from pipeline_currency)=1 then (select sum(weighted_value) from pipeline_currency) else null end,
    'pipeline_projected_margin',case when (select count(*) from pipeline_currency)=0 then 0 when (select count(*) from pipeline_currency)=1 and (select no_active_budget from pipeline_currency)=0 then (select sum(forecast_margin)/nullif(sum(total_value),0) from pipeline_currency) else null end,
    'projects_at_risk',(select n from attention),
    'active_delivery_projects',(select active_delivery_projects from delivery_risk_summary),
    'active_delivery_actual_project_count',(select active_delivery_actual_project_count from delivery_risk_summary),
    'active_delivery_actual_project_total',(select active_delivery_actual_project_total from delivery_risk_summary),
    'active_delivery_actual_coverage_count',(select active_delivery_actual_coverage_count from delivery_risk_summary),
    'active_delivery_actual_coverage_total',(select active_delivery_actual_coverage_total from delivery_risk_summary),
    'risk_unchecked_projects',(select risk_unchecked_projects from delivery_risk_summary),
    'projects_by_status',coalesce((select json_agg(json_build_object('status',status,'count',c) order by status)
      from (select status,count(*) c from public.projects where archived_at is null group by status) s),'[]'::json),
    'procurements_by_status',coalesce((select json_agg(json_build_object('status',status,'count',c) order by status)
      from (select status,count(*) c from public.procurements group by status) s),'[]'::json),
    'top_projects',coalesce((select json_agg(t order by t.contract_value desc) from (
      select p.id,p.name,coalesce(nullif(btrim(c.short_name),''),c.name) as client_name,
        p.contract_value,p.currency,p.active_budget as budget,p.budget_currency,p.actual as spent,
        p.committed,p.committed_complete,
        p.actual_currency,p.actual_complete,p.actual_coverage_count,p.actual_coverage_total,p.realized_margin,p.status
      from project_money p left join public.companies c on c.id=(select pr.client_id from public.projects pr where pr.id=p.id)
      where p.status::text = any(public.on_hand_project_statuses()) or p.status::text = 'Internal Project'
      order by p.contract_value desc limit 5
    ) t),'[]'::json),
    -- 0732 (#1418): the same project fields as top_projects, in attention order, over the whole active population.
    'attention_projects',coalesce((select json_agg(t) from (
      select p.id,p.name,coalesce(nullif(btrim(c.short_name),''),c.name) as client_name,
        p.contract_value,p.currency,p.active_budget as budget,p.budget_currency,p.actual as spent,
        p.committed,p.committed_complete,
        p.actual_currency,p.actual_complete,p.actual_coverage_count,p.actual_coverage_total,p.realized_margin,p.status,
        r.overdue_items,r.overdue_tasks,r.overdue_milestones,r.overdue_invoices,r.waiting_approvals,
        coalesce(r.budget_used_ratio > 1, false) as over_budget,r.budget_used_ratio,r.attention_signals
      from attention_ranked r
      join project_money p on p.id = r.id
      left join public.projects pr on pr.id = r.id
      left join public.companies c on c.id = pr.client_id and c.org_id = pr.org_id
      order by r.attention_signals desc, r.overdue_items desc, r.waiting_approvals desc,
        r.budget_used_ratio desc nulls last, p.contract_value desc nulls last, r.id
      limit 5
    ) t),'[]'::json)
  ));
end $$;

create or replace function public.guard_crew_loan_archive() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.archived_at is not null and old.archived_at is null and exists (
       select 1 from public.crew_loans l
        where (l.home_crew_id = new.id or l.host_crew_id = new.id) and l.valid_to >= public.native_org_today(new.org_id)) then
    raise exception 'CRW_ARCHIVE_IN_USE: end this crew''s current and future loans first' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function public.guard_tpi_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rank_old int; v_rank_new int;
begin
  -- Immutable once set: the work order, project, org, required gates, creator, the purchase link once raised.
  if new.org_id is distinct from old.org_id or new.work_order_id is distinct from old.work_order_id
     or new.project_id is distinct from old.project_id or new.required_for is distinct from old.required_for
     or new.created_by is distinct from old.created_by or new.section_id is distinct from old.section_id then
    raise exception 'TPI_IMMUTABLE: the work order, gates and creator of an inspection cannot change' using errcode = '23514';
  end if;
  if old.procurement_id is not null and new.procurement_id is distinct from old.procurement_id then
    raise exception 'TPI_IMMUTABLE: the linked purchase cannot change' using errcode = '23514';
  end if;
  if old.status = 'cancelled' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'TPI_TERMINAL: a cancelled inspection cannot change' using errcode = '23514';
  end if;

  -- waiver: set once, with a reason, by someone other than the creator, only where a gate exists to release.
  if new.waived_at is distinct from old.waived_at or new.waived_by is distinct from old.waived_by
     or new.waiver_reason is distinct from old.waiver_reason then
    if old.waived_at is not null then
      raise exception 'TPI_WAIVED: this inspection is already waived' using errcode = '23514';
    end if;
    if cardinality(new.required_for) = 0 then
      raise exception 'TPI_WAIVE_NOT_REQUIRED: this inspection is required for no gate, so there is nothing to waive' using errcode = '23514';
    end if;
    if new.waiver_reason is null or btrim(new.waiver_reason) = '' or new.waived_at is null or new.waived_by is null then
      raise exception 'TPI_WAIVE_REASON: a waiver needs a reason' using errcode = '23514';
    end if;
    if new.waived_by is not distinct from new.created_by then
      raise exception 'TPI_WAIVE_SELF: you cannot waive an inspection you created' using errcode = '42501';
    end if;
    if old.status = 'reported' and old.result in ('pass','conditional') then
      raise exception 'TPI_WAIVE_COMPLETE: this inspection is already complete' using errcode = '23514';
    end if;
  end if;

  if new.status is not distinct from old.status then
    -- no status move: result and the step fields only change together with a step
    if new.result is distinct from old.result or new.executed_on is distinct from old.executed_on
       or new.invited_on is distinct from old.invited_on or new.procurement_id is distinct from old.procurement_id then
      raise exception 'TPI_STEP: complete the previous step' using errcode = '23514';
    end if;
    return new;
  end if;

  v_rank_old := array_position(array['requested','purchase_raised','invited','executed','reported'], old.status);
  v_rank_new := array_position(array['requested','purchase_raised','invited','executed','reported'], new.status);

  if new.status = 'cancelled' then
    if old.status = 'reported' then
      raise exception 'TPI_CANCEL_REPORTED: a reported inspection cannot be cancelled' using errcode = '23514';
    end if;
    if cardinality(new.required_for) > 0 then
      raise exception 'TPI_CANCEL_REQUIRED: this inspection is required for a gate; report it or waive it' using errcode = '23514';
    end if;
    if new.cancel_reason is null or btrim(new.cancel_reason) = '' or new.cancelled_at is null or new.cancelled_by is null then
      raise exception 'TPI_CANCEL_REASON: cancelling needs a reason' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'reported' or v_rank_new is distinct from v_rank_old + 1 then
    raise exception 'TPI_STEP: complete the previous step' using errcode = '23514';
  end if;

  if new.status = 'purchase_raised' then
    if new.procurement_id is null or new.purchase_raised_at is null or new.purchase_raised_by is null then
      raise exception 'TPI_STEP: raising the purchase needs its procurement case' using errcode = '23514';
    end if;
  elsif new.status = 'invited' then
    if new.procurement_id is null then
      raise exception 'TPI_STEP: complete the previous step (raise the purchase first)' using errcode = '23514';
    end if;
    if new.invited_on is null or new.invited_by is null then
      raise exception 'TPI_INVITE: record the invitation date' using errcode = '23514';
    end if;
  elsif new.status = 'executed' then
    if new.executed_on is null or new.executed_by is null then
      raise exception 'TPI_EXECUTE: record the execution date' using errcode = '23514';
    end if;
    -- The execution day cannot be later than the organisation's day.
    if new.executed_on > public.native_org_today(new.org_id) then
      raise exception 'TPI_EXECUTE_FUTURE: the execution date cannot be in the future' using errcode = '23514';
    end if;
  elsif new.status = 'reported' then
    if new.result not in ('pass','fail','conditional') then
      raise exception 'TPI_RESULT: record a result of pass, fail or conditional' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
    if not exists (select 1 from public.third_party_inspection_files f
                    where f.inspection_id = new.id and f.archived_at is null) then
      raise exception 'TPI_REPORT_FILE: attach the report before marking it reported' using errcode = '23514';
    end if;
    if new.reported_at is null or new.reported_by is null then
      raise exception 'TPI_STEP: reporting stamps the date and actor' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace function public.set_procurement_invoice_efaktur(
  p_invoice_id uuid,
  p_efaktur_number text,
  p_efaktur_date date
)
returns public.procurement_invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.procurement_invoices;
  v_number text := nullif(btrim(p_efaktur_number), '');
begin
  select * into v_row from public.procurement_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'vendor bill not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin', 'Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  if v_row.erp_docstatus = 2 or v_row.erp_cancelled_at is not null then
    raise exception 'cannot record e-Faktur facts on a cancelled vendor bill'
      using errcode = '23514', detail = 'efaktur-cancelled';
  end if;
  if (v_number is null) <> (p_efaktur_date is null) then
    raise exception 'an e-Faktur number and its date must be recorded together'
      using errcode = '23514', detail = 'efaktur-incomplete';
  end if;
  if v_number is not null and (char_length(v_number) > 32 or v_number !~ '^[0-9.-]+$') then
    raise exception 'invalid e-Faktur number' using errcode = '23514';
  end if;
  -- "Future" on the ORG's calendar (the 0247 pattern), not the session's: current_date would refuse
  -- an Asia/Jakarta morning's own date until 07:00 local.
  if p_efaktur_date is not null and p_efaktur_date > public.native_org_today(v_row.org_id) then
    raise exception 'e-Faktur date cannot be in the future'
      using errcode = '23514', detail = 'efaktur-future-date';
  end if;
  update public.procurement_invoices
     set efaktur_number = v_number, efaktur_date = p_efaktur_date
   where id = p_invoice_id
   returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_sales_invoice_efaktur(
  p_si_id uuid,
  p_efaktur_number text,
  p_efaktur_date date
)
returns public.sales_invoices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sales_invoices;
  v_number text := nullif(btrim(p_efaktur_number), '');
  v_vat boolean;
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin', 'Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status = 'Cancelled' then
    raise exception 'cannot record e-Faktur facts on a cancelled sales invoice'
      using errcode = '23514', detail = 'efaktur-cancelled';
  end if;
  -- An e-Faktur is a VAT document: a sale outside VAT (project not subject to VAT) has none to record (AC-OCI-081).
  -- A zero-rated invoice on a VAT-subject project still needs one. No project = unknown = allowed. Clearing stays allowed.
  select p.subject_to_vat into v_vat from public.projects p where p.id = v_row.project_id;
  if v_number is not null and v_vat is false then
    raise exception 'a sales invoice outside VAT has no e-Faktur to record'
      using errcode = '23514', detail = 'efaktur-no-vat';
  end if;
  if (v_number is null) <> (p_efaktur_date is null) then
    raise exception 'an e-Faktur number and its date must be recorded together'
      using errcode = '23514', detail = 'efaktur-incomplete';
  end if;
  if v_number is not null and (char_length(v_number) > 32 or v_number !~ '^[0-9.-]+$') then
    raise exception 'invalid e-Faktur number' using errcode = '23514';
  end if;
  -- "Future" on the ORG's calendar (the 0247 pattern), not the session's: current_date would refuse
  -- an Asia/Jakarta morning's own date until 07:00 local.
  if p_efaktur_date is not null and p_efaktur_date > public.native_org_today(v_row.org_id) then
    raise exception 'e-Faktur date cannot be in the future'
      using errcode = '23514', detail = 'efaktur-future-date';
  end if;
  update public.sales_invoices
     set efaktur_number = v_number, efaktur_date = p_efaktur_date
   where id = p_si_id
   returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.get_work_order_performance(p_project_id uuid, p_as_of date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_tz text;
  v_cur text;
  v_enabled boolean; v_low numeric; v_high numeric;
  v_asof date;
  v_total integer;
  v_rows jsonb;
  v_limit constant integer := 500;
begin
  perform public.assert_not_light();
  if v_org is null or auth.uid() is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager')
     or not public.dsr_may_see_revenue(p_project_id) then
    raise exception 'you cannot read revenue and cost on this project' using errcode = '42501';
  end if;

  select o.performance_indices_enabled, o.performance_band_low, o.performance_band_high,
         coalesce(o.default_timezone, 'UTC')
    into v_enabled, v_low, v_high, v_tz
    from public.organizations o where o.id = v_org;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false);
  end if;

  select default_currency into v_cur from public.organizations where id = v_org;
  v_asof := coalesce(p_as_of, public.native_org_today(v_org));
  select count(*)::integer into v_total from public.work_orders w where w.project_id = p_project_id and w.org_id = v_org;

  with costs as materialized (
    select c.work_order_id, c.occurred_on, c.currency, c.amount, c.reason
      from public.work_order_cost_amounts(p_project_id) c
     where c.work_order_id is not null and c.reason in ('counted', 'unresolved-direct')
       and c.source <> 'expense_claim'
       and not (public.auth_role() = 'Project Manager' and c.reason = 'counted'
                and c.source in ('timesheet_entry','attendance_day','headcount_day'))
    union all
    -- Preserve the public claim total while allocating it to the expense days internally.
    select c.work_order_id, coalesce(l.expense_date, public.native_org_date(ec.org_id, ec.created_at)),
           c.currency, case when l.id is null then c.amount else l.amount::text end, c.reason
      from public.work_order_cost_amounts(p_project_id) c
      join public.expense_claims ec on ec.id = c.record_id and ec.org_id = v_org
      left join public.expense_claim_lines l on l.claim_id = ec.id and l.org_id = ec.org_id
     where c.source = 'expense_claim' and c.work_order_id is not null
       and c.reason in ('counted', 'unresolved-direct')
    union all
    -- Only this internal calculation uses dated labour rows. The response exposes work-order totals only.
    select l.work_order_id, l.entry_date, v_cur, l.amount::text, 'counted'
      from public.labour_cost_priced_lines(p_project_id) l
     where public.auth_role() = 'Project Manager' and l.work_order_id is not null
    union all
    select l.work_order_id, l.occurred_on, v_cur, l.amount::text, 'counted'
      from public.labour_cost_class_lines(p_project_id) l
     where public.auth_role() = 'Project Manager' and l.work_order_id is not null and l.amount is not null
  ), wos as (
    select w.id, w.wo_number, w.title, w.status, w.currency, w.start_date, w.end_date, w.created_at,
           b.order_net as bac,
           case when w.status = 'Closed' and w.closed_at is not null
                then least(v_asof, (w.closed_at at time zone v_tz)::date) else v_asof end as eff
      from public.work_orders w
      join public.work_order_billing b on b.work_order_id = w.id and b.org_id = v_org
     where w.project_id = p_project_id and w.org_id = v_org
     order by w.wo_number nulls last, w.created_at, w.id
     limit v_limit
  ), per as (
    select w.*,
      (select coalesce(sum(l.frozen_amount), 0) from public.dsr_progress_lines l
         join public.daily_site_reports d on d.id = l.report_id
        where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null
          and d.archived_at is null and d.work_date <= w.eff) as ev,
      (select count(*)::integer from public.dsr_progress_lines l
         join public.daily_site_reports d on d.id = l.report_id
        where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null
          and d.archived_at is null and d.work_date <= w.eff and l.frozen_amount is null) as unrated,
      exists (select 1 from costs c where c.work_order_id = w.id and c.reason = 'counted'
                 and (c.occurred_on is null or c.occurred_on <= w.eff) and c.currency is distinct from w.currency) as other_ccy,
      exists (select 1 from costs c where c.work_order_id = w.id
                 and ((c.reason = 'unresolved-direct')
                      or (c.reason = 'counted' and (c.occurred_on is null or c.amount is null)))) as incomplete,
      (select count(*)::integer from costs c where c.work_order_id = w.id and c.reason = 'counted' and c.occurred_on is null) as undated,
      (select coalesce(sum(c.amount::numeric), 0) from costs c where c.work_order_id = w.id and c.reason = 'counted'
          and c.occurred_on <= w.eff and c.currency = w.currency and c.amount is not null) as ac
    from wos w
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'work_order_id', p.id, 'wo_number', p.wo_number, 'title', p.title, 'status', p.status, 'currency', p.currency,
      'as_of', p.eff, 'start_date', p.start_date, 'end_date', p.end_date,
      'bac', case when p.status in ('Issued', 'Closed') then p.bac::numeric(16,2)::text end,
      'ev',  case when p.status in ('Issued', 'Closed') then p.ev::numeric(16,2)::text end,
      'unrated_lines', case when p.status in ('Issued', 'Closed') then p.unrated else 0 end,
      'pv',  case when p.status in ('Issued', 'Closed') and p.start_date is not null and p.end_date is not null
                   and p.end_date >= p.start_date
                  then (case when v_asof < p.start_date then 0::numeric
                             else round(p.bac * (least(v_asof, p.end_date) - p.start_date + 1)
                                        / (p.end_date - p.start_date + 1), 2) end)::numeric(16,2)::text end,
      'ac',  case when p.status in ('Issued', 'Closed') and not p.other_ccy and not p.incomplete then p.ac::numeric(16,2)::text end,
      'ac_status', case when p.other_ccy then 'not_comparable' when p.incomplete then 'incomplete' else 'complete' end,
      'undated_cost_lines', p.undated
    ) order by p.wo_number nulls last, p.created_at, p.id), '[]'::jsonb)
    into v_rows from per p;

  return jsonb_build_object(
    'enabled', true, 'as_of', v_asof,
    'bands', jsonb_build_object('low', v_low::numeric(3,2)::text, 'high', v_high::numeric(3,2)::text),
    'truncated', v_total > v_limit, 'omitted', greatest(v_total - v_limit, 0),
    'rows', v_rows);
end $$;

create or replace function public.work_order_cost_amounts_unrounded(p_project_id uuid)
returns table(source text, record_id uuid, project_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date,
              reference text, currency text, amount text, reason text, quantity numeric, quantity_unit text, person_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_fin jsonb;
  v_actual numeric;
  v_currency text;
  v_erp boolean;
begin
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  v_fin := public.get_project_finances(p_project_id)->'actuals';
  v_actual := (v_fin->>'total')::numeric;
  v_currency := v_fin->>'currency';
  v_erp := public.org_reads_erp_ledger();

  return query
  with purchase as (
    select p.*, public.procurement_paid_pre_tax(p) as paid
      from public.procurements p
     where p.project_id = p_project_id and p.org_id = v_org and p.origin is distinct from 'erp_link'
       and not public.purchase_costs_as_stock(p.id)
       and exists (select 1 from public.payments x where x.org_id = v_org and x.procurement_id = p.id
                    and x.status = 'Paid' and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null)
  ), linked as (
    select pay.procurement_id, pay.invoice_id, sum(pay.amount) as paid,
           bool_or(pay.amount is null or pay.amount::text in ('NaN', 'Infinity', '-Infinity')
                   or pay.currency is distinct from pr.currency) as unreadable
      from public.payments pay join purchase pr on pr.id = pay.procurement_id and pr.org_id = pay.org_id
     where pay.invoice_id is not null and pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2
       and pay.erp_cancelled_at is null
     group by pay.procurement_id, pay.invoice_id
  ), bill_amounts as (
    select i.id, i.procurement_id,
           coalesce(i.work_order_id, po.work_order_id, gr.work_order_id, rq.work_order_id) as work_order_id,
           case when i.work_order_id is not null then i.discipline_id
                when po.work_order_id is not null then po.discipline_id
                when gr.work_order_id is not null then gr.discipline_id else rq.discipline_id end as discipline_id,
           i.invoice_date, i.vi_number, i.currency as bill_currency,
           case when l.unreadable or pr.paid is null
                  or i.currency is distinct from pr.currency or i.amount is null
                  or i.amount::text in ('NaN', 'Infinity', '-Infinity') then null::numeric
                when (i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                      - coalesce(i.withheld_amount, 0)) > 0
                then round(l.paid * (case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     / (i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                         - coalesce(i.withheld_amount, 0)), 2)
                else l.paid end as cost
      from linked l join purchase pr on pr.id = l.procurement_id
      join public.procurement_invoices i on i.id = l.invoice_id and i.procurement_id = pr.id and i.org_id = v_org
      left join public.purchase_orders po on po.id = i.po_id and po.procurement_id = pr.id and po.org_id = v_org
      left join lateral (
        select case when bool_and(x.work_order_id is not null) and count(distinct x.work_order_id) = 1 then min(x.work_order_id::text)::uuid end as work_order_id,
               case when count(distinct x.discipline_id) = 1 then min(x.discipline_id::text)::uuid end as discipline_id
          from public.procurement_receipts x where x.org_id = v_org and x.procurement_id = pr.id and i.po_id is not null and x.po_id = i.po_id
      ) gr on true
      left join lateral (
        select case when bool_and(x.work_order_id is not null) and count(distinct x.work_order_id) = 1 then min(x.work_order_id::text)::uuid end as work_order_id,
               case when count(distinct x.discipline_id) = 1 then min(x.discipline_id::text)::uuid end as discipline_id
          from public.purchase_requests x where x.org_id = v_org and x.procurement_id = pr.id
      ) rq on true
  ), bill_totals as (
    select b.procurement_id, case when count(*) filter (where b.cost is null) > 0 then null else sum(b.cost) end as cost
      from bill_amounts b group by b.procurement_id
  ), remainders as (
    select pr.id, pr.paid, pr.currency, coalesce(pr.code, pr.title) as reference,
           case when pr.paid is null then null when bt.procurement_id is not null and bt.cost is null then pr.paid
                else pr.paid - coalesce(bt.cost, 0) end as cost,
           case when bt.procurement_id is not null and bt.cost is null then null else docs.work_order_id end as work_order_id,
           case when bt.procurement_id is not null and bt.cost is null then null else docs.discipline_id end as discipline_id
      from purchase pr left join bill_totals bt on bt.procurement_id = pr.id
      left join lateral (
        select case when bool_and(d.work_order_id is not null) and count(distinct d.work_order_id) = 1 then min(d.work_order_id::text)::uuid end as work_order_id,
               case when count(distinct d.discipline_id) = 1 then min(d.discipline_id::text)::uuid end as discipline_id
          from (
            select po.work_order_id, po.discipline_id from public.purchase_orders po
             where po.org_id = v_org and po.procurement_id = pr.id
            union all
            select gr.work_order_id, gr.discipline_id from public.procurement_receipts gr
             where gr.org_id = v_org and gr.procurement_id = pr.id
            union all
            select rq.work_order_id, rq.discipline_id from public.purchase_requests rq
             where rq.org_id = v_org and rq.procurement_id = pr.id
               and not exists (select 1 from public.purchase_orders po where po.org_id = v_org and po.procurement_id = pr.id)
               and not exists (select 1 from public.procurement_receipts gr where gr.org_id = v_org and gr.procurement_id = pr.id)
          ) d
      ) docs on true
  ), rate_entries as (
    select e.id, e.work_order_id, e.discipline_id, e.work_date, e.quantity, e.unit,
           v.id as setting_id, date_trunc('month', e.work_date)::date as month,
           e.quantity * case when e.kind = 'standby' then coalesce(v.standby_rate, 0) else v.work_rate end as raw_cost
      from public.equipment_settings_effective(v_org, null) v
      join public.equipment_usage_entries e on e.org_id = v_org and e.asset_id = v.asset_id
        and e.project_id = p_project_id and e.status = 'Approved' and e.archived_at is null
        and e.work_date between v.window_from and v.window_to and e.unit = v.rate_unit
     where v.basis = 'hire_rate'
       and v_currency = (select default_currency from public.organizations where id = v_org)
       and exists (select 1 from jsonb_array_elements(v_fin->'categories') c
                    where c->>'category' = v.charge_category::text and (c->>'mapped')::boolean)
  ), rate_grouped as (
    select e.*, sum(e.raw_cost) over (partition by e.setting_id, e.month) as group_raw,
           round(sum(e.raw_cost) over (partition by e.setting_id, e.month), 2) as group_total
      from rate_entries e
  ), rate_shares as (
    select e.*, case when e.raw_cost is null then null when e.group_raw > 0 then e.group_total * 100 * e.raw_cost / e.group_raw else 0 end as exact_cents
      from rate_grouped e
  ), rate_ranked as (
    select e.*, floor(e.exact_cents) as whole_cents,
           row_number() over (partition by e.setting_id, e.month order by e.exact_cents - floor(e.exact_cents) desc, e.id) as remainder_rank,
           sum(floor(e.exact_cents)) over (partition by e.setting_id, e.month) as floor_total
      from rate_shares e
  ), rate_allocated as (
    select e.*, (e.whole_cents + case when e.remainder_rank <= e.group_total * 100 - e.floor_total then 1 else 0 end) / 100 as cost
      from rate_ranked e
  ), equipment as (
    select e.id, e.work_order_id, e.discipline_id, e.work_date, e.quantity, e.unit,
           case when v_currency = (select default_currency from public.organizations where id = v_org)
                then sum(e.cost) end as cost
      from rate_allocated e
     group by e.id, e.work_order_id, e.discipline_id, e.work_date, e.quantity, e.unit
  ), claim_rows as (
    -- 1263 (#2732, DD-SCWO-4): expense claims that NAME a work order. An unattributed claim adds no line and keeps its
    -- existing treatment. Approved or Paid counts at its amount; in PMO mode it is added to the project figure (it is not
    -- in the PMO-mode actual), in ledger mode only once its approval posting is pushed (so the ledger is never counted twice).
    select c.id, c.work_order_id, c.discipline_id, coalesce((select min(l.expense_date) from public.expense_claim_lines l where l.claim_id = c.id and l.org_id = c.org_id), public.native_org_date(c.org_id, c.created_at)) as on_date,
           c.claim_number, c.currency, c.amount,
           c.status in ('Approved', 'Paid') and (not v_erp or exists (
             select 1 from public.expense_posting_erp_mirror m
              where m.org_id = v_org and m.claim_id = c.id and m.posting = 'approval' and m.push_state = 'pushed')) as counted
      from public.expense_claims c
     where c.org_id = v_org and c.project_id = p_project_id and c.kind = 'claim' and c.work_order_id is not null
  ), allocated as (
    select 'vendor_bill'::text as source, b.id as record_id, p_project_id as project_id, b.work_order_id, b.discipline_id,
           b.invoice_date as occurred_on, b.vi_number as reference, b.bill_currency as currency, b.cost,
           case when b.cost is null and b.work_order_id is not null then 'unresolved-direct'
                when b.cost is null then 'outside-basis' when b.work_order_id is null then 'unassigned' else 'counted' end::text as reason,
           null::numeric as quantity, null::text as quantity_unit
      from bill_amounts b where not v_erp
    union all
    select 'purchase_balance', r.id, p_project_id, r.work_order_id, r.discipline_id, null::date, r.reference, r.currency, r.cost,
           case when r.work_order_id is null then 'unassigned' else 'counted' end, null::numeric, null::text
      from remainders r where not v_erp and (r.cost is null or r.cost <> 0)
    union all
    select 'equipment_usage', e.id, p_project_id, e.work_order_id, e.discipline_id, e.work_date, null::text, v_currency, e.cost,
           'counted'::text, e.quantity, e.unit
      from equipment e
    union all
    select 'expense_claim', k.id, p_project_id, k.work_order_id, k.discipline_id, k.on_date, k.claim_number, k.currency, k.amount,
           'counted'::text, null::numeric, null::text
      from claim_rows k where k.counted
    union all
    select 'stock_document',s.record_id,p_project_id,s.work_order_id,s.discipline_id,s.occurred_on,s.reference,s.currency,s.amount,'counted',null::numeric,null::text from public.stock_issue_cost_lines(p_project_id) s
  ), allocated_sum as (
    select case when count(*) filter (where cost is null) > 0 then null else coalesce(sum(cost), 0) end as cost from allocated a where a.reason not in ('unresolved-direct', 'outside-basis')
       and (a.source <> 'expense_claim' or v_erp)
  )
  select x.source, x.record_id, x.project_id, x.work_order_id, x.discipline_id, x.occurred_on,
         x.reference, x.currency, x.cost::text, x.reason, x.quantity, x.quantity_unit, null::uuid from allocated x
  union all
  select 'project_actuals', p_project_id, p_project_id, null::uuid, null::uuid, null::date, null::text, v_currency,
         case when v_actual is null or a.cost is null then null else (v_actual - a.cost)::text end,
         case when v_erp then 'split-when-custom' else 'unassigned' end, null::numeric, null::text, null::uuid
    from allocated_sum a
   where v_actual is null or a.cost is null or v_actual <> a.cost
  union all
  select u.source, u.record_id, u.project_id, u.work_order_id, u.discipline_id, u.occurred_on, u.reference,
         u.currency, null::text,
         case when u.reason = 'counted' then 'outside-basis' else u.reason end,
         u.quantity, u.quantity_unit, u.person_id
    from public.work_order_cost_amounts_unpriced(p_project_id) u
   where not exists (select 1 from allocated a where a.source = u.source and a.record_id = u.record_id)
  union all
  select 'expense_claim', k.id, p_project_id, k.work_order_id, k.discipline_id, k.on_date, k.claim_number, k.currency,
         null::text, 'not-posted', null::numeric, null::text, null::uuid
    from claim_rows k where not k.counted
  union all
  select 'other_revenue', md5(p_project_id::text || ':' || coalesce(w.currency, '?'))::uuid,
         p_project_id, null::uuid, null::uuid, null::date, null::text, w.currency,
         case when count(*) filter (where w.net is null or w.recovery is null
                   or w.net::text in ('NaN', 'Infinity', '-Infinity')
                   or w.recovery::text in ('NaN', 'Infinity', '-Infinity')) > 0 then null
              else sum(w.net + w.recovery)::text end,
         'other-revenue', null::numeric, null::text, null::uuid
    from public.sales_invoice_work_billed w
    join public.sales_invoices i on i.id = w.id and i.org_id = w.org_id
   where i.org_id = v_org and i.project_id = p_project_id and i.billing_kind = 'other'
     and i.status in ('Submitted', 'Unpaid', 'Paid') and coalesce(i.erp_docstatus, 1) <> 2
     and i.erp_cancelled_at is null and i.paired_erp_invoice_id is null and not w.is_down_payment
   group by w.currency;
end $$;

create or replace function public.native_org_today(p_org uuid) returns date
  language sql stable set search_path = public as $$
  select public.native_org_date(p_org, now())
$$;

create or replace function public.equipment_org_today(p_org uuid) returns date
  language sql stable set search_path = public, pg_temp as $$ select public.native_org_today(p_org) $$;

create or replace function public.qcr_org_today(p_org uuid) returns date
  language sql stable security definer set search_path = public, pg_temp as $$ select public.native_org_today(p_org) $$;

create or replace function public.rsv_today(p_org uuid) returns date
  language sql stable security definer set search_path = public, pg_temp as $$ select public.native_org_today(p_org) $$;

create or replace function public.site_checkpoint_today() returns date
  language sql stable security definer set search_path = public, pg_temp as $$ select public.native_org_today(public.auth_org_id()) $$;

create or replace function public.stock_org_today(p_org uuid) returns date language sql stable security definer set search_path = public, pg_temp as $$ select public.native_org_today(p_org) $$;

create or replace function public.wrp_org_today(p_org uuid) returns date
  language sql stable security definer set search_path = public, pg_temp as $$ select public.native_org_today(p_org) $$;

-- Count cost records use the work order project and the issued-stock costing window. Other sources retain 2402 behavior.
create or replace view public.work_order_cost_lines with (security_invoker = true) as
  select 'purchase_request'::text as source, r.id as record_id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date as occurred_on, coalesce(r.pr_number, r.reference_number) as reference,
         null::numeric as quantity, null::text as quantity_unit
    from public.purchase_requests r join public.procurements p on p.id = r.procurement_id
  union all
  select 'purchase_order', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date, coalesce(r.po_number, r.reference_number), null, null
    from public.purchase_orders r join public.procurements p on p.id = r.procurement_id
  union all
  select 'goods_receipt', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.receipt_date, r.gr_number, null, null
    from public.procurement_receipts r join public.procurements p on p.id = r.procurement_id
  union all
  select 'vendor_bill', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.invoice_date, r.vi_number, null, null
    from public.procurement_invoices r join public.procurements p on p.id = r.procurement_id
  union all
  select 'timesheet_entry', e.id, e.org_id, e.project_id, e.work_order_id, e.discipline_id,
         e.entry_date, null, e.hours, 'hours'
    from public.timesheet_entries e
  union all
  select 'stock_document', d.id, d.org_id,
         case when d.kind = 'transfer' then w.project_id when d.kind = 'count' then wo.project_id else d.project_id end, d.work_order_id, d.discipline_id,
         d.occurred_on, d.number, null, null
    from public.stock_documents d left join public.stock_warehouses w on w.id = d.to_warehouse_id
    left join public.work_orders wo on wo.id = d.work_order_id and wo.org_id = d.org_id
   where d.kind in ('issue', 'return', 'transfer')
      or (d.kind = 'count' and d.status = 'Posted' and wo.id is not null
          and not public.org_reads_erp_ledger()
          and exists (select 1 from public.stock_issue_cost_settings s
                       where s.org_id = d.org_id and d.occurred_on >= s.effective_on))
  union all
  select 'equipment_usage', u.id, u.org_id, u.project_id, u.work_order_id, u.discipline_id,
         u.work_date, case when a.id is not null then a.code || ' · ' || a.name end, u.quantity, u.unit
    from public.equipment_usage_entries u
    left join public.equipment_assets a on a.id = u.asset_id and a.org_id = u.org_id
   where u.archived_at is null
  union all
  -- 1037 (#2528, FR-CRW-016): approved hours of people with no login live on the attendance record itself. A login's
  -- hours reach cost through its timesheet line above, so a row linked to a timesheet line is never counted here.
  select 'attendance_day', a.id, a.org_id, a.project_id, a.work_order_id, c.discipline_id,
         a.work_date, null, a.hours + coalesce(a.overtime_hours, 0), 'hours'
    from public.attendance_days a left join public.crews c on c.id = a.crew_id
   where a.status = 'present' and a.approved_at is not null and a.timesheet_entry_id is null
  union all
  -- 1262 (#2732, FR-SCWO-007): an expense claim (kind claim) names its work order and discipline; a cash advance is
  -- not a cost (DD-SCWO-2). Money is not here, as for every source; the claim's own RLS decides who sees the row.
  select 'expense_claim', c.id, c.org_id, c.project_id, c.work_order_id, c.discipline_id,
         coalesce((select min(l.expense_date) from public.expense_claim_lines l where l.claim_id = c.id and l.org_id = c.org_id), public.native_org_date(c.org_id, c.created_at)), c.claim_number, null, null
    from public.expense_claims c
   where c.kind = 'claim';

grant execute on function public.native_org_today(uuid), public.native_org_date(uuid, timestamptz) to authenticated;
