-- Rollback of 1219: drops the light_account_deny policies it added and restores each guarded function to its pre-1219 definition
-- (copied from the migration that defines it; CREATE OR REPLACE keeps grants).
do $$
declare t text;
begin
  foreach t in array array[
    'boq_quantity_versions',
    'client_requisition_events',
    'client_requisition_lines',
    'client_requisition_pickups',
    'client_requisitions',
    'consumable_usage_standards',
    'crew_tool_lines',
    'crew_tool_report_files',
    'crew_tool_reports',
    'document_categories',
    'document_category_roles',
    'org_crew_tool_settings',
    'quantity_change_request_events',
    'quantity_change_request_files',
    'quantity_change_request_lines',
    'quantity_change_requests',
    'quantity_forecasts',
    'quantity_overrun_notices',
    'subcontract_backcharges',
    'subcontract_certificate_backcharges',
    'subcontract_certificate_claims',
    'subcontract_certificate_deselections',
    'subcontract_certificate_lines',
    'subcontract_certificates',
    'subcontractor_rate_lines',
    'third_party_inspection_files',
    'third_party_inspections',
    'work_order_consumable_plan_lines',
    'work_order_section_material_plan',
    'work_order_section_readiness_events',
    'work_order_sections']
  loop
    execute format('drop policy if exists light_account_deny on public.%I', t);
  end loop;
end $$;

-- bill_subcontract_certificate (from 1186_certificate_approval_and_bill)
create or replace function public.bill_subcontract_certificate(
  p_certificate uuid, p_invoice_date date, p_reference_number text default null, p_notes text default null,
  p_tax_treatment text default 'exclusive', p_tax_amount numeric default 0, p_tax_rate numeric default null, p_tax_template text default null)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_lines jsonb; v_amount numeric; v_inv public.procurement_invoices;
        v_state text; v_msg text; v_detail text;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin', 'Finance') then raise exception 'only Finance and Admin bill a certificate' using errcode = '42501'; end if;
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  perform 1 from public.procurements where id = c.procurement_id and org_id = v_org for update;
  perform public.subcontract_po_lock(c.po_id);
  select * into c from public.subcontract_certificates where id = p_certificate for update;
  if c.status = 'billed' then raise exception 'this certificate is already billed' using errcode = '23505', detail = 'cert-billed'; end if;
  if c.status <> 'approved' then raise exception 'only an approved certificate can be billed' using errcode = '23514'; end if;
  if c.backcharge_total > 0 and (exists (select 1 from public.external_org_bindings b where b.org_id = v_org and b.status = 'active')
                                 or public.domain_externally_owned(v_org, 'procurement')) then
    raise exception 'this organisation records bills in its ERP; a certificate with backcharges waits for the ERP route to carry the deduction'
      using errcode = '42501', detail = 'erp-deduction-unsupported'; end if;
  select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'quantity', l.measured_quantity, 'rate', l.rate) order by l.item_code),
         sum(l.amount) into v_lines, v_amount
    from public.subcontract_certificate_lines l where l.certificate_id = c.id;
  if v_lines is null or v_amount is distinct from c.gross then
    raise exception 'the frozen lines do not add up to the certificate; billing is refused' using errcode = 'SC001'; end if;
  begin
    perform set_config('pmo.spc_transition', 'on', true);
    v_inv := public.capture_subcontract_vendor_invoice(
      p_procurement_id => c.procurement_id, p_status => 'Received', p_invoice_date => p_invoice_date, p_lines => v_lines,
      p_reference_number => p_reference_number,
      p_amount => case when btrim(coalesce(p_tax_treatment, '')) = 'inclusive' then v_amount + coalesce(p_tax_amount, 0) else v_amount end,
      p_notes => p_notes, p_tax_treatment => coalesce(p_tax_treatment, 'exclusive'), p_tax_amount => coalesce(p_tax_amount, 0),
      p_tax_rate => p_tax_rate, p_tax_template => p_tax_template);
    perform public.set_cost_attribution('vendor_bill', array[v_inv.id], c.work_order_id, v_inv.discipline_id);   -- 0951 §5
    perform set_config('pmo.spc_bill', 'on', true);
    update public.procurement_invoices set deduction_amount = c.backcharge_total, certificate_id = c.id where id = v_inv.id;
    perform set_config('pmo.spc_bill', '', true);
    update public.subcontract_certificates set status = 'billed', invoice_id = v_inv.id, billed_at = now(), bill_refusal = null, bill_refusal_at = null
     where id = c.id;
    perform set_config('pmo.spc_transition', '', true);
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    v_state := sqlstate;
    if v_state in ('SC001', 'SC002', '42501', '23514', '23505', 'P0002', '22023') then
      update public.subcontract_certificates set bill_refusal = left(v_msg, 500), bill_refusal_at = now() where id = c.id;
      return jsonb_build_object('status', 'refused', 'code', v_state, 'message', v_msg);
    end if;
    raise;
  end;
  perform public.log_audit('subcontract_certificate.bill', v_org, auth.uid(), c.id, jsonb_build_object(
    'invoice_id', v_inv.id, 'gross', c.gross, 'deduction', c.backcharge_total, 'payable', c.net));
  return jsonb_build_object('status', 'billed', 'invoice_id', v_inv.id, 'payable', c.net);
