-- 0882 #2195 B1: an active Admin places ERP invoices that carry no ERP project, or sets them aside as overhead.
-- This step holds the persisted decision, the Admin-only entry point and the once-per-source claim. Nothing here
-- writes to the ERP. Rollback: supabase/migrations/rollback/0882_capture_invoice_assignment_down.sql

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
  -- What the rule or equipment placement gave this invoice's ledger lines when the decision was made: [{project_id, amount}].
  prior_placement jsonb,
  prior_mark_present boolean not null default false,
  prior_mark_set_aside_at timestamptz,
  prior_mark_set_aside_by uuid references public.profiles(id),
  prior_mark_note text,
  prior_mark_updated_at timestamptz,
  prior_mark_updated_by uuid references public.profiles(id),
  -- The ledger mirror's key for the source, taken from trusted server evidence when the decision is made (never from a request).
  source_voucher_type text,
  source_voucher_no text,
  source_company text,
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

-- The ledger mirror is joined to an assignment by the voucher identity stored on it, and the attribution engine anti-joins on the same key.
create index erp_capture_assignment_active_voucher_idx
  on public.erp_capture_invoice_assignments (org_id, source_voucher_type, source_voucher_no) where undone_at is null and decision = 'project';

create function public.guard_capture_assignment_update() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  -- A decision that has been undone never changes again. procurement_id, original_classification and prior_placement are set once, after
  -- validation; every other column is fixed at insert.
  if old.undone_at is not null and new is distinct from old then
    raise exception 'assignment_decision_immutable' using errcode = '55000';
  end if;
  if (to_jsonb(new) - 'undone_at' - 'undone_by' - 'undone_reason' - 'procurement_id' - 'original_classification' - 'prior_placement')
       is distinct from (to_jsonb(old) - 'undone_at' - 'undone_by' - 'undone_reason' - 'procurement_id' - 'original_classification' - 'prior_placement')
     or (old.procurement_id is not null and new.procurement_id is distinct from old.procurement_id)
     or (old.original_classification is not null and new.original_classification is distinct from old.original_classification)
     or (old.prior_placement is not null and new.prior_placement is distinct from old.prior_placement) then
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
-- p_row is already validated and normalised by the caller, which holds the capture fence (shared for a preview, exclusive for an apply) before this
-- locks the source document. With p_dry_run true this only replays a stored request; a preview runs the claim in record mode inside a rolled-back subtransaction.
create function public.capture_assignment_claim(p_org uuid, p_binding uuid, p_actor uuid, p_row jsonb, p_revision text, p_dry_run boolean)
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
      prior_mark_present,prior_mark_set_aside_at,prior_mark_set_aside_by,prior_mark_note,prior_mark_updated_at,prior_mark_updated_by)
    values (p_org,p_binding,v_source,v_request,v_digest,v_decision,v_project,v_accept,v_capital,p_revision,p_actor,
      v_vtype,v_vno,v_company,
      v_marked,v_mark.set_aside_at,v_mark.set_aside_by,v_mark.note,v_mark.updated_at,v_mark.updated_by) returning id into v_id;
  exception when unique_violation then
    return v_base || jsonb_build_object('outcome','refused','reason','source_already_decided');
  end;
  return v_base || jsonb_build_object('outcome','recorded','decision_id',v_id);
end $$;
revoke execute on function public.capture_assignment_claim(uuid,uuid,uuid,jsonb,text,boolean) from public, anon, authenticated, service_role;

-- A set-aside decision ends when the overhead mark it set is cleared by any path (the ordinary unmark, or a link that clears it): one trigger on the
-- mark covers every path. The mark stays as that path left it; the decision row stays for the audit.
create function public.capture_assignment_release_set_aside() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if old.set_aside_at is not null and (tg_op = 'DELETE' or new.set_aside_at is null) then
    update public.erp_capture_invoice_assignments set undone_at = now(), undone_by = auth.uid(), undone_reason = 'overhead mark cleared'
     where org_id = old.org_id and source_document_id = old.erp_purchase_document_id and decision = 'set_aside' and undone_at is null;
  end if;
  return null;
end $$;
revoke execute on function public.capture_assignment_release_set_aside() from public, anon, authenticated, service_role;
create trigger erp_purchase_document_marks_release_set_aside after update or delete on public.erp_purchase_document_marks
  for each row execute function public.capture_assignment_release_set_aside();


-- §2b The linker of 0380, unchanged but for one exception (marked 0882): the document-has-no-project refusal does not apply to an
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
        -- 0882: except the invoice an active Admin assignment (written only by assign_capture_invoices) places on this very project.
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
create function public.capture_assignment_validate(p_org uuid, p_binding uuid, p_row jsonb, p_decision_id uuid, p_batch jsonb default null)
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
revoke execute on function public.capture_assignment_validate(uuid,uuid,jsonb,uuid,jsonb) from public, anon, authenticated, service_role;

