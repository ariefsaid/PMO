-- 1971_task_leaf_readers_inline.sql — #2807 review follow-up.
-- drops: get_project_milestones, get_projects_delivery and get_executive_dashboard replace their task_counts_toward_progress(t) call with the same leaf test written inline (set-based not exists); get_executive_dashboard also extends its overdue-task filter with that leaf test and rewrites one stale comment; scheduled_report_content extends its overdue filter with the leaf test; task_counts_toward_progress adds tombstoned_at to its child test; check_task_tree_no_cycle returns early when the parent did not move. Nothing else changes.
--
-- 1. Speed: the per-row helper call could not be inlined; written as a set-based not exists the three
--    org-wide readers run in ~0.1 s on 20k tasks instead of 1.4-31 s (measured locally).
-- 2. A parent's own status and due date feed no figure: the dashboard overdue count and the scheduled
--    report's overdue list now count leaves only, like the assistant's overdue reader.
-- 3. A child deleted in the task tool no longer makes its parent a parent (the app never sees deleted rows).
-- 4. The cycle trigger skips its lock and walk when an update does not move the parent, and is renamed to
--    fire after the org stamp.
--
-- Bodies restated from head: helper, trigger function and the three readers from 1970; scheduled_report_content
-- from 1226. The leaf test, everywhere: archived_at is null and no child with archived_at and tombstoned_at null.
-- Reverse: rollback/1971_task_leaf_readers_inline_down.sql.

-- §1 helper (kept for callers and the parity test)
create or replace function public.task_counts_toward_progress(t public.tasks)
  returns boolean
  language sql stable security invoker set search_path = public as $$
  select t.archived_at is null
     and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null);
$$;
revoke all     on function public.task_counts_toward_progress(public.tasks) from public;
grant  execute on function public.task_counts_toward_progress(public.tasks) to   authenticated;
revoke execute on function public.task_counts_toward_progress(public.tasks) from anon;

-- §2 cycle trigger function
create or replace function public.check_task_tree_no_cycle()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_task_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then
    return new;   -- the parent did not move: nothing to check, and no lock behind a long sync transaction
  end if;
  -- ponytail: one transaction lock per project serialises re-parenting, so two crossing moves cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended('task_tree:' || coalesce(new.project_id, new.org_id)::text, 0));
  if exists (
    with recursive up(id, parent_task_id) as (
      select t.id, t.parent_task_id from public.tasks t where t.id = new.parent_task_id
      union
      select t.id, t.parent_task_id from public.tasks t join up on t.id = up.parent_task_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'TASK_TREE_CYCLE: a task cannot sit under one of its own subtasks' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.check_task_tree_no_cycle() from public, anon, authenticated;
-- It reads org_id and can refuse, so it must fire after the org stamp (0215: no org check before the stamp).
alter trigger tasks_check_tree_no_cycle on public.tasks rename to tasks_zz_check_tree_no_cycle;

-- §3 readers
create or replace function get_project_milestones(p_project_id uuid)
  returns table (
    id uuid, project_id uuid, name text, sort_order integer, target_date date,
    weight numeric, input_pct numeric, task_count integer,
    calculated_pct numeric, effective_pct numeric
  )
  language sql stable security invoker set search_path = public as $$
  select m.id, m.project_id, m.name, m.sort_order, m.target_date, m.weight, m.input_pct,
         count(t.id)::int as task_count,
         (count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0)) as calculated_pct,
         coalesce(
           m.input_pct,
           count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
           0
         ) as effective_pct
    from project_milestones m
    left join tasks t on (t.milestone_id = m.id
                          or exists (select 1 from task_groups g          -- #2679: a task in an active group linked to m
                                      where g.id = t.task_group_id and g.milestone_id = m.id and g.archived_at is null))
                     and t.archived_at is null
                     and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)   -- #2807 leaf test, set-based (inline, not a per-row call)
   where m.project_id = p_project_id
   group by m.id
   order by m.sort_order, m.created_at;
$$;
revoke all     on function get_project_milestones(uuid) from public;
grant  execute on function get_project_milestones(uuid) to   authenticated;
revoke execute on function get_project_milestones(uuid) from anon;

