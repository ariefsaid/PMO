-- 0819 (#1276): the purchase attribution re-stamp scanned the org's whole purchase history on every sweep tick.
-- Now it runs only when its inputs changed since the last re-stamp: a cheap fingerprint of the project map, the GL
-- feed cursors, the mirrored documents, the PMO records that decide pmo_owned, and the projects. A project-map
-- change (or any other input change) changes the fingerprint, so everything is re-stamped once. Body = 0815 plus
-- the fingerprint guard (lines marked 0819); signature, grants, security mode and search_path unchanged.
-- Rollback: supabase/migrations/rollback/0819_erp_restamp_fingerprint_down.sql
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

create or replace function public.upsert_erp_purchase_documents(p_org_id uuid, p_rows jsonb, p_restamp boolean default true)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_written integer; v_fp text;  -- 0819
begin
  insert into public.erp_purchase_documents as d (
    org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
    grand_total, net_total, outstanding_amount, erp_status, erp_docstatus, is_return, erp_project, erp_modified, purchase_orders, item_projects)
  select p_org_id, r.erp_doctype, r.erp_name, r.supplier, r.supplier_name, r.doc_date, r.due_date, r.bill_no,
         r.currency, r.grand_total, r.net_total, r.outstanding_amount, r.erp_status, r.erp_docstatus,
         coalesce(r.is_return, false), r.erp_project, r.erp_modified, coalesce(r.purchase_orders, '{}'), coalesce(r.item_projects, '{}')
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      erp_doctype text, erp_name text, supplier text, supplier_name text, doc_date date, due_date date,
      bill_no text, currency text, grand_total numeric, net_total numeric, outstanding_amount numeric, erp_status text,
      erp_docstatus smallint, is_return boolean, erp_project text, erp_modified text, purchase_orders text[], item_projects text[])
  -- 0374: a newer ERP version replaces the row; the SAME version only fills a missing net total or an empty
  -- order list (rows mirrored before those fields were sent). An older version never writes.
  on conflict (org_id, erp_doctype, erp_name) do update set
    supplier = case when excluded.erp_modified > d.erp_modified then excluded.supplier else d.supplier end,
    supplier_name = case when excluded.erp_modified > d.erp_modified then excluded.supplier_name else d.supplier_name end,
    doc_date = case when excluded.erp_modified > d.erp_modified then excluded.doc_date else d.doc_date end,
    due_date = case when excluded.erp_modified > d.erp_modified then excluded.due_date else d.due_date end,
    bill_no = case when excluded.erp_modified > d.erp_modified then excluded.bill_no else d.bill_no end,
    currency = case when excluded.erp_modified > d.erp_modified then excluded.currency else d.currency end,
    grand_total = case when excluded.erp_modified > d.erp_modified then excluded.grand_total else d.grand_total end,
    net_total = case when excluded.erp_modified > d.erp_modified then excluded.net_total else coalesce(d.net_total, excluded.net_total) end,
    outstanding_amount = case when excluded.erp_modified > d.erp_modified then excluded.outstanding_amount else d.outstanding_amount end,
    erp_status = case when excluded.erp_modified > d.erp_modified then excluded.erp_status else d.erp_status end,
    erp_docstatus = case when excluded.erp_modified > d.erp_modified then excluded.erp_docstatus else d.erp_docstatus end,
    is_return = case when excluded.erp_modified > d.erp_modified then excluded.is_return else d.is_return end,
    erp_project = case when excluded.erp_modified > d.erp_modified then excluded.erp_project else d.erp_project end,
    erp_modified = case when excluded.erp_modified > d.erp_modified then excluded.erp_modified else d.erp_modified end,
    purchase_orders = case when excluded.erp_modified > d.erp_modified or d.purchase_orders = '{}' then excluded.purchase_orders
                           else d.purchase_orders end,
    item_projects = case when excluded.erp_modified > d.erp_modified or d.item_projects = '{}' then excluded.item_projects
                         else d.item_projects end,
    updated_at = now()
  where excluded.erp_modified > d.erp_modified
     or (excluded.erp_modified = d.erp_modified
         and ((d.net_total is null and excluded.net_total is not null)
              or (d.purchase_orders = '{}' and excluded.purchase_orders <> '{}')
              or (d.item_projects = '{}' and excluded.item_projects <> '{}')));
  get diagnostics v_written = row_count;

  if p_restamp then  -- 0769: the feed sends false on page writes and true once per tick (#1290)
    -- 0819: skip when no input of the stamp changed since the last re-stamp.
    select md5(concat_ws('|',
      (select coalesce(string_agg(b.config->>'project_map', ',' order by b.id), '') from public.external_org_bindings b
        where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null),
      (select coalesce(string_agg(w.domain || '=' || w.watermark_cursor, ',' order by w.domain), '') from public.external_sync_watermarks w
        where w.org_id = p_org_id and w.external_tier = 'erpnext' and w.domain like 'ledger::GL Entry%'),
      (select count(*) || '/' || coalesce(sum(hashtext(concat_ws('|', erp_name, erp_project, item_projects::text, erp_docstatus))), 0)
         from public.erp_purchase_documents where org_id = p_org_id),
      -- pmo_owned: the ERPNext procurement refs, and separately those whose PMO record still exists (one hash join, not a
      -- lookup per ref), so deleting one record and creating another between ticks still changes the fingerprint.
      -- (The Odoo branch of the stamp is stamped by the Odoo feed itself.)
      (select count(*) || '/' || coalesce(sum(hashtext(x.external_record_id || '|' || x.pmo_record_id)), 0) from public.external_refs x
        where x.org_id = p_org_id and x.domain = 'procurement' and x.external_tier = 'erpnext'),
      (select count(*) || '/' || coalesce(sum(hashtext(x.pmo_record_id)), 0) from public.external_refs x
         join (select id::text as id from public.purchase_orders where org_id = p_org_id
               union all select id::text from public.procurement_receipts where org_id = p_org_id
               union all select id::text from public.procurement_invoices where org_id = p_org_id
               union all select id::text from public.payments where org_id = p_org_id) r on r.id = x.pmo_record_id
        where x.org_id = p_org_id and x.domain = 'procurement' and x.external_tier = 'erpnext'),
      (select count(*) || '/' || coalesce(sum(hashtext(id::text)), 0) from public.projects where org_id = p_org_id))) into v_fp;
    if v_fp is not distinct from (select w.watermark_cursor from public.external_sync_watermarks w
                                   where w.org_id = p_org_id and w.external_tier = 'erpnext' and w.domain = 'purchases::restamp-fp') then
      p_restamp := false;
    end if;
  end if;

  if p_restamp then
    with map as (
      select m.value as erp_name, min(m.key)::uuid as project_id
        from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) m
       where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null
         and m.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and m.value <> ''
       group by m.value having count(*) = 1
    ), names as (
      select d.id, d.erp_project as erp_name from public.erp_purchase_documents d
       where d.org_id = p_org_id and d.erp_project is not null
      union
      select d.id, ip from public.erp_purchase_documents d, unnest(d.item_projects) ip  -- 0815
       where d.org_id = p_org_id
      union
      select d.id, g.project from public.erp_purchase_documents d
        join public.erp_gl_entry_mirror g
          on g.org_id = d.org_id and g.voucher_type = d.erp_doctype and g.voucher_no = d.erp_name
       where d.org_id = p_org_id and d.erp_doctype = 'Purchase Invoice'
         and g.project is not null and not g.is_cancelled
    ), stamped as (
      select d.id,
             coalesce(array_agg(distinct p.id order by p.id) filter (where p.id is not null), '{}') as project_ids,
             public.erp_document_recorded_by_pmo(p_org_id, d.erp_doctype, d.erp_name) as pmo_owned  -- 0378
        from public.erp_purchase_documents d
        left join names n on n.id = d.id
        left join map on map.erp_name = n.erp_name
        left join public.projects p on p.id = map.project_id and p.org_id = p_org_id
       where d.org_id = p_org_id
       group by d.id, d.erp_doctype, d.erp_name  -- 0378
    )
    update public.erp_purchase_documents d
       set project_ids = s.project_ids, pmo_owned = s.pmo_owned
      from stamped s
     where d.id = s.id and (d.project_ids is distinct from s.project_ids or d.pmo_owned is distinct from s.pmo_owned);

    insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor)
    values (p_org_id, 'erpnext', 'purchases::restamp-fp', v_fp)
    on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = now();  -- 0819
  end if;

  -- 0361 M-1: a linked document that ERPNext cancels stops counting in its purchase's total (ledger-held and
  -- evidence already filter erp_docstatus = 1).
  perform public.refresh_erp_linked_purchase_total(x.procurement_id)
     from (select distinct l.procurement_id
             from public.procurement_erp_links l
             join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
            where d.org_id = p_org_id
              and d.erp_name in (select r->>'erp_name' from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r)) x;

  return v_written;
end $$;

revoke all on function public.upsert_erp_purchase_documents(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.upsert_erp_purchase_documents(uuid, jsonb, boolean) to service_role;
