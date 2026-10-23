-- Reverses 0361. Linked documents become orphans again; purchases created from them stay (Draft or derived status).
-- Restore 0350's approved-amount ceiling, 0360's purchase-mirror upsert and 0350's Engineer file scope.
create or replace function public.procurement_payment_within_ceiling(p_procurement_id uuid)
returns table(ok boolean, reason text, billed_net numeric, approved_amount numeric)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid; v_currency text; v_ceiling numeric; v_total numeric; v_net numeric; v_count integer;
begin
  select p.org_id, p.currency, p.approved_total_value, p.total_value
    into v_org, v_currency, v_ceiling, v_total
    from public.procurements p where p.id = p_procurement_id;
  if not found then return; end if;
  if auth.uid() is not null
     and (v_org is distinct from public.auth_org_id() or not public.is_active_member()
          or not coalesce(public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'), false)) then
    return;
  end if;
  if exists (select 1 from public.procurement_invoices i
              where i.procurement_id = p_procurement_id
                and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
                and i.currency is distinct from v_currency) then
    return query select false, 'bill currency differs from procurement currency', null::numeric, v_ceiling;
    return;
  end if;
  select coalesce(sum(case when i.tax_treatment = 'inclusive' then i.amount - i.tax_amount else i.amount end), 0),
         count(*)
    into v_net, v_count
    from public.procurement_invoices i
   where i.procurement_id = p_procurement_id
     and i.amount is not null
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     and not (i.vi_number is not null and exists (
       select 1 from public.procurement_invoices successor
        where successor.procurement_id = i.procurement_id
          and successor.erp_amended_from = i.vi_number
          and coalesce(successor.erp_docstatus, 1) <> 2 and successor.erp_cancelled_at is null));
  if v_count = 0 then v_net := v_total; end if;
  if v_ceiling is null then
    return query select false, 'approved amount is missing', v_net, null::numeric;
    return;
  end if;
  return query select v_net <= v_ceiling,
                      case when v_net <= v_ceiling then null else 'vendor bill exceeds approved amount' end,
                      v_net, v_ceiling;
end; $$;

create or replace function public.upsert_erp_purchase_documents(p_org_id uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_written integer;
begin
  insert into public.erp_purchase_documents as d (
    org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
    grand_total, net_total, outstanding_amount, erp_status, erp_docstatus, is_return, erp_project, erp_modified)
  select p_org_id, r.erp_doctype, r.erp_name, r.supplier, r.supplier_name, r.doc_date, r.due_date, r.bill_no,
         r.currency, r.grand_total, r.net_total, r.outstanding_amount, r.erp_status, r.erp_docstatus,
         coalesce(r.is_return, false), r.erp_project, r.erp_modified
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      erp_doctype text, erp_name text, supplier text, supplier_name text, doc_date date, due_date date,
      bill_no text, currency text, grand_total numeric, net_total numeric, outstanding_amount numeric, erp_status text,
      erp_docstatus smallint, is_return boolean, erp_project text, erp_modified text)
  on conflict (org_id, erp_doctype, erp_name) do update set
    supplier = excluded.supplier, supplier_name = excluded.supplier_name, doc_date = excluded.doc_date,
    due_date = excluded.due_date, bill_no = excluded.bill_no, currency = excluded.currency,
    grand_total = excluded.grand_total, net_total = excluded.net_total, outstanding_amount = excluded.outstanding_amount,
    erp_status = excluded.erp_status, erp_docstatus = excluded.erp_docstatus, is_return = excluded.is_return,
    erp_project = excluded.erp_project, erp_modified = excluded.erp_modified, updated_at = now()
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

  return v_written;
end $$;
revoke all on function public.upsert_erp_purchase_documents(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_erp_purchase_documents(uuid, jsonb) to service_role;
alter table public.erp_purchase_documents drop column if exists purchase_orders;
alter policy procurement_documents_engineer_read_scope on public.procurement_documents
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = procurement_documents.procurement_id
                       and p.requested_by_id = (select auth.uid())));
drop function if exists public.link_procurement_sharepoint_item(uuid, text, uuid, jsonb);
drop function if exists public.unlink_erp_purchase_document(uuid);
drop function if exists public.link_erp_purchase_documents(jsonb, boolean);
drop function if exists public.refresh_erp_linked_purchase_total(uuid);
drop function if exists public.project_committed_spend(uuid);
drop function if exists public.procurement_open_commitment(public.procurements);
drop function if exists public.procurement_ledger_held(uuid);
drop trigger if exists procurement_documents_record_guard on public.procurement_documents;
drop function if exists public.guard_procurement_document_record();
alter table public.procurement_documents drop constraint if exists procurement_documents_record_pair,
  drop column if exists record_id, drop column if exists record_kind;
update public.record_history_config set omit_cols = array_remove(omit_cols, 'origin') where table_name = 'procurements';
alter table public.procurements drop column if exists origin;
delete from public.procurement_erp_links;
