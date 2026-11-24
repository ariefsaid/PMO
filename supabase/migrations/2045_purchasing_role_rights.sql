-- 2045_purchasing_role_rights.sql — purchasing rights for the Buyer, the Procurement Manager and the Quality Inspector, by job-role key.
-- Buyer (a holder of the ordering right, actor_may_order_purchases, 1845): adds supplier quotes to a purchase and selects
-- one while the purchase is Vendor Quoted (before approval, so no approved amount moves); names the supplier of an APPROVED purchase
-- that has none, through set_procurement_supplier, which changes nothing else. It approves nothing (the approval functions are unchanged).
-- Procurement Manager (held key): sets a vendor's supply-risk status.
-- Quality Inspector (held key): raises the purchase request of a third-party inspection; it becomes that request's requester, so the
-- purchase's approval chain applies to it unchanged; linking an existing purchase stays with the managers.
-- Restated from the live definitions: create_procurement_quotation and select_procurement_quote (0015 and later, with the field-account
-- guard 1530 added to their bodies), set_vendor_supply_status (1151), tpi_raise_purchase (1182). A quote's file stays with the
-- purchasing managers (its table and storage policies are unchanged).
-- drops: the role tests of the four functions (each now also admits its job role).
-- Proven by supabase/tests/2045_purchasing_role_rights.test.sql. Rollback: rollback/2045_purchasing_role_rights_down.sql

-- ── §1 quotes: the Buyer adds and selects them (quotes are written only through these two functions) ───────────────────────

