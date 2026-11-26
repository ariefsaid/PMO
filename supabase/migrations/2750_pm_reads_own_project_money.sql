-- A Project Manager reads project money for their own projects (owner ruling 26 Nov 2026).
-- project_money_in_scope is the one definition of "own project": projects.project_manager_id = the caller, the same rule
-- get_work_in_hand applies. Other roles, and money not bound to a project, are unchanged.
-- A project outside the Project Manager's scope reads as not found, or as no rows, or with the money withheld.
-- Reverse: rollback/2750_pm_reads_own_project_money_down.sql.
-- drops: each restated function replaces its project-exists test (or filter) with the same test plus project_money_in_scope; nothing else changes.
begin;
create or replace function public.project_money_in_scope(p_project uuid)
  returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select p_project is null
      or public.auth_role() is distinct from 'Project Manager'::public.user_role
      or exists (select 1 from public.projects p
                  where p.id = p_project and p.org_id = public.auth_org_id() and p.project_manager_id = auth.uid())
$$;
revoke all on function public.project_money_in_scope(uuid) from public, anon;
grant execute on function public.project_money_in_scope(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.work_order_cost_amounts_unrounded(p_project_id uuid)
 RETURNS TABLE(source text, record_id uuid, project_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date, reference text, currency text, amount text, reason text, quantity numeric, quantity_unit text, person_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) or not public.project_money_in_scope(p_project_id) then
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
    select c.id, c.work_order_id, c.discipline_id, coalesce(c.approved_at, c.created_at)::date as on_date,
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
end $function$;

CREATE OR REPLACE FUNCTION public.work_order_cost_amounts(p_project_id uuid)
 RETURNS TABLE(source text, record_id uuid, project_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date, reference text, currency text, amount text, reason text, quantity numeric, quantity_unit text, person_id uuid, labour_class_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_org uuid := public.auth_org_id();
  v_cur text;
  v_pm boolean;
begin
  perform public.assert_not_light();
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) or not public.project_money_in_scope(p_project_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  v_pm := public.auth_role() = 'Project Manager';

  return query
  with priced as (select * from public.labour_cost_priced_lines(p_project_id))
  , cls as (select * from public.labour_cost_class_lines(p_project_id))
  -- 1721: class-priced labour lines (costed attendance days). Per row, except a Project Manager's priced money.
  select l.source, l.record_id, p_project_id, l.work_order_id, l.discipline_id, l.occurred_on, null::text,
         case when l.amount is null then null::text else v_cur end, l.amount::text,
         case when l.amount is null then 'no-rate' else 'counted' end, l.quantity, l.quantity_unit,
         case when v_pm then null::uuid else l.worker_id end, l.class_id
    from cls l
   where not v_pm or l.amount is null
  union all
  -- 1933: a Project Manager's class-priced money is one row per source, work order and discipline, with no class and no
  -- quantity, so no class rate can be read from amount over quantity. Its sum is the per-row sum Admin, Executive and Finance read.
  select l.source, null::uuid, p_project_id, l.work_order_id, l.discipline_id, null::date, null::text, v_cur,
         sum(l.amount)::text, 'counted', null::numeric, l.quantity_unit, null::uuid, null::uuid               -- mut:pm_mask
    from cls l
   where v_pm and l.amount is not null
   group by l.source, l.work_order_id, l.discipline_id, l.quantity_unit
  union all
  select b.source, b.record_id, b.project_id, b.work_order_id, b.discipline_id, b.occurred_on, b.reference, b.currency,
         b.amount, b.reason, b.quantity, b.quantity_unit, b.person_id, null::uuid
    from public.work_order_cost_amounts_pre_labour(p_project_id) b
   where not (b.source = 'timesheet_entry' and exists (select 1 from priced x where x.entry_id = b.record_id))
  union all
  select 'timesheet_entry', x.entry_id, p_project_id, x.work_order_id, x.discipline_id, x.entry_date, null::text, v_cur,
         x.amount::text, 'counted', x.hours, 'hours', x.person_id, x.class_id
    from priced x
   where not v_pm
  union all
  select 'timesheet_entry', null::uuid, p_project_id, x.work_order_id, x.discipline_id, null::date, null::text, v_cur,
         sum(x.amount)::text, 'counted', sum(x.hours), 'hours', null::uuid, x.class_id
    from priced x
   where v_pm
   group by x.work_order_id, x.discipline_id, x.class_id;
end $function$;

CREATE OR REPLACE FUNCTION public.work_order_idle_cost(p_project_id uuid)
 RETURNS TABLE(work_order_id uuid, reason_id uuid, reason_label text, minutes bigint, hours text, hourly_cost text, amount text, currency text, reason text, people_amount text, equipment_amount text, headcount_hours text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_org uuid := public.auth_org_id();
  v_cur text;
  v_pm boolean;
  v_full boolean;
begin
  perform public.assert_not_light();
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) or not public.project_money_in_scope(p_project_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.idle_cost_enabled(v_org) then return; end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  v_pm := public.auth_role() = 'Project Manager';
  v_full := coalesce((select s.scope from public.idle_cost_settings s where s.org_id = v_org), 'labour_average') = 'people_and_equipment';

  return query
  with wo_cost as (
    -- 1933: the class-priced lines are read from labour_cost_class_lines (the caller's cost read no longer carries their hours
    -- for a Project Manager), the timesheet lines from the cost read as before. The same rows as before, for every role.
    select y.wo, sum(y.amt) as amt, sum(y.hrs) as hrs from (
      select c.work_order_id as wo, c.amount::numeric as amt, c.quantity as hrs
        from public.work_order_cost_amounts(p_project_id) c
       where c.reason = 'counted' and c.labour_class_id is not null and c.quantity_unit = 'hours' and c.work_order_id is not null
         and c.source = 'timesheet_entry'
      union all
      select l.work_order_id, l.amount, l.quantity
        from public.labour_cost_class_lines(p_project_id) l
       where l.amount is not null and l.class_id is not null and l.quantity_unit = 'hours' and l.work_order_id is not null
    ) y group by y.wo
  ), idle_day as (
    select d.work_order_id as wo, d.work_date as dt, ip.reason_id, sum(ip.minutes)::bigint as mins
      from public.dsr_idle_periods ip
      join public.daily_site_reports d on d.id = ip.report_id
     where d.org_id = v_org and d.project_id = p_project_id and ip.org_id = v_org
       and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
     group by d.work_order_id, d.work_date, ip.reason_id
  ), idle as (
    select x.wo, x.reason_id, sum(x.mins)::bigint as mins from idle_day x group by x.wo, x.reason_id
  ), heads as (
    select h.work_order_id as wo, h.work_date as dt, h.heads from public.idle_headcount_days(v_org, p_project_id) h where v_full
  ), standby as (
    select e.work_order_id as wo, e.work_date as dt, sum(e.quantity * coalesce(v.standby_rate, 0)) as amt
      from public.equipment_usage_entries e
      join public.equipment_settings_effective(v_org, null) v
        on v.basis = 'hire_rate' and v.asset_id = e.asset_id and e.unit = v.rate_unit
       and e.work_date between v.window_from and v.window_to
     where v_full and e.org_id = v_org and e.project_id = p_project_id and e.kind = 'standby'
       and e.status = 'Approved' and e.archived_at is null and e.work_order_id is not null
     group by e.work_order_id, e.work_date
  ), day_total as (
    select x.wo, x.dt, sum(x.mins) as tm from idle_day x group by x.wo, x.dt
  ), per_reason as (
    select x.wo, x.reason_id, x.mins::numeric * coalesce(h.heads, 0) as person_minutes,
           coalesce(s.amt, 0) * x.mins / t.tm as equip
      from idle_day x
      join day_total t on t.wo = x.wo and t.dt = x.dt
      left join heads h on h.wo = x.wo and h.dt = x.dt
      left join standby s on s.wo = x.wo and s.dt = x.dt
  ), shared as (
    select p.wo, p.reason_id, sum(p.person_minutes) as person_minutes, sum(p.equip) as equip
      from per_reason p group by p.wo, p.reason_id
  )
  select i.wo, i.reason_id, r.label, i.mins,
         round(i.mins / 60.0, 2)::text,
         case when v_pm or w.hrs is null or w.hrs <= 0 then null::text else round(w.amt / w.hrs, 2)::text end,
         case when not v_full then case when w.hrs > 0 then round(i.mins / 60.0 * (w.amt / w.hrs), 2)::text end
              when w.hrs > 0 then (round(sh.person_minutes / 60.0 * (w.amt / w.hrs), 2) + round(sh.equip, 2))::text
              when sh.equip > 0 then round(sh.equip, 2)::text end,
         v_cur,
         case when w.hrs > 0 then 'counted' else 'no-rate' end,
         case when v_full and w.hrs > 0 then round(sh.person_minutes / 60.0 * (w.amt / w.hrs), 2)::text end,
         case when v_full then round(sh.equip, 2)::text end,
         case when v_full then round(sh.person_minutes / 60.0, 2)::text end
    from idle i
    join shared sh on sh.wo = i.wo and sh.reason_id = i.reason_id
    join public.dsr_idle_reasons r on r.id = i.reason_id and r.org_id = v_org
    left join wo_cost w on w.wo = i.wo
   order by i.wo, r.label, i.reason_id;
end $function$;

CREATE OR REPLACE FUNCTION public.qcr_over_contract(p_project_id uuid, p_only_over boolean DEFAULT false)
 RETURNS TABLE(boq_item_id uuid, item_code text, description text, unit text, rate numeric, earning_basis text, contract_quantity numeric, progress_quantity numeric, progress_source text, forecast_quantity numeric, over_progress boolean, over_forecast boolean, open_request_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare v_org uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  if v_org is distinct from public.auth_org_id() or not public.project_money_in_scope(p_project_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return query
  select b.id, b.item_code, b.description, b.unit, b.rate, f.earning_basis, f.contract_quantity, f.progress_quantity,
         f.progress_source, f.forecast_quantity, f.over_progress, f.over_forecast, ol.request_id
    from public.qcr_figures(array(select x.id from public.boq_items x where x.project_id = p_project_id)) f
    join public.boq_items b on b.id = f.boq_item_id
    left join public.quantity_change_request_lines ol on ol.boq_item_id = b.id and ol.is_open
   where (not p_only_over or f.over_progress or f.over_forecast)
   order by b.line_no nulls last, b.created_at, b.id;
end; $function$;

CREATE OR REPLACE FUNCTION public.get_projects_money_collection(p_project_ids uuid[])
 RETURNS TABLE(project_id uuid, actuals jsonb, ledger_basis text, active_budget_amount text, active_budget_currency text, has_active_budget boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_role public.user_role := public.auth_role();
  v_org uuid := public.auth_org_id();
  v_erp boolean;
begin
  perform public.assert_not_light();
  -- Validation order, messages and SQLSTATEs are byte-for-byte the 0700 body's (0493 asserts them).
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 or cardinality(p_project_ids) > 500 then
    raise exception 'project selection is invalid' using errcode = '22023';
  end if;
  v_erp := public.org_reads_erp_ledger();

  return query
  with requested as (
    select distinct requested.id
      from unnest(p_project_ids) requested(id)
      join public.projects p on p.id = requested.id and p.org_id = v_org and public.project_money_in_scope(p.id)
  ), proj as (
    select p.id, p.currency, o.default_currency
      from public.projects p
      join public.organizations o on o.id = p.org_id
      join requested r on r.id = p.id
  ), -- the newest Active version's currency (the loop's ORDER BY version DESC, created_at DESC, id DESC)
  active_version as (
    select distinct on (v.project_id) v.project_id, v.currency
      from public.budget_versions v
     where v.org_id = v_org and v.status = 'Active'
       and v.project_id in (select id from requested)
     order by v.project_id, v.version desc, v.created_at desc, v.id desc
  ), -- the loop's budget columns: Active presence, an unreadable line, and the Active-version sum
  active_budget as (
    select v.project_id,
           true as has_active,
           count(li.id) filter (
             where li.budgeted_amount is null
                or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')
           ) > 0 as unreadable,
           sum(li.budgeted_amount) as amount
      from public.budget_versions v
      left join public.budget_line_items li
        on li.budget_version_id = v.id and li.org_id = v.org_id
     where v.org_id = v_org and v.status = 'Active'
       and v.project_id in (select id from requested)
     group by v.project_id
  ), -- ERP Actuals: one org-wide attributed pass, the same rows project_mapped_actuals returns per project.
  -- The lateral's argument reads the gate row, so a PMO-basis org (no gate row) never runs the pass at all.
  pma as materialized (
    select a.*
      from (select null::text as fiscal_year where v_erp) gated
      cross join lateral public.project_mapped_actuals_all(gated.fiscal_year) a
     where a.project_id in (select id from requested)
  ), pma_agg as (
    select pma.project_id,
           -- get_project_finances: max(actuals_as_of) over the project's mapped-actuals rows.
           max(actuals_as_of) as as_of,
           -- get_project_finances: no mapped category, or a mapped one with no reading, leaves the total unstated.
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and actuals_to_date is null) > 0) as incomplete,
           sum(actuals_to_date) filter (where mapped) as total,
           -- 0376/0497: the same rule for the split totals the record header states beside `total`.
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and tagged_to_date is null) > 0) as tagged_incomplete,
           sum(tagged_to_date) filter (where mapped) as tagged_total,
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and attributed_to_date is null) > 0) as attributed_incomplete,
           sum(attributed_to_date) filter (where mapped) as attributed_total,
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and equipment_charge_to_date is null) > 0) as charge_incomplete,
           sum(equipment_charge_to_date) filter (where mapped) as equipment_charge_total,
           -- get_project_finances: every category, mapped flag and amount, ordered by the category enum.
           jsonb_agg(jsonb_build_object('category', category, 'mapped', mapped,
                                        'amount', actuals_to_date::text,
                                        'tagged_amount', tagged_to_date::text,
                                        'attributed_amount', attributed_to_date::text,
                                        'equipment_charge_amount', equipment_charge_to_date::text) order by category) as categories
      from pma
     group by pma.project_id
  ), pma_ok as (
    select distinct pma.project_id, category
      from pma
     where mapped and actuals_to_date is not null
  ), -- the loop's categories-complete rule: every Active-budget line category has a mapped, read actual
  category_coverage as (
    select b.project_id,
           count(distinct li.category) as n,
           count(distinct ok.category) as n_ok
      from public.budget_versions b
      join public.budget_line_items li on li.budget_version_id = b.id
      left join pma_ok ok on ok.project_id = b.project_id and ok.category = li.category
     where b.status = 'Active'
       and b.project_id in (select id from requested)
     group by b.project_id
  ), -- PMO Actuals (0700 basis): the set-based spent/committed positions, proven equal to the per-project pair
  pmp as materialized (
    select * from public.project_pmo_positions(p_project_ids)
  )
  select proj.id,
         case when v_erp then
           jsonb_set(
             jsonb_build_object(
               'currency', proj.default_currency,
               'as_of', pa.as_of,
               'excludes_restricted_rows', not coalesce(public.holds_spend_approval_authority(v_role), false),
               'total', case when pa.incomplete then null else pa.total end::text,
               'tagged_total', case when pa.tagged_incomplete then null else pa.tagged_total end::text,
               'attributed_total', case when pa.attributed_incomplete then null else pa.attributed_total end::text,
               'equipment_charge_total', case when pa.charge_incomplete then null else pa.equipment_charge_total end::text,
               'categories', coalesce(pa.categories, '[]'::jsonb)
             ),
             '{complete}',
             to_jsonb(
               coalesce(cc.n > 0 and cc.n = cc.n_ok, false)
               and coalesce(public.holds_spend_approval_authority(v_role), false)))
         else
           jsonb_build_object(
             'currency', proj.currency,
             'total', pm.spent::text,
             'as_of', null,
             'excludes_restricted_rows', false,
             'complete', pm.spent_complete,
             'committed_total', pm.committed::text,
             'committed_complete', pm.committed_complete,
             'categories', '[]'::jsonb)
         end,
         case when v_erp then 'erp' else 'pmo' end,
         case when ab.project_id is null then null
              when ab.unreadable then null
              else coalesce(ab.amount, 0)::text end,
         av.currency,
         coalesce(ab.has_active, false)
    from proj
    left join active_version av on av.project_id = proj.id
    left join active_budget ab on ab.project_id = proj.id
    left join pma_agg pa on pa.project_id = proj.id
    left join category_coverage cc on cc.project_id = proj.id
    left join pmp pm on pm.project_id = proj.id
   order by proj.id;
