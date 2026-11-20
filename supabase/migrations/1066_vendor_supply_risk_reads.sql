-- 1066_vendor_supply_risk_reads.sql — #2583 slice 3: the supplier's payables-age SUGGESTION and EXPOSURE (read-only).
--
--   §1 vendor_supply_risk_suggestion(company)  SECURITY INVOKER (RLS applies; an other-org company reads nothing).
--        PMO basis  = the shipped payables figure at CASE level, mirroring src/lib/procurement/procurementMoney.ts
--                     `supplierUnpaid` together with the case's linked accounting-system documents
--                     (erp_purchase_documents_linked, 0360; docstatus 1, not PMO-owned — the same read
--                     /finance/payables folds in through withLinkedSupplierInvoices). A case counts only while
--                     `Vendor Invoiced`; age = whole calendar days from its earliest invoice_date to the org's today
--                     (organizations.default_timezone, never browser time); the over-60 range is age > 60
--                     (the 61-90 and over-90 payables buckets, OD-VSR-2).
--                     Voided bills are COUNTED, as the shipped rule counts them: the voided-bill rule is a change to
--                     the shared figure and ships separately (deferred, #2600). This function reads the rule as it is.
--        ERP basis  = while the org's procurement domain is externally owned (0087), the latest erp_ap_aging_snapshot
--                     generation, rows matched by party = btrim(companies.erp_supplier_name) (or a non-null company_id
--                     equal to the company when a writer supplies one), b_61_90 + b_90_plus verbatim (ADR-0048).
--                     No match is "no aging data" and NO suggestion — never `active` by default.
--      It never writes the status (FR-VSR-009). Per currency, never blended.
--   §2 vendor_exposed_work_orders(company)  SECURITY INVOKER. An OPEN order is a purchase order Issued or Acknowledged
--      on a case of the supplier (procurements.vendor_id). A work order is EXPOSED when it is Draft or Issued and at
--      least one open order names it (purchase_orders.work_order_id, 0951). Orders naming no work order come back as
--      kind 'project' rows (FR-VSR-015), listed only, never warned individually.
--
-- Rollback: supabase/migrations/rollback/1066_vendor_supply_risk_reads_down.sql.

create or replace function public.vendor_supply_risk_suggestion(p_company_id uuid) returns jsonb
  language plpgsql stable security invoker set search_path = public as $$
declare
  v_org        uuid := (select public.auth_org_id());
  v_co         public.companies%rowtype;
  v_today      date;
  v_snapshot   uuid;
  v_rows       jsonb;
  v_unknown    int := 0;
  v_oldest     int;
  v_over60     boolean;
begin
  select * into v_co from public.companies
   where id = p_company_id and org_id = v_org and type = 'Vendor';
  if not found then
    return null;
  end if;

  -- ERP basis: the accounting system is the truth; PMO invoice rows are never re-aged.
  if public.domain_externally_owned(v_org, 'procurement') then
    select s.snapshot_id into v_snapshot
      from public.erp_ap_aging_snapshot s
     where s.org_id = v_org
     order by s.as_of desc, s.created_at desc
     limit 1;
    select coalesce(jsonb_agg(jsonb_build_object(
             'currency', m.cur, 'unpaid_amount', m.tot, 'over60_amount', m.o60,
             'invoice_count', null, 'oldest_age_days', null) order by m.cur), '[]'::jsonb)
      into v_rows
      from (select s.currency as cur,
                   sum(coalesce(s.total_outstanding, 0)) as tot,
                   sum(coalesce(s.b_61_90, 0) + coalesce(s.b_90_plus, 0)) as o60
              from public.erp_ap_aging_snapshot s
             where s.org_id = v_org and s.snapshot_id = v_snapshot
               and (s.party_type is null or lower(s.party_type) = 'supplier')
               and ((nullif(btrim(v_co.erp_supplier_name), '') is not null and btrim(s.party) = btrim(v_co.erp_supplier_name))
                    or s.company_id = p_company_id)
             group by s.currency) m;
    if jsonb_array_length(v_rows) = 0 then
      return jsonb_build_object('basis', 'erp', 'suggested_status', null, 'no_aging_data', true,
                                'unknown_count', 0, 'oldest_age_days', null, 'currencies', '[]'::jsonb);
    end if;
    select bool_or((c ->> 'over60_amount')::numeric > 0) into v_over60 from jsonb_array_elements(v_rows) c;
    return jsonb_build_object('basis', 'erp',
                              'suggested_status', case when v_over60 then 'at_risk' else 'active' end,
                              'no_aging_data', false, 'unknown_count', 0, 'oldest_age_days', null,
                              'currencies', v_rows);
  end if;

  -- PMO basis.
  select (now() at time zone coalesce(o.default_timezone, 'UTC'))::date into v_today
    from public.organizations o where o.id = v_org;

  with cases as (
    select p.id, p.currency, pi.n as n_pmo, pi.d as first_date,
           case
             when pi.n = 0 and ei.n > 0 then
               case when ei.n_out_null > 0 then null else greatest(ei.s_out, 0) end
             when pi.n + ei.n = 0 then null
             when pi.n_null + ei.n_gt_null > 0 or pp.n_null + ep.n_gt_null > 0 then null
             else greatest(pi.s + ei.s_gt - (pp.s + ep.s_gt), 0)
           end as unpaid
      from public.procurements p
      left join lateral (select count(*) as n, count(*) filter (where i.amount is null) as n_null,
                                coalesce(sum(i.amount), 0) as s, min(i.invoice_date) as d
                           from public.procurement_invoices i where i.procurement_id = p.id) pi on true
      left join lateral (select count(*) as n, count(*) filter (where e.grand_total is null) as n_gt_null,
                                count(*) filter (where e.outstanding_amount is null) as n_out_null,
                                coalesce(sum(e.grand_total), 0) as s_gt, coalesce(sum(e.outstanding_amount), 0) as s_out
                           from public.erp_purchase_documents_linked e
                          where e.procurement_id = p.id and e.erp_docstatus = 1 and e.pmo_owned = false
                            and e.erp_doctype = 'Purchase Invoice') ei on true
      left join lateral (select count(*) filter (where e.grand_total is null) as n_gt_null,
                                coalesce(sum(e.grand_total), 0) as s_gt
                           from public.erp_purchase_documents_linked e
                          where e.procurement_id = p.id and e.erp_docstatus = 1 and e.pmo_owned = false
                            and e.erp_doctype = 'Payment Entry') ep on true
      left join lateral (select count(*) filter (where y.amount is null) as n_null,
                                coalesce(sum(y.amount), 0) as s
                           from public.payments y where y.procurement_id = p.id and y.status = 'Paid') pp on true
     where p.vendor_id = p_company_id and p.org_id = v_org and p.status = 'Vendor Invoiced'),
  aged as (
    select c.*, case when c.first_date is null then null else greatest(0, v_today - c.first_date) end as age
      from cases c),
  per_cur as (
    select a.currency as cur,
           sum(a.unpaid) filter (where a.unpaid > 0) as tot,
           sum(a.unpaid) filter (where a.unpaid > 0 and a.age > 60) as o60,
           sum(a.n_pmo) filter (where a.unpaid > 0 and a.age > 60) as cnt,
           max(a.age) filter (where a.unpaid > 0) as oldest
      from aged a
     group by a.currency)
  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', cur, 'unpaid_amount', coalesce(tot, 0), 'over60_amount', coalesce(o60, 0),
           'invoice_count', coalesce(cnt, 0), 'oldest_age_days', oldest) order by cur)
           filter (where coalesce(tot, 0) > 0), '[]'::jsonb),
         (select count(*) from aged where unpaid is null),
         (select max(age) from aged where unpaid > 0)
    into v_rows, v_unknown, v_oldest
    from per_cur;

  select coalesce(bool_or((c ->> 'over60_amount')::numeric > 0), false) into v_over60 from jsonb_array_elements(v_rows) c;
  return jsonb_build_object('basis', 'pmo',
                            'suggested_status', case when v_over60 then 'at_risk' else 'active' end,
                            'no_aging_data', false, 'unknown_count', v_unknown, 'oldest_age_days', v_oldest,
                            'currencies', v_rows);
