-- Preserve all captured payment history before removing its supporting guards.
do $$
begin
  if exists(select 1 from public.external_command_outbox o where o.domain='procurement' and o.operation='create'
    and o.payload->>'erp_doc_kind'='payment' and o.payload ? 'capturedInvoiceDocumentId')
    or exists(select 1 from public.payments pay join public.erp_purchase_captures c
      on c.procurement_id=pay.procurement_id and c.org_id=pay.org_id and c.kind='supplier_invoice') then
    raise exception 'captured_payment_history_exists' using errcode='55000';
  end if;
end $$;
drop trigger zz_captured_invoice_advance on public.erp_purchase_captures;
drop function public.advance_captured_invoice_on_capture();
drop function public.try_advance_captured_invoice(uuid,uuid);
create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare v_reason text;                                                                                   -- 0368
begin
  if tg_op = 'UPDATE' and not public.actor_bypasses_rls()
     and (new.approved_total_value is distinct from old.approved_total_value
          or new.amount_approved_by_id is distinct from old.amount_approved_by_id) then
    raise exception 'Approved amount is server managed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'Requested' and new.status = 'Approved' then
    -- The actor whose quote selection returned the request for approval may not approve it.
    -- Enforced here (not in an RPC branch) so no path and no role, Admin included, skips it.
    if auth.uid() is not null and auth.uid() = (
      select e.actor_id from public.procurement_status_events e
       where e.procurement_id = old.id and e.from_status = 'Vendor Quoted'::procurement_status
         and e.to_status = 'Requested'::procurement_status
       order by e.created_at desc, e.id desc limit 1
    ) then
      raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
    end if;
    new.approved_total_value := public.procurement_request_amount(new.id);
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
        and new.total_value > old.approved_total_value then
    -- The selected quote is retained, but the old decision is invalid. The normal
    -- Requested -> Approved transition re-runs spend_approval_route on this amount.
    new.status := 'Requested';
    new.approved_by_id := null;
    new.approved_total_value := null;
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and new.status = 'Paid' and old.status is distinct from 'Paid' then
    -- 0362 FR-PFE-016: approver ≠ payer on EVERY path to Paid (transition, a Paid payment, a linked Payment Entry).
    if auth.uid() is not null and public.procurement_amount_approver(old.id, auth.uid()) then                -- 0474
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
    -- 0368: the payment rule (§1) — closed, awaiting approval, or 0362 FR-PFE-017's "never entered approval and
    -- approval_before_payment OFF" when no approved amount is recorded. This is a BEFORE trigger, so §1 reads the
    -- row as it stands before this update (the old values).
    v_reason := public.procurement_payment_allowed(old.id);                                              -- 0368
    if v_reason is not null then                                                                         -- 0368
      raise exception '%', case v_reason                                                                 -- 0368
          when 'awaiting_approval' then public.procurement_gate_message('awaiting_approval')            -- 0368
          when 'purchase_closed' then 'This purchase is closed.'                                         -- 0368
          when 'subcontract_cap_exception' then case                                                      -- 0475 one remedy per cause
            when exists (select 1 from public.subcontract_cap_exceptions(old.id) x where x.reason = 'no_lines')
              then 'A subcontract bill is not attributed to BoQ lines; attribute its lines or have it cancelled in the ERP before payment.'
            else 'A linked ERP Purchase Invoice cannot be attributed to BoQ lines; cancel or unlink it in the ERP before payment.' end
          else 'Cannot pay without a recorded approved amount.' end                                      -- 0368
        using errcode = '23514', detail = v_reason;                                                      -- 0368
    elsif old.approved_total_value is not null                                                          -- 0368
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create or replace function public.capture_history_apply_internal(
  p_actor_id uuid, p_project_id uuid, p_request_id uuid, p_revision text,
  p_source_ids jsonb, p_precision jsonb, p_dry_run boolean, p_skip_revision boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid; v_binding public.external_org_bindings%rowtype; v_binding_count integer;
  v_claims text := current_setting('request.jwt.claims', true);
  v_existing public.erp_purchase_captures%rowtype;
  v_ids uuid[]; v_count integer; v_doc jsonb; v_evidence jsonb;
  v_supplier text; v_currency text; v_order text; v_vendor uuid; v_vendor_count integer;
  v_kind text; v_stage text := 'ordered'; v_rows jsonb := '[]'::jsonb;
  v_result jsonb; v_reason text; v_purchase uuid; v_payload jsonb;
  v_has_invoice boolean := false; v_scale integer;
  v_link_count integer; v_purchase_count integer; v_linked uuid; v_holds jsonb; v_attach boolean := false;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode = '42501'; end if;
  select p.org_id into v_org from public.profiles p join auth.users u on u.id = p.id
   where p.id = p_actor_id and p.role::text = 'Admin' and p.status = 'active'
     and (u.banned_until is null or u.banned_until <= now());
  if v_org is null then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('capture-fence:' || v_org::text,0));
  perform 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=p_actor_id and p.org_id=v_org and p.status='active' and p.role::text='Admin'
     and (u.banned_until is null or u.banned_until <= now()) for share of p,u;
  if not found then raise exception 'not authorized' using errcode='42501'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  if p_project_id is null or p_request_id is null or nullif(btrim(p_revision),'') is null
     or jsonb_typeof(p_source_ids) <> 'array' or jsonb_array_length(p_source_ids) not between 1 and 500
     or jsonb_typeof(p_precision) <> 'object' then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id and org_id = v_org) then
    return jsonb_build_object('outcome','refused','reason','project_not_found','erp_write',false);
  end if;
  select count(*), (array_agg(id))[1] into v_binding_count, v_binding.id from public.external_org_bindings
   where org_id = v_org and status = 'active' and activated_at is not null;
  if v_binding_count <> 1 then return jsonb_build_object('outcome','refused','reason','binding_unavailable','erp_write',false); end if;
  select * into v_binding from public.external_org_bindings where id = v_binding.id and org_id = v_org;
  v_evidence := public.capture_source_evidence(v_org,v_binding.id,null);
  if not (v_evidence->>'supported')::boolean then return jsonb_build_object('outcome','refused','reason','unsupported_adapter','erp_write',false); end if;
  if not (v_evidence->>'company_known')::boolean or not ((v_evidence->'mapped_projects') ? p_project_id::text) then return jsonb_build_object('outcome','refused','reason','binding_evidence_missing','erp_write',false); end if;
  begin
    select array_agg(value::uuid order by value::uuid), count(*) into v_ids, v_count from jsonb_array_elements_text(p_source_ids);
  exception when invalid_text_representation then return jsonb_build_object('outcome','refused','reason','invalid_source','erp_write',false);
  end;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    return jsonb_build_object('outcome','refused','reason','duplicate_source','erp_write',false);
  end if;
  v_payload := jsonb_build_object('project_id',p_project_id,'source_ids',to_jsonb(v_ids),'revision',p_revision);
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || p_request_id::text, 0));
  select * into v_existing from public.erp_purchase_captures where org_id = v_org and request_id = p_request_id;
  if found then
    if v_existing.payload is distinct from v_payload then return jsonb_build_object('outcome','refused','reason','request_conflict','erp_write',false); end if;
    if v_existing.undone_at is not null then return jsonb_build_object('outcome','refused','reason','undone','erp_write',false); end if;
    return jsonb_build_object('outcome','skip','procurement_id',v_existing.procurement_id,'erp_write',false);
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_actor_id,'role','authenticated')::text, true);
  if not p_skip_revision and public.purchase_capture_source_page(null,null,1)->>'revision' is distinct from p_revision then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','source_stale','erp_write',false);
  end if;
  if coalesce((public.purchase_capture_feed_health()->>'caught_up')::boolean,false) is not true then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','feed_not_current','erp_write',false);
  end if;
  if nullif(public.purchase_capture_feed_health()->>'ledger_currency','') is null then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','ledger_currency_unknown','erp_write',false);
  end if;
  perform 1 from public.erp_purchase_documents where org_id = v_org and id = any(v_ids) order by id for update;
  select count(*) into v_count from public.erp_purchase_documents where org_id = v_org and id = any(v_ids);
  if v_count <> cardinality(v_ids) then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason','source_not_found','erp_write',false);
  end if;
  v_evidence := public.capture_source_evidence(v_org,v_binding.id,v_ids);
  for v_doc in select value from jsonb_array_elements(v_evidence->'documents') loop
    v_kind := v_doc->>'kind';
    if (v_kind is null or v_kind not in ('order','supplier_invoice')) or not coalesce((v_doc->>'eligible')::boolean,false)
       or jsonb_array_length(v_doc->'project_ids') <> 1 or v_doc->'project_ids'->>0 <> p_project_id::text then
      v_reason := 'source_not_eligible'; exit;
    end if;
    if v_doc->>'state' is null then v_reason := 'state_unknown'; exit; end if;
    if jsonb_typeof(p_precision->v_kind) = 'number' and coalesce(p_precision->>v_kind,'') ~ '^([3-9]|[1-9][0-9]+)$' then
      v_reason := 'source_precision_exceeds_mirror'; exit;
    end if;
    if jsonb_typeof(p_precision->v_kind) is distinct from 'number' or coalesce(p_precision->>v_kind,'') !~ '^[0-2]$' then
      v_reason := 'source_precision_unknown'; exit;
    end if;
    v_scale := (p_precision->>v_kind)::integer;
    if trunc((v_doc->>'net_total')::numeric,v_scale) <> (v_doc->>'net_total')::numeric then v_reason := 'source_precision_mismatch'; exit; end if;
    if v_supplier is null then v_supplier := v_doc->>'supplier_reference'; elsif v_supplier <> v_doc->>'supplier_reference' then v_reason := 'supplier_mismatch'; exit; end if;
    if v_currency is null then v_currency := v_doc->>'currency'; elsif v_currency <> v_doc->>'currency' then v_reason := 'currency_mismatch'; exit; end if;
    if v_kind = 'order' then
      if v_order is not null and v_order <> v_doc->>'family_reference' then v_reason := 'family_ambiguous'; exit; end if;
      v_order := v_doc->>'family_reference';
    else
      v_has_invoice := true; v_stage := v_doc->>'state';
      if (v_doc->>'classification_unknown')::boolean then v_reason := 'account_classification_unknown'; exit; end if;
      if not (v_doc->>'mapped_cost_present')::boolean then v_reason := 'invoice_has_no_mapped_cost'; exit; end if;
    end if;
    v_rows := v_rows || jsonb_build_array((v_doc->'linker_source') || jsonb_build_object('project_id',p_project_id,'group',p_request_id::text));
  end loop;
  if v_reason is null then
    v_vendor_count := (v_evidence->'documents'->0->>'vendor_count')::integer;
    v_vendor := (v_evidence->'documents'->0->>'vendor_id')::uuid;
    if v_vendor_count <> 1 then v_reason := 'supplier_unknown'; end if;
  end if;
  if v_reason is null and v_has_invoice and v_order is not null and exists (
      select 1 from jsonb_array_elements(v_evidence->'documents') d where d->>'kind'='supplier_invoice'
       and (jsonb_array_length(d->'family_references') <> 1 or d->'family_references'->>0 <> v_order)) then
    v_reason := 'family_ambiguous';
  end if;
  if v_reason is null and exists (select 1 from jsonb_array_elements(v_evidence->'documents') d where (d->>'family_incomplete')::boolean) then v_reason := 'family_incomplete'; end if;
  if v_reason is null then
    select count(*), count(distinct l.procurement_id), (array_agg(l.procurement_id))[1]
      into v_link_count, v_purchase_count, v_linked
      from public.procurement_erp_links l where l.org_id = v_org and l.erp_purchase_document_id = any(v_ids);
    if v_link_count > 0 then
      if v_purchase_count <> 1 or not exists (select 1 from public.procurements p
          where p.id = v_linked and p.org_id = v_org and p.project_id = p_project_id
            and p.vendor_id = v_vendor and p.currency = v_currency and p.status::text not in ('Cancelled','Rejected')) then
        v_reason := 'family_conflict';
      elsif v_link_count <> cardinality(v_ids) then
        if exists (select 1 from public.procurements p where p.id=v_linked and p.org_id=v_org and p.record_only)
          and exists (select 1 from public.erp_purchase_captures c where c.org_id=v_org and c.procurement_id=v_linked
            and c.undone_at is null and c.kind in ('order','supplier_invoice'))
          and not exists (select 1 from public.erp_purchase_captures c where c.org_id=v_org and c.procurement_id=v_linked and c.kind='journal') then
          v_attach := true;
        else v_reason := 'ordinary_purchase_requires_decision'; end if;
      else
        perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
        return jsonb_build_object('outcome','matched','procurement_id',v_linked,'erp_write',false);
      end if;
    end if;
  end if;
  if v_reason is null then
    v_holds := v_evidence->'documents'->0->'holds';
    if jsonb_array_length(v_holds)>0 then
      perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
      return jsonb_build_object('outcome','refused','reason','needs_undo','needs_undo',v_holds,'erp_write',false);
    end if;
  end if;
  if v_reason is not null then
    perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
    return jsonb_build_object('outcome','refused','reason',v_reason,'erp_write',false);
  end if;
  begin
    if v_attach then
      perform 1 from public.procurements where id=v_linked and org_id=v_org for update;
      update public.procurements set record_only=false where id=v_linked and org_id=v_org;
      select coalesce(jsonb_agg((d->'linker_source') || jsonb_build_object('project_id',p_project_id,'group',p_request_id::text,'procurement_id',v_linked)),'[]'::jsonb)
        into v_rows from jsonb_array_elements(v_evidence->'documents') d
        where not exists(select 1 from public.procurement_erp_links l where l.org_id=v_org and l.erp_purchase_document_id=(d->>'id')::uuid);
    end if;
    v_result := public.link_erp_purchase_documents(v_rows,false);
    if coalesce((v_result#>>'{counts,refused}')::integer,0) > 0 or coalesce((v_result#>>'{counts,skip}')::integer,0) > 0 then
      v_reason := coalesce(v_result#>>'{results,0,reason}','family_requires_decision');
      raise exception 'family_refused' using errcode = 'PFE02';
    end if;
    v_purchase := (v_result#>>'{results,0,procurement_id}')::uuid;
    update public.procurements set record_only = true, record_only_stage = v_stage,
      record_only_reference = v_order where id = v_purchase and org_id = v_org;
    insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
      values(v_org,v_binding.id,p_request_id,v_purchase,v_payload,case when v_has_invoice then 'supplier_invoice' else 'order' end,v_stage,p_actor_id);
    perform public.log_audit('procurement.record_only_create',v_org,p_actor_id,v_purchase,
      jsonb_build_object('project_id',p_project_id,'source_ids',to_jsonb(v_ids),'assignment_origin',v_evidence->>'assignment_origin'));
    if p_dry_run then raise exception 'preview rollback' using errcode = 'PFE01'; end if;
  exception
    when sqlstate 'PFE01' then v_purchase := null;
    when sqlstate 'PFE02' then
      perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
      return jsonb_build_object('outcome','refused','reason',v_reason,'erp_write',false);
  end;
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  return jsonb_build_object('outcome','create','procurement_id',v_purchase,'dry_run',p_dry_run,'erp_write',false);
end $$;

drop trigger zz_captured_invoice_advance on public.external_command_outbox;
drop trigger zz_captured_invoice_advance on public.erp_purchase_documents;
drop function public.advance_captured_invoice_on_outbox();
drop function public.advance_captured_invoice_on_mirror();
create or replace function public.procurement_evidenced_step(p_procurement_id uuid) returns public.procurement_status
language sql stable security definer set search_path = public, pg_catalog as $$
  with linked as (
    select d.erp_doctype from public.procurement_erp_links l
      join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.procurement_id = p_procurement_id and d.erp_docstatus = 1)
  select case
    when exists (select 1 from public.payments pay where pay.procurement_id = p_procurement_id and pay.status = 'Paid'
                   and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null)
      or exists (select 1 from linked where erp_doctype = 'Payment Entry') then 'Paid'::public.procurement_status
    when exists (select 1 from public.procurement_invoices i where i.procurement_id = p_procurement_id
                   and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null)
      or exists (select 1 from linked where erp_doctype = 'Purchase Invoice') then 'Vendor Invoiced'::public.procurement_status
    when exists (select 1 from public.procurement_receipts r where r.procurement_id = p_procurement_id)
      or exists (select 1 from linked where erp_doctype = 'Purchase Receipt') then 'Received'::public.procurement_status
    when exists (select 1 from public.purchase_orders po where po.procurement_id = p_procurement_id)
      or exists (select 1 from linked where erp_doctype = 'Purchase Order') then 'Ordered'::public.procurement_status
    else null end
$$;
create or replace function public.undo_captured_journal_purchase(p_procurement_id uuid, p_reason text, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_proc public.procurements%rowtype; v_history jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role()::text is distinct from 'Admin' then raise exception 'not authorized' using errcode = '42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into v_proc from public.procurements where id=p_procurement_id and org_id=v_org for update;
  if not found or not v_proc.record_only then raise exception 'purchase_not_found' using errcode = 'P0002'; end if;
  select payload into v_history from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id;
  if not found then raise exception 'purchase_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.erp_purchase_captures where procurement_id=p_procurement_id and kind='journal') then raise exception 'unsupported_capture_kind' using errcode='22023'; end if;
  if v_proc.status = 'Cancelled' then return jsonb_build_object('outcome','skip','reason','already_undone'); end if;
  if not p_dry_run then
    delete from public.erp_journal_line_links where org_id=v_org and procurement_id=p_procurement_id;
    update public.procurements set status='Cancelled', updated_at=now() where id=p_procurement_id;
    update public.erp_purchase_captures set undone_at=now(), undo_reason=p_reason where procurement_id=p_procurement_id;
    perform public.log_audit('procurement.record_only_undo',v_org,auth.uid(),p_procurement_id,
      jsonb_build_object('project_id',v_proc.project_id,'vendor_id',v_proc.vendor_id,'sources',v_history->'journal_lines','reason',p_reason,
                         'assignment_origin','erp_project','before_project',v_proc.project_id,'after_project',v_proc.project_id,'actuals_delta',0));
  end if;
  return jsonb_build_object('outcome','undo','dry_run',p_dry_run,'procurement_id',p_procurement_id,'erp_write',false);
end $$;

create or replace function public.undo_captured_purchase(p_procurement_id uuid,p_reason text,p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_kind text; v_proc public.procurements%rowtype; v_history jsonb;
begin
  select kind into v_kind from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id;
  if v_kind is null or v_kind='journal' then
    return public.undo_captured_journal_purchase(p_procurement_id,p_reason,p_dry_run);
  end if;
  perform public.assert_is_active_member();
  if public.auth_role()::text is distinct from 'Admin' then raise exception 'not authorized' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'reason_required' using errcode='22023'; end if;
  select * into v_proc from public.procurements where id=p_procurement_id and org_id=v_org for update;
  if not found or not v_proc.record_only or v_kind not in ('order','supplier_invoice') then raise exception 'purchase_not_found' using errcode='P0002'; end if;
  perform 1 from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id for update;
  select coalesce(jsonb_agg(distinct s.value order by s.value),'[]'::jsonb) into v_history
    from public.erp_purchase_captures c cross join lateral jsonb_array_elements(c.payload->'source_ids') s(value)
    where c.org_id=v_org and c.procurement_id=p_procurement_id;
  if v_proc.status='Cancelled' then return jsonb_build_object('outcome','skip','reason','already_undone'); end if;
  if exists(select 1 from public.purchase_requests where procurement_id=p_procurement_id)
    or exists(select 1 from public.rfqs where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_quotations where procurement_id=p_procurement_id)
    or exists(select 1 from public.purchase_orders where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_receipts where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_invoices where procurement_id=p_procurement_id)
    or exists(select 1 from public.payments where procurement_id=p_procurement_id) then
    raise exception 'has_later_pmo_steps' using errcode='55000';
  end if;
  if not p_dry_run then
    update public.procurement_documents set record_kind=null,record_id=null
      where procurement_id=p_procurement_id and record_kind='erp_document';
    delete from public.procurement_erp_links where org_id=v_org and procurement_id=p_procurement_id;
    update public.procurements set status='Cancelled',updated_at=now() where id=p_procurement_id;
    update public.erp_purchase_captures set undone_at=now(),undo_reason=p_reason where org_id=v_org and procurement_id=p_procurement_id;
    perform public.log_audit('procurement.record_only_undo',v_org,auth.uid(),p_procurement_id,
      jsonb_build_object('project_id',v_proc.project_id,'vendor_id',v_proc.vendor_id,'sources',v_history,
        'reason',p_reason,'assignment_origin','erp_project','actuals_delta',0));
  end if;
  return jsonb_build_object('outcome','undo','dry_run',p_dry_run,'procurement_id',p_procurement_id,'erp_write',false);
end $$;

drop trigger external_command_outbox_zz_linked_claim on public.external_command_outbox;
drop function public.guard_linked_procurement_claim();

create or replace function public.guard_record_only_status() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.status is distinct from old.status and public.record_only_step_refusal(old.id) is not null
     and not (new.status = 'Cancelled' and not exists (
       select 1 from public.erp_journal_line_links where procurement_id = old.id)) then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_record_only_child() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if public.record_only_step_refusal(new.procurement_id) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_record_only_source() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if public.record_only_step_refusal(old.id) is not null and
    (new.total_value is distinct from old.total_value or new.project_id is distinct from old.project_id
      or new.vendor_id is distinct from old.vendor_id or new.currency is distinct from old.currency
      or new.origin is distinct from old.origin
      or new.record_only_stage is distinct from old.record_only_stage or new.record_only_date is distinct from old.record_only_date
      or new.record_only_reference is distinct from old.record_only_reference) then
    raise exception 'record_only_source_locked' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.procurement_create_refusal(
  p_org_id uuid, p_procurement_id uuid, p_erp_doc_kind text, p_actor_user_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_step public.procurement_status;
  v_proc public.procurements;
  v_refusal text;
  v_linked_state text;
begin
  v_step := case p_erp_doc_kind
    when 'purchase-order'   then 'Ordered'::public.procurement_status
    when 'goods-receipt'    then 'Received'::public.procurement_status
    when 'purchase-invoice' then 'Vendor Invoiced'::public.procurement_status
    when 'payment'          then 'Paid'::public.procurement_status
  end;
  -- The foreground gate asks nothing of other kinds; neither does this.
  if v_step is null then return null; end if;
  if p_procurement_id is not null then
    select * into v_proc from public.procurements
     where id = p_procurement_id and org_id = p_org_id for update;
  end if;
  if v_proc.id is null then return 'purchase_not_found'; end if;
  v_refusal := public.record_only_step_refusal(v_proc.id);
  if v_refusal is not null then return v_refusal; end if;
  if p_erp_doc_kind in ('goods-receipt','purchase-invoice') then
    v_linked_state := public.linked_step_state(p_org_id, p_procurement_id, p_erp_doc_kind);
    if v_linked_state like 'already_in_erp_unlinked:%' then
      return 'ERP ' || substr(v_linked_state, 25) || ' already records this; link it instead of sending a new one.';
    elsif v_linked_state = 'already_in_erp' then
      return 'step_already_recorded';
    end if;
  end if;
  if p_erp_doc_kind = 'purchase-invoice' and v_proc.is_subcontract                                       -- 0475
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = v_proc.id) then -- 0475
    return 'subcontract_bill_lines_required';  -- PQ-9: #1505 replaces this with the cap over the payload  -- 0475
  end if;                                                                                                 -- 0475
  -- A payment: 0368's payment rule first (closed / awaiting approval / approval missing), then the order-step rules.
  if p_erp_doc_kind = 'payment' then
    v_refusal := public.procurement_payment_allowed(v_proc.id);
  end if;
  if v_refusal is null then
    v_refusal := public.procurement_gate_violation(v_proc.id, v_step);
  end if;
  if v_refusal is null and p_erp_doc_kind = 'payment' then
    if p_actor_user_id is null then
      v_refusal := 'actor_missing';
    elsif public.procurement_amount_approver(v_proc.id, p_actor_user_id) then                                 -- 0474
      v_refusal := 'separation_of_duties';
    elsif (v_proc.approved_by_id is not null or v_proc.approved_total_value is not null)
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(v_proc.id) c), false) then
      v_refusal := 'exceeds_approved_amount';
    end if;
  end if;
  return v_refusal;
end $$;

create or replace function public.insert_procurement_outbox_pending(
  p_org uuid, p_record_id text, p_key text, p_tier text, p_operation text,
  p_payload jsonb, p_digest text, p_actor uuid, p_case uuid, p_snapshot jsonb
) returns public.external_command_outbox
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.external_command_outbox; v_mismatch boolean; v_input_digest text;
begin

  if exists (select 1 from public.procurements where id=p_case and org_id=p_org)
     and public.record_only_step_refusal(p_case) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;
  perform public.assert_feature_on(p_org, 'procurement');
  if p_tier is distinct from 'erpnext' or p_operation is distinct from 'create'
     or public.procurement_case_uuid(p_payload->>'procurementId') is distinct from p_case
     or not coalesce(p_payload->>'erp_doc_kind' in ('purchase-order', 'goods-receipt', 'purchase-invoice'), false)
     or jsonb_typeof(p_snapshot) is distinct from 'array' then
    raise exception 'invalid procurement snapshot' using errcode = '22023';
  end if;
  if p_payload->>'erp_doc_kind' = 'goods-receipt' then
    v_input_digest := p_payload->'pmo_gr_snapshot'->>'raw_digest';
    if v_input_digest is null or v_input_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid receipt witness' using errcode = '22023';
    end if;
  end if;
  insert into public.external_command_outbox
    (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, payload_digest, actor_user_id, procurement_input_digest)
  values (p_org, 'procurement', p_record_id, p_key, p_tier, p_operation, 'pending', p_payload, p_digest, p_actor, v_input_digest)
  returning * into v_row;
  perform 1 from public.procurements where id = p_case and org_id = p_org for update;
  if not found then raise exception 'procurement case not found' using errcode = '42501'; end if;
  with current_lines as (
    select name, description, quantity::numeric as quantity, rate::numeric as rate
      from public.procurement_items where org_id = p_org and procurement_id = p_case
  ), snapshot_lines as (
    select x.name, x.description, x.quantity, x.rate
      from jsonb_to_recordset(p_snapshot) as x(name text, description text, quantity numeric, rate numeric)
  )
  select exists (
    (select * from current_lines except all select * from snapshot_lines)
    union all
    (select * from snapshot_lines except all select * from current_lines)
  ) into v_mismatch;
  if v_mismatch then raise exception 'procurement line snapshot changed' using errcode = '40001'; end if;
  return v_row;
end $$;

create or replace function public.po_revision_push_refusal(p_org uuid, p_po_id uuid, p_revision integer, p_revise_cancels boolean)
  returns text language plpgsql stable security definer set search_path = public as $$
declare v_proc uuid;
begin
  select o.procurement_id into v_proc from public.purchase_orders o where o.id = p_po_id and o.org_id = p_org;
  if v_proc is null then return 'po_not_found'; end if;
  if public.record_only_step_refusal(v_proc) is not null then return 'record_only_forward_step_refused'; end if;
  if p_revision is null or not exists (select 1 from public.purchase_order_revisions r
                                        where r.po_id = p_po_id and r.revision = p_revision and r.status = 'Issued') then
    return 'revision_not_issued';
  end if;
  if p_revision is distinct from public.po_effective_revision(p_po_id) then return 'revision_superseded'; end if;
  if coalesce(p_revise_cancels, true) and (
       exists (select 1 from public.procurement_invoices i
                where i.procurement_id = v_proc and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at))
       or exists (select 1 from public.procurement_erp_links k
                    join public.erp_purchase_documents d on d.id = k.erp_purchase_document_id
                   where k.procurement_id = v_proc and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1 and not d.pmo_owned)) then
    return 'po_has_submitted_bill';
  end if;
  return null;
end $$;

create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
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
    if v_project is not null and v_category is not null then
      perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
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
end; $$;

create or replace function public.guard_linked_procurement_step() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_case uuid; v_state text;
begin
  if new.external_tier = 'erpnext' and new.domain = 'procurement' and new.operation = 'create'
     and new.payload->>'erp_doc_kind' in ('goods-receipt','purchase-invoice') then
    v_case := public.procurement_case_uuid(new.payload->>'procurementId');
    perform 1 from public.procurements where id = v_case and org_id = new.org_id for update;
    if not found then return new; end if;
    v_state := public.linked_step_state(new.org_id, v_case, new.payload->>'erp_doc_kind');
    if v_state like 'already_in_erp_unlinked:%' then
      raise exception 'ERP % already records this; link it instead of sending a new one.', substr(v_state, 25) using errcode = 'P0001';
    end if;
    if v_state = 'already_in_erp' then
      raise exception 'step_already_recorded' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function public.linked_step_state(p_org_id uuid, p_procurement_id uuid, p_step text)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_doctype text; v_name text;
begin
  if not exists (select 1 from public.procurements where id = p_procurement_id and org_id = p_org_id) then
    raise exception 'purchase not found' using errcode = '42501';
  end if;
  v_doctype := case p_step when 'goods-receipt' then 'Purchase Receipt' when 'purchase-invoice' then 'Purchase Invoice' else null end;
  if v_doctype is null then return 'not_applicable'; end if;
  if exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents d
      on d.id = l.erp_purchase_document_id and d.org_id = l.org_id
      where l.org_id = p_org_id and l.procurement_id = p_procurement_id and d.erp_doctype = v_doctype) then
    return 'already_in_erp';
  end if;
  select d.erp_name into v_name from public.erp_purchase_documents d
    where d.org_id = p_org_id and d.erp_doctype = v_doctype and d.erp_docstatus = 1 and not d.is_return
      and exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents po
        on po.id = l.erp_purchase_document_id and po.org_id = l.org_id
        where l.org_id = p_org_id and l.procurement_id = p_procurement_id
          and po.erp_doctype = 'Purchase Order' and po.erp_name = any(d.purchase_orders))
      and not exists (select 1 from public.procurement_erp_links l where l.org_id = p_org_id and l.erp_purchase_document_id = d.id)
      and not public.erp_document_recorded_by_pmo(p_org_id, d.erp_doctype, d.erp_name)
    order by d.erp_name limit 1;
  if v_name is not null then return 'already_in_erp_unlinked:' || v_name; end if;
  if exists (select 1 from public.procurement_erp_links l where l.org_id = p_org_id and l.procurement_id = p_procurement_id) then
    return 'new_step';
  end if;
  return 'not_applicable';
end $$;

drop function public.record_only_step_refusal(uuid,text,uuid);

drop function public.captured_invoice_fully_settled(uuid);
drop function public.invoice_settlement_evidence(uuid);
