-- 0903 #2277: an active Admin places an ERP purchase order and every invoice that bills it on one PMO project, as one record-only purchase, or
-- attaches the invoices to the captured purchase the order already has. Each untagged invoice gets an ordinary B1 project decision, so its
-- ledger lines count exactly as B1's do. Nothing here writes to the ERP.
-- Rollback: supabase/migrations/rollback/0903_capture_order_family_down.sql

-- §1 A decision names the family request and order it was made for. Both are fixed at insert (guard_capture_assignment_update, 0882).
alter table public.erp_capture_invoice_assignments
  add column family_request_id uuid,
  add column family_order_document_id uuid references public.erp_purchase_documents(id),
  add constraint erp_capture_invoice_assignments_family_shape
    check ((family_request_id is null) = (family_order_document_id is null) and (family_request_id is null or decision = 'project'));
create index erp_capture_assignment_family_idx
  on public.erp_capture_invoice_assignments (org_id, family_request_id) where family_request_id is not null;

-- §2 The claim (0882's body, plus the lines marked 0903): a family decision stores its family request, order and the family request's digest.
create or replace function public.capture_assignment_claim(p_org uuid, p_binding uuid, p_actor uuid, p_row jsonb, p_revision text, p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_request uuid := (p_row->>'request_id')::uuid;
  v_source uuid := (p_row->>'source_id')::uuid;
  v_decision text := p_row->>'decision';
  v_project uuid := nullif(p_row->>'project_id','')::uuid;
  v_accept boolean := coalesce((p_row->>'accept_set_aside')::boolean,false);
  v_capital boolean := coalesce((p_row->>'allow_capital_as_overhead')::boolean,false);
  v_digest text; v_base jsonb; v_existing public.erp_capture_invoice_assignments%rowtype; v_id uuid; v_mark public.erp_purchase_document_marks%rowtype; v_marked boolean; v_vtype text; v_vno text; v_company text;
begin
  v_digest := encode(extensions.digest(convert_to(jsonb_build_object('decision',v_decision,'source_id',v_source,'project_id',v_project,
    'accept_set_aside',v_accept,'allow_capital_as_overhead',v_capital)::text,'UTF8'),'sha256'),'hex');
  v_digest := coalesce(nullif(p_row->>'family_digest',''),v_digest);  -- a family decision carries its family request's digest  -- 0903
  v_base := jsonb_build_object('request_id',v_request,'source_id',v_source,'erp_write',false);
  -- A retry of the same request waits for the first attempt, then sees its stored row.
  if not p_dry_run then perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':assign:' || v_request::text,0)); end if;
  select * into v_existing from public.erp_capture_invoice_assignments where org_id = p_org and request_id = v_request;
  if found then
    if v_existing.payload_digest <> v_digest then return v_base || jsonb_build_object('outcome','refused','reason','request_conflict'); end if;
    if v_existing.undone_at is not null then return v_base || jsonb_build_object('outcome','refused','reason','undone'); end if;
    return v_base || jsonb_build_object('outcome','skip','decision_id',v_existing.id);
  end if;
  if p_dry_run then
    select erp_doctype, erp_name into v_vtype, v_vno from public.erp_purchase_documents where org_id = p_org and id = v_source;
  else
    select erp_doctype, erp_name into v_vtype, v_vno from public.erp_purchase_documents where org_id = p_org and id = v_source for update;
  end if;
  if not found then return v_base || jsonb_build_object('outcome','not_found'); end if;
  if v_project is not null and not exists (select 1 from public.projects where id = v_project and org_id = p_org) then
    return v_base || jsonb_build_object('outcome','not_found');
  end if;
  if p_dry_run then
    if exists (select 1 from public.erp_capture_invoice_assignments where org_id = p_org and binding_id = p_binding and source_document_id = v_source and undone_at is null) then
      return v_base || jsonb_build_object('outcome','refused','reason','source_already_decided');
    end if;
    return v_base || jsonb_build_object('outcome','preview','would_create',true);
  end if;
  -- The unique active-source index decides a race; the loser's insert fails inside this subtransaction.
  -- The mark as it is now, under the source lock, so an undo can restore it exactly.
  select * into v_mark from public.erp_purchase_document_marks where erp_purchase_document_id = v_source;
  v_marked := found;
  select nullif(btrim(config->>'company'),'') into v_company from public.external_org_bindings where id = p_binding and org_id = p_org;
  -- A project decision that accepts the overhead mark replaces an active set-aside decision for the same invoice, in this transaction.
  if v_decision = 'project' and v_accept then
    update public.erp_capture_invoice_assignments set undone_at = now(), undone_by = p_actor, undone_reason = 'superseded by request ' || v_request::text
     where org_id = p_org and binding_id = p_binding and source_document_id = v_source and decision = 'set_aside' and undone_at is null;
  end if;
  begin
    insert into public.erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,
      accept_set_aside,allow_capital_as_overhead,source_revision,actor_id,source_voucher_type,source_voucher_no,source_company,
      prior_mark_present,prior_mark_set_aside_at,prior_mark_set_aside_by,prior_mark_note,prior_mark_updated_at,prior_mark_updated_by,family_request_id,family_order_document_id)  -- 0903
    values (p_org,p_binding,v_source,v_request,v_digest,v_decision,v_project,v_accept,v_capital,p_revision,p_actor,
      v_vtype,v_vno,v_company,
      v_marked,v_mark.set_aside_at,v_mark.set_aside_by,v_mark.note,v_mark.updated_at,v_mark.updated_by,  -- 0903
      nullif(p_row->>'family_request_id','')::uuid,nullif(p_row->>'family_order_document_id','')::uuid) returning id into v_id;  -- 0903
  exception when unique_violation then
    return v_base || jsonb_build_object('outcome','refused','reason','source_already_decided');
  end;
  return v_base || jsonb_build_object('outcome','recorded','decision_id',v_id);
end $$;

