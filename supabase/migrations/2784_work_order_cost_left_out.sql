-- 2784_work_order_cost_left_out.sql — #3026: one set-based read of amounts left out of a work order's direct cost.
-- Does NOT change which amounts count as direct cost (work_order_cost_amounts is untouched).
-- Reports only kinds with count > 0, excludes zero-cost stock (e.g. client-supplied / free-issue items),
-- omits draft stock documents, and enforces the same role, project-scope and price-visibility gates as direct cost:
--   - light/field accounts and non-cost roles are refused (42501);
--   - other orgs or projects outside project_money_in_scope read as not found (P0002);
--   - price-hidden roles (actor_may_see_prices_now() = false) receive counts only (total = null, currency = null);
--   - labour and equipment kinds are always counts only (preserving PM wage-rate privacy per ADR-0120/1933).
-- Proven by supabase/tests/2784_work_order_cost_left_out.test.sql.
-- Reverse: supabase/migrations/rollback/2784_work_order_cost_left_out_down.sql.

create or replace function public.work_order_cost_left_out(p_work_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_project_id uuid;
  v_wo_currency text;
  v_proj_currency text;
  v_org_currency text;
  v_erp boolean;
  v_show_prices boolean;
  v_labour_on boolean;
  v_stock_eff date;
  v_fin jsonb;
  v_fin_currency text;
  v_items jsonb;
begin
  perform public.assert_not_light();
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select w.project_id, w.currency, p.currency
    into v_project_id, v_wo_currency, v_proj_currency
    from public.work_orders w
    join public.projects p on p.id = w.project_id and p.org_id = w.org_id
   where w.id = p_work_order_id and w.org_id = v_org;

  if not found or not public.project_money_in_scope(v_project_id) then   -- mut:pm_scope
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  v_show_prices := public.actor_may_see_prices_now();   -- mut:hide_prices
  v_erp := public.org_reads_erp_ledger();
  v_labour_on := public.labour_cost_enabled(v_org);
  select s.effective_on into v_stock_eff from public.stock_issue_cost_settings s where s.org_id = v_org;
  select o.default_currency into v_org_currency from public.organizations o where o.id = v_org;
  v_fin := public.get_project_finances(v_project_id)->'actuals';
  v_fin_currency := v_fin->>'currency';

  with proj_purchases as materialized (
    select p.id, p.currency, p.status, p.work_order_id, public.procurement_paid_pre_tax(p) as paid
      from public.procurements p
     where not v_erp
       and p.org_id = v_org and p.project_id = v_project_id
       and p.origin is distinct from 'erp_link'
       and not public.purchase_costs_as_stock(p.id)
  ), paid_purchases as materialized (
    select distinct pay.procurement_id
      from public.payments pay
      join proj_purchases p on p.id = pay.procurement_id
     where pay.org_id = v_org and pay.status = 'Paid'
       and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
  ), linked_pay as (
    select pay.invoice_id,
           sum(pay.amount) as paid,
           bool_or(pay.amount is null or pay.amount::text in ('NaN', 'Infinity', '-Infinity')
                   or pay.currency is distinct from pr.currency) as unreadable
      from public.payments pay
      join proj_purchases pr on pr.id = pay.procurement_id
     where pay.org_id = v_org and pay.invoice_id is not null and pay.status = 'Paid'
       and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
     group by pay.invoice_id
  ), bill_linked as (
    -- The bill-linked share of what direct cost counts, as work_order_cost_amounts (2768 bill_amounts) computes it.
    select i.procurement_id, i.id,
           case when coalesce(lp.unreadable, false) or i.amount is null or i.amount::text in ('NaN', 'Infinity', '-Infinity')
                     or i.currency is distinct from pr.currency then null::numeric
                when (i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                      - coalesce(i.withheld_amount, 0)) > 0
                then round(lp.paid * (case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     / (i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                         - coalesce(i.withheld_amount, 0)), 2)
                else lp.paid end as share
      from linked_pay lp
      join public.procurement_invoices i on i.id = lp.invoice_id and i.org_id = v_org
      join proj_purchases pr on pr.id = i.procurement_id
  ), purchase_unlinked as (
    -- Paid on the purchase but not linked to a bill: direct cost counts it as the purchase balance (2768 remainders).
    select pr.id as procurement_id, pr.currency,
           case when pr.paid is null or bool_or(b.id is not null and b.share is null) then null::numeric
                else greatest(pr.paid - coalesce(sum(b.share), 0), 0) end as unlinked
      from proj_purchases pr left join bill_linked b on b.procurement_id = pr.id
     group by pr.id, pr.currency, pr.paid
  ), unpaid_bills as (
    select i.id, i.procurement_id, i.currency,
           case
             when i.amount is null or i.amount::text in ('NaN', 'Infinity', '-Infinity')
                  or coalesce(lp.unreadable, false)
                  or (lp.invoice_id is not null and i.currency is distinct from pr.currency) then null::numeric
             else greatest(
               (case when i.tax_treatment = 'inclusive' then round(i.amount - coalesce(i.tax_amount, 0), 2)
                     else round(i.amount, 2) end)
               - coalesce(
                   case
                     when lp.invoice_id is null then 0::numeric
                     when (i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                           - coalesce(i.withheld_amount, 0)) > 0
                     then round(lp.paid * (case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                                / (i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                                    - coalesce(i.withheld_amount, 0)), 2)
                     else lp.paid
                   end, 0::numeric),
               0::numeric)
           end as unpaid
      from public.procurement_invoices i
      join proj_purchases pr on pr.id = i.procurement_id
      left join linked_pay lp on lp.invoice_id = i.id
      left join public.purchase_orders po on po.id = i.po_id and po.procurement_id = pr.id and po.org_id = v_org
      left join lateral (
        select case when bool_and(x.work_order_id is not null) and count(distinct x.work_order_id) = 1
                    then min(x.work_order_id::text)::uuid end as work_order_id
          from public.procurement_receipts x
         where x.org_id = v_org and x.procurement_id = pr.id and i.po_id is not null and x.po_id = i.po_id
      ) gr on true
      left join lateral (
        select case when bool_and(x.work_order_id is not null) and count(distinct x.work_order_id) = 1
                    then min(x.work_order_id::text)::uuid end as work_order_id
          from public.purchase_requests x
         where x.org_id = v_org and x.procurement_id = pr.id
      ) rq on true
     where i.org_id = v_org and i.voided_at is null
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
       and coalesce(i.work_order_id, po.work_order_id, gr.work_order_id, rq.work_order_id) = p_work_order_id
       -- Exclude invoices on a purchase already marked Paid via unlinked payment (counted through purchase_balance).
       and not (lp.invoice_id is null and pr.status = 'Paid' and exists (select 1 from paid_purchases pp where pp.procurement_id = pr.id))
  ), unpaid_bills_open as (
    select id, procurement_id, currency, unpaid from unpaid_bills where unpaid is null or unpaid > 0
  ), bill_purchase as (
    -- ponytail: the whole unlinked paid amount is taken off this work order's bills (then its orders), so a purchase split
    -- across work orders is understated here, never double counted; prorate by work order if that ever matters.
    select b.procurement_id, count(*) as cnt, min(b.currency) as currency,
           bool_or(b.unpaid is null) or u.unlinked is null or count(distinct b.currency) > 1
             or bool_or(b.currency is distinct from u.currency) as unreadable,
           greatest(sum(b.unpaid) - coalesce(u.unlinked, 0), 0) as unpaid,                    -- mut:unlinked_cap
           greatest(coalesce(u.unlinked, 0) - coalesce(sum(b.unpaid), 0), 0) as unlinked_left
      from unpaid_bills_open b join purchase_unlinked u on u.procurement_id = b.procurement_id
     group by b.procurement_id, u.unlinked, u.currency
  ), bill_purchase_open as (
    select * from bill_purchase where unreadable or unpaid > 0
  ), open_pos as (
    select po.id, po.procurement_id, po.currency,
           case when po.amount is null or po.amount::text in ('NaN', 'Infinity', '-Infinity') then null::numeric
                else round(po.amount, 2) end as amount
      from public.purchase_orders po
      join proj_purchases pr on pr.id = po.procurement_id
     where po.org_id = v_org
       and pr.status not in ('Cancelled', 'Rejected')
       and coalesce(po.erp_docstatus, 1) <> 2 and po.erp_cancelled_at is null
       and po.status in ('Issued', 'Acknowledged', 'Closed')   -- mut:draft_po: a Draft order is not a commitment (as 2768)
       and coalesce(po.work_order_id, pr.work_order_id) = p_work_order_id
       and not exists (
         select 1 from public.procurement_invoices i
          where i.org_id = v_org and i.procurement_id = pr.id
            and (i.po_id = po.id or i.po_id is null)
            and i.voided_at is null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
       )
  ), po_purchase as (
    -- What is still paid but not yet taken by this work order's bills comes off the open orders (no double count).
    select o.procurement_id, count(*) as cnt, min(o.currency) as currency,
           bool_or(o.amount is null) or count(distinct o.currency) > 1 or bool_or(o.currency is distinct from u.currency)
             or u.unlinked is null or (bp.procurement_id is not null and bp.unreadable) as unreadable,
           greatest(sum(o.amount) - case when bp.procurement_id is not null then bp.unlinked_left else coalesce(u.unlinked, 0) end, 0) as amount
      from open_pos o
      join purchase_unlinked u on u.procurement_id = o.procurement_id
      left join bill_purchase bp on bp.procurement_id = o.procurement_id
     group by o.procurement_id, u.unlinked, u.currency, bp.procurement_id, bp.unreadable, bp.unlinked_left
  ), po_purchase_open as (
    select * from po_purchase where unreadable or amount > 0
  ), open_grs as (
    select gr.id
      from public.procurement_receipts gr
      join proj_purchases pr on pr.id = gr.procurement_id
      left join public.purchase_orders po on po.id = gr.po_id and po.org_id = v_org
     where gr.org_id = v_org
       and pr.status not in ('Cancelled', 'Rejected')
       and coalesce(gr.erp_docstatus, 1) <> 2 and gr.erp_cancelled_at is null
       and coalesce(gr.work_order_id, po.work_order_id, pr.work_order_id) = p_work_order_id
       and not exists (
         select 1 from public.procurement_invoices i
          where i.org_id = v_org and i.procurement_id = pr.id
            and (gr.po_id is null or i.po_id is null or i.po_id = gr.po_id)
            and i.voided_at is null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
       )
       and not exists (select 1 from paid_purchases pp where pp.procurement_id = pr.id)
  ), uncounted_stock_docs as (
    select d.id, -sum(l.value_delta) as val
      from public.stock_documents d
      join public.stock_ledger l on l.document_id = d.id and l.org_id = d.org_id
     where d.org_id = v_org and d.status = 'Posted' and d.work_order_id = p_work_order_id
       and ((d.kind in ('issue', 'return') and d.project_id = v_project_id) or d.kind = 'count')
       and (v_erp or v_stock_eff is null or d.occurred_on < v_stock_eff or v_proj_currency is distinct from v_org_currency)
     group by d.id
    having coalesce(-sum(l.value_delta), 0) <> 0
  ), unapproved_claims as (
    select c.id, c.currency,
           case when c.amount is null or c.amount::text in ('NaN', 'Infinity', '-Infinity') then null::numeric
                else round(c.amount, 2) end as amount
      from public.expense_claims c
     where c.org_id = v_org and c.project_id = v_project_id and c.work_order_id = p_work_order_id
       and c.kind = 'claim'
       and (
         c.status in ('Draft', 'Submitted')
         or (v_erp and c.status in ('Approved', 'Paid') and not exists (
           select 1 from public.expense_posting_erp_mirror m
            where m.org_id = v_org and m.claim_id = c.id and m.posting = 'approval' and m.push_state = 'pushed'
         ))
       )
  ), unapproved_labour_rows as (
    select e.id from public.timesheet_entries e
      join public.timesheets t on t.id = e.timesheet_id and t.org_id = e.org_id
     where e.org_id = v_org and e.project_id = v_project_id and e.work_order_id = p_work_order_id
       and e.hours > 0 and t.status <> 'Approved'
    union all
    select a.id from public.attendance_days a
     where a.org_id = v_org and a.project_id = v_project_id and a.work_order_id = p_work_order_id
       and a.status = 'present' and a.approved_at is null and a.timesheet_entry_id is null
       and (coalesce(a.hours, 0) + coalesce(a.overtime_hours, 0)) > 0
    union all
    select h.id from public.headcount_days h
     where h.org_id = v_org and h.work_order_id = p_work_order_id
       and h.approved_at is null and h.head_count > 0
  ), unrated_labour_rows as (
    select e.id from public.timesheet_entries e
      join public.timesheets t on t.id = e.timesheet_id and t.org_id = e.org_id
     where e.org_id = v_org and e.project_id = v_project_id and e.work_order_id = p_work_order_id
       and e.hours > 0 and t.status = 'Approved'
       and (not v_labour_on or not exists (select 1 from public.labour_rate_for(v_org, t.user_id, e.entry_date)))
    union all
    select d.id from public.labour_cost_attendance_days d
     where d.org_id = v_org and d.project_id = v_project_id and d.work_order_id = p_work_order_id
       and (not v_labour_on or not exists (select 1 from public.labour_attendance_priced_by(v_org, d.worker_id, d.work_date)))
    union all
    select h.id from public.headcount_days h
     where h.org_id = v_org and h.work_order_id = p_work_order_id
       and h.approved_at is not null and h.head_count > 0
       and (not v_labour_on or not exists (select 1 from public.labour_class_rate_for(v_org, h.class_id, h.work_date)))
  ), unapproved_equip_rows as (
    select e.id from public.equipment_usage_entries e
     where e.org_id = v_org and e.project_id = v_project_id and e.work_order_id = p_work_order_id
       and e.archived_at is null and e.status not in ('Approved', 'Rejected')
  ), mapped_equip_settings as materialized (
    select v.asset_id, v.rate_unit, v.window_from, v.window_to
      from public.equipment_settings_effective(v_org, null) v
     where v.basis = 'hire_rate'
       and v_fin_currency = v_org_currency
       and exists (
         select 1 from jsonb_array_elements(coalesce(v_fin->'categories', '[]'::jsonb)) c
          where c->>'category' = v.charge_category::text and (c->>'mapped')::boolean
       )
  ), unrated_equip_rows as (
    select e.id from public.equipment_usage_entries e
     where e.org_id = v_org and e.project_id = v_project_id and e.work_order_id = p_work_order_id
       and e.archived_at is null and e.status = 'Approved'
       and not exists (
         select 1 from mapped_equip_settings v
          where v.asset_id = e.asset_id and v.rate_unit = e.unit
            and e.work_date between v.window_from and v.window_to
       )
  ), kinds as (
    select 1 as ord, 'unpaid_bill'::text as kind, coalesce(sum(cnt), 0)::integer as cnt,
           case when v_show_prices and count(distinct currency) = 1 and not bool_or(unreadable)
                then min(currency) end as currency,
           case when v_show_prices and count(distinct currency) = 1 and not bool_or(unreadable)
                then round(sum(unpaid), 2)::text end as total
      from bill_purchase_open
    union all
    select 2, 'purchase_order', coalesce(sum(cnt), 0)::integer,
           case when v_show_prices and count(distinct currency) = 1 and not bool_or(unreadable)
                then min(currency) end,
           case when v_show_prices and count(distinct currency) = 1 and not bool_or(unreadable)
                then round(sum(amount), 2)::text end
      from po_purchase_open
    union all
    select 3, 'goods_receipt', count(*)::integer, null::text, null::text
      from open_grs
    union all
    select 4, 'uncounted_stock', count(*)::integer,
           case when v_show_prices then v_org_currency end,
           case when v_show_prices then round(sum(val), 2)::text end
      from uncounted_stock_docs
    union all
    select 5, 'unapproved_claim', count(*)::integer,
           case when v_show_prices and count(distinct currency) = 1 and count(*) filter (where amount is null) = 0
                then min(currency) end,
           case when v_show_prices and count(distinct currency) = 1 and count(*) filter (where amount is null) = 0
                then round(sum(amount), 2)::text end
      from unapproved_claims
    union all
    select 6, 'unapproved_labour', count(*)::integer, null::text, null::text
      from unapproved_labour_rows
    union all
    select 7, 'unrated_labour', count(*)::integer, null::text, null::text
      from unrated_labour_rows
    union all
    select 8, 'unapproved_equipment', count(*)::integer, null::text, null::text
      from unapproved_equip_rows
    union all
    select 9, 'unrated_equipment', count(*)::integer, null::text, null::text
      from unrated_equip_rows
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', k.kind,
    'count', k.cnt,
    'currency', k.currency,
    'total', k.total
  ) order by k.ord), '[]'::jsonb)
    into v_items
    from kinds k
   where k.cnt > 0;

  return jsonb_build_object(
    'workOrderId', p_work_order_id,
    'pricesHidden', not v_show_prices,
    'labourCostEnabled', v_labour_on,
    'stockIssueCostEnabled', v_stock_eff is not null,
    'items', v_items
  );
end $$;

revoke all on function public.work_order_cost_left_out(uuid) from public, anon;
grant execute on function public.work_order_cost_left_out(uuid) to authenticated;