-- §2c What the batch needs from the whole organization, read once under the fence instead of once per row: the ledger currency, and for each
-- source invoice the project and amount a rule or equipment setting places its current ledger lines on. An organization with no current rule
-- and no actual-cost equipment setting has nothing to read, so the attribution engine is not run for it.
create function public.capture_assignment_batch(p_org uuid, p_source_ids uuid[]) returns jsonb
language sql stable set search_path = public, pg_catalog as $$
  select jsonb_build_object('currency', public.purchase_capture_feed_health()->>'ledger_currency',
    'allocations', case when exists (select 1 from public.cost_attribution_rules r where r.org_id = p_org and r.is_current)
                          or exists (select 1 from public.equipment_costing_settings s where s.org_id = p_org and s.basis = 'actual_cost')
      then coalesce((select jsonb_object_agg(z.k, z.v) from (
             select al.vt || '|' || al.vn as k, jsonb_agg(jsonb_build_object('project_id', al.project_id, 'amount', al.amt) order by al.project_id) as v
               from (select g.voucher_type as vt, g.voucher_no as vn, a.project_id, sum(a.amount) as amt
                       from public.cost_attribution_allocations(p_org) a
                       join public.erp_gl_entry_mirror g on g.id = a.gl_id and g.org_id = p_org and not g.is_cancelled
                       join public.erp_purchase_documents d on d.org_id = p_org and d.id = any(p_source_ids)
                                                            and d.erp_doctype = g.voucher_type and d.erp_name = g.voucher_no
                      group by g.voucher_type, g.voucher_no, a.project_id) al
              group by al.vt, al.vn) z), '{}'::jsonb)
      else '{}'::jsonb end)
$$;
revoke execute on function public.capture_assignment_batch(uuid,uuid[]) from public, anon, authenticated, service_role;

-- §2d One row, end to end: replay, decide, validate under the source lock, place. A dry run does all of it and rolls it back.
create function public.capture_assignment_row(p_org uuid, p_binding uuid, p_actor uuid, p_row jsonb, p_revision text, p_dry_run boolean, p_batch jsonb default null)
returns jsonb language plpgsql set search_path = public, pg_catalog as $$
declare
  v_request uuid := (p_row->>'request_id')::uuid; v_source uuid := (p_row->>'source_id')::uuid;
  v_base jsonb := jsonb_build_object('request_id',(p_row->>'request_id')::uuid,'source_id',(p_row->>'source_id')::uuid,'erp_write',false)
    || coalesce((select jsonb_build_object('source',d.erp_name,'supplier',d.supplier_name) from public.erp_purchase_documents d
                  where d.org_id = p_org and d.id = (p_row->>'source_id')::uuid),'{}'::jsonb);
  v_claim jsonb; v_val jsonb; v_reason text; v_id uuid; v_doc public.erp_purchase_documents%rowtype; v_result jsonb; v_purchase uuid;
begin
  -- A retry of a stored request returns its stored result; nothing is validated or written again.
  if exists (select 1 from public.erp_capture_invoice_assignments where org_id = p_org and request_id = v_request) then
    return v_base || public.capture_assignment_claim(p_org,p_binding,p_actor,p_row,p_revision,true);
  end if;
  begin
    v_claim := public.capture_assignment_claim(p_org,p_binding,p_actor,p_row,p_revision,false);
    if v_claim->>'outcome' <> 'recorded' then return v_claim; end if;
    v_id := (v_claim->>'decision_id')::uuid;
    v_val := public.capture_assignment_validate(p_org,p_binding,p_row,v_id,p_batch);
    if not (v_val->>'ok')::boolean then v_reason := v_val->>'reason'; raise exception using errcode = 'PFE02', message = v_reason; end if;
    update public.erp_capture_invoice_assignments set original_classification = v_val->>'classification', prior_placement = v_val->'prior_placement' where id = v_id;
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
        'mapped_amount',v_val->'mapped_amount','excluded',v_val->'excluded','prior_placement',v_val->'prior_placement','clears_mark',v_val->'clears_mark','erp_write',false));
    end if;
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
  exception
    when sqlstate 'PFE01' then v_purchase := null;
    when sqlstate 'PFE02' then return v_base || jsonb_build_object('outcome','refused','reason',v_reason)
      || case when v_reason = 'snapshot_refresh_required' then jsonb_build_object('message','retry after the next ledger refresh') else '{}'::jsonb end;
  end;
  return v_base || jsonb_build_object('outcome','create','decision_id',case when p_dry_run then null else v_id end,'procurement_id',v_purchase,'would_create',p_dry_run,
    'decision',p_row->>'decision','warnings',v_val->'warnings','assignment_origin',case when p_row->>'decision' = 'project' then 'pmo_assignment' end,'mapped_amount',v_val->'mapped_amount','excluded',v_val->'excluded','classification',v_val->>'classification',
    'prior_placement',v_val->'prior_placement','ledger_currency',v_val->>'ledger_currency','clears_mark',v_val->'clears_mark');
