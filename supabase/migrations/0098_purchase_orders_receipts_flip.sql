-- 0098_purchase_orders_receipts_flip.sql (ERPNext P2, Slice 5, task 5.1)
-- Generalizes the external-ownership flip (0093 per-command-RLS template) onto `purchase_orders` +
-- `procurement_receipts` for the `procurement` domain (AC-ENA-052). Adds the erp_* mirror columns,
-- gates native writes while `procurement` is externally-owned, and — because both tables' real user
-- write path is a SECURITY DEFINER RPC (create_purchase_order / create_procurement_receipt), which
-- bypasses table RLS entirely — adds the `domain_externally_owned` guard INSIDE those RPCs (the
-- actually-effective gate; the RLS/trigger split below is defense-in-depth + consistency with the
-- 0093 template, and becomes load-bearing for `procurement_receipts`, which DOES carry a live
-- INSERT + column-UPDATE grant per 0075_explicit_api_grants.sql).
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse block (forward-only if
-- promoted):
--   -- purchase_orders
--   drop trigger if exists purchase_orders_native_mirror_guard_trg on public.purchase_orders;
--   drop function if exists public.purchase_orders_native_mirror_guard();
--   drop policy if exists purchase_orders_insert on public.purchase_orders;
--   drop policy if exists purchase_orders_update on public.purchase_orders;
--   drop policy if exists purchase_orders_delete on public.purchase_orders;
--   create policy purchase_orders_write on purchase_orders for all
--     using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()))
--     with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()));
--   alter table public.purchase_orders drop column if exists erp_docstatus;
--   alter table public.purchase_orders drop column if exists erp_modified;
--   alter table public.purchase_orders drop column if exists erp_amended_from;
--   alter table public.purchase_orders drop column if exists erp_cancelled_at;
--   -- procurement_receipts
--   drop trigger if exists procurement_receipts_native_mirror_guard_trg on public.procurement_receipts;
--   drop function if exists public.procurement_receipts_native_mirror_guard();
--   drop policy if exists procurement_receipts_insert on public.procurement_receipts;
--   drop policy if exists procurement_receipts_update on public.procurement_receipts;
--   drop policy if exists procurement_receipts_delete on public.procurement_receipts;
--   create policy procurement_receipts_write on procurement_receipts for all
--     using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()))
--     with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()));
--   alter table public.procurement_receipts drop column if exists erp_docstatus;
--   alter table public.procurement_receipts drop column if exists erp_modified;
--   alter table public.procurement_receipts drop column if exists erp_amended_from;
--   alter table public.procurement_receipts drop column if exists erp_cancelled_at;
--   -- RPC guards (revert to the pre-flip bodies, 0037/0072)

-- ============================================================================
-- §1 — erp_* mirror columns (FR-ENA-113/114)
-- ============================================================================

alter table public.purchase_orders
  add column erp_docstatus    smallint,
  add column erp_modified     text,
  add column erp_amended_from text,
  add column erp_cancelled_at timestamptz;

alter table public.procurement_receipts
  add column erp_docstatus    smallint,
  add column erp_modified     text,
  add column erp_amended_from text,
  add column erp_cancelled_at timestamptz;

-- ============================================================================
-- §2 — Per-command RLS split (0093 template). Native INSERT/DELETE gated by
-- `not domain_externally_owned(auth_org_id(),'procurement')`; UPDATE stays permissive at the RLS
-- layer (a BEFORE UPDATE trigger below column-pins native fields while flipped, mirroring 0093's
-- `enforce_assignee_status_only` split).
-- ============================================================================

drop policy purchase_orders_write on purchase_orders;
create policy purchase_orders_insert on purchase_orders for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));
create policy purchase_orders_update on purchase_orders for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()));
create policy purchase_orders_delete on purchase_orders for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

drop policy procurement_receipts_write on procurement_receipts;
create policy procurement_receipts_insert on procurement_receipts for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));
create policy procurement_receipts_update on procurement_receipts for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()));
create policy procurement_receipts_delete on procurement_receipts for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

-- ============================================================================
-- §3 — Native-mirror-guard triggers (BEFORE UPDATE). Service-role (the mirror writer) is always
-- exempt; a non-service caller is exempt only while NOT flipped (byte-for-byte pre-P2 behavior);
-- while flipped, a native-field change from a user JWT raises 42501.
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
drop trigger if exists purchase_orders_native_mirror_guard_trg on public.purchase_orders;
create trigger purchase_orders_native_mirror_guard_trg
  before update on public.purchase_orders for each row execute function public.purchase_orders_native_mirror_guard();

create or replace function public.procurement_receipts_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.gr_number        is distinct from old.gr_number
     or new.reference_number is distinct from old.reference_number
     or new.receipt_date     is distinct from old.receipt_date
     or new.status           is distinct from old.status
     or new.po_id            is distinct from old.po_id
     or new.erp_docstatus    is distinct from old.erp_docstatus
     or new.erp_modified     is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.id               is distinct from old.id
     or new.procurement_id   is distinct from old.procurement_id
     or new.org_id           is distinct from old.org_id
     or new.created_at       is distinct from old.created_at
  then
    raise exception 'procurement_receipts native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists procurement_receipts_native_mirror_guard_trg on public.procurement_receipts;
create trigger procurement_receipts_native_mirror_guard_trg
  before update on public.procurement_receipts for each row execute function public.procurement_receipts_native_mirror_guard();

-- ============================================================================
-- §4 — RPC guards (the ACTUALLY-effective gate): create_purchase_order / create_procurement_receipt
-- are SECURITY DEFINER and therefore bypass every RLS policy above. Bodies copied verbatim from the
-- LIVE signatures (create_purchase_order was last redefined by 0072's import-provenance 8-arg form —
-- redefining the OLD 0037 5-arg signature here would create a stray overload and an ambiguous-call
-- error, not a replace) with ONE inserted check: refuse `commit-rejected`-shaped 42501 while the org's
-- `procurement` domain is externally-owned — a flipped org's writes must route through the ERPNext
-- adapter (dispatch), never this direct-DAL RPC.
-- ============================================================================

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
  -- Slice 5 addition (AC-ENA-052): a flipped org's PO writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
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
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (auth_role() = 'Admin'
          or auth_role() = 'Project Manager'
          or (auth.uid() is not null and auth.uid() = v_requester))
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's GR writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — goods receipts route through the ERPNext adapter'
      using errcode = '42501';
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