end $$;

-- budget_attributed_year_sums (from 0403_budget_first_spending_year)
create or replace function public.budget_attributed_year_sums(p_project_id uuid, p_fiscal_years text[])
returns table(fiscal_year text, category public.budget_category, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.fiscal_year, m.category, sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, p_project_id) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and a.fiscal_year = any(p_fiscal_years)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by a.fiscal_year, m.category
$$;

-- cus_get_plan (from 1155_consumable_plan)
create or replace function public.cus_get_plan(p_work_order_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); wo public.work_orders; v_fp text; v_lines jsonb; v_nostd jsonb; v_unplanned jsonb;
        v_gen timestamptz; v_stale boolean;
begin
  perform public.assert_is_active_member();
  select * into wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found then
    raise exception 'CUS_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  v_fp := public.cus_plan_fingerprint(p_work_order_id);
  select max(p.generated_at), coalesce(bool_or(p.generated_at is not null and p.input_fingerprint is distinct from v_fp), false)
    into v_gen, v_stale
    from public.work_order_consumable_plan_lines p where p.work_order_id = p_work_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', p.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
           'generated_qty', p.generated_qty::text, 'adjusted_qty', p.adjusted_qty::text, 'adjust_reason', p.adjust_reason,
           'adjusted_by', p.adjusted_by, 'adjusted_at', p.adjusted_at,
           'planned_qty', coalesce(p.adjusted_qty, p.generated_qty)::text,
           'prior_qty', round(public.mrq_prior_quantity(p_work_order_id, p.item_id, '00000000-0000-0000-0000-000000000000'::uuid), 3)::text,
           'source', case when p.adjusted_qty is not null then 'adjusted' else 'standard' end,
           'basis', p.basis) order by i.code), '[]'::jsonb)
    into v_lines
    from public.work_order_consumable_plan_lines p
    join public.stock_items i on i.id = p.item_id
    join public.stock_units u on u.id = i.unit_id
   where p.work_order_id = p_work_order_id;

  select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', b.id, 'item_code', b.item_code, 'description', b.description,
                                               'unit', b.unit, 'quantity', wl.quantity::text) order by b.item_code), '[]'::jsonb)
    into v_nostd
    from public.work_order_lines wl join public.boq_items b on b.id = wl.boq_item_id
   where wl.work_order_id = p_work_order_id
     and not exists (select 1 from public.cus_plan_matches(p_work_order_id) m where m.boq_item_id = wl.boq_item_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', x.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
           'planned_qty', round(public.mrq_plan_quantity(p_work_order_id, x.item_id), 3)::text, 'prior_qty', round(x.prior, 3)::text,
           'source', case when exists (select 1 from public.work_order_lines wl
                                         join public.boq_material_allowances a on a.boq_item_id = wl.boq_item_id and a.item_id = x.item_id
                                        where wl.work_order_id = p_work_order_id) then 'allowance' else 'none' end)
           order by i.code), '[]'::jsonb)
    into v_unplanned
    from (select l.item_id, sum(l.quantity) as prior
            from public.material_request_lines l join public.material_requests r on r.id = l.request_id
           where r.work_order_id = p_work_order_id and r.status in ('pending', 'approved', 'fulfilled')
             and not exists (select 1 from public.work_order_consumable_plan_lines p
                              where p.work_order_id = p_work_order_id and p.item_id = l.item_id)
           group by l.item_id) x
    join public.stock_items i on i.id = x.item_id
    join public.stock_units u on u.id = i.unit_id;

  return jsonb_build_object('work_order_id', p_work_order_id, 'work_order_status', wo.status, 'generated_at', v_gen,
                            'out_of_date', v_stale, 'lines', v_lines, 'no_standard', v_nostd, 'unplanned', v_unplanned);
