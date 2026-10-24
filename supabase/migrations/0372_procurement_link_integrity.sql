-- 0372 linking ERP documents into purchases keeps commitments and references correct (#1319; spec
-- procurement-flexible-entry; ADR-0093). Rollback: supabase/migrations/rollback/0372_procurement_link_integrity_down.sql
--
-- §1–§3 Purchase-state and financial helpers a member can call answer only an ACTIVE member (an offboarded member's
--    still-valid token reads nothing), and procurement_gate_violation answers only for a purchase RLS shows the caller
--    (an Engineer sees their own requests only). The server path (no user) is unchanged. Every other client-callable
--    definer added in 0360–0371 already checks active membership: get_procurement_gates, set_procurement_gates,
--    procurement_payment_within_ceiling, link_erp_purchase_documents, unlink_erp_purchase_document,
--    link_procurement_sharepoint_item, transition_procurement, mark_erp_purchase_documents, recategorise_budget_lines,
--    activate_budget_version, link_m365_documents_batch (pinned by supabase/tests/procurement_link_integrity.test.sql).
-- §4 Shared helpers: the SharePoint host rule, the ERP order lock, the linked-documents total.
-- §6 link_erp_purchase_documents:
--    a) an order and the invoices billing it are linked one at a time: a transaction lock on (organisation, ERP order
--       name) is taken before the document and purchase locks, so the order/invoice checks see a committed link of the
--       same order and refuse a second purchase;
--    b) an ERP invoice recorded against more than one project is refused (document_spans_projects): one purchase would
--       deduct the whole invoice while each project's actuals carry only its share;
--    c) a PMO purchase with no line items, no approval and a total of 0 takes its total from the ERP documents linked
--       into it, on the same basis as a purchase created from them (0361), and keeps following them while that total is
--       still the linked one; an item-derived, approved or typed total is never touched;
--    d) a SharePoint file sent with a link must be on the organisation's own SharePoint host, the rule
--       link_procurement_sharepoint_item (0370) and link_m365_documents_batch (0367) apply — now one shared function.
-- §7/§8 Unlinking and attaching a file to one record of a purchase take the purchase lock first and re-read the link
--    under it; unlink refreshes totals after the change. A file for an ERP document whose link is gone is refused.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — procurement_gate: 0360 body plus the line marked 0372 (active members only).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.procurement_gate(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((
    select case when jsonb_typeof(o.procurement_gates -> p_key) = 'boolean'
                then (o.procurement_gates ->> p_key)::boolean else false end
      from public.organizations o
     where o.id = p_org
       and (auth.uid() is null or (p_org = public.auth_org_id() and public.is_active_member()))), false)  -- 0372
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — procurement_ledger_held: 0361 body plus the line marked 0372 (active members only).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.procurement_ledger_held(p_procurement_id uuid) returns numeric
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
     and (auth.uid() is null or public.is_active_member())  -- 0372: an offboarded member's token reads nothing
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — procurement_gate_violation: 0368 body; the not-found test also covers an inactive member and a purchase RLS hides.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.procurement_gate_violation(p_procurement_id uuid, p_step public.procurement_status)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  -- 0372: a member reads the state of a purchase only while active and only if RLS shows it to them
  -- (procurements_select + procurements_engineer_read_scope); otherwise it does not exist for them.
  if not found or (auth.uid() is not null
                   and (v_row.org_id is distinct from public.auth_org_id()
                        or not public.is_active_member()                                              -- 0372
                        or not (coalesce(public.auth_role()::text in ('Admin','Executive','Project Manager','Finance'), false)  -- 0372
                                or v_row.requested_by_id = auth.uid()))) then                         -- 0372
    return 'purchase_not_found';
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
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — shared helpers. Not client-callable; they run inside the definers below (as their owner).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The organisation's SharePoint host rule, one copy for every link path. A Graph site id is
-- `<host>,<collection>,<site>`; a link is on the host when its https authority equals that host (case-insensitive,
-- exact — a look-alike host with the own host as a prefix is not). An organisation with no default library is refused
-- m365_not_configured.
create function public.sharepoint_url_on_org_host(p_org uuid, p_url text) returns boolean
language plpgsql stable set search_path = public, pg_catalog as $$
declare v_host text;
begin
  select lower(nullif(btrim(split_part(s.default_site_id, ',', 1)), '')) into v_host
    from public.org_m365_document_settings s where s.org_id = p_org;
  if v_host is null or position('.' in v_host) = 0 then
    raise exception using errcode = '22023', message = 'm365_not_configured',
      hint = 'Choose the default SharePoint library in the app first';
  end if;
  return coalesce(lower(substring(p_url from '^https://([^/:?#]+)')) = v_host, false);
end $$;
revoke all on function public.sharepoint_url_on_org_host(uuid, text) from public, anon, authenticated;

-- The ERP order names a document belongs with: an order is its own; an invoice belongs with the orders it bills.
create function public.erp_order_family(p_doctype text, p_name text, p_orders text[]) returns text[]
language sql immutable set search_path = public, pg_catalog as $$
  select case p_doctype when 'Purchase Order' then array[p_name]
                        when 'Purchase Invoice' then coalesce(p_orders, '{}')
                        else '{}'::text[] end
$$;
revoke all on function public.erp_order_family(text, text, text[]) from public, anon, authenticated;

-- One transaction-scoped lock per ERP order name of the organisation, taken in sorted order so two callers never wait
-- on each other in opposite orders.
create function public.lock_erp_order_family(p_org uuid, p_orders text[]) returns void
language plpgsql set search_path = public, pg_catalog as $$
declare v_name text;
begin
  for v_name in select distinct n from unnest(coalesce(p_orders, '{}')) n where coalesce(n, '') <> '' order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('erp-order:' || p_org::text || ':' || v_name, 0));
  end loop;
