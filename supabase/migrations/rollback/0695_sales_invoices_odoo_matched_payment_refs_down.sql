-- Reversal of 0695_sales_invoices_odoo_matched_payment_refs.sql (#1825).
-- Restore the 0511 guard (without the odoo_matched_payment_refs pin), drop the read-back merge RPC
-- and the column (the column default drops with the column).

drop function if exists public.record_sales_invoice_receipt_read_back(uuid, uuid, text[], text, numeric, text, timestamptz);

create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  -- 0511 (#1506 C3): the Odoo facts are written only by the service-role mirror writer. Pinned before the externally-owned early
  -- return, so a person never sets them directly, whoever owns revenue (the client UPDATE grant is already revoked, 0176; this is the trigger layer).
  if new.odoo_state is distinct from old.odoo_state
     or new.odoo_attention is distinct from old.odoo_attention
     or new.odoo_sent_total is distinct from old.odoo_sent_total
     or new.odoo_read_at is distinct from old.odoo_read_at then
    raise exception 'the Odoo facts of an invoice are written only by the mirror' using errcode = '42501';
  end if;
  -- 0498 (#1602): the pair columns are written only by accept_invoice_pairs (a definer, current_user = postgres, flag set
  -- in its own transaction). Pinned before the externally-owned early return: a person never sets them directly.
  if (new.paired_erp_invoice_id is distinct from old.paired_erp_invoice_id
      or new.paired_at is distinct from old.paired_at
      or new.paired_by is distinct from old.paired_by
      or new.paired_filled is distinct from old.paired_filled)
     and not (current_user = 'postgres' and coalesce(current_setting('pmo.invoice_pairing', true), '') = 'on') then
    raise exception 'an invoice is paired only by accepting a proposed pair' using errcode = '42501';
  end if;
  -- A paired copy counts through its ERP invoice: no native status, amount or balance write, even if PMO later owns revenue again.
  if old.paired_erp_invoice_id is not null and new.paired_erp_invoice_id is not distinct from old.paired_erp_invoice_id
     and (new.status is distinct from old.status or new.amount is distinct from old.amount
          or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
          or new.overpaid_amount is distinct from old.overpaid_amount
          or new.native_lines is distinct from old.native_lines) then
    raise exception 'a paired invoice counts through its ERP invoice and cannot be changed in PMO' using errcode = '42501';
  end if;
  if new.erp_project is distinct from old.erp_project then
    raise exception 'ERP project provenance is read-only' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
     or (new.billing_kind is distinct from old.billing_kind and current_user <> 'postgres') -- 0410 (#1471): only the definer RPCs change it
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or (new.work_order_id is distinct from old.work_order_id    -- 0193 (#498): which scope grant this bills
         and not (current_user = 'postgres' and coalesce(current_setting('pmo.invoice_pairing', true), '') = 'on')) -- 0498: accept fills an empty one, unpair clears what it filled
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0275 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0275 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0275 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0275 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0275 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0275 (#784, DD-NAR-16)
     or (old.pmo_native and new.received_date is distinct from old.received_date) -- 0275: a PMO invoice is frozen whole
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

alter table public.sales_invoices drop column if exists odoo_matched_payment_refs;
