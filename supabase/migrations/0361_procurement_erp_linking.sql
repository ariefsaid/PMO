-- 0361 link ERP purchase documents into purchases; open commitment (spec procurement-flexible-entry; ADR-0093).
-- Rollback: supabase/migrations/rollback/0361_procurement_erp_linking_down.sql

-- §1 Purchases created from ERP documents keep their total from those documents (FR-PFE-026/027).
alter table public.procurements add column origin text
  constraint procurements_origin_check check (origin is null or origin = 'erp_link');
update public.record_history_config set omit_cols = array_append(omit_cols, 'origin')
 where table_name = 'procurements' and not ('origin' = any (omit_cols));

-- §2 A SharePoint reference may target one record of the same purchase (FR-PFE-050).
alter table public.procurement_documents
  add column record_kind text constraint procurement_documents_record_kind_check
    check (record_kind in ('purchase_request','rfq','quotation','purchase_order','goods_receipt','vendor_invoice','payment','erp_document')),
  add column record_id uuid,
  add constraint procurement_documents_record_pair check ((record_kind is null) = (record_id is null));
create function public.guard_procurement_document_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_proc uuid;
begin
  if new.record_kind is null then return new; end if;
  v_proc := case new.record_kind
    when 'purchase_request' then (select procurement_id from public.purchase_requests where id = new.record_id)
    when 'rfq'              then (select procurement_id from public.rfqs where id = new.record_id)
    when 'quotation'        then (select procurement_id from public.procurement_quotations where id = new.record_id)
    when 'purchase_order'   then (select procurement_id from public.purchase_orders where id = new.record_id)
    when 'goods_receipt'    then (select procurement_id from public.procurement_receipts where id = new.record_id)
    when 'vendor_invoice'   then (select procurement_id from public.procurement_invoices where id = new.record_id)
    when 'payment'          then (select procurement_id from public.payments where id = new.record_id)
    when 'erp_document'     then (select procurement_id from public.procurement_erp_links where erp_purchase_document_id = new.record_id)
  end;
  if v_proc is distinct from new.procurement_id then
    raise exception 'The document this file is attached to is not part of this purchase.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_document_record() from public, anon, authenticated;
create trigger procurement_documents_record_guard before insert or update of record_kind, record_id, procurement_id
  on public.procurement_documents for each row execute function public.guard_procurement_document_record();
grant insert (record_kind, record_id) on public.procurement_documents to authenticated;

-- §3 No double count (FR-PFE-035..037). Ledger-held = pre-tax ERP purchase invoices on the ledger.
create function public.procurement_ledger_held(p_procurement_id uuid) returns numeric
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
    from public.procurements p
   where p.id = p_procurement_id and (auth.uid() is null or p.org_id = public.auth_org_id())
     -- 0350 Engineer purchasing scope: invoice money is for the four money roles only (else no row → null).
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
$$;
revoke all on function public.procurement_ledger_held(uuid) from public, anon;
grant execute on function public.procurement_ledger_held(uuid) to authenticated, service_role;

create function public.procurement_open_commitment(p public.procurements) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  select case
    when p.status::text in ('Cancelled','Rejected') then 0::numeric
    when public.org_reads_erp_ledger() then greatest(0::numeric, coalesce(p.total_value, 0) - coalesce(public.procurement_ledger_held(p.id), 0))
    else coalesce(p.total_value, 0)::numeric end
$$;
revoke all on function public.procurement_open_commitment(public.procurements) from public, anon;
grant execute on function public.procurement_open_commitment(public.procurements) to authenticated;

create function public.project_committed_spend(p_project_id uuid) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  select coalesce(sum(public.procurement_open_commitment(p)), 0)
    from public.procurements p
   where p.project_id = p_project_id and p.status::text = any (public.committed_procurement_statuses())
$$;
revoke all on function public.project_committed_spend(uuid) from public, anon;
grant execute on function public.project_committed_spend(uuid) to authenticated;