end $function$;

CREATE OR REPLACE FUNCTION public.project_erp_journal_lines(p_project_id uuid)
 RETURNS TABLE(erp_doctype text, voucher_no text, project_id uuid, account text, category budget_category, posting_date date, amount numeric, currency text, remarks text, party text, is_cancelled boolean, erp_url text, link_id uuid, procurement_id uuid, procurement_title text, possibly_reversed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_catalog, pg_temp
AS $function$
  select q.* from (with ln as (select * from public.erp_journal_cost_lines(public.auth_org_id(), p_project_id))
  select l.erp_doctype, l.voucher_no, l.project_id, l.account, l.category, l.posting_date, l.amount,
         o.default_currency, l.remarks, l.party, l.is_cancelled,
         case when b.site_url is null then null
              when b.external_tier = 'erpnext' then rtrim(b.site_url, '/') || '/app/journal-entry/' || l.voucher_no
              end,
         k.id, k.procurement_id, pr.title,
         k.id is not null and not l.is_cancelled and exists (
           select 1 from ln r where r.account = l.account and r.voucher_no <> l.voucher_no
              and r.amount < 0 and not r.is_cancelled and r.posting_date >= l.posting_date)
    from ln l
    join public.organizations o on o.id = public.auth_org_id()
    left join public.external_org_bindings b
      on b.org_id = o.id and b.external_tier = case when l.erp_doctype = 'account.move' then 'odoo' else 'erpnext' end
     and b.activated_at is not null
    left join public.erp_journal_line_links k
      on k.org_id = o.id and k.erp_doctype = l.erp_doctype and k.voucher_no = l.voucher_no
     and k.project_id = l.project_id and k.account = l.account
    left join public.procurements pr on pr.id = k.procurement_id
   where public.is_active_member()
     and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     and public.org_reads_erp_ledger()
     and public.project_money_in_scope(p_project_id)
   order by l.posting_date desc, l.voucher_no, l.account
) q where public.assert_not_light()
$function$;

CREATE OR REPLACE FUNCTION public.get_project_consumption(p_project_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare v_org uuid; v_cost boolean; v_months jsonb; v_allow jsonb; v_unplanned jsonb; v_erp jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost() and public.project_money_in_scope(p_project_id);                                                                  -- mut:cost_consumption
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'STK_INVALID: a valid date range is required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then   -- mut:consumption_org
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;

  select coalesce(jsonb_agg(m.j order by m.month, m.boq_code, m.item_code), '[]'::jsonb) into v_months from (
    select date_trunc('month', l.occurred_on)::date as month, b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('month', date_trunc('month', l.occurred_on)::date, 'boq_item_id', l.boq_item_id, 'boq_item_code', b.item_code,
                              'boq_description', b.description, 'item_id', l.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'issued',       trim_scale(coalesce(sum(l.issued), 0))::text,
                              'returned',     trim_scale(coalesce(sum(l.returned), 0))::text,
                              'net_consumed', trim_scale(sum(l.issued - l.returned))::text,
                              'issued_by',    coalesce(jsonb_agg(distinct pr.full_name) filter (where l.issued > 0 and pr.full_name is not null), '[]'::jsonb))
           || case when v_cost then jsonb_build_object('net_value', sum(l.value)::text) else '{}'::jsonb end as j
      from public.project_consumption_moves(v_org, p_project_id) l
      join public.boq_items b on b.id = l.boq_item_id
      join public.stock_items i on i.id = l.item_id
      join public.stock_units u on u.id = i.unit_id
      left join public.profiles pr on pr.id = l.posted_by
     where l.occurred_on between p_from and p_to
     group by date_trunc('month', l.occurred_on), l.boq_item_id, b.item_code, b.description, l.item_id, i.code, i.name, u.code) m;

  select coalesce(jsonb_agg(a.j order by a.boq_code, a.item_code), '[]'::jsonb) into v_allow from (
    select b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('id', al.id, 'boq_item_id', al.boq_item_id, 'boq_item_code', b.item_code, 'boq_description', b.description,
                              'item_id', al.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'planned_quantity', trim_scale(al.planned_quantity)::text,
                              'net_to_date', trim_scale(coalesce(c.net, 0))::text,
                              'variance',    trim_scale(coalesce(c.net, 0) - al.planned_quantity)::text,
                              'over_allowance', coalesce(c.net, 0) > al.planned_quantity) as j                                  -- mut:overflag
      from public.boq_material_allowances al
      join public.boq_items b on b.id = al.boq_item_id and b.project_id = p_project_id and b.org_id = v_org
      join public.stock_items i on i.id = al.item_id
      join public.stock_units u on u.id = i.unit_id
      left join lateral (select sum(l.issued - l.returned) as net from public.project_consumption_moves(v_org, p_project_id) l
                          where l.boq_item_id = al.boq_item_id and l.item_id = al.item_id and l.occurred_on <= p_to) c on true) a;

  select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'boq_item_code', x.boq_code, 'boq_description', x.boq_description,
                                               'item_id', x.item_id, 'item_code', x.item_code, 'item_name', x.item_name, 'unit_code', x.unit_code,
                                               'net_to_date', trim_scale(x.net)::text) order by x.boq_code, x.item_code), '[]'::jsonb) into v_unplanned from (
    select l.boq_item_id, b.item_code as boq_code, b.description as boq_description, l.item_id, i.code as item_code, i.name as item_name, u.code as unit_code,
           sum(l.issued - l.returned) as net
      from public.project_consumption_moves(v_org, p_project_id) l
      join public.boq_items b on b.id = l.boq_item_id
      join public.stock_items i on i.id = l.item_id
      join public.stock_units u on u.id = i.unit_id
     where l.occurred_on <= p_to
       and not exists (select 1 from public.boq_material_allowances al where al.boq_item_id = l.boq_item_id and al.item_id = l.item_id)
     group by l.boq_item_id, b.item_code, b.description, l.item_id, i.code, i.name, u.code having sum(l.issued - l.returned) <> 0) x;

  -- Issued material whose cost is in the project's actuals but which has no single work item: made directly in Odoo (no PMO document,
  -- attributed by the project's analytic account), or two lines of one item on the document. Listed, never silently dropped.
  select coalesce(jsonb_agg(jsonb_build_object('picking_ref', e.picking_ref, 'posting_date', e.posting_date, 'tie_state', e.tie_state,
                                               'quantity', trim_scale(e.unit_amount)::text, 'stock_document_id', e.stock_document_id)
                            || case when v_cost then jsonb_build_object('value', (e.debit - e.credit)::text) else '{}'::jsonb end
                            order by e.posting_date, e.analytic_line_id), '[]'::jsonb) into v_erp
    from public.odoo_stock_cost_lines e
   where e.org_id = v_org and not e.is_cancelled and not e.double_count_risk and e.posting_date between p_from and p_to
     and ((e.tie_state = 'no-document' and exists (select 1 from public.external_project_bindings pb
                                                   where pb.org_id = v_org and pb.external_tier = 'odoo' and pb.project_id = p_project_id
                                                     and pb.external_container_id = e.analytic_account_id))
       or (e.tie_state = 'ambiguous' and exists (select 1 from public.stock_documents d
                                                 where d.org_id = v_org and d.id = e.stock_document_id and d.project_id = p_project_id)));

  return jsonb_build_object('project_id', p_project_id, 'from', p_from, 'to', p_to, 'months', v_months, 'allowances', v_allow,
                            'unplanned', v_unplanned, 'erp_unattributed', v_erp);
