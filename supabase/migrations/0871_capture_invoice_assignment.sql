-- 0871 #2195 B1: an active Admin places ERP invoices that carry no ERP project, or sets them aside as overhead.
-- This step holds the persisted decision, the Admin-only entry point and the once-per-source claim. Nothing here
-- writes to the ERP. Rollback arrives with the undo work: supabase/migrations/rollback/0871_capture_invoice_assignment_down.sql

-- §1 One row per decision. The row is the audit record: only its undo columns ever change.
create table public.erp_capture_invoice_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  binding_id uuid not null references public.external_org_bindings(id),
  source_document_id uuid not null references public.erp_purchase_documents(id),
  request_id uuid not null,
  payload_digest text not null,
  decision text not null check (decision in ('project','set_aside')),
  project_id uuid references public.projects(id),
  procurement_id uuid references public.procurements(id),
  accept_set_aside boolean not null default false,
  allow_capital_as_overhead boolean not null default false,
  original_classification text,
  prior_mark_present boolean not null default false,
  prior_mark_set_aside_at timestamptz,
  prior_mark_set_aside_by uuid references public.profiles(id),
  prior_mark_note text,
  prior_mark_updated_at timestamptz,
  prior_mark_updated_by uuid references public.profiles(id),
  source_revision text,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles(id),
  undone_reason text,
  constraint erp_capture_invoice_assignments_request_key unique (org_id, request_id),
  constraint erp_capture_invoice_assignments_project_shape check ((decision = 'project') = (project_id is not null)),
  constraint erp_capture_invoice_assignments_undo_reason check ((undone_at is null) = (undone_reason is null))
);
-- Two active decisions for one source cannot exist; a new request is possible only after the earlier one is undone.
create unique index erp_capture_assignment_active_source_idx
  on public.erp_capture_invoice_assignments (org_id, binding_id, source_document_id) where undone_at is null;
create index erp_capture_assignment_active_project_idx
  on public.erp_capture_invoice_assignments (org_id, project_id, source_document_id) where undone_at is null and decision = 'project';

create function public.guard_capture_assignment_update() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  -- procurement_id and original_classification are set once, after validation; every other column is fixed at insert.
  if (to_jsonb(new) - 'undone_at' - 'undone_by' - 'undone_reason' - 'procurement_id' - 'original_classification')
       is distinct from (to_jsonb(old) - 'undone_at' - 'undone_by' - 'undone_reason' - 'procurement_id' - 'original_classification')
     or (old.procurement_id is not null and new.procurement_id is distinct from old.procurement_id)
     or (old.original_classification is not null and new.original_classification is distinct from old.original_classification) then
    raise exception 'assignment_decision_immutable' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger erp_capture_invoice_assignments_immutable before update on public.erp_capture_invoice_assignments
  for each row execute function public.guard_capture_assignment_update();

alter table public.erp_capture_invoice_assignments enable row level security;
alter table public.erp_capture_invoice_assignments force row level security;
create policy erp_capture_invoice_assignments_select on public.erp_capture_invoice_assignments for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.erp_capture_invoice_assignments from public, anon, authenticated, service_role;
grant select on public.erp_capture_invoice_assignments to authenticated;