CREATE OR REPLACE FUNCTION public.create_procurement_quotation(p_procurement_id uuid, p_vendor_id uuid, p_total_amount numeric, p_received_date date, p_import_key text DEFAULT NULL::text, p_import_batch_id uuid DEFAULT NULL::uuid, p_imported_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS procurement_quotations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_row public.procurement_quotations;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or (auth_role() not in ('Admin','Executive','Project Manager','Finance') and not public.actor_may_order_purchases())  -- mut:rr_buyer_quote_fn
  then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  insert into public.procurement_quotations
    (procurement_id, vendor_id, total_amount, received_date, vq_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_vendor_id, p_total_amount, p_received_date,
            next_procurement_doc_number(v_org, 'VQ'),
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $function$
;

CREATE OR REPLACE FUNCTION public.select_procurement_quote(p_quotation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org      uuid;
  v_proc     uuid;
  v_status   procurement_status;
  v_vendor   uuid;
  v_total    numeric(14,2);
  v_role     user_role := auth_role();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  -- Load the quotation + its parent PR (lock the PR row to serialize concurrent selects on the same PR).
  select q.procurement_id, q.vendor_id, q.total_amount, p.org_id, p.status
    into v_proc, v_vendor, v_total, v_org, v_status
    from public.procurement_quotations q
    join public.procurements p on p.id = q.procurement_id
   where q.id = p_quotation_id
   for update of p;
  if v_proc is null then
    raise exception 'quotation not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation + role gate (definer bypasses RLS → re-assert here). MUST stay.
  if v_org is distinct from auth_org_id()
     or (v_role not in ('Admin','Project Manager','Finance') and not public.actor_may_order_purchases())  -- mut:rr_buyer_select
  then
    raise exception 'not authorized to select a quote' using errcode = '42501';
  end if;

  -- Stage legality: a quote may only be selected while the PR is Vendor Quoted (FR-PROC-CRUD-001).
  if v_status is distinct from 'Vendor Quoted' then
    raise exception 'cannot select a quote from stage %', v_status using errcode = 'P0001';
  end if;

  -- Clear any prior selection on this PR FIRST (keeps the one-selected partial unique index valid),
  -- then mark the chosen quotation selected.
  update public.procurement_quotations
     set is_selected = false
   where procurement_id = v_proc and is_selected;
  update public.procurement_quotations
     set is_selected = true
   where id = p_quotation_id;

  -- Sync the header from the selected quote + advance the stage. One statement, one indivisible txn.
  update public.procurements
     set status      = 'Quote Selected',
         total_value = v_total,
         vendor_id   = v_vendor,
         updated_at  = now()
   where id = v_proc;
end; $function$
;


-- ── §2 the supplier of an approved purchase that has none ────────────────────────────────────────────────────────────────────────
create function public.set_procurement_supplier(p_procurement uuid, p_vendor uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_p public.procurements;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  perform public.assert_feature_on(v_org, 'procurement');
  if not (public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance')
          or coalesce(public.actor_may_order_purchases(), false)) then                                  -- mut:rr_buyer_supplier
    raise exception 'PRC_SUPPLIER_FORBIDDEN: only a purchasing manager or a person who orders purchases names the supplier' using errcode = '42501';
  end if;
  select * into v_p from public.procurements p where p.id = p_procurement and p.org_id = v_org for update;
  if not found then raise exception 'purchase not found' using errcode = 'P0002'; end if;
  if v_p.status <> 'Approved' then
    raise exception 'PRC_SUPPLIER_STEP: the supplier is named here only on an approved purchase' using errcode = '23514';
  end if;
  if v_p.vendor_id is not null then
    raise exception 'PRC_SUPPLIER_SET: this purchase already names its supplier' using errcode = '23514';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_vendor and c.org_id = v_org and c.type = 'Vendor' and c.archived_at is null) then
    raise exception 'PRC_SUPPLIER_INVALID: choose a supplier of this organisation that is not archived' using errcode = '23514';
  end if;
  update public.procurements set vendor_id = p_vendor, updated_at = now() where id = v_p.id;
  perform public.log_audit('procurement.supplier.set', v_org, auth.uid(), v_p.id, jsonb_build_object('vendor_id', p_vendor));
end $$;
comment on function public.set_procurement_supplier(uuid, uuid) is
  'Names the supplier of an approved purchase that has none; nothing else on the purchase changes. Purchasing managers or a holder of the ordering right.';
revoke all on function public.set_procurement_supplier(uuid, uuid) from public, anon;
grant execute on function public.set_procurement_supplier(uuid, uuid) to authenticated, service_role;

-- ── §3 the Procurement Manager sets supply risk ──────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_vendor_supply_status(p_company_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS companies
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row    public.companies;
  v_reason text := nullif(btrim(p_reason), '');
  v_from   text;
  v_from_reason text;
  r        record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if auth_role() not in ('Admin', 'Finance') and not public.actor_holds_job_role('procurement_manager') then  -- mut:rr_pm_risk
    raise exception 'Only Admin, Finance or the Procurement Manager can set a supplier''s supply-risk status' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'at_risk', 'inactive') then
    raise exception 'unknown supply-risk status' using errcode = '22023';
  end if;
  if p_status <> 'active' and v_reason is null then
    raise exception 'a reason is required for at_risk and inactive' using errcode = '23514';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'the reason is at most 500 characters' using errcode = '23514';
  end if;

  select * into v_row from public.companies where id = p_company_id and org_id = auth_org_id() for update;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if v_row.type <> 'Vendor' then
    raise exception 'only a vendor has a supply-risk status' using errcode = 'P0001';
  end if;
  if v_row.archived_at is not null then
    raise exception 'an archived company has no supply-risk status to set' using errcode = 'P0001';
  end if;

  v_from := v_row.supply_risk_status;
  v_from_reason := v_row.supply_risk_reason;
  if v_from = p_status and v_from_reason is not distinct from v_reason then
    return v_row;                                         -- nothing changes: no audit, no notification
  end if;

  perform set_config('pmo.vendor_supply_risk_write', 'on', true);
  update public.companies
     set supply_risk_status = p_status,
         supply_risk_reason = v_reason,
         supply_risk_set_by = auth.uid(),
         supply_risk_set_at = now()
   where id = p_company_id
   returning * into v_row;
  -- Cleared at once: the flag is transaction-local, so leaving it on would let a later direct UPDATE in the same
  -- transaction past the guard (0252's rule).
  perform set_config('pmo.vendor_supply_risk_write', '', true);

  perform public.log_audit('company.supply_risk.change', v_row.org_id, auth.uid(), v_row.id,
    jsonb_build_object('from', v_from, 'to', p_status, 'reason', v_reason, 'from_reason', v_from_reason));

  if p_status in ('at_risk', 'inactive') and v_from is distinct from p_status then
    for r in
      select e.project_id, e.project_manager_id, e.project_name,
             string_agg(coalesce(e.wo_number || ' ', '') || e.title, ', ' order by e.wo_number, e.title) as wos
        from (select distinct x.project_id, x.project_manager_id, x.project_name, x.work_order_id, x.wo_number, x.title
                from public.vendor_exposed_work_orders(p_company_id) x
               where x.kind = 'work_order' and x.project_manager_id is not null) e
       group by e.project_id, e.project_manager_id, e.project_name
    loop
      perform public.notify_workflow_user(v_row.org_id, r.project_manager_id,
        case p_status when 'at_risk' then 'Supplier marked at risk' else 'Supplier marked inactive' end,
        v_row.name || ' (' || r.project_name || '): ' || r.wos,
        'warning', 'company', v_row.id, v_row.name);
    end loop;
  end if;
  return v_row;
end; $function$
;


-- ── §4 the Quality Inspector raises an inspection's purchase request ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tpi_raise_purchase(p_id uuid, p_procurement_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v public.third_party_inspections; v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_case public.procurements; v_pid uuid; r record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member(); -- also inside tpi_load_for_update; named here so the standing AC-AMG-001 sweep sees the gate
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance')
     and not (p_procurement_id is null and public.actor_holds_job_role('quality_inspector')) then          -- mut:rr_qi_raise
    raise exception 'you cannot raise the purchase of an inspection' using errcode = '42501';
  end if;
  if v.status <> 'requested' then
    raise exception 'TPI_STEP: the purchase can be raised only while the inspection is requested' using errcode = '23514';
  end if;

  if p_procurement_id is null then
    -- A Draft case on the inspection's project with its vendor; the caller is the requester (procurement's own SoD then applies).
    v_pid := gen_random_uuid();
    perform public.create_procurement_with_items(v_pid,
      jsonb_strip_nulls(jsonb_build_object('title', coalesce(nullif(btrim(p_title), ''), 'Inspection: ' || v.title),
                                           'project_id', v.project_id, 'vendor_id', v.vendor_id)),
      '[]'::jsonb);
  else
    select * into v_case from public.procurements p where p.id = p_procurement_id and p.org_id = v_org for update;
    if not found or v_case.project_id is distinct from v.project_id then
      raise exception 'TPI_LINK_SCOPE: the purchase is not on this inspection''s project' using errcode = '23514';
    end if;
    if exists (select 1 from public.third_party_inspections o where o.procurement_id = p_procurement_id and o.id <> p_id) then
      raise exception 'TPI_LINK_HELD: another inspection already holds this purchase' using errcode = '23514';
    end if;
    if exists (select 1 from (
          select work_order_id from public.purchase_requests    where procurement_id = p_procurement_id
          union all select work_order_id from public.purchase_orders      where procurement_id = p_procurement_id
          union all select work_order_id from public.procurement_receipts where procurement_id = p_procurement_id
          union all select work_order_id from public.procurement_invoices where procurement_id = p_procurement_id) x
        where x.work_order_id is not null and x.work_order_id <> v.work_order_id) then
      raise exception 'TPI_LINK_WO: records of this purchase name another work order' using errcode = '23514';
    end if;
    v_pid := p_procurement_id;
  end if;

  begin
    update public.third_party_inspections set status = 'purchase_raised', procurement_id = v_pid,
           purchase_raised_at = now(), purchase_raised_by = v_uid, updated_at = now() where id = p_id;
  exception when unique_violation then
    raise exception 'TPI_LINK_HELD: another inspection already holds this purchase' using errcode = '23514';
  end;

  if p_procurement_id is not null then
    -- attribute the case's existing records, keeping each record's own discipline (set_cost_attribution sets both columns)
    for r in
      select 'purchase_request'::text as source, id, discipline_id from public.purchase_requests
        where procurement_id = v_pid and work_order_id is null
      union all select 'purchase_order', id, discipline_id from public.purchase_orders
        where procurement_id = v_pid and work_order_id is null
      union all select 'goods_receipt', id, discipline_id from public.procurement_receipts
        where procurement_id = v_pid and work_order_id is null
      union all select 'vendor_bill', id, discipline_id from public.procurement_invoices
        where procurement_id = v_pid and work_order_id is null and voided_at is null and erp_cancelled_at is null
    loop
      perform public.set_cost_attribution(r.source, array[r.id], v.work_order_id, r.discipline_id);
    end loop;
  end if;

  perform public.log_audit('third_party_inspection.raise_purchase', v.org_id, v_uid, p_id,
    jsonb_build_object('procurement_id', v_pid, 'linked_existing', p_procurement_id is not null));
  return v_pid;
end $function$
;
