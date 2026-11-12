-- Deploy the previous adapter-dispatch edge function before running this database rollback.
-- Retain evidence for all live and historical captures.
do $$ begin
  if exists (select 1 from public.erp_purchase_captures where source_evidence is not null or supplier_override_reason is not null) then
    raise exception 'capture_evidence_exists' using errcode='55000';
  end if;
end $$;

create or replace function public.create_record_only_journal_purchase(p_group jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id(); v_actor uuid := auth.uid();
  v_request uuid; v_project uuid; v_vendor uuid; v_purchase uuid; v_old jsonb;
  v_currency text; v_ledger_currency text; v_binding uuid; v_bindings integer; v_title text; v_reference text; v_line jsonb; v_source record;
  v_total numeric := 0; v_date date; v_sources jsonb := '[]'::jsonb; v_party uuid; v_key text; v_seen text[] := '{}'; v_facts record; v_group_party text;
begin
  perform public.assert_is_active_member();
  if public.auth_role()::text is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.assert_feature_on(v_org,'procurement');
  v_request := (p_group->>'request_id')::uuid;
  v_project := (p_group->>'project_id')::uuid;
  v_vendor := (p_group->>'vendor_id')::uuid;
  v_title := nullif(btrim(p_group->>'title'), '');
  v_reference := nullif(btrim(p_group->>'reference'), '');
  if v_request is null or v_project is null or v_vendor is null or v_title is null then
    raise exception 'required_field_missing' using errcode = '22023';
  end if;
  if p_group ? 'erp_documents' or (p_group ? 'source_kind' and p_group->>'source_kind' is distinct from 'journal') then
    raise exception 'unsupported_source_kind' using errcode='22023';
  end if;
  if jsonb_typeof(p_group->'journal_lines') is distinct from 'array'
     or jsonb_array_length(p_group->'journal_lines') not between 1 and 500 then
    raise exception 'invalid_lines' using errcode = '22023';
  end if;
  select count(*), (array_agg(id))[1] into v_bindings, v_binding from public.external_org_bindings where org_id=v_org and activated_at is not null;
  if v_bindings <> 1 then raise exception 'ambiguous_binding' using errcode='22023'; end if;
  select default_currency into v_currency from public.organizations where id = v_org;
  if v_currency is null or btrim(v_currency) = '' then raise exception 'currency_missing' using errcode = '22023'; end if;
  select m.attrs->>'currency' into v_ledger_currency
    from public.external_org_bindings b join public.external_master_records m
      on m.org_id=b.org_id and m.external_tier=b.external_tier and m.kind='company'
   where b.id=v_binding and b.external_tier='odoo' and m.tombstoned_at is null
     and m.attrs->>'currency' ~ '^[A-Z]{3}$'
     and (nullif(b.config->>'odoo_company_id','') is null or m.external_id=b.config->>'odoo_company_id')
   order by m.active desc, m.external_id limit 1;
  if v_ledger_currency is not null and v_ledger_currency <> v_currency then
    raise exception 'currency_mismatch' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':journal-request:' || v_request::text, 0));
  select procurement_id, payload into v_purchase, v_old from public.erp_purchase_captures
   where org_id = v_org and request_id = v_request;
  if found then
    if v_old is distinct from p_group then raise exception 'request_payload_changed' using errcode = '22023'; end if;
    select total_value, currency, record_only_date into v_total, v_currency, v_date from public.procurements where id=v_purchase and org_id=v_org;
    return jsonb_build_object('outcome','skip','reason','already_recorded','would_create',false,'procurement_id',v_purchase,
      'amount',v_total,'currency',v_currency,'erp_write',false,'request_id',v_request,'source_keys',p_group->'journal_lines',
      'project_id',v_project,'vendor_id',v_vendor,'reference',v_reference,'assignment_origin','erp_project',
      'actuals_delta',0,'source_date',v_date,'stage','already_settled_in_erp');
  end if;
  if not exists (select 1 from public.projects where id = v_project and org_id = v_org) then
    raise exception 'project_not_found' using errcode = '22023';
  end if;
  if not exists (select 1 from public.companies where id = v_vendor and org_id = v_org and type = 'Vendor' and archived_at is null) then
    raise exception 'vendor_not_found' using errcode = '22023';
  end if;
  if not public.org_reads_erp_ledger() then raise exception 'ledger_basis_missing' using errcode = '22023'; end if;
  -- Serialize source groups in deterministic key order, including groups that do not yet have a link row.
  for v_line in select value from jsonb_array_elements(p_group->'journal_lines')
    order by jsonb_build_array(value->>'erp_doctype',value->>'voucher_no',value->>'project_id',value->>'account')::text loop
    if (v_line->>'project_id')::uuid is distinct from v_project then
      raise exception 'project_mismatch' using errcode = '22023';
    end if;
    v_key := jsonb_build_array(v_line->>'erp_doctype',v_line->>'voucher_no',v_project,v_line->>'account')::text;
    if v_key = any(v_seen) then raise exception 'duplicate_line' using errcode = '22023'; end if;
    v_seen := array_append(v_seen,v_key);
    v_sources := v_sources || jsonb_build_array(v_line);
    perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_key, 0));
    select * into v_source from public.erp_journal_cost_lines(v_org, v_project, v_line->>'voucher_no')
     where erp_doctype = v_line->>'erp_doctype' and account = v_line->>'account';
    if not found then raise exception 'line_not_found' using errcode = '22023'; end if;
    if v_source.is_cancelled or v_source.amount <= 0 then raise exception 'line_not_positive_or_cancelled' using errcode = '22023'; end if;
    select * into v_facts from public.journal_source_line_facts(v_org,v_project,v_source.erp_doctype,v_source.voucher_no,v_source.account);
    if v_facts.has_negative then raise exception 'negative_line_requires_review' using errcode='22023'; end if;
    if v_facts.party_count > 1 then raise exception 'supplier_mismatch' using errcode='22023'; end if;
    if nullif(btrim(v_facts.active_party),'') is not null then
      if v_group_party is not null and v_group_party is distinct from v_facts.active_party then
        raise exception 'supplier_mismatch' using errcode='22023';
      end if;
      v_group_party := v_facts.active_party;
    end if;
    if exists (select 1 from public.erp_journal_line_links where org_id=v_org and erp_doctype=v_source.erp_doctype
       and voucher_no=v_source.voucher_no and project_id=v_project and account=v_source.account) then
      raise exception 'line_already_attached' using errcode = '22023';
    end if;
    if v_facts.active_party is null or btrim(v_facts.active_party) = '' then
      if coalesce((p_group->>'vendor_confirmed')::boolean,false) is not true then
        raise exception 'vendor_confirmation_required' using errcode = '22023';
      end if;
    else
      v_party := public.erp_supplier_company(v_org, v_facts.active_party, v_facts.active_party);
      if v_party is null then
        if coalesce((p_group->>'vendor_confirmed')::boolean,false) is not true then
          raise exception 'vendor_confirmation_required' using errcode = '22023';
        end if;
      elsif v_party is distinct from v_vendor then
        raise exception 'supplier_mismatch' using errcode = '22023';
      end if;
    end if;
    v_total := v_total + v_source.amount;
    v_date := least(v_date, v_source.posting_date);
  end loop;
  if p_dry_run then
    return jsonb_build_object('outcome','create','would_create',true,'procurement_id',null,'amount',v_total,'currency',v_currency,'erp_write',false,'request_id',v_request,'source_keys',v_sources,'project_id',v_project,'vendor_id',v_vendor,'reference',v_reference,'assignment_origin','erp_project','actuals_delta',0,'source_date',v_date,'stage','already_settled_in_erp');
  end if;
  insert into public.procurements(org_id, code, title, requested_by_id, project_id, vendor_id, currency, total_value, origin, record_only, record_only_stage, record_only_date, record_only_reference, status)
  values(v_org, public.next_procurement_doc_number(v_org,'PROC'), v_title, v_actor, v_project, v_vendor, v_currency, v_total, 'erp_link', true, 'already_settled_in_erp', v_date, v_reference, 'Paid')
  returning id into v_purchase;
  for v_line in select value from jsonb_array_elements(v_sources) loop
    insert into public.erp_journal_line_links(org_id,procurement_id,erp_doctype,voucher_no,project_id,account,linked_by)
    values(v_org,v_purchase,v_line->>'erp_doctype',v_line->>'voucher_no',v_project,v_line->>'account',v_actor);
  end loop;
  insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
  values(v_org,v_binding,v_request,v_purchase,p_group,'journal','paid',v_actor);
  perform public.log_audit('procurement.record_only_create',v_org,v_actor,v_purchase,
    jsonb_build_object('project_id',v_project,'vendor_id',v_vendor,'sources',v_sources,'reference',v_reference,
                       'assignment_origin','erp_project','before_project',v_project,'after_project',v_project,'actuals_delta',0));
  return jsonb_build_object('outcome','create','would_create',false,'procurement_id',v_purchase,'amount',v_total,'currency',v_currency,'erp_write',false,'request_id',v_request,'source_keys',v_sources,'project_id',v_project,'vendor_id',v_vendor,'reference',v_reference,'assignment_origin','erp_project','actuals_delta',0,'source_date',v_date,'stage','already_settled_in_erp');
end $$;

alter table public.erp_purchase_captures drop column source_evidence, drop column supplier_override_reason;
