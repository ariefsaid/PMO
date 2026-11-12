-- Capture submitted purchase history using server-read source facts.
-- Rollback: rollback/0859_capture_project_purchases_down.sql
alter table public.procurements add column capture_history_notice text;

create table public.erp_capture_sources (
  org_id uuid not null references public.organizations(id),
  binding_id uuid not null references public.external_org_bindings(id),
  source_id text not null,
  version text not null,
  kind text not null,
  state text not null,
  normalized jsonb not null,
  read_at timestamptz not null default now(),
  primary key (org_id, binding_id, source_id)
);
alter table public.erp_capture_sources enable row level security;
alter table public.erp_capture_sources force row level security;
revoke all on public.erp_capture_sources from public, anon, authenticated;
grant select, insert, update, delete on public.erp_capture_sources to service_role;

create function public.capture_history_link_internal(p_rows jsonb, p_dry_run boolean default false)
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
        if v_doc.erp_doctype = 'Purchase Invoice' and cardinality(v_doc.project_ids) = 0 and v_proc.project_id is not null then
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
        -- The caller is the Admin-only capture path, after submitted mirror evidence is re-read.
        -- Ordinary link calls retain their own unmodified gate.

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
        if v_proc.origin = 'erp_link' then
          update public.procurements set capture_history_notice = 'Recorded from ERP history without the approval gate.' where id = v_proc.id;
          perform public.log_audit('procurement.history_gate_exempt', v_org, v_uid, v_proc.id,
            jsonb_build_object('gate', v_gate, 'gate_applied', false, 'source', 'erp_history'));
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
revoke all on function public.capture_history_link_internal(jsonb, boolean) from public, anon, authenticated, service_role;

-- The same account-map membership used by the journal cost read classifies each mirrored invoice line.
create function public.classify_capture_invoice(p_document_id uuid)
returns text language sql stable security definer set search_path = public, pg_catalog as $$
  select case when count(g.id)=0 then 'unknown'
              when count(cm.erp_account)=count(g.id) then 'expense'
              when count(cm.erp_account)=0 then 'capital_spending'
              else 'mixed' end
    from public.erp_purchase_documents d
    left join public.erp_gl_entry_mirror g on g.org_id=d.org_id and g.voucher_no=d.erp_name
      and g.voucher_type in ('Purchase Invoice','account.move') and not g.is_cancelled
    left join public.budget_category_account_map cm on cm.org_id=g.org_id and cm.erp_account=g.account
   where d.id=p_document_id and d.erp_doctype='Purchase Invoice'
$$;
revoke all on function public.classify_capture_invoice(uuid) from public, anon, authenticated, service_role;