end $$;
revoke execute on function public.capture_assignment_row(uuid,uuid,uuid,jsonb,text,boolean,jsonb) from public, anon, authenticated, service_role;

-- §3 The public entry. The actor and organization come from the session; a row may carry only the six keys below.
create function public.assign_capture_invoices(p_rows jsonb, p_expected_revision text, p_dry_run boolean default true)
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
  v_revision := public.purchase_capture_source_page(null,null,1)->>'revision';
  if not p_dry_run and exists (select 1 from jsonb_array_elements(v_norm) r
       where not exists (select 1 from public.erp_capture_invoice_assignments a where a.org_id = v_org and a.request_id = (r->>'request_id')::uuid)) then
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
  v_batch := public.capture_assignment_batch(v_org, array(select (r->>'source_id')::uuid from jsonb_array_elements(v_norm) r));
  for v_item in select r.value as r from jsonb_array_elements(v_norm) r order by r.value->>'source_id' loop
    v_results := v_results || jsonb_build_array(public.capture_assignment_row(v_org,v_binding,v_actor,v_item.r,p_expected_revision,p_dry_run,v_batch) || jsonb_build_object('index',(v_item.r->>'i')::integer));
  end loop;
  select coalesce(jsonb_agg(r order by (r->>'index')::integer),'[]'::jsonb) into v_results from jsonb_array_elements(v_results) r;
  return jsonb_build_object('complete',true,'dry_run',p_dry_run,'revision',v_revision,'results',v_results,'erp_write',false);
end $$;
revoke all on function public.assign_capture_invoices(jsonb,text,boolean) from public, anon;
grant execute on function public.assign_capture_invoices(jsonb,text,boolean) to authenticated;