-- §2 The claim: one row's decision, once. Internal: no API role may execute it; the public RPC calls it as owner.
-- p_row is already validated and normalised by the caller. A dry run reads and reports; it takes no lock and writes nothing.
create function public.capture_assignment_claim(p_org uuid, p_binding uuid, p_actor uuid, p_row jsonb, p_revision text, p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_request uuid := (p_row->>'request_id')::uuid;
  v_source uuid := (p_row->>'source_id')::uuid;
  v_decision text := p_row->>'decision';
  v_project uuid := nullif(p_row->>'project_id','')::uuid;
  v_accept boolean := coalesce((p_row->>'accept_set_aside')::boolean,false);
  v_capital boolean := coalesce((p_row->>'allow_capital_as_overhead')::boolean,false);
  v_digest text; v_base jsonb; v_existing public.erp_capture_invoice_assignments%rowtype; v_id uuid; v_mark public.erp_purchase_document_marks%rowtype; v_marked boolean;
begin
  v_digest := encode(extensions.digest(convert_to(jsonb_build_object('decision',v_decision,'source_id',v_source,'project_id',v_project,
    'accept_set_aside',v_accept,'allow_capital_as_overhead',v_capital)::text,'UTF8'),'sha256'),'hex');
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
    perform 1 from public.erp_purchase_documents where org_id = p_org and id = v_source;
  else
    perform 1 from public.erp_purchase_documents where org_id = p_org and id = v_source for update;
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
  begin
    insert into public.erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,
      accept_set_aside,allow_capital_as_overhead,source_revision,actor_id,
      prior_mark_present,prior_mark_set_aside_at,prior_mark_set_aside_by,prior_mark_note,prior_mark_updated_at,prior_mark_updated_by)
    values (p_org,p_binding,v_source,v_request,v_digest,v_decision,v_project,v_accept,v_capital,p_revision,p_actor,
      v_marked,v_mark.set_aside_at,v_mark.set_aside_by,v_mark.note,v_mark.updated_at,v_mark.updated_by) returning id into v_id;
  exception when unique_violation then
    return v_base || jsonb_build_object('outcome','refused','reason','source_already_decided');
  end;
  return v_base || jsonb_build_object('outcome','recorded','decision_id',v_id);
end $$;
revoke execute on function public.capture_assignment_claim(uuid,uuid,uuid,jsonb,text,boolean) from public, anon, authenticated, service_role;