-- §2b The validator (0882's body, plus the lines marked 0903): an invoice that bills exactly the family's order passes the family check.
drop function public.capture_assignment_validate(uuid,uuid,jsonb,uuid,jsonb);
create function public.capture_assignment_validate(p_org uuid, p_binding uuid, p_row jsonb, p_decision_id uuid, p_batch jsonb default null, p_family_order text default null)  -- 0903
returns jsonb language plpgsql stable set search_path = public, pg_catalog as $$
declare
  v_doc public.erp_purchase_documents%rowtype; v_company text; v_decision text := p_row->>'decision';
  v_total integer; v_foreign integer; v_tagged integer; v_unknown integer; v_mapped numeric; v_capital numeric; v_other numeric; v_excluded jsonb;
  v_state text; v_class text; v_vendors integer; v_mark public.erp_purchase_document_marks%rowtype; v_warnings jsonb := '[]'::jsonb; v_published timestamptz; v_source_as_of timestamptz; v_prior jsonb;
begin
  select * into v_doc from public.erp_purchase_documents where id = (p_row->>'source_id')::uuid and org_id = p_org;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if exists (select 1 from public.erp_capture_invoice_assignments a where a.org_id = p_org and a.source_document_id = v_doc.id
              and a.undone_at is null and a.id is distinct from p_decision_id) then
    return jsonb_build_object('ok',false,'reason','source_already_decided');
  end if;
  select nullif(btrim(config->>'company'),'') into v_company from public.external_org_bindings where id = p_binding and org_id = p_org;
  if v_company is null then return jsonb_build_object('ok',false,'reason','binding_evidence_missing'); end if;
  if v_doc.erp_doctype <> 'Purchase Invoice' then return jsonb_build_object('ok',false,'reason','source_kind_unsupported'); end if;
  if v_doc.erp_docstatus <> 1 then return jsonb_build_object('ok',false,'reason','document_cancelled'); end if;
  if v_doc.is_return then return jsonb_build_object('ok',false,'reason','document_is_return'); end if;
  if public.erp_document_recorded_by_pmo(p_org, v_doc.erp_doctype, v_doc.erp_name) then return jsonb_build_object('ok',false,'reason','document_recorded_by_pmo'); end if;
  if exists (select 1 from public.procurement_erp_links l where l.org_id = p_org and l.erp_purchase_document_id = v_doc.id) then
    return jsonb_build_object('ok',false,'reason','source_already_linked');
  end if;
  if cardinality(v_doc.project_ids) > 1 then return jsonb_build_object('ok',false,'reason','document_spans_projects'); end if;
  if cardinality(v_doc.project_ids) > 0 or nullif(btrim(v_doc.erp_project),'') is not null then return jsonb_build_object('ok',false,'reason','source_tagged'); end if;
  if v_doc.currency is null then return jsonb_build_object('ok',false,'reason','currency_unknown'); end if;
  if v_doc.net_total is null or v_doc.net_total <= 0 then return jsonb_build_object('ok',false,'reason','amount_unknown'); end if;
  select count(distinct c.id) into v_vendors from public.external_refs x join public.companies c on c.id::text = x.pmo_record_id and c.org_id = x.org_id
   where x.org_id = p_org and x.domain = 'companies' and x.external_tier = 'erpnext'
     and x.external_record_id in ('Supplier:' || v_doc.supplier, v_doc.supplier) and c.archived_at is null and c.type = 'Vendor';
  if v_doc.supplier is null or v_vendors <> 1 then return jsonb_build_object('ok',false,'reason','supplier_unknown'); end if;
  if v_doc.bill_no is not null and exists (select 1 from public.erp_purchase_documents o where o.org_id = p_org and o.id <> v_doc.id
       and o.erp_doctype = v_doc.erp_doctype and o.erp_docstatus = 1 and o.supplier = v_doc.supplier and o.bill_no = v_doc.bill_no
       and (exists (select 1 from public.procurement_erp_links l where l.org_id = p_org and l.erp_purchase_document_id = o.id)
            or exists (select 1 from public.erp_capture_invoice_assignments a where a.org_id = p_org and a.source_document_id = o.id and a.undone_at is null))) then
    return jsonb_build_object('ok',false,'reason','duplicate_lineage');
  end if;
  -- An invoice that bills exactly the order of the family being placed is that family's member, not an incomplete family.  -- 0903
  if cardinality(v_doc.purchase_orders) > 0 and (p_family_order is null or v_doc.purchase_orders <> array[p_family_order]) then  -- 0903
    return jsonb_build_object('ok',false,'reason',case when p_family_order is null then 'family_incomplete' else 'family_ambiguous' end);  -- 0903
  end if;  -- 0903
  with gl as (
    select g.company, g.project, g.account, coalesce(g.debit,0) - coalesce(g.credit,0) as amt, a.root_type,
           (m.id is not null and a.root_type = 'Expense') as mapped_expense
      from public.erp_gl_entry_mirror g
      left join public.erp_account_mirror a on a.org_id = g.org_id and a.company = g.company and a.erp_name = g.account and not a.is_group
      left join public.budget_category_account_map m on m.org_id = g.org_id and m.erp_account = g.account
     where g.org_id = p_org and g.voucher_type = v_doc.erp_doctype and g.voucher_no = v_doc.erp_name and not g.is_cancelled)
  select count(*), count(*) filter (where company is distinct from v_company),
         count(*) filter (where nullif(btrim(project),'') is not null),
         count(*) filter (where company is not distinct from v_company and root_type is null),
         coalesce(sum(amt) filter (where mapped_expense),0),
         coalesce(sum(amt) filter (where not mapped_expense and root_type = 'Asset' and amt > 0),0),
         coalesce(sum(amt) filter (where not mapped_expense and root_type = 'Expense' and amt > 0),0),
         coalesce(jsonb_agg(jsonb_build_object('account',account,'amount',amt,'kind',case root_type when 'Asset' then 'capital' else 'unmapped_expense' end) order by account)
                  filter (where not mapped_expense and root_type in ('Asset','Expense') and amt > 0),'[]'::jsonb)
    into v_total, v_foreign, v_tagged, v_unknown, v_mapped, v_capital, v_other, v_excluded from gl;
  if v_total = 0 then return jsonb_build_object('ok',false,'reason','ledger_evidence_missing'); end if;
  if v_foreign > 0 then return jsonb_build_object('ok',false,'reason','ledger_company_mismatch'); end if;
  if v_tagged > 0 then return jsonb_build_object('ok',false,'reason','source_tagged'); end if;
  if v_unknown > 0 then return jsonb_build_object('ok',false,'reason','account_classification_unknown'); end if;
  v_class := case when v_mapped > 0 and (v_capital > 0 or v_other > 0) then 'mixed' when v_mapped > 0 then 'expense'
                  when v_capital > 0 and v_other = 0 then 'capital' else 'unmapped' end;
  v_state := case v_doc.erp_status when 'Unpaid' then 'invoiced' when 'Overdue' then 'invoiced' when 'Partly Paid' then 'part_paid' when 'Paid' then 'paid' end;
  select * into v_mark from public.erp_purchase_document_marks where erp_purchase_document_id = v_doc.id;
  -- What a rule or equipment setting places for this invoice's ledger lines now, read once for the whole batch by assign_capture_invoices.
  v_prior := coalesce(p_batch->'allocations'->(v_doc.erp_doctype || '|' || v_doc.erp_name),'[]'::jsonb);
  if v_decision = 'project' then
    if v_class = 'capital' then return jsonb_build_object('ok',false,'reason','capital_spending_not_assignable','excluded',v_excluded); end if;
    if v_class = 'unmapped' or v_mapped <= 0 then return jsonb_build_object('ok',false,'reason','invoice_has_no_mapped_cost','excluded',v_excluded); end if;
    if v_state is null then return jsonb_build_object('ok',false,'reason','state_unknown'); end if;
    -- A placement needs the organization's latest tagged snapshot to be at least as new as every current ledger row of the source, else a
    -- tag the ERP has just set could still be missing from it. A timestamp guard, not proof of exact coherence (see docs/runbooks/pmo-cli.md, "When an ERP project tag appears later").
    select max(s.as_of) into v_published from public.erp_actuals_snapshot s
     where s.org_id = p_org and s.snapshot_id = (select s2.snapshot_id from public.erp_actuals_snapshot s2 where s2.org_id = p_org order by s2.created_at desc, s2.id desc limit 1);
    if v_published is null then return jsonb_build_object('ok',false,'reason','snapshot_unavailable'); end if;
    select max(g.as_of) into v_source_as_of from public.erp_gl_entry_mirror g
     where g.org_id = p_org and g.voucher_type = v_doc.erp_doctype and g.voucher_no = v_doc.erp_name and not g.is_cancelled;
    if v_source_as_of is null then return jsonb_build_object('ok',false,'reason','ledger_evidence_missing'); end if;
    if v_source_as_of > v_published then return jsonb_build_object('ok',false,'reason','snapshot_refresh_required'); end if;
    if v_mark.set_aside_at is not null and not coalesce((p_row->>'accept_set_aside')::boolean,false) then
      return jsonb_build_object('ok',false,'reason','set_aside_confirmation_required');
    end if;
  else
    if v_mark.set_aside_at is not null then return jsonb_build_object('ok',false,'reason','already_set_aside'); end if;
    if v_class = 'capital' and not coalesce((p_row->>'allow_capital_as_overhead')::boolean,false) then
      return jsonb_build_object('ok',false,'reason','capital_spending_requires_override','excluded',v_excluded);
    end if;
    -- An existing attribution rule keeps allocating an overhead invoice's ledger lines until it is changed on purpose.
    if jsonb_array_length(v_prior) > 0 then v_warnings := v_warnings || to_jsonb('allocated_by_rule'::text); end if;
  end if;
  return jsonb_build_object('ok',true,'classification',v_class,'mapped_amount',v_mapped,'excluded',v_excluded,'state',v_state,'currency',v_doc.currency,'warnings',v_warnings,
    'prior_placement',v_prior,'ledger_currency',p_batch->>'currency','clears_mark',coalesce(v_decision = 'project' and v_mark.set_aside_at is not null,false));
end $$;
revoke execute on function public.capture_assignment_validate(uuid,uuid,jsonb,uuid,jsonb,text) from public, anon, authenticated, service_role;

-- §3 One family row, end to end: replay, the order, the family, B1's checks per untagged invoice, then one record-only purchase (create) or the
-- invoices attached to the captured purchase the order already has (attach). Decisions are written before links: the linker's I-3 exception
-- admits an untagged invoice only with an active placement on the purchase's project (0882 §2b), and I-2 keeps the order and every invoice
-- billing it in one purchase. A dry run does all of it and rolls it back, so the preview's commitment figures are the readers' own.
create function public.capture_assignment_family(p_org uuid, p_binding uuid, p_actor uuid, p_row jsonb, p_revision text, p_dry_run boolean, p_batch jsonb default null)
returns jsonb language plpgsql set search_path = public, pg_catalog as $$
declare
  v_request uuid := (p_row->>'request_id')::uuid; v_project uuid := (p_row->>'project_id')::uuid;
  v_accept boolean := coalesce((p_row->>'accept_set_aside')::boolean,false);
  v_invoices uuid[] := array(select (x#>>'{}')::uuid from jsonb_array_elements(p_row->'invoice_ids') x order by 1);
  v_capture_request uuid; v_digest text; v_base jsonb; v_reason text; v_mode text;
  v_order public.erp_purchase_documents%rowtype; v_inv public.erp_purchase_documents%rowtype;
  v_capture public.erp_purchase_captures%rowtype; v_target_row public.procurements%rowtype;
  v_family uuid[]; v_missing uuid[]; v_extra uuid[]; v_target uuid; v_vendor uuid; v_vendors integer;
  v_val jsonb; v_claim jsonb; v_id uuid; v_ids uuid[] := '{}'; v_items jsonb := '[]'::jsonb; v_rows jsonb; v_result jsonb;
  v_purchase uuid; v_stage text; v_prior_stage text; v_prior_status text; v_prior_invoiced timestamptz; v_before numeric := 0; v_after numeric := 0;
begin
  v_capture_request := md5(v_request::text || ':family')::uuid;
  v_digest := encode(extensions.digest(convert_to(jsonb_build_object('decision','order_family','source_id',(p_row->>'source_id')::uuid,'project_id',v_project,
    'invoice_ids',to_jsonb(v_invoices),'accept_set_aside',v_accept)::text,'UTF8'),'sha256'),'hex');
  v_base := jsonb_build_object('request_id',v_request,'source_id',(p_row->>'source_id')::uuid,'decision','order_family','erp_write',false);
  -- A retry of the same request waits for the first attempt, then sees the capture row every applied family writes.
  if not p_dry_run then perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':assign:' || v_request::text,0)); end if;
  select * into v_capture from public.erp_purchase_captures where org_id = p_org and request_id = v_capture_request;
  if found then
    if v_capture.payload->>'digest' is distinct from v_digest then return v_base || jsonb_build_object('outcome','refused','reason','request_conflict'); end if;
    if v_capture.undone_at is not null then return v_base || jsonb_build_object('outcome','refused','reason','undone'); end if;
    return v_base || jsonb_build_object('outcome','skip','procurement_id',v_capture.procurement_id);
  end if;
  if exists (select 1 from public.erp_capture_invoice_assignments where org_id = p_org and request_id = v_request) then
    return v_base || jsonb_build_object('outcome','refused','reason','request_conflict');
  end if;
  select * into v_order from public.erp_purchase_documents where org_id = p_org and id = (p_row->>'source_id')::uuid;
  if not found or not exists (select 1 from public.projects where id = v_project and org_id = p_org) then
    return v_base || jsonb_build_object('outcome','not_found');
  end if;
  v_base := v_base || jsonb_build_object('source',v_order.erp_name,'supplier',v_order.supplier_name);
  -- Lock order (NFR-002), as the linker's: the order's name, then the documents by id, then (below) the purchase.
  perform public.lock_erp_order_family(p_org, array[v_order.erp_name]);
  perform 1 from public.erp_purchase_documents where org_id = p_org and id = any(v_invoices || v_order.id) order by id for update;
  select * into v_order from public.erp_purchase_documents where org_id = p_org and id = v_order.id;
  begin
    if v_order.erp_doctype <> 'Purchase Order' then v_reason := 'source_kind_unsupported';
    elsif v_order.erp_docstatus <> 1 then v_reason := 'document_cancelled';
    elsif public.erp_document_recorded_by_pmo(p_org, v_order.erp_doctype, v_order.erp_name) then v_reason := 'document_recorded_by_pmo';
    elsif cardinality(v_order.project_ids) > 1 then v_reason := 'document_spans_projects';
    elsif (cardinality(v_order.project_ids) = 1 and v_order.project_ids[1] <> v_project)
       or (cardinality(v_order.project_ids) = 0 and nullif(btrim(v_order.erp_project),'') is not null) then v_reason := 'family_project_conflict';
    elsif v_order.currency is null then v_reason := 'currency_unknown';
    end if;
    if v_reason is null then
      -- exactly one PMO vendor for the order's supplier, by the rule B1 applies to an invoice (0882 capture_assignment_validate)
      select count(distinct c.id), min(c.id::text)::uuid into v_vendors, v_vendor from public.external_refs x
        join public.companies c on c.id::text = x.pmo_record_id and c.org_id = x.org_id
       where x.org_id = p_org and x.domain = 'companies' and x.external_tier = 'erpnext'
         and x.external_record_id in ('Supplier:' || v_order.supplier, v_order.supplier) and c.archived_at is null and c.type = 'Vendor';
      if v_order.supplier is null or v_vendors <> 1 then v_reason := 'supplier_unknown'; end if;
    end if;
    if v_reason is null and exists (select 1 from public.erp_purchase_documents i where i.org_id = p_org and i.erp_doctype = 'Purchase Invoice'
         and i.erp_docstatus = 1 and i.is_return and v_order.erp_name = any(i.purchase_orders)) then
      v_reason := 'family_has_return';
    end if;
    if v_reason is null and exists (select 1 from public.erp_capture_invoice_assignments a where a.org_id = p_org and a.source_document_id = any(v_invoices)
         and a.decision = 'project' and a.undone_at is null) then
      v_reason := 'source_already_decided';
    end if;
    if v_reason is null and exists (select 1 from public.procurement_erp_links l where l.org_id = p_org and l.erp_purchase_document_id = any(v_invoices)) then
      v_reason := 'source_already_linked';
    end if;
    if v_reason is not null then raise exception using errcode = 'PFE02', message = v_reason; end if;
    -- The family (MC-4): the order's submitted, non-return invoices not yet linked. Each must bill this order only.
    v_family := array(select i.id from public.erp_purchase_documents i where i.org_id = p_org and i.erp_doctype = 'Purchase Invoice' and i.erp_docstatus = 1
                        and not i.is_return and v_order.erp_name = any(i.purchase_orders)
                        and not exists (select 1 from public.procurement_erp_links l where l.org_id = p_org and l.erp_purchase_document_id = i.id)
                      order by i.id);
    if exists (select 1 from public.erp_purchase_documents i where i.id = any(v_family) and i.purchase_orders <> array[v_order.erp_name]) then
      v_reason := 'family_ambiguous'; raise exception using errcode = 'PFE02', message = v_reason;
    end if;
    v_missing := array(select unnest(v_family) except select unnest(v_invoices) order by 1);
    v_extra := array(select unnest(v_invoices) except select unnest(v_family) order by 1);
    if cardinality(v_missing) > 0 or cardinality(v_extra) > 0 then
      return v_base || jsonb_build_object('outcome','refused','reason','family_incomplete','missing_invoice_ids',to_jsonb(v_missing),'extra_invoice_ids',to_jsonb(v_extra));
    end if;
    for v_inv in select * from public.erp_purchase_documents where org_id = p_org and id = any(v_invoices) order by id loop
      if v_inv.supplier is distinct from v_order.supplier then v_reason := 'supplier_mismatch';
      elsif v_inv.currency is distinct from v_order.currency then v_reason := 'currency_mismatch';
      -- FR-007: untagged, or tagged in the ERP with the chosen project only
      elsif not (cardinality(v_inv.project_ids) = 0 and nullif(btrim(v_inv.erp_project),'') is null) and v_inv.project_ids is distinct from array[v_project] then
        v_reason := 'family_project_conflict';
      elsif cardinality(v_inv.project_ids) > 0 and coalesce(v_inv.erp_status,'') not in ('Unpaid','Overdue','Partly Paid','Paid') then v_reason := 'state_unknown';
      end if;
      if v_reason is not null then raise exception using errcode = 'PFE02', message = v_reason; end if;
    end loop;
    -- FR-009: an order already in a purchase takes the invoices only if that purchase is a live record-only capture of this project, vendor and currency.
    select l.procurement_id into v_target from public.procurement_erp_links l where l.org_id = p_org and l.erp_purchase_document_id = v_order.id;
    if v_target is not null then
      select * into v_target_row from public.procurements where id = v_target and org_id = p_org for update;
      if not v_target_row.record_only then v_reason := 'ordinary_purchase_requires_decision';
      elsif v_target_row.status::text in ('Cancelled','Rejected') or v_target_row.project_id is distinct from v_project
         or v_target_row.currency is distinct from v_order.currency or v_target_row.vendor_id is distinct from v_vendor
         or not exists (select 1 from public.erp_purchase_captures c where c.org_id = p_org and c.procurement_id = v_target and c.undone_at is null
                         and c.kind in ('order','supplier_invoice'))
         or exists (select 1 from public.erp_purchase_captures c where c.org_id = p_org and c.procurement_id = v_target and c.kind = 'journal') then
        v_reason := 'family_conflict';
      end if;
      if v_reason is not null then raise exception using errcode = 'PFE02', message = v_reason; end if;
      v_mode := 'attach';
      v_prior_stage := v_target_row.record_only_stage; v_prior_status := v_target_row.status::text; v_prior_invoiced := v_target_row.vendor_invoiced_at;
      v_before := coalesce((select c.amount from public.procurement_open_commitments(array[v_target]) c),0);
    else
      v_mode := 'create';
    end if;
    -- One ordinary B1 project decision per untagged invoice, claimed then validated exactly as B1 does; a tagged invoice is linked without one.
    for v_inv in select * from public.erp_purchase_documents where org_id = p_org and id = any(v_invoices) order by id loop
      if cardinality(v_inv.project_ids) = 0 then
        v_claim := public.capture_assignment_claim(p_org,p_binding,p_actor,jsonb_build_object('request_id',md5(v_request::text || ':' || v_inv.id::text)::uuid,
          'source_id',v_inv.id,'decision','project','project_id',v_project,'accept_set_aside',v_accept,'allow_capital_as_overhead',false,
          'family_request_id',v_request,'family_order_document_id',v_order.id,'family_digest',v_digest),p_revision,false);
        if v_claim->>'outcome' is distinct from 'recorded' then
          v_reason := coalesce(v_claim->>'reason','source_already_decided'); raise exception using errcode = 'PFE02', message = v_reason;
        end if;
        v_id := (v_claim->>'decision_id')::uuid;
        v_val := public.capture_assignment_validate(p_org,p_binding,jsonb_build_object('source_id',v_inv.id,'decision','project','project_id',v_project,
          'accept_set_aside',v_accept),v_id,p_batch,v_order.erp_name);
        if not (v_val->>'ok')::boolean then v_reason := v_val->>'reason'; raise exception using errcode = 'PFE02', message = v_reason; end if;
        update public.erp_capture_invoice_assignments set original_classification = v_val->>'classification', prior_placement = v_val->'prior_placement' where id = v_id;
        v_ids := v_ids || v_id;
        v_items := v_items || jsonb_build_array(jsonb_build_object('source_id',v_inv.id,'source',v_inv.erp_name,'tagged',false,
          'decision_id',case when p_dry_run then null else v_id end,'mapped_amount',v_val->'mapped_amount','excluded',v_val->'excluded',
          'classification',v_val->>'classification','prior_placement',v_val->'prior_placement','state',v_val->>'state','clears_mark',v_val->'clears_mark'));
      else
        v_items := v_items || jsonb_build_array(jsonb_build_object('source_id',v_inv.id,'source',v_inv.erp_name,'tagged',true,
          'state',case v_inv.erp_status when 'Paid' then 'paid' when 'Partly Paid' then 'part_paid' else 'invoiced' end));
      end if;
    end loop;
    -- A record-only purchase takes no link, so an attach lowers the flag for the link and raises it again, as the capture's attach does (0866).
    if v_mode = 'attach' then update public.procurements set record_only = false where id = v_target and org_id = p_org; end if;
    v_rows := case when v_mode = 'create' then jsonb_build_array(jsonb_build_object('erp_name',v_order.erp_name,'erp_doctype','Purchase Order',
                 'project_id',v_project,'group',v_request::text)) else '[]'::jsonb end
           || coalesce((select jsonb_agg(jsonb_build_object('erp_name',d.erp_name,'erp_doctype','Purchase Invoice','project_id',v_project,'group',v_request::text)
                         || case when v_mode = 'attach' then jsonb_build_object('procurement_id',v_target) else '{}'::jsonb end order by d.id)
                         from public.erp_purchase_documents d where d.org_id = p_org and d.id = any(v_invoices)),'[]'::jsonb);
    v_result := public.link_erp_purchase_documents(v_rows,false);
    if coalesce((v_result#>>'{counts,link}')::integer,0) <> jsonb_array_length(v_rows) then
      v_reason := coalesce((select r->>'reason' from jsonb_array_elements(v_result->'results') r where r->>'outcome' <> 'link'
                            order by (r->>'row')::integer limit 1),'family_requires_decision');
      raise exception using errcode = 'PFE02', message = v_reason;
    end if;
    v_purchase := coalesce(v_target,(v_result#>>'{results,0,procurement_id}')::uuid);
    -- FR-011: paid when every linked invoice is paid, invoiced when none is paid or part paid, else part paid.
    select case when bool_and(d.erp_status = 'Paid') then 'paid' when bool_or(d.erp_status in ('Paid','Partly Paid')) then 'part_paid' else 'invoiced' end into v_stage
      from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.org_id = p_org and l.procurement_id = v_purchase and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1;
    update public.procurements set record_only = true, record_only_stage = v_stage,
           record_only_reference = case when v_mode = 'create' then v_order.erp_name else record_only_reference end
     where id = v_purchase and org_id = p_org;
    insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
      values (p_org,p_binding,v_capture_request,v_purchase,
        jsonb_build_object('project_id',v_project,'source_ids',to_jsonb(case when v_mode = 'create' then v_order.id || v_invoices else v_invoices end),
          'family_request_id',v_request,'order_id',v_order.id,'decision_ids',to_jsonb(v_ids),'mode',v_mode,
          'prior_stage',v_prior_stage,'prior_status',v_prior_status,'prior_vendor_invoiced_at',v_prior_invoiced,'digest',v_digest,'assignment_origin','pmo_assignment'),
        'supplier_invoice',v_stage,p_actor);
    update public.erp_capture_invoice_assignments set procurement_id = v_purchase where id = any(v_ids);
    v_after := coalesce((select c.amount from public.procurement_open_commitments(array[v_purchase]) c),0);
    perform public.log_audit(case v_mode when 'create' then 'procurement.record_only_create' else 'procurement.erp_family_attach' end,p_org,p_actor,v_purchase,
      jsonb_build_object('project_id',v_project,'family',true,'family_request_id',v_request,'order_id',v_order.id,'invoices',v_items,'decision_ids',to_jsonb(v_ids),
        'commitment_before',v_before,'commitment_after',v_after,'assignment_origin','pmo_assignment','erp_write',false));
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
  exception
    when sqlstate 'PFE01' then v_purchase := case when v_mode = 'attach' then v_target end;
    when sqlstate 'PFE02' then return v_base || jsonb_build_object('outcome','refused','reason',v_reason)
      || case when v_reason = 'snapshot_refresh_required' then jsonb_build_object('message','retry after the next ledger refresh') else '{}'::jsonb end;
  end;
  return v_base || jsonb_build_object('outcome',v_mode,'procurement_id',v_purchase,'would_create',p_dry_run and v_mode = 'create','project_id',v_project,
    'invoices',v_items,'commitment_before',round(v_before,2)::text,'commitment_after',round(v_after,2)::text,
    'decision_ids',case when p_dry_run then '[]'::jsonb else to_jsonb(v_ids) end,'ledger_currency',p_batch->>'currency','assignment_origin','pmo_assignment');
end $$;
revoke execute on function public.capture_assignment_family(uuid,uuid,uuid,jsonb,text,boolean,jsonb) from public, anon, authenticated, service_role;

-- §4 The public entry (0882's body, plus the lines marked 0903): a row may be an order family, with its project and 1 to 50 invoices.
create or replace function public.assign_capture_invoices(p_rows jsonb, p_expected_revision text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_binding uuid; v_count integer; v_row jsonb; v_norm jsonb := '[]'::jsonb; v_results jsonb := '[]'::jsonb; v_revision text;
  v_i integer; v_item record; v_batch jsonb;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin'
     or exists (select 1 from auth.users u where u.id = v_actor and u.banned_until is not null and u.banned_until > now()) then
    raise exception 'Only an active Admin can place invoices.' using errcode = '42501';
  end if;
  perform public.assert_feature_on(v_org,'procurement');
  if p_dry_run is null or nullif(btrim(p_expected_revision),'') is null
     or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'invalid_assignment_rows' using errcode = '22023';
  end if;
  for v_row, v_i in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_row) k where k not in ('request_id','source_id','decision','project_id','accept_set_aside','allow_capital_as_overhead','invoice_ids'))  -- 0903
       or coalesce(v_row->>'request_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_row->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_row->>'decision' not in ('project','set_aside','order_family')  -- 0903
       or (v_row->>'decision' in ('project','order_family')) is distinct from (coalesce(v_row->>'project_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')  -- 0903
       or (v_row->>'decision' = 'order_family') is distinct from (v_row ? 'invoice_ids')  -- 0903
       or (v_row->>'decision' = 'order_family' and (v_row ? 'allow_capital_as_overhead' or jsonb_typeof(v_row->'invoice_ids') <> 'array'  -- 0903
            or jsonb_array_length(v_row->'invoice_ids') not between 1 and 50  -- 0903
            or exists (select 1 from jsonb_array_elements(v_row->'invoice_ids') x where jsonb_typeof(x) <> 'string' or x#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')  -- 0903
            or (select count(distinct lower(x#>>'{}')) from jsonb_array_elements(v_row->'invoice_ids') x) <> jsonb_array_length(v_row->'invoice_ids')))  -- 0903
       or (v_row ? 'project_id' and v_row->>'decision' = 'set_aside')
       or (v_row ? 'accept_set_aside' and jsonb_typeof(v_row->'accept_set_aside') <> 'boolean')
       or (v_row ? 'allow_capital_as_overhead' and jsonb_typeof(v_row->'allow_capital_as_overhead') <> 'boolean') then
      raise exception 'invalid_assignment_row' using errcode = '22023';
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('i',v_i,'request_id',lower(v_row->>'request_id'),'source_id',lower(v_row->>'source_id'),
      'decision',v_row->>'decision','project_id',lower(v_row->>'project_id'),
      'accept_set_aside',coalesce((v_row->>'accept_set_aside')::boolean,false),'allow_capital_as_overhead',coalesce((v_row->>'allow_capital_as_overhead')::boolean,false)));
    if v_row ? 'invoice_ids' then  -- a family row carries its invoices, sorted and lower-cased  -- 0903
      v_norm := jsonb_set(v_norm, array[(jsonb_array_length(v_norm) - 1)::text, 'invoice_ids'],  -- 0903
        (select jsonb_agg(lower(x#>>'{}') order by lower(x#>>'{}')) from jsonb_array_elements(v_row->'invoice_ids') x));  -- 0903
    end if;  -- 0903
  end loop;
  if (select count(distinct r->>'request_id') from jsonb_array_elements(v_norm) r) <> jsonb_array_length(v_norm)
     -- Every document id, a row's source or a family's invoice, appears once in the batch  -- 0903
     or (select count(x) <> count(distinct x) from (select r->>'source_id' as x from jsonb_array_elements(v_norm) r  -- 0903
           union all select i#>>'{}' from jsonb_array_elements(v_norm) r cross join lateral jsonb_array_elements(coalesce(r->'invoice_ids','[]'::jsonb)) i) ids) then  -- 0903
    raise exception 'duplicate_assignment_row' using errcode = '22023';
  end if;
  -- The capture fence first (shared for a preview, exclusive for an apply), then the actor's profile and user rows, so the order is always
  -- fence, then document. A demotion or ban that commits during a long batch waits for it or wins cleanly.
  if p_dry_run then perform pg_advisory_xact_lock_shared(hashtextextended('capture-fence:' || v_org::text,0));
  else perform pg_advisory_xact_lock(hashtextextended('capture-fence:' || v_org::text,0)); end if;
  perform 1 from public.profiles p join auth.users u on u.id = p.id
   where p.id = v_actor and p.org_id = v_org and p.status = 'active' and p.role::text = 'Admin' and (u.banned_until is null or u.banned_until <= now()) for share of p, u;
  if not found then raise exception 'Only an active Admin can place invoices.' using errcode = '42501'; end if;
  select count(*), (array_agg(id))[1] into v_count, v_binding from public.external_org_bindings
   where org_id = v_org and status = 'active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('complete',false,'reason','binding_unavailable','results','[]'::jsonb,'erp_write',false); end if;
  -- An apply serializes with capture under the organization fence, then checks the reviewed revision and the feed once for the whole
  -- batch (a row's own change to the revision does not stale its siblings). A batch made only of retries needs neither.
  v_revision := public.capture_revision(v_org);
  if not p_dry_run and exists (select 1 from jsonb_array_elements(v_norm) r
       where not exists (select 1 from public.erp_capture_invoice_assignments a where a.org_id = v_org and a.request_id = (r->>'request_id')::uuid)  -- 0903
         and not exists (select 1 from public.erp_purchase_captures c where c.org_id = v_org and c.request_id = md5((r->>'request_id') || ':family')::uuid)) then  -- 0903
    if v_revision is distinct from p_expected_revision then
      return jsonb_build_object('complete',false,'reason','source_stale','results','[]'::jsonb,'erp_write',false);
    end if;
    if coalesce((public.purchase_capture_feed_health()->>'caught_up')::boolean,false) is not true then
      return jsonb_build_object('complete',false,'reason','feed_not_current','results','[]'::jsonb,'erp_write',false);
    end if;
    if nullif(public.purchase_capture_feed_health()->>'ledger_currency','') is null then
      return jsonb_build_object('complete',false,'reason','ledger_currency_unknown','results','[]'::jsonb,'erp_write',false);
    end if;
  end if;
  -- Rows run in source order so concurrent batches take their locks in one order.
  v_batch := public.capture_assignment_batch(v_org, array(select (r->>'source_id')::uuid from jsonb_array_elements(v_norm) r  -- 0903
    union all select (i#>>'{}')::uuid from jsonb_array_elements(v_norm) r cross join lateral jsonb_array_elements(coalesce(r->'invoice_ids','[]'::jsonb)) i));  -- 0903
  for v_item in select r.value as r from jsonb_array_elements(v_norm) r order by r.value->>'source_id' loop
    v_results := v_results || jsonb_build_array(case when v_item.r->>'decision' = 'order_family'  -- 0903
      then public.capture_assignment_family(v_org,v_binding,v_actor,v_item.r,p_expected_revision,p_dry_run,v_batch)  -- 0903
      else public.capture_assignment_row(v_org,v_binding,v_actor,v_item.r,p_expected_revision,p_dry_run,v_batch) end || jsonb_build_object('index',(v_item.r->>'i')::integer));  -- 0903
  end loop;
  select coalesce(jsonb_agg(r order by (r->>'index')::integer),'[]'::jsonb) into v_results from jsonb_array_elements(v_results) r;
  return jsonb_build_object('complete',true,'dry_run',p_dry_run,'revision',v_revision,'results',v_results,'erp_write',false);
end $$;

-- §5 The capture report (0882's body, plus the line marked 0903) names each decision's family request and order.
create or replace function public.purchase_capture_assignment_report(p_project_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id();
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read purchase history.' using errcode = '42501';
  end if;
  return jsonb_build_object('assignments', coalesce((
    with placed as materialized (
      select g.gl_id, g.project_id, g.amount, m.voucher_type, m.voucher_no, m.company
        from public.capture_assigned_gl(v_org, null) g join public.erp_gl_entry_mirror m on m.id = g.gl_id and m.org_id = v_org)
    select jsonb_agg(jsonb_build_object(
      'decision_id', a.id, 'source_id', a.source_document_id, 'source', a.source_voucher_no, 'decision', a.decision, 'project_id', a.project_id,
      'procurement_id', a.procurement_id, 'assignment_origin', 'pmo_assignment',
      'family_request_id', a.family_request_id, 'family_order_id', a.family_order_document_id,  -- 0903
      'tagged_in_erp', t.tagged, 'erp_project_id', t.project_id, 'erp_tag_unmapped', t.tagged and t.project_id is null,
      'placed', (select coalesce(sum(g.amount),0)::text from placed g
                  where g.project_id = a.project_id and g.voucher_type = a.source_voucher_type and g.voucher_no = a.source_voucher_no
                    and g.company is not distinct from a.source_company),
      'excluded', case when a.decision <> 'project' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('account', m.account, 'amount', (coalesce(m.debit,0) - coalesce(m.credit,0))::text,
                                                               'kind', case c.root_type when 'Asset' then 'capital' else 'unmapped_expense' end) order by m.account, m.id)
                  from public.erp_gl_entry_mirror m
                  join public.erp_account_mirror c on c.org_id = m.org_id and c.company = m.company and c.erp_name = m.account and not c.is_group
                 where m.org_id = v_org and m.voucher_type = a.source_voucher_type and m.voucher_no = a.source_voucher_no
                   and m.company is not distinct from a.source_company and not m.is_cancelled and coalesce(m.debit,0) - coalesce(m.credit,0) > 0
                   and c.root_type in ('Asset','Expense') and not t.tagged
                   and not exists (select 1 from placed g where g.gl_id = m.id)), '[]'::jsonb) end
    ) order by a.created_at, a.id)
    from public.erp_capture_invoice_assignments a
    cross join lateral (
      -- the ERP project on the invoice's current ledger rows; resolved to a PMO project only when the binding's map names exactly one
      select count(*) > 0 as tagged,
             case when count(distinct g.project) = 1 then (select case when count(distinct e.key) = 1 then min(e.key)::uuid end
                      from public.external_org_bindings b cross join lateral jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) e
                     where b.id = a.binding_id and b.org_id = a.org_id and e.value = min(g.project)
                       and e.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') end as project_id
        from public.erp_gl_entry_mirror g
       where g.org_id = a.org_id and g.voucher_type = a.source_voucher_type and g.voucher_no = a.source_voucher_no
         and g.company is not distinct from a.source_company and not g.is_cancelled and coalesce(g.project, '') <> '') t
   where a.org_id = v_org and a.undone_at is null and (p_project_id is null or a.project_id = p_project_id)), '[]'::jsonb));
end $$;

-- §6 Undo (0882's body, plus the lines marked 0903). Without an attachment named, every active decision on the purchase is undone and the purchase
-- is cancelled. With one named, only that attachment's decisions and links go, its stage (and, with no invoice left, its status) comes back,
-- and the purchase and its order stay. One function, so the API sees one signature; the command line calls it by named arguments.
drop function public.undo_captured_purchase(uuid,text,boolean);
create function public.undo_captured_purchase(p_procurement_id uuid,p_reason text,p_dry_run boolean default false,p_attach_request_id uuid default null)  -- 0903
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_kind text; v_proc public.procurements%rowtype; v_history jsonb;
  v_asg public.erp_capture_invoice_assignments%rowtype; v_mark public.erp_purchase_document_marks%rowtype; v_has_mark boolean; v_restored boolean := false; v_before jsonb;
  v_capture public.erp_purchase_captures%rowtype; v_ids uuid[] := '{}'; v_sources uuid[]; v_after jsonb := '[]'::jsonb; v_stage text; v_commitment numeric;  -- 0903
begin
  -- A purchase may now hold several capture rows (an order, then the invoices attached to it).  -- 0903
  select case when bool_or(kind='journal') then 'journal' else min(kind) end into v_kind from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id;  -- 0903
  if v_kind is null or v_kind='journal' then
    if p_attach_request_id is not null then raise exception 'attachment_not_found' using errcode='P0002'; end if;  -- 0903
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
  if p_attach_request_id is not null then  -- one attachment: its own capture row names the invoices it linked  -- 0903
    select * into v_capture from public.erp_purchase_captures where org_id=v_org and procurement_id=p_procurement_id  -- 0903
       and request_id=md5(p_attach_request_id::text || ':family')::uuid and payload->>'mode'='attach';  -- 0903
    if not found then raise exception 'attachment_not_found' using errcode='P0002'; end if;  -- 0903
    if v_capture.undone_at is not null then return jsonb_build_object('outcome','skip','reason','already_undone'); end if;  -- 0903
    v_sources := array(select (s#>>'{}')::uuid from jsonb_array_elements(v_capture.payload->'source_ids') s);  -- 0903
  end if;  -- 0903
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
  -- Every active decision on the purchase (or on the one attachment); every mark is checked before any is restored.  -- 0903
  for v_asg in select * from public.erp_capture_invoice_assignments  -- 0903
   where org_id=v_org and procurement_id=p_procurement_id and decision='project' and undone_at is null  -- 0903
     and (p_attach_request_id is null or family_request_id=p_attach_request_id) order by source_document_id for update loop  -- 0903
    select * into v_mark from public.erp_purchase_document_marks where erp_purchase_document_id=v_asg.source_document_id for update;
    v_has_mark := found;
    -- What the placement left behind: no mark if there was none (or it held only the set-aside), else the prior note with the set-aside cleared.
    if v_has_mark is distinct from (v_asg.prior_mark_present and not (v_asg.prior_mark_set_aside_at is not null and v_asg.prior_mark_note is null))
       or (v_has_mark and (v_mark.set_aside_at is not null or v_mark.set_aside_by is not null or v_mark.note is distinct from v_asg.prior_mark_note)) then
      raise exception 'assignment_mark_changed' using errcode='55000';
    end if;
    v_ids := v_ids || v_asg.id;  -- 0903
  end loop;  -- 0903
  if not p_dry_run then
    if cardinality(v_ids) > 0 then  -- 0903
      -- What the decisions place now, read before they are deactivated; each returns to the placement recorded when it was made.  -- 0903
      select jsonb_build_array(jsonb_build_object('project_id',v_proc.project_id,'amount',coalesce(sum(g.amount),0))) into v_before  -- 0903
        from public.capture_assigned_gl(v_org,v_proc.project_id) g join public.erp_gl_entry_mirror m on m.id = g.gl_id and m.org_id = v_org  -- 0903
       where exists (select 1 from public.erp_capture_invoice_assignments a where a.id = any(v_ids) and m.voucher_type = a.source_voucher_type  -- 0903
                       and m.voucher_no = a.source_voucher_no and m.company is not distinct from a.source_company);  -- 0903
      for v_asg in select * from public.erp_capture_invoice_assignments where id = any(v_ids) order by source_document_id loop  -- 0903
      if v_asg.prior_mark_present then
        insert into public.erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at,set_aside_by,note,updated_at,updated_by)
          values (v_asg.source_document_id,v_org,v_asg.prior_mark_set_aside_at,v_asg.prior_mark_set_aside_by,v_asg.prior_mark_note,v_asg.prior_mark_updated_at,v_asg.prior_mark_updated_by)
          on conflict (erp_purchase_document_id) do update set set_aside_at=excluded.set_aside_at,set_aside_by=excluded.set_aside_by,note=excluded.note,
            updated_at=excluded.updated_at,updated_by=excluded.updated_by;
        v_restored := true;
      end if;
      update public.erp_capture_invoice_assignments set undone_at=now(),undone_by=auth.uid(),undone_reason=p_reason where id=v_asg.id;
      v_after := v_after || coalesce(v_asg.prior_placement,'[]'::jsonb);  -- 0903
      end loop;  -- 0903
    end if;
    if p_attach_request_id is not null then  -- one attachment: its links, decisions and capture row go; the purchase and its order stay  -- 0903
      update public.procurement_documents set record_kind=null,record_id=null  -- 0903
        where procurement_id=p_procurement_id and record_kind='erp_document' and record_id=any(v_sources);  -- 0903
      delete from public.procurement_erp_links where org_id=v_org and procurement_id=p_procurement_id and erp_purchase_document_id=any(v_sources);  -- 0903
      update public.erp_purchase_captures set undone_at=now(),undo_reason=p_reason where org_id=v_org and request_id=v_capture.request_id;  -- 0903
      -- The stage follows the invoices still linked (FR-011); with none left it, and the status, return to what they were before the attachment.  -- 0903
      select case when count(*) = 0 then null when bool_and(d.erp_status='Paid') then 'paid' when bool_or(d.erp_status in ('Paid','Partly Paid')) then 'part_paid' else 'invoiced' end  -- 0903
        into v_stage from public.procurement_erp_links l join public.erp_purchase_documents d on d.id=l.erp_purchase_document_id  -- 0903
       where l.org_id=v_org and l.procurement_id=p_procurement_id and d.erp_doctype='Purchase Invoice' and d.erp_docstatus=1;  -- 0903
      -- A record-only purchase is source-locked, so the flag is lowered for the change and raised again, as the capture's own attach does (0866).  -- 0903
      update public.procurements set record_only=false where id=p_procurement_id;  -- 0903
      if v_stage is null and v_capture.payload->>'prior_status' is not null and v_proc.status::text <> v_capture.payload->>'prior_status' then  -- 0903
        update public.procurements set status=(v_capture.payload->>'prior_status')::public.procurement_status,  -- 0903
               vendor_invoiced_at=nullif(v_capture.payload->>'prior_vendor_invoiced_at','')::timestamptz,updated_at=now() where id=p_procurement_id;  -- 0903
        insert into public.procurement_status_events(procurement_id,org_id,from_status,to_status,actor_id,notes)  -- 0903
          values (p_procurement_id,v_org,v_proc.status,(v_capture.payload->>'prior_status')::public.procurement_status,auth.uid(),'Derived: ERP invoices detached: '||p_reason);  -- 0903
      end if;  -- 0903
      update public.procurements set record_only=true,record_only_stage=coalesce(v_stage,v_capture.payload->>'prior_stage'),updated_at=now() where id=p_procurement_id;  -- 0903
      v_commitment := coalesce((select c.amount from public.procurement_open_commitments(array[p_procurement_id]) c),0);  -- 0903
      perform public.log_audit('procurement.erp_family_attach_undo',v_org,auth.uid(),p_procurement_id,  -- 0903
        jsonb_build_object('project_id',v_proc.project_id,'family_request_id',p_attach_request_id,'sources',to_jsonb(v_sources),'reason',p_reason,  -- 0903
          'decision_ids',to_jsonb(v_ids),'mark_restored',v_restored,'placement_before',coalesce(v_before,'[]'::jsonb),'placement_after',v_after,  -- 0903
          'commitment_after',v_commitment,'assignment_origin','pmo_assignment','erp_write',false));  -- 0903
      return jsonb_build_object('outcome','undo','dry_run',false,'procurement_id',p_procurement_id,'attach_request_id',p_attach_request_id,'erp_write',false);  -- 0903
    end if;  -- 0903
    update public.procurement_documents set record_kind=null,record_id=null
      where procurement_id=p_procurement_id and record_kind='erp_document';
    delete from public.procurement_erp_links where org_id=v_org and procurement_id=p_procurement_id;
    update public.erp_purchase_captures set undone_at=now(),undo_reason=p_reason where org_id=v_org and procurement_id=p_procurement_id and undone_at is null;  -- 0903
    update public.procurements set status='Cancelled',updated_at=now() where id=p_procurement_id;
    perform public.log_audit('procurement.record_only_undo',v_org,auth.uid(),p_procurement_id,
      jsonb_build_object('project_id',v_proc.project_id,'vendor_id',v_proc.vendor_id,'sources',v_history,
        'reason',p_reason,'assignment_origin',case when cardinality(v_ids) > 0 then 'pmo_assignment' else 'erp_project' end)  -- 0903
      || case when cardinality(v_ids) > 0 then jsonb_build_object('decision_id',v_ids[1],'decision_ids',to_jsonb(v_ids),'mark_restored',v_restored,'placement_before',v_before,'placement_after',v_after)  -- 0903
              else jsonb_build_object('actuals_delta',0) end);
  end if;
  return jsonb_build_object('outcome','undo','dry_run',p_dry_run,'procurement_id',p_procurement_id,'erp_write',false)  -- 0903
    || case when p_attach_request_id is not null then jsonb_build_object('attach_request_id',p_attach_request_id) else '{}'::jsonb end;  -- 0903
end $$;
revoke all on function public.undo_captured_purchase(uuid,text,boolean,uuid) from public, anon;
grant execute on function public.undo_captured_purchase(uuid,text,boolean,uuid) to authenticated;
