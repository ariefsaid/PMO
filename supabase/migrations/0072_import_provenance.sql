-- 0072_import_provenance.sql — additive provenance + idempotency columns for the bulk-import
-- paths (Deliverable 2: procurement-cycle import idempotency fix; Deliverable 3: historical
-- import script re-run-safety). One column set serves both deliverables (spec §"Fix").
--
-- Adds, on `procurements` + the 7 procurement record tables (purchase_requests, rfqs,
-- procurement_quotations, purchase_orders, procurement_receipts, procurement_invoices, payments):
--   import_batch_id uuid       — one UUID per import run; NULL for non-imported rows.
--   imported_at     timestamptz — the import moment; NULL for non-imported rows.
--   import_key      text        — stable per-row dedupe key; NULL = legacy create-only (opt-in).
--
-- NO policy changes. NO new write authority (FR-IDEM-008) — these are three additional nullable
-- columns writable by whichever actor could already write the row (the existing insert policies
-- carve out no restrictive column grants against them). Fully backward-compatible: every existing
-- row gets NULL in all three (AC-IDEM-007); every existing form/RPC/Assistant write path is
-- unaffected because it simply never supplies these columns.
--
-- Rollback: supabase db reset (pre-production, ADR-0006) — the reversible-migrations contract for
-- this repo's phase. A hand-written down-migration is:
--   alter table procurements drop column import_batch_id, drop column imported_at, drop column import_key;
--   alter table purchase_requests drop column import_batch_id, drop column imported_at, drop column import_key;
--   -- (repeat for rfqs, procurement_quotations, purchase_orders, procurement_receipts,
--   --  procurement_invoices, payments)

alter table procurements
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table purchase_requests
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table rfqs
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table procurement_quotations
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table purchase_orders
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table procurement_receipts
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table procurement_invoices
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

alter table payments
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

-- Index the (org_id, import_key, import_batch_id) skip-query shape on the case header (highest-
-- traffic dedupe check: one per case, run before every case-header insert).
create index procurements_import_key_batch_idx
  on procurements (org_id, import_key, import_batch_id)
  where import_key is not null;

-- Index the (procurement_id, import_key, import_batch_id) skip-query shape on each record table
-- (one per child row, run before every record insert).
create index purchase_requests_import_key_batch_idx
  on purchase_requests (procurement_id, import_key, import_batch_id) where import_key is not null;
create index rfqs_import_key_batch_idx
  on rfqs (procurement_id, import_key, import_batch_id) where import_key is not null;
create index procurement_quotations_import_key_batch_idx
  on procurement_quotations (procurement_id, import_key, import_batch_id) where import_key is not null;
create index purchase_orders_import_key_batch_idx
  on purchase_orders (procurement_id, import_key, import_batch_id) where import_key is not null;
create index procurement_receipts_import_key_batch_idx
  on procurement_receipts (procurement_id, import_key, import_batch_id) where import_key is not null;
create index procurement_invoices_import_key_batch_idx
  on procurement_invoices (procurement_id, import_key, import_batch_id) where import_key is not null;
create index payments_import_key_batch_idx
  on payments (procurement_id, import_key, import_batch_id) where import_key is not null;

-- ============================================================================
-- RPC signature extension (D-ONB-1): each create_* RPC gains three trailing nullable
-- params (p_import_key text, p_import_batch_id uuid, p_imported_at timestamptz), stamped
-- into the same insert. Postgres identifies functions by exact arg list, so the OLD
-- signature is explicitly dropped (with its EXACT current arg types — confirmed by a live
-- pg_get_functiondef dump against the post-0070 local stack before this migration was
-- written) before the new one is created — otherwise both overloads coexist and PostgREST's
-- named-param .rpc() call errors "could not choose the best candidate function" on
-- ambiguous resolution. A DROP with the WRONG arg types (e.g. text instead of the real
-- enum) silently no-ops (`if exists`) and leaves the old signature orphaned — this is
-- exactly the bug this fix round corrects; every DROP below uses the type the live dump
-- confirmed.
-- SECURITY: every parent-org guard + role gate below is BYTE-PRESERVED from its current
-- live body (0037/0039 for create_payment; 0018+0041 for create_procurement_receipt; 0006+0041
-- for create_procurement_invoice; 0006 for create_procurement_quotation) — removing or
-- widening any of them bypasses RLS or reverts a prior security fix. This migration touches
-- ONLY the insert's column list + the three appended trailing params.
-- ============================================================================