end $$;

-- mrq_section_plan_for (from 1173_work_order_section_materials)
create or replace function public.mrq_section_plan_for(p_work_order_id uuid, p_section_id uuid, p_item_ids uuid[], p_exclude_request uuid default null)
  returns table (item_id uuid, section_plan_qty numeric, section_prior_qty numeric)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  if not exists (select 1 from public.work_order_sections s where s.id = p_section_id and s.work_order_id = p_work_order_id and s.org_id = v_org) then return; end if;
  if coalesce(array_length(p_item_ids, 1), 0) > 200 then
    raise exception 'MRQ_INVALID: 200 items at most' using errcode = 'P0001'; end if;
  return query
  select i.id, public.mrq_section_plan_quantity(p_section_id, i.id),
         public.mrq_section_prior_quantity(p_section_id, i.id, coalesce(p_exclude_request, '00000000-0000-0000-0000-000000000000'::uuid))
    from public.stock_items i where i.id = any(p_item_ids) and i.org_id = v_org;
end $$;

-- qcr_approval_state (from 1178_quantity_change_reads)
create or replace function public.qcr_approval_state(p_request_id uuid)
returns table (can_approve boolean, reason text, eligible_approver_exists boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_req public.quantity_change_requests; v_reason text;
begin
  perform public.assert_is_active_member();
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id;
  if not found or v_req.org_id is distinct from public.auth_org_id() then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  v_reason := case
    when public.auth_role() not in ('Admin','Executive','Finance') then 'role'
    when v_uid = v_req.author_id then 'author'
    when v_uid = any (v_req.editor_ids) then 'editor'
    when v_uid is not distinct from v_req.submitted_by then 'submitter'
    when v_req.status <> 'pending_approval' then 'status'
  end;
  return query select v_reason is null, v_reason,
    exists (select 1 from public.profiles p
             where p.org_id = v_req.org_id and public.is_active_member(p.id) and p.role in ('Admin','Executive','Finance')
               and p.id <> v_req.author_id and p.id <> all (v_req.editor_ids)
               and p.id is distinct from v_req.submitted_by);
end; $$;

-- qcr_over_contract (from 1178_quantity_change_reads)
create or replace function public.qcr_over_contract(p_project_id uuid, p_only_over boolean default false)
returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, earning_basis text,
               contract_quantity numeric, progress_quantity numeric, progress_source text, forecast_quantity numeric,
               over_progress boolean, over_forecast boolean, open_request_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  if v_org is distinct from public.auth_org_id() then
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
end; $$;

-- qcr_work_order_budget (from 1178_quantity_change_reads)
create or replace function public.qcr_work_order_budget(p_work_order_id uuid)
returns table (request_count integer, request_limit integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select w.org_id into v_org from public.work_orders w where w.id = p_work_order_id;
  if v_org is distinct from public.auth_org_id() then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  return query select public.qcr_request_count(p_work_order_id),
                      (select o.quantity_change_limit from public.organizations o where o.id = v_org);
end; $$;

-- subcontract_certificate_view (from 1185_subcontract_certificates)
create or replace function public.subcontract_certificate_view(p_certificate uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.subcontract_certificates; v jsonb;
begin
  perform public.assert_is_active_member();
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = public.auth_org_id();
  if c.id is null or not public.spc_may_read(c.project_id) then
    raise exception 'certificate not found' using errcode = 'P0002'; end if;
  if c.status in ('draft', 'returned') then
    v := public.spc_derive(c.id);                       -- the tuples are the measured days the preparer may set aside
  else
    v := jsonb_build_object(
      'lines', coalesce((select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'item_code', l.item_code, 'unit', l.unit,
                 'measured_quantity', l.measured_quantity, 'rate', l.rate, 'po_rate', l.po_rate, 'amount', l.amount) order by l.item_code)
                 from public.subcontract_certificate_lines l where l.certificate_id = c.id), '[]'::jsonb),
      'excluded', coalesce(c.excluded, '[]'::jsonb), 'unrated', coalesce(c.unrated, '[]'::jsonb),
      'backcharges', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'amount', coalesce(s.amount, b.amount), 'reason_code', b.reason_code,
                 'reason_text', b.reason_text, 'held', false) order by b.id)
                 from public.subcontract_certificate_backcharges s join public.subcontract_backcharges b on b.id = s.backcharge_id
                where s.certificate_id = c.id), '[]'::jsonb),
      'gross', c.gross, 'backcharge_total', c.backcharge_total, 'net', c.net);
  end if;
  return jsonb_build_object('certificate', to_jsonb(c) - 'excluded' - 'unrated', 'derived', v);
