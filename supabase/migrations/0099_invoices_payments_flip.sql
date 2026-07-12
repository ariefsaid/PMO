-- 0099_invoices_payments_flip.sql (ERPNext P2, Slice 6, task 6.1)
-- Generalizes the external-ownership flip (0093 per-command-RLS template, 0098 money-doc form) onto
-- `procurement_invoices` + `payments` for the `procurement` domain (AC-ENA-072 — this slice's
-- erpnext_money_flip_rls.test.sql owns that AC). Adds the erp_* mirror columns (PI also gets
-- `erp_outstanding_amount`, the R9 paid-detection oracle), gates native writes while `procurement` is
-- externally-owned, and — because both tables' user write path is a SECURITY DEFINER RPC
-- (create_procurement_invoice / create_payment), which bypasses table RLS — adds the
-- `domain_externally_owned` guard INSIDE those RPCs (the actually-effective gate for `payments`, which
-- carries NO direct write grant; the RLS/trigger split is defense-in-depth + load-bearing for
-- `procurement_invoices`, which DOES carry a live INSERT + column-UPDATE grant per 0075).
--
-- Preserved invariants: `payments_amount_nonneg` CHECK (0058, nulls -> NULL); the same-case
-- invoice_id invariant inside create_payment (0039, FR-ENA-130d); the procurement_invoice_status /
-- payments status CHECK domains (populated by derivation while flipped, never widened).
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse block (forward-only if
-- promoted):
--   -- procurement_invoices
--   drop trigger if exists procurement_invoices_native_mirror_guard_trg on public.procurement_invoices;
--   drop function if exists public.procurement_invoices_native_mirror_guard();
--   drop policy if exists procurement_invoices_insert on public.procurement_invoices;
--   drop policy if exists procurement_invoices_update on public.procurement_invoices;
--   drop policy if exists procurement_invoices_delete on public.procurement_invoices;
--   create policy procurement_invoices_write on procurement_invoices for all
--     using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()))
--     with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()));
--   alter table public.procurement_invoices drop column if exists erp_outstanding_amount;
--   alter table public.procurement_invoices drop column if exists erp_docstatus;
--   alter table public.procurement_invoices drop column if exists erp_modified;
--   alter table public.procurement_invoices drop column if exists erp_amended_from;
--   alter table public.procurement_invoices drop column if exists erp_cancelled_at;
--   -- payments
--   drop trigger if exists payments_native_mirror_guard_trg on public.payments;
--   drop function if exists public.payments_native_mirror_guard();
--   drop policy if exists payments_insert on public.payments;
--   drop policy if exists payments_update on public.payments;
--   drop policy if exists payments_delete on public.payments;
--   create policy payments_write on payments for all
--     using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id()))
--     with check (...same...);
--   alter table public.payments drop column if exists erp_docstatus;
--   alter table public.payments drop column if exists erp_modified;
--   alter table public.payments drop column if exists erp_amended_from;
--   alter table public.payments drop column if exists erp_cancelled_at;
--   -- RPC guards: revert to the 0072 bodies (remove the domain_externally_owned check).

-- ============================================================================
-- §1 — erp_* mirror columns (FR-ENA-072). PI additionally carries erp_outstanding_amount (R9 paid
-- detection: a referenced PE submit flips the PI to outstanding 0 server-side).
-- ============================================================================

alter table public.procurement_invoices
  add column erp_outstanding_amount numeric(14,2),
  add column erp_docstatus          smallint,
  add column erp_modified           text,
  add column erp_amended_from        text,
  add column erp_cancelled_at        timestamptz;

alter table public.payments
  add column erp_docstatus    smallint,
  add column erp_modified     text,
  add column erp_amended_from text,
  add column erp_cancelled_at timestamptz;

-- ============================================================================
-- §2 — Per-command RLS split (0093/0098 template). Native INSERT/DELETE gated by
-- `not domain_externally_owned(auth_org_id(),'procurement')`; UPDATE stays permissive at the RLS
-- layer (a BEFORE UPDATE trigger below column-pins native fields while flipped).
-- ============================================================================

drop policy procurement_invoices_write on procurement_invoices;
create policy procurement_invoices_insert on procurement_invoices for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));
create policy procurement_invoices_update on procurement_invoices for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()));
create policy procurement_invoices_delete on procurement_invoices for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

drop policy payments_write on payments;
create policy payments_insert on payments for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));
create policy payments_update on payments for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id()));
create policy payments_delete on payments for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

-- ============================================================================
-- §3 — Native-mirror-guard triggers (BEFORE UPDATE). Service-role (the mirror writer) is always
-- exempt; a non-service caller is exempt only while NOT flipped (byte-for-byte pre-P2); while flipped,
-- a native-field change from a user JWT raises 42501.
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
drop trigger if exists procurement_invoices_native_mirror_guard_trg on public.procurement_invoices;
create trigger procurement_invoices_native_mirror_guard_trg
  before update on public.procurement_invoices for each row execute function public.procurement_invoices_native_mirror_guard();

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
drop trigger if exists payments_native_mirror_guard_trg on public.payments;
create trigger payments_native_mirror_guard_trg
  before update on public.payments for each row execute function public.payments_native_mirror_guard();

-- ============================================================================
-- §4 — RPC guards (the ACTUALLY-effective gate; both RPCs are SECURITY DEFINER → bypass RLS). Bodies
-- copied verbatim from the LIVE 0072 signatures with ONE inserted check: refuse 42501 while the org's
-- `procurement` domain is externally-owned — a flipped org's money writes must route through the
-- ERPNext adapter (dispatch), never this direct-DAL RPC. (capture_vendor_invoice, 0056, calls
-- create_procurement_invoice → the guard propagates through it, all-or-nothing.)
-- ============================================================================

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
  -- Slice 6 addition (AC-ENA-072): a flipped org's invoice writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
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
  -- Same-case invariant (0039, AC-PR-SEC-001 / FR-ENA-130d): invoice must belong to the same case.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's payment writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — payments route through the ERPNext adapter'
      using errcode = '42501';
  end if;
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
