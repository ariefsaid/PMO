-- Restores the 0866 census (full-row hash) and its fence triggers, then removes the fingerprint function.
create trigger capture_census_fence before insert or update or delete on public.erp_actuals_snapshot for each row execute function public.fence_capture_source_change();
create trigger capture_census_fence before insert or update or delete on public.erp_financial_statement_snapshot for each row execute function public.fence_capture_source_change();
create trigger capture_census_fence before insert or update or delete on public.erp_financial_statement_published_context for each row execute function public.fence_capture_source_change();
-- Scoped history census. Monetary and ownership decisions are made from server evidence.
-- Rollback: rollback/0866_erp_purchase_capture_down.sql
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
  -- Include every persisted fact used to decide source, scope, mapping and ownership.
  -- Each page rechecks this witness, so a changed read cannot be accepted as one census.
  select encode(extensions.digest(convert_to(concat_ws(E'\n',
    coalesce((select string_agg(to_jsonb(d)::text, E'\n' order by d.id) from public.erp_purchase_documents d where d.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(l)::text, E'\n' order by l.id) from public.procurement_erp_links l where l.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(m)::text, E'\n' order by m.erp_purchase_document_id) from public.erp_purchase_document_marks m where m.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(g)::text, E'\n' order by g.id) from public.erp_gl_entry_mirror g where g.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(j)::text, E'\n' order by j.id) from public.erp_journal_line_links j where j.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(a)::text, E'\n' order by a.id) from public.budget_category_account_map a where a.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(a)::text, E'\n' order by a.id) from public.erp_account_mirror a where a.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(s)::text, E'\n' order by s.id) from public.erp_actuals_snapshot s where s.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(s)::text, E'\n' order by s.id) from public.erp_financial_statement_snapshot s where s.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(c)::text, E'\n' order by c.snapshot_id,c.company) from public.erp_financial_statement_published_context c where c.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(b)::text, E'\n' order by b.id) from public.external_org_bindings b where b.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(f)::text, E'\n' order by f.binding_id,f.feed_kind) from public.erp_capture_feed_witnesses f where f.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(x)::text, E'\n' order by x.id) from public.external_refs x where x.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(p)::text, E'\n' order by p.id) from public.projects p where p.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(c)::text, E'\n' order by c.id) from public.companies c where c.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(p)::text, E'\n' order by p.id) from public.procurements p where p.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.purchase_requests t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.purchase_orders t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.procurement_receipts t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.procurement_invoices t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(t)::text, E'\n' order by t.id) from public.payments t where t.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(c)::text, E'\n' order by c.procurement_id,c.request_id) from public.erp_purchase_captures c where c.org_id = v_org), ''),
    coalesce((select string_agg(to_jsonb(o)::text, E'\n' order by o.domain) from public.external_domain_ownership o where o.org_id = v_org), ''),
    coalesce((select to_jsonb(o)::text from public.organizations o where o.id = v_org), '')
  ), 'UTF8'), 'sha256'), 'hex') into v_generation;
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
drop function public.capture_revision(uuid);
