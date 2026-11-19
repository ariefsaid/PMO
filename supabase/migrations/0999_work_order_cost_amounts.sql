-- 0999_work_order_cost_amounts.sql — #2519: the one money read behind plan vs actual per work order.
-- Spec docs/specs/work-order-plan-vs-actual.spec.md (FR-WPVA-010..014, 032; open questions 1/2 answered below).
-- Proven by supabase/tests/0997_work_order_plan_vs_actual.test.sql.
--
-- work_order_cost_amounts(project) returns one row per cost record of the project — the same records the #2517 read
-- seam (work_order_cost_lines) lists, with the same work order and discipline — plus what each one COSTS and why.
--
-- One cost basis, every cost counted exactly once (FR-WPVA-032). `reason` says whether a row carries money:
--   counted     vendor bill, pre-tax (inclusive bills less their tax), not voided and not cancelled in the ERP;
--               posted stock issue/return at its stock-ledger value (issue +, return −);
--               approved equipment usage with an effective hire rate (quantity × rate, same rule as 0794's charge).
--   commitment  purchase request, purchase order, goods receipt: the same money the purchase's vendor bill carries,
--               so it is listed and never summed (a PO and its bill are one cost, not two).
--   stocked     a vendor bill of a purchase received into stock: its cost reaches a work order when the stock is
--               issued, at ledger value, so the bill itself is not summed (the purchase and the issue are one cost).
--   transfer    a stock transfer to a project's site: the stock is still on hand, not consumed.
--   no-rate     timesheet hours (PMO holds no labour rate) and equipment usage with no hire rate: hours, no money.
--   not-posted  a draft or cancelled stock document; equipment usage not yet approved.
-- PMO records only — this read never adds an accounting-ledger line, so a purchase that is also an ERP ledger line
-- is counted once, as its bill. (An org's ERP project ledger stays the project page's own basis; see the spec.)
--
-- Who reads: the roles that read a project's margin (Admin, Executive, Finance, Project Manager — the same gate as
-- project_finance_actuals). Anyone else is refused (42501) and the screens show the money as "restricted" — never
-- zero, never a partial sum of the rows their own RLS happens to show (FR-WPVA-013). Definer: the stock ledger and the
-- equipment rates are not readable to `authenticated` directly; the role and org gate below is the whole boundary.
--
-- ── REVERSE (also supabase/migrations/rollback/0999_work_order_cost_amounts_down.sql) ──────────────────
--   drop function if exists public.work_order_cost_amounts(uuid);

create function public.work_order_cost_amounts(p_project_id uuid)
returns table(source text, record_id uuid, project_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date,
              reference text, currency text, amount text, reason text, quantity numeric, quantity_unit text, person_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_base text;
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if public.auth_role() is null or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';   -- SECURITY: another org's project reads as absent
  end if;
  select o.default_currency into v_base from public.organizations o where o.id = v_org;

  return query
  with rates as (
    select v.asset_id, v.rate_unit, v.window_from, v.window_to, v.version, v.work_rate, v.standby_rate
      from public.equipment_settings_effective(v_org, null) v where v.basis = 'hire_rate'
  ), purchase as (
    select pr.id, pr.org_id from public.procurements pr where pr.project_id = p_project_id and pr.org_id = v_org
  ), stocked as (
    select distinct d.procurement_id from public.stock_documents d
     where d.org_id = v_org and d.kind = 'receive' and d.status = 'Posted' and d.procurement_id in (select id from purchase)
  )
  select 'purchase_request'::text, r.id, p_project_id, r.work_order_id, r.discipline_id, r.date,
         coalesce(r.pr_number, r.reference_number), r.currency, null::text, 'commitment'::text, null::numeric, null::text, null::uuid
    from public.purchase_requests r join purchase p on p.id = r.procurement_id where r.org_id = v_org
  union all
  select 'purchase_order', r.id, p_project_id, r.work_order_id, r.discipline_id, r.date,
         coalesce(r.po_number, r.reference_number), r.currency, null, 'commitment', null, null, null
    from public.purchase_orders r join purchase p on p.id = r.procurement_id where r.org_id = v_org
  union all
  select 'goods_receipt', r.id, p_project_id, r.work_order_id, r.discipline_id, r.receipt_date,
         r.gr_number, null, null, 'commitment', null, null, null
    from public.procurement_receipts r join purchase p on p.id = r.procurement_id where r.org_id = v_org
  union all
  select 'vendor_bill', i.id, p_project_id, i.work_order_id, i.discipline_id, i.invoice_date, i.vi_number, i.currency,
         case when i.amount is null or i.amount::text in ('NaN', 'Infinity', '-Infinity') then null
              else round(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end, 2)::text end,
         case when i.procurement_id in (select procurement_id from stocked) then 'stocked' else 'counted' end,
         null, null, null
    from public.procurement_invoices i join purchase p on p.id = i.procurement_id
   where i.org_id = v_org and i.voided_at is null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
  union all
  select 'stock_document', d.id, p_project_id, d.work_order_id, d.discipline_id, d.occurred_on, d.number,
         case when d.kind = 'transfer' then null else v_base end,
         case when d.kind in ('issue', 'return') and d.status = 'Posted'
              then round(-coalesce((select sum(l.value_delta) from public.stock_ledger l where l.document_id = d.id and l.org_id = v_org), 0), 2)::text end,
         case when d.kind = 'transfer' then 'transfer' when d.status = 'Posted' then 'counted' else 'not-posted' end,
         null, null, null
    from public.stock_documents d left join public.stock_warehouses w on w.id = d.to_warehouse_id and w.org_id = d.org_id
   where d.org_id = v_org
     and ((d.kind in ('issue', 'return') and d.project_id = p_project_id)
          or (d.kind = 'transfer' and w.kind = 'site' and w.project_id = p_project_id))
  union all
  select 'timesheet_entry', e.id, p_project_id, e.work_order_id, e.discipline_id, e.entry_date, null, null, null,
         'no-rate', e.hours, 'hours', t.user_id
    from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
   where e.org_id = v_org and e.project_id = p_project_id
  union all
  select 'equipment_usage', u.id, p_project_id, u.work_order_id, u.discipline_id, u.work_date, null,
         case when rate.work_rate is not null and u.status = 'Approved' then v_base end,
         case when rate.work_rate is not null and u.status = 'Approved'
              then round(u.quantity * case when u.kind = 'standby' then coalesce(rate.standby_rate, 0) else rate.work_rate end, 2)::text end,
         case when u.status <> 'Approved' then 'not-posted' when rate.work_rate is null then 'no-rate' else 'counted' end,
         u.quantity, u.unit, null
    from public.equipment_usage_entries u
    left join lateral (
      select v.work_rate, v.standby_rate from rates v
       where v.asset_id = u.asset_id and v.rate_unit = u.unit
         and u.work_date between v.window_from and v.window_to
       order by v.version desc limit 1
    ) rate on true
   where u.org_id = v_org and u.project_id = p_project_id and u.archived_at is null;
end $$;
revoke all on function public.work_order_cost_amounts(uuid) from public, anon;
grant execute on function public.work_order_cost_amounts(uuid) to authenticated;
comment on function public.work_order_cost_amounts(uuid) is
  '#2519: every cost record of one project with its work order, discipline, money (one basis, each cost once) and the reason it is or is not summed. Admin/Executive/Finance/PM only.';