create function public.capture_existing_purchases(p_groups jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id(); v_group jsonb; v_id text; v_project uuid; v_request uuid;
  v_source public.erp_capture_sources%rowtype; v_doc public.erp_purchase_documents%rowtype;
  v_rows jsonb; v_linked jsonb; v_results jsonb := '[]'::jsonb; v_reason text; v_outcome text; v_purchase uuid;
  v_existing uuid[];
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can capture purchase history.' using errcode = '42501';
  end if;
  if p_dry_run is null or p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 500 then
    raise exception 'invalid capture request' using errcode = '22023';
  end if;
  begin
    for v_group in select value from jsonb_array_elements(p_groups) loop
      v_rows := '[]'::jsonb; v_reason := null; v_purchase := null; v_outcome := 'create'; v_existing := '{}';
      begin
        v_request := (v_group->>'request_id')::uuid;
        v_project := (v_group->>'project_id')::uuid;
        if v_request is null or v_project is null or not exists (select 1 from public.projects where id=v_project and org_id=v_org) then
          raise exception using errcode='RRP02', message='project_not_found';
        end if;
        if jsonb_typeof(v_group->'source_ids') <> 'array' or jsonb_array_length(v_group->'source_ids') not between 1 and 500
           or jsonb_typeof(v_group->'source_versions') <> 'object' then
          raise exception using errcode='RRP02', message='invalid_sources';
        end if;
        -- Match the linker's family-before-document lock order.
        perform public.lock_erp_order_family(v_org, array(
          select distinct unnest(public.erp_order_family(d.erp_doctype,d.erp_name,d.purchase_orders))
            from jsonb_array_elements_text(v_group->'source_ids') x(id)
            join public.erp_capture_sources s on s.org_id=v_org and s.source_id=x.id
            join public.erp_purchase_documents d on d.id=(s.normalized->>'document_id')::uuid and d.org_id=v_org
           order by 1));
        for v_id in select value from jsonb_array_elements_text(v_group->'source_ids') order by value loop
          if exists (select 1 from jsonb_array_elements(v_rows) r where r->>'source_id'=v_id) then
            raise exception using errcode='RRP02', message='duplicate_source';
          end if;
          select s.* into v_source from public.erp_capture_sources s
            join public.external_org_bindings b on b.id=s.binding_id and b.org_id=v_org
           where s.org_id=v_org and s.source_id=v_id;
          if not found then raise exception using errcode='RRP02', message='source_not_found'; end if;
          select * into v_doc from public.erp_purchase_documents
           where id=(v_source.normalized->>'document_id')::uuid and org_id=v_org for update;
          if not found then raise exception using errcode='RRP02', message='source_not_found'; end if;
          if v_doc.erp_docstatus <> 1 or v_doc.is_return or v_doc.pmo_owned then
            raise exception using errcode='RRP02', message='source_not_eligible';
          end if;
          if v_source.kind='supplier_invoice' and public.classify_capture_invoice(v_doc.id) not in ('expense','mixed') then
            raise exception using errcode='RRP02', message=case when public.classify_capture_invoice(v_doc.id)='capital_spending'
              then 'capital_spending' else 'unknown_account_basis' end;
          end if;
          if (v_source.kind='order' and v_doc.erp_doctype <> 'Purchase Order')
             or (v_source.kind='supplier_invoice' and v_doc.erp_doctype <> 'Purchase Invoice')
             or v_source.kind not in ('order','supplier_invoice') then
            raise exception using errcode='RRP02', message='source_not_eligible';
          end if;
          if v_source.version is distinct from v_group->'source_versions'->>v_id
             or v_source.version is distinct from v_doc.erp_modified then
            raise exception using errcode='RRP02', message='source_stale';
          end if;
          if cardinality(v_doc.project_ids) <> 1 or v_doc.project_ids[1] is distinct from v_project then
            raise exception using errcode='RRP02', message='project_mismatch';
          end if;
          if exists (select 1 from public.erp_purchase_document_marks where erp_purchase_document_id=v_doc.id and set_aside_at is not null) then
            raise exception using errcode='RRP02', message='source_set_aside';
          end if;
          select l.procurement_id into v_purchase from public.procurement_erp_links l where l.erp_purchase_document_id=v_doc.id;
          v_existing := array_append(v_existing, v_purchase);
          v_rows := v_rows || jsonb_build_array(jsonb_build_object('source_id',v_id, 'erp_doctype',v_doc.erp_doctype,
            'erp_name',v_doc.erp_name, 'project_id',v_project, 'group',v_request::text));
        end loop;
        if array_position(v_existing, null) is null then
          if cardinality(array(select distinct unnest(v_existing))) <> 1 then
            raise exception using errcode='RRP02', message='sources_linked_separately';
          end if;
          v_outcome := 'skip'; v_purchase := v_existing[1];
        elsif cardinality(array_remove(v_existing,null)) > 0 then
          raise exception using errcode='RRP02', message='partially_linked';
        else
          -- Internal helper accepts only the keys it needs; client identities do not become link inputs.
          select jsonb_agg(r - 'source_id' order by r->>'erp_doctype', r->>'erp_name') into v_rows from jsonb_array_elements(v_rows) r;
          v_linked := public.capture_history_link_internal(v_rows, false);
          select r->>'reason' into v_reason from jsonb_array_elements(v_linked->'results') r where r->>'outcome' <> 'link' limit 1;
          if found then raise exception using errcode='RRP02', message=coalesce(v_reason,'link_refused'); end if;
          v_purchase := (v_linked #>> '{results,0,procurement_id}')::uuid;
        end if;
      exception
        when sqlstate 'RRP02' then v_outcome := 'refused'; v_reason := sqlerrm; v_purchase := null;
        when invalid_text_representation then v_outcome := 'refused'; v_reason := 'invalid_id'; v_purchase := null;
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object('request_id',v_group->>'request_id', 'outcome',v_outcome,
        'reason',v_reason, 'procurement_id',case when p_dry_run and v_outcome='create' then null else v_purchase end,
        'would_create',v_outcome='create', 'erp_write',false));
    end loop;
    if p_dry_run then raise exception 'preview' using errcode='RRP01'; end if;
  exception when sqlstate 'RRP01' then null;
  end;
  return jsonb_build_object('dry_run',p_dry_run,'results',v_results);
end $$;
revoke all on function public.capture_existing_purchases(jsonb, boolean) from public, anon;
grant execute on function public.capture_existing_purchases(jsonb, boolean) to authenticated;
notify pgrst, 'reload schema';

-- Admin-only raw mirror census for the adapter; page generation changes on any source/link change.
create function public.purchase_capture_source_page(p_cursor uuid default null, p_project_id uuid default null, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_revision text; v_sources jsonb; v_last uuid; v_more boolean;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read purchase history.' using errcode='42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'invalid page size' using errcode='22023'; end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id=p_project_id and org_id=v_org) then
    raise exception 'project not found' using errcode='P0002';
  end if;
  select encode(extensions.digest(convert_to(coalesce(string_agg(
    to_jsonb(d)::text || coalesce(to_jsonb(l)::text,'') || coalesce(to_jsonb(m)::text,''), E'\n' order by d.id),''),'UTF8'),'sha256'),'hex')
    into v_revision
    from public.erp_purchase_documents d
    left join public.procurement_erp_links l on l.erp_purchase_document_id=d.id
    left join public.erp_purchase_document_marks m on m.erp_purchase_document_id=d.id
   where d.org_id=v_org;
  select encode(extensions.digest(convert_to(v_revision || coalesce((select string_agg(to_jsonb(g)::text,E'\n' order by g.id)
      from public.erp_gl_entry_mirror g where g.org_id=v_org),'') || coalesce((select string_agg(to_jsonb(m)::text,E'\n' order by m.id)
      from public.budget_category_account_map m where m.org_id=v_org),''), 'UTF8'),'sha256'),'hex') into v_revision;
  select encode(extensions.digest(convert_to(v_revision || coalesce((select string_agg(to_jsonb(s)::text,E'\n' order by s.id)
      from public.erp_actuals_snapshot s where s.org_id=v_org),'') || coalesce((select string_agg(to_jsonb(b)::text,E'\n' order by b.id)
      from public.external_org_bindings b where b.org_id=v_org),'') || coalesce((select string_agg(to_jsonb(p)::text,E'\n' order by p.id)
      from public.projects p where p.org_id=v_org),'') || coalesce((select to_jsonb(o)::text from public.organizations o where o.id=v_org),''),'UTF8'),'sha256'),'hex') into v_revision;
  with candidates as (
    select d.*, l.procurement_id, public.classify_capture_invoice(d.id) as account_class
      from public.erp_purchase_documents d
      left join public.procurement_erp_links l on l.erp_purchase_document_id=d.id
     where d.org_id=v_org and (p_cursor is null or d.id>p_cursor)
       and (p_project_id is null or p_project_id=any(d.project_ids) or cardinality(d.project_ids)=0)
     order by d.id limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('net_total',c.net_total::text,
      'grand_total',c.grand_total::text,'outstanding_amount',c.outstanding_amount::text) order by c.id),'[]'::jsonb), max(c.id::text)::uuid
    into v_sources,v_last from candidates c;
  select exists(select 1 from public.erp_purchase_documents d where d.org_id=v_org and d.id>v_last
    and (p_project_id is null or p_project_id=any(d.project_ids) or cardinality(d.project_ids)=0)) into v_more;
  return jsonb_build_object('sources',v_sources,'revision',v_revision,'next_cursor',case when v_more then v_last end);
