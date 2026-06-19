-- 0039_same_case_fk_invariant.sql — Security hardening: same-case settlement FK invariant.
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- Closes the referential pollution + existence oracle (23503) hole found in the security audit:
-- plain FK constraints bypass RLS, so a cross-case/cross-org link was previously accepted.
-- This migration enforces the same-case invariant at the data layer for all write paths
-- (RPC, RLS-direct, future UI).
--
-- Invariant: if a nullable settlement FK is non-null, the referenced predecessor's
-- procurement_id MUST equal the row's own procurement_id.
-- Error code 42501 (uniform — does NOT leak existence like 23503 does).
--
-- Scope (4 FKs):
--   1. payments.invoice_id           → create_payment RPC guard (Task §1)
--   2. procurement_receipts.po_id    → BEFORE INSERT OR UPDATE trigger (Task §2)
--   3. procurement_invoices.po_id    → BEFORE INSERT OR UPDATE trigger (Task §2)
--   4. procurement_quotations.rfq_id → BEFORE INSERT OR UPDATE trigger (Task §2)
--
-- Rollback (forward):
--   drop trigger if exists procurement_quotations_check_rfq_case on procurement_quotations;
--   drop trigger if exists procurement_invoices_check_po_case    on procurement_invoices;
--   drop trigger if exists procurement_receipts_check_po_case    on procurement_receipts;
--   drop function if exists check_procurement_quotations_rfq_case();
--   drop function if exists check_procurement_invoices_po_case();
--   drop function if exists check_procurement_receipts_po_case();
--   (then replace create_payment via supabase db reset — pre-prod only)
--
-- AC-PR-SEC-001 / AC-PR-SEC-002 / AC-PR-SEC-003 / AC-PR-SEC-004 (0082 test file)

-- ============================================================================
-- §1 — create_payment: add same-case invoice_id guard before insert
-- Body is 0037's create_payment VERBATIM except for the new guard block.
-- Re-grant block identical to 0037.
-- SECURITY: parent-org guard + 4-role gate re-asserted MUST stay — removing them bypasses RLS.
-- ============================================================================
create or replace function create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Same-case invariant: invoice must belong to the same procurement case (AC-PR-SEC-001).
  -- 42501 is used (uniform, does not leak existence like 23503 would).
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  insert into public.payments (procurement_id, invoice_id, pay_number, reference_number, status, date, amount)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_payment(uuid, uuid, text, text, date, numeric) from public;
grant  execute on function create_payment(uuid, uuid, text, text, date, numeric) to   authenticated;
revoke execute on function create_payment(uuid, uuid, text, text, date, numeric) from anon;

-- ============================================================================
-- §2 — Constraint triggers: same-case invariant on RLS-direct settlement FK columns.
-- Pattern mirrors the stamp-trigger style in 0015/0035/0036.
-- SECURITY INVOKER (no definer rights needed — reads the parent table, no RLS bypass required).
-- search_path pinned; all refs schema-qualified (LOW-BV-1).
-- Fires BEFORE INSERT OR UPDATE to enforce the invariant on ALL write paths.
-- Condition: if the FK column is non-null AND the referenced parent's procurement_id differs
-- from the row's own procurement_id → raise 42501 (uniform; no existence leak).
-- ============================================================================

-- § 2a — procurement_receipts.po_id → purchase_orders (AC-PR-SEC-002)
create or replace function check_procurement_receipts_po_case()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.po_id is not null
     and (select po.procurement_id from public.purchase_orders po where po.id = new.po_id)
         is distinct from new.procurement_id
  then
    raise exception 'po not in this case' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger procurement_receipts_check_po_case
  before insert or update on public.procurement_receipts
  for each row execute function check_procurement_receipts_po_case();

-- § 2b — procurement_invoices.po_id → purchase_orders (AC-PR-SEC-003)
create or replace function check_procurement_invoices_po_case()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.po_id is not null
     and (select po.procurement_id from public.purchase_orders po where po.id = new.po_id)
         is distinct from new.procurement_id
  then
    raise exception 'po not in this case' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger procurement_invoices_check_po_case
  before insert or update on public.procurement_invoices
  for each row execute function check_procurement_invoices_po_case();

-- § 2c — procurement_quotations.rfq_id → rfqs (AC-PR-SEC-004)
create or replace function check_procurement_quotations_rfq_case()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.rfq_id is not null
     and (select r.procurement_id from public.rfqs r where r.id = new.rfq_id)
         is distinct from new.procurement_id
  then
    raise exception 'rfq not in this case' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger procurement_quotations_check_rfq_case
  before insert or update on public.procurement_quotations
  for each row execute function check_procurement_quotations_rfq_case();
