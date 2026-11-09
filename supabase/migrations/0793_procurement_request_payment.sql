-- 0793: (1) transition-then-capture leaves one purchase request: create_purchase_request completes the bare request the
--     Draft -> Requested transition wrote instead of adding a second (mirror of 0712 for orders; capture-then-transition is
--     0766). It also takes the purchase row lock (body = 0238 + the lock 0771 adds). (2) create_payment: with no live
--     vendor bill, payments (this one included) may not exceed the purchase's approved amount, nor add to a Paid purchase.
--     Body = 0710 plus the cap. Rollback: rollback/0793_procurement_request_payment_down.sql

create or replace function public.create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
        v_bill_gross numeric; v_has_bills boolean;                                           -- 0349, #1354
        v_currency text;                                                                     -- 0373
        v_status procurement_status; v_approved numeric; v_cap numeric; v_paid numeric;      -- 0793
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, currency into v_org, v_currency
    from public.procurements where id = p_procurement_id;                                    -- 0373
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
    -- 0793: status and approved amount are read under the row lock, so a Paid transition that committed while this
    -- call waited is seen. Approved 0 is a cap of 0 (nothing payable without a bill); never approved is no cap.
    select status, approved_total_value into v_status, v_approved
      from public.procurements where id = p_procurement_id for update;                       -- 0349, 0793
    -- #1354: compared in the payment's own currency (the purchase's). A bill or payment in another currency
    -- (an ERP mirror row) is never added to this sum, so it can neither lift nor eat into this currency's cap.
    -- Bills exist but none in this currency => billed 0 here => refused.
    select coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then i.tax_amount else 0 end)
                    filter (where coalesce(i.currency, v_currency) = v_currency), 0), count(*) > 0
      into v_bill_gross, v_has_bills from public.procurement_invoices i
     where i.procurement_id = p_procurement_id and i.amount is not null
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null;
    select coalesce(sum(pay.amount), 0) into v_paid from public.payments pay
     where pay.procurement_id = p_procurement_id
       and coalesce(pay.currency, v_currency) = v_currency
       and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null;
    if v_has_bills and p_amount + v_paid > v_bill_gross then
      raise exception 'scheduled payments cannot exceed the billed gross amount'
        using errcode = '23514';
    end if;
    -- 0793: no live vendor bill → payments (this one included) may not pass the approved amount (pre-tax: the
    -- procurement stores no tax for it, so a tax-inclusive payment waits for its bill); once the purchase is Paid with
    -- no bill, nothing more may be added to what it already paid. (total_value follows the recorded payments on an
    -- unapproved purchase, so it is no ceiling; an unapproved, unpaid purchase has no cap at all.)
    if not v_has_bills then
      v_cap := least(v_approved, case when v_status = 'Paid' then v_paid end);
      if v_cap is not null and p_amount + v_paid > v_cap then
        raise exception '%', case when v_status = 'Paid' then 'payments cannot be added to a paid purchase'
          else 'payments cannot exceed the approved amount until the vendor bill is recorded' end
          using errcode = '23514';
      end if;
    end if;
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

-- create_purchase_request → procurement. 0793: completes the bare request the Draft → Requested transition wrote (the
-- purchase's own PR number, nothing captured on it) instead of adding a second. Locks the purchase row first, as
-- transition_procurement does (0771 #2039), so a capture racing the transition serializes with it.
create or replace function public.create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests; v_pr_number text;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, pr_number into v_org, v_pr_number
    from public.procurements where id = p_procurement_id for update;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_pr_number is not null and p_import_key is null then
    update public.purchase_requests
       set reference_number = p_reference_number, status = coalesce(p_status, 'Draft'), date = p_date, amount = p_amount,
           external_ref = nullif(btrim(p_external_ref), '')
     where id = (select r.id from public.purchase_requests r
                  where r.procurement_id = p_procurement_id and r.pr_number = v_pr_number
                    and r.reference_number is null and r.amount is null and r.import_key is null
                    and r.external_ref is null and r.status = 'Submitted' and r.date = r.created_at::date
                  order by r.created_at limit 1 for update)
    returning * into v_row;
    if found then return v_row; end if;
  end if;
  insert into public.purchase_requests
    (procurement_id, pr_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''))
    returning * into v_row;
  return v_row;
end; $$;
