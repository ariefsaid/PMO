-- Restores create_payment to its 0534 body.

create or replace function public.create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
        v_bill_gross numeric;                                                                -- 0349
        v_currency text;                                                                     -- 0373
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, currency into v_org, v_currency from public.procurements where id = p_procurement_id; -- 0373
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  -- Same-case invariant (0039, AC-PR-SEC-001 / FR-ENA-130d): invoice must belong to the same case.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's payment writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_procurement_id, p_invoice_id), false) then   -- ECA-4 (PD-ECA-9)
    raise exception 'procurement is externally-owned — payments route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  -- ⚑ 0178: the origination-status gate. NULL is ACCEPTED on purpose (it is the permissive-capture
  -- default, sent by procurementRecords.ts and by four assertions in 0079) and the explicit
  -- `is not null` keeps the condition TOTAL — `p_status <> 'Scheduled'` alone is NULL for a NULL
  -- p_status and would fall through, which is 0176 §6's defect exactly.
  if p_status is not null and p_status <> 'Scheduled' then
    raise exception
      'payments.status "%" is not an origination status: a payment record is captured as Scheduled, and Paid is reached only by paying the case — the transition that is Finance-only and enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_amount is not null then                                                               -- 0349
    perform 1 from public.procurements where id = p_procurement_id for update;               -- 0349
    select sum(i.amount + case when i.tax_treatment = 'exclusive' then i.tax_amount else 0 end) -- 0349
      into v_bill_gross from public.procurement_invoices i                                   -- 0349
     where i.procurement_id = p_procurement_id and i.amount is not null                      -- 0349
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null;                 -- 0349
    if v_bill_gross is not null and p_amount + coalesce((                                    -- 0349
         select sum(pay.amount) from public.payments pay                                     -- 0349
          where pay.procurement_id = p_procurement_id                                        -- 0349
            and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null), 0)    -- 0349
         > v_bill_gross then                                                                 -- 0349
      raise exception 'scheduled payments cannot exceed the billed gross amount'             -- 0349
        using errcode = '23514';                                                             -- 0349
    end if;                                                                                  -- 0349
  end if;                                                                                    -- 0349
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, currency)                                      -- 0373
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, v_currency)                       -- 0373
    returning * into v_row;
  return v_row;
end; $$;
