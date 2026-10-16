-- S-06 (RF-030/031): a receipt's invoice allocations, as the ERP reported them.
-- null = the source did not report coverage (every historical row); '[]' = it reported none (an on-account receipt).
-- Element shape: {invoice_id uuid|null, invoice_number text, amount "123.45"|null, currency text|null}.
-- Reversal: rollback/0301_receipt_allocation_details_down.sql.
alter table public.incoming_payments
  add column allocation_details jsonb
    check (allocation_details is null or jsonb_typeof(allocation_details) = 'array');

-- Body carried forward from 0275; the only change is that the mirrored allocations are read-only to a user JWT
-- while revenue is externally owned (the machine feed writes them with the service role).
create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.received_amount is distinct from old.received_amount
     or new.withheld_amount is distinct from old.withheld_amount
     or new.withholding_slip_number is distinct from old.withholding_slip_number
     or new.allocation_details is distinct from old.allocation_details   -- 0301 (S-06)
     or new.currency is distinct from old.currency               -- 0187 (#478)
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.cancelled_at is distinct from old.cancelled_at       -- 0275 (#784)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