-- §4 Placement of an assigned invoice in the ledger (#2195 B1 round 3). Amounts come from the ledger mirror only: the rows are found through
-- the voucher identity stored on the decision, never through erp_purchase_documents. Eligible = same company, untagged, not cancelled,
-- expense-root account that is in the budget category map. Internal: called by the attribution wrapper, run as owner.
create function public.capture_assigned_gl(p_org_id uuid, p_project_id uuid default null)
returns table(gl_id uuid, project_id uuid, account text, fiscal_year text, posting_date date, party_type text, amount numeric, as_of timestamptz)
language sql stable as $$      -- no SET clause, so the planner can inline it into the reading query (every name below is schema-qualified)
  -- Read the assignments first (a few rows, by the project or organization index), then only their vouchers from the ledger (voucher index),
  -- and only then classify each ledger row's account; the classification never decides which ledger rows are read.
  with assigned as materialized (
    select a.org_id, a.project_id, a.source_voucher_type, a.source_voucher_no, a.source_company
      from public.erp_capture_invoice_assignments a
     where a.org_id = p_org_id and a.undone_at is null and a.decision = 'project' and (p_project_id is null or a.project_id = p_project_id)
       -- precedence: an ERP project tag on any current, non-cancelled row of the voucher (mapped or not) suppresses the whole invoice here;
       -- the assignment row stays, and places the invoice again if the ERP later removes the tag
       and not exists (select 1 from public.erp_gl_entry_mirror t where t.org_id = a.org_id and t.voucher_type = a.source_voucher_type
                        and t.voucher_no = a.source_voucher_no and t.company is not distinct from a.source_company
                        and not t.is_cancelled and coalesce(t.project, '') <> '')
  ), voucher_rows as materialized (
    select g.id, g.org_id, g.company, g.account, g.fiscal_year, g.posting_date, g.party_type, g.debit, g.credit, g.as_of, g.project, g.is_cancelled, a.project_id as assigned_project
      from assigned a
      join public.erp_gl_entry_mirror g
        on g.org_id = a.org_id and g.voucher_type = a.source_voucher_type and g.voucher_no = a.source_voucher_no
       and g.company is not distinct from a.source_company
  )
  select v.id, v.assigned_project, v.account, v.fiscal_year, v.posting_date, v.party_type, coalesce(v.debit,0) - coalesce(v.credit,0), v.as_of
    from voucher_rows v
   where coalesce(v.project, '') = '' and not v.is_cancelled
     and exists (select 1 from public.erp_account_mirror m
                  where m.org_id = v.org_id and m.company = v.company and m.erp_name = v.account and not m.is_group and m.root_type = 'Expense')
     and exists (select 1 from public.budget_category_account_map b where b.org_id = v.org_id and b.erp_account = v.account)
$$;
revoke execute on function public.capture_assigned_gl(uuid, uuid) from public, anon, authenticated, service_role;

-- 0471 bodies, each with one change marked 0882.
create or replace function public.cost_attribution_engine(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                               p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(source text, gl_id uuid, rule_id uuid, rule_key uuid, version int, asset_id uuid, project_id uuid, account text,
              fiscal_year text, posting_date date, party_type text, amount numeric, as_of timestamptz, pool numeric,
              driver text, driver_value numeric, driver_total numeric, line_count int, entry_count int, status text)
language sql stable set search_path = public, pg_temp as $$
  with draft as (
    select coalesce((p_draft->>'rule_key')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as rule_key
    where p_draft is not null
  ), eq_versions as (                                                                                 -- 0471
    select v.* from public.equipment_settings_effective(p_org_id, p_equipment_draft) v where v.basis = 'actual_cost'  -- 0471
  ), rules as (
    select r.id, r.rule_key, r.specificity, r.match_account, r.match_account_group, r.match_cost_center,
           r.match_party_type, r.match_party, r.effective_from, r.effective_to, 'rule'::text as source          -- 0471 source
      from public.cost_attribution_rules r
     where r.org_id = p_org_id and r.is_current
       and r.rule_key is distinct from p_exclude_rule_key
       and not exists (select 1 from draft d where d.rule_key = r.rule_key)
    union all
    select null::uuid, d.rule_key, (p_draft->>'specificity')::int, p_draft->>'account', p_draft->>'account_group',
           p_draft->>'cost_center', p_draft->>'party_type', p_draft->>'party',
           (p_draft->>'effective_from')::date, (p_draft->>'effective_to')::date, 'rule'                         -- 0471 source
      from draft d
    union all                                                                                         -- 0471
    select v.id, v.setting_key, v.specificity, v.match_account, v.match_account_group, v.match_cost_center,   -- 0471
           v.match_party_type, v.match_party, v.window_from, nullif(v.window_to, 'infinity'::date), 'equipment'  -- 0471
      from eq_versions v                                                                              -- 0471
  ), targets as (
    select r.rule_key, t.position::int as position, t.project_id, t.percent
      from rules r join public.cost_attribution_rule_targets t on t.rule_id = r.id
    union all
    select d.rule_key, (e.ord - 1)::int, (e.v->>'project_id')::uuid, (e.v->>'percent')::numeric
      from draft d cross join lateral jsonb_array_elements(p_draft->'targets') with ordinality e(v, ord)
  ), project_rules as (
    select distinct t.rule_key from targets t where p_project_id is null or t.project_id = p_project_id
    union                                                                                             -- 0471
    select v.setting_key from eq_versions v                                                           -- 0471
     where p_project_id is null or exists (select 1 from public.equipment_usage_entries e             -- 0471
             where e.org_id = p_org_id and e.asset_id = v.asset_id and e.project_id = p_project_id    -- 0471
               and e.status = 'Approved' and e.archived_at is null)                                   -- 0471
  ), rule_accounts as (
    select r.*, r.match_account as acct from rules r where r.match_account is not null
    union all
    select r.*, a.erp_name
      from rules r
      join public.erp_account_mirror g on g.org_id = p_org_id and g.erp_name = r.match_account_group and g.is_group
      join public.erp_account_mirror a on a.org_id = p_org_id and a.company = g.company
                                       and a.lft > g.lft and a.rgt < g.rgt and not a.is_group
     where r.match_account_group is not null
  ), scan_accounts as (
    select distinct ra.acct from rule_accounts ra join project_rules pr on pr.rule_key = ra.rule_key
  ), ledger as materialized (                                 -- 0471 NFR-EQU-003: read once, then hash-joined to the rules on the cost centre
    select l.id, l.account, l.cost_center, l.party, l.party_type, l.fiscal_year, l.posting_date, l.debit - l.credit as net, l.as_of
      from scan_accounts sa
      join public.erp_gl_entry_mirror l
        on l.org_id = p_org_id and l.account = sa.acct
       and coalesce(l.project, '') = '' and not l.is_cancelled
       and not exists (select 1 from public.erp_capture_invoice_assignments x            -- 0882: a placed invoice is counted once, through its assignment
                        where x.org_id = p_org_id and x.undone_at is null and x.decision = 'project'
                          and x.source_voucher_type = l.voucher_type and x.source_voucher_no = l.voucher_no
                          and x.source_company is not distinct from l.company
                          -- an ERP project tag on any current row of the voucher wins: the assignment places nothing, so the rest goes back to the rules
                          and not exists (select 1 from public.erp_gl_entry_mirror t where t.org_id = x.org_id and t.voucher_type = x.source_voucher_type
                                           and t.voucher_no = x.source_voucher_no and t.company is not distinct from x.source_company
                                           and not t.is_cancelled and coalesce(t.project, '') <> ''))
  ), candidates as (                                          -- the 0376 join, split on the cost centre so each half is an equi-join
    select l.id as gl_id, ra.id as rule_id, ra.rule_key, ra.source, ra.specificity, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.net, l.as_of
      from ledger l
      join rule_accounts ra
        on ra.acct = l.account and ra.match_cost_center = l.cost_center
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
    union all
    select l.id, ra.id, ra.rule_key, ra.source, ra.specificity, l.account, l.fiscal_year, l.posting_date,
           l.party_type, l.net, l.as_of
      from ledger l
      join rule_accounts ra
        on ra.acct = l.account and ra.match_cost_center is null
       and l.posting_date >= ra.effective_from
       and (ra.effective_to is null or l.posting_date <= ra.effective_to)
       and (ra.match_party is null or (l.party = ra.match_party
            and (ra.match_party_type is null or l.party_type = ra.match_party_type)))
  ), winners as (
    select distinct on (c.gl_id) c.gl_id, c.rule_id, c.rule_key, c.source, c.account, c.fiscal_year, c.posting_date,
           c.party_type, c.net, c.as_of
      from candidates c
     order by c.gl_id, c.specificity desc, c.rule_key
  ), shares as (
    select w.*, t.project_id, t.position, round(w.net * t.percent / 100, 2) as share,
           row_number() over (partition by w.gl_id order by t.position desc) = 1 as is_last
      from winners w join targets t on t.rule_key = w.rule_key
     where w.source = 'rule' and w.rule_key in (select pr.rule_key from project_rules pr)                -- 0471 source
  ), placed as (
    select s.gl_id, s.rule_id, s.rule_key, s.project_id, s.account, s.fiscal_year, s.posting_date, s.party_type,
           case when s.is_last then s.net - (sum(s.share) over (partition by s.gl_id) - s.share) else s.share end as amount,
           s.as_of
      from shares s
  ), eq_pools as (                                                                                    -- 0471 FR-EQU-041/042
    select w.rule_id, w.rule_key, date_trunc('month', w.posting_date)::date as month, w.account, w.fiscal_year, w.party_type,
           sum(w.net) as pool, count(*)::int as line_count, max(w.as_of) as as_of
      from winners w where w.source = 'equipment'
     group by 1, 2, 3, 4, 5, 6
  ), eq_all as materialized (                                                                         -- 0471 aggregated once, not per version
    select u.* from public.equipment_usage_by_project(p_org_id) u where u.asset_id in (select v.asset_id from eq_versions v)
  ), eq_usage as materialized (                                                                                    -- 0471 OQ-2, OQ-6
    select v.setting_key, v.id as version_id, u.month, u.project_id,
           sum(case v.driver when 'units' then u.quantity when 'fuel' then u.fuel_litres else u.trips end) as driver_value,
           sum(u.entry_count)::int as entry_count
      from eq_versions v join eq_all u on u.asset_id = v.asset_id
     where (u.kind = 'work' or v.count_standby)
       and (v.driver <> 'units' or u.unit = v.rate_unit)       -- never add hours to days (FR-EQU-032 refuses the mix; this holds if one slipped in)
     group by 1, 2, 3, 4
  ), eq_split as (                                                                                    -- 0471
    select p.*, v.version, v.asset_id, v.driver, x.project_id, x.driver_value, x.entry_count,
           sum(x.driver_value) over (partition by p.rule_key, p.rule_id, p.month, p.account, p.fiscal_year, p.party_type) as driver_total
      from eq_pools p
      join eq_versions v on v.setting_key = p.rule_key and v.id is not distinct from p.rule_id
      left join eq_usage x on x.setting_key = p.rule_key and x.version_id is not distinct from p.rule_id
                          and x.month = p.month and x.driver_value > 0
  ), eq_shares as (                                                                                   -- 0471 PQ-6
    select s.*, round(s.pool * s.driver_value / s.driver_total, 2) as share,
           row_number() over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type
                              order by s.project_id desc) = 1 as is_last
      from eq_split s where s.driver_total > 0
  ), eq_placed as (                                                                                   -- 0471 FR-CAT-022
    select s.*, case when s.is_last
                     then s.pool - (sum(s.share) over (partition by s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type) - s.share)
                     else s.share end as amount
      from eq_shares s
  )
  select 'rule'::text, p.gl_id, p.rule_id, p.rule_key, null::int, null::uuid, p.project_id, p.account, p.fiscal_year,
         p.posting_date, p.party_type, p.amount, p.as_of, null::numeric, null::text, null::numeric, null::numeric, 1,
         null::int, 'allocated'::text
    from placed p where p_project_id is null or p.project_id = p_project_id
  union all                                                                                           -- 0471
  select 'equipment', null, e.rule_id, e.rule_key, e.version, e.asset_id, e.project_id, e.account, e.fiscal_year, e.month,
         e.party_type, e.amount, e.as_of, e.pool, e.driver, e.driver_value, e.driver_total, e.line_count, e.entry_count, 'allocated'
    from eq_placed e where p_project_id is null or e.project_id = p_project_id
  union all                                                                                           -- 0471 never dropped
  select distinct on (s.rule_key, s.rule_id, s.month, s.account, s.fiscal_year, s.party_type)
         'equipment', null, s.rule_id, s.rule_key, s.version, s.asset_id, null::uuid, s.account, s.fiscal_year, s.month,
         s.party_type, s.pool, s.as_of, s.pool, s.driver, null::numeric, 0::numeric, s.line_count, 0, 'unallocated'
    from eq_split s where coalesce(s.driver_total, 0) = 0 and p_project_id is null
$$;
create or replace function public.cost_attribution_allocations(p_org_id uuid, p_draft jsonb default null, p_exclude_rule_key uuid default null,
                                                    p_project_id uuid default null, p_equipment_draft jsonb default null)
returns table(gl_id uuid, rule_id uuid, rule_key uuid, project_id uuid, account text, fiscal_year text,
              posting_date date, party_type text, amount numeric, as_of timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select e.gl_id, e.rule_id, e.rule_key, e.project_id, e.account, e.fiscal_year, e.posting_date, e.party_type, e.amount, e.as_of
    from public.cost_attribution_engine(p_org_id, p_draft, p_exclude_rule_key, p_project_id, p_equipment_draft) e
   where e.status = 'allocated'      -- an unallocated pool reaches no project figure
  union all                          -- 0882: invoices an Admin placed on a project, from the ledger mirror only (never a draft or preview)
  select g.gl_id, null::uuid, null::uuid, g.project_id, g.account, g.fiscal_year, g.posting_date, g.party_type, g.amount, g.as_of
    from public.capture_assigned_gl(p_org_id, p_project_id) g
   where p_draft is null and p_exclude_rule_key is null and p_equipment_draft is null
$$;

-- §5 The two unconfigured fast exits (0720, 0794) still skip the engine for an organization with nothing configured; an active assignment is
-- something configured, so it is not skipped. Bodies otherwise as in 0720 / 0794.
create or replace function public.cost_attribution_org_actuals(p_fiscal_year text default null)
returns table(project_id uuid, category public.budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.project_id, m.category, count(*),
         case when count(*) filter (where a.amount is null or a.amount::text in ('NaN','Infinity','-Infinity')) > 0
              then null else sum(a.amount) end,
         sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, null) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and (exists (select 1 from public.cost_attribution_rules r where r.org_id = public.auth_org_id() and r.is_current)   -- 0720
          or exists (select 1 from public.equipment_costing_settings s where s.org_id = public.auth_org_id() and s.basis = 'actual_cost')
          or exists (select 1 from public.erp_capture_invoice_assignments x where x.org_id = public.auth_org_id() and x.undone_at is null and x.decision = 'project'))   -- 0882
     and (p_fiscal_year is null or a.fiscal_year = p_fiscal_year)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
   group by a.project_id, m.category
$$;
create or replace function public.cost_attribution_project_actuals(p_project_id uuid, p_fiscal_year text default null)
returns table(category public.budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.category, count(*),
         case when count(*) filter (where a.amount is null or a.amount::text in ('NaN','Infinity','-Infinity')) > 0
              then null else sum(a.amount) end,
         sum(a.amount), max(a.as_of)
    from public.cost_attribution_allocations(public.auth_org_id(), null, null, p_project_id) a
    join public.budget_category_account_map m on m.org_id = public.auth_org_id() and m.erp_account = a.account
   where public.is_active_member()
     and (exists (select 1 from public.cost_attribution_rules r where r.org_id = public.auth_org_id() and r.is_current)   -- 0721
          or exists (select 1 from public.equipment_costing_settings s where s.org_id = public.auth_org_id() and s.basis = 'actual_cost')
          or exists (select 1 from public.erp_capture_invoice_assignments x where x.org_id = public.auth_org_id() and x.undone_at is null and x.decision = 'project'))   -- 0882
     and (p_fiscal_year is null or a.fiscal_year = p_fiscal_year)
     and (a.party_type is distinct from 'Employee' or coalesce(public.holds_spend_approval_authority(public.auth_role()), false))
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by m.category
$$;

-- §6 The capture report's view of PMO-side decisions, from the ledger mirror only: what each active project decision places, and which ledger lines
-- of its voucher it leaves out (capital spending, and expense accounts outside the budget map); an active set-aside decision is listed with nothing
-- placed. The placement relation is read once, not once per decision. Admin only, own organization.
create function public.purchase_capture_assignment_report(p_project_id uuid default null)
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
revoke all on function public.purchase_capture_assignment_report(uuid) from public, anon;
grant execute on function public.purchase_capture_assignment_report(uuid) to authenticated;

-- §4 Undo of a captured purchase (0868's body, extended once). A purchase an Admin placed by assignment also deactivates that decision and puts the
-- invoice's set-aside mark back as it was before the placement, in the same transaction. If someone has changed the mark since, nothing is undone.
-- Lock order is unchanged: purchase, then its capture row; the decision row and the mark come after them. The later-payment check (the outbox and
-- the later steps) still runs under the purchase lock, so a payment enqueue and this undo cannot both win.
create or replace function public.undo_captured_purchase(p_procurement_id uuid,p_reason text,p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_kind text; v_proc public.procurements%rowtype; v_history jsonb;
  v_asg public.erp_capture_invoice_assignments%rowtype; v_mark public.erp_purchase_document_marks%rowtype; v_has_mark boolean; v_restored boolean := false; v_before jsonb;
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

-- §6 The request guard: a command-line sign-in (a token with a client_id claim) may call the two assignment RPCs as an active Admin, by POST only.
-- Body of 0876 unchanged except the lines marked 0882.
create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project', 'import_budget_line_v2'];
  -- #1835 stage-date correction tier: exact RPC + read endpoint, active Admin only.
  stage_admin_rpcs constant text[] := array['redate_stage_entry'];
  stage_admin_tables constant text[] := array['project_stage_entries'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item',
    'attach_erp_journal_lines', 'project_erp_journal_lines', 'create_record_only_journal_purchase', 'undo_captured_purchase'];  -- 0688 (#1919)
  purchase_read_views constant text[] := array['erp_purchase_orphans', 'erp_purchase_orphans_all'];  -- 0364
  -- ADMIN/FINANCE TIER (`pmo purchases set-aside`, #1319 AC-13)  -- 0364
  set_aside_rpcs constant text[] := array['mark_erp_purchase_documents'];  -- 0364
  -- ACTIVE-ADMIN `pmo rpc` TIER (#1326) — keep in step with scripts/pmo.mjs ADMIN_RPCS.  -- 0366
  admin_cli_rpcs constant text[] := array['recategorise_budget_lines'];  -- 0366
  -- OPERATOR READ TIER (`pmo get/documents/m365`, #1270) — keep in step with scripts/pmo.mjs.  -- 0367
  operator_read_tables constant text[] := array['budget_versions', 'budget_line_items', 'budget_category_account_map', 'erp_gl_entry_mirror', 'project_documents', 'org_m365_document_settings', 'm365_record_folder_sweeps',  -- 0367
    'contract_rate_lines', 'contract_rate_assignees'];  -- 0518
  operator_read_rpcs constant text[] := array['project_mapped_actuals', 'link_m365_documents_batch'];  -- 0367
  -- BUDGET OPS TIER (`pmo budgets`, #1270 B): the activation check. Same role set as the RPC's own check. A Draft's source
  -- file goes through link_m365_documents_batch (0367 tier, host-pinned). activate_budget_version is deliberately NOT here
  -- (owner has not ruled).  -- 0370
  budget_ops_rpcs constant text[] := array['budget_activation_mode'];  -- 0370
  -- ACTIVE-ADMIN ACCOUNT-MAP TIER (`pmo accounts map set`, #1270 B) — the same Admin rule as the table's own policy.  -- 0370
  account_map_tables constant text[] := array['budget_category_account_map'];  -- 0370
  account_map_rpcs constant text[] := array['set_budget_push_account'];  -- 0370
  -- COST ATTRIBUTION TIER (`pmo attribution`, #1271): preview/save/end for active Admin/Finance; list for the
  -- project-actuals audience. Same role sets as the RPCs' own checks.  -- 0376
  cost_attribution_write_rpcs constant text[] := array['preview_cost_attribution', 'save_cost_attribution_rule', 'end_cost_attribution_rule'];  -- 0376
  cost_attribution_read_rpcs constant text[] := array['list_cost_attribution_rules'];  -- 0376
  -- EQUIPMENT TIER (`pmo equipment`, #1519): costing preview/save/end for active Admin/Finance; costing and allocation
  -- reads for the amounts audience; usage totals for any active member. Same role sets as the RPCs' own checks.  -- 0497
  equipment_write_rpcs constant text[] := array['preview_equipment_costing', 'save_equipment_costing', 'end_equipment_costing'];  -- 0497
  equipment_read_rpcs constant text[] := array['list_equipment_costing', 'list_equipment_allocations'];  -- 0497
  equipment_usage_rpcs constant text[] := array['list_equipment_usage_totals'];  -- 0497
  -- TIME-AND-MATERIALS TIER (`pmo tm`, #1514): the rate and sign-off writers for active Admin/Finance; the claim list and
  -- preview for the amounts audience. Same role sets as the RPCs' own checks. The rate card itself is a table read, so
  -- `contract_rate_lines` and `contract_rate_assignees` join the operator read tier below; RLS stays the tenancy rule.  -- 0518
  tm_write_rpcs constant text[] := array['save_contract_rate_line', 'end_contract_rate_line', 'set_contract_rate_assignee', 'end_contract_rate_assignee', 'assemble_tm_claim', 'deselect_tm_source', 'prepare_tm_signoff', 'withdraw_tm_signoff', 'confirm_tm_signoff'];  -- 0518
  tm_read_rpcs constant text[] := array['list_tm_claims', 'preview_tm_claim', 'list_tm_claim_source_details'];  -- 0588
  -- NATIVE RECEIPT TIER (`pmo purchases receive` on a PMO-owned org, #1866): same role set as the RPC's own check.  -- 0702
  native_receipt_rpcs constant text[] := array['create_procurement_receipt'];  -- 0702
  -- ACTIVE-ADMIN CAPTURE-READ TIER (`pmo purchases capture`, #2276) — keep in step with supabase/functions/purchase-capture.  -- 0872
  capture_read_rpcs constant text[] := array['purchase_capture_source_page', 'purchase_capture_ledger_page', 'purchase_capture_feed_health'];  -- 0872
  -- DISPATCH-READ TIER (`pmo purchases receive|pay-captured`, external `pmo companies create`, #2278) — keep in step with
  -- supabase/functions/adapter-dispatch/authGuard.ts and pmo-portal/src/lib/adapterSeam/cutoverGate.ts.  -- 0876
  dispatch_read_rpcs constant text[] := array['domain_owned_by_tier', 'actor_authorization_state'];  -- 0876
  dispatch_read_procurement_rpcs constant text[] := array['pre_cutover_procurement'];  -- 0876
  -- ACTIVE-ADMIN CAPTURE-ASSIGNMENT TIER (`pmo purchases assign`, #2195) — keep in step with supabase/functions/purchase-capture.  -- 0882
  capture_assign_rpcs constant text[] := array['assign_capture_invoices', 'purchase_capture_assignment_report'];  -- 0882
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (stage_admin_rpcs) then  -- 0585
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (purchase_rpcs) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (operator_read_rpcs) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'POST' and target = any (budget_ops_rpcs) then  -- 0370
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (account_map_rpcs) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'POST' and target = any (cost_attribution_write_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
    if method = 'POST' and target = any (cost_attribution_read_rpcs) then  -- 0376
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0376
        return;  -- 0376
      end if;  -- 0376
    end if;  -- 0376
    if method = 'POST' and target = any (equipment_write_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_read_rpcs) then  -- 0497
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (equipment_usage_rpcs) then  -- 0497
      if coalesce(public.is_active_member(), false) then  -- 0497
        return;  -- 0497
      end if;  -- 0497
    end if;  -- 0497
    if method = 'POST' and target = any (tm_write_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
    if method = 'POST' and target = any (tm_read_rpcs) then  -- 0518
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0518
        return;  -- 0518
      end if;  -- 0518
    end if;  -- 0518
    if method = 'POST' and target = any (native_receipt_rpcs) then  -- 0702
      if coalesce(public.auth_role()::text in ('Admin', 'Project Manager') and public.is_active_member(), false) then  -- 0702
        return;  -- 0702
      end if;  -- 0702
    end if;  -- 0702
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
    if method = 'POST' and target = any (capture_read_rpcs) then  -- 0872
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0872
        return;  -- 0872
      end if;  -- 0872
    end if;  -- 0872
    if method = 'POST' and target = any (dispatch_read_rpcs) then  -- 0876
      if coalesce(public.is_active_member(), false) then  -- 0876
        return;  -- 0876
      end if;  -- 0876
    end if;  -- 0876
    if method = 'POST' and target = any (dispatch_read_procurement_rpcs) then  -- 0876
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0876
        return;  -- 0876
      end if;  -- 0876
    end if;  -- 0876
    if method = 'POST' and target = any (capture_assign_rpcs) then  -- 0882
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0882
        return;  -- 0882
      end if;  -- 0882
    end if;  -- 0882
    if method = 'POST' and target = any (admin_cli_rpcs) then  -- 0366
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0366
        return;  -- 0366
      end if;  -- 0366
    end if;  -- 0366
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method in ('GET', 'POST') and target = any (account_map_tables) then  -- 0370
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0370
        return;  -- 0370
      end if;  -- 0370
    end if;  -- 0370
    if method = 'GET' and target = any (stage_admin_tables) then  -- 0585
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'GET' and target = any (operator_read_tables) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'GET' and target = any (purchase_read_views) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;