-- §2b The linker of 0380, unchanged but for one exception (marked 0871): the document-has-no-project refusal does not apply to an
-- invoice an active Admin assignment places on the purchase's own project. Every other refusal still applies to every caller.
create or replace function public.link_erp_purchase_documents(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_results jsonb := '[]'::jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_created uuid[] := '{}';
  v_row jsonb; v_n integer := 0; v_matches integer;
  v_doc public.erp_purchase_documents%rowtype;
  v_proc public.procurements%rowtype;
  v_existing uuid; v_target uuid; v_project uuid; v_vendor uuid;
  v_group_key text; v_outcome text; v_reason text; v_gate text; v_vendor_name text;
  v_step public.procurement_status; v_sp jsonb; v_new boolean;
  v_orders text[]; v_sp_ok boolean; v_before numeric;                                                      -- 0372
  v_vendor_suppliers text[];                                                                               -- 0380
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Only Admin, Executive, Project Manager or Finance members can link ERP documents.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Send 1 to 500 rows per call.' using errcode = '22023';
  end if;

  begin  -- the batch; a dry run is rolled back at the end of this block (FR-PFE-030)
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_n := v_n + 1;
      v_outcome := 'link'; v_reason := null; v_target := null; v_new := false; v_doc := null; v_proc := null;
      begin  -- one row: a refusal rolls back this row only
        if jsonb_typeof(v_row) <> 'object' or coalesce(btrim(v_row->>'erp_name'), '') = '' then
          raise exception using errcode = 'PFE02', message = 'erp_name_missing';
        end if;
        select count(*) into v_matches from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'));
        if v_matches = 0 then raise exception using errcode = 'PFE02', message = 'document_not_found'; end if;
        if v_matches > 1 then raise exception using errcode = 'PFE02', message = 'document_ambiguous'; end if;
        -- 0372: an order and the invoices billing it are linked one at a time — the lock on the ERP order name(s) is
        -- taken before the document and the purchase are locked, so the order/invoice checks below see any link of
        -- the same order another call has committed. Lock order: order names (sorted), document, purchase.
        select * into v_doc from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'));
        v_orders := public.erp_order_family(v_doc.erp_doctype, v_doc.erp_name, v_doc.purchase_orders);           -- 0372
        perform public.lock_erp_order_family(v_org, v_orders);                                                   -- 0372
        select * into v_doc from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'))
         for update;
        -- 0372: the mirror may have changed the orders an invoice bills in between; lock any new one too.
        perform public.lock_erp_order_family(v_org, array(
          select unnest(public.erp_order_family(v_doc.erp_doctype, v_doc.erp_name, v_doc.purchase_orders))
          except select unnest(v_orders)));
        if v_doc.erp_docstatus <> 1 then raise exception using errcode = 'PFE02', message = 'document_cancelled'; end if;
        -- 0378: recorded by PMO = a procurement reference to a live PMO record of this document's kind, read now (M-2:
        -- the mirror's pmo_owned stamp may predate a push or outlive the record).
        if public.erp_document_recorded_by_pmo(v_org, v_doc.erp_doctype, v_doc.erp_name) then
          raise exception using errcode = 'PFE02', message = 'document_recorded_by_pmo';
        end if;
        -- M-6: returns / debit notes are not linked.
        if v_doc.is_return then raise exception using errcode = 'PFE02', message = 'document_is_return'; end if;
        -- 0372: an invoice recorded against several projects in ERPNext is not linked into one purchase: the purchase
        -- would deduct the whole invoice while each project's actuals carry only its share. Link it per project from
        -- ERPNext, or record it in PMO.
        if v_doc.erp_doctype = 'Purchase Invoice' and cardinality(v_doc.project_ids) > 1 then
          raise exception using errcode = 'PFE02', message = 'document_spans_projects';
        end if;
        -- 0372: a SharePoint file sent with the link must be on the organisation's own SharePoint host (the rule
        -- link_procurement_sharepoint_item and link_m365_documents_batch apply).
        v_sp := v_row -> 'sharepoint';
        if v_sp is not null and jsonb_typeof(v_sp) = 'object' then
          begin
            v_sp_ok := public.sharepoint_url_on_org_host(v_org, v_sp->>'web_url');
          exception when invalid_parameter_value then
            raise exception using errcode = 'PFE02', message = 'm365_not_configured';
          end;
          if not v_sp_ok then raise exception using errcode = 'PFE02', message = 'sharepoint_host_not_allowed'; end if;
        end if;

        v_target  := nullif(btrim(v_row->>'procurement_id'), '')::uuid;
        v_project := nullif(btrim(v_row->>'project_id'), '')::uuid;
        select l.procurement_id into v_existing from public.procurement_erp_links l where l.erp_purchase_document_id = v_doc.id;
        if found then
          if v_target is null or v_target = v_existing then
            -- FR-PFE-028 re-runs: a row that named no purchase re-joins its group's existing linked purchase,
            -- so a fixed sibling row in the same group links there instead of creating a second purchase.
            -- (Variables survive the PFE03 rollback below; only data changes are undone.)
            if v_target is null and exists (select 1 from public.procurements p
                                             where p.id = v_existing and p.origin = 'erp_link'
                                               and p.project_id is not distinct from v_project) then
              v_groups := v_groups || jsonb_build_object(
                coalesce(v_project::text, '-') || '|' || coalesce(nullif(btrim(v_row->>'group'), ''), v_doc.erp_name), v_existing);
            end if;
            v_target := v_existing; v_reason := 'already_linked';
            raise exception using errcode = 'PFE03', message = 'skip';
          end if;
          raise exception using errcode = 'PFE02', message = 'document_linked_to_another_purchase';
        end if;

        if v_target is null then
          if v_project is not null and not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
            raise exception using errcode = 'PFE02', message = 'project_not_found';
          end if;
          v_group_key := coalesce(v_project::text, '-') || '|' || coalesce(nullif(btrim(v_row->>'group'), ''), v_doc.erp_name);
          v_target := (v_groups ->> v_group_key)::uuid;
          if v_target is null then
            v_vendor := public.erp_supplier_company(v_org, v_doc.supplier, v_doc.supplier_name);                   -- 0369
            insert into public.procurements (org_id, code, title, requested_by_id, project_id, vendor_id, budget_category, currency, total_value, origin)
            values (v_org, public.next_procurement_doc_number(v_org, 'PROC'),                                      -- 0369
                    coalesce(nullif(btrim(v_row->>'title'), ''), concat_ws(' ', coalesce(v_doc.supplier_name, v_doc.supplier), v_doc.erp_name)),
                    v_uid, v_project, v_vendor, nullif(btrim(v_row->>'budget_category'), '')::public.budget_category,
                    v_doc.currency, 0, 'erp_link')
            returning id into v_target;
            v_new := true;
          end if;
        end if;

        select * into v_proc from public.procurements where id = v_target for update;
        if not found or v_proc.org_id is distinct from v_org then raise exception using errcode = 'PFE02', message = 'purchase_not_found'; end if;
        if v_proc.status::text in ('Cancelled','Rejected') then raise exception using errcode = 'PFE02', message = 'purchase_closed'; end if;
        if v_doc.currency is distinct from v_proc.currency then raise exception using errcode = 'PFE02', message = 'currency_mismatch'; end if;
        if cardinality(v_doc.project_ids) > 0
           and (v_proc.project_id is null or not (v_proc.project_id = any (v_doc.project_ids))) then
          raise exception using errcode = 'PFE02', message = 'project_mismatch';
        end if;
        -- I-3: an invoice with no project in ERPNext would lower this project's commitment while its actuals miss it.
        -- 0871: except the invoice an active Admin assignment (written only by assign_capture_invoices) places on this very project.
        if v_doc.erp_doctype = 'Purchase Invoice' and cardinality(v_doc.project_ids) = 0 and v_proc.project_id is not null
           and not exists (select 1 from public.erp_capture_invoice_assignments a
                            where a.org_id = v_org and a.source_document_id = v_doc.id and a.decision = 'project'
                              and a.undone_at is null and a.project_id = v_proc.project_id) then
          raise exception using errcode = 'PFE02', message = 'document_has_no_project';
        end if;
        if exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = v_proc.id and d.supplier is distinct from v_doc.supplier) then
          raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
        end if;
        if v_proc.vendor_id is not null then
          v_vendor_name := null;
          -- 0380: the vendor's ERPNext supplier ids: 'Supplier:<id>' references with the prefix removed, plus a legacy bare
          -- reference; a 'Customer:' reference (a party that is also a customer), or any other doctype's, is not one.
          select array_agg(case when x.external_record_id like 'Supplier:%' then substr(x.external_record_id, 10)
                                else x.external_record_id end)
            into v_vendor_suppliers from public.external_refs x
           where x.org_id = v_org and x.domain = 'companies' and x.external_tier = 'erpnext' and x.pmo_record_id = v_proc.vendor_id::text
             and x.external_record_id !~ '^(Customer|Contact|Employee):';
          if cardinality(v_vendor_suppliers) > 0 then                                                              -- 0380
            if v_doc.supplier is null or not (v_doc.supplier = any (v_vendor_suppliers)) then                      -- 0380
              raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
            end if;
          else
            select c.name into v_vendor_name from public.companies c where c.id = v_proc.vendor_id;
            if lower(btrim(coalesce(v_vendor_name, ''))) is distinct from lower(btrim(coalesce(v_doc.supplier_name, v_doc.supplier, '')))
               and not exists (select 1 from public.companies c where c.id = v_proc.vendor_id and c.org_id = v_org and c.erp_supplier_name = v_doc.supplier) then  -- 0369
              raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
            end if;
          end if;
        end if;
        -- I-2: an invoice and the ERP order it bills sit in one purchase (else the order stays committed in
        -- one purchase while the ledger holds its invoice under another — a double count).
        if v_doc.erp_doctype = 'Purchase Invoice' and exists (
             select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
              where d.org_id = v_org and d.erp_doctype = 'Purchase Order' and d.erp_name = any (v_doc.purchase_orders)
                and l.procurement_id <> v_proc.id) then
          raise exception using errcode = 'PFE02', message = 'order_linked_to_another_purchase';
        end if;
        if v_doc.erp_doctype = 'Purchase Order' and exists (
             select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
              where d.org_id = v_org and d.erp_doctype = 'Purchase Invoice' and v_doc.erp_name = any (d.purchase_orders)
                and l.procurement_id <> v_proc.id) then
          raise exception using errcode = 'PFE02', message = 'invoice_linked_to_another_purchase';
        end if;
        v_step := case v_doc.erp_doctype when 'Purchase Order' then 'Ordered' when 'Purchase Receipt' then 'Received'
                    when 'Purchase Invoice' then 'Vendor Invoiced' else 'Paid' end;
        v_gate := public.procurement_gate_violation(v_proc.id, v_step);
        if v_gate is not null then raise exception using errcode = 'PFE02', message = v_gate; end if;

        v_before := public.erp_linked_documents_total(v_proc.id);                                                -- 0372
        insert into public.procurement_erp_links (org_id, procurement_id, erp_purchase_document_id, linked_by)
        values (v_org, v_proc.id, v_doc.id, v_uid);
        -- FR-PFE-016 approver ≠ payer on the link path. Checked here, not left to the update guard: at 0361
        -- that guard only covers amount_approved_by_id (0362 widens it); the check stays as defence in depth.
        if v_proc.status::text <> 'Paid' and public.procurement_evidenced_step(v_proc.id) = 'Paid'
           and v_uid is not null and (v_uid = v_proc.approved_by_id or v_uid = v_proc.amount_approved_by_id) then
          raise exception using errcode = 'PFE02', message = 'separation_of_duties';
        end if;
        if v_proc.vendor_id is null then
          update public.procurements p set vendor_id = x.pmo_record_id::uuid
            from (select pmo_record_id from public.external_refs
                   where org_id = v_org and domain = 'companies' and external_tier = 'erpnext'
                     and external_record_id in ('Supplier:' || v_doc.supplier, v_doc.supplier)                          -- 0380
                     and pmo_record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                   order by created_at limit 1) x
           where p.id = v_proc.id and p.vendor_id is null;
        end if;
        if v_proc.origin = 'erp_link' then perform public.refresh_erp_linked_purchase_total(v_proc.id);
        else perform public.refresh_native_purchase_total_from_links(v_proc.id, v_before);                       -- 0372
        end if;
        perform public.advance_procurement_status(v_proc.id, 'Derived: linked ERPNext ' || v_doc.erp_doctype || ' ' || v_doc.erp_name);
        if v_sp is not null and jsonb_typeof(v_sp) = 'object' then                                              -- 0372: checked above
          insert into public.procurement_documents (org_id, procurement_id, type, link, source, ms_drive_id, ms_item_id, ms_item_name, ms_item_kind, record_kind, record_id)
          values (v_org, v_proc.id, 'Microsoft reference', v_sp->>'web_url', 'onedrive', v_sp->>'drive_id', v_sp->>'item_id',
                  v_sp->>'name', v_sp->>'kind', 'erp_document', v_doc.id);
        end if;
        perform public.log_audit('procurement.erp_link', v_org, v_uid, v_proc.id,
          jsonb_build_object('erp_doctype', v_doc.erp_doctype, 'erp_name', v_doc.erp_name, 'new_purchase', v_new));
        if v_new then
          v_groups := v_groups || jsonb_build_object(v_group_key, v_proc.id);
          v_created := v_created || v_proc.id;
        end if;
      exception
        when sqlstate 'PFE03' then v_outcome := 'skip';
        when sqlstate 'PFE02' then v_outcome := 'refused'; v_reason := sqlerrm; v_target := null;
        when invalid_text_representation then v_outcome := 'refused'; v_reason := 'invalid_id'; v_target := null;
        -- M-6: reasons are codes; raw error text never leaves the function (it goes to the server log).
        when insufficient_privilege then v_outcome := 'refused'; v_target := null;
          v_reason := case when sqlerrm like 'separation of duties%' then 'separation_of_duties' else 'not_permitted' end;
        when check_violation then v_outcome := 'refused'; v_target := null;
          v_reason := case when sqlerrm like 'Cannot pay without a recorded approved amount%' then 'approval_missing'
                           when sqlerrm like 'This purchase is awaiting approval%' then 'awaiting_approval'  -- 0362 (Requested never derives)
                           when sqlerrm like 'Vendor bill exceeds the approved amount%' then 'exceeds_approved_amount'
                           else 'rule_violation' end;
          raise log 'link_erp_purchase_documents row %: % %', v_n, sqlstate, sqlerrm;
        when others then v_outcome := 'refused'; v_target := null; v_reason := 'internal_error';
          raise log 'link_erp_purchase_documents row %: % %', v_n, sqlstate, sqlerrm;
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_n, 'erp_doctype', v_doc.erp_doctype, 'erp_name', coalesce(v_doc.erp_name, v_row->>'erp_name'),
        'outcome', v_outcome, 'reason', v_reason,
        'procurement_id', case when p_dry_run and v_target = any (v_created) then null else v_target end,
        'new_purchase', coalesce(v_target = any (v_created), false)));
    end loop;
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
  exception when sqlstate 'PFE01' then null;
  end;
  return jsonb_build_object(
    'dry_run', p_dry_run,
    'counts', jsonb_build_object(
      'link',    (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'link'),
      'skip',    (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'skip'),
      'refused', (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'refused')),
    'results', v_results);
