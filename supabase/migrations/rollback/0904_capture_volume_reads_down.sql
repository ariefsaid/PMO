-- Down for 0904 (#2286 PR A). Run this whole file in ONE transaction. It restores purchase_capture_ledger_page to its 0866
-- 3-argument body and purchase_capture_source_page to its 0873 body, verbatim, and drops the purchase_orders index.
drop function public.purchase_capture_ledger_page(uuid,integer,uuid,text);
-- restored: 0866 ledger page
create or replace function public.purchase_capture_ledger_page(p_cursor uuid default null, p_limit integer default 500, p_project_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_lines jsonb; v_last uuid; v_more boolean; v_revision text; v_binding uuid; v_count integer; v_tier text; v_company text;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read purchase history.' using errcode='42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'invalid page size' using errcode='22023'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and org_id=v_org) then raise exception 'project not found' using errcode='P0002'; end if;
  select count(*), (array_agg(id))[1], (array_agg(external_tier))[1], (array_agg(nullif(btrim(config->>'company'),'')))[1] into v_count, v_binding, v_tier, v_company
    from public.external_org_bindings where org_id=v_org and status='active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('outcome','refused','reason','binding_unavailable','erp_write',false); end if;
  if v_tier <> 'erpnext' then return jsonb_build_object('outcome','refused','reason','unsupported_adapter','erp_write',false); end if;
  v_revision := public.purchase_capture_source_page(null,null,1)->>'revision';
  with candidates as (
    select g.*, d.id as document_id, l.procurement_id as document_purchase_id,
      project.project_id, journal.procurement_id as journal_purchase_id,
      case when a.id is null then 'unknown'
        when a.root_type='Asset' then 'capital_spending'
        when a.root_type='Expense' and exists(select 1 from public.budget_category_account_map m where m.org_id=g.org_id and m.erp_account=g.account) then 'mapped'
        else 'unmapped' end as classification
    from public.erp_gl_entry_mirror g
    left join public.erp_purchase_documents d on g.company=v_company and d.org_id=g.org_id and d.erp_doctype=g.voucher_type and d.erp_name=g.voucher_no
    left join public.procurement_erp_links l on l.erp_purchase_document_id=d.id
    left join lateral (
      select case when count(distinct entry.key) = 1 then min(entry.key)::uuid end as project_id
      from public.external_org_bindings b cross join lateral jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) entry
      where b.org_id=g.org_id and b.id=v_binding
        and v_company=g.company and entry.value=g.project
        and entry.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    ) project on true
    left join public.erp_journal_line_links journal on journal.org_id=g.org_id and journal.project_id=project.project_id
      and journal.erp_doctype=g.voucher_type and journal.voucher_no=g.voucher_no and journal.account=g.account
    left join public.erp_account_mirror a on a.org_id=g.org_id and a.company=g.company and a.erp_name=g.account and not a.is_group
    where g.org_id=v_org and not g.is_cancelled and (p_cursor is null or g.id>p_cursor)
      and (p_project_id is null or project.project_id=p_project_id)
    order by g.id limit p_limit + 1
  ), page as (select * from candidates order by id limit p_limit)
  select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('kind',public.capture_source_kind(c.voucher_type),'debit',c.debit::text,'credit',c.credit::text) order by c.id),'[]'::jsonb), max(c.id::text)::uuid,
    (select count(*) > p_limit from candidates)
    into v_lines,v_last,v_more from page c;
  return jsonb_build_object('lines',v_lines,'revision',v_revision,'next_cursor',case when v_more then v_last end);
end $$;
revoke all on function public.purchase_capture_ledger_page(uuid,integer,uuid) from public, anon;
grant execute on function public.purchase_capture_ledger_page(uuid,integer,uuid) to authenticated;

-- restored: 0873 source page
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
          select 1 from public.erp_purchase_documents orders where orders.org_id=d.org_id and public.capture_source_kind(orders.erp_doctype)='order'
            and orders.erp_name=order_name and orders.erp_docstatus=1 and (p_project_id is null or p_project_id=any(orders.project_ids) or cardinality(orders.project_ids)=0)))
      when public.capture_source_kind(d.erp_doctype)='order' then exists (
        select 1 from public.erp_purchase_documents invoice where invoice.org_id=d.org_id and public.capture_source_kind(invoice.erp_doctype)='supplier_invoice'
          and d.erp_name=any(invoice.purchase_orders) and invoice.erp_docstatus=1
          and not (p_project_id is null or p_project_id=any(invoice.project_ids) or cardinality(invoice.project_ids)=0)) else false end as family_incomplete,
      (select case when count(distinct c.id) = 1 then (array_agg(distinct c.id))[1] end
         from public.external_refs x join public.companies c on c.id::text=x.pmo_record_id and c.org_id=x.org_id
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
drop index public.erp_purchase_documents_purchase_orders_idx;
