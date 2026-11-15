-- #2286 PR A — purchase capture read path at ten times today's volume. Same RPC names, same outputs; the guard is untouched.
-- (1) purchase_capture_ledger_page gains p_scope ('all' default, as before; 'capture' pages only the capture-relevant lines and
--     summarizes the rest on its first page), reads the revision with capture_revision instead of a one-row source page, and
--     resolves the project map once per page instead of once per line. The old 3-argument signature is dropped so PostgREST
--     sees one function. Body otherwise from 0866.
-- (2) purchase_capture_source_page: body from 0873 with the family lookups in indexable forms (a GIN index on purchase_orders,
--     the document type compared directly) and the supplier lookup joined on the companies primary key.
-- Down: supabase/migrations/rollback/0904_capture_volume_reads_down.sql.

-- §1 The ledger page.
drop function public.purchase_capture_ledger_page(uuid,integer,uuid);
create function public.purchase_capture_ledger_page(p_cursor uuid default null, p_limit integer default 500, p_project_id uuid default null, p_scope text default 'all')
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_lines jsonb; v_last uuid; v_more boolean; v_revision text; v_binding uuid; v_count integer; v_tier text; v_company text;
  v_binding_company text; v_summary jsonb;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read purchase history.' using errcode='42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'invalid page size' using errcode='22023'; end if;
  if p_scope is null or p_scope not in ('all','capture') then raise exception 'invalid ledger scope' using errcode='22023'; end if;  -- 0904
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and org_id=v_org) then raise exception 'project not found' using errcode='P0002'; end if;
  select count(*), (array_agg(id))[1], (array_agg(external_tier))[1], (array_agg(nullif(btrim(config->>'company'),'')))[1], (array_agg(config->>'company'))[1]
    into v_count, v_binding, v_tier, v_company, v_binding_company
    from public.external_org_bindings where org_id=v_org and status='active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('outcome','refused','reason','binding_unavailable','erp_write',false); end if;
  if v_tier <> 'erpnext' then return jsonb_build_object('outcome','refused','reason','unsupported_adapter','erp_write',false); end if;
  -- 0904: the same value purchase_capture_source_page reports (it is capture_revision of the caller's org), without its page.
  v_revision := public.capture_revision(v_org);
  with project_map as (
    -- 0904: the binding's project map once per page; an ERP project mapped to more than one PMO project resolves to none.
    select entry.value as erp_project, min(entry.key)::uuid as project_id
    from public.external_org_bindings b cross join lateral jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) entry
    where b.org_id=v_org and b.id=v_binding and entry.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    group by entry.value having count(distinct entry.key) = 1
  ), scoped as (
    select g.*, d.id as document_id, l.procurement_id as document_purchase_id,
      case when g.company=v_company then project.project_id end as project_id,
      -- 0904 FR-CAPV-001: a line is read line by line when it is of another company than the binding's (as the edge function
      -- compares it), resolves to a PMO project, belongs to a mirrored purchase document, or is an order, receipt or supplier invoice.
      -- Every term is strictly true or false (a null company or voucher type must never drop a line from both lists); the summary
      -- statement below tests the same four terms.
      (g.company is distinct from v_binding_company or coalesce(g.company=v_company and project.project_id is not null,false) or d.id is not null
        or coalesce(g.voucher_type in ('Purchase Order','Purchase Receipt','Purchase Invoice'),false)) as capture_relevant
    from public.erp_gl_entry_mirror g
    left join public.erp_purchase_documents d on g.company=v_company and d.org_id=g.org_id and d.erp_doctype=g.voucher_type and d.erp_name=g.voucher_no
    left join public.procurement_erp_links l on l.erp_purchase_document_id=d.id
    left join project_map project on project.erp_project=g.project
    where g.org_id=v_org and not g.is_cancelled
      and (p_project_id is null or (g.company=v_company and project.project_id=p_project_id))
  ), candidates as (
    select s.* from scoped s
    where (p_scope='all' or s.capture_relevant) and (p_cursor is null or s.id>p_cursor)
    order by s.id limit p_limit + 1
  ), page as (
    select s.*, journal.procurement_id as journal_purchase_id,
      case when a.id is null then 'unknown'
        when a.root_type='Asset' then 'capital_spending'
        when a.root_type='Expense' and exists(select 1 from public.budget_category_account_map m where m.org_id=s.org_id and m.erp_account=s.account) then 'mapped'
        else 'unmapped' end as classification
    from (select * from candidates order by id limit p_limit) s
    left join public.erp_journal_line_links journal on journal.org_id=s.org_id and journal.project_id=s.project_id
      and journal.erp_doctype=s.voucher_type and journal.voucher_no=s.voucher_no and journal.account=s.account
    left join public.erp_account_mirror a on a.org_id=s.org_id and a.company=s.company and a.erp_name=s.account and not a.is_group
  )
  select coalesce(jsonb_agg((to_jsonb(c) - 'capture_relevant') || jsonb_build_object('kind',public.capture_source_kind(c.voucher_type),'debit',c.debit::text,'credit',c.credit::text) order by c.id),'[]'::jsonb), max(c.id::text)::uuid,
    (select count(*) > p_limit from candidates)
    into v_lines,v_last,v_more from page c;
  -- 0904 FR-CAPV-002: on the first capture page, each left-out kind with its count, its exact net total (null when an amount is
  -- missing) and the finest decimal scale among its amounts (the edge formats the total at it, as its line-by-line sum did).
  -- A separate statement over the same four terms as capture_relevant, so the page above stops at its 501 rows and this one
  -- reads the left-out lines set-wise (an anti-join on the documents) instead of re-reading the page's joins.
  if p_scope='capture' and p_cursor is null then
    if p_project_id is not null then
      v_summary := '[]'::jsonb;  -- every line of a project scope resolves to that project, so none is left out
    else
      with project_map as (
        select entry.value as erp_project
        from public.external_org_bindings b cross join lateral jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) entry
        where b.org_id=v_org and b.id=v_binding and entry.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        group by entry.value having count(distinct entry.key) = 1
      ), left_out as (
        select g.voucher_type, g.debit, g.credit from public.erp_gl_entry_mirror g
        where g.org_id=v_org and not g.is_cancelled
          and not (g.company is distinct from v_binding_company)
          and not coalesce(g.company=v_company and exists(select 1 from project_map m where m.erp_project=g.project),false)
          and not coalesce(g.voucher_type in ('Purchase Order','Purchase Receipt','Purchase Invoice'),false)
          and not exists(select 1 from public.erp_purchase_documents d where g.company=v_company and d.org_id=g.org_id
            and d.erp_doctype=g.voucher_type and d.erp_name=g.voucher_no)
      )
      select coalesce(jsonb_agg(jsonb_build_object('kind',k.kind,'count',k.lines,'total',k.total,'scale',k.scale) order by k.kind collate "C"),'[]'::jsonb)
        into v_summary
        from (select coalesce(public.capture_source_kind(o.voucher_type),'other') as kind, count(*) as lines,
            case when bool_or(o.debit is null or o.credit is null) then null else (sum(o.debit) - sum(o.credit))::text end as total,
            greatest(max(min_scale(o.debit)),max(min_scale(o.credit))) as scale
          from left_out o group by 1) k;
    end if;
  end if;
  return jsonb_build_object('lines',v_lines,'revision',v_revision,'next_cursor',case when v_more then v_last end)
    || case when v_summary is not null then jsonb_build_object('other_summary',v_summary) else '{}'::jsonb end;
