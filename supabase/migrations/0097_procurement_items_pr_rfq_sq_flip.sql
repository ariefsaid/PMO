-- 0097_procurement_items_pr_rfq_sq_flip.sql
-- Purpose (AC-ENA-003(procurement)/050/051, spec §7): flip `procurement_items` + the `purchase_requests`/
-- `rfqs`/`procurement_quotations` record tables to the externally-owned discipline while `procurement`
-- is `erpnext`-owned for an org — mirror columns for the native ERP fields, and a per-table
-- BEFORE INSERT/UPDATE `*_native_mirror_guard` trigger that raises 42501 on a user-JWT write to a
-- native column while flipped (service-role — the dispatch/sync writer — is exempt). Every guard fires
-- alphabetically AFTER the existing org-stamp triggers (named `..._zz_native_mirror_guard`) so it
-- always sees the row's FINAL resolved `org_id`, never a still-null/seed-default value (Postgres fires
-- same-timing triggers on one table in trigger-name order). This is the SAME mechanism the
-- `create_purchase_request`/`create_rfq` SECURITY DEFINER RPCs hit too — a trigger always fires
-- regardless of definer-bypassed RLS on the underlying INSERT, which is exactly what makes AC-ENA-003's
-- "the same write in org A is RLS-denied" provable through the pre-existing RPC path (task 4.1's pgTAP).
--
-- `procurement_items.amount` stays `GENERATED ALWAYS AS (quantity*rate) STORED` (0001) — the adapter/
-- dispatch NEVER writes it (FR-ENA-071/171); the new `erp_line_amount` column is the ERP line-amount
-- oracle instead. `procurements` (the case aggregate) is untouched by this migration — FR-ENA-073/101
-- keep it PMO-owned/user-writable even while `procurement` is externally-owned (proven in 4.1's pgTAP,
-- no schema change needed since it was never gated in the first place).
--
-- Reversibility (pre-prod via `supabase db reset`). Manual reverse block (forward-only if promoted):
--   drop trigger if exists procurement_items_zz_native_mirror_guard on public.procurement_items;
--   drop function if exists public.procurement_items_native_mirror_guard();
--   alter table public.procurement_items drop column if exists erp_line_amount;
--   alter table public.procurement_items drop column if exists erp_docstatus;
--   alter table public.procurement_items drop column if exists erp_modified;
--   drop trigger if exists purchase_requests_zz_native_mirror_guard on public.purchase_requests;
--   drop function if exists public.purchase_requests_native_mirror_guard();
--   alter table public.purchase_requests drop column if exists erp_docstatus;
--   alter table public.purchase_requests drop column if exists erp_modified;
--   alter table public.purchase_requests drop column if exists erp_amended_from;
--   alter table public.purchase_requests drop column if exists erp_cancelled_at;
--   drop trigger if exists rfqs_zz_native_mirror_guard on public.rfqs;
--   drop function if exists public.rfqs_native_mirror_guard();
--   alter table public.rfqs drop column if exists erp_docstatus;
--   alter table public.rfqs drop column if exists erp_modified;
--   alter table public.rfqs drop column if exists erp_amended_from;
--   alter table public.rfqs drop column if exists erp_cancelled_at;
--   drop trigger if exists procurement_quotations_zz_insert_guard on public.procurement_quotations;
--   drop function if exists public.procurement_quotations_insert_guard();
--   drop trigger if exists procurement_quotations_zz_native_mirror_guard on public.procurement_quotations;
--   drop function if exists public.procurement_quotations_native_mirror_guard();
--   alter table public.procurement_quotations drop column if exists erp_docstatus;
--   alter table public.procurement_quotations drop column if exists erp_modified;
--   alter table public.procurement_quotations drop column if exists erp_amended_from;
--   alter table public.procurement_quotations drop column if exists erp_cancelled_at;

-- ============================================================================
-- procurement_items — native: quantity, rate, erp_line_amount, erp_docstatus, erp_modified (§7).
-- PMO-owned (stays user-writable): name (+ description, not spec-named but likewise non-ERP).
-- amount stays GENERATED — never written by the adapter (FR-ENA-071).
-- ============================================================================
alter table public.procurement_items
  add column erp_line_amount numeric(14,2),
  add column erp_docstatus   smallint,
  add column erp_modified    text;

create or replace function public.procurement_items_native_mirror_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Service-role (the dispatch/sync writer) is always exempt — matches the tasks-flip precedent
  -- (0093 enforce_assignee_status_only): an explicit service_role JWT claim, not a bare null check.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.quantity        is distinct from old.quantity
     or new.rate            is distinct from old.rate
     or new.erp_line_amount is distinct from old.erp_line_amount
     or new.erp_docstatus   is distinct from old.erp_docstatus
     or new.erp_modified    is distinct from old.erp_modified
  then
    raise exception 'procurement_items native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- UPDATE-only (name prefixed `zz_` so it fires AFTER procurement_items_stamp_org (0015) +
-- procurement_items_stamp_org_id (0074), which resolve the row's final org_id first). INSERT is left
-- unguarded: a new draft line item is authored by the requester PMO-side BEFORE it is ever pushed to
-- ERP as part of an MR/RFQ/SQ command body (the existing create_procurement_item RPC/UI flow is
-- unchanged) — only a later mutation of the now-mirrored native fields is denied.
create trigger procurement_items_zz_native_mirror_guard
  before update on public.procurement_items
  for each row execute function public.procurement_items_native_mirror_guard();

-- ============================================================================
-- purchase_requests — native: pr_number, reference_number, amount, date, erp_* (§7). No PMO-enhancement
-- column exists on this header row (status is DERIVED from erp_docstatus, machine-written) — so the
-- guard denies the whole row (INSERT + UPDATE) to a user-JWT writer while flipped.
-- ============================================================================
alter table public.purchase_requests
  add column erp_docstatus    smallint,
  add column erp_modified     text,
  add column erp_amended_from text,
  add column erp_cancelled_at timestamptz;

create or replace function public.purchase_requests_native_mirror_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  raise exception 'purchase_requests native fields are read-only while procurement is externally-owned'
    using errcode = '42501';
end; $$;

create trigger purchase_requests_zz_native_mirror_guard
  before insert or update on public.purchase_requests
  for each row execute function public.purchase_requests_native_mirror_guard();

-- ============================================================================
-- rfqs — native: rfq_number, reference_number, amount, date, erp_* (§7). Same whole-row guard shape.
-- ============================================================================
alter table public.rfqs
  add column erp_docstatus    smallint,
  add column erp_modified     text,
  add column erp_amended_from text,
  add column erp_cancelled_at timestamptz;

create or replace function public.rfqs_native_mirror_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  raise exception 'rfqs native fields are read-only while procurement is externally-owned'
    using errcode = '42501';
end; $$;

create trigger rfqs_zz_native_mirror_guard
  before insert or update on public.rfqs
  for each row execute function public.rfqs_native_mirror_guard();

-- ============================================================================
-- procurement_quotations — native: total_amount, valid_until, rfq_id, vq_number, reference,
-- received_date, erp_* (§7). PMO-owned enhancement (Finding 8, FR-ENA-130/FR-ENA-112): `is_selected`
-- (+ the `procurement_quotations_one_selected_idx` partial-unique index) stays user-writable — a
-- column-pin UPDATE guard, not a whole-row deny. `vq_number` already exists (0006, the PMO-minted VQ#
-- display column) and is REPURPOSED here to carry the ERP `name` mirror instead (Finding 8 — same
-- column, same "quotation display number" meaning, now machine-written while flipped) — no new column.
-- ============================================================================
alter table public.procurement_quotations
  add column erp_docstatus    smallint,
  add column erp_modified     text,
  add column erp_amended_from text,
  add column erp_cancelled_at timestamptz;

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
  then
    raise exception 'procurement_quotations native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger procurement_quotations_zz_native_mirror_guard
  before update on public.procurement_quotations
  for each row execute function public.procurement_quotations_native_mirror_guard();

-- H-2 (audit): a quotation is ERP/dispatch-sourced while flipped — a new quotation row is minted by the
-- dispatch (service_role INSERT). The prior design left user INSERT unguarded and relied on FE routing
-- ("simply never called by a flipped org's routed FE"), but an authenticated user could call the
-- `create_procurement_quotation` RPC / direct INSERT path DIRECTLY and mint a PMO-native quotation not
-- backed by ERPNext (an ERP-truth-boundary violation). Deny user-JWT INSERT while flipped (service_role
-- — the mirror writer — stays exempt; a SECURITY DEFINER RPC INSERT still fires this trigger). NOT for
-- procurement_items: those draft line items are authored PMO-side BEFORE the MR/RFQ command body is
-- pushed (FR-ENA-103), so their INSERT stays open by design (the guard is UPDATE-only above).
create or replace function public.procurement_quotations_insert_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if public.domain_externally_owned(new.org_id, 'procurement') then
    raise exception 'procurement_quotations are ERP-sourced while procurement is externally-owned — cannot user-INSERT'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger procurement_quotations_zz_insert_guard
  before insert on public.procurement_quotations
  for each row execute function public.procurement_quotations_insert_guard();