create or replace function get_projects_delivery(p_ids uuid[])
  returns table (
    project_id    uuid,
    delivery_pct  numeric,
    committed_spend numeric,
    budget        numeric
  )
  language sql stable security invoker set search_path = public as $$
  with eff as (
    select
      m.project_id,
      m.weight,
      coalesce(
        m.input_pct,
        count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
        0
      ) as effective_pct,
      (m.input_pct is not null or count(t.id) > 0) as has_signal
    from project_milestones m
    left join tasks t on (t.milestone_id = m.id
                          or exists (select 1 from task_groups g          -- #2679: a task in an active group linked to m
                                      where g.id = t.task_group_id and g.milestone_id = m.id and g.archived_at is null))
                     and t.archived_at is null
                     and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)   -- #2807 leaf test, set-based (inline, not a per-row call)
    where m.project_id = any(p_ids)
    group by m.id
  ),
  -- The 0396 body selected the requested projects without an explicit org filter: under the caller's RLS that
  -- is the caller's org, and under service_role it is the requested set (the commitment figure stays NULL there,
  -- exactly as the per-project function returned). Keep that row set: rows are returned for EVERY requested
  -- project; only the commitment figure needs the four money roles, so that gate sits on its own CTE.
  proj as (
    select p.id, p.currency
      from public.projects p
     where p.id = any(p_ids)
  ),
  -- The per-project commitment position is exactly `sum(procurement_open_commitment)` over the project's
  -- committed-status purchases, in the project currency. 0723 already computes that CASE for many purchases
  -- in one set-based call (proved row for row by supabase/tests/0651_committed_spend_equivalence.test.sql),
  -- so the delivery read reuses it instead of calling the position once per project.
  cprocs as (
    select pr.id, pr.project_id, pr.currency, pr.total_value
      from public.procurements pr
      join proj on proj.id = pr.project_id
     where pr.org_id = public.auth_org_id()
       and pr.status::text = any (public.committed_procurement_statuses())
  ),
  open_commitment as materialized (
    select o.procurement_id, o.amount
      from public.procurement_open_commitments((select array_agg(id) from cprocs)) o
  ),
  commitment as (
    select proj.id as project_id,
           -- project_pmo_commitment_position: the project-currency open commitment, ignoring other currencies.
           coalesce(sum(o.amount) filter (where p.currency = proj.currency), 0) as amount,
           -- ...and complete only while every committed purchase is in the project currency and readable.
           coalesce(bool_and(coalesce(p.currency = proj.currency, false) and p.total_value is not null
                             and p.total_value::text not in ('NaN','Infinity','-Infinity')) filter (where p.id is not null), true) as complete
      from proj
      left join cprocs p on p.project_id = proj.id
      left join open_commitment o on o.procurement_id = p.id
     where public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     group by proj.id
  ),
  committed as (
    select
      proj.id as project_id,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = proj.id and v.status = 'Active'), 0) as budget,
      case when cm.complete then cm.amount else null end as committed_spend
    from proj
    left join commitment cm on cm.project_id = proj.id

  )
  select
    c.project_id,
    case
      when bool_or(e.has_signal) then sum(e.weight * e.effective_pct) / nullif(sum(e.weight), 0)
      else null
    end as delivery_pct,
    c.committed_spend,
    c.budget
  from committed c
  left join eff e on e.project_id = c.project_id
  group by c.project_id, c.committed_spend, c.budget;
$$;

revoke all     on function get_projects_delivery(uuid[]) from public;
grant  execute on function get_projects_delivery(uuid[]) to   authenticated;
revoke execute on function get_projects_delivery(uuid[]) from anon;

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
    select coalesce((select (now() at time zone coalesce(o.default_timezone, 'UTC'))::date
                       from public.organizations o where o.id = public.auth_org_id()), current_date) as today
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
revoke all on function public.get_executive_dashboard() from public;
grant execute on function public.get_executive_dashboard() to authenticated;
revoke execute on function public.get_executive_dashboard() from anon;

-- §4 scheduled report
-- Returns the email subject and body. p_from..p_to is the local date range the report covers.
create or replace function public.scheduled_report_content(
  p_kind text, p_org uuid, p_recipient uuid, p_from date, p_to date, p_locale text, p_name text
) returns table (subject text, body text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role   text;
  v_cur    text;
  v_lines  text[] := '{}';
  v_head   text;
  r        record;
begin
  select pr.role::text into v_role from public.profiles pr where pr.id = p_recipient and pr.org_id = p_org;
  if v_role is null then return; end if;   -- not a member of this organisation: no figures at all
  select o.default_currency into v_cur from public.organizations o where o.id = p_org;
  v_head := p_name || E'\n' || public.scheduled_report_text(p_locale, p_kind) || E'\n' || public.scheduled_report_text(p_locale, 'period') || ': '
            || case when p_from = p_to then p_to::text else p_from::text || ' - ' || p_to::text end;

  if p_kind = 'daily_progress' then
    for r in
      select p.name as project, count(distinct d.id) as reports,
             count(distinct d.id) filter (where d.status = 'validated') as validated,
             count(distinct l2.id) as lines,
             sum(l2.frozen_amount) filter (where d.status = 'validated') as revenue,
             (v_role in ('Admin','Finance','Executive') or (v_role = 'Project Manager' and p.project_manager_id = p_recipient)) as may_see_revenue
        from public.daily_site_reports d
        join public.projects p on p.id = d.project_id and p.org_id = p_org
        left join public.dsr_progress_lines l2 on l2.report_id = d.id and l2.org_id = p_org
       where d.org_id = p_org and d.work_date between p_from and p_to
         and d.archived_at is null and d.superseded_at is null and d.status <> 'draft'
       group by p.id, p.name, p.project_manager_id
       order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.reports || ' ' || public.scheduled_report_text(p_locale, 'reports')
        || ' (' || r.validated || ' ' || public.scheduled_report_text(p_locale, 'validated') || '), '
        || r.lines || ' ' || public.scheduled_report_text(p_locale, 'lines')
        || case when r.may_see_revenue and r.revenue is not null
                then ', ' || public.scheduled_report_text(p_locale, 'revenue') || ' ' || to_char(r.revenue, 'FM999999999990.00') || ' ' || v_cur
                else '' end);
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_progress')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');

  elsif p_kind = 'overdue_tasks' then
    for r in
      select p.name as project, count(*) as n
        from public.tasks t
        join public.projects p on p.id = t.project_id and p.org_id = p_org
       where t.org_id = p_org and t.status <> 'Done' and t.tombstoned_at is null and t.end_date < p_to
         and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)   -- #2807: leaves only
       group by p.id, p.name order by p.name
    loop
      v_lines := v_lines || (r.project || ': ' || r.n || ' ' || public.scheduled_report_text(p_locale, 'overdue'));
    end loop;
    if cardinality(v_lines) = 0 then v_lines := array[public.scheduled_report_text(p_locale, 'nothing_overdue')]; end if;
    return query select p_name, v_head || E'\n\n' || array_to_string(v_lines, E'\n');
  end if;
end $$;
revoke all on function public.scheduled_report_content(text, uuid, uuid, date, date, text, text) from public, anon, authenticated;