-- create_purchase_request — body unchanged since 0037 (4-role gate). Byte-preserved.
drop function if exists create_purchase_request(uuid, text, text, date, numeric);
create or replace function create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_requests
    (procurement_id, pr_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_purchase_request(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_rfq — body unchanged since 0037 (4-role gate). Byte-preserved.
drop function if exists create_rfq(uuid, text, text, date, numeric);
create or replace function create_rfq(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns rfqs language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.rfqs;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.rfqs
    (procurement_id, rfq_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'RFQ'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_rfq(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_rfq(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_rfq(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_purchase_order — body unchanged since 0037 (4-role gate). Byte-preserved.
drop function if exists create_purchase_order(uuid, text, text, date, numeric);
create or replace function create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_payment — body is 0039's (same_case_fk_invariant), NOT 0037's. The 0039 guard
-- (p_invoice_id must belong to the SAME procurement case, else 42501 "invoice not in this
-- case") MUST be preserved byte-for-byte — dropping back to the pre-0039 body reopens the
-- cross-case invoice-linking hole 0039 closed.
drop function if exists create_payment(uuid, uuid, text, text, date, numeric);
create or replace function create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Same-case invariant (0039, AC-PR-SEC-001): invoice must belong to the same procurement
  -- case. 42501 is used (uniform, does not leak existence like 23503 would). MUST stay.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_payment(uuid, uuid, text, text, date, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_payment(uuid, uuid, text, text, date, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_payment(uuid, uuid, text, text, date, numeric, text, uuid, timestamptz) from anon;

-- create_procurement_quotation — never modified past 0006; body + 4-role gate unchanged.
-- Signature stays (uuid, uuid, numeric, date, ...) — NOT enum-typed (no status param at all).
drop function if exists create_procurement_quotation(uuid, uuid, numeric, date);
create or replace function create_procurement_quotation(
  p_procurement_id uuid, p_vendor_id uuid, p_total_amount numeric, p_received_date date,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_quotations language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_quotations;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_quotations
    (procurement_id, vendor_id, total_amount, received_date, vq_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_vendor_id, p_total_amount, p_received_date,
            next_procurement_doc_number(v_org, 'VQ'),
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_quotation(uuid, uuid, numeric, date, text, uuid, timestamptz) from public;
grant  execute on function create_procurement_quotation(uuid, uuid, numeric, date, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_procurement_quotation(uuid, uuid, numeric, date, text, uuid, timestamptz) from anon;

-- create_procurement_receipt — body is 0041's extension of 0018's TIGHTENED gate:
-- Admin OR Project Manager OR the original requester (NOT the old wide 4-role gate from
-- 0037/0006 — 0018 deliberately narrowed this; reverting to the wide gate re-opens the
-- over-grant 0018 closed). p_status is the ENUM procurement_receipt_status, not text — the
-- DROP FUNCTION below matches this exactly (a text-typed DROP would silently no-op, per
-- the live dump). Includes 0041's p_reference_number param + reference_number column.
drop function if exists create_procurement_receipt(uuid, procurement_receipt_status, date, text);
create or replace function create_procurement_receipt(
  p_procurement_id uuid, p_status procurement_receipt_status, p_receipt_date date, p_reference_number text default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_receipts language plpgsql security definer set search_path = public as $$
declare
  v_org       uuid;
  v_requester uuid;
  v_row       public.procurement_receipts;
begin
  select org_id, requested_by_id into v_org, v_requester
    from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  -- Tenant isolation + role/requester gate (0018/0041, mirrors Ordered→Received in
  -- transition_procurement): Admin (break-glass) OR Project Manager OR the original requester.
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
    (procurement_id, status, receipt_date, gr_number, reference_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_receipt_date,
            next_procurement_doc_number(v_org, 'GR'), p_reference_number,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_receipt(uuid, procurement_receipt_status, date, text, text, uuid, timestamptz) from public;
grant  execute on function create_procurement_receipt(uuid, procurement_receipt_status, date, text, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_procurement_receipt(uuid, procurement_receipt_status, date, text, text, uuid, timestamptz) from anon;

-- create_procurement_invoice — body is 0041's extension of 0006's body; 4-role gate
-- preserved (correct — 0018 did NOT touch this RPC's gate, only the receipt RPC's). p_status
-- is the ENUM procurement_invoice_status, not text. Includes 0041's p_reference_number +
-- p_amount params + reference_number/amount columns. capture_vendor_invoice (0056) calls
-- this positionally with exactly these 5 leading args — the 3 new trailing params MUST stay
-- optional-with-default so that call keeps resolving unchanged (proven by pgTAP 0129).
drop function if exists create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric);
create or replace function create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date, p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz) from public;
grant  execute on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz) to   authenticated;
revoke execute on function create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz) from anon;
