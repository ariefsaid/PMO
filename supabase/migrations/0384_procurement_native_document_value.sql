-- 0384: one document-value basis for a native purchase's linked ERP documents and PMO records (#1350).
-- Sum each document kind across its sources; where orders or invoices exist, use the greater of the
-- order total and pre-tax invoice total. Otherwise use linked receipts, then payments. Cancellations,
-- currency mismatches and superseded invoices do not count. Rollback: rollback/0384_procurement_native_document_value_down.sql

-- The optional old-row map reconstructs the whole statement's pre-update basis.
create function public.procurement_document_total(
  p_procurement_id uuid,
  p_override_documents jsonb default '{}'::jsonb
) returns numeric
language sql volatile security definer set search_path = public, pg_catalog as $$
  with purchase as (
    select p.id, p.org_id, p.currency, p.origin
      from public.procurements p
     where p.id = p_procurement_id
  ), erp_candidates as (
    select d.id, d.erp_doctype, d.erp_name,
           case when p_override_documents ? d.id::text
                then (p_override_documents -> d.id::text ->> 'erp_docstatus')::smallint else d.erp_docstatus end as docstatus,
           case when p_override_documents ? d.id::text
                then p_override_documents -> d.id::text ->> 'currency' else d.currency end as currency,
           case when p_override_documents ? d.id::text
                then coalesce((p_override_documents -> d.id::text ->> 'net_total')::numeric,
                              (p_override_documents -> d.id::text ->> 'grand_total')::numeric)
                else coalesce(d.net_total, d.grand_total) end as amount,
           p.currency as purchase_currency
      from purchase p
      join public.procurement_erp_links l on l.procurement_id = p.id and l.org_id = p.org_id
      join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id and d.org_id = p.org_id
  -- A recovered PMO mirror defers to its linked ERP identity, including cancellation state.
  ), documents as (
    select 'Purchase Order'::text as doctype, po.amount
      from purchase p
      join public.purchase_orders po on po.procurement_id = p.id and po.org_id = p.org_id
     where p.origin is distinct from 'erp_link'
       and not exists (
         select 1 from erp_candidates e
         join public.external_refs x on x.org_id = p.org_id and x.domain = 'procurement'
           and x.external_tier = 'erpnext' and x.external_record_id = e.erp_name
           and x.pmo_record_id = po.id::text
         where e.erp_doctype = 'Purchase Order')
       and po.amount is not null and po.currency is not distinct from p.currency
       and coalesce(po.erp_docstatus, 1) <> 2 and po.erp_cancelled_at is null
    union all
    select 'Purchase Invoice',
           case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end
      from purchase p
      join public.procurement_invoices i on i.procurement_id = p.id and i.org_id = p.org_id
     where p.origin is distinct from 'erp_link'
       and not exists (
         select 1 from erp_candidates e
         join public.external_refs x on x.org_id = p.org_id and x.domain = 'procurement'
           and x.external_tier = 'erpnext' and x.external_record_id = e.erp_name
           and x.pmo_record_id = i.id::text
         where e.erp_doctype = 'Purchase Invoice')
       and i.amount is not null and i.currency is not distinct from p.currency
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
       and not (i.vi_number is not null and exists (
         select 1 from public.procurement_invoices successor
          where successor.procurement_id = i.procurement_id and successor.org_id = p.org_id
            and successor.erp_amended_from = i.vi_number
            and coalesce(successor.erp_docstatus, 1) <> 2 and successor.erp_cancelled_at is null))
    union all
    select 'Payment Entry', pay.amount
      from purchase p
      join public.payments pay on pay.procurement_id = p.id and pay.org_id = p.org_id
     where p.origin is distinct from 'erp_link'
       and not exists (
         select 1 from erp_candidates e
         join public.external_refs x on x.org_id = p.org_id and x.domain = 'procurement'
           and x.external_tier = 'erpnext' and x.external_record_id = e.erp_name
           and x.pmo_record_id = pay.id::text
         where e.erp_doctype = 'Payment Entry')
       and pay.amount is not null and pay.currency is not distinct from p.currency
       and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
    union all
    select e.erp_doctype, e.amount
      from erp_candidates e
     where e.docstatus = 1 and e.amount is not null
       and e.currency is not distinct from e.purchase_currency
  ), totals as (
    select sum(amount) filter (where doctype = 'Purchase Order') as order_total,
           sum(amount) filter (where doctype = 'Purchase Invoice') as invoice_total,
           sum(amount) filter (where doctype = 'Purchase Receipt') as receipt_total,
           sum(amount) filter (where doctype = 'Payment Entry') as payment_total
      from documents
  )
  select case
    when order_total is not null or invoice_total is not null
      then greatest(coalesce(order_total, 0), coalesce(invoice_total, 0))
    when receipt_total is not null then receipt_total
    else payment_total
  end
    from totals