end $$;

-- §2c What the ledger and the document say about one source, for one decision. Internal (invoker, run as owner by its callers).
-- Capital = unmapped asset lines; only mapped expense lines count as project cost; a line whose account has no chart evidence stops the row.
create function public.capture_assignment_validate(p_org uuid, p_binding uuid, p_row jsonb, p_decision_id uuid)
returns jsonb language plpgsql stable set search_path = public, pg_catalog as $$
declare
  v_doc public.erp_purchase_documents%rowtype; v_company text; v_decision text := p_row->>'decision';
  v_total integer; v_foreign integer; v_tagged integer; v_unknown integer; v_mapped numeric; v_capital numeric; v_other numeric; v_excluded jsonb;
  v_state text; v_class text; v_vendors integer; v_mark public.erp_purchase_document_marks%rowtype; v_warnings jsonb := '[]'::jsonb;
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
  if cardinality(v_doc.purchase_orders) > 0 then return jsonb_build_object('ok',false,'reason','family_incomplete'); end if;
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
  if v_decision = 'project' then
    if v_class = 'capital' then return jsonb_build_object('ok',false,'reason','capital_spending_not_assignable','excluded',v_excluded); end if;
    if v_class = 'unmapped' or v_mapped <= 0 then return jsonb_build_object('ok',false,'reason','invoice_has_no_mapped_cost','excluded',v_excluded); end if;
    if v_state is null then return jsonb_build_object('ok',false,'reason','state_unknown'); end if;
    if v_mark.set_aside_at is not null and not coalesce((p_row->>'accept_set_aside')::boolean,false) then
      return jsonb_build_object('ok',false,'reason','set_aside_confirmation_required');
    end if;
  else
    if v_mark.set_aside_at is not null then return jsonb_build_object('ok',false,'reason','already_set_aside'); end if;
    if v_class = 'capital' and not coalesce((p_row->>'allow_capital_as_overhead')::boolean,false) then
      return jsonb_build_object('ok',false,'reason','capital_spending_requires_override','excluded',v_excluded);
    end if;
    -- An existing attribution rule keeps allocating an overhead invoice's ledger lines until it is changed on purpose.
    if exists (select 1 from public.cost_attribution_allocations(p_org) a
                where a.gl_id in (select g.id from public.erp_gl_entry_mirror g where g.org_id = p_org and g.voucher_type = v_doc.erp_doctype
                                    and g.voucher_no = v_doc.erp_name and not g.is_cancelled)) then
      v_warnings := v_warnings || to_jsonb('allocated_by_rule'::text);
    end if;
  end if;
  return jsonb_build_object('ok',true,'classification',v_class,'mapped_amount',v_mapped,'excluded',v_excluded,'state',v_state,'currency',v_doc.currency,'warnings',v_warnings);