end $$;
revoke all on function public.purchase_capture_source_page(uuid, uuid, integer) from public, anon;
grant execute on function public.purchase_capture_source_page(uuid, uuid, integer) to authenticated;
notify pgrst, 'reload schema';

-- Raw ledger evidence is consumed by the selected adapter, never by the CLI directly.
create function public.purchase_capture_ledger_page(p_cursor uuid default null, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_lines jsonb; v_last uuid; v_more boolean; v_revision text;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read capture evidence.' using errcode='42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'invalid page size' using errcode='22023'; end if;
  v_revision := public.purchase_capture_source_page(null,null,1)->>'revision';
  with candidates as (
    select g.id, g.project, g.voucher_type, g.voucher_no,
           case when scale(g.debit)=0 then g.debit::text || '.00' when scale(g.debit)=1 then g.debit::text || '0' else g.debit::text end as debit,
           case when scale(g.credit)=0 then g.credit::text || '.00' when scale(g.credit)=1 then g.credit::text || '0' else g.credit::text end as credit,
           (cm.erp_account is not null) as mapped
      from public.erp_gl_entry_mirror g
      left join public.budget_category_account_map cm on cm.org_id=g.org_id and cm.erp_account=g.account
     where g.org_id=v_org and not g.is_cancelled and (p_cursor is null or g.id>p_cursor)
     order by g.id limit p_limit
  ) select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb), max(c.id::text)::uuid into v_lines,v_last from candidates c;
  select exists(select 1 from public.erp_gl_entry_mirror g where g.org_id=v_org and not g.is_cancelled and g.id>v_last) into v_more;
  return jsonb_build_object('lines',v_lines,'revision',v_revision,'next_cursor',case when v_more then v_last end);
