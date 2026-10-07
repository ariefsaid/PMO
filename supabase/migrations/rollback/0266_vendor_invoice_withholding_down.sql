-- Rollback for 0266_vendor_invoice_withholding.sql (#876). Revert the #876 edge functions FIRST (they write
-- withheld_amount). Restores 0196 §4's mirror-guard body, then drops the constraint and the column. Bills mirrored
-- with withholding keep their GROSS `amount`; re-mirror them if the rollback is permanent.
create or replace function public.procurement_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.vi_number             is distinct from old.vi_number
     or new.invoice_date          is distinct from old.invoice_date
     or new.reference_number      is distinct from old.reference_number
     or new.amount                is distinct from old.amount
     or new.po_id                 is distinct from old.po_id
     or new.status                is distinct from old.status
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.erp_docstatus         is distinct from old.erp_docstatus
     or new.erp_modified          is distinct from old.erp_modified
     or new.erp_amended_from      is distinct from old.erp_amended_from
     or new.erp_cancelled_at      is distinct from old.erp_cancelled_at
     or new.currency              is distinct from old.currency   -- 0187 (#478)
     or new.tax_treatment         is distinct from old.tax_treatment -- 0196 (#505)
     or new.tax_amount            is distinct from old.tax_amount    -- 0196 (#505)
     or new.tax_rate              is distinct from old.tax_rate      -- 0196 (#505)
     or new.tax_template          is distinct from old.tax_template  -- 0196 (#505)
     or new.id                    is distinct from old.id
     or new.procurement_id        is distinct from old.procurement_id
     or new.org_id                is distinct from old.org_id
     or new.created_at            is distinct from old.created_at
  then
    raise exception 'procurement_invoices native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

alter table public.procurement_invoices drop constraint if exists procurement_invoices_withheld_amount_bounds;
alter table public.procurement_invoices drop column if exists withheld_amount;

notify pgrst, 'reload schema';