end $$;
revoke execute on function public.capture_assignment_validate(uuid,uuid,jsonb,uuid) from public, anon, authenticated, service_role;

-- §2d One row, end to end: replay, decide, validate under the source lock, place. A dry run does all of it and rolls it back.
create function public.capture_assignment_row(p_org uuid, p_binding uuid, p_actor uuid, p_row jsonb, p_revision text, p_dry_run boolean)
returns jsonb language plpgsql set search_path = public, pg_catalog as $$
declare
  v_request uuid := (p_row->>'request_id')::uuid; v_source uuid := (p_row->>'source_id')::uuid;
  v_base jsonb := jsonb_build_object('request_id',(p_row->>'request_id')::uuid,'source_id',(p_row->>'source_id')::uuid,'erp_write',false);
  v_claim jsonb; v_val jsonb; v_reason text; v_id uuid; v_doc public.erp_purchase_documents%rowtype; v_result jsonb; v_purchase uuid;
begin
  -- A retry of a stored request returns its stored result; nothing is validated or written again.
  if exists (select 1 from public.erp_capture_invoice_assignments where org_id = p_org and request_id = v_request) then
    return public.capture_assignment_claim(p_org,p_binding,p_actor,p_row,p_revision,true);
  end if;
  begin
    v_claim := public.capture_assignment_claim(p_org,p_binding,p_actor,p_row,p_revision,false);
    if v_claim->>'outcome' <> 'recorded' then return v_claim; end if;
    v_id := (v_claim->>'decision_id')::uuid;
    v_val := public.capture_assignment_validate(p_org,p_binding,p_row,v_id);
    if not (v_val->>'ok')::boolean then v_reason := v_val->>'reason'; raise exception using errcode = 'PFE02', message = v_reason; end if;
    update public.erp_capture_invoice_assignments set original_classification = v_val->>'classification' where id = v_id;
    select * into v_doc from public.erp_purchase_documents where id = v_source and org_id = p_org;
    if p_row->>'decision' = 'set_aside' then
      -- A set-aside is only a mark and an audited decision: no project, wrapper, link or ERP write.
      insert into public.erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at,set_aside_by,note,updated_by)
        values (v_source,p_org,now(),p_actor,null,p_actor)
        on conflict (erp_purchase_document_id) do update set set_aside_at = now(), set_aside_by = p_actor, updated_at = now(), updated_by = p_actor;
      perform public.log_audit('procurement.erp_set_aside',p_org,p_actor,v_source,
        jsonb_build_object('erp_doctype',v_doc.erp_doctype,'erp_name',v_doc.erp_name,'decision_id',v_id,'original_classification',v_val->>'classification',
          'capital_override',coalesce((p_row->>'allow_capital_as_overhead')::boolean,false) and v_val->>'classification' = 'capital','erp_write',false));
    else
    v_result := public.link_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_name',v_doc.erp_name,'erp_doctype',v_doc.erp_doctype,
      'project_id',p_row->>'project_id','group',v_request::text)),false);
    if coalesce((v_result#>>'{counts,link}')::integer,0) <> 1 then
      v_reason := coalesce(v_result#>>'{results,0,reason}','already_linked'); raise exception using errcode = 'PFE02', message = v_reason;
    end if;
    v_purchase := (v_result#>>'{results,0,procurement_id}')::uuid;
    update public.procurements set record_only = true, record_only_stage = v_val->>'state' where id = v_purchase and org_id = p_org;
    insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
      values (p_org,p_binding,md5(v_request::text || ':assignment')::uuid,v_purchase,
        jsonb_build_object('project_id',p_row->>'project_id','source_ids',jsonb_build_array(v_source),'decision_id',v_id,'assignment_origin','pmo_assignment'),
        'supplier_invoice',v_val->>'state',p_actor);
    update public.erp_capture_invoice_assignments set procurement_id = v_purchase where id = v_id;
    perform public.log_audit('procurement.record_only_create',p_org,p_actor,v_purchase,
      jsonb_build_object('project_id',p_row->>'project_id','source_ids',jsonb_build_array(v_source),'decision_id',v_id,'assignment_origin','pmo_assignment',
        'mapped_amount',v_val->'mapped_amount','excluded',v_val->'excluded','erp_write',false));
    end if;
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
  exception
    when sqlstate 'PFE01' then v_purchase := null;
    when sqlstate 'PFE02' then return v_base || jsonb_build_object('outcome','refused','reason',v_reason);
  end;
  return v_base || jsonb_build_object('outcome','create','decision_id',case when p_dry_run then null else v_id end,'procurement_id',v_purchase,'would_create',p_dry_run,
    'decision',p_row->>'decision','warnings',v_val->'warnings','assignment_origin',case when p_row->>'decision' = 'project' then 'pmo_assignment' end,'mapped_amount',v_val->'mapped_amount','excluded',v_val->'excluded','classification',v_val->>'classification');
end $$;
revoke execute on function public.capture_assignment_row(uuid,uuid,uuid,jsonb,text,boolean) from public, anon, authenticated, service_role;

-- §3 The public entry. The actor and organization come from the session; a row may carry only the six keys below.
create function public.assign_capture_invoices(p_rows jsonb, p_expected_revision text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_binding uuid; v_count integer; v_row jsonb; v_norm jsonb := '[]'::jsonb; v_results jsonb := '[]'::jsonb; v_revision text;
  v_i integer; v_item record;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin'
     or exists (select 1 from auth.users u where u.id = v_actor and u.banned_until is not null and u.banned_until > now()) then
    raise exception 'Only an active Admin can place invoices.' using errcode = '42501';
  end if;
  if p_dry_run is null or nullif(btrim(p_expected_revision),'') is null
     or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'invalid_assignment_rows' using errcode = '22023';
  end if;
  for v_row, v_i in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_row) k where k not in ('request_id','source_id','decision','project_id','accept_set_aside','allow_capital_as_overhead'))
       or coalesce(v_row->>'request_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_row->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_row->>'decision' not in ('project','set_aside')
       or (v_row->>'decision' = 'project') is distinct from (coalesce(v_row->>'project_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       or (v_row ? 'project_id' and v_row->>'decision' = 'set_aside')
       or (v_row ? 'accept_set_aside' and jsonb_typeof(v_row->'accept_set_aside') <> 'boolean')
       or (v_row ? 'allow_capital_as_overhead' and jsonb_typeof(v_row->'allow_capital_as_overhead') <> 'boolean') then
      raise exception 'invalid_assignment_row' using errcode = '22023';
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('i',v_i,'request_id',lower(v_row->>'request_id'),'source_id',lower(v_row->>'source_id'),
      'decision',v_row->>'decision','project_id',lower(v_row->>'project_id'),
      'accept_set_aside',coalesce((v_row->>'accept_set_aside')::boolean,false),'allow_capital_as_overhead',coalesce((v_row->>'allow_capital_as_overhead')::boolean,false)));
  end loop;
  if (select count(distinct r->>'request_id') from jsonb_array_elements(v_norm) r) <> jsonb_array_length(v_norm)
     or (select count(distinct r->>'source_id') from jsonb_array_elements(v_norm) r) <> jsonb_array_length(v_norm) then
    raise exception 'duplicate_assignment_row' using errcode = '22023';
  end if;
  select count(*), (array_agg(id))[1] into v_count, v_binding from public.external_org_bindings
   where org_id = v_org and status = 'active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('complete',false,'reason','binding_unavailable','results','[]'::jsonb,'erp_write',false); end if;
  v_revision := public.purchase_capture_source_page(null,null,1)->>'revision';
  -- Rows run in source order so concurrent batches take their locks in one order.
  for v_item in select r.value as r from jsonb_array_elements(v_norm) r order by r.value->>'source_id' loop
    v_results := v_results || jsonb_build_array(public.capture_assignment_row(v_org,v_binding,v_actor,v_item.r,p_expected_revision,p_dry_run) || jsonb_build_object('index',(v_item.r->>'i')::integer));
  end loop;
  select coalesce(jsonb_agg(r order by (r->>'index')::integer),'[]'::jsonb) into v_results from jsonb_array_elements(v_results) r;
  return jsonb_build_object('complete',true,'dry_run',p_dry_run,'revision',v_revision,'results',v_results,'erp_write',false);
end $$;
revoke all on function public.assign_capture_invoices(jsonb,text,boolean) from public, anon;
grant execute on function public.assign_capture_invoices(jsonb,text,boolean) to authenticated;
