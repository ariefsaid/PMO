drop trigger if exists procurement_erp_document_refresh_native_total on public.erp_purchase_documents;
drop function if exists public.refresh_native_purchase_total_on_erp_document_update();

-- Restore 0372's linked-only value basis.
create or replace function public.erp_linked_documents_total(p_procurement_id uuid) returns numeric
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

-- Restore 0371's PMO-only refresh function.
create or replace function public.refresh_procurement_recorded_total(p_procurement_id uuid, p_had_document boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype; v_order numeric; v_invoice numeric; v_payment numeric; v_total numeric;
begin
  select * into v_row from public.procurements where id = p_procurement_id for update;
  if not found or v_row.origin is not distinct from 'erp_link' or v_row.status = 'Requested'
     or v_row.approved_total_value is not null or v_row.approved_by_id is not null or v_row.pr_number is not null
     or exists (select 1 from public.procurement_items i where i.procurement_id = v_row.id)
     or exists (select 1 from public.procurement_status_events e
                 where e.procurement_id = v_row.id
                   and e.to_status in ('Requested'::procurement_status, 'Approved'::procurement_status)) then
    return;
  end if;
  select sum(po.amount) into v_order from public.purchase_orders po
   where po.procurement_id = v_row.id and po.org_id = v_row.org_id and po.amount is not null
     and po.currency is not distinct from v_row.currency
     and coalesce(po.erp_docstatus, 1) <> 2 and po.erp_cancelled_at is null;
  select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
    into v_invoice from public.procurement_invoices i
   where i.procurement_id = v_row.id and i.org_id = v_row.org_id and i.amount is not null
     and i.currency is not distinct from v_row.currency
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     and not (i.vi_number is not null and exists (
       select 1 from public.procurement_invoices successor
        where successor.procurement_id = i.procurement_id and successor.org_id = v_row.org_id
          and successor.erp_amended_from = i.vi_number
          and coalesce(successor.erp_docstatus, 1) <> 2 and successor.erp_cancelled_at is null));
  select sum(pay.amount) into v_payment from public.payments pay
   where pay.procurement_id = v_row.id and pay.org_id = v_row.org_id and pay.amount is not null
     and pay.currency is not distinct from v_row.currency
     and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null;
  v_total := coalesce(greatest(v_order, v_invoice), v_payment);
  if v_total is null then
    if not (p_had_document
            or exists (select 1 from public.purchase_orders x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)
            or exists (select 1 from public.procurement_invoices x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)
            or exists (select 1 from public.payments x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)) then
      return;
    end if;
    v_total := 0;
  end if;
  update public.procurements set total_value = v_total, updated_at = now()
   where id = v_row.id and total_value is distinct from v_total;
end $$;
revoke all on function public.refresh_procurement_recorded_total(uuid, boolean) from public, anon, authenticated;

drop function if exists public.procurement_document_total(uuid, jsonb);
