-- 0266_vendor_invoice_withholding.sql — #876: vendor withholding (PPh 23 / PPh 4(2)) on ERP-owned bills.
--
-- ADR-0082, DD-VWH-1 / DD-VWH-7. One additive column, its bounds, one line in the procurement mirror guard.
--   • withheld_amount — income tax withheld from the vendor on this bill (ERPNext Purchase Invoice header
--     `taxes_and_charges_deducted`). `amount` stays the GROSS bill and `tax_amount` stays VAT only; the net payable
--     to the vendor is `amount - withheld_amount`, derived and never stored.
--   • DEFAULT 0 is deliberate: every writer other than the ERP mirror is PMO-native, where nothing is withheld, so 0
--     is a fact there; the mirror writer states the value on every create (readModelWriters.ts, AC-VWH-006).
--   • Bounds: finite (the upper bound is what rejects NaN — 0169's lesson); zero, or the same sign as `amount` and no
--     larger in magnitude (a return carries a negative withholding with its negative amount — 0196's sign parity).
--   • Grants: none issued. §3 asserts on the database being migrated that the column is not client-writable, so an
--     environment whose grants differ from local fails here instead of shipping a writable money column.
--
-- Deploy precondition (operator): bills mirrored before this migration keep their old figures until ERPNext next
-- modifies them. Before applying beyond local, list the target ERPNext's Purchase Invoices with
-- taxes_and_charges_deducted <> 0 that PMO mirrors, and re-mirror any found.
--
-- Rollback: supabase/migrations/rollback/0266_vendor_invoice_withholding_down.sql (revert the #876 edge functions
-- first — they write this column).

-- §1 — the column and its bounds.
alter table public.procurement_invoices
  add column if not exists withheld_amount numeric(14,2) not null default 0;

-- Re-runnable like the column above: drop-then-add, so a second run re-asserts the bounds instead of failing (42710).
alter table public.procurement_invoices
  drop constraint if exists procurement_invoices_withheld_amount_bounds;
alter table public.procurement_invoices
  add constraint procurement_invoices_withheld_amount_bounds
  check (withheld_amount > '-Infinity'::numeric and withheld_amount < 'Infinity'::numeric
         and (withheld_amount = 0
              or (amount is not null
                  and sign(withheld_amount) = sign(amount)
                  and abs(withheld_amount) <= abs(amount))));

comment on column public.procurement_invoices.withheld_amount is
  '#876 (ADR-0082): income tax withheld from the vendor on this bill (PPh 23 / PPh 4(2)), in `currency`. ERPNext '
  'Purchase Invoice header taxes_and_charges_deducted. `amount` is the gross bill; the net payable to the vendor is '
  'amount - withheld_amount. 0 = nothing withheld.';

-- §2 — the procurement mirror guard ENUMERATES its denial set (0196 §4), so the new column must be named. Body is
-- 0196 §4's verbatim plus one line. No trigger is re-created: the trigger binds by OID and `create or replace` keeps
-- it (0189/0196). Attributes preserved: SECURITY INVOKER, `set search_path = public`.
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
     or new.withheld_amount       is distinct from old.withheld_amount -- 0266 (#876)
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

-- §3 — on-database assert: the new money column is not client-writable HERE (whatever the local grants were).
do $$
begin
  if has_column_privilege('authenticated', 'public.procurement_invoices', 'withheld_amount', 'INSERT')
     or has_column_privilege('authenticated', 'public.procurement_invoices', 'withheld_amount', 'UPDATE')
     or has_column_privilege('anon', 'public.procurement_invoices', 'withheld_amount', 'INSERT')
     or has_column_privilege('anon', 'public.procurement_invoices', 'withheld_amount', 'UPDATE')
  then
    raise exception '0266: procurement_invoices.withheld_amount would be client-writable on this database; a table-level INSERT/UPDATE grant is present (see 0174/0175) — resolve it before applying';
  end if;
end $$;

notify pgrst, 'reload schema';
