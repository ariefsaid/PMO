-- 0189_mirror_guards_currency_and_tax.sql — pin the columns 0187/0188 added into every
-- `*_native_mirror_guard` that ENUMERATES its native fields.
--
-- ── WHY THIS MIGRATION IS NOT OPTIONAL ─────────────────────────────────────────────────────────
-- A `*_native_mirror_guard` (0093/0098/0099/0100/0123 template) is a BEFORE UPDATE trigger that, while
-- the row's domain is externally-owned, raises 42501 if any field in its ENUMERATED denial set changed.
-- The set is a literal list of column names — a column added later is simply absent from it, and is
-- therefore USER-WRITABLE while the money it describes is owned by ERPNext. That is exactly how
-- `author_user_id` shipped unpinned (added by 0124 after 0123's guard) and had to be closed by 0125,
-- and it is the "closed one path, left the other open" shape behind SoD slices 2–6. `currency`
-- re-denominates every figure on the row; `tax_treatment` decides whether the stated amount includes
-- its tax. Both belong in the set.
--
-- Six guards enumerate their fields and are re-created below, each copied VERBATIM from its live
-- definition (pg_get_functiondef) with only the new `is distinct from` lines added:
--   sales_invoices (0125)  · incoming_payments (0123) · payments (0100) ·
--   procurement_invoices (0100) · purchase_orders (0099) · procurement_quotations (0098)
--
-- ⚑ `purchase_requests` and `rfqs` are deliberately NOT touched: their guards are BLANKET denials
-- (any user UPDATE while flipped raises, with no column list at all), so the new column is already
-- covered and adding an enumeration would WEAKEN them.
--
-- ⚑ Each function's volatility/security attributes are preserved exactly as they ship today —
-- `create or replace function` does NOT inherit them, and silently downgrading a SECURITY DEFINER
-- guard to INVOKER would change who can evaluate `domain_externally_owned`. Verified per function
-- against pg_get_functiondef before writing: procurement_quotations is SECURITY DEFINER; the other
-- five are INVOKER.
--
--
-- ⚑ NO TRIGGER IS RE-CREATED HERE, deliberately. A trigger binds to its function by OID and
-- `create or replace function` keeps that OID, so replacing the body is sufficient. Re-creating the
-- triggers (as 0125 did) would have been actively WRONG for two of these: the live trigger names are
-- NOT uniform — `procurement_quotations_zz_native_mirror_guard` and
-- `procurement_items_zz_native_mirror_guard` use the `zz` form (so they fire last), while the other
-- four use `<tbl>_native_mirror_guard_trg`. A `drop ... _trg; create ... _trg` here would have left
-- procurement_quotations with TWO guard triggers under a new name and a changed firing order.
--
-- ── Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse: re-run each
--    guard's pre-0189 body — 0125 (sales_invoices), 0123 (incoming_payments), 0100 (payments,
--    procurement_invoices), 0099 (purchase_orders), 0098 (procurement_quotations) — verbatim.

-- ============================================================================
-- §1 — sales_invoices: currency + the four 0188 tax columns (revenue domain)
-- ============================================================================
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
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
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- ============================================================================
-- §2 — incoming_payments: currency (revenue domain)
-- ============================================================================
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
     or new.currency is distinct from old.currency               -- 0187 (#478)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- ============================================================================
-- §3 — payments: currency (procurement domain)
-- ============================================================================
create or replace function public.payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.pay_number        is distinct from old.pay_number
     or new.reference_number is distinct from old.reference_number
     or new.amount           is distinct from old.amount
     or new.date             is distinct from old.date
     or new.invoice_id       is distinct from old.invoice_id
     or new.status           is distinct from old.status
     or new.erp_docstatus    is distinct from old.erp_docstatus
     or new.erp_modified     is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.currency         is distinct from old.currency        -- 0187 (#478)
     or new.id               is distinct from old.id
     or new.procurement_id   is distinct from old.procurement_id
     or new.org_id           is distinct from old.org_id
     or new.created_at       is distinct from old.created_at
  then
    raise exception 'payments native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- ============================================================================
-- §4 — procurement_invoices: currency (procurement domain)
-- ============================================================================
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

-- ============================================================================
-- §5 — purchase_orders: currency (procurement domain)
-- ============================================================================
create or replace function public.purchase_orders_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.po_number        is distinct from old.po_number
     or new.reference_number is distinct from old.reference_number
     or new.status           is distinct from old.status
     or new.date             is distinct from old.date
     or new.amount           is distinct from old.amount
     or new.erp_docstatus    is distinct from old.erp_docstatus
     or new.erp_modified     is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.currency         is distinct from old.currency        -- 0187 (#478)
     or new.id               is distinct from old.id
     or new.procurement_id   is distinct from old.procurement_id
     or new.org_id           is distinct from old.org_id
     or new.created_at       is distinct from old.created_at
  then
    raise exception 'purchase_orders native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- ============================================================================
-- §6 — procurement_quotations: currency (procurement domain). ⚑ SECURITY DEFINER — preserved.
-- ============================================================================
create or replace function public.procurement_quotations_native_mirror_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.total_amount    is distinct from old.total_amount
     or new.valid_until     is distinct from old.valid_until
     or new.rfq_id          is distinct from old.rfq_id
     or new.vq_number       is distinct from old.vq_number
     or new.reference       is distinct from old.reference
     or new.received_date   is distinct from old.received_date
     or new.erp_docstatus   is distinct from old.erp_docstatus
     or new.erp_modified    is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.currency        is distinct from old.currency         -- 0187 (#478)
  then
    raise exception 'procurement_quotations native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
