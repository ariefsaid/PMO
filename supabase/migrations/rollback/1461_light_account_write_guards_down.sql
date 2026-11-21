-- Rollback of 1461: restores each guarded write-side function to its pre-1461 definition, copied whole from the branch head
-- (the LATEST definition of each on the migrations before 1461). CREATE OR REPLACE keeps signature, language, volatility,
-- search_path and grants; only the body differs (1461 added the assert_not_light line). No policy and no table is touched.
CREATE OR REPLACE FUNCTION public.add_equipment_downtime_proof(p_asset uuid, p_proof_date date, p_file_name text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid := public.auth_org_id(); v_id uuid := gen_random_uuid(); v_name text := btrim(coalesce(p_file_name,'')); v_st text;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 200 or v_name ~ '[/\\]' then raise exception 'file name is invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.equipment_assets a where a.id = p_asset and a.org_id = v_org) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  select s.status into v_st from public.equipment_status_days s where s.asset_id = p_asset and s.org_id = v_org and s.status_date = p_proof_date;
  if v_st is null or v_st in ('ready','standby') then raise exception 'proof attaches to a down day' using errcode = '22023'; end if;
  insert into public.equipment_downtime_proofs (id, org_id, asset_id, proof_date, file_name, file_path, note)
  values (v_id, v_org, p_asset, p_proof_date, v_name, v_org::text || '/' || p_asset::text || '/' || v_id::text || '/' || v_name, nullif(btrim(coalesce(p_note,'')), ''));
  return jsonb_build_object('id', v_id, 'path', v_org::text || '/' || p_asset::text || '/' || v_id::text || '/' || v_name);
end $function$
;

CREATE OR REPLACE FUNCTION public.archive_equipment_usage(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_e public.equipment_usage_entries; v_claim uuid;
begin
  perform public.assert_is_active_member();
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found or v_e.org_id is distinct from public.auth_org_id() then raise exception 'entry not found' using errcode = 'P0002'; end if;
  -- Authorize before naming a live claim: the claim id is only for a caller who may archive this usage.
  if not (v_e.author_id is not distinct from auth.uid() and v_e.status in ('Draft','Rejected')) and public.auth_role() is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if public.tm_source_is_live('equipment_usage', p_id) then
    select s.claim_id into v_claim from public.tm_claim_sources s where s.source_kind = 'equipment_usage' and s.source_id = p_id and s.is_live limit 1;
    raise exception 'equipment usage belongs to live claim %', v_claim using errcode = '55000';
  end if;
  if v_e.status = 'Approved' then raise exception 'reopen approved usage before archiving it' using errcode = '22023'; end if;
  update public.equipment_usage_entries set archived_at = now(), updated_at = now() where id = p_id and archived_at is null;
  perform public.log_audit('equipment_usage.archive', v_e.org_id, auth.uid(), p_id, jsonb_build_object('status', v_e.status));
end $function$
;

CREATE OR REPLACE FUNCTION public.audit_agent_denial(p_reason text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  -- action / org / actor are stamped SERVER-SIDE from the auth context → the caller cannot forge
  -- them. Only p_reason + p_detail (annotation: attempted tool/action, thread/run id) are caller-
  -- supplied, and they land ONLY in `detail`.
  perform public.log_audit(
    'agent.permission_denied',
    public.auth_org_id(),
    auth.uid(),
    null,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
  );
end; $function$
;

CREATE OR REPLACE FUNCTION public.cancel_native_receipt(p_receipt_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rc     public.incoming_payments%rowtype;
  v_uid    uuid      := auth.uid();
  v_role   user_role := public.auth_role();
  v_inv    uuid[];
  v_id     uuid;
  v_revd   int;
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  -- FR-PLN-006 closure: reversing a receipt recorded while the module was on is a CLOSING transition and is
  -- deliberately NOT gated, so a switch-off never strands a transaction that already exists.
  perform public.assert_is_active_member();
  select * into v_rc from public.incoming_payments where id = p_receipt_id;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if v_rc.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can cancel a customer receipt' using errcode = '42501';
  end if;
  if not v_rc.pmo_native then
    raise exception 'receipts recorded in the ERP are cancelled there' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  -- Serialise with an ERP take-over of revenue BEFORE reading who owns it — the same org-row lock
  -- create_native_sales_invoice takes. After the org row, the locks go invoices (ascending id) -> receipt.
  perform 1 from public.organizations o where o.id = v_rc.org_id for share;
  if public.domain_externally_owned(v_rc.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  select coalesce(array_agg(distinct a.sales_invoice_id), '{}') into v_inv from public.incoming_payment_allocations a
   where a.incoming_payment_id = p_receipt_id and a.reversed_at is null;
  perform 1 from public.sales_invoices si where si.id = any(v_inv) and si.org_id = v_rc.org_id order by si.id for update;
  select * into v_rc from public.incoming_payments where id = p_receipt_id for update;
  if v_rc.cancelled_at is not null then
    raise exception 'this receipt is already cancelled' using errcode = 'P0001', detail = 'receipt-already-cancelled';
  end if;
  -- The set was read before the locks: if an apply grew it in between, retry rather than restate a stale set.
  if exists (select 1 from public.incoming_payment_allocations a
              where a.incoming_payment_id = p_receipt_id and a.reversed_at is null and a.sales_invoice_id <> all (v_inv)) then
    raise exception 'the receipt changed while it was being cancelled: try again' using errcode = '40001';
  end if;

  update public.incoming_payment_allocations set reversed_at = now(), reversed_by = v_uid
   where incoming_payment_id = p_receipt_id and reversed_at is null;
  get diagnostics v_revd = row_count;
  update public.incoming_payments set cancelled_at = now() where id = p_receipt_id;
  for v_id in select x from unnest(v_inv) x order by x loop
    perform public.native_invoice_restate(v_id);
  end loop;

  -- outstanding_after / overpaid_after: the origin invoice's restated figures (the 0275 audit shape); 'invoices' lists every restated invoice.
  perform public.log_audit('incoming_payment.cancel', v_rc.org_id, v_uid, p_receipt_id,
    jsonb_build_object('sales_invoice_id', v_rc.sales_invoice_id, 'amount', v_rc.amount, 'pmo_number', v_rc.pmo_number,
                       'allocations_reversed', v_revd,
                       'outstanding_after', (select si.erp_outstanding_amount from public.sales_invoices si where si.id = v_rc.sales_invoice_id and si.id = any(v_inv)),
                       'overpaid_after', (select si.overpaid_amount from public.sales_invoices si where si.id = v_rc.sales_invoice_id and si.id = any(v_inv)),
                       'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', si.id, 'outstanding_after', si.erp_outstanding_amount) order by si.id), '[]'::jsonb)
                                      from public.sales_invoices si where si.id = any(v_inv))));
end; $function$
;

CREATE OR REPLACE FUNCTION public.cancel_retention_release(p_release uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r public.retention_releases; v_c public.progress_claims;
begin
  perform public.assert_is_active_member();
  select * into v_r from public.retention_releases r where r.id = p_release and r.org_id = public.auth_org_id();
  if not found then perform public.lock_retention_claim(null); end if;
  v_c := public.lock_retention_claim(v_r.claim_id);
  delete from public.retention_releases r where r.id = p_release;   -- the guard refuses a recorded one
  perform public.log_audit('retention_release.cancel', v_c.org_id, auth.uid(), v_c.id,
    jsonb_build_object('release_id', p_release, 'amount', v_r.amount));
end; $function$
;

CREATE OR REPLACE FUNCTION public.cancel_stock_document(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.stock_documents; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member();
  -- FR-PLN-006 closure: cancelling a DRAFT document writes nothing to the ledger; a switch-off must not
  -- strand a draft minted while the module was on.
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = public.auth_org_id() for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: a posted or cancelled document cannot be cancelled' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid and not coalesce(public.role_rank(public.auth_role()) >= 50, false) then
    raise exception 'only the author or an Admin cancels a draft' using errcode = '42501'; end if;
  update public.stock_documents set status = 'Cancelled', cancelled_by = v_uid, cancelled_at = now() where id = d.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.close_crew_tool_report(p_report uuid, p_resolution text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_rep public.crew_tool_reports; v_line public.crew_tool_lines; v_assignee uuid;
begin
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if p_resolution not in ('replaced', 'repaired', 'written_off') then
    raise exception 'invalid resolution' using errcode = '22023';
  end if;
  select * into v_rep from public.crew_tool_reports r where r.id = p_report and r.org_id = v_org;
  if v_rep.id is null then raise exception 'tool report not found' using errcode = 'P0002'; end if;
  select * into v_line from public.crew_tool_lines l where l.id = v_rep.line_id for update;
  select * into v_rep from public.crew_tool_reports r where r.id = p_report for update;
  if v_rep.task_id is not null then select t.assignee_id into v_assignee from public.tasks t where t.id = v_rep.task_id; end if;
  -- the reporter closes nothing unless they are also the assignee or a crew manager (AC-CTR-008)
  if not (public.crew_can_manage() or v_assignee = v_uid) then
    raise exception 'CTR_NOT_ALLOWED: only the task assignee or a crew manager closes a tool report' using errcode = '42501';
  end if;
  if v_rep.status <> 'open' then
    raise exception 'CTR_REPORT_CLOSED: already closed as %', v_rep.resolution using errcode = '23514', detail = v_rep.resolution;
  end if;
  if p_resolution = 'repaired' and v_rep.kind <> 'damaged' then
    raise exception 'CTR_RESOLUTION: only a damaged tool can be repaired' using errcode = '23514';
  end if;

  perform set_config('pmo.crew_tool_rpc', 'on', true);
  update public.crew_tool_reports
     set status = 'closed', resolution = p_resolution, closed_by = v_uid, closed_at = now() where id = v_rep.id;
  if p_resolution = 'written_off' then
    update public.crew_tool_lines set held_qty = held_qty - v_rep.qty where id = v_line.id;
  end if;
  if v_rep.task_id is not null then
    update public.tasks set status = 'Done', completed_at = coalesce(completed_at, now())
     where id = v_rep.task_id and status <> 'Done';
  end if;
  perform public.log_audit('crew_tool.close', v_org, v_uid, v_rep.id,
    jsonb_build_object('resolution', p_resolution, 'qty', v_rep.qty, 'kind', v_rep.kind));
  perform set_config('pmo.crew_tool_rpc', 'off', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.complete_billing_stage(p_stage uuid, p_completed_on date, p_client_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s    public.claim_billing_stages;
  v_prev date;
  v_ref  text := nullif(btrim(p_client_reference), '');
begin
  perform public.assert_is_active_member();
  if p_stage is null then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  v_s := public.lock_billing_stage_claim(p_stage);
  if exists (select 1 from public.claim_billing_stages s where s.claim_id = v_s.claim_id and s.position < v_s.position and s.completed_on is null) then
    raise exception 'complete the earlier billing stages first' using errcode = '55000', detail = 'stage-out-of-order';
  end if;
  if exists (select 1 from public.claim_billing_stage_documents d where d.stage_id = v_s.id and d.required and d.document_id is null) then
    raise exception 'attach every required document before completing this stage' using errcode = '55000', detail = 'stage-documents-missing';
  end if;
  if p_completed_on is null or p_completed_on > public.native_org_today(v_s.org_id) then
    raise exception 'the completion date cannot be in the future' using errcode = '22023', detail = 'stage-date-future';
  end if;
  select max(s.completed_on) into v_prev from public.claim_billing_stages s where s.claim_id = v_s.claim_id and s.position < v_s.position;
  if p_completed_on < coalesce(v_prev, v_s.started_on) then
    raise exception 'a stage cannot complete before the previous one' using errcode = '22023', detail = 'stage-date-before-previous';
  end if;
  if v_s.client_side and v_ref is null then
    raise exception 'record the client''s document number for a step done in the client''s system'
      using errcode = '23514', detail = 'client-reference-missing';
  end if;

  update public.claim_billing_stages s
     set completed_on = p_completed_on, client_reference = v_ref, note = coalesce(nullif(btrim(p_note), ''), s.note),
         completed_by = auth.uid(), completed_at = now()
   where s.id = v_s.id;
  update public.claim_billing_stages s set started_on = p_completed_on
   where s.claim_id = v_s.claim_id
     and s.position = (select min(s2.position) from public.claim_billing_stages s2 where s2.claim_id = v_s.claim_id and s2.position > v_s.position);
  perform public.log_audit('billing_stage.complete', v_s.org_id, auth.uid(), v_s.claim_id,
    jsonb_build_object('stage_id', v_s.id, 'position', v_s.position, 'completed_on', p_completed_on, 'client_reference', v_ref));
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_procurement_receipt(p_procurement_id uuid, p_status procurement_receipt_status, p_receipt_date date, p_reference_number text DEFAULT NULL::text, p_import_key text DEFAULT NULL::text, p_import_batch_id uuid DEFAULT NULL::uuid, p_imported_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS procurement_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org       uuid;
  v_requester uuid;
  v_row       public.procurement_receipts;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  select org_id, requested_by_id into v_org, v_requester
    from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (auth_role() = 'Admin'
          or auth_role() = 'Project Manager'
          or (auth.uid() is not null and auth.uid() = v_requester))
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's GR writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_procurement_id), false) then   -- ECA-4 (PD-ECA-9)
    raise exception 'procurement is externally-owned — goods receipts route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  insert into public.procurement_receipts
    (procurement_id, status, receipt_date, gr_number, reference_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_receipt_date,
            next_procurement_doc_number(v_org, 'GR'), p_reference_number,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_procurement_with_items(p_id uuid, p_header jsonb, p_items jsonb)
 RETURNS procurements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_parent public.procurements%rowtype; v_item record; v_existing public.procurement_items%rowtype;
  v_project uuid; v_vendor uuid; v_category public.budget_category;
  v_intent public.procurement_create_intents%rowtype;
  v_subcontract boolean;                                                                          -- 0449
begin
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or jsonb_typeof(p_header) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_header->'title') is distinct from 'string'
     or exists (select 1 from jsonb_object_keys(p_header) k where k not in ('title','project_id','vendor_id','budget_category','is_subcontract'))   -- 0449
     or (p_header ? 'is_subcontract' and jsonb_typeof(p_header->'is_subcontract') is distinct from 'boolean')                                      -- 0449
     or exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
          or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','name','description','quantity','rate'))
          or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'name') is distinct from 'string'
          or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'rate') is distinct from 'number'
          or (x ? 'description' and jsonb_typeof(x->'description') not in ('string','null'))) then
    raise exception 'Invalid procurement input' using errcode = '22023';
  end if;
  v_project := (p_header->>'project_id')::uuid; v_vendor := (p_header->>'vendor_id')::uuid;
  v_category := (p_header->>'budget_category')::public.budget_category;
  v_subcontract := coalesce((p_header->>'is_subcontract')::boolean, false);                       -- 0449
  if (v_project is not null and not exists (select 1 from public.projects where id=v_project and org_id=v_org))
     or (v_vendor is not null and not exists (select 1 from public.companies where id=v_vendor and org_id=v_org)) then
    raise exception 'Reference is not available' using errcode = '23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x group by (x->>'id')::uuid having count(*) > 1) then
    raise exception 'Duplicate line ID' using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_intent from public.procurement_create_intents where procurement_id=p_id;
  if found and (v_intent.org_id is distinct from v_org or v_intent.actor_id is distinct from v_uid
      or v_intent.header is distinct from p_header or v_intent.items is distinct from p_items) then
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  insert into public.procurements (id,org_id,requested_by_id,title,project_id,vendor_id,budget_category,is_subcontract)   -- 0449
  values (p_id,v_org,v_uid,p_header->>'title',v_project,v_vendor,v_category,v_subcontract)                              -- 0449
  on conflict (id) do nothing;
  select * into v_parent from public.procurements where id=p_id for update;
  if v_parent.org_id is distinct from v_org or v_parent.requested_by_id is distinct from v_uid
     or v_parent.status <> 'Draft' then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if v_parent.title is distinct from p_header->>'title' or v_parent.project_id is distinct from v_project
     or v_parent.vendor_id is distinct from v_vendor or v_parent.budget_category is distinct from v_category
     or v_parent.is_subcontract is distinct from v_subcontract then                                                     -- 0449
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  for v_item in select * from jsonb_to_recordset(p_items) as x(id uuid,name text,description text,quantity numeric,rate numeric) loop
    insert into public.procurement_items (id,org_id,procurement_id,name,description,quantity,rate)
    values (v_item.id,v_org,p_id,v_item.name,v_item.description,v_item.quantity,v_item.rate)
    on conflict (id) do nothing;
    select * into v_existing from public.procurement_items where id=v_item.id;
    if v_existing.org_id is distinct from v_org or v_existing.procurement_id is distinct from p_id
       or v_existing.name is distinct from v_item.name or v_existing.description is distinct from v_item.description
       or v_existing.quantity is distinct from round(v_item.quantity,2) or v_existing.rate is distinct from round(v_item.rate,2) then
      raise exception 'Saved procurement line differs from request' using errcode = '23505';
    end if;
  end loop;
  if exists (select 1 from public.procurement_items i where i.procurement_id=p_id and i.org_id=v_org
       and not exists (select 1 from jsonb_array_elements(p_items) x where (x->>'id')::uuid=i.id)) then
    raise exception 'Saved procurement lines differ from request' using errcode = '23505';
  end if;
  insert into public.procurement_create_intents (procurement_id,org_id,actor_id,header,items)
  values (p_id,v_org,v_uid,p_header,p_items) on conflict (procurement_id) do nothing;
  return v_parent;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_stock_document(p_header jsonb, p_lines jsonb, p_post boolean DEFAULT false, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); v_kind text; v_wh uuid; v_occ date; v_doc public.stock_documents; v_id uuid; v_override boolean;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if p_client_request_id is not null then                                                               -- D7: replay returns the original
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(p_post, false) then perform public.stock_assert_standalone(v_org); end if;                -- D6, before any write
  v_kind := p_header->>'kind';
  perform public.stock_validate_payload(v_org, v_kind, p_header, p_lines);
  v_wh := (p_header->>'warehouse_id')::uuid;
  v_override := public.stock_assert_keeper(v_org, v_wh, v_uid);                                         -- PQ-1: authors are keepers (or Admin)
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, public.stock_org_today(v_org));
  perform public.stock_assert_dates(v_org, v_occ);
  insert into public.stock_documents (org_id, number, kind, warehouse_id, to_warehouse_id, project_id, procurement_id, reason, note,
                                      occurred_on, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix(v_kind)), v_kind, v_wh,
          nullif(p_header->>'to_warehouse_id', '')::uuid, case when v_kind = 'issue' then nullif(p_header->>'project_id', '')::uuid end,
          nullif(p_header->>'procurement_id', '')::uuid, nullif(btrim(p_header->>'reason'), ''), nullif(btrim(p_header->>'note'), ''),
          v_occ, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning * into v_doc;
  if v_doc.id is null then                                                                               -- lost a race to a concurrent replay
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.stock_insert_lines(v_doc, p_lines);
  perform public.stock_apply(v_doc, false);                                                              -- static validation per kind
  if coalesce(p_post, false) then perform public.stock_post_core(v_doc.id);                              -- a post audits its own override
  elsif v_override then
    perform public.log_audit('stock.admin_author', v_org, v_uid, v_doc.id, jsonb_build_object('kind', v_kind, 'warehouse_id', v_wh, 'number', v_doc.number));
  end if;
  return v_doc.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.csr_cancel(p_requisition_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); r public.client_requisitions;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.client_requisitions x where x.id = p_requisition_id and x.org_id = v_org for update;
  if not found then raise exception 'CSR_NOT_FOUND: the requisition is not in your organisation' using errcode = 'P0001'; end if;
  perform public.csr_assert_author(r.created_by);
  if r.status not in ('draft','open') then
    raise exception 'CSR_NOT_CANCELLABLE: only a draft or open requisition can be cancelled' using errcode = 'P0001'; end if;
  if exists (select 1 from public.client_requisition_pickups p where p.requisition_id = r.id) then
    raise exception 'CSR_HAS_PICKUP: a pickup is already posted, so the requisition cannot be cancelled' using errcode = 'P0001'; end if;
  update public.client_requisitions set status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), updated_at = now() where id = r.id;
  perform public.csr_log(v_org, r.id, null, 'cancelled', null, null, null, left(nullif(btrim(p_reason), ''), 1000), null, null);
end $function$
;

CREATE OR REPLACE FUNCTION public.csr_create(p_header jsonb, p_lines jsonb, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); v_wo record; v_id uuid; v_ref text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_client_request_id is not null then
    select x.id into v_id from public.client_requisitions x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select w.id, w.project_id, w.status into v_wo from public.work_orders w
   where w.id = nullif(p_header->>'work_order_id', '')::uuid and w.org_id = v_org;
  if v_wo.id is null then raise exception 'CSR_WORK_ORDER: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo.status not in ('Draft','Issued') then
    raise exception 'CSR_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_ref := nullif(btrim(p_header->>'client_reference'), '');
  if v_ref is not null and length(v_ref) > 120 then
    raise exception 'CSR_INVALID: the client reference is 120 characters at most' using errcode = 'P0001'; end if;
  perform public.csr_validate_lines(v_org, v_wo.id, p_lines);
  insert into public.client_requisitions (org_id, number, work_order_id, project_id, client_reference, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, 'CSR'), v_wo.id, v_wo.project_id, v_ref, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning id into v_id;
  if v_id is null then                                                   -- lost a race to a concurrent replay
    select x.id into v_id from public.client_requisitions x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.csr_insert_lines(v_org, v_id, p_lines);
  perform public.csr_log(v_org, v_id, null, 'created', null, null, null, null, null, p_client_request_id);
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.csr_record_pickup(p_line_id uuid, p_quantity numeric, p_warehouse_id uuid, p_picked_up_on date DEFAULT NULL::date, p_collector text DEFAULT NULL::text, p_paper_reference text DEFAULT NULL::text, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid; v_uid uuid := auth.uid(); l public.client_requisition_lines; r public.client_requisitions; f record;
  v_zero boolean; v_whole boolean; v_on date; v_doc uuid; v_pickup uuid; v_still numeric; v_collector text; v_paper text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_client_request_id is not null then                                                                      -- FR-CSR-015: a replay returns the original
    select p.id into v_pickup from public.client_requisition_pickups p
     where p.org_id = v_org and p.recorded_by = v_uid and p.client_request_id = p_client_request_id;
    if v_pickup is not null then return v_pickup; end if;
  end if;
  perform public.stock_assert_standalone(v_org);                                                               -- FR-CSR-016: before any row
  l := public.csr_lock_line(v_org, p_line_id);
  select * into r from public.client_requisitions x where x.id = l.requisition_id;
  select coalesce(t.zero_cost, false), u.whole_only into v_zero, v_whole
    from public.stock_items i join public.stock_units u on u.id = i.unit_id left join public.stock_tags t on t.id = i.tag_id
   where i.id = l.stock_item_id;
  if not coalesce(v_zero, false) then                                                                          -- mut:zero_cost_tag
    raise exception 'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied' using errcode = 'P0001'; end if;
  if not public.csr_valid_quantity(p_quantity, coalesce(v_whole, false)) then
    raise exception 'CSR_INVALID: a pickup needs a quantity above 0 (3 decimals at most, whole units where the unit demands it)' using errcode = 'P0001'; end if;
  v_collector := nullif(btrim(p_collector), '');
  v_paper := nullif(btrim(p_paper_reference), '');
  if length(coalesce(v_collector, '')) > 200 or length(coalesce(v_paper, '')) > 200 then
    raise exception 'CSR_INVALID: the collector and the delivery paper reference are 200 characters at most' using errcode = 'P0001'; end if;
  select * into f from public.csr_line_figures(l.id);
  v_still := f.reserved - f.collected;
  if p_quantity > v_still then                                                                                 -- mut:still_to_collect
    raise exception 'CSR_OVER_COLLECT: only % is still to collect', trim_scale(greatest(v_still, 0))::text using errcode = 'P0001'; end if;
  v_on := coalesce(p_picked_up_on, public.stock_org_today(v_org));
  -- The receipt goes through the shipped path: keeper-or-Admin, item/warehouse validation, numbering, dates (0413/0534).
  -- Unit cost is 0 by construction (spec FR-CSR-012); the payload carries no client cost.
  v_doc := public.create_stock_document(
    jsonb_build_object('kind', 'receive', 'warehouse_id', p_warehouse_id, 'occurred_on', v_on,
                       'note', left('Client requisition ' || r.number || ' pickup' || coalesce(' - ' || v_collector, ''), 500)),
    jsonb_build_array(jsonb_build_object('item_id', l.stock_item_id, 'quantity', p_quantity, 'unit_cost', 0)),
    false, null);
  -- Check 1161's rule trigger: the receiving location's project must be the work order's.
  update public.stock_documents set work_order_id = r.work_order_id where id = v_doc;
  perform public.post_stock_document(v_doc);
  insert into public.client_requisition_pickups (org_id, requisition_id, line_id, quantity, picked_up_on, collector, paper_reference,
                                                 warehouse_id, stock_document_id, client_request_id, recorded_by)
  values (v_org, r.id, l.id, p_quantity, v_on, v_collector, v_paper, p_warehouse_id, v_doc, p_client_request_id, v_uid)
  returning id into v_pickup;
  perform public.csr_log(v_org, r.id, l.id, 'pickup', p_quantity, null, v_on, null, v_pickup, p_client_request_id);
  return v_pickup;
end $function$
;

CREATE OR REPLACE FUNCTION public.csr_send(p_requisition_id uuid, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); r public.client_requisitions;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.client_requisitions x where x.id = p_requisition_id and x.org_id = v_org for update;
  if not found then raise exception 'CSR_NOT_FOUND: the requisition is not in your organisation' using errcode = 'P0001'; end if;
  perform public.csr_assert_author(r.created_by);
  if r.status = 'open' and p_client_request_id is not null and r.send_request_id = p_client_request_id then return; end if;
  if r.status <> 'draft' then
    raise exception 'CSR_NOT_DRAFT: only a draft requisition can be changed or sent' using errcode = 'P0001'; end if;
  if exists (select 1 from public.work_orders w where w.id = r.work_order_id and w.status not in ('Draft','Issued')) then
    raise exception 'CSR_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  update public.client_requisitions
     set status = 'open', sent_by = v_uid, sent_at = now(), send_request_id = p_client_request_id, updated_at = now()
   where id = r.id;
  perform public.csr_log(v_org, r.id, null, 'sent', null, null, null, null, null, p_client_request_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.csr_update_draft(p_requisition_id uuid, p_header jsonb, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; r public.client_requisitions; v_ref text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.client_requisitions x where x.id = p_requisition_id and x.org_id = v_org for update;
  if not found then raise exception 'CSR_NOT_FOUND: the requisition is not in your organisation' using errcode = 'P0001'; end if;
  perform public.csr_assert_author(r.created_by);
  if r.status <> 'draft' then
    raise exception 'CSR_NOT_DRAFT: only a draft requisition can be changed or sent' using errcode = 'P0001'; end if;
  if exists (select 1 from public.work_orders w where w.id = r.work_order_id and w.status not in ('Draft','Issued')) then
    raise exception 'CSR_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_ref := nullif(btrim(p_header->>'client_reference'), '');
  if v_ref is not null and length(v_ref) > 120 then
    raise exception 'CSR_INVALID: the client reference is 120 characters at most' using errcode = 'P0001'; end if;
  perform public.csr_validate_lines(v_org, r.work_order_id, p_lines);
  update public.client_requisitions set client_reference = v_ref, updated_at = now() where id = r.id;
  delete from public.client_requisition_lines where requisition_id = r.id;
  perform public.csr_insert_lines(v_org, r.id, p_lines);
end $function$
;

CREATE OR REPLACE FUNCTION public.decide_imprest_float_change(p_change uuid, p_approve boolean, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_c public.imprest_float_changes%rowtype; v_uid uuid := auth.uid(); v_admin boolean := public.auth_role() = 'Admin';
        v_route record; v_f public.imprest_floats%rowtype;
begin
  perform public.assert_is_active_member();
  select * into v_c from public.imprest_float_changes where id = p_change for update;
  if not found or v_c.org_id is distinct from public.auth_org_id() then
    raise exception 'float change not found' using errcode = 'P0002';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  perform public.imprest_lock_float(v_c.float_id);
  if v_c.status <> 'Proposed' then
    raise exception 'this float change is already %', lower(v_c.status) using errcode = 'P0001';
  end if;
  if v_uid = v_c.proposed_by then
    raise exception 'separation of duties: the proposer cannot decide their own float amount' using errcode = '42501';
  end if;
  select * into v_f from public.imprest_floats where id = v_c.float_id;
  if v_f.archived_at is not null then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  -- DD-IMP-7.3: the person holding the cash never decides how much they hold, via the senior set or break-glass alike.
  if v_uid = v_f.custodian_id then
    raise exception 'separation of duties: a custodian cannot decide their own float amount' using errcode = '42501';
  end if;
  select * into v_route from public.imprest_senior_route(v_c.org_id, v_c.proposed_by);
  if not v_admin and not coalesce(v_uid = any (v_route.approver_ids), false) then
    raise exception 'approval routing: a float amount needs the senior approver set%',
      case when v_route.route = 'admin' then ' (none eligible: an Admin)' else '' end using errcode = '42501';
  end if;
  if p_approve and v_c.proposed_amount < public.imprest_funded(v_c.float_id) then
    raise exception 'lowering a float below the cash already funded is a wind-down, not in scope' using errcode = 'P0001';
  end if;
  update public.imprest_float_changes
     set status = case when p_approve then 'Approved' else 'Rejected' end, decided_by = v_uid, decided_at = now(),
         notes = nullif(btrim(p_notes), '')
   where id = p_change;
  if p_approve then
    update public.imprest_floats set float_amount = v_c.proposed_amount where id = v_c.float_id;
  end if;
  perform public.log_audit('imprest_float_change.decided', v_c.org_id, v_uid, p_change,
    jsonb_build_object('float_id', v_c.float_id, 'approved', p_approve, 'amount', v_c.proposed_amount,
                       'route', v_route.route,
                       'break_glass', v_admin and not coalesce(v_uid = any (v_route.approver_ids), false)));
end; $function$
;

CREATE OR REPLACE FUNCTION public.dsr_save_draft(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_id uuid; v_req uuid; v_wo record; v_date date; r public.daily_site_reports;
  v_variant uuid; v_weather uuid; v_start time; v_end time;
begin
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'report must be an object' using errcode = '22023'; end if;
  begin v_id := (p->>'id')::uuid; v_req := (p->>'client_request_id')::uuid; v_variant := (p->>'variant_id')::uuid;
        v_weather := (p->>'weather_id')::uuid; v_start := (p->>'start_time')::time; v_end := (p->>'end_time')::time;
  exception when others then raise exception 'malformed report field' using errcode = '22023'; end;

  if v_id is null then
    -- NFR-DSR-004: a retried create returns the report it already made.
    if v_req is not null then
      select id into v_id from public.daily_site_reports where org_id = v_org and client_request_id = v_req;
      if v_id is not null then return v_id; end if;
    end if;
    begin v_date := (p->>'work_date')::date; exception when others then v_date := null; end;
    if v_date is null then raise exception 'work_date is required' using errcode = '22023'; end if;
    select w.id, w.project_id, w.status into v_wo from public.work_orders w
     where w.id = (p->>'work_order_id')::uuid and w.org_id = v_org;
    if v_wo.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
    if not public.dsr_may_enter(v_wo.project_id) then
      raise exception 'you cannot enter site reports on this project' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('dsr:' || v_wo.id::text || ':' || v_date::text, 0));
    if exists (select 1 from public.daily_site_reports d where d.work_order_id = v_wo.id and d.work_date = v_date
                and d.supersedes_id is null and d.archived_at is null) then
      raise exception 'A report exists for this date' using errcode = '23505';
    end if;
    insert into public.daily_site_reports (org_id, project_id, work_order_id, work_date, author_id, client_request_id)
    values (v_org, v_wo.project_id, v_wo.id, v_date, v_uid, v_req) returning * into r;
    perform public.dsr_log(r.id, v_org, 'created', null);
  else
    select * into r from public.daily_site_reports where id = v_id and org_id = v_org for update;
    if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
    if r.status not in ('draft','returned') then
      raise exception 'only a draft or returned report can be edited' using errcode = '42501';
    end if;
    if r.author_id <> v_uid and not public.dsr_may_enter(r.project_id) then
      raise exception 'you cannot edit this report' using errcode = '42501';
    end if;
  end if;

  if v_variant is not null and not exists (select 1 from public.rate_catalogue_variants v where v.id = v_variant and v.project_id = r.project_id) then
    raise exception 'work location must belong to this contract' using errcode = '23514';
  end if;
  if v_weather is not null and not exists (select 1 from public.dsr_weather_conditions w where w.id = v_weather and w.org_id = v_org) then
    raise exception 'unknown weather' using errcode = '23503';
  end if;
  update public.daily_site_reports set variant_id = v_variant, start_time = v_start, end_time = v_end, weather_id = v_weather,
         weather_note = nullif(btrim(coalesce(p->>'weather_note', '')), ''), note = nullif(btrim(coalesce(p->>'note', '')), ''),
         updated_at = now()
   where id = r.id returning * into r;
  perform public.dsr_replace_lines(r, p);
  return r.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.dsr_submit(p_report uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; r public.daily_site_reports;
begin
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status = 'submitted' then return; end if;
  if r.status not in ('draft','returned') then raise exception 'only a draft or returned report can be submitted' using errcode = '42501'; end if;
  if r.author_id <> auth.uid() and not public.dsr_may_enter(r.project_id) then
    raise exception 'you cannot submit this report' using errcode = '42501';
  end if;
  update public.daily_site_reports set status = 'submitted', submitted_at = now(), updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'submitted', null);
end $function$
;

CREATE OR REPLACE FUNCTION public.leave_request_decide(p_id uuid, p_decision text, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_req public.leave_requests;
  v_profile uuid;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'LV_FORBIDDEN: not an active member' using errcode = '42501';
  end if;
  if p_decision not in ('Approved', 'Rejected') then
    raise exception 'LV_DECISION: decide Approved or Rejected' using errcode = '22023';
  end if;
  select * into v_req from public.leave_requests r where r.id = p_id and r.org_id = v_org for update;
  if not found then
    raise exception 'LV_NOT_FOUND: no such request' using errcode = 'P0002';
  end if;
  select w.profile_id into v_profile from public.people w where w.id = v_req.person_id;
  if v_req.entered_by = v_uid or coalesce(v_profile = v_uid, false) then
    raise exception 'LV_SOD: you cannot decide your own request, or one you entered' using errcode = '42501';
  end if;
  if not public.leave_authority(v_req.person_id) then
    raise exception 'LV_FORBIDDEN: you cannot decide this request' using errcode = '42501';
  end if;
  if v_req.status <> 'Pending' then
    raise exception 'LV_DECIDED: this request is already %', lower(v_req.status) using errcode = '23514';
  end if;
  if p_decision = 'Rejected' and nullif(btrim(p_note), '') is null then
    raise exception 'LV_NOTE: give a reason when rejecting' using errcode = '23514';
  end if;
  update public.leave_requests set status = p_decision, decided_by = v_uid, decided_at = now(),
         decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform public.log_audit('leave.' || lower(p_decision), v_org, v_uid, p_id, '{}'::jsonb);
  return p_decision;
end $function$
;

CREATE OR REPLACE FUNCTION public.mrq_cancel(p_request_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); r public.material_requests;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.created_by <> v_uid then
    raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can cancel it' using errcode = '42501'; end if;
  if r.status not in ('draft','pending') then
    raise exception 'MRQ_NOT_PENDING: only a draft or pending request can be cancelled' using errcode = 'P0001'; end if;
  update public.material_request_steps set status = 'superseded'
   where request_id = r.id and status in ('waiting','open');
  update public.material_requests set status = 'cancelled', updated_at = now() where id = r.id;
  perform public.mrq_log(r, 'cancelled', r.status, 'cancelled', null, v_uid, null,
                         left(nullif(btrim(p_reason), ''), 500));
end $function$
;

CREATE OR REPLACE FUNCTION public.mrq_decide_step(p_request_id uuid, p_step_position integer, p_decision text, p_reason text DEFAULT NULL::text, p_source_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; s public.material_request_steps;
  v_ok boolean; v_for uuid; v_reason text := nullif(btrim(p_reason), ''); v_next integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then
    raise exception 'MRQ_NOT_PENDING: the request is not waiting for approval' using errcode = 'P0001'; end if;
  select * into s from public.material_request_steps x
   where x.request_id = r.id and x.round = r.round and x.status = 'open';
  if s.position is distinct from p_step_position then                                                  -- mut:order
    raise exception 'MRQ_OUT_OF_ORDER: step % is not the open step; steps are decided in order', p_step_position
      using errcode = 'P0001';
  end if;
  if r.created_by = v_uid then                                                                         -- mut:author
    raise exception 'MRQ_SOD_AUTHOR: you cannot decide a request you raised' using errcode = '42501';
  end if;
  select a.ok, a.acting_for into v_ok, v_for from public.mrq_step_authority(v_org, v_uid, s.role, r.created_by,
                                                                              public.mrq_pinned_to(r.project_id, s.position, s.role)) a;
  if not v_ok then
    if public.mrq_pinned_to(r.project_id, s.position, s.role) is not null
       and (select a.ok from public.mrq_step_authority(v_org, v_uid, s.role, r.created_by, null) a) then
      raise exception 'MRQ_NOT_PINNED: this step is pinned to another approver on this project' using errcode = '42501';
    end if;
    raise exception 'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.material_request_steps x                                             -- mut:twice
              where x.request_id = r.id and x.id <> s.id and x.status in ('approved','returned','rejected')
                and (x.round = r.round or (x.position, x.role, x.label) is distinct from (s.position, s.role, s.label))
                and (x.decided_by = any(array_remove(array[v_uid, v_for], null))
                     or x.acted_for = any(array_remove(array[v_uid, v_for], null)))) then
    raise exception 'MRQ_SOD_TWICE: you already decided another step of this request' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve','return','reject') then
    raise exception 'MRQ_INVALID: a decision is approve, return or reject' using errcode = 'P0001'; end if;
  if p_decision in ('return','reject') and (v_reason is null or length(v_reason) > 500) then
    raise exception 'MRQ_REASON_REQUIRED: a return or rejection needs a reason (1 to 500 characters)' using errcode = 'P0001'; end if;

  if p_decision = 'approve' then
    update public.material_request_steps
       set status = 'approved', decided_by = v_uid, acted_for = v_for, decided_at = now(), reason = v_reason
     where id = s.id;
    select min(x.position) into v_next from public.material_request_steps x
     where x.request_id = r.id and x.round = r.round and x.status = 'waiting';
    if v_next is not null then
      update public.material_request_steps set status = 'open'
       where request_id = r.id and round = r.round and position = v_next;
      perform public.mrq_log(r, 'approved_step', 'pending', 'pending', s.position, v_uid, v_for, v_reason);
    else
      -- Final step: approve and create the transfer draft in this one transaction (FR-MRQ-011). Any failure in
      -- the transfer path raises and rolls the whole decision back, leaving the step open.
      update public.material_requests set status = 'approved', decided_at = now(), updated_at = now() where id = r.id;
      perform public.mrq_log(r, 'approved_step', 'pending', 'pending', s.position, v_uid, v_for, v_reason);
      perform public.mrq_log(r, 'approved', 'pending', 'approved', s.position, v_uid, v_for, null);
      perform public.mrq_create_transfer_core(r.id, p_source_warehouse_id);
    end if;
  else
    update public.material_request_steps
       set status = case p_decision when 'return' then 'returned' else 'rejected' end,
           decided_by = v_uid, acted_for = v_for, decided_at = now(), reason = v_reason
     where id = s.id;
    update public.material_request_steps set status = 'superseded'
     where request_id = r.id and round = r.round and status = 'waiting';
    update public.material_requests
       set status = case p_decision when 'return' then 'draft' else 'rejected' end,
           decided_at = case p_decision when 'reject' then now() end, updated_at = now()
     where id = r.id;
    perform public.mrq_log(r, case p_decision when 'return' then 'returned' else 'rejected' end, 'pending',
                           case p_decision when 'return' then 'draft' else 'rejected' end, s.position, v_uid, v_for, v_reason);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.mrq_retry_transfer(p_request_id uuid, p_source_warehouse_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); r public.material_requests;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.status <> 'approved' or (r.transfer_document_id is not null and not r.transfer_cancelled) then
    raise exception 'MRQ_NOT_PENDING: this request already has a live transfer' using errcode = 'P0001'; end if;
  if r.created_by = v_uid then
    raise exception 'MRQ_SOD_AUTHOR: you cannot move stock for a request you raised' using errcode = '42501'; end if;
  return public.mrq_create_transfer_core(r.id, p_source_warehouse_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.mrq_revoke_stand_in(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); s public.approval_stand_ins;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into s from public.approval_stand_ins x where x.id = p_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the stand-in is not in your organisation' using errcode = 'P0001'; end if;
  if s.delegator_id is distinct from v_uid and public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_STAND_IN: only the person away, or an Admin, ends their stand-in' using errcode = '42501'; end if;
  if s.revoked_at is null then
    update public.approval_stand_ins set revoked_at = now(), revoked_by = v_uid where id = s.id;
    perform public.log_audit('material_request.stand_in_revoked', v_org, v_uid, s.id, '{}'::jsonb);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.mrq_save_draft(p_request_id uuid, p_header jsonb, p_lines jsonb, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo record; v_to uuid; v_needed date; v_id uuid;
  v_section uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_request_id is null and p_client_request_id is not null then
    select x.id into v_id from public.material_requests x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_request_id is not null then
    select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
    if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
    if r.created_by <> v_uid then
      raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
    if r.status <> 'draft' then
      raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  end if;
  select w.id, w.project_id, w.status into v_wo from public.work_orders w
   where w.id = nullif(p_header->>'work_order_id', '')::uuid and w.org_id = v_org;
  if v_wo.id is null then raise exception 'MRQ_WORK_ORDER: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo.status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_needed := nullif(p_header->>'needed_by', '')::date;
  if v_needed is null then raise exception 'MRQ_INVALID: a request needs a needed-by date' using errcode = 'P0001'; end if;
  v_to := nullif(p_header->>'to_warehouse_id', '')::uuid;
  if v_to is not null and not exists (select 1 from public.stock_warehouses w
        where w.id = v_to and w.org_id = v_org and w.kind in ('site', 'yard', 'staging') and w.project_id = v_wo.project_id and w.archived_at is null) then
    raise exception 'MRQ_DESTINATION: the destination must be a site, yard or staging location of the work order''s project' using errcode = 'P0001'; end if;
  if p_header->>'note' is not null and length(p_header->>'note') > 1000 then
    raise exception 'MRQ_INVALID: a note is 1000 characters at most' using errcode = 'P0001'; end if;
  -- #2576 FR-WOS-009: an optional section of THIS work order. A live one for a new or changed choice; a draft that
  -- keeps the section it already has may keep it even after the section was archived (records keep it).
  v_section := nullif(p_header->>'section_id', '')::uuid;
  if v_section is not null and (p_request_id is null or r.section_id is distinct from v_section) then
    if not exists (select 1 from public.work_order_sections s
                    where s.id = v_section and s.work_order_id = v_wo.id and s.org_id = v_org and s.archived_at is null) then
      raise exception 'MRQ_SECTION: the section is not a live section of this work order' using errcode = 'P0001'; end if;
  end if;
  perform public.mrq_validate_lines(v_org, p_lines);

  if p_request_id is null then
    insert into public.material_requests (org_id, number, work_order_id, project_id, section_id, to_warehouse_id, needed_by, note,
                                          client_request_id, created_by)
    values (v_org, public.next_procurement_doc_number(v_org, 'MRQ'), v_wo.id, v_wo.project_id, v_section, v_to, v_needed,
            nullif(btrim(p_header->>'note'), ''), p_client_request_id, v_uid)
    on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
    returning * into r;
    if r.id is null then                                                   -- lost a race to a concurrent replay
      select x.id into v_id from public.material_requests x
       where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
      return v_id;
    end if;
    perform public.mrq_log(r, 'created', null, 'draft', null, v_uid, null, null);
  else
    update public.material_requests
       set work_order_id = v_wo.id, project_id = v_wo.project_id, section_id = v_section, to_warehouse_id = v_to, needed_by = v_needed,
           note = nullif(btrim(p_header->>'note'), ''), updated_at = now()
     where id = r.id
    returning * into r;
    delete from public.material_request_lines where request_id = r.id;
  end if;
  insert into public.material_request_lines (org_id, request_id, line_no, item_id, quantity, over_plan_reason)
  select v_org, r.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'quantity')::numeric, nullif(btrim(t.e->>'over_plan_reason'), '')
    from jsonb_array_elements(p_lines) with ordinality as t(e, n);
  return r.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.mrq_set_stand_in(p_delegator_id uuid, p_stand_in_id uuid, p_starts_on date, p_ends_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); v_id uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if p_delegator_id is distinct from v_uid and public.auth_role() is distinct from 'Admin' then
    raise exception 'MRQ_STAND_IN: only the person away, or an Admin, names their stand-in' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_delegator_id and p.org_id = v_org and p.status = 'active')
     or not exists (select 1 from public.profiles p where p.id = p_stand_in_id and p.org_id = v_org and p.status = 'active') then
    raise exception 'MRQ_STAND_IN: both people must be active members of your organisation' using errcode = 'P0001'; end if;
  if p_stand_in_id = p_delegator_id then
    raise exception 'MRQ_STAND_IN: a person cannot stand in for themselves' using errcode = 'P0001'; end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on or p_ends_on - p_starts_on > 366
     or p_ends_on < public.stock_org_today(v_org) then
    raise exception 'MRQ_STAND_IN: choose a date range that has not ended (a year at most)' using errcode = 'P0001'; end if;
  insert into public.approval_stand_ins (org_id, delegator_id, stand_in_id, starts_on, ends_on, created_by)
  values (v_org, p_delegator_id, p_stand_in_id, p_starts_on, p_ends_on, v_uid)
  returning id into v_id;
  perform public.log_audit('material_request.stand_in_set', v_org, v_uid, v_id,
    jsonb_build_object('delegator_id', p_delegator_id, 'stand_in_id', p_stand_in_id, 'starts_on', p_starts_on, 'ends_on', p_ends_on));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.mrq_submit(p_request_id uuid, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo_status public.work_order_status;
  v_cutoff time; v_tz text; v_earliest date; l record; v_plan numeric; v_src text; v_prior numeric; v_over boolean := false;
  v_splan numeric; v_sprior numeric;
  v_round integer; v_steps integer;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
  if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
  if r.created_by <> v_uid then
    raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
  if p_client_request_id is not null and exists (
    select 1 from public.material_request_events e where e.request_id = r.id and e.action = 'submitted'
      and e.client_request_id = p_client_request_id
  ) then
    return;                                                                 -- FR-MRQ-004 replay, including earlier rounds
  end if;
  if r.status <> 'draft' then
    raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  select w.status into v_wo_status from public.work_orders w where w.id = r.work_order_id;
  if v_wo_status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;

  select s.cutoff_time into v_cutoff from public.material_request_settings s where s.org_id = v_org;
  select o.default_timezone into v_tz from public.organizations o where o.id = v_org;
  v_earliest := public.mrq_cutoff_earliest(v_cutoff, v_tz, r.needed_by, now());
  if v_earliest is not null then
    raise exception 'MRQ_CUTOFF: requests for tomorrow close at %; the earliest date you can request is %',
      to_char(v_cutoff, 'HH24:MI'), v_earliest using errcode = 'P0001';
  end if;

  -- Serialize submissions sharing a work order before reading prior quantities.
  perform pg_advisory_xact_lock(hashtextextended('mrq-plan:' || r.work_order_id::text, 0));
  for l in select * from public.material_request_lines x where x.request_id = r.id order by x.line_no for update loop
    select f.plan_qty, f.plan_source into v_plan, v_src from public.mrq_plan_figure(r.work_order_id, l.item_id) f;
    v_prior := public.mrq_prior_quantity(r.work_order_id, l.item_id, r.id);
    if v_prior + l.quantity > v_plan then
      v_over := true;
      if l.over_plan_reason is null then                                                               -- mut:over_plan
        raise exception 'MRQ_OVER_PLAN_REASON: line % is over plan and needs a reason (1 to 500 characters)', l.line_no
          using errcode = '23514';
      end if;
    end if;
    -- #2576 FR-WOS-015: the section's own allocation, when one is set, is a second check beside the work order's;
    -- the stricter applies, and both ask for the one existing over-plan reason. A section with no allocation for the
    -- item is checked against the work order's plan only.
    v_splan := null; v_sprior := null;
    if r.section_id is not null then
      v_splan := public.mrq_section_plan_quantity(r.section_id, l.item_id);
      if v_splan is not null then
        v_sprior := public.mrq_section_prior_quantity(r.section_id, l.item_id, r.id);
        if v_sprior + l.quantity > v_splan then                                                          -- mut:section_plan
          v_over := true;
          if l.over_plan_reason is null then
            raise exception 'MRQ_OVER_PLAN_REASON: line % is over its section''s plan and needs a reason (1 to 500 characters)', l.line_no
              using errcode = '23514';
          end if;
        end if;
      end if;
    end if;
    update public.material_request_lines set plan_qty = v_plan, plan_source = v_src, prior_qty = v_prior,
           section_plan_qty = v_splan, section_prior_qty = v_sprior where id = l.id;
  end loop;

  v_round := r.round + 1;
  insert into public.material_request_steps (org_id, request_id, round, position, role, label, status)
  select v_org, r.id, v_round, row_number() over (order by c.position), c.role, c.label, 'waiting'
    from public.approval_chain_steps c
   where c.org_id = v_org and (not c.only_over_plan or v_over);
  get diagnostics v_steps = row_count;
  if v_steps = 0 then
    raise exception 'MRQ_NO_CHAIN: no approval chain is set up for material requests; ask an Admin' using errcode = 'P0001'; end if;
  update public.material_request_steps set status = 'open' where request_id = r.id and round = v_round and position = 1;
  update public.material_requests
     set status = 'pending', round = v_round, submitted_at = now(), submit_request_id = p_client_request_id,
         decided_at = null, updated_at = now()
   where id = r.id;
  insert into public.material_request_events (org_id, request_id, action, from_status, to_status, actor_id, client_request_id)
  values (v_org, r.id, 'submitted', 'draft', 'pending', v_uid, p_client_request_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.note_billing_stage(p_stage uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.claim_billing_stages;
begin
  perform public.assert_is_active_member();
  if p_stage is null then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  v_s := public.lock_billing_stage_claim(p_stage);
  update public.claim_billing_stages s set note = nullif(btrim(p_note), '') where s.id = p_stage;
  perform public.log_audit('billing_stage.note', v_s.org_id, auth.uid(), v_s.claim_id, jsonb_build_object('stage_id', p_stage));
end; $function$
;

CREATE OR REPLACE FUNCTION public.post_stock_document(p_document_id uuid, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.stock_documents; v_fresh boolean;
begin
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = public.auth_org_id() for update;   -- lock order (1)
  if found and d.status = 'Draft' and d.kind in ('adjustment','count') then
    v_fresh := p_expected_revision is not distinct from d.revision;                                                -- mut:stale
    if not v_fresh then raise exception 'STK_STALE: this draft changed since you opened it; review it again' using errcode = 'P0001'; end if;
  end if;
  perform public.stock_post_core(p_document_id);                      -- refuses a missing or other-org document itself
  return p_document_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.pre_cutover_procurement(p_procurement_id uuid, p_invoice_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p.id is null or (auth.uid() is not null and p.org_id is distinct from public.auth_org_id()) then null
    when exists (select 1 from public.procurement_invoices i
                  where i.id = p_invoice_id and i.procurement_id = p.id and i.erp_docstatus is not null) then false
    else coalesce((select min(d.at) from (
                      select po.created_at at from public.purchase_orders po where po.procurement_id = p.id and po.erp_docstatus is null
                      union all select r.created_at from public.procurement_receipts r where r.procurement_id = p.id and r.erp_docstatus is null
                      union all select i.created_at from public.procurement_invoices i where i.procurement_id = p.id and i.erp_docstatus is null) d)
                   < (select greatest(b.activated_at, o.created_at)
                        from public.external_org_bindings b
                        join public.external_domain_ownership o
                          on o.org_id = b.org_id and o.external_tier = b.external_tier and o.domain = 'procurement'
                       where b.org_id = p.org_id and b.status = 'active' and b.activated_at is not null
                       order by b.activated_at limit 1), false) end
    from (select 1) one left join public.procurements p on p.id = p_procurement_id
$function$
;

CREATE OR REPLACE FUNCTION public.procurement_amount_eligibility(p_procurement_id uuid, p_amount numeric)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_row public.procurements%rowtype;
  v_ceiling record;
  v_route record;
  v_routed numeric;
begin
  if not public.is_active_member() or v_role is null
     or v_role not in ('Admin','Executive','Project Manager','Finance') then return null; end if;
  select * into v_row from public.procurements where id = p_procurement_id and org_id = public.auth_org_id();
  if not found then return null; end if;
  if v_row.status is distinct from 'Vendor Invoiced' then return 'unavailable'; end if;
  if v_uid = v_row.requested_by_id then return 'requester'; end if;
  if v_uid = (select e.actor_id from public.procurement_status_events e
               where e.procurement_id = p_procurement_id and e.from_status = 'Vendor Quoted'::public.procurement_status
                 and e.to_status = 'Requested'::public.procurement_status
               order by e.created_at desc, e.id desc limit 1) then return 'quote_selector'; end if;
  if exists (select 1 from public.record_changes rc join public.procurement_invoices i on i.id = rc.entity_id
              where rc.org_id = v_row.org_id and rc.entity_type = 'procurement_invoice' and rc.op = 'insert'
                and i.procurement_id = p_procurement_id and rc.actor_id = v_uid)
     or exists (select 1 from public.procurement_status_events e where e.procurement_id = p_procurement_id
                and e.to_status = 'Vendor Invoiced'::public.procurement_status and e.actor_id = v_uid)
    then return 'bill_recorder'; end if;
  select * into v_ceiling from public.procurement_payment_within_ceiling(p_procurement_id);
  if v_ceiling.reason = 'bill currency differs from procurement currency'
     or p_amount is null or not (p_amount < 'Infinity'::numeric)
     or p_amount < coalesce(v_ceiling.billed_net,0)
     or (v_row.approved_total_value is not null and p_amount <= v_row.approved_total_value)
    then return 'unavailable'; end if;
  v_routed := greatest(p_amount - coalesce(public.procurement_request_amount(p_procurement_id),0),0);
  select * into v_route from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category,
    v_routed, v_row.currency, v_row.requested_by_id, v_uid, public.procurement_submitted_at(p_procurement_id));
  if coalesce(v_route.route,'senior') <> 'flat' and v_role <> 'Admin'
     and not coalesce(v_uid = any(v_route.approver_ids),false) then return 'routing'; end if;
  return 'allowed';
end; $function$
;

CREATE OR REPLACE FUNCTION public.procurement_gate(p_org uuid, p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce((
    select case when jsonb_typeof(o.procurement_gates -> p_key) = 'boolean'
                then (o.procurement_gates ->> p_key)::boolean else false end
      from public.organizations o
     where o.id = p_org
       and (auth.uid() is null or (p_org = public.auth_org_id() and public.is_active_member()))), false)  -- 0372
$function$
;

CREATE OR REPLACE FUNCTION public.procurement_gate_violation(p_procurement_id uuid, p_step procurement_status)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  if not found or (auth.uid() is not null and v_row.org_id is distinct from public.auth_org_id()) then
    return 'purchase_not_found';
  end if;
  -- 0372: a member learns a purchase's state only while active and only if RLS shows it to them
  -- (procurements_select + procurements_engineer_read_scope). Otherwise the answer is null — the same for every such
  -- purchase, so it reveals nothing — and the write's own role/SoD guard and RLS refuse with their own codes.
  if auth.uid() is not null
     and (not public.is_active_member()                                                                  -- 0372
          or not (coalesce(public.auth_role()::text in ('Admin','Executive','Project Manager','Finance'), false)  -- 0372
                  or v_row.requested_by_id = auth.uid())) then                                          -- 0372
    return null;                                                                                         -- 0372
  end if;
  -- 0368: a purchase awaiting approval (Requested, including one a quote re-opened) takes no document of any kind —
  -- an order, receipt, invoice or payment would skip the pending approval.
  if v_row.status = 'Requested' then return 'awaiting_approval'; end if;                                 -- 0368
  if public.procurement_step_rank(p_step) >= 5 then
    if public.procurement_gate(v_row.org_id, 'request_before_order')
       and v_row.pr_number is null and public.procurement_step_rank(v_row.status) < 1
       and not exists (select 1 from public.purchase_requests r where r.procurement_id = v_row.id) then
      return 'gate_request_before_order';
    end if;
    if public.procurement_gate(v_row.org_id, 'approval_before_order') and v_row.approved_by_id is null then
      return 'gate_approval_before_order';
    end if;
  end if;
  if public.procurement_step_rank(p_step) >= 7
     and public.procurement_gate(v_row.org_id, 'receipt_before_invoice')
     and public.procurement_step_rank(v_row.status) < 6
     and not exists (select 1 from public.procurement_receipts r where r.procurement_id = v_row.id)
     and not exists (select 1 from public.procurement_erp_links l
                       join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                      where l.procurement_id = v_row.id and d.erp_doctype = 'Purchase Receipt' and d.erp_docstatus = 1) then
    return 'gate_receipt_before_invoice';
  end if;
  if p_step = 'Paid' and public.procurement_gate(v_row.org_id, 'approval_before_payment') and v_row.approved_by_id is null then
    return 'gate_approval_before_payment';
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.procurement_item_values_editable(p_case uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_parent public.procurements%rowtype;
begin
  select * into v_parent from public.procurements where id = p_case and org_id = public.auth_org_id();
  if v_parent.id is null or v_parent.status <> 'Draft' or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_parent.org_id, 'procurement'), false)
     or not coalesce(v_parent.requested_by_id = auth.uid() or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'), false) then
    return false;
  end if;
  return not public.domain_externally_owned(v_parent.org_id, 'procurement')
    or not public.procurement_case_has_external_evidence(v_parent.org_id, p_case);
end $function$
;

CREATE OR REPLACE FUNCTION public.record_expense_advance_return(p_id uuid, p_amount numeric, p_reference text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row  public.expense_claims%rowtype;
  v_out  numeric;
  v_uid  uuid      := auth.uid();
  v_role user_role := auth_role();
  v_float public.imprest_floats%rowtype;                                                   -- 0423
begin
  perform public.assert_is_active_member();
  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense advance not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.kind is distinct from 'advance' or v_row.status is distinct from 'Paid' then
    raise exception 'only a paid advance can have cash returned against it' using errcode = 'P0001';
  end if;
  if v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot record a return of their own advance' using errcode = '42501';
  end if;
  if v_row.imprest_float_id is not null then                                               -- 0423
    select * into v_float from public.imprest_floats where id = v_row.imprest_float_id;    -- 0423
    perform public.imprest_lock_float(v_row.imprest_float_id);                             -- 0423 (advance → float)
  end if;                                                                                  -- 0423
  if v_role is distinct from 'Finance' and v_role is distinct from 'Admin'                 -- 0423 (edited: `then` moved down)
     and not (v_row.imprest_float_id is not null and v_uid = v_float.custodian_id          -- 0423 FR-IMP-027
              and public.imprest_custodian_eligible(v_row.org_id, v_float.project_id, v_uid)) then  -- 0423
    if v_row.imprest_float_id is not null then                                             -- 0423
      raise exception 'only Finance, an Admin or the float''s custodian records an advance return' using errcode = '42501';  -- 0423
    end if;                                                                                -- 0423
    raise exception 'only Finance or an Admin records an advance return' using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a return amount must be greater than zero' using errcode = 'P0001';
  end if;
  v_out := public.expense_advance_outstanding(p_id);
  if p_amount > v_out then
    raise exception 'a return of % exceeds the % still outstanding on this advance', round(p_amount, 2), round(v_out, 2)
      using errcode = 'P0001';
  end if;
  update public.expense_claims set returned_amount = returned_amount + p_amount where id = p_id;
  -- 0270 (DD-EXP-17): the return as its own row — the subject of its advance-return posting.
  insert into public.expense_advance_returns (org_id, advance_id, amount, reference, recorded_by, returned_on)
  values (v_row.org_id, p_id, p_amount, nullif(btrim(p_reference), ''), v_uid,
          (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = v_row.org_id),
                                       'UTC'))::date);
  perform public.log_audit('expense_advance.return', v_row.org_id, v_uid, p_id,
    jsonb_build_object('amount', p_amount, 'reference', nullif(btrim(p_reference), ''), 'outstanding_after', v_out - p_amount));
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_imprest_count(p_float uuid, p_counted numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_book numeric; v_id uuid;
begin
  perform public.assert_is_active_member();
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if not (public.auth_role() in ('Finance','Admin')
          or (v_uid = v_f.custodian_id and public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid))) then
    raise exception 'only the custodian, Finance or an Admin records a cash count' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  if p_counted is null or not (p_counted >= 0 and p_counted < 'Infinity'::numeric) then
    raise exception 'a counted amount must be zero or more' using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  v_book := public.imprest_cash_book(p_float);
  if round(p_counted, 2) <> v_book and btrim(coalesce(p_note, '')) = '' then
    raise exception 'the count differs from the book by %: add a note', round(p_counted, 2) - v_book using errcode = 'P0001';
  end if;
  insert into public.imprest_cash_counts (org_id, float_id, counted_amount, book_amount, variance, note, counted_by)
  values (v_f.org_id, p_float, round(p_counted, 2), v_book, round(p_counted, 2) - v_book, nullif(btrim(p_note), ''), v_uid)
  returning id into v_id;
  perform public.log_audit('imprest_count.recorded', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'counted', round(p_counted, 2), 'book', v_book, 'variance', round(p_counted, 2) - v_book));
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.release_credits(p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_run_id is null then
    -- Nothing to release. A reservation created WITHOUT a run id (run_id NULL) cannot be keyed by this
    -- function; such holds must be reconciled another way (a TTL reaper, or a keyed-by-reservation-id
    -- release path — a lifecycle decision deferred to the wiring issue, see creditRateGuard.ts note).
    return;
  end if;
  update public.credit_reservations
     set released_at = now()
   where run_id = p_run_id
     and org_id = public.auth_org_id()
     and released_at is null;
end $function$
;

CREATE OR REPLACE FUNCTION public.release_retention(p_release uuid, p_released_on date, p_reference text DEFAULT NULL::text, p_document uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r      public.retention_releases;
  v_c      public.progress_claims;
  v_status text;
  v_date   date;
  v_d_org  uuid; v_d_proj uuid; v_d_status public.doc_status; v_file text;
begin
  perform public.assert_is_active_member();
  select * into v_r from public.retention_releases r where r.id = p_release and r.org_id = public.auth_org_id();
  if not found then
    perform public.lock_retention_claim(null);   -- role refusal first for a caller who may not manage retention
  end if;
  v_c := public.lock_retention_claim(v_r.claim_id);
  select * into v_r from public.retention_releases r where r.id = p_release for update;
  if v_r.released_on is not null then
    raise exception 'this release is already recorded' using errcode = '55000', detail = 'release-recorded';
  end if;
  select si.status, si.invoice_date into v_status, v_date from public.sales_invoices si where si.id = v_c.id and si.org_id = v_c.org_id;
  if v_status is null or v_status not in ('Submitted','Unpaid','Paid') then
    raise exception 'retention is released on a submitted invoice: raise and approve the claim''s invoice first'
      using errcode = '55000', detail = 'invoice-not-submitted';
  end if;
  if p_released_on is null or p_released_on > public.native_org_today(v_c.org_id) or p_released_on < coalesce(v_date, p_released_on) then
    raise exception 'the release date must be between the invoice date and today' using errcode = '22023', detail = 'release-date';
  end if;
  if p_document is not null then
    select d.org_id, d.project_id, d.status, d.file_path into v_d_org, v_d_proj, v_d_status, v_file
      from public.project_documents d where d.id = p_document;
    if not found or v_d_org is distinct from v_c.org_id or v_d_proj is distinct from v_c.project_id then
      raise exception 'the proof must be one of the claim''s project documents' using errcode = '23514', detail = 'document-other-project';
    end if;
    if v_d_status not in ('Issued','Approved') then
      raise exception 'only an issued or approved document can be the proof' using errcode = '55000', detail = 'document-not-issued';
    end if;
    if v_file is null or btrim(v_file) = '' then
      raise exception 'the proof document has no file attached' using errcode = '55000', detail = 'document-without-file';
    end if;
  end if;
  update public.retention_releases r
     set released_on = p_released_on, reference_no = nullif(btrim(p_reference), ''), document_id = p_document,
         released_by = auth.uid(), released_at = now()
   where r.id = p_release;
  perform public.log_audit('retention_release.release', v_c.org_id, auth.uid(), v_c.id,
    jsonb_build_object('release_id', p_release, 'amount', v_r.amount, 'released_on', p_released_on, 'document_id', p_document));
end; $function$
;

CREATE OR REPLACE FUNCTION public.report_crew_tool(p_id uuid, p_line uuid, p_kind text, p_qty integer, p_note text, p_photos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_line public.crew_tool_lines; v_crew public.crews;
  v_open integer; v_usable integer; v_today date; v_due date; v_days integer; v_coord uuid;
  v_project uuid; v_task uuid; v_msg record; v_photo jsonb; v_path text; v_n integer := 0; v_rcpt uuid; v_loc text;
begin
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if p_id is null or p_line is null or p_kind not in ('damaged', 'lost') or p_qty is null or p_qty < 1
     or (p_note is not null and char_length(p_note) > 500) or (p_photos is not null and jsonb_typeof(p_photos) <> 'array') then
    raise exception 'invalid tool report' using errcode = '22023';
  end if;

  -- FR-CTR-009: a retry returns the report it already made.
  if exists (select 1 from public.crew_tool_reports r where r.id = p_id and r.org_id = v_org) then return p_id; end if;
  if exists (select 1 from public.crew_tool_reports r where r.id = p_id) then
    raise exception 'report id already used' using errcode = '23505';
  end if;

  -- FR-CTR-007: the line row lock serialises concurrent reports on it.
  select * into v_line from public.crew_tool_lines l where l.id = p_line and l.org_id = v_org for update;
  if v_line.id is null then raise exception 'tool line not found' using errcode = 'P0002'; end if;
  select * into v_crew from public.crews c where c.id = v_line.crew_id;
  if not (public.crew_can_manage() or v_crew.field_controller_id = v_uid) then
    raise exception 'CTR_NOT_ALLOWED: only the crew''s field controller or a crew manager reports a tool' using errcode = '42501';
  end if;
  if v_line.archived_at is not null then
    raise exception 'CTR_LINE_ARCHIVED: this tool line is archived' using errcode = '23514';
  end if;

  -- FR-CTR-006 / OD-CTR-3: a damaged report carries at least one photo; every path is the caller's own report's.
  for v_photo in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    v_path := v_photo->>'path';
    if v_path is null or array_length(string_to_array(v_path, '/'), 1) <> 4
       or split_part(v_path, '/', 1) <> v_org::text or split_part(v_path, '/', 2) <> p_id::text
       or not public.crew_tool_photo_stored(v_path) then
      raise exception 'CTR_PHOTO: a photo path is not an uploaded file of this report' using errcode = '23514';
    end if;
    v_n := v_n + 1;
  end loop;
  if p_kind = 'damaged' and v_n = 0 then
    raise exception 'CTR_PHOTO_REQUIRED: add a photo of the damaged tool' using errcode = '23514';
  end if;

  select coalesce(sum(r.qty), 0) into v_open from public.crew_tool_reports r where r.line_id = v_line.id and r.status = 'open';
  v_usable := greatest(v_line.held_qty - v_open, 0);
  if p_qty > v_usable then
    raise exception 'CTR_QTY_EXCEEDS_USABLE: only % usable', v_usable using errcode = '23514', detail = v_usable::text;
  end if;

  select s.coordinator_id, s.task_due_days into v_coord, v_days from public.org_crew_tool_settings s where s.org_id = v_org;
  v_days := coalesce(v_days, 3);
  -- an ex-coordinator who left or was disabled means no coordinator
  if v_coord is not null and not (public.is_active_member(v_coord)
       and exists (select 1 from public.profiles p where p.id = v_coord and p.org_id = v_org)) then v_coord := null; end if;
  v_today := public.native_org_today(v_org);
  v_due := v_today + v_days;

  -- OQ-CTR-2: the rostered project, when exactly one work order roster covers the day (the exclusion constraint of 1035 allows one).
  select wo.project_id into v_project
    from public.work_order_crews r join public.work_orders wo on wo.id = r.work_order_id
   where r.crew_id = v_crew.id and wo.org_id = v_org
     and v_today between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
   limit 1;
  if v_project is not null and public.task_domain_externally_owned(v_project) then v_project := null; end if;

  perform set_config('pmo.crew_tool_rpc', 'on', true);
  insert into public.crew_tool_reports (id, org_id, line_id, kind, qty, note, reported_by, reported_on, due_on)
  values (p_id, v_org, v_line.id, p_kind, p_qty, nullif(btrim(coalesce(p_note, '')), ''), v_uid, v_today, v_due);

  select m.task_name into v_msg from public.crew_tool_message(
    public.crew_tool_org_locale(v_org), p_kind, v_line.name, p_qty, v_crew.name, v_due) m;
  insert into public.tasks (org_id, project_id, name, description, assignee_id, end_date, crew_tool_report_id)
  values (v_org, v_project, left(v_msg.task_name, 200),
          nullif(btrim(coalesce(p_note, '')), ''), v_coord, v_due, p_id)
  returning id into v_task;
  update public.crew_tool_reports set task_id = v_task where id = p_id;

  for v_photo in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    insert into public.crew_tool_report_files (org_id, report_id, title, file_path, uploaded_by_id)
    values (v_org, p_id, left(nullif(btrim(coalesce(v_photo->>'title', '')), ''), 200), v_photo->>'path', v_uid);
  end loop;

  -- FR-CTR-012/013: the coordinator is told; with none set, everyone who can write the equipment register is.
  for v_rcpt in
    select x from (
      select v_coord as x where v_coord is not null
      union all
      select p.id from public.profiles p
       where v_coord is null and p.org_id = v_org and p.status = 'active' and p.role in ('Admin', 'Project Manager')) s
  loop
    v_loc := public.crew_tool_locale(v_rcpt);
    select m.title, m.body into v_msg from public.crew_tool_message(v_loc, p_kind, v_line.name, p_qty, v_crew.name, v_due) m;
    perform public.notify_workflow_user(v_org, v_rcpt, v_msg.title, v_msg.body, 'info', 'task', v_task, v_line.name);
  end loop;

  perform public.log_audit('crew_tool.report', v_org, v_uid, p_id,
    jsonb_build_object('line_id', v_line.id, 'kind', p_kind, 'qty', p_qty, 'task_id', v_task));
  perform set_config('pmo.crew_tool_rpc', 'off', true);
  return p_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.request_imprest_replenishment(p_float uuid, p_kind text DEFAULT 'replenishment'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_id uuid; v_amount numeric; v_gap numeric;
begin
  perform public.assert_is_active_member();
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() or v_f.archived_at is not null then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  if v_uid is distinct from v_f.custodian_id or not public.imprest_custodian_eligible(v_f.org_id, v_f.project_id, v_uid) then
    raise exception 'only this site float''s custodian requests its cash' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  if p_kind not in ('replenishment','funding') then
    raise exception 'unknown request kind %', p_kind using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(p_float);
  if p_kind = 'funding' then
    if exists (select 1 from public.imprest_replenishments r where r.float_id = p_float and r.kind = 'funding'
                 and r.status in ('Requested','Approved')) then
      raise exception 'a funding request for this float is already open' using errcode = 'P0001';
    end if;
    v_gap := v_f.float_amount - (public.imprest_cash_book(p_float) + public.imprest_advances_out(p_float)
                                 + public.imprest_receipts_waiting(p_float));
    if not (v_gap > 0) then
      raise exception 'this float is fully funded' using errcode = 'P0001';
    end if;
    v_amount := v_gap;
  else
    select coalesce(sum(c.amount), 0) into v_amount from public.expense_claims c
     where c.imprest_float_id = p_float and c.kind = 'claim' and c.status = 'Paid' and c.imprest_replenishment_id is null;
    if not (v_amount > 0) then
      raise exception 'there are no settled receipts waiting to be replenished' using errcode = 'P0001';
    end if;
  end if;
  insert into public.imprest_replenishments (org_id, float_id, kind, number, amount, requested_by)
  values (v_f.org_id, p_float, p_kind, public.next_procurement_doc_number(v_f.org_id, 'REP'), v_amount, v_uid)
  returning id into v_id;
  if p_kind = 'replenishment' then
    update public.expense_claims set imprest_replenishment_id = v_id
     where imprest_float_id = p_float and kind = 'claim' and status = 'Paid' and imprest_replenishment_id is null;
  end if;
  perform public.log_audit('imprest_replenishment.requested', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'kind', p_kind, 'amount', v_amount));
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.request_po_variation(p_po_id uuid, p_origin text, p_lines jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid := public.auth_org_id(); v_po public.purchase_orders; v_proc public.procurements; v_rev integer;
        v_id uuid := gen_random_uuid(); v_amount numeric;
begin
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id and org_id = v_org;
  if not (public.auth_role() in ('Admin','Executive','Project Manager','Finance') or v_proc.requested_by_id = auth.uid()) then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id for update;          -- D5 row first
  perform public.subcontract_po_lock(p_po_id);                                                     -- D5 then the PO
  if v_proc.status::text in ('Cancelled','Rejected') then                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  v_rev := public.po_effective_revision(p_po_id);
  if v_rev is null then raise exception 'the PO has no issued BoQ lines' using errcode = '42501'; end if;
  if p_origin is null or p_origin not in ('pre_work','post_work') or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'an origin (pre_work or post_work) and a reason of 1 to 1000 characters are required' using errcode = '23514'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one variation line is required' using errcode = '23502'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
              where not coalesce(x.boq_item_id is not null and x.additional_quantity > 0 and x.additional_quantity < 'Infinity'::numeric
                                 and x.additional_quantity = round(x.additional_quantity, 3), false))
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid) group by x.boq_item_id having count(*) > 1) then
    raise exception 'each line needs a distinct BoQ item and a quantity above zero with at most 3 decimals' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid)
              left join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
              where pl.boq_item_id is null) then
    raise exception 'every variation line must be on the PO''s effective BoQ lines' using errcode = '23514'; end if;
  if p_origin = 'post_work' and exists (                                                           -- FR-SCA-034: only the unclaimed excess
    select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
      join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
      left join public.subcontract_verified(p_po_id) v on v.boq_item_id = x.boq_item_id
     where x.additional_quantity > greatest(coalesce(v.quantity, 0) - pl.quantity, 0) - coalesce((
             select sum(vl.additional_quantity) from public.po_variations o join public.po_variation_lines vl on vl.variation_id = o.id
              where o.po_id = p_po_id and o.origin = 'post_work' and o.status in ('Requested','Approved')
                and vl.boq_item_id = x.boq_item_id), 0)) then
    raise exception 'a post-work variation cannot exceed the verified quantity that is not yet on the PO' using errcode = '23514'; end if;
  select sum(round(x.additional_quantity * pl.rate, 2)) into v_amount
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
    join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id;
  perform set_config('pmo.po_variation_write', 'on', true);
  insert into public.po_variations (id, po_id, number, origin, reason, amount, requested_by)
  values (v_id, p_po_id, public.next_procurement_doc_number(v_org, 'VAR'), p_origin, btrim(p_reason), v_amount, auth.uid());
  insert into public.po_variation_lines (variation_id, boq_item_id, additional_quantity, rate)
  select v_id, x.boq_item_id, x.additional_quantity, pl.rate
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, additional_quantity numeric)
    join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit('po_variation.request', v_org, auth.uid(), v_id,
    jsonb_build_object('po_id', p_po_id, 'origin', p_origin, 'amount', v_amount, 'revision', v_rev));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.reserve_credits(p_org_id uuid, p_amount numeric, p_run_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_available numeric;
  v_id        uuid;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id <> public.auth_org_id() then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_positive' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || p_org_id::text));

  select coalesce((select sum(amount) from public.credits             where org_id = p_org_id), 0)
       - coalesce((select sum(cost)   from public.agent_usage         where org_id = p_org_id), 0)
       - coalesce((select sum(amount) from public.credit_reservations
                    where org_id = p_org_id and released_at is null
                      and created_at > now() - interval '30 minutes'), 0)
    into v_available;

  if v_available >= p_amount then
    insert into public.credit_reservations (org_id, run_id, amount)
      values (p_org_id, p_run_id, p_amount)
      returning id into v_id;
    return v_id;
  end if;

  raise exception 'insufficient_credits' using errcode = '23514';
end $function$
;

CREATE OR REPLACE FUNCTION public.save_equipment_usage(p_entry jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_id uuid; v_asset uuid; v_project uuid; v_date date; v_qty numeric; v_fuel numeric; v_trips int;
  v_unit text; v_kind text; v_note text; v_cur public.equipment_usage_entries; v_after public.equipment_usage_entries;
  v_locked text; v_day numeric; v_cur_asset uuid;
begin
  perform public.assert_is_active_member();
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'entry must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_id := nullif(p_entry->>'id','')::uuid;            v_asset := (p_entry->>'asset_id')::uuid;
    v_project := (p_entry->>'project_id')::uuid;        v_date := (p_entry->>'work_date')::date;
    v_qty := (p_entry->>'quantity')::numeric;           v_fuel := nullif(p_entry->>'fuel_litres','')::numeric;
    v_trips := nullif(p_entry->>'trips','')::int;
  exception when others then
    raise exception 'asset_id, project_id, work_date, quantity, fuel_litres or trips is malformed' using errcode = '22023';
  end;
  v_unit := p_entry->>'unit'; v_kind := coalesce(nullif(p_entry->>'kind',''), 'work');
  v_note := nullif(btrim(coalesce(p_entry->>'note','')), '');
  if v_unit is null or v_unit not in ('hours','days') then raise exception 'unit must be hours or days' using errcode = '22023'; end if;
  if v_kind not in ('work','standby') then raise exception 'kind must be work or standby' using errcode = '22023'; end if;
  if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty < 0 or round(v_qty, 2) <> v_qty then
    raise exception 'quantity must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if (v_unit = 'hours' and v_qty > 24) or (v_unit = 'days' and v_qty > 1) then
    raise exception 'one entry holds at most 24 hours or 1 day' using errcode = '22023';
  end if;
  if v_fuel is not null and (v_fuel::text in ('NaN','Infinity','-Infinity') or v_fuel < 0 or round(v_fuel, 2) <> v_fuel) then
    raise exception 'fuel litres must be zero or more' using errcode = '22023';
  end if;
  if v_fuel is not null and v_fuel >= 100000000 then
    raise exception 'fuel litres must be less than 100,000,000' using errcode = '22023';
  end if;
  if v_trips is not null and v_trips < 0 then raise exception 'trips must be zero or more' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'the note is at most 500 characters' using errcode = '22023'; end if;
  if v_date is null or v_date > public.equipment_org_today(v_org) then
    raise exception 'the work date is in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  -- #1649: archiving an asset stops NEW usage; it never strands a draft. An edit that keeps the entry's own asset passes.
  if v_id is not null then
    select e.asset_id into v_cur_asset from public.equipment_usage_entries e where e.id = v_id and e.org_id = v_org;
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = v_org
                    and (a.archived_at is null or a.id is not distinct from v_cur_asset)) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  v_locked := public.equipment_entry_locked_unit(v_org, v_asset, v_date);
  if v_locked is not null and v_locked <> v_unit then
    raise exception 'this asset is costed per % on that date; log it in %', v_locked, v_locked using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind,
                                                fuel_litres, trips, note, status, author_id)
    values (v_org, v_asset, v_project, v_date, v_qty, v_unit, v_kind, v_fuel, v_trips, v_note, 'Draft', v_uid)
    returning * into v_after;                                   -- 23505 from equipment_usage_one_per_day
    perform public.log_audit('equipment_usage.create', v_org, v_uid, v_after.id, jsonb_build_object('to', 'Draft', 'after', to_jsonb(v_after)));
  else
    select * into v_cur from public.equipment_usage_entries e where e.id = v_id for update;
    if not found or v_cur.org_id is distinct from v_org then raise exception 'entry not found' using errcode = 'P0002'; end if;
    if v_cur.author_id is distinct from v_uid then raise exception 'only the author edits an entry' using errcode = '42501'; end if;  -- null-safe
    if v_cur.status not in ('Draft','Rejected') or v_cur.archived_at is not null then
      raise exception 'only a draft or rejected entry can be edited' using errcode = '22023';
    end if;
    update public.equipment_usage_entries set asset_id = v_asset, project_id = v_project, work_date = v_date, quantity = v_qty,
           unit = v_unit, kind = v_kind, fuel_litres = v_fuel, trips = v_trips, note = v_note, updated_at = now()
     where id = v_id returning * into v_after;
    perform public.log_audit('equipment_usage.update', v_org, v_uid, v_id, jsonb_build_object('before', to_jsonb(v_cur), 'after', to_jsonb(v_after)));
  end if;
  -- OQ-7 / PQ-12: warn, never block, when the asset's day exceeds 24 h across projects
  select coalesce(sum(case when e.unit = 'hours' then e.quantity else e.quantity * 24 end), 0) into v_day
    from public.equipment_usage_entries e
   where e.org_id = v_org and e.asset_id = v_asset and e.work_date = v_date and e.archived_at is null and e.status <> 'Rejected';
  return jsonb_build_object('id', v_after.id, 'status', v_after.status, 'day_total_hours', v_day, 'over_24h', v_day > 24);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_stock_draft(p_document_id uuid, p_header jsonb, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_uid uuid := auth.uid(); d public.stock_documents; v_occ date; v_old jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = v_org for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: only a draft can be edited' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid then raise exception 'only the author edits a draft' using errcode = '42501'; end if;
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  if coalesce(p_header->>'kind', d.kind) <> d.kind then raise exception 'STK_INVALID: a document''s kind cannot change' using errcode = 'P0001'; end if;
  perform public.stock_validate_payload(v_org, d.kind, p_header, p_lines);
  if public.stock_assert_keeper(v_org, (p_header->>'warehouse_id')::uuid, v_uid) then
    perform public.log_audit('stock.admin_author', v_org, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', p_header->>'warehouse_id', 'number', d.number));
  end if;
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, d.occurred_on);
  perform public.stock_assert_dates(v_org, v_occ);
  update public.stock_documents set warehouse_id = (p_header->>'warehouse_id')::uuid, to_warehouse_id = nullif(p_header->>'to_warehouse_id', '')::uuid,
         project_id = case when d.kind = 'issue' then nullif(p_header->>'project_id', '')::uuid else d.project_id end, procurement_id = nullif(p_header->>'procurement_id', '')::uuid,
         reason = nullif(btrim(p_header->>'reason'), ''), note = nullif(btrim(p_header->>'note'), ''), occurred_on = v_occ,
         revision = d.revision + 1                                                                                   -- mut:revision
   where id = d.id returning * into d;
  select coalesce(jsonb_agg(o), '[]'::jsonb) into v_old from (
    select distinct on (l.item_id, l.direction) l.item_id, l.direction, l.unit_cost from public.stock_document_lines l
     where l.document_id = d.id and l.unit_cost is not null order by l.item_id, l.direction, l.line_no) o;
  delete from public.stock_document_lines where document_id = d.id;
  perform public.stock_insert_lines(d, p_lines);
  if d.kind in ('adjustment','count') then
    update public.stock_document_lines n set unit_cost = (o->>'unit_cost')::numeric                                 -- mut:keepcost
      from jsonb_array_elements(v_old) o
     where n.document_id = d.id and n.unit_cost is null and n.item_id = (o->>'item_id')::uuid
       and n.direction is not distinct from (o->>'direction') and (d.kind = 'count' or n.direction = 'in');
  end if;
  perform public.stock_apply(d, false);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_timesheet_week(p_timesheet_id uuid, p_week_start_date date, p_upserts jsonb DEFAULT '[]'::jsonb, p_delete_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_org        uuid := auth_org_id();
  v_sheet_id   uuid := p_timesheet_id;
  v_owner      uuid;
  v_status     timesheet_status;
  v_sheet_org  uuid;
  v_sheet_week date;
  v_bad_proj   int;
  v_bad_date   int;
  v_attribution record;
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller — this RPC already refuses a NULL auth.uid() below, so
  -- it never had a machine caller to protect. Placed FIRST so an offboarded user gets the offboarding
  -- message rather than a bare 'not authenticated'/'no org context'.
  perform public.assert_is_active_member();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'no org context' using errcode = '42501';
  end if;
  -- 0268: the same role set as timesheet_entries_write (and the FE's timesheet create/edit) —
  -- this definer bypasses that policy, so it must state the set itself.
  if auth_role() is null or auth_role() not in ('Admin','Executive','Project Manager','Engineer') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- 1. Resolve (or create) the Draft sheet. Creating self-stamps user_id = caller.
  if v_sheet_id is null then
    insert into public.timesheets (org_id, user_id, week_start_date, status)
    values (v_org, v_uid, p_week_start_date, 'Draft')
    returning id into v_sheet_id;
  end if;

  -- 2. Ownership + Draft + tenancy re-assertion (mirrors timesheets_insert / entries_write RLS).
  --    (i) week_start_date is read HERE: the sheet — not the caller's argument — defines the week.
  select user_id, status, org_id, week_start_date
    into v_owner, v_status, v_sheet_org, v_sheet_week
    from public.timesheets where id = v_sheet_id for update;
  if v_owner is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;
  if v_sheet_org is distinct from v_org or v_owner is distinct from v_uid then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status <> 'Draft' then
    raise exception 'timesheet is not editable (status %)', v_status using errcode = 'P0001';
  end if;

  -- 2b. (ii) The caller named a sheet AND a week; if they disagree, one of them is wrong and the
  --     server must not pick. Silently using v_sheet_week would honour a call whose entries were
  --     authored against a different week — the FE's own week is what it renders and diffs against.
  if p_timesheet_id is not null and p_week_start_date is distinct from v_sheet_week then
    raise exception 'p_week_start_date % does not match the timesheet week %',
      to_char(p_week_start_date, 'YYYY-MM-DD'), to_char(v_sheet_week, 'YYYY-MM-DD')
      using errcode = '22023';
  end if;

  -- 3. Upserts. Every referenced project must be in the caller's org (parent-project
  --    tenancy guard from 0011). Reject BEFORE any write if a foreign project appears.
  if jsonb_array_length(p_upserts) > 0 then
    select count(*) into v_bad_proj
      from jsonb_to_recordset(p_upserts) as u(project_id uuid)
     where not exists (
       select 1 from public.projects p where p.id = u.project_id and p.org_id = v_org);
    if v_bad_proj > 0 then
      raise exception 'not authorized' using errcode = '42501';
    end if;

    -- 3b. (iii) Week-bounds preflight against the SHEET's week. Rejecting before any write keeps
    --     0168's all-or-nothing guarantee (no partial draft). `u.entry_date is null` is explicit:
    --     a missing key compares as NULL, which is not TRUE, so a two-sided comparison alone would
    --     let it through to surface as a bare 23502 not-null violation instead of this reason.
    select count(*) into v_bad_date
      from jsonb_to_recordset(p_upserts) as u(entry_date date)
     where u.entry_date is null
        or u.entry_date < v_sheet_week
        or u.entry_date > (v_sheet_week + 6);
    if v_bad_date > 0 then
      raise exception 'entry_date is outside the timesheet week (%)',
        to_char(v_sheet_week, 'YYYY-MM-DD') using errcode = '23514';
    end if;

    insert into public.timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours, notes)
    select v_org, v_sheet_id, u.project_id, u.entry_date, u.hours, u.notes
      from jsonb_to_recordset(p_upserts)
             as u(project_id uuid, entry_date date, hours numeric, notes text)
    on conflict (timesheet_id, project_id, entry_date)
      do update set hours = excluded.hours, notes = excluded.notes;

    -- 3c. 0952 (#2517): a line that names `work_order_id` / `discipline_id` takes both (a missing one = none).
    --     A line that names neither keeps what it had, so a caller that predates this keeps its behaviour.
    --     check_cost_attribution (0951 §2) refuses a work order of another project or org (23514).
    for v_attribution in
      select te.id, nullif(e->>'work_order_id', '')::uuid as work_order_id,
             nullif(e->>'discipline_id', '')::uuid as discipline_id
        from jsonb_array_elements(p_upserts) e
        join public.timesheet_entries te on te.timesheet_id = v_sheet_id
         and te.project_id = (e->>'project_id')::uuid and te.entry_date = (e->>'entry_date')::date
       where (e ? 'work_order_id' or e ? 'discipline_id')
         and (te.work_order_id is distinct from nullif(e->>'work_order_id', '')::uuid
           or te.discipline_id is distinct from nullif(e->>'discipline_id', '')::uuid)
    loop
      perform public.set_cost_attribution('timesheet_entry', array[v_attribution.id],
        v_attribution.work_order_id, v_attribution.discipline_id);
    end loop;
  end if;

  -- 4. Deletes — pinned to entries on the RESOLVED (own) sheet, so a caller can never
  --    delete another sheet's rows by passing foreign ids (they simply match nothing).
  if array_length(p_delete_ids, 1) is not null then
    delete from public.timesheet_entries
     where id = any(p_delete_ids) and timesheet_id = v_sheet_id;
  end if;

  return v_sheet_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.schedule_retention_release(p_claim uuid, p_amount numeric, p_due_on date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c public.progress_claims; v_id uuid;
begin
  perform public.assert_is_active_member();
  v_c := public.lock_retention_claim(p_claim);
  if v_c.withdrawn_at is not null then
    raise exception 'this progress claim was withdrawn' using errcode = '55000', detail = 'claim-withdrawn';
  end if;
  if v_c.retention_amount <= 0 then
    raise exception 'this claim holds no retention' using errcode = '55000', detail = 'no-retention';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'a release is a positive amount with at most 2 decimals' using errcode = '23514', detail = 'release-amount';
  end if;
  if p_due_on is null then
    raise exception 'a release needs the date it falls due' using errcode = '23514', detail = 'release-due-date';
  end if;
  insert into public.retention_releases (org_id, claim_id, project_id, amount, due_on, note, created_by)
  values (v_c.org_id, v_c.id, v_c.project_id, p_amount, p_due_on, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  perform public.log_audit('retention_release.schedule', v_c.org_id, auth.uid(), v_c.id,
    jsonb_build_object('release_id', v_id, 'amount', p_amount, 'due_on', p_due_on));
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.send_task_reminders(p_task_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me  uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_used int;
  v_out jsonb := '[]'::jsonb;
  v_sender text;
  v_id uuid;
  c record;
begin
  perform public.assert_is_active_member();
  if coalesce(cardinality(p_task_ids), 0) not between 1 and 10 then
    raise exception 'between 1 and 10 tasks may be reminded at once' using errcode = '22023';
  end if;
  -- FR-RMD-014: serialise this sender's sends so the cap count cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('task_reminders:sender:' || v_me::text, 0));
  select count(*) into v_used from public.task_reminders
   where sender_id = v_me and created_at > now() - public.task_reminder_window();
  select coalesce(nullif(btrim(p.full_name), ''), 'A colleague') into v_sender from public.profiles p where p.id = v_me;

  foreach v_id in array (select array_agg(distinct x order by x) from unnest(p_task_ids) x) loop
    -- PQ-1: per-task lock, taken in ascending id order, so concurrent senders de-duplicate without deadlock.
    perform pg_advisory_xact_lock(hashtextextended('task_reminders:task:' || v_id::text, 0));
    select * into c from public.task_reminder_check(v_me, v_org, v_id);
    -- PQ-6: names in the result are read here, never taken from the caller (task_name is null for not_found).
    if c.outcome <> 'eligible' then
      v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', c.outcome, 'task_name', c.task_name);
      continue;
    end if;
    if v_used >= public.task_reminder_daily_cap() then
      v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', 'daily_limit', 'task_name', c.task_name);
      continue;
    end if;
    insert into public.task_reminders (org_id, sender_id, recipient_id, task_id)
      values (v_org, v_me, c.recipient_id, v_id);
    -- FR-RMD-017: server-written text; notify_workflow_user re-checks org, active membership and not-self.
    perform public.notify_workflow_user(v_org, c.recipient_id, 'Reminder: a task is overdue',
      v_sender || ' reminded you: "' || c.task_name || '" was due ' || to_char(c.due_date, 'FMDD Mon YYYY') || '.',
      'info', 'task', v_id, c.task_name);
    v_used := v_used + 1;
    v_out := v_out || jsonb_build_object('task_id', v_id, 'outcome', 'sent', 'task_name', c.task_name,
      'recipient_name', (select p.full_name from public.profiles p where p.id = c.recipient_id));
  end loop;
  return jsonb_build_object('remaining', greatest(public.task_reminder_daily_cap() - v_used, 0), 'items', v_out);
end $function$
;

CREATE OR REPLACE FUNCTION public.set_cost_attribution(p_source text, p_ids uuid[], p_work_order_id uuid, p_discipline_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_priv boolean;
  v_ids uuid[];
  v_found int;
  v_allowed int;
  v_before jsonb;
  v_n int;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('purchase_request', 'purchase_order', 'goods_receipt', 'vendor_bill',
                                          'timesheet_entry', 'stock_document', 'equipment_usage') then
    raise exception 'unknown cost source' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct i), '{}') into v_ids from unnest(coalesce(p_ids, '{}')) i where i is not null;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then
    raise exception 'name between 1 and 500 records' using errcode = '22023';
  end if;
  v_priv := v_role in ('Admin', 'Executive', 'Finance', 'Project Manager');

  -- Lock the rows, count those in the caller's org, and count those the caller may change.
  case p_source
    when 'purchase_request' then
      perform 1 from public.purchase_requests r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.purchase_requests r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'purchase_order' then
      perform 1 from public.purchase_orders r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.purchase_orders r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'goods_receipt' then
      perform 1 from public.procurement_receipts r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.procurement_receipts r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'vendor_bill' then
      perform 1 from public.procurement_invoices r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.procurement_invoices r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'timesheet_entry' then
      perform 1 from public.timesheet_entries e where e.id = any(v_ids) and e.org_id = v_org for update of e;
      select count(*), count(*) filter (where v_priv or (t.user_id = v_uid and t.status = 'Draft')),
             jsonb_agg(jsonb_build_object('id', e.id, 'work_order_id', e.work_order_id, 'discipline_id', e.discipline_id))
        into v_found, v_allowed, v_before
        from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
       where e.id = any(v_ids) and e.org_id = v_org;
    when 'stock_document' then
      perform 1 from public.stock_documents d where d.id = any(v_ids) and d.org_id = v_org for update of d;
      select count(*), count(*) filter (where v_priv or d.created_by = v_uid),
             jsonb_agg(jsonb_build_object('id', d.id, 'work_order_id', d.work_order_id, 'discipline_id', d.discipline_id))
        into v_found, v_allowed, v_before
        from public.stock_documents d
       where d.id = any(v_ids) and d.org_id = v_org;
    when 'equipment_usage' then
      perform 1 from public.equipment_usage_entries u where u.id = any(v_ids) and u.org_id = v_org for update of u;
      select count(*), count(*) filter (where v_priv or (u.author_id = v_uid and u.status in ('Draft', 'Rejected') and u.archived_at is null)),
             jsonb_agg(jsonb_build_object('id', u.id, 'work_order_id', u.work_order_id, 'discipline_id', u.discipline_id))
        into v_found, v_allowed, v_before
        from public.equipment_usage_entries u
       where u.id = any(v_ids) and u.org_id = v_org;
  end case;

  if v_found <> cardinality(v_ids) then
    raise exception 'record not found' using errcode = 'P0002';   -- SECURITY: another org's id reads as absent
  end if;
  if v_allowed <> v_found then
    raise exception 'you cannot change the work order or discipline of this record' using errcode = '42501';
  end if;

  case p_source
    when 'purchase_request' then update public.purchase_requests set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'purchase_order'   then update public.purchase_orders   set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'goods_receipt'    then update public.procurement_receipts set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'vendor_bill'      then update public.procurement_invoices set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'timesheet_entry'  then update public.timesheet_entries set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'stock_document'   then update public.stock_documents   set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'equipment_usage'  then update public.equipment_usage_entries set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
  end case;
  get diagnostics v_n = row_count;

  -- One audit row per record, carrying what it named before.
  perform public.log_audit('cost_attribution.set', v_org, v_uid, (b->>'id')::uuid,
            jsonb_build_object('source', p_source, 'before', b - 'id',
                               'after', jsonb_build_object('work_order_id', p_work_order_id, 'discipline_id', p_discipline_id)))
     from jsonb_array_elements(v_before) b where p_source <> 'timesheet_entry';
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_equipment_status(p_asset uuid, p_date date, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.equipment_set_status_core(p_asset, p_date, p_status, p_note);
end $function$
;

CREATE OR REPLACE FUNCTION public.set_equipment_status_bulk(p_date date, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_i jsonb; v_n int := 0;
begin
  perform public.assert_is_active_member();
  if not public.equipment_can_set_status(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'items must be an array of at most 200' using errcode = '22023';
  end if;
  for v_i in select * from jsonb_array_elements(p_items) loop
    perform public.equipment_set_status_core((v_i->>'asset_id')::uuid, p_date, v_i->>'status', v_i->>'note');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.start_procurement_import_run(p_org_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_org uuid;
  v_id uuid;
begin
  -- SECURITY DEFINER: current_user inside this body is the owner, never the caller, so the bypass
  -- check resolves the CALLER's session role and hands it to the one shared trust-boundary
  -- predicate through its name-parameter entry point (0168 AC-UPS-053: exactly one copy of the
  -- catalog lookup, under the actor_bypasses_rls name). The no-arg form would always read postgres
  -- here and exempt every caller.
  if public.actor_bypasses_rls(coalesce(nullif(current_setting('role', true), 'none'), session_user)) then
    v_org := p_org_id;
  else
    perform public.assert_is_active_member();
    v_org := public.auth_org_id();
    if p_org_id is not null and p_org_id is distinct from v_org then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  if v_org is null then raise exception 'organization required' using errcode = '42501'; end if;
  perform public.assert_feature_on(v_org, 'import_export');

  loop
    v_id := gen_random_uuid();
    begin
      insert into public.procurement_import_runs(id, org_id, identity_version) values (v_id, v_org, 2);
      return v_id;
    exception when unique_violation then null;
    end;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.tpi_cancel(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v public.third_party_inspections; v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role();
begin
  perform public.assert_is_active_member(); -- also inside tpi_load_for_update; named here so the standing AC-AMG-001 sweep sees the gate
  v := public.tpi_load_for_update(p_id);
  if not (v_role in ('Admin','Project Manager','Finance')
          or (v.created_by = v_uid and v.status = 'requested' and v_role = 'Engineer')) then
    raise exception 'you cannot cancel this inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = nullif(btrim(p_reason), ''), updated_at = now() where id = p_id;
  perform public.log_audit('third_party_inspection.cancel', v.org_id, v_uid, p_id, jsonb_build_object('reason', btrim(p_reason)));
end $function$
;

CREATE OR REPLACE FUNCTION public.tpi_create(p_work_order_id uuid, p_title text, p_test_kind text, p_planned_date date, p_vendor_id uuid, p_estimate numeric, p_estimate_currency text, p_note text, p_required_for text[], p_section_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_wo public.work_orders; v_id uuid := gen_random_uuid(); v_gates text[];
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot create an inspection' using errcode = '42501';
  end if;
  if p_section_id is not null then
    raise exception 'TPI_SECTION_UNAVAILABLE: work-order sections are not available yet' using errcode = '23514';
  end if;
  select * into v_wo from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
  if not found or v_wo.status = 'Cancelled' then
    raise exception 'TPI_WO_SCOPE: the work order is not available for an inspection' using errcode = '23514';
  end if;
  if p_vendor_id is not null and not exists (select 1 from public.companies c where c.id = p_vendor_id and c.org_id = v_org) then
    raise exception 'TPI_VENDOR_SCOPE: the vendor is not available' using errcode = '23514';
  end if;
  if p_planned_date is null then raise exception 'TPI_PLANNED_DATE: a planned date is required' using errcode = '23514'; end if;
  if (p_estimate is null) is distinct from (p_estimate_currency is null) then
    raise exception 'TPI_ESTIMATE: an estimate needs its currency' using errcode = '23514';
  end if;
  select coalesce(array_agg(distinct g order by g), '{}') into v_gates from unnest(coalesce(p_required_for, '{}')) g;
  insert into public.third_party_inspections
    (id, org_id, work_order_id, project_id, title, test_kind, planned_date, vendor_id, estimate, estimate_currency, note, required_for, created_by)
  values (v_id, v_org, v_wo.id, v_wo.project_id, btrim(p_title), nullif(btrim(p_test_kind), ''), p_planned_date, p_vendor_id,
          p_estimate, upper(p_estimate_currency), nullif(btrim(p_note), ''), v_gates, v_uid);
  perform public.log_audit('third_party_inspection.create', v_org, v_uid, v_id, jsonb_build_object('work_order_id', v_wo.id));
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.tpi_record_execution(p_id uuid, p_executed_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v public.third_party_inspections; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member(); -- also inside tpi_load_for_update; named here so the standing AC-AMG-001 sweep sees the gate
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot advance an inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'executed', executed_on = p_executed_on, executed_by = v_uid, updated_at = now()
   where id = p_id;
  perform public.log_audit('third_party_inspection.execute', v.org_id, v_uid, p_id, '{}'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.tpi_record_invitation(p_id uuid, p_invited_on date, p_invited_who text, p_invited_how text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v public.third_party_inspections; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member(); -- also inside tpi_load_for_update; named here so the standing AC-AMG-001 sweep sees the gate
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot advance an inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'invited', invited_on = p_invited_on, invited_who = nullif(btrim(p_invited_who), ''),
         invited_how = nullif(btrim(p_invited_how), ''), invited_by = v_uid, updated_at = now() where id = p_id;
  perform public.log_audit('third_party_inspection.invite', v.org_id, v_uid, p_id, '{}'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.tpi_record_report(p_id uuid, p_result text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v public.third_party_inspections; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member(); -- also inside tpi_load_for_update; named here so the standing AC-AMG-001 sweep sees the gate
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance','Engineer') then
    raise exception 'you cannot advance an inspection' using errcode = '42501';
  end if;
  update public.third_party_inspections set status = 'reported', result = coalesce(p_result, 'pending'),
         reported_at = now(), reported_by = v_uid, updated_at = now() where id = p_id;
  perform public.log_audit('third_party_inspection.report', v.org_id, v_uid, p_id, jsonb_build_object('result', p_result));
end $function$
;

CREATE OR REPLACE FUNCTION public.transition_document_status(p_doc_id uuid, p_to doc_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from public.doc_status;
  v_org uuid;
  v_cat uuid;
  v_project uuid;
  v_author uuid;
  v_parent_id uuid;
  v_source public.doc_source;
  v_item_kind text;
  v_content_tag text;
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_legal jsonb := jsonb_build_object(
    'Draft',jsonb_build_array('Issued'),'Issued',jsonb_build_array('Approved','Rejected'),
    'Approved',jsonb_build_array('Closed'),'Rejected',jsonb_build_array('Draft','Closed'),
    'Closed',jsonb_build_array(),'Superseded',jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select status,org_id,category_id,project_id,author_id,parent_document_id,source,ms_item_kind,ms_content_tag_at_issue
    into v_from,v_org,v_cat,v_project,v_author,v_parent_id,v_source,v_item_kind,v_content_tag
    from public.project_documents where id=p_doc_id for update;
  if v_from is null then raise exception 'document not found' using errcode='P0002'; end if;
  -- #2579: a document whose category the caller's role cannot view is indistinguishable from a missing one
  if not public.document_category_visible(v_cat,v_org) then raise exception 'document not found' using errcode='P0002'; end if;
  if v_org is distinct from public.auth_org_id() then raise exception 'not authorized' using errcode='42501'; end if;
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode='42501';
  end if;
  if v_source='onedrive' and v_item_kind='folder' then raise exception 'Folders are reference-only entries.' using errcode='23514',detail='m365-folder-reference-only'; end if;
  if v_source='onedrive' and v_item_kind='file' and v_from='Draft' and p_to='Issued' then raise exception 'Issue requires a server verification.' using errcode='23514',detail='m365-issue-check-required'; end if;
  if not (v_legal -> v_from::text) ? p_to::text then raise exception 'illegal document transition % -> %',v_from,p_to using errcode='P0001'; end if;
  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then raise exception 'separation of duties: cannot approve or reject your own document' using errcode='42501'; end if;
  update public.project_documents set status=p_to where id=p_doc_id and org_id=v_org and project_id=v_project;
  perform public.log_audit('project_document.transition',v_org,v_uid,p_doc_id,jsonb_build_object('from',v_from::text,'to',p_to::text));
  if p_to='Approved' and v_parent_id is not null then
    perform 1 from public.project_documents where id=v_parent_id and org_id=v_org and project_id=v_project for update;
    update public.project_documents set status='Superseded'
      where id=v_parent_id and org_id=v_org and project_id=v_project and status in ('Issued','Approved');
  end if;
end; $function$
;

CREATE OR REPLACE FUNCTION public.transition_equipment_usage(p_id uuid, p_to text, p_notes text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.assert_is_active_member();
  return public.equipment_usage_transition_core(p_id, p_to, p_notes);
end $function$
;

CREATE OR REPLACE FUNCTION public.transition_expense_claim(p_id uuid, p_to expense_claim_status, p_notes text DEFAULT NULL::text, p_payment_reference text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row      public.expense_claims%rowtype;
  v_uid      uuid      := auth.uid();
  v_role     user_role := auth_role();
  v_is_admin boolean;
  v_route    record;
  v_lines    int;
  v_adv      public.expense_claims%rowtype;
  v_applied  numeric   := 0;
  v_today    date;
  v_float    public.imprest_floats%rowtype;                                               -- 0423
  v_limit    numeric;                                                                      -- 0423
  v_tz       text;                                                                         -- 0423
  v_remain   numeric;                                                                      -- 0423
  v_exc      boolean   := false;                                                           -- 0423
  v_plan_by  uuid;                                                                         -- 0423
  v_out      numeric;                                                                      -- 0423
  v_legal    jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted','Cancelled'),
    'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',  jsonb_build_array('Paid','Cancelled'),
    'Rejected',  jsonb_build_array('Draft'),
    'Paid',      jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense claim not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (v_legal -> v_row.status::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_row.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  if v_row.imprest_float_id is not null then                                               -- 0423
    select * into v_float from public.imprest_floats where id = v_row.imprest_float_id;    -- 0423
    if v_float.archived_at is not null and p_to in ('Approved','Paid') then                -- 0423
      raise exception 'this site float is archived: its records can no longer be approved or paid'  -- 0423
        using errcode = 'P0001';                                                           -- 0423
    end if;                                                                                -- 0423
    v_tz := coalesce((select o.default_timezone from public.organizations o                -- 0423
                       where o.id = v_row.org_id), 'UTC');                                 -- 0423
  end if;                                                                                  -- 0423

  -- SoD (DD-EXP-3), for every actor including an Admin (the OD-PROC-8 shape).
  if v_row.status = 'Submitted' and p_to in ('Approved','Rejected') and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot approve or reject their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot pay their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.approved_by_id then
    raise exception 'separation of duties: the approver cannot also pay this expense claim' using errcode = '42501';
  end if;
  -- 0423 DD-IMP-7.1: only the custodian pays a float record, so the custodian never decides one.
  if v_row.imprest_float_id is not null and v_row.status = 'Submitted'                      -- 0423
     and p_to in ('Approved','Rejected') and v_uid = v_float.custodian_id then               -- 0423
    raise exception 'separation of duties: the float''s custodian pays this record and cannot also decide it'  -- 0423
      using errcode = '42501';                                                               -- 0423
  end if;                                                                                  -- 0423

  if p_to = 'Submitted' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can submit this expense claim' using errcode = '42501';
    end if;
    if v_row.kind = 'claim' then
      select count(*) into v_lines from public.expense_claim_lines l where l.claim_id = p_id;
      if v_lines = 0 then
        raise exception 'an expense claim needs at least one line before it can be submitted' using errcode = 'P0001';
      end if;
    end if;
    if not (v_row.amount > 0) then
      raise exception 'the amount must be greater than zero before submitting' using errcode = 'P0001';
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423
      select s.procurement_limit into v_limit from public.org_imprest_settings s           -- 0423
       where s.org_id = v_row.org_id;                                                      -- 0423
      if v_limit is null or v_row.amount > v_limit then                                    -- 0423 DD-IMP-5, fail closed
        raise exception 'this is above the procurement limit of % for site cash: raise it as a procurement request instead',  -- 0423
          coalesce(v_limit::text, '(unset)') using errcode = 'P0001';                      -- 0423
      end if;                                                                              -- 0423
      if v_row.kind = 'claim' and not exists (select 1 from public.expense_claim_files f   -- 0423 OQ-IMP-4
                    where f.claim_id = p_id and f.archived_at is null) then                -- 0423
        raise exception 'a claim paid from site cash needs at least one receipt attached' using errcode = 'P0001';  -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  elsif v_row.status = 'Rejected' and p_to = 'Draft' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can send a rejected expense claim back to Draft' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not ((v_row.status in ('Draft','Submitted') and v_uid = v_row.claimant_id) or v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- #803 routing, called — never copied (ADR-0075 §3). Same lock key as transition_procurement (0243 §7) so a
    -- claim and a purchase request on one line serialize (FR-EXP-022). Classification runs AFTER the lock is held.
    if v_row.project_id is not null then
      -- 1017: whole-project test lock, taken before the line lock (project -> line, everywhere).
      perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_row.project_id::text, 0));
      if v_row.budget_category is not null then
      perform pg_advisory_xact_lock(
          hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
      end if;
    end if;
    select * into v_route
      from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_row.amount,
                                       v_row.currency, v_row.claimant_id, v_uid, v_row.submitted_at);
    -- 0423 FR-IMP-024: under the float lock (after the line lock, plan delta 5), an item that does not fit the month's
    -- remaining is an exception routed to the senior set only; the plan's own approver is excluded.  -- 0423
    if v_row.imprest_float_id is not null then                                             -- 0423
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423
      v_remain := public.imprest_remaining(v_row.imprest_float_id, v_row.imprest_month,    -- 0423
                                           v_row.budget_category);                         -- 0423
      v_exc := v_row.amount > v_remain;                                                    -- 0423
      if v_exc then                                                                        -- 0423
        select p.approved_by into v_plan_by from public.imprest_plans p                    -- 0423
         where p.float_id = v_row.imprest_float_id and p.month = v_row.imprest_month       -- 0423
           and p.status = 'Approved';                                                      -- 0423
        if v_uid = v_plan_by then                                                          -- 0423
          raise exception 'separation of duties: the approver of this month''s plan cannot decide an out-of-plan item'  -- 0423
            using errcode = '42501';                                                       -- 0423
        end if;                                                                            -- 0423
        select r.route, r.approver_ids, v_route.reason, v_route.line_budget, v_route.line_used  -- 0423
          into v_route                                                                     -- 0423
          from public.imprest_senior_route(v_row.org_id, v_row.claimant_id) r;             -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
    -- coalesce: a NULL route must refuse, never pass (DD-APR-5).
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason
          using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown')
        using errcode = '42501';
    end if;
    -- The flat floor still applies to everyone but an Admin (named approvers hold this rank by construction).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    perform public.log_audit('expense_claim.approval_route', v_row.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_row.amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_row.budget_category::text,
        'plan_exception', v_exc,                                                           -- 0423
        'plan_shortfall', case when v_exc then v_row.amount - v_remain end,                -- 0423
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  elsif p_to = 'Paid' then
    if v_row.imprest_float_id is null                                                      -- 0423 off-float: FR-EXP-024 unchanged
       and not (v_is_admin or v_role = 'Finance') then                                   -- 0423 (edited: was `if not (...)`)
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    -- 0423 DD-IMP-7: a float record is paid by its custodian alone, still eligible, whatever their role.
    if v_row.imprest_float_id is not null and (v_uid is distinct from v_float.custodian_id   -- 0423
       or not public.imprest_custodian_eligible(v_row.org_id, v_float.project_id, v_uid)) then  -- 0423
      raise exception 'only this site float''s custodian pays a record charged to it' using errcode = '42501';  -- 0423
    end if;                                                                                -- 0423
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    if v_row.advance_id is not null then
      -- Lock order is always claim → advance; record_expense_advance_return locks only the advance.
      select * into v_adv from public.expense_claims where id = v_row.advance_id for update;
      if v_adv.status is distinct from 'Paid' or v_adv.claimant_id is distinct from v_row.claimant_id then
        raise exception 'the linked advance is not a paid advance of this claimant' using errcode = 'P0001';
      end if;
      v_applied := least(v_row.amount, greatest(public.expense_advance_outstanding(v_row.advance_id), 0));
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423 DD-IMP-3
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423 (claim → advance → float)
      v_out := case v_row.kind when 'advance' then v_row.amount else v_row.amount - v_applied end;  -- 0423
      if public.imprest_cash_book(v_row.imprest_float_id) - v_out < 0 then                 -- 0423
        raise exception 'paying % would overdraw the site float (cash on hand %): request a replenishment first',  -- 0423
          v_out, public.imprest_cash_book(v_row.imprest_float_id) using errcode = 'P0001'; -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  end if;

  update public.expense_claims set
    status            = p_to,
    claim_number      = case when p_to = 'Submitted'
                             then coalesce(claim_number, public.next_procurement_doc_number(org_id,
                                    case kind when 'advance' then 'ADV' else 'EXP' end))
                             else claim_number end,
    submitted_at      = case when p_to = 'Submitted' then now() else submitted_at end,
    imprest_month     = case when p_to = 'Submitted' and imprest_float_id is not null         -- 0423 OQ-IMP-8
                             then date_trunc('month', now() at time zone v_tz)::date          -- 0423
                             when p_to = 'Draft' then null else imprest_month end,            -- 0423
    is_plan_exception = case when p_to = 'Approved' then v_exc                                -- 0423
                             when p_to = 'Draft' then false else is_plan_exception end,       -- 0423
    approved_by_id    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by_id end,
    approved_at       = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    approval_notes    = case when p_to = 'Approved' then p_notes else approval_notes end,
    rejection_notes   = case when p_to = 'Rejected' then nullif(btrim(p_notes), '') when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejection_notes end,
    rejected_by = case when p_to = 'Rejected' then v_uid when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejected_by end,
    rejected_at = case when p_to = 'Rejected' then now() when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejected_at end,
    paid_by_id        = case when p_to = 'Paid' then v_uid else paid_by_id end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then v_today else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    advance_applied   = case when p_to = 'Paid' then v_applied else advance_applied end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;

  perform public.log_audit('expense_claim.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status::text, 'to', p_to::text, 'notes', p_notes, 'advance_applied', v_applied));
end; $function$
;

CREATE OR REPLACE FUNCTION public.transition_imprest_plan(p_id uuid, p_to text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_p      public.imprest_plans%rowtype;
  v_f      public.imprest_floats%rowtype;
  v_uid    uuid := auth.uid();
  v_admin  boolean := public.auth_role() = 'Admin';
  v_tz     text;
  v_today  date;
  v_lines  int;
  v_l      record;
  v_route  record;
  v_routes jsonb := '[]'::jsonb;
  v_glass  boolean := false;
  v_legal  jsonb := jsonb_build_object(
    'Draft', jsonb_build_array('Submitted','Cancelled'), 'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Rejected', jsonb_build_array('Draft','Cancelled'), 'Approved', jsonb_build_array(), 'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select * into v_p from public.imprest_plans where id = p_id for update;
  if not found or v_p.org_id is distinct from public.auth_org_id() then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  -- FR-PLN-006 closure: rejecting or cancelling an EXISTING plan changes nothing forward — a switch-off
  -- must not strand a plan minted while the module was on. Every other transition is gated.
  if coalesce(p_to, '') not in ('Rejected','Cancelled') then
    perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  end if;
  if not (v_legal -> v_p.status) ? p_to then
    raise exception 'illegal transition % -> %', v_p.status, p_to using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_p.float_id;
  if v_f.archived_at is not null and p_to <> 'Cancelled' then  -- an archived float's plans may still be cancelled
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  -- Lock order (plan delta 5): every spend-line lock BEFORE the float lock, never after — transition_expense_claim
  -- takes spend-line then float, so the reverse here could deadlock. Category order keeps plan approvals consistent.
  if p_to in ('Approved','Rejected') then
    perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_f.project_id::text || ':' || l.budget_category::text, 0))
       from public.imprest_plan_lines l where l.plan_id = p_id order by l.budget_category;
  end if;
  perform public.imprest_lock_float(v_p.float_id);
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_p.org_id), 'UTC');
  v_today := (now() at time zone v_tz)::date;

  if p_to in ('Approved','Rejected') then
    if v_uid = v_p.author_id then
      raise exception 'separation of duties: the author cannot decide their own plan' using errcode = '42501';
    end if;
    if v_uid = v_f.custodian_id then
      raise exception 'separation of duties: a custodian cannot decide a plan for their own float' using errcode = '42501';
    end if;
  end if;

  if p_to = 'Submitted' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can submit this plan' using errcode = '42501';
    end if;
    select count(*) into v_lines from public.imprest_plan_lines where plan_id = p_id;
    if v_lines = 0 then
      raise exception 'a plan needs at least one line before it can be submitted' using errcode = 'P0001';
    end if;
    if v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    if exists (select 1 from public.imprest_plans o where o.float_id = v_p.float_id and o.month = v_p.month
                 and o.id <> p_id and o.status in ('Submitted','Approved')) then
      raise exception 'this float already has a plan for that month' using errcode = 'P0001';
    end if;
  elsif p_to = 'Draft' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can reopen this plan' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not (v_uid = v_p.author_id or v_admin or public.auth_role() = 'Finance') then
      raise exception 'not authorized to cancel this plan' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    if p_to = 'Approved' and (v_p.month + interval '1 month')::date <= v_today then
      raise exception 'the plan''s month has ended; it can no longer be approved' using errcode = 'P0001';
    end if;
    if p_to = 'Approved' and v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    for v_l in select l.budget_category, l.planned_amount from public.imprest_plan_lines l where l.plan_id = p_id
               order by l.budget_category loop
      select * into v_route from public.spend_approval_route(v_p.org_id, v_f.project_id, v_l.budget_category,
        v_l.planned_amount, v_f.currency, v_p.author_id, v_uid, v_p.submitted_at);
      if coalesce(v_route.route, 'senior') = 'flat' then
        if not (v_admin or public.holds_spend_approval_authority(public.auth_role())) then
          raise exception 'not authorized to decide this plan' using errcode = '42501';
        end if;
      elsif not coalesce(v_uid = any (v_route.approver_ids), false) then
        if not v_admin then
          raise exception 'approval routing: the % line needs %', v_l.budget_category,
            case v_route.route when 'admin' then 'an Admin' else 'a named approver' end using errcode = '42501';
        end if;
        v_glass := true;
      end if;
      v_routes := v_routes || jsonb_build_object('budget_category', v_l.budget_category::text, 'amount', v_l.planned_amount,
                                                 'route', v_route.route, 'reason', v_route.reason);
    end loop;
    perform public.log_audit('imprest_plan.approval_route', v_p.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to, 'lines', v_routes, 'break_glass', v_glass,
                         'late', p_to = 'Approved' and v_p.month <= v_today));
  end if;

  update public.imprest_plans set
    status         = p_to,
    number         = case when p_to = 'Submitted' then coalesce(number, public.next_procurement_doc_number(org_id, 'IMP')) else number end,
    submitted_at   = case when p_to = 'Submitted' then now() else submitted_at end,
    approved_by    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by end,
    approved_at    = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    decision_notes = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decision_notes end,
    is_late        = case when p_to = 'Approved' then v_p.month <= v_today else is_late end
  where id = p_id;
  perform public.log_audit('imprest_plan.transition', v_p.org_id, v_uid, p_id,
    jsonb_build_object('from', v_p.status, 'to', p_to, 'notes', p_notes));
end; $function$
;

CREATE OR REPLACE FUNCTION public.transition_imprest_replenishment(p_id uuid, p_to text, p_notes text DEFAULT NULL::text, p_payment_reference text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_r   public.imprest_replenishments%rowtype;
  v_f   public.imprest_floats%rowtype;
  v_uid uuid := auth.uid();
  v_fin boolean := public.auth_role() in ('Finance','Admin');
  v_tz  text;
  v_legal jsonb := jsonb_build_object('Requested', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved', jsonb_build_array('Paid','Cancelled'), 'Paid', jsonb_build_array(), 'Rejected', jsonb_build_array(),
    'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select * into v_r from public.imprest_replenishments where id = p_id for update;
  if not found or v_r.org_id is distinct from public.auth_org_id() then
    raise exception 'replenishment not found' using errcode = 'P0002';
  end if;
  -- FR-PLN-006 closure: deciding or paying an EXISTING request is a CLOSING transition — a switch-off
  -- must not strand a request minted while the module was on. Only minting a new decision path forward
  -- (Approved) is gated.
  if coalesce(p_to, '') not in ('Rejected','Paid','Cancelled') then
    perform public.assert_feature_on(public.auth_org_id(), 'imprest');
  end if;
  if not (v_legal -> v_r.status) ? p_to then
    raise exception 'illegal transition % -> %', v_r.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_r.float_id;
  if v_f.archived_at is not null and p_to in ('Approved','Paid') then  -- an archived float's requests may still be closed
    raise exception 'this site float is archived: its requests can no longer be approved or paid' using errcode = 'P0001';
  end if;
  perform public.imprest_lock_float(v_r.float_id);
  -- SoD (FR-IMP-052/053), for every caller including an Admin: site finance never tops up its own float.
  if p_to in ('Approved','Rejected','Paid') and (v_uid = v_f.custodian_id or v_uid = v_r.requested_by) then
    raise exception 'separation of duties: the custodian or requester cannot % this request', lower(p_to) using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_r.approved_by then
    raise exception 'separation of duties: the approver cannot also pay this request' using errcode = '42501';
  end if;
  if p_to in ('Approved','Rejected','Paid') and not v_fin then
    raise exception 'only Finance or an Admin decides or pays a replenishment' using errcode = '42501';
  end if;
  if p_to = 'Cancelled' and not (v_fin or (v_r.status = 'Requested' and v_uid = v_r.requested_by)) then
    raise exception 'not authorized to cancel this request' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_r.kind = 'funding'                                                -- FR-IMP-054 (plan delta 3)
     and public.imprest_cash_book(v_r.float_id) + public.imprest_advances_out(v_r.float_id)
         + public.imprest_receipts_waiting(v_r.float_id) + v_r.amount > v_f.float_amount then
    raise exception 'paying this funding would take the float above its fixed amount' using errcode = 'P0001';
  end if;
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_r.org_id), 'UTC');
  update public.imprest_replenishments set
    status            = p_to,
    rejected_by = case when p_to = 'Rejected' then v_uid else rejected_by end,
    rejected_at = case when p_to = 'Rejected' then now() else rejected_at end,
    approved_by       = case when p_to = 'Approved' then v_uid else approved_by end,
    approved_at       = case when p_to = 'Approved' then now() else approved_at end,
    decided_notes     = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decided_notes end,
    paid_by           = case when p_to = 'Paid' then v_uid else paid_by end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then (now() at time zone v_tz)::date else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;
  if p_to in ('Rejected','Cancelled') then                                                 -- FR-IMP-051: release
    update public.expense_claims set imprest_replenishment_id = null where imprest_replenishment_id = p_id;
  end if;
  perform public.log_audit('imprest_replenishment.transition', v_r.org_id, v_uid, p_id,
    jsonb_build_object('from', v_r.status, 'to', p_to, 'kind', v_r.kind, 'amount', v_r.amount, 'notes', p_notes));
end; $function$
;

CREATE OR REPLACE FUNCTION public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_pr_id uuid; v_pr_no text;                                                                          -- 0766
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled','Ordered','Received','Vendor Invoiced','Paid'),   -- 0362 skips
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled','Received','Vendor Invoiced','Paid'), -- 0362 skips
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled','Received','Vendor Invoiced','Paid'),               -- 0362 skips
    'Ordered',         jsonb_build_array('Received','Cancelled','Vendor Invoiced','Paid'),                         -- 0362 skips
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled','Paid'),                                    -- 0362 skip
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array());
  v_allowed_roles text[];
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- FR-PLN-006 closure: cancelling or rejecting an EXISTING purchase is a CLOSING transition (paid closes
  -- an already-invoiced one); a switch-off must not strand it. Every forward/minting transition is gated.
  if p_to is null or p_to::text not in ('Cancelled','Rejected','Paid') then
    perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  end if;

  if exists(select 1 from public.procurements where id=p_id and record_only) then
    v_gate := public.record_only_step_refusal(p_id,case p_to::text when 'Ordered' then 'purchase-order' when 'Received' then 'goods-receipt' when 'Vendor Invoiced' then 'purchase-invoice' when 'Paid' then 'paid' when 'Cancelled' then 'cancel' else 'unknown' end,null);
    if v_gate is not null then raise exception '%' ,v_gate using errcode='42501'; end if;
  end if;

  -- 0362 FR-PFE-006: a document step the purchase already holds is a no-op — its current step, or a lower step it
  -- has evidence for (e.g. Received, then a request for Ordered once an order is recorded).
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid')
     and (v_from = p_to
          or (public.procurement_step_rank(p_to) < public.procurement_step_rank(v_from)
              and (exists (select 1 from public.purchase_orders x where p_to = 'Ordered' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_receipts x where p_to = 'Received' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_invoices x where p_to = 'Vendor Invoiced' and x.procurement_id = p_id
                                and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null)
                   or exists (select 1 from public.procurement_erp_links l
                                join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                               where l.procurement_id = p_id and d.erp_docstatus = 1
                                 and d.erp_doctype = case p_to::text when 'Ordered' then 'Purchase Order'
                                                     when 'Received' then 'Purchase Receipt' else 'Purchase Invoice' end)))) then
    return;
  end if;

  if public.record_only_step_refusal(p_id) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;
  -- 0749 (#1607): an ERP-owned purchase places its order through the connected system, never as a PMO-only row.
  if p_to = 'Ordered' and public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_id), false) then
    raise exception 'This purchase is managed in your connected system. Record the purchase order to place the order there.'
      using errcode = '42501';
  end if;

  -- SoD-a (requester ≠ approver), outside the Admin skip (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;
  -- SoD-b (approver ≠ payer) on every path to Paid; the update guard re-checks it (0362, FR-PFE-016).
  if p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0362 FR-PFE-010: org purchase rules.
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then
    v_gate := public.procurement_gate_violation(p_id, p_to);
    if v_gate is not null then
      raise exception '%', public.procurement_gate_message(v_gate) using errcode = '23514', detail = v_gate;
    end if;
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') then
    if v_project is not null then
      -- 1017: whole-project test lock, taken before the line lock (project -> line, everywhere).
      perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_project::text, 0));
      if v_category is not null then
        perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
      end if;
    end if;
    v_amount := public.procurement_request_amount(p_id);
    select * into v_route from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester,
             v_uid, public.procurement_submitted_at(p_id));
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
    end if;
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  end if;

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when v_from = 'Ordered'   and p_to = 'Received' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- 0766 (#1986): a purchase request captured while the purchase was still Draft is the request this transition submits.
  if p_to = 'Requested' then
    select r.id, r.pr_number into v_pr_id, v_pr_no from public.purchase_requests r
     where r.procurement_id = p_id and r.status = 'Draft' and r.import_key is null and r.pr_number is not null
       and (select pr_number from public.procurements where id = p_id) is null
     order by r.created_at limit 1 for update;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, v_pr_no, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' and v_pr_id is not null then
    update public.purchase_requests set status = 'Submitted' where id = v_pr_id;
  elsif p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, current_date)
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date,
           coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                        - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null), p.total_value),
           p.currency
      from public.procurements p left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $function$
;

CREATE OR REPLACE FUNCTION public.transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_from  timesheet_status;
  v_org   uuid;
  v_owner uuid;
  v_uid   uuid      := auth.uid();
  v_role  user_role := auth_role();
  v_mgr   uuid;
  v_tm_claim uuid;
  -- The transition map (OD-TS-2 config seam): legal (from → [allowed to]) superset, as data.
  -- Slice A (FR-TSC-001): `Approved` is no longer terminal — `Approved → Draft` is the one new edge.
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted'),
    'Submitted', jsonb_build_array('Approved','Rejected'),
    'Rejected',  jsonb_build_array('Draft'),
    'Approved',  jsonb_build_array('Draft')
  );
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  -- FR-PLN-006 closure: rejecting a SUBMITTED sheet is a CLOSING decision on work already minted, so a
  -- switch-off must not strand the approval queue. Every other transition is gated.
  if p_to is null or p_to::text is distinct from 'Rejected' then
    perform public.assert_feature_on(public.auth_org_id(), 'timesheets');
  end if;
  -- Load + lock the row (serializes concurrent transitions on the SAME timesheet). P0002 if absent.
  select status, org_id, user_id
    into v_from, v_org, v_owner
    from public.timesheets where id = p_timesheet_id for update;
  if v_from is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-TS-003): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-TS-001): (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Authorization matrix + SoD (OD-TS-1/OD-TS-4, FR-TS-004/005/006). Resolve the owner's line manager.
  -- SECURITY: these re-assertions MUST stay (definer bypasses RLS).
  select manager_id into v_mgr from public.profiles where id = v_owner;

  if p_to = 'Submitted' then
    -- Submit: only the owner may submit their own Draft sheet (FR-TS-004).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS — even an Admin can never approve/reject their own timesheet (OD-TS-4-D, FR-TS-005).
    -- This `actor = owner` check is intentionally ordered BEFORE the role/manager check so break-glass
    -- can never defeat separation of duties. Do not reorder.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot approve own timesheet' using errcode = '42501';
    end if;
    -- Then: the assigned line manager (exclusive when set); OR Admin/Exec fallback ONLY when manager is
    -- null; OR Admin break-glass (OD-TS-4-D).
    -- HIGH-TS-1: `v_uid is not distinct from v_mgr` is null-safe — it yields FALSE (not NULL) when
    -- v_mgr is null, so `not (false or ...)` no longer short-circuits to NULL and skips the raise.
    -- The Admin/Exec fallback is therefore gated STRICTLY to a null manager; a non-privileged
    -- bystander on a null-manager sheet now correctly hits 42501.
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to = 'Draft' and v_from = 'Approved' then
    -- Slice A (FR-TSC-020/021): re-open an Approved sheet. The AUTHORITY is the same approver
    -- population as the approve arm above — line manager, Admin/Exec-when-manager-null, or Admin
    -- break-glass — and the OWNER is excluded. SoD FIRST (mirrors the approve arm ordering): an
    -- owner can never re-open their own approved sheet, even if they are Admin.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot re-open own approved timesheet' using errcode = '42501';
    end if;
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    -- #1514 T2 (FR-TM-017): hours that feed a live time-and-materials claim stay approved until the claim is withdrawn.
    if exists (select 1 from public.timesheet_entries e
                where e.timesheet_id = p_timesheet_id and public.tm_source_is_live('timesheet_entry', e.id)) then
      select s.claim_id into v_tm_claim
        from public.timesheet_entries e
        join public.tm_claim_sources s on s.source_kind = 'timesheet_entry' and s.source_id = e.id and s.is_live
       where e.timesheet_id = p_timesheet_id limit 1;
      raise exception 'timesheet hours are in time-and-materials claim %', v_tm_claim using errcode = '55000';
    end if;
    -- FENCE 2 (FR-TSC-008/010, scoped): serialize against a concurrent push insert. The SAME named
    -- per-timesheet advisory lock is acquired by insert_timesheet_outbox_pending (§B), so whichever
    -- side wins the lock the other sees its effect.
    perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
    -- Refuse if ERP may hold a LIVE document — a mirror row with ts_number set and not cancelled
    -- (Luna f1, mirror side). A pushed sheet is refused here; Slice B will fill the cancel-confirmed
    -- admit branch for it. Fail closed on any doubt.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.ts_number is not null and m.erp_cancelled_at is null) then
      raise exception 'reopen-erp-document-held' using errcode = 'P0001';
    end if;
    -- ⚑ THE UNKNOWN ERP OUTCOME (Luna FU-1a round-8 BLOCK — THE money predicate). `post_submit_unknown_at`
    -- is set the moment PMO loses track of a submit's result and is cleared ONLY by learning a real
    -- `ts_number` or by an audited operator attestation (0157 §2/§5). It is deliberately INDEPENDENT of
    -- `push_state` and of the outbox: those answer "can the backstop retry this?", and a re-queue —
    -- including `release_outbox_hold`, which clears BOTH hold states in one transaction — establishes
    -- NOTHING about what ERPNext holds. Before this predicate, a release therefore opened the correction
    -- path over a live ERP document: re-open + re-approve minted a SECOND Timesheet for the week and the
    -- client's hours double-counted permanently (the original command can never be adopted afterwards,
    -- so it never learns the `ts_number` that would have fenced the second push).
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.post_submit_unknown_at is not null) then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- The mirror's own `held` state, kept as an INDEPENDENT predicate (0152 §B). It fences the pre-0157
    -- residue — a `held` row written before the witness column existed — and any future writer that
    -- parks `held` without stamping one. Same refusal, so the caller sees one story.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id and m.push_state = 'held') then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- Refuse if ANY non-terminal outbox row exists for this sheet — the after-commit-before-mirror
    -- seam (a `committed` row whose mirror finalize has not run — Luna f1) AND a bare `pending` (a
    -- queued push still claimable/POSTable while this re-open commits — Luna f2).
    --
    -- ⚑ WHAT TERMINAL `failed` DOES AND DOES NOT PROVE (CORRECTED IN ROUND 8; the 0152 text this
    -- replaces was false). `failed` on the OUTBOX means only "no retry is queued". It does NOT mean
    -- "ERP holds no document":
    --   • an operator `release_outbox_hold` writes `failed` over a POST-SUBMIT UNKNOWN (0152 §A) —
    --     that is the round-8 BLOCK, and it is why the predicate above no longer reads push state at all;
    --   • `commitCreate` creates then submits (`erpnext/adapter.ts`), so a create that succeeded and a
    --     submit ERP rejected is terminal `failed` while ERPNext holds a DRAFT Timesheet PMO has no
    --     pointer to (no costing, so clutter rather than a double-count — but not "no document");
    --   • a row written by the PRE-0151 code carries no guarantee at all: a succeeded submit whose
    --     read-back failed was marked terminal `failed` with a `ts_number`-less mirror.
    -- So this arm no longer LEANS on `failed`; it admits `failed` only once the independent
    -- unknown-outcome witness above says the ERP question has actually been answered. THE PRE-0151
    -- DISPOSITION IS UNCHANGED AND STILL EXPLICIT: those rows carry no witness (the column did not
    -- exist), this arm will ADMIT them, and an OPERATOR must establish what ERP holds before trusting
    -- that admit. The census + the operator's action are named in
    -- `docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9 ("Pre-0151 residue"); an environment that
    -- never ran the P3b push before 0151 has an empty census and nothing to do.
    if exists (select 1 from public.external_command_outbox o
                 where o.org_id = v_org and o.domain = 'timesheets'
                   and o.pmo_record_id = p_timesheet_id::text
                   and o.state in ('pending','committing','committed','quarantined','held')) then
      raise exception 'reopen-push-in-flight' using errcode = 'P0001';
    end if;
    -- ⛔ SLICE B SEAM: the cancel-confirmed ADMIT branch (FR-TSC-008 full) lands HERE — when a
    -- generation-specific correction intent is consumed + its cancel outbox confirmed + mirror
    -- tombstoned, a PUSHED sheet may flip. Slice A admits ONLY the un-pushed case (no live doc, no
    -- unknown outcome, no non-terminal outbox row); a pushed sheet is refused above (Slice B's entry
    -- point). Do NOT widen without the intent table + cancel machinery.
  elsif p_to = 'Draft' and v_from = 'Rejected' then
    -- Rework: only the owner reworks a Rejected sheet back to Draft (FR-TS-006). Byte-for-byte with
    -- 0007 (the arm is narrowed by `v_from`, not widened in authority).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;

  -- Atomic single update: status + the relevant stamp(s) in the SAME statement ⇒ no observable partial
  -- state (NFR-TS-ATOM-001). Approved→Draft leaves submitted_at/approved_by/approved_at as-is (OD-TS-4-A:
  -- audit trail of the last cycle; overwritten on the next submit/approve). Unchanged from 0007.
  update public.timesheets set
    status       = p_to,
    submitted_at = case when p_to = 'Submitted'            then now()  else submitted_at end,
    approved_by  = case when p_to in ('Approved','Rejected') then v_uid else approved_by  end,
    approved_at  = case when p_to in ('Approved','Rejected') then now() else approved_at  end,
    rejection_reason = case when p_to = 'Rejected' then nullif(btrim(p_notes), '') when p_to = 'Submitted' and v_from = 'Draft' then null else rejection_reason end,
    rejected_by = case when p_to = 'Rejected' then v_uid when p_to = 'Submitted' and v_from = 'Draft' then null else rejected_by end,
    rejected_at = case when p_to = 'Rejected' then now() when p_to = 'Submitted' and v_from = 'Draft' then null else rejected_at end
  where id = p_timesheet_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.update_procurement_header(p_id uuid, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_case public.procurements%rowtype;
  v_project uuid;
  v_vendor uuid;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) as k where k not in ('title','project_id','vendor_id','budget_category'))
     or (p_patch ? 'title' and jsonb_typeof(p_patch->'title') <> 'string')
     or exists (select 1 from jsonb_each(p_patch) as e where e.key in ('project_id','vendor_id','budget_category') and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'Invalid procurement header fields' using errcode = '22023';
  end if;
  if v_uid is null or v_org is null or not public.is_active_member()
     or not public.org_feature_enabled(v_org, 'procurement') then
    raise exception 'Procurement header edit is not permitted' using errcode = '42501';
  end if;
  select * into v_case from public.procurements where id=p_id and org_id=v_org for update;
  if not found or v_case.status not in ('Draft','Rejected')
     or (v_case.requested_by_id is distinct from v_uid and public.auth_role() is distinct from 'Admin') then
    raise exception 'Procurement header edit is not permitted' using errcode = '42501';
  end if;
  if p_patch ? 'project_id' then
    v_project := (p_patch->>'project_id')::uuid;
    if v_project is not null and not exists (select 1 from public.projects where id=v_project and org_id=v_org) then
      raise exception 'Project is not available' using errcode = '42501';
    end if;
  end if;
  if p_patch ? 'vendor_id' then
    v_vendor := (p_patch->>'vendor_id')::uuid;
    if v_vendor is not null and not exists (select 1 from public.companies where id=v_vendor and org_id=v_org) then
      raise exception 'Supplier is not available' using errcode = '42501';
    end if;
  end if;
  update public.procurements set
    title = case when p_patch ? 'title' then p_patch->>'title' else title end,
    project_id = case when p_patch ? 'project_id' then v_project else project_id end,
    vendor_id = case when p_patch ? 'vendor_id' then v_vendor else vendor_id end,
    budget_category = case when p_patch ? 'budget_category' then (p_patch->>'budget_category')::public.budget_category else budget_category end
  where id = v_case.id and org_id = v_org;
  return true;
end $function$
;