end $function$;

CREATE OR REPLACE FUNCTION public.tpi_costs(p_work_order_id uuid)
 RETURNS TABLE(inspection_id uuid, currency text, committed numeric, billed numeric, estimate numeric, estimate_currency text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare v_org uuid := public.auth_org_id(); v_money boolean;
begin
  perform public.assert_not_light();
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'work order not found' using errcode = 'P0002';   -- SECURITY: another org's work order reads as absent
  end if;
  v_money := public.auth_role() in ('Admin','Executive','Finance','Project Manager')
                and public.project_money_in_scope((select w.project_id from public.work_orders w where w.id = p_work_order_id));
  if not v_money then
    return query select i.id, null::text, null::numeric, null::numeric, null::numeric, null::text
                   from public.third_party_inspections i where i.work_order_id = p_work_order_id and i.org_id = v_org
                  order by i.created_at, i.id;
    return;
  end if;
  return query
  with insp as (
    select i.id, i.work_order_id, i.procurement_id, i.created_at, i.estimate, i.estimate_currency from public.third_party_inspections i
     where i.work_order_id = p_work_order_id and i.org_id = v_org and i.status <> 'cancelled'
  ), committed as (
    select i.id as iid, po.currency, sum(po.amount) as amt
      from insp i
      join public.work_order_cost_lines l on l.source = 'purchase_order' and l.work_order_id = i.work_order_id and l.org_id = v_org
      join public.purchase_orders po on po.id = l.record_id and po.procurement_id = i.procurement_id and po.org_id = v_org
     where po.status in ('Issued','Acknowledged','Closed')                       -- a Draft order is not a commitment
       and coalesce(po.erp_docstatus, 1) <> 2 and po.erp_cancelled_at is null
       and po.amount is not null and po.amount::text not in ('NaN','Infinity','-Infinity')
     group by i.id, po.currency
  ), billed as (
    select i.id as iid, b.currency,
           sum(round(case when b.tax_treatment = 'inclusive' then b.amount - coalesce(b.tax_amount, 0) else b.amount end, 2)) as amt
      from insp i
      join public.work_order_cost_lines l on l.source = 'vendor_bill' and l.work_order_id = i.work_order_id and l.org_id = v_org
      join public.procurement_invoices b on b.id = l.record_id and b.procurement_id = i.procurement_id and b.org_id = v_org
     where b.voided_at is null and coalesce(b.erp_docstatus, 1) <> 2 and b.erp_cancelled_at is null   -- as work_order_cost_amounts (0999)
       and b.amount is not null and b.amount::text not in ('NaN','Infinity','-Infinity')
     group by i.id, b.currency
  ), merged as (
    select coalesce(c.iid, b.iid) as iid, coalesce(c.currency, b.currency) as cur, c.amt as c_amt, b.amt as b_amt
      from committed c full join billed b on b.iid = c.iid and b.currency is not distinct from c.currency
  )
  select i.id, m.cur, m.c_amt, m.b_amt, i.estimate, i.estimate_currency
    from insp i left join merged m on m.iid = i.id
   order by i.created_at, i.id, m.cur;
end $function$;

CREATE OR REPLACE FUNCTION public.get_bill_match(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_catalog, pg_temp
AS $function$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.procurement_invoices where id = p_invoice_id and org_id = public.auth_org_id())
     or not public.project_money_in_scope((select x.project_id from public.procurements x join public.procurement_invoices i on i.procurement_id = x.id where i.id = p_invoice_id)) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  return public.bill_match_evaluate(p_invoice_id);
end $function$;

CREATE OR REPLACE FUNCTION public.list_equipment_allocations(p_asset_id uuid, p_from date, p_to date, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(asset_id uuid, asset_code text, project_id uuid, project_name text, month date, basis text, setting_key uuid, version integer, status text, reason text, driver text, work_units numeric, standby_units numeric, work_rate numeric, standby_rate numeric, pool numeric, driver_value numeric, driver_total numeric, share numeric, amount numeric, category budget_category, line_count integer, entry_count integer, unit text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_org uuid := public.auth_org_id();
  -- Director ruling (2026-11-02): ledger-read stays Admin/Finance/Executive (0311). A Project Manager sees their share and the
  -- non-payroll amounts, but not the pool, its line count, the driver total, or any Employee-party amount.
  v_pm boolean := coalesce(public.auth_role()::text, '') = 'Project Manager';
begin
  perform public.assert_not_light();
  if not public.is_active_member() or coalesce(public.auth_role()::text, '') not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (p_asset_id is null and p_project_id is null) or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'name an asset or a project and a range of at most two years' using errcode = '22023';
  end if;
  return query
  select z.* from (
    with eff as materialized (select * from public.equipment_settings_effective(v_org, null))
    -- hire_rate charges
    select c.asset_id, a.code, c.project_id, p.name, c.month, 'hire_rate'::text, c.setting_key, c.version, 'allocated'::text,
           null::text, null::text, c.work_units, c.standby_units, c.work_rate, c.standby_rate, null::numeric, null::numeric,
           null::numeric, null::numeric, c.amount, c.category, case when v_pm then null else 0 end, c.entry_count, c.rate_unit
      from public.equipment_hire_charges(v_org, null, p_project_id) c
      join public.equipment_assets a on a.id = c.asset_id join public.projects p on p.id = c.project_id
     where (p_asset_id is null or c.asset_id = p_asset_id) and c.month between date_trunc('month', p_from)::date and p_to
    union all
    -- basis none / no setting on the work date: usage totals, no amount (FR-EQU-043)
    select e.asset_id, a.code, e.project_id, p.name, date_trunc('month', e.work_date)::date, 'none'::text, x.setting_key, x.version,
           'usage_only'::text, null::text, null::text, sum(e.quantity) filter (where e.kind = 'work'),
           sum(e.quantity) filter (where e.kind = 'standby'), null::numeric, null::numeric, null::numeric, null::numeric,
           null::numeric, null::numeric, null::numeric, null::public.budget_category, case when v_pm then null else 0 end, count(*)::int, e.unit
      from public.equipment_usage_entries e
      join public.equipment_assets a on a.id = e.asset_id join public.projects p on p.id = e.project_id
      left join eff x on x.asset_id = e.asset_id and e.work_date between x.window_from and x.window_to
     where e.org_id = v_org and e.status = 'Approved' and e.archived_at is null
       and (p_asset_id is null or e.asset_id = p_asset_id) and (p_project_id is null or e.project_id = p_project_id)
       and e.work_date >= date_trunc('month', p_from)::date and e.work_date < (date_trunc('month', p_to) + interval '1 month')::date
       and (coalesce(x.basis, 'none') = 'none' or (x.basis = 'hire_rate' and e.unit <> x.rate_unit))   -- never silently dropped
       -- 0471: an actual_cost version shares its pool over whole months (PQ-5), so every entry of a covered month already drives the
       -- allocation (the delete guard's month rule): each entry is counted in exactly one arm
       and not exists (select 1 from eff y where y.asset_id = e.asset_id and y.basis = 'actual_cost'
                         and date_trunc('month', e.work_date)::date >= date_trunc('month', y.window_from)::date
                         and date_trunc('month', e.work_date)::date <= y.window_to)
     group by e.asset_id, a.code, e.project_id, p.name, date_trunc('month', e.work_date), x.setting_key, x.version, e.unit
    union all
    -- 0471: actual_cost pools and shares from the engine (FR-EQU-041/042/044); an unallocated pool is a row, never dropped
    select e.asset_id, a.code, e.project_id, p.name, e.posting_date, 'actual_cost'::text, e.rule_key, e.version, e.status,
           case when e.status = 'unallocated' then 'no_approved_usage' end, e.driver, null::numeric, null::numeric,
           null::numeric, null::numeric, case when v_pm then null else e.pool end, e.driver_value,
           case when v_pm then null else e.driver_total end,
           case when e.status = 'allocated' then round(e.amount / nullif(e.pool, 0), 6) end,
           case when e.status = 'allocated' and (not v_pm or e.party_type is distinct from 'Employee') then e.amount end,
           m.category, case when v_pm then null else e.line_count end, e.entry_count, x.rate_unit
      from public.cost_attribution_engine(v_org, null, null, p_project_id, null) e
      join public.equipment_assets a on a.id = e.asset_id
      left join public.projects p on p.id = e.project_id
      left join eff x on x.id = e.rule_id
      left join public.budget_category_account_map m on m.org_id = v_org and m.erp_account = e.account
     where e.source = 'equipment' and (p_asset_id is null or e.asset_id = p_asset_id)
       and e.posting_date between date_trunc('month', p_from)::date and p_to
       and (e.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
  ) z where z.project_id is null or public.project_money_in_scope(z.project_id)
    order by 5, 4, 2;
end $function$;

CREATE OR REPLACE FUNCTION public.get_project_finances(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path = public, pg_temp
AS $function$
declare v_result jsonb; v_role public.user_role := public.auth_role();
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()) or not public.project_money_in_scope(p_project_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  with invoice_rows as (
    select si.* from public.sales_invoices si
    where si.org_id = public.auth_org_id() and si.project_id = p_project_id
      and si.status in ('Submitted','Unpaid','Paid')
      and coalesce(si.erp_docstatus,1) <> 2 and si.erp_cancelled_at is null
      and si.paired_erp_invoice_id is null   -- 0498 (#1602, PD-ECA-11): count the ERP copy once
  ), invoice_gross as (
    select i.*, case
      when i.amount is null or i.amount::text in ('NaN','Infinity','-Infinity') then null
      when i.tax_treatment = 'inclusive' then i.amount
      when i.tax_treatment = 'exclusive' and i.tax_amount is not null
        and i.tax_amount::text not in ('NaN','Infinity','-Infinity') then i.amount + i.tax_amount
      else null end as gross
    from invoice_rows i
  ), inv as (
    select currency,count(*)::int as invoice_count,
      count(*) filter(where gross is null)::int as missing_gross,
      count(*) filter(where amount is null or amount::text in ('NaN','Infinity','-Infinity'))::int as missing_amount,
      count(*) filter(where erp_outstanding_amount is null or erp_outstanding_amount::text in ('NaN','Infinity','-Infinity'))::int as missing_outstanding,
      sum(amount) as invoiced,sum(erp_outstanding_amount) as outstanding,
      sum(gross-erp_outstanding_amount) as settled,
      case when count(distinct tax_treatment) = 1 then min(tax_treatment) else 'mixed' end as tax_basis
    from invoice_gross group by currency
  ), work as (
    select w.currency,
      count(*) filter(where w.net is null or w.net::text in ('NaN','Infinity','-Infinity')
                     or w.recovery is null or w.recovery::text in ('NaN','Infinity','-Infinity'))::int as missing_work,
      sum(w.net+w.recovery) as revenue
    from public.sales_invoice_work_billed w join invoice_rows i on i.id = w.id and i.org_id = w.org_id
    where not w.is_down_payment group by w.currency
  ), chosen_budget as (
    select v.* from public.budget_versions v
    where v.org_id = public.auth_org_id() and v.project_id = p_project_id and v.status in ('Active','Draft')
    order by (v.status = 'Active') desc,v.version desc,v.created_at desc,v.id desc limit 1
  ), budget_sum as (
    select case when count(*) filter(where li.budgeted_amount is null
                    or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')) > 0 then null
                else coalesce(sum(li.budgeted_amount),0) end as amount
    from public.budget_line_items li join chosen_budget b on b.id = li.budget_version_id and b.org_id = li.org_id
  ), gl as (
    select * from public.project_finance_actuals(p_project_id)
  ), contract_rows as (
    select i.id, i.si_number, i.pmo_number, i.invoice_date,
           case when i.currency <> p.currency or p.tax_treatment not in ('inclusive','exclusive')
                     or i.tax_treatment not in ('inclusive','exclusive') or i.amount is null or i.tax_amount is null
                     or i.amount::text in ('NaN','Infinity','-Infinity') or i.tax_amount::text in ('NaN','Infinity','-Infinity')
                then null
                when i.tax_treatment = p.tax_treatment then i.amount
                when p.tax_treatment = 'inclusive' then i.amount+i.tax_amount
                else i.amount-i.tax_amount end as amount
    from invoice_rows i cross join public.projects p
    -- #1471 FR-006: only Contract billing draws down the contract. `inv`, `work`, settlement, outstanding, cash and
    -- margin inputs keep reading invoice_rows (both kinds), which is what makes FR-007 hold by construction.
    where p.id = p_project_id and i.billing_kind = 'contract'
  ), contract_sum as (
    select case when count(*) filter(where amount is null) > 0 then null
                else coalesce(sum(amount),0) end as amount from contract_rows
  ), target_invoices as (
    select si.*
      from public.sales_invoices si
     where si.org_id = public.auth_org_id() and si.project_id = p_project_id
       and si.paired_erp_invoice_id is null   -- 0498 (#1602): a paired copy never carries receipts, and none is read through it
  ), candidate_receipt_ids as (
    -- UNION deduplicates the receipt before any allocation fan-out, regardless of which identity path matched.
    -- 0731 (#1415): a PMO receipt reaches a project through its LIVE ALLOCATIONS on that project's invoices (an on-account receipt reaches none).
    select a.incoming_payment_id as id
      from public.incoming_payment_allocations a
      join target_invoices ti on ti.org_id = a.org_id and ti.id = a.sales_invoice_id
     where a.org_id = public.auth_org_id() and a.reversed_at is null
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id and ti.id = ip.sales_invoice_id
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and (ip.allocation_details is null or jsonb_array_length(ip.allocation_details) > 0)
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id
       and ip.allocation_details @> jsonb_build_array(jsonb_build_object('invoice_id', ti.id::text))
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and ip.allocation_details is not null and jsonb_array_length(ip.allocation_details) > 0
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id
      join public.external_refs er on er.org_id = ti.org_id and er.domain = 'revenue'
       and er.pmo_record_id = ti.id::text
       and ip.allocation_details @> jsonb_build_array(jsonb_build_object('invoice_number', er.external_record_id))
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and ip.allocation_details is not null and jsonb_array_length(ip.allocation_details) > 0
  ), receipt_scope as (
    select ip.*
      from public.incoming_payments ip
      join candidate_receipt_ids cr on cr.id = ip.id
     where ip.org_id = public.auth_org_id()
  ), receipt_allocations as (
    select r.id as receipt_id, r.org_id as receipt_org_id, r.sales_invoice_id as receipt_invoice_id,
           r.currency as receipt_currency, a.ordinality::int as allocation_ordinal,
           ap.invoice_id_text, ap.invoice_number_text, ap.currency_text, ap.allocation_amount,
           coalesce(ap.shape_valid, false) as shape_valid,
           by_id.id as resolved_invoice_id, by_id.project_id as resolved_invoice_project_id,
           by_id.currency as resolved_invoice_currency, by_id.pmo_native as resolved_invoice_native,
           by_id.status as resolved_invoice_status, by_id.erp_docstatus as resolved_invoice_docstatus,
           by_id.erp_cancelled_at as resolved_invoice_cancelled_at,
           by_number.id as number_invoice_id, by_number.project_id as number_invoice_project_id,
           coalesce(by_id.id, by_number.id) as source_invoice_id,
           (by_id.id is not null and by_number.id is not null and by_id.id is distinct from by_number.id) as identity_conflict,
           (by_id.id is not null and
             case when r.pmo_native then
               by_id.pmo_native and by_id.status in ('Unpaid','Paid') and by_id.erp_docstatus is null
                 and by_id.erp_cancelled_at is null and by_id.project_id = p_project_id
             else
               not by_id.pmo_native and by_id.status in ('Submitted','Unpaid','Paid') and by_id.erp_docstatus = 1
                 and by_id.erp_cancelled_at is null
             end) as invoice_lifecycle_valid,
           (ap.currency_text is not null and ap.currency_text ~ '^[A-Z]{3}$'
             and ap.currency_text = r.currency and ap.currency_text = by_id.currency) as currency_valid
      from receipt_scope r
      left join lateral jsonb_array_elements(
        case when not r.pmo_native and jsonb_typeof(r.allocation_details) = 'array'
             then r.allocation_details else '[]'::jsonb end
      ) with ordinality as a(value, ordinality) on true
      cross join lateral (
        select a.value->>'invoice_id' as invoice_id_text,
               a.value->>'invoice_number' as invoice_number_text,
               a.value->>'currency' as currency_text,
               case when length(a.value->>'amount') <= 15
                          and a.value->>'amount' ~ '^[0-9]+[.][0-9]{2}$'
                    then (a.value->>'amount')::numeric end as allocation_amount,
               (jsonb_typeof(a.value) = 'object'
                 and a.value ? 'invoice_id' and jsonb_typeof(a.value->'invoice_id') in ('string','null')
                 and a.value ? 'invoice_number' and jsonb_typeof(a.value->'invoice_number') in ('string','null')
                 and a.value ? 'amount' and jsonb_typeof(a.value->'amount') in ('string','null')
                 and a.value ? 'currency' and jsonb_typeof(a.value->'currency') in ('string','null')) as shape_valid
      ) ap
      left join public.sales_invoices by_id
        on by_id.org_id = r.org_id
       and by_id.id = case when ap.invoice_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then ap.invoice_id_text::uuid end
      left join public.external_refs er
        on er.org_id = r.org_id and er.domain = 'revenue' and er.external_record_id = ap.invoice_number_text
      left join public.sales_invoices by_number
        on by_number.org_id = r.org_id and by_number.id::text = er.pmo_record_id
  ), receipt_allocation_totals as (
    select ra.receipt_id,
           count(ra.allocation_ordinal)::int as allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (not ra.shape_valid or ra.allocation_amount is null))::int as invalid_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (ra.resolved_invoice_id is null
               or (ra.number_invoice_project_id = p_project_id and ra.resolved_invoice_id is distinct from ra.number_invoice_id)))::int as unresolved_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (not coalesce(ra.currency_valid, false)))::int as currency_mismatch_count,
           count(*) filter (where ra.allocation_ordinal is not null and ra.resolved_invoice_id is not null
             and not coalesce(ra.invoice_lifecycle_valid, false))::int as invalid_invoice_lifecycle_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and ra.resolved_invoice_project_id = p_project_id)::int as target_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and ra.resolved_invoice_project_id is distinct from p_project_id)::int as non_target_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null and ra.identity_conflict)::int as identity_conflict_count,
           coalesce(sum(ra.allocation_amount) filter (where ra.allocation_ordinal is not null
             and ra.allocation_amount is not null), 0::numeric) as allocated_total,
           coalesce(sum(ra.allocation_amount) filter (where ra.allocation_ordinal is not null
             and ra.allocation_amount is not null and ra.resolved_invoice_project_id = p_project_id), 0::numeric) as target_allocated_total,
           coalesce(bool_or(ra.source_invoice_id = ra.receipt_invoice_id) filter (where ra.allocation_ordinal is not null), false) as fk_allocation_matches
      from receipt_allocations ra
     group by ra.receipt_id
  ), native_alloc as (
    -- 0731: per PMO receipt, what its live allocations on THIS project's invoices carry in cash, and whether any of them fails the
    -- invoice lifecycle or currency check (the checks the receipt's one invoice link used to carry).
    select a.incoming_payment_id as receipt_id,
           coalesce(sum(a.cash_amount), 0::numeric) as native_cash,
           count(*) filter (where not (ni.pmo_native and ni.status in ('Unpaid','Paid') and ni.erp_docstatus is null
                                       and ni.erp_cancelled_at is null))::int as native_lifecycle_bad,
           count(*) filter (where a.currency is distinct from ni.currency or a.currency is distinct from r.currency)::int as native_currency_bad
      from public.incoming_payment_allocations a
      join target_invoices ni on ni.org_id = a.org_id and ni.id = a.sales_invoice_id
      join receipt_scope r on r.id = a.incoming_payment_id
     where a.org_id = public.auth_org_id() and a.reversed_at is null
     group by a.incoming_payment_id
  ), receipt_facts as (
    select r.*,
           coalesce(at.allocation_count, 0) as allocation_count,
           coalesce(at.invalid_allocation_count, 0) as invalid_allocation_count,
           coalesce(at.unresolved_allocation_count, 0) as unresolved_allocation_count,
           coalesce(at.currency_mismatch_count, 0) as currency_mismatch_count,
           coalesce(at.invalid_invoice_lifecycle_count, 0) as invalid_invoice_lifecycle_count,
           coalesce(at.target_allocation_count, 0) as target_allocation_count,
           coalesce(at.non_target_allocation_count, 0) as non_target_allocation_count,
           coalesce(at.identity_conflict_count, 0) as identity_conflict_count,
           coalesce(at.allocated_total, 0::numeric) as allocated_total,
           coalesce(at.target_allocated_total, 0::numeric) as target_allocated_total,
           coalesce(at.fk_allocation_matches, false) as fk_allocation_matches,
           coalesce(na.native_cash, 0::numeric) as native_cash,
           coalesce(na.native_lifecycle_bad, 0) as native_lifecycle_bad,
           coalesce(na.native_currency_bad, 0) as native_currency_bad,
           coalesce((r.cancelled_at is not null or
             (not r.pmo_native and (r.erp_cancelled_at is not null or r.erp_docstatus = 2
               or r.erp_docstatus = 0 or (r.status = 'Scheduled' and r.erp_docstatus is null)))), false) as is_excluded,
           (r.pmo_native and r.status = 'Paid' and r.erp_docstatus is null and r.erp_cancelled_at is null)
             or (not r.pmo_native and r.status = 'Paid' and r.erp_docstatus = 1
               and r.erp_cancelled_at is null and r.cancelled_at is null) as posting_confirmed,
           (r.amount is not null and r.amount::text ~ '^[0-9]+[.][0-9]{2}$' and r.amount < 1000000000000
             and r.received_amount is not null and r.received_amount::text ~ '^[0-9]+[.][0-9]{2}$'
             and r.received_amount < 1000000000000
             and r.withheld_amount is not null and r.withheld_amount::text ~ '^[0-9]+[.][0-9]{2}$'
             and r.withheld_amount < 1000000000000) as header_money_valid,
           (r.currency is not null and r.currency ~ '^[A-Z]{3}$') as receipt_currency_valid
      from receipt_scope r
      left join receipt_allocation_totals at on at.receipt_id = r.id
      left join native_alloc na on na.receipt_id = r.id
  ), receipt_reason_rows as (
    select rf.id as receipt_id, 'posting-unconfirmed'::text as reason
      from receipt_facts rf where not rf.is_excluded and not coalesce(rf.posting_confirmed, false)
    union all
    select rf.id, 'allocation-unreported'
      from receipt_facts rf where not rf.is_excluded and not rf.pmo_native and rf.allocation_details is null
    union all
    select ra.receipt_id, 'allocation-invalid'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null
       and (not ra.shape_valid or ra.allocation_amount is null)
    union all
    select ra.receipt_id, 'allocation-unresolved'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null
       and (ra.resolved_invoice_id is null
         or (ra.number_invoice_project_id = p_project_id and ra.resolved_invoice_id is distinct from ra.number_invoice_id))
    union all
    select ra.receipt_id, 'currency-mismatch'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and not coalesce(ra.currency_valid, false)
    union all
    select ra.receipt_id, 'source-inconsistent'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and ra.identity_conflict
    union all
    select ra.receipt_id, 'invoice-lifecycle'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and ra.resolved_invoice_id is not null
       and not coalesce(ra.invoice_lifecycle_valid, false)
    union all
    select rf.id, 'invoice-lifecycle'
      from receipt_facts rf where not rf.is_excluded and rf.pmo_native and rf.native_lifecycle_bad > 0
    union all
    select rf.id, 'currency-mismatch'
      from receipt_facts rf where not rf.is_excluded and
       (not coalesce(rf.receipt_currency_valid, false)
         or (rf.pmo_native and rf.native_currency_bad > 0))
    union all
    select rf.id, 'source-inconsistent'
      from receipt_facts rf where not rf.is_excluded and
       (not coalesce(rf.header_money_valid, false)
         or rf.amount is distinct from (rf.received_amount + rf.withheld_amount)
         or (not rf.pmo_native and rf.allocation_count > 0 and rf.sales_invoice_id is not null
             and not rf.fk_allocation_matches)
         or (not rf.pmo_native and rf.allocated_total > rf.amount)
         or (not rf.pmo_native and rf.withheld_amount = 0 and rf.allocated_total > rf.received_amount)
         or (not rf.pmo_native and rf.withheld_amount > 0 and rf.allocation_count > 0
             and rf.allocated_total <> rf.amount))
    union all
    select rf.id, 'ambiguous-withholding'
      from receipt_facts rf where not rf.is_excluded and not rf.pmo_native and rf.withheld_amount > 0
       and (rf.allocation_count = 0 or rf.target_allocation_count <> rf.allocation_count
         or rf.allocated_total <> rf.amount or rf.invalid_allocation_count > 0
         or rf.unresolved_allocation_count > 0 or rf.currency_mismatch_count > 0
         or rf.invalid_invoice_lifecycle_count > 0)
  ), receipt_classified as (
    select rf.*,
           coalesce((select array_agg(distinct rr.reason order by rr.reason)
                       from receipt_reason_rows rr where rr.receipt_id = rf.id), array[]::text[]) as reasons,
           case when rf.pmo_native then rf.native_cash
                when rf.withheld_amount > 0 then rf.received_amount
                else rf.target_allocated_total end as cash_amount
      from receipt_facts rf
     where not rf.is_excluded
  ), receipt_cash_buckets as (
    select rc.currency, sum(rc.cash_amount)::text as amount
      from receipt_classified rc
     where cardinality(rc.reasons) = 0
     group by rc.currency
  ), receipt_bucket_json as (
    select coalesce(jsonb_agg(jsonb_build_object('currency', b.currency, 'amount', b.amount) order by b.currency), '[]'::jsonb) as buckets
      from receipt_cash_buckets b
  ), receipt_cash_payload as (
    select case when count(*) filter (where cardinality(rc.reasons) > 0) > 0 then
      jsonb_build_object('state','incomplete','buckets','[]'::jsonb,'receipt_count',count(*)::int,
        'reasons',coalesce((select jsonb_agg(reason order by reason) from
          (select distinct reason from receipt_reason_rows) distinct_reasons),'[]'::jsonb))
      else jsonb_build_object('state','known','buckets',(select buckets from receipt_bucket_json),'receipt_count',count(*)::int)
      end as payload
      from receipt_classified rc
  )
  select jsonb_build_object(
    'project_id',p.id,
    'contract_invoiced',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                           then null else cs.amount::text end,
    'remaining_to_invoice',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                    or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                               then null else (p.contract_value-cs.amount)::text end,
    -- #1471 FR-009: present only when comparable Contract billing exceeds a known contract value. Built from the same
    -- contract_rows as contract_invoiced, so the list reconciles to contract_billing by construction.
    'contract_excess',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                              or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                              or cs.amount is null or cs.amount <= p.contract_value then null
                      else jsonb_build_object(
                        'amount',(cs.amount-p.contract_value)::text,
                        'contract_billing',cs.amount::text,
                        'contributors',coalesce((select jsonb_agg(jsonb_build_object(
                            'invoice_id',r.id,'invoice_number',coalesce(r.si_number,r.pmo_number),
                            'invoice_date',r.invoice_date,'contribution',r.amount::text)
                          order by r.invoice_date desc nulls last,r.id) from contract_rows r where r.amount <> 0),'[]'::jsonb)) end,
    'cash_received',(select payload from receipt_cash_payload),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object(
      'currency',i.currency,'invoice_count',i.invoice_count,'missing_amount',i.missing_amount,
      'missing_outstanding',i.missing_outstanding,'tax_basis',i.tax_basis,
      'invoiced',case when i.missing_amount = 0 then i.invoiced::text end,
      'outstanding',case when i.missing_outstanding = 0 then i.outstanding::text end,
      'settled',case when i.missing_gross = 0 and i.missing_outstanding = 0 then i.settled::text end,
      'work_revenue',case when coalesce(w.missing_work,0) = 0 then coalesce(w.revenue,0)::text end,
      'missing_work',coalesce(w.missing_work,0)
    ) order by i.currency) from inv i left join work w on w.currency = i.currency),'[]'::jsonb),
    'budget',(select jsonb_build_object('id',b.id,'name',b.name,'version',b.version,'status',b.status,
                                      'currency',b.currency,'amount',bs.amount::text)
              from chosen_budget b cross join budget_sum bs),
    'actuals',jsonb_build_object(
      'currency',case when public.org_reads_erp_ledger() then coalesce((select m.attrs->>'currency' from public.external_master_records m where m.org_id = p.org_id and m.external_tier = 'odoo' and m.kind = 'company' and m.tombstoned_at is null and m.attrs->>'currency' ~ '^[A-Z]{3}$' order by m.active desc, m.external_id limit 1), o.default_currency) else p.currency end,'as_of',(select max(actuals_as_of) from gl),
      'excludes_restricted_rows',not coalesce(public.holds_spend_approval_authority(v_role),false),
      'total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and actuals_to_date is null) > 0 then null
                          else sum(actuals_to_date) filter(where mapped) end::text from gl),
      -- 0376 (#1271): the split of `total` into ERP-project-tagged and rule-attributed cost.
      'tagged_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and tagged_to_date is null) > 0 then null
                          else sum(tagged_to_date) filter(where mapped) end::text from gl),
      'attributed_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and attributed_to_date is null) > 0 then null
                          else sum(attributed_to_date) filter(where mapped) end::text from gl),
      -- 0497 (#1519, FR-EQU-051): the hire-rate internal charge, inside `total`, stated on its own.
      'equipment_charge_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and equipment_charge_to_date is null) > 0 then null
                          else sum(equipment_charge_to_date) filter(where mapped) end::text from gl),
      'categories',(select jsonb_agg(jsonb_build_object('category',category,'mapped',mapped,
                                                       'amount',actuals_to_date::text,
                                                       'tagged_amount',tagged_to_date::text,
                                                       'attributed_amount',attributed_to_date::text,
                                                       'equipment_charge_amount',equipment_charge_to_date::text) order by category) from gl where category is not null)  -- 0497
    ) || coalesce((select jsonb_build_object('uncategorized', jsonb_build_object('amount', source_sum::text)) from gl where category is null), '{}'::jsonb)
  ) into v_result from public.projects p join public.organizations o on o.id = p.org_id
    cross join contract_sum cs where p.id = p_project_id;
  return v_result;
end $function$;
commit;