$$;
revoke all on function public.procurement_document_total(uuid, jsonb)
  from public, anon, authenticated;

-- Existing 0372 callers take the before/after value through this helper; for native purchases the
-- shared basis now includes PMO records as well as linked ERP documents. ERP-origin purchases retain
-- 0372's linked-only, order-first rule.
create or replace function public.erp_linked_documents_total(p_procurement_id uuid) returns numeric
language sql volatile set search_path = public, pg_catalog as $$
  with docs as (
    select d.erp_doctype, coalesce(d.net_total, d.grand_total) as amount
      from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.procurement_id = p_procurement_id and d.erp_docstatus = 1
  )
  select case when exists (select 1 from public.procurements p
                           where p.id = p_procurement_id and p.origin = 'erp_link') then
    coalesce(
      (select sum(amount) from docs where erp_doctype = 'Purchase Order'   having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Purchase Invoice' having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Purchase Receipt' having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Payment Entry'    having count(*) > 0),
      0)
    else coalesce(public.procurement_document_total(p_procurement_id), 0) end
$$;
revoke all on function public.erp_linked_documents_total(uuid) from public, anon, authenticated;

-- 0371 already refreshes on PMO record changes. Keep its approval, status and line-item guards, but
-- compute from the same linked-plus-recorded basis so a new PMO record cannot replace a linked total.
create or replace function public.refresh_procurement_recorded_total(p_procurement_id uuid, p_had_document boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype; v_total numeric;
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

  v_total := public.procurement_document_total(v_row.id);
  if v_total is null then
    -- If every amount-bearing document stopped counting, replace the old value with 0. If no amount
    -- ever stood here, leave the header alone.
    if not (p_had_document
            or exists (select 1 from public.purchase_orders x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)
            or exists (select 1 from public.procurement_invoices x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)
            or exists (select 1 from public.payments x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)
            or exists (select 1 from public.procurement_erp_links l
                         join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                        where l.procurement_id = v_row.id and l.org_id = v_row.org_id and d.org_id = v_row.org_id
                          and coalesce(d.net_total, d.grand_total) is not null
                          and d.currency is not distinct from v_row.currency)) then
      return;
    end if;
    v_total := 0;
  end if;

  update public.procurements set total_value = v_total, updated_at = now()
   where id = v_row.id and total_value is distinct from v_total;
end $$;
revoke all on function public.refresh_procurement_recorded_total(uuid, boolean) from public, anon, authenticated;

-- A transition table retains every old document in the statement. Refresh each affected purchase
-- once, comparing its stored value with the whole old basis so typed totals still stay untouched.
create function public.refresh_native_purchase_total_on_erp_document_update() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_purchase record; v_before numeric;
begin
  if auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then return null; end if;

  for v_purchase in
    select l.procurement_id, l.org_id, jsonb_object_agg(o.id::text, to_jsonb(o)) as old_documents
      from old_documents o
      join new_documents n on n.id = o.id and n.org_id = o.org_id
      join public.procurement_erp_links l on l.org_id = o.org_id and l.erp_purchase_document_id = o.id
     where o.erp_docstatus is distinct from n.erp_docstatus
        or o.net_total is distinct from n.net_total
        or o.grand_total is distinct from n.grand_total
        or o.currency is distinct from n.currency
     group by l.procurement_id, l.org_id
     order by l.procurement_id
  loop
    begin
      v_before := coalesce(public.procurement_document_total(v_purchase.procurement_id, v_purchase.old_documents), 0);
      perform public.refresh_native_purchase_total_from_links(v_purchase.procurement_id, v_before);
    exception when others then
      if auth.uid() is not null then raise; end if;
      perform public.log_audit('procurement.total_refresh_skipped', v_purchase.org_id, null, v_purchase.procurement_id,
        jsonb_build_object('record', 'erp_purchase_documents', 'reason', sqlerrm));
    end;
  end loop;
  return null;
end $$;
revoke all on function public.refresh_native_purchase_total_on_erp_document_update() from public, anon, authenticated;

create trigger procurement_erp_document_refresh_native_total
  after update on public.erp_purchase_documents
  referencing old table as old_documents new table as new_documents
  for each statement
  execute function public.refresh_native_purchase_total_on_erp_document_update();
