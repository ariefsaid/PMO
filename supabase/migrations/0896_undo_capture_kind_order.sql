-- #2259 Undo reads the capture kind in a defined order. A purchase can hold more than one capture row (a later document attaches to an
-- already captured purchase), so the kind is that of the first capture: earliest captured_at, then the smaller request_id.
-- Body of 0882 unchanged except the line marked 0896. Grants are kept by create or replace.
create or replace function public.undo_captured_purchase(p_procurement_id uuid,p_reason text,p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_kind text; v_proc public.procurements%rowtype; v_history jsonb;
  v_asg public.erp_capture_invoice_assignments%rowtype; v_mark public.erp_purchase_document_marks%rowtype; v_has_mark boolean; v_restored boolean := false; v_before jsonb;
begin
  select kind into v_kind from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id order by captured_at, request_id limit 1;  -- 0896
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
  if exists(select 1 from public.external_command_outbox o where o.org_id=v_org and o.domain='procurement' and o.operation='create'
    and o.payload->>'erp_doc_kind'='payment' and public.procurement_case_uuid(o.payload->>'procurementId')=p_procurement_id
    and o.payload ? 'capturedInvoiceDocumentId'
    and (o.state in ('pending','committing','committed','quarantined','held')
         or (o.state='failed' and o.attempt_count<public.outbox_max_auto_attempts()))) then
    raise exception 'has_later_pmo_steps' using errcode='55000';
  end if;
  if exists(select 1 from public.purchase_requests where procurement_id=p_procurement_id)
    or exists(select 1 from public.rfqs where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_quotations where procurement_id=p_procurement_id)
    or exists(select 1 from public.purchase_orders where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_receipts where procurement_id=p_procurement_id)
    or exists(select 1 from public.procurement_invoices where procurement_id=p_procurement_id)
    or exists(select 1 from public.payments where procurement_id=p_procurement_id) then
    raise exception 'has_later_pmo_steps' using errcode='55000';
  end if;
  select * into v_asg from public.erp_capture_invoice_assignments
   where org_id=v_org and procurement_id=p_procurement_id and decision='project' and undone_at is null for update;
  if found then
    select * into v_mark from public.erp_purchase_document_marks where erp_purchase_document_id=v_asg.source_document_id for update;
    v_has_mark := found;
    -- What the placement left behind: no mark if there was none (or it held only the set-aside), else the prior note with the set-aside cleared.
    if v_has_mark is distinct from (v_asg.prior_mark_present and not (v_asg.prior_mark_set_aside_at is not null and v_asg.prior_mark_note is null))
       or (v_has_mark and (v_mark.set_aside_at is not null or v_mark.set_aside_by is not null or v_mark.note is distinct from v_asg.prior_mark_note)) then
      raise exception 'assignment_mark_changed' using errcode='55000';
    end if;
  end if;
  if not p_dry_run then
    if v_asg.id is not null then
      -- What the decision places now, read before it is deactivated; the placement it returns to is the one recorded when it was made.
      select jsonb_build_array(jsonb_build_object('project_id',v_asg.project_id,'amount',coalesce(sum(g.amount),0))) into v_before
        from public.capture_assigned_gl(v_org,v_asg.project_id) g join public.erp_gl_entry_mirror m on m.id = g.gl_id and m.org_id = v_org
       where m.voucher_type = v_asg.source_voucher_type and m.voucher_no = v_asg.source_voucher_no and m.company is not distinct from v_asg.source_company;
      if v_asg.prior_mark_present then
        insert into public.erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at,set_aside_by,note,updated_at,updated_by)
          values (v_asg.source_document_id,v_org,v_asg.prior_mark_set_aside_at,v_asg.prior_mark_set_aside_by,v_asg.prior_mark_note,v_asg.prior_mark_updated_at,v_asg.prior_mark_updated_by)
          on conflict (erp_purchase_document_id) do update set set_aside_at=excluded.set_aside_at,set_aside_by=excluded.set_aside_by,note=excluded.note,
            updated_at=excluded.updated_at,updated_by=excluded.updated_by;
        v_restored := true;
      end if;
      update public.erp_capture_invoice_assignments set undone_at=now(),undone_by=auth.uid(),undone_reason=p_reason where id=v_asg.id;
    end if;
    update public.procurement_documents set record_kind=null,record_id=null
      where procurement_id=p_procurement_id and record_kind='erp_document';
    delete from public.procurement_erp_links where org_id=v_org and procurement_id=p_procurement_id;
    update public.erp_purchase_captures set undone_at=now(),undo_reason=p_reason where org_id=v_org and procurement_id=p_procurement_id;
    update public.procurements set status='Cancelled',updated_at=now() where id=p_procurement_id;
    perform public.log_audit('procurement.record_only_undo',v_org,auth.uid(),p_procurement_id,
      jsonb_build_object('project_id',v_proc.project_id,'vendor_id',v_proc.vendor_id,'sources',v_history,
        'reason',p_reason,'assignment_origin',case when v_asg.id is not null then 'pmo_assignment' else 'erp_project' end)
      || case when v_asg.id is not null then jsonb_build_object('decision_id',v_asg.id,'mark_restored',v_restored,'placement_before',v_before,'placement_after',coalesce(v_asg.prior_placement,'[]'::jsonb))
              else jsonb_build_object('actuals_delta',0) end);
  end if;
  return jsonb_build_object('outcome','undo','dry_run',p_dry_run,'procurement_id',p_procurement_id,'erp_write',false);
end $$;