end; $$;
revoke all on function public.vendor_supply_risk_suggestion(uuid) from public, anon;
grant execute on function public.vendor_supply_risk_suggestion(uuid) to authenticated;
comment on function public.vendor_supply_risk_suggestion(uuid) is
  '#2583: the supplier''s payables-age suggestion (at_risk when any unpaid balance is over 60 days old). Read-only, '
  'security invoker. PMO basis mirrors supplierUnpaid with linked ERP documents; ERP basis reads the aging snapshot.';

create or replace function public.vendor_exposed_work_orders(p_company_id uuid)
  returns table (kind text, work_order_id uuid, wo_number text, title text, wo_status text, project_id uuid,
                 project_name text, project_manager_id uuid, open_order_count integer, order_total numeric,
                 currency text)
  language sql stable security invoker set search_path = public as $$
  with open_pos as (
    select po.id, po.amount, po.work_order_id, pr.currency, pr.project_id as case_project_id
      from public.purchase_orders po
      join public.procurements pr on pr.id = po.procurement_id
      join public.companies c on c.id = pr.vendor_id
     where pr.vendor_id = p_company_id and c.org_id = (select public.auth_org_id()) and c.type = 'Vendor'
       and po.status in ('Issued', 'Acknowledged'))
  select 'work_order'::text, w.id, w.wo_number, w.title, w.status::text, w.project_id, p.name, p.project_manager_id,
         count(*)::integer, sum(o.amount), o.currency
    from open_pos o
    join public.work_orders w on w.id = o.work_order_id
    join public.projects p on p.id = w.project_id
   where w.status in ('Draft', 'Issued')
   group by w.id, w.wo_number, w.title, w.status, w.project_id, p.name, p.project_manager_id, o.currency
  union all
  select 'project'::text, null::uuid, null::text, null::text, null::text, p.id, p.name, p.project_manager_id,
         count(*)::integer, sum(o.amount), o.currency
    from open_pos o
    join public.projects p on p.id = o.case_project_id
   where o.work_order_id is null
   group by p.id, p.name, p.project_manager_id, o.currency
$$;
revoke all on function public.vendor_exposed_work_orders(uuid) from public, anon;
grant execute on function public.vendor_exposed_work_orders(uuid) to authenticated;
comment on function public.vendor_exposed_work_orders(uuid) is
  '#2583: work orders (Draft/Issued) with an open (Issued/Acknowledged) purchase order from the supplier, plus the '
  'project-level orders that name no work order. Security invoker: RLS decides what the caller sees.';

notify pgrst, 'reload schema';