-- §4 Total of a purchase created from ERP documents (FR-PFE-027).
create function public.refresh_erp_linked_purchase_total(p_procurement_id uuid) returns void
language sql security definer set search_path = public, pg_catalog as $$
  with docs as (
    select d.erp_doctype, coalesce(d.net_total, d.grand_total) as amount
      from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.procurement_id = p_procurement_id and d.erp_docstatus = 1
  ), pick as (
    select coalesce(
      (select sum(amount) from docs where erp_doctype = 'Purchase Order'   having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Purchase Invoice' having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Purchase Receipt' having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Payment Entry'    having count(*) > 0),
      0) as total
  )
  update public.procurements p set total_value = pick.total, updated_at = now()
    from pick where p.id = p_procurement_id and p.origin = 'erp_link' and p.total_value is distinct from pick.total;
$$;
revoke all on function public.refresh_erp_linked_purchase_total(uuid) from public, anon, authenticated;

-- §5 Link (FR-PFE-020..030). One code path for single, bulk, UI, CLI and dry run.
create function public.link_erp_purchase_documents(p_rows jsonb, p_dry_run boolean default false)
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
  v_group_key text; v_outcome text; v_reason text; v_gate text; v_vendor_supplier text; v_vendor_name text;
  v_step public.procurement_status; v_sp jsonb; v_new boolean;
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
        select * into v_doc from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'))
         for update;
        if v_doc.erp_docstatus <> 1 then raise exception using errcode = 'PFE02', message = 'document_cancelled'; end if;
        if v_doc.pmo_owned then raise exception using errcode = 'PFE02', message = 'document_recorded_by_pmo'; end if;

        v_target  := nullif(btrim(v_row->>'procurement_id'), '')::uuid;
        v_project := nullif(btrim(v_row->>'project_id'), '')::uuid;
        select l.procurement_id into v_existing from public.procurement_erp_links l where l.erp_purchase_document_id = v_doc.id;
        if found then
          if v_target is null or v_target = v_existing then
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
            select x.pmo_record_id::uuid into v_vendor from public.external_refs x
             where x.org_id = v_org and x.domain = 'companies' and x.external_tier = 'erpnext'
               and x.external_record_id = v_doc.supplier
               and x.pmo_record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
             order by x.created_at limit 1;
            insert into public.procurements (org_id, title, requested_by_id, project_id, vendor_id, budget_category, currency, total_value, origin)
            values (v_org,
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
        if exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = v_proc.id and d.supplier is distinct from v_doc.supplier) then
          raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
        end if;
        if v_proc.vendor_id is not null then
          v_vendor_supplier := null; v_vendor_name := null;
          select x.external_record_id into v_vendor_supplier from public.external_refs x
           where x.org_id = v_org and x.domain = 'companies' and x.external_tier = 'erpnext' and x.pmo_record_id = v_proc.vendor_id::text;
          if v_vendor_supplier is not null then
            if v_vendor_supplier is distinct from v_doc.supplier then raise exception using errcode = 'PFE02', message = 'supplier_mismatch'; end if;
          else
            select c.name into v_vendor_name from public.companies c where c.id = v_proc.vendor_id;
            if lower(btrim(coalesce(v_vendor_name, ''))) is distinct from lower(btrim(coalesce(v_doc.supplier_name, v_doc.supplier, ''))) then
              raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
            end if;
          end if;
        end if;
        v_step := case v_doc.erp_doctype when 'Purchase Order' then 'Ordered' when 'Purchase Receipt' then 'Received'
                    when 'Purchase Invoice' then 'Vendor Invoiced' else 'Paid' end;
        v_gate := public.procurement_gate_violation(v_proc.id, v_step);
        if v_gate is not null then raise exception using errcode = 'PFE02', message = v_gate; end if;

        insert into public.procurement_erp_links (org_id, procurement_id, erp_purchase_document_id, linked_by)
        values (v_org, v_proc.id, v_doc.id, v_uid);
        -- FR-PFE-016 approver ≠ payer on the link path. Checked here, not left to the update guard: at 0361
        -- that guard only covers amount_approved_by_id (0362 widens it); the check stays as defence in depth.
        if v_proc.status::text <> 'Paid' and public.procurement_evidenced_step(v_proc.id) = 'Paid'
           and v_uid is not null and (v_uid = v_proc.approved_by_id or v_uid = v_proc.amount_approved_by_id) then
          raise exception using errcode = 'PFE02', message = 'separation of duties: approver cannot pay own procurement';
        end if;
        if v_proc.vendor_id is null then
          update public.procurements p set vendor_id = x.pmo_record_id::uuid
            from (select pmo_record_id from public.external_refs
                   where org_id = v_org and domain = 'companies' and external_tier = 'erpnext' and external_record_id = v_doc.supplier
                     and pmo_record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                   order by created_at limit 1) x
           where p.id = v_proc.id and p.vendor_id is null;
        end if;
        if v_proc.origin = 'erp_link' then perform public.refresh_erp_linked_purchase_total(v_proc.id); end if;
        perform public.advance_procurement_status(v_proc.id, 'Derived: linked ERPNext ' || v_doc.erp_doctype || ' ' || v_doc.erp_name);
        v_sp := v_row -> 'sharepoint';
        if v_sp is not null and jsonb_typeof(v_sp) = 'object' then
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
        when insufficient_privilege or check_violation then v_outcome := 'refused'; v_reason := sqlerrm; v_target := null;
        when others then v_outcome := 'refused'; v_reason := 'error: ' || sqlerrm; v_target := null;
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
revoke all on function public.link_erp_purchase_documents(jsonb, boolean) from public, anon;
grant execute on function public.link_erp_purchase_documents(jsonb, boolean) to authenticated;

-- §6 Unlink (FR-PFE-031): status never moves back; per-document files move to the purchase.
create function public.unlink_erp_purchase_document(p_link_id uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_link public.procurement_erp_links%rowtype;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'Only an Admin or Finance member can unlink an ERP document.' using errcode = '42501';
  end if;
  select * into v_link from public.procurement_erp_links where id = p_link_id for update;
  if not found or v_link.org_id is distinct from public.auth_org_id() then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  update public.procurement_documents set record_kind = null, record_id = null
   where procurement_id = v_link.procurement_id and record_kind = 'erp_document' and record_id = v_link.erp_purchase_document_id;
  delete from public.procurement_erp_links where id = p_link_id;
  perform public.refresh_erp_linked_purchase_total(v_link.procurement_id);
  perform public.log_audit('procurement.erp_unlink', v_link.org_id, auth.uid(), v_link.procurement_id,
    jsonb_build_object('erp_purchase_document_id', v_link.erp_purchase_document_id));
end $$;
revoke all on function public.unlink_erp_purchase_document(uuid) from public, anon;
grant execute on function public.unlink_erp_purchase_document(uuid) to authenticated;

-- §7 Link a SharePoint item on a purchase or one of its documents (FR-PFE-050; CLI + app).
create function public.link_procurement_sharepoint_item(p_procurement_id uuid, p_record_kind text, p_record_id uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this procurement reference.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.procurements p where p.id = p_procurement_id and p.org_id = v_org) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' or coalesce(p_item->>'kind', '') not in ('file','folder') then
    raise exception 'A SharePoint item needs drive_id, item_id, web_url, name and kind (file or folder).' using errcode = '22023';
  end if;
  insert into public.procurement_documents (org_id, procurement_id, type, link, source, ms_drive_id, ms_item_id, ms_item_name, ms_item_kind, record_kind, record_id)
  values (v_org, p_procurement_id, 'Microsoft reference', p_item->>'web_url', 'onedrive', p_item->>'drive_id', p_item->>'item_id',
          p_item->>'name', p_item->>'kind', nullif(btrim(p_record_kind), ''), p_record_id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.link_procurement_sharepoint_item(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.link_procurement_sharepoint_item(uuid, text, uuid, jsonb) to authenticated;
