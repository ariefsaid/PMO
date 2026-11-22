-- Reverse 1882: restore 1263's body of work_order_cost_amounts_unrounded (no line split).
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
