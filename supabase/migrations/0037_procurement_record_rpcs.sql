-- 0037_procurement_record_rpcs.sql — Creation RPCs for the four new procurement record types.
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- Provides four thin security-definer creation RPCs (one per new record type from 0035):
--   • create_purchase_request  — mints PR#  via next_procurement_doc_number(v_org, 'PR')
--   • create_rfq               — mints RFQ# via next_procurement_doc_number(v_org, 'RFQ')  [new prefix]
--   • create_purchase_order    — mints PO#  via next_procurement_doc_number(v_org, 'PO')
--   • create_payment           — mints PAY# via next_procurement_doc_number(v_org, 'PAY') [new prefix]
--
-- ACL discipline mirrors 0006 / ADR-0009:
--   • SECURITY DEFINER with search_path pinned to public (LOW-BV-1).
--   • Each RPC RE-ASSERTS auth_org_id() + the parent-case-org guard + the 4-role gate internally
--     because definer rights bypass RLS — these re-assertions MUST stay.
--   • Table refs schema-qualified throughout.
--   • revoke all from public / grant execute to authenticated / revoke execute from anon (HIGH-1).
--   • The minter (next_procurement_doc_number) is NOT re-granted — it stays internal; these definer
--     RPCs call it by owner rights (OBS-PR-001/005, NFR-PR-SEC-005).
--   • Grant EXECUTE on the four new RPCs to authenticated only.
--
-- Rollback: drop function create_purchase_request(uuid,text,text,date,numeric);
--           drop function create_rfq(uuid,text,text,date,numeric);
--           drop function create_purchase_order(uuid,text,text,date,numeric);
--           drop function create_payment(uuid,uuid,text,text,date,numeric);
-- (supabase db reset is the authoritative rollback in development).

-- ============================================================================
-- create_purchase_request: mints PR#, returns the new purchase_requests row.
-- SECURITY: parent-org guard + 4-role gate re-asserted MUST stay — removing them bypasses RLS.
-- ============================================================================
create or replace function create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_requests (procurement_id, pr_number, reference_number, status, date, amount)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_purchase_request(uuid, text, text, date, numeric) from public;
grant  execute on function create_purchase_request(uuid, text, text, date, numeric) to   authenticated;
revoke execute on function create_purchase_request(uuid, text, text, date, numeric) from anon;

-- ============================================================================
-- create_rfq: mints RFQ# (new prefix), returns the new rfqs row.
-- SECURITY: parent-org guard + 4-role gate re-asserted MUST stay — removing them bypasses RLS.
-- ============================================================================
create or replace function create_rfq(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric)
  returns rfqs language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.rfqs;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.rfqs (procurement_id, rfq_number, reference_number, status, date, amount)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'RFQ'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_rfq(uuid, text, text, date, numeric) from public;
grant  execute on function create_rfq(uuid, text, text, date, numeric) to   authenticated;
revoke execute on function create_rfq(uuid, text, text, date, numeric) from anon;

-- ============================================================================
-- create_purchase_order: mints PO#, returns the new purchase_orders row.
-- SECURITY: parent-org guard + 4-role gate re-asserted MUST stay — removing them bypasses RLS.
-- ============================================================================
create or replace function create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_orders (procurement_id, po_number, reference_number, status, date, amount)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_purchase_order(uuid, text, text, date, numeric) from public;
grant  execute on function create_purchase_order(uuid, text, text, date, numeric) to   authenticated;
revoke execute on function create_purchase_order(uuid, text, text, date, numeric) from anon;

-- ============================================================================
-- create_payment: mints PAY# (new prefix), accepts nullable invoice_id (FR-PR-004b).
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
  insert into public.payments (procurement_id, invoice_id, pay_number, reference_number, status, date, amount)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_payment(uuid, uuid, text, text, date, numeric) from public;
grant  execute on function create_payment(uuid, uuid, text, text, date, numeric) to   authenticated;
revoke execute on function create_payment(uuid, uuid, text, text, date, numeric) from anon;