end $$;
revoke all on function public.lock_erp_order_family(uuid, text[]) from public, anon, authenticated;

-- The total the linked, submitted ERP documents give a purchase (0361 §4's basis, unchanged): the orders, else the
-- invoices, else the receipts, else the payments, at their pre-tax total; 0 when none.
create function public.erp_linked_documents_total(p_procurement_id uuid) returns numeric
language sql stable set search_path = public, pg_catalog as $$
  with docs as (
    select d.erp_doctype, coalesce(d.net_total, d.grand_total) as amount
      from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.procurement_id = p_procurement_id and d.erp_docstatus = 1
  )
  select coalesce(
    (select sum(amount) from docs where erp_doctype = 'Purchase Order'   having count(*) > 0),
    (select sum(amount) from docs where erp_doctype = 'Purchase Invoice' having count(*) > 0),
    (select sum(amount) from docs where erp_doctype = 'Purchase Receipt' having count(*) > 0),
    (select sum(amount) from docs where erp_doctype = 'Payment Entry'    having count(*) > 0),
    0)
$$;
revoke all on function public.erp_linked_documents_total(uuid) from public, anon, authenticated;

-- A PMO purchase (not created from ERP documents) whose total is what its linked documents gave it — 0 before any —
-- follows them when a document is linked or unlinked. Only while it has no line items and never entered approval (the
-- test procurement_payment_allowed and 0371 use); an item-derived, approved or typed total is never touched.
-- p_before is the linked-documents total before the change.
create function public.refresh_native_purchase_total_from_links(p_procurement_id uuid, p_before numeric) returns void
language sql set search_path = public, pg_catalog as $$
  update public.procurements p set total_value = t.total, updated_at = now()
    from (select public.erp_linked_documents_total(p_procurement_id) as total) t
   where p.id = p_procurement_id and p.origin is null
     and coalesce(p.total_value, 0) = coalesce(p_before, 0) and p.total_value is distinct from t.total
     and p.status::text not in ('Requested', 'Cancelled', 'Rejected')
     and p.approved_total_value is null and p.approved_by_id is null and p.amount_approved_by_id is null
     and p.pr_number is null
     and not exists (select 1 from public.procurement_items i where i.procurement_id = p.id)
     and not exists (select 1 from public.procurement_status_events e
                      where e.procurement_id = p.id
                        and e.to_status in ('Requested'::public.procurement_status, 'Approved'::public.procurement_status));
$$;
revoke all on function public.refresh_native_purchase_total_from_links(uuid, numeric) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — refresh_erp_linked_purchase_total: 0361 behaviour, now over the shared basis (§4).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.refresh_erp_linked_purchase_total(p_procurement_id uuid) returns void
language sql security definer set search_path = public, pg_catalog as $$
  update public.procurements p set total_value = t.total, updated_at = now()
    from (select public.erp_linked_documents_total(p_procurement_id) as total) t
   where p.id = p_procurement_id and p.origin = 'erp_link' and p.total_value is distinct from t.total;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — link_erp_purchase_documents: 0369 body, every conjunct kept, plus the lines marked 0372.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
  v_group_key text; v_outcome text; v_reason text; v_gate text; v_vendor_supplier text; v_vendor_name text;
  v_step public.procurement_status; v_sp jsonb; v_new boolean;
  v_orders text[]; v_sp_ok boolean; v_before numeric;                                                      -- 0372
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
        if v_doc.pmo_owned then raise exception using errcode = 'PFE02', message = 'document_recorded_by_pmo'; end if;
        -- M-2: the pmo_owned stamp is set by the mirror; a push after the last sweep is caught here.
        if exists (select 1 from public.external_refs x
                    where x.org_id = v_org and x.domain = 'procurement' and x.external_tier = 'erpnext'
                      and x.external_record_id = v_doc.erp_name) then
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
          v_vendor_supplier := null; v_vendor_name := null;
          select x.external_record_id into v_vendor_supplier from public.external_refs x
           where x.org_id = v_org and x.domain = 'companies' and x.external_tier = 'erpnext' and x.pmo_record_id = v_proc.vendor_id::text;
          if v_vendor_supplier is not null then
            if v_vendor_supplier is distinct from v_doc.supplier then raise exception using errcode = 'PFE02', message = 'supplier_mismatch'; end if;
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
                   where org_id = v_org and domain = 'companies' and external_tier = 'erpnext' and external_record_id = v_doc.supplier
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — unlink_erp_purchase_document: 0361 body plus the lines marked 0372 (purchase lock first; totals after).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.unlink_erp_purchase_document(p_link_id uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_link public.procurement_erp_links%rowtype; v_proc uuid; v_before numeric;                       -- 0372
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'Only an Admin or Finance member can unlink an ERP document.' using errcode = '42501';
  end if;
  -- 0372: the purchase is locked first (the lock linking and record inserts take), then the link is re-read under
  -- it, so concurrent unlinks and per-document file attaches on one purchase run one after the other.
  select l.procurement_id into v_proc from public.procurement_erp_links l
   where l.id = p_link_id and l.org_id = public.auth_org_id();
  if not found then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  perform 1 from public.procurements where id = v_proc for update;
  select * into v_link from public.procurement_erp_links where id = p_link_id for update;
  if not found or v_link.org_id is distinct from public.auth_org_id() or v_link.procurement_id is distinct from v_proc then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  v_before := public.erp_linked_documents_total(v_link.procurement_id);
  update public.procurement_documents set record_kind = null, record_id = null
   where procurement_id = v_link.procurement_id and record_kind = 'erp_document' and record_id = v_link.erp_purchase_document_id;
  delete from public.procurement_erp_links where id = p_link_id;
  perform public.refresh_erp_linked_purchase_total(v_link.procurement_id);
  perform public.refresh_native_purchase_total_from_links(v_link.procurement_id, v_before);                 -- 0372
  perform public.log_audit('procurement.erp_unlink', v_link.org_id, auth.uid(), v_link.procurement_id,
    jsonb_build_object('erp_purchase_document_id', v_link.erp_purchase_document_id));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — guard_procurement_document_record: 0361 body plus the purchase lock marked 0372.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.guard_procurement_document_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_proc uuid;
begin
  if new.record_kind is null then return new; end if;
  -- 0372: under the purchase lock (unlink takes it first), so the record read below stays true through commit.
  perform 1 from public.procurements where id = new.procurement_id for update;
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — link_procurement_sharepoint_item: 0370 body; its host block is the shared rule (§4).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.link_procurement_sharepoint_item(p_procurement_id uuid, p_record_kind text, p_record_id uuid, p_item jsonb)
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
  -- Links must point at the org's own SharePoint host (0372: the shared rule).
  if not public.sharepoint_url_on_org_host(v_org, p_item->>'web_url') then
    raise exception using errcode='22023',message='web_url host is not the organisation SharePoint host';
  end if;
  insert into public.procurement_documents (org_id, procurement_id, type, link, source, ms_drive_id, ms_item_id, ms_item_name, ms_item_kind, record_kind, record_id)
  values (v_org, p_procurement_id, 'Microsoft reference', p_item->>'web_url', 'onedrive', p_item->>'drive_id', p_item->>'item_id',
          p_item->>'name', p_item->>'kind', nullif(btrim(p_record_kind), ''), p_record_id)
  returning id into v_id;
  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §10 — link_m365_documents_batch: 0367 body; its host block is the shared rule (§4).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.link_m365_documents_batch(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_row jsonb;
  v_target_count integer;
  v_state text;
  v_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  if not public.is_active_member() or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise insufficient_privilege;
  end if;
  if v_org is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>500 then
    raise exception using errcode='22023',message='p_rows must contain 1 to 500 rows';
  end if;
  -- Links must point at the org's own SharePoint host (0372: the shared rule). Asked once before any row is read, so an
  -- organisation with no library is refused m365_not_configured whatever the rows hold.
  perform public.sharepoint_url_on_org_host(v_org, null);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_target_count := (case when v_row ? 'project_id' then 1 else 0 end)
      + (case when v_row ? 'budget_version_id' then 1 else 0 end)
      + (case when v_row ? 'procurement_id' then 1 else 0 end);
    if v_target_count<>1 or jsonb_typeof(v_row)<>'object'
      or v_row - array['project_id','budget_version_id','procurement_id','drive_id','item_id','web_url','name','kind']::text[] <> '{}'::jsonb
      or nullif(btrim(v_row->>'drive_id'),'') is null or nullif(btrim(v_row->>'item_id'),'') is null
      or nullif(btrim(v_row->>'name'),'') is null or v_row->>'kind' not in ('file','folder')
      or not public.m365_browser_url_valid(v_row->>'web_url') then
      raise exception using errcode='22023',message=format('invalid document link row %s',v_n);
    end if;
    if not public.sharepoint_url_on_org_host(v_org, v_row->>'web_url') then
      raise exception using errcode='22023',message=format('web_url host is not the organisation SharePoint host (row %s)',v_n);
    end if;
    v_id := null;
    if v_row ? 'project_id' then
      if not exists(select 1 from public.projects where id=(v_row->>'project_id')::uuid and org_id=v_org) then raise insufficient_privilege; end if;
      select id into v_id from public.project_documents where project_id=(v_row->>'project_id')::uuid
        and org_id=v_org and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        if v_row->>'kind'='folder' and public.m365_folder_linked_elsewhere('project',(v_row->>'project_id')::uuid,v_row->>'drive_id',v_row->>'item_id') then
          raise exception using errcode='23514',message='folder already linked to another project';
        end if;
        v_state:='linked';
        if not p_dry_run then
          insert into public.project_documents(project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
          values((v_row->>'project_id')::uuid,'Reference',v_row->>'name','Draft',auth.uid(),'onedrive',v_row->>'drive_id',v_row->>'item_id',v_row->>'web_url',v_row->>'name',v_row->>'kind') returning id into v_id;
        end if;
      end if;
    elsif v_row ? 'budget_version_id' then
      if not exists(select 1 from public.budget_versions b join public.projects p on p.id=b.project_id
        where b.id=(v_row->>'budget_version_id')::uuid and p.org_id=v_org and b.status='Draft') then raise insufficient_privilege; end if;
      select id into v_id from public.budget_version_document_links where budget_version_id=(v_row->>'budget_version_id')::uuid
        and org_id=v_org and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        v_state:='linked';
        if not p_dry_run then
          insert into public.budget_version_document_links(budget_version_id,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
          values((v_row->>'budget_version_id')::uuid,v_row->>'drive_id',v_row->>'item_id',v_row->>'web_url',v_row->>'name',v_row->>'kind') returning id into v_id;
        end if;
      end if;
    else
      if not exists(select 1 from public.procurements where id=(v_row->>'procurement_id')::uuid and org_id=v_org) then raise insufficient_privilege; end if;
      select id into v_id from public.procurement_documents where procurement_id=(v_row->>'procurement_id')::uuid
        and source='onedrive' and ms_drive_id=v_row->>'drive_id' and ms_item_id=v_row->>'item_id' limit 1;
      if v_id is not null then v_state:='already_linked'; else
        if v_row->>'kind'='folder' and public.m365_folder_linked_elsewhere('procurement',(v_row->>'procurement_id')::uuid,v_row->>'drive_id',v_row->>'item_id') then
          raise exception using errcode='23514',message='folder already linked to another purchase';
        end if;
        v_state:='linked';
        if not p_dry_run then
          insert into public.procurement_documents(procurement_id,type,status,link,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind)
          values((v_row->>'procurement_id')::uuid,'Microsoft reference','Draft',v_row->>'web_url','onedrive',v_row->>'drive_id',v_row->>'item_id',v_row->>'name',v_row->>'kind') returning id into v_id;
        end if;
      end if;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('row',v_n,'state',v_state,'document_id',v_id));
  end loop;
  if p_dry_run then
    -- Deliberately fail at the end so PostgREST rolls back any future validation-side writes as well.
    raise exception using errcode='P0001',message='pmo_dry_run_complete',detail=v_results::text;
  end if;
  return jsonb_build_object('dry_run',false,'results',v_results);
exception when sqlstate 'P0001' then
  if sqlerrm='pmo_dry_run_complete' then return jsonb_build_object('dry_run',true,'results',v_results); end if;
  raise;
end;
$$;

