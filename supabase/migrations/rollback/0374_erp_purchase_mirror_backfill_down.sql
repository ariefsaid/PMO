-- Reverses 0374: restores 0361's upsert (only a newer ERP version writes). Values already backfilled stay; they are
-- the same ERP version's own figures.
create or replace function public.upsert_erp_purchase_documents(p_org_id uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_written integer;
begin
  insert into public.erp_purchase_documents as d (
    org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
    grand_total, net_total, outstanding_amount, erp_status, erp_docstatus, is_return, erp_project, erp_modified, purchase_orders)
  select p_org_id, r.erp_doctype, r.erp_name, r.supplier, r.supplier_name, r.doc_date, r.due_date, r.bill_no,
         r.currency, r.grand_total, r.net_total, r.outstanding_amount, r.erp_status, r.erp_docstatus,
         coalesce(r.is_return, false), r.erp_project, r.erp_modified, coalesce(r.purchase_orders, '{}')
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      erp_doctype text, erp_name text, supplier text, supplier_name text, doc_date date, due_date date,
      bill_no text, currency text, grand_total numeric, net_total numeric, outstanding_amount numeric, erp_status text,
      erp_docstatus smallint, is_return boolean, erp_project text, erp_modified text, purchase_orders text[])
  on conflict (org_id, erp_doctype, erp_name) do update set
    supplier = excluded.supplier, supplier_name = excluded.supplier_name, doc_date = excluded.doc_date,
    due_date = excluded.due_date, bill_no = excluded.bill_no, currency = excluded.currency,
    grand_total = excluded.grand_total, net_total = excluded.net_total, outstanding_amount = excluded.outstanding_amount,
    erp_status = excluded.erp_status, erp_docstatus = excluded.erp_docstatus, is_return = excluded.is_return,
    erp_project = excluded.erp_project, erp_modified = excluded.erp_modified, purchase_orders = excluded.purchase_orders,
    updated_at = now()
  where excluded.erp_modified > d.erp_modified;
  get diagnostics v_written = row_count;

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
    select d.id, g.project from public.erp_purchase_documents d
      join public.erp_gl_entry_mirror g
        on g.org_id = d.org_id and g.voucher_type = d.erp_doctype and g.voucher_no = d.erp_name
     where d.org_id = p_org_id and d.erp_doctype = 'Purchase Invoice'
       and g.project is not null and not g.is_cancelled
  ), stamped as (
    select d.id,
           coalesce(array_agg(distinct p.id order by p.id) filter (where p.id is not null), '{}') as project_ids,
           exists (select 1 from public.external_refs x
                    where x.org_id = p_org_id and x.domain = 'procurement' and x.external_tier = 'erpnext'
                      and x.external_record_id = d.erp_name) as pmo_owned
      from public.erp_purchase_documents d
      left join names n on n.id = d.id
      left join map on map.erp_name = n.erp_name
      left join public.projects p on p.id = map.project_id and p.org_id = p_org_id
     where d.org_id = p_org_id
     group by d.id, d.erp_name
  )
  update public.erp_purchase_documents d
     set project_ids = s.project_ids, pmo_owned = s.pmo_owned
    from stamped s
   where d.id = s.id and (d.project_ids is distinct from s.project_ids or d.pmo_owned is distinct from s.pmo_owned);

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
revoke all on function public.upsert_erp_purchase_documents(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_erp_purchase_documents(uuid, jsonb) to service_role;