end $$;
revoke all on function public.purchase_capture_ledger_page(uuid, integer) from public, anon;
grant execute on function public.purchase_capture_ledger_page(uuid, integer) to authenticated;
notify pgrst, 'reload schema';

-- A snapshot witness uses the same ledger-only components as the project finance reader.
create function public.purchase_capture_actuals_witness(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_amount numeric; v_valid boolean; v_snapshot uuid;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read capture evidence.' using errcode='42501';
  end if;
  if not exists(select 1 from public.projects where id=p_project_id and org_id=v_org) then
    raise exception 'project not found' using errcode='P0002';
  end if;
  select snapshot_id into v_snapshot from public.erp_actuals_snapshot where org_id=v_org order by created_at desc,id desc limit 1;
  if v_snapshot is null or not public.org_reads_erp_ledger() or not exists (
    select 1 from public.erp_actuals_snapshot where org_id=v_org and project_id=p_project_id and snapshot_id=v_snapshot
  ) then return jsonb_build_object('complete',false,'amount_cents',null); end if;
  select sum(a.tagged_to_date + a.attributed_to_date),
         count(*) > 0 and bool_and(a.tagged_to_date is not null and a.attributed_to_date is not null)
    into v_amount,v_valid from public.project_finance_actuals(p_project_id) a where a.mapped;
  if not coalesce(v_valid,false) or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount*100 <> trunc(v_amount*100) then
    return jsonb_build_object('complete',false,'amount_cents',null);
  end if;
  return jsonb_build_object('complete',true,'amount_cents',trunc(v_amount*100)::text,'snapshot_id',v_snapshot,
    'revision',public.purchase_capture_source_page(null,null,1)->>'revision');
end $$;
revoke all on function public.purchase_capture_actuals_witness(uuid) from public, anon;
grant execute on function public.purchase_capture_actuals_witness(uuid) to authenticated;
notify pgrst, 'reload schema';

-- The purchase sweep records only completed passes; an older pass can never replace a newer one.
create table public.erp_purchase_capture_feed_state (
  binding_id uuid primary key references public.external_org_bindings(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  last_complete_started_at timestamptz not null
);
alter table public.erp_purchase_capture_feed_state enable row level security;
alter table public.erp_purchase_capture_feed_state force row level security;
revoke all on public.erp_purchase_capture_feed_state from public, anon, authenticated;
grant select, insert, update, delete on public.erp_purchase_capture_feed_state to service_role;

create function public.record_purchase_capture_feed_completion(p_org_id uuid, p_binding_id uuid, p_started_at timestamptz)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if p_started_at is null or p_started_at > clock_timestamp() or not exists (
    select 1 from public.external_org_bindings b where b.id=p_binding_id and b.org_id=p_org_id
      and b.activated_at is not null and p_started_at >= b.activated_at
  ) then raise exception 'invalid feed completion' using errcode='22023'; end if;
  insert into public.erp_purchase_capture_feed_state (org_id,binding_id,last_complete_started_at)
  values (p_org_id,p_binding_id,p_started_at)
  on conflict (binding_id) do update set last_complete_started_at=greatest(erp_purchase_capture_feed_state.last_complete_started_at,excluded.last_complete_started_at)
    where erp_purchase_capture_feed_state.org_id=excluded.org_id;
end $$;
revoke all on function public.record_purchase_capture_feed_completion(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.record_purchase_capture_feed_completion(uuid,uuid,timestamptz) to service_role;

create function public.purchase_capture_feed_health()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_binding public.external_org_bindings%rowtype; v_count integer; v_started timestamptz; v_caught boolean;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read capture health.' using errcode='42501';
  end if;
  select count(*) into v_count from public.external_org_bindings b where b.org_id=v_org and b.status='active' and b.activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('caught_up',false,'freshness_seconds',1800,'reason','binding_unavailable'); end if;
  select * into v_binding from public.external_org_bindings b where b.org_id=v_org and b.status='active' and b.activated_at is not null;
  select last_complete_started_at into v_started from public.erp_purchase_capture_feed_state where binding_id=v_binding.id and org_id=v_org;
  v_caught := coalesce(v_started >= v_binding.activated_at and v_started >= now() - interval '30 minutes',false);
  return jsonb_build_object('caught_up',v_caught,'last_complete_started_at',v_started,'freshness_seconds',1800,
    'reason',case when v_caught then null else 'purchase_feed_not_current' end);
end $$;
revoke all on function public.purchase_capture_feed_health() from public, anon;
grant execute on function public.purchase_capture_feed_health() to authenticated;
notify pgrst, 'reload schema';

do $migration$
declare v_def text; v_old constant text := $old$'set_project_contract_value', 'transition_project', 'import_budget_line_v2'$old$;
  v_new constant text := $new$'set_project_contract_value', 'transition_project', 'import_budget_line_v2', 'purchase_capture_source_page', 'purchase_capture_ledger_page', 'purchase_capture_feed_health', 'purchase_capture_actuals_witness', 'capture_existing_purchases'$new$;
begin
  select pg_get_functiondef('public.api_client_request_guard()'::regprocedure) into v_def;
  if length(v_def)-length(replace(v_def,v_old,'')) <> length(v_old) then
    raise exception 'capture: expected one admin RPC list';
  end if;
  execute replace(v_def,v_old,v_new);
end $migration$;