end $$;
revoke all on function public.purchase_capture_ledger_page(uuid,integer,uuid,text) from public, anon;
grant execute on function public.purchase_capture_ledger_page(uuid,integer,uuid,text) to authenticated;

-- §2 The source page.
create index erp_purchase_documents_purchase_orders_idx on public.erp_purchase_documents using gin (purchase_orders);
create or replace function public.purchase_capture_source_page(p_cursor uuid default null, p_project_id uuid default null, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_generation text;
  v_sources jsonb;
  v_last uuid;
  v_more boolean;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read purchase history.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid page size' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id and org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  -- The revision fingerprints only the facts that decide a capture (see capture_revision).
  v_generation := public.capture_revision(v_org);
  with candidates as (
    select d.*, l.procurement_id, public.erp_document_recorded_by_pmo(d.org_id,d.erp_doctype,d.erp_name) as recorded_by_pmo,
      case when public.capture_source_kind(d.erp_doctype)='supplier_invoice' then exists (
        select 1 from unnest(d.purchase_orders) order_name where not exists (
          select 1 from public.erp_purchase_documents orders where orders.org_id=d.org_id and orders.erp_doctype='Purchase Order'
            and orders.erp_name=order_name and orders.erp_docstatus=1 and (p_project_id is null or p_project_id=any(orders.project_ids) or cardinality(orders.project_ids)=0)))
      when public.capture_source_kind(d.erp_doctype)='order' then exists (
        select 1 from public.erp_purchase_documents invoice where invoice.org_id=d.org_id and invoice.erp_doctype='Purchase Invoice'
          and invoice.purchase_orders @> array[d.erp_name] and invoice.erp_docstatus=1
          and not (p_project_id is null or p_project_id=any(invoice.project_ids) or cardinality(invoice.project_ids)=0)) else false end as family_incomplete,
      (select case when count(distinct c.id) = 1 then (array_agg(distinct c.id))[1] end
         from public.external_refs x join public.companies c on c.id = case when x.pmo_record_id ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then x.pmo_record_id::uuid end and c.org_id=x.org_id
        where x.org_id=d.org_id and x.domain='companies' and x.external_tier='erpnext'
          and x.external_record_id in ('Supplier:' || d.supplier,d.supplier) and c.archived_at is null and c.type='Vendor') as supplier_id,
      case when p.record_only and p.status::text not in ('Cancelled','Rejected') and exists (
        select 1 from public.erp_purchase_captures c where c.org_id=p.org_id and c.procurement_id=p.id
          and c.undone_at is null and c.kind in ('order','supplier_invoice')) then 'captured'
        when p.origin='erp_link' then 'erp_link' when p.id is not null then 'ordinary' end as purchase_origin
      from public.erp_purchase_documents d
      left join public.procurement_erp_links l on l.erp_purchase_document_id = d.id
      left join public.procurements p on p.id=l.procurement_id and p.org_id=d.org_id
     where d.org_id = v_org and (p_cursor is null or d.id > p_cursor)
       and (p_project_id is null or p_project_id = any(d.project_ids) or cardinality(d.project_ids) = 0)
     order by d.id limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('kind', public.capture_source_kind(c.erp_doctype), 'net_total', c.net_total::text,
    'grand_total', c.grand_total::text, 'outstanding_amount', c.outstanding_amount::text,
    'needs_undo', case when c.procurement_id is null or c.erp_docstatus=2 then coalesce((
      select jsonb_agg(jsonb_build_object('supplier_id',h.vendor_id,'project_id',h.project_id,
        'currency',h.currency,'purchase_id',h.id,'undo_command',
        'node scripts/pmo.mjs purchases undo-record-only ' || h.id::text || ' --reason "Incorrect link"') order by h.id)
      from (select distinct p.id,coalesce(c.supplier_id,p.vendor_id) as vendor_id,original.project_ids[1] as project_id,original.currency
        from public.erp_purchase_captures cap
        join public.procurements p on p.id=cap.procurement_id and p.org_id=cap.org_id
        join public.procurement_erp_links l on l.procurement_id=p.id and l.org_id=cap.org_id
        join public.erp_purchase_documents original on original.id=l.erp_purchase_document_id and original.org_id=cap.org_id
        where cap.org_id=v_org and cap.undone_at is null and p.record_only
          and original.erp_docstatus=2 and ((c.id=original.id and c.procurement_id=p.id)
            or (exists (select 1 from public.external_refs x where x.org_id=v_org and x.domain='companies'
                and x.external_tier='erpnext' and x.pmo_record_id=c.supplier_id::text
                and x.external_record_id in ('Supplier:' || original.supplier,original.supplier))
              and cardinality(c.project_ids)=1
              and cardinality(original.project_ids)=1 and original.project_ids[1]=c.project_ids[1] and original.currency=c.currency))) h
    ),'[]'::jsonb) else '[]'::jsonb end) order by c.id), '[]'::jsonb),
    max(c.id::text)::uuid into v_sources, v_last from candidates c;
  select exists(select 1 from public.erp_purchase_documents d where d.org_id = v_org and d.id > v_last
    and (p_project_id is null or p_project_id = any(d.project_ids) or cardinality(d.project_ids) = 0)) into v_more;
  return jsonb_build_object('sources', v_sources, 'revision', v_generation, 'next_cursor', case when v_more then v_last end);
end $$;
revoke all on function public.purchase_capture_source_page(uuid, uuid, integer) from public, anon;
grant execute on function public.purchase_capture_source_page(uuid, uuid, integer) to authenticated;
