-- 0041_gr_vi_rpc_reference_amount.sql — Extend create_procurement_receipt / create_procurement_invoice
-- to accept and persist the new reference_number (GR) and reference_number + amount (VI) columns
-- added in migration 0040.
--
-- SECURITY: the parent-org guard + role gate re-assertions are PRESERVED verbatim from
-- 0018_authz_hardening.sql (GR) and 0006_procurement_lifecycle.sql (VI). These re-assertions
-- MUST stay — removing them would bypass the security-definer fence (ADR-0009/HIGH-1).
--
-- Approach: `create or replace function` — replaces the existing body in-place, preserving
-- the function OID, grants, and dependency graph. Grant/revoke block re-stated for clarity
-- (idempotent).
--
-- Rollback: restore prior function bodies from 0018 (GR) and 0006 (VI) — or `supabase db reset`.

-- ============================================================================
-- create_procurement_receipt (GR): add p_reference_number text parameter.
-- Tightened-role gate from 0018 is PRESERVED (Admin OR PM OR original requester).
-- Drop the old 3-arg signature first — `create or replace` with a different
-- signature creates a NEW overload, not a replacement, causing 42725 ambiguity.
-- ============================================================================
drop function if exists create_procurement_receipt(uuid, procurement_receipt_status, date);
create or replace function create_procurement_receipt(
  p_procurement_id uuid,
  p_status         procurement_receipt_status,
  p_receipt_date   date,
  p_reference_number text default null)
  returns procurement_receipts language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid;
  v_requester   uuid;
  v_row         public.procurement_receipts;
begin
  select org_id, requested_by_id into v_org, v_requester
    from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;

  -- Tenant isolation + role/requester gate (mirrors Ordered→Received in transition_procurement).
  -- Allowed: Admin (break-glass) OR Project Manager OR the original requester (any role).
  -- SECURITY: both checks MUST stay — removing either leaks cross-org or over-permissive GR creation.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (auth_role() = 'Admin'
          or auth_role() = 'Project Manager'
          or (auth.uid() is not null and auth.uid() = v_requester))
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.procurement_receipts
    (procurement_id, status, receipt_date, gr_number, reference_number)
  values
    (p_procurement_id, p_status, p_receipt_date,
     next_procurement_doc_number(v_org, 'GR'),
     p_reference_number)
  returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_receipt(uuid, procurement_receipt_status, date, text) from public;
grant  execute on function create_procurement_receipt(uuid, procurement_receipt_status, date, text) to   authenticated;
revoke execute on function create_procurement_receipt(uuid, procurement_receipt_status, date, text) from anon;

-- ============================================================================
-- create_procurement_invoice (VI): add p_reference_number text + p_amount numeric parameters.
-- 4-role gate from 0006 is PRESERVED (Admin/Executive/PM/Finance).
-- Drop the old 3-arg signature first (same reason as above).
-- ============================================================================
drop function if exists create_procurement_invoice(uuid, procurement_invoice_status, date);
create or replace function create_procurement_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;

  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount)
  values
    (p_procurement_id, p_status, p_invoice_date,
     next_procurement_doc_number(v_org, 'VI'),
     p_reference_number, p_amount)
  returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric) from public;
grant  execute on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric) to   authenticated;
revoke execute on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric) from anon;