end $$;

-- tpi_costs (from 1183_third_party_inspection_reads)
create or replace function public.tpi_costs(p_work_order_id uuid)
  returns table(inspection_id uuid, currency text, committed numeric, billed numeric, estimate numeric, estimate_currency text)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_money boolean;
begin
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'work order not found' using errcode = 'P0002';   -- SECURITY: another org's work order reads as absent
  end if;
  v_money := public.auth_role() in ('Admin','Executive','Finance','Project Manager');
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
end $$;

-- work_order_section_material_check (from 1173_work_order_section_materials)
create or replace function public.work_order_section_material_check(p_work_order_id uuid)
  returns table (section_id uuid, item_id uuid, plan_qty numeric, requested_qty numeric, remaining_qty numeric,
                 work_order_plan_qty numeric, over_allocated boolean)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() then return; end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then return; end if;
  if not exists (select 1 from public.work_order_sections s where s.work_order_id = p_work_order_id) then return; end if;
  return query
  with items as (
    select a.item_id from public.work_order_section_material_plan a where a.work_order_id = p_work_order_id
    union
    select l.item_id from public.material_request_lines l join public.material_requests r on r.id = l.request_id
     where r.work_order_id = p_work_order_id and r.section_id is not null
  ), wo as (
    select i.item_id, public.mrq_plan_quantity(p_work_order_id, i.item_id) as plan,
           coalesce((select sum(a.quantity) from public.work_order_section_material_plan a
                      where a.work_order_id = p_work_order_id and a.item_id = i.item_id), 0) as allocated
      from items i
  ), req as (
    select r.section_id as sid, l.item_id, sum(l.quantity) as q
      from public.material_request_lines l join public.material_requests r on r.id = l.request_id
     where r.work_order_id = p_work_order_id and r.status in ('pending', 'approved', 'fulfilled')
     group by r.section_id, l.item_id
  ), keys as (
    select s.id as sid, wo.item_id from public.work_order_sections s cross join wo where s.work_order_id = p_work_order_id
       and (exists (select 1 from public.work_order_section_material_plan a where a.section_id = s.id and a.item_id = wo.item_id)
            or exists (select 1 from req where req.sid = s.id and req.item_id = wo.item_id))
    union all
    select null::uuid, wo.item_id from wo
  )
  select k.sid, k.item_id,
         case when k.sid is null then wo.plan - wo.allocated
              else (select a.quantity from public.work_order_section_material_plan a where a.section_id = k.sid and a.item_id = k.item_id) end,
         coalesce((select req.q from req where req.sid is not distinct from k.sid and req.item_id = k.item_id), 0),
         case when k.sid is null then wo.plan - wo.allocated - coalesce((select req.q from req where req.sid is null and req.item_id = k.item_id), 0)
              else (select a.quantity from public.work_order_section_material_plan a where a.section_id = k.sid and a.item_id = k.item_id)
                   - coalesce((select req.q from req where req.sid = k.sid and req.item_id = k.item_id), 0) end,
         wo.plan, wo.allocated > wo.plan
    from keys k join wo on wo.item_id = k.item_id
   order by (k.sid is null), k.sid, k.item_id;
end $$;
