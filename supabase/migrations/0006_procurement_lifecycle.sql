-- 0006_procurement_lifecycle.sql — Procurement procure-to-pay lifecycle (ADR-0012 / procurement-lifecycle.spec).
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- Generalizes ADR-0011 (budget mutation RPCs) to a state machine + a shared doc-number minter. Provides:
--   • schema deltas on procurements / procurement_quotations (PR/PO/VQ numbers + approval audit fields)
--   • enums procurement_receipt_status / procurement_invoice_status
--   • tables procurement_receipts / procurement_invoices (+ RLS read-in-org + 4-role write + parent-org guard)
--   • procurement_doc_counters + next_procurement_doc_number(org,prefix) — atomic per-(org,prefix,day) minter
--   • transition_procurement(id,to,notes) — map-as-data legality + role×transition matrix + SoD + atomic mint
--   • create_procurement_quotation / _receipt / _invoice — thin creation RPCs sharing the minter
--
-- ACL discipline mirrors 0005 / ADR-0009: every function does `revoke all from public`, `grant execute to
-- authenticated`, `revoke execute from anon`. All security-definer functions pin search_path = public and
-- RE-ASSERT auth_org_id()/auth_role() internally because definer rights bypass RLS. Table refs inside
-- definer functions are schema-qualified (LOW-BV-1 lesson). Calls auth_org_id()/auth_role() from 0002_rls.sql.

-- ============================================================================
-- A1 — Enums + schema deltas (FR-PROC-012)
-- ============================================================================
create type procurement_receipt_status as enum ('Partial','Complete');
create type procurement_invoice_status as enum ('Received','Scheduled','Paid');

alter table procurements
  add column pr_number      text,
  add column po_number      text,
  add column approval_notes text,
  add column rejection_notes text,
  add column approved_by_id uuid references profiles(id);  -- OD-PROC-7-A: stamped on →Approved (SoD-b basis)

alter table procurement_quotations
  add column vq_number text;

-- ============================================================================
-- A2 — Child tables (FR-PROC-013/014). org_id defaulted (client-unspoofable) + parent FK on delete cascade.
-- ============================================================================
create table procurement_receipts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id uuid not null references procurements(id) on delete cascade,
  gr_number      text,
  receipt_date   date,
  status         procurement_receipt_status not null,
  created_at     timestamptz not null default now()
);
create index procurement_receipts_procurement_idx on procurement_receipts (procurement_id);

create table procurement_invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id uuid not null references procurements(id) on delete cascade,
  vi_number      text,
  invoice_date   date,
  status         procurement_invoice_status not null,
  created_at     timestamptz not null default now()
);
create index procurement_invoices_procurement_idx on procurement_invoices (procurement_id);

-- ============================================================================
-- A3 — RLS on both new tables: read-in-org + 4-role write + parent-org guard (FR-PROC-015/016).
-- Parent-org guard (audit HIGH-BV-1): the parent procurement must also be in the caller's org, so a child
-- stamped with the caller's own org cannot be grafted onto another org's procurement — exact shape of
-- procurement_items_write in 0002_rls.sql. force RLS so even the table owner is subject to policies (0004).
-- ============================================================================
alter table procurement_receipts enable row level security;
alter table procurement_receipts force  row level security;
create policy procurement_receipts_select on procurement_receipts for select using (org_id = auth_org_id());
create policy procurement_receipts_write on procurement_receipts for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()));

alter table procurement_invoices enable row level security;
alter table procurement_invoices force  row level security;
create policy procurement_invoices_select on procurement_invoices for select using (org_id = auth_org_id());
create policy procurement_invoices_write on procurement_invoices for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()));

-- ============================================================================
-- A4 — Counter table + next_procurement_doc_number minter (FR-PROC-010, NFR-PROC-SEQ-001, OD-PROC-7-C).
-- Internal sequence store, NOT a business table: read-RLS for consistency, NO write policy — only ever
-- written via the security-definer minter below. force RLS so even the owner cannot bypass read scoping.
-- ============================================================================
create table procurement_doc_counters (
  org_id   uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  prefix   text not null,
  doc_date date not null,
  last_seq int  not null,
  primary key (org_id, prefix, doc_date)
);
alter table procurement_doc_counters enable row level security;
alter table procurement_doc_counters force  row level security;
create policy procurement_doc_counters_select on procurement_doc_counters for select using (org_id = auth_org_id());

-- Atomic per-(org,prefix,day) mint: `on conflict do update ... returning` is one statement, so concurrent
-- mints each take the conflicting row's lock and are serialized by Postgres → distinct last_seq, collision-
-- free (NFR-PROC-SEQ-001). doc_date in the PK gives the daily reset for free; a rolled-back txn leaves
-- last_seq advanced ⇒ gaps are possible and ACCEPTED (gap-tolerant, OD-PROC-3). Format: {PREFIX}-YYMMDD####.
-- SECURITY: definer so it can write the counter while the caller has no write policy on it; search_path is
-- pinned to public against injection. Org is supplied by the (definer) callers, never client-trusted here.
create or replace function next_procurement_doc_number(p_org uuid, p_prefix text)
  returns text language plpgsql security definer set search_path = public as $$
declare v_seq int;
begin
  insert into public.procurement_doc_counters (org_id, prefix, doc_date, last_seq)
    values (p_org, p_prefix, current_date, 1)
  on conflict (org_id, prefix, doc_date)
    do update set last_seq = public.procurement_doc_counters.last_seq + 1
  returning last_seq into v_seq;
  return p_prefix || '-' || to_char(current_date, 'YYMMDD') || lpad(v_seq::text, 4, '0');
end; $$;
-- HIGH-1 (security review): the minter is an INTERNAL-ONLY helper. Its only legitimate callers are
-- the four security-definer RPCs above (transition_procurement / create_procurement_quotation /
-- _receipt / _invoice), which run as the function owner and so retain execute after this revoke.
-- It is NOT granted to authenticated: a direct PostgREST/RPC call would let any authenticated user
-- write an arbitrary org's per-day counter (cross-tenant sequence write) and pick an arbitrary prefix.
revoke all     on function next_procurement_doc_number(uuid, text) from public;
revoke execute on function next_procurement_doc_number(uuid, text) from anon;
revoke execute on function next_procurement_doc_number(uuid, text) from authenticated;

-- ============================================================================
-- A5 — transition_procurement: the single authority for all status changes (FR-PROC-001..009/011/018).
-- map-as-data legality (P0001) + role×transition matrix + SoD (42501) + atomic status+mint update.
-- SECURITY DEFINER so the multi-write (status + mint + approver stamp) is one indivisible txn; therefore it
-- RE-ASSERTS auth_org_id() + auth_role() + SoD INTERNALLY. Removing any of these re-assertions would bypass
-- RLS and permit cross-org / unauthorized / SoD-violating transitions — they MUST stay (ADR-0011 lesson).
-- search_path pinned to public; table refs schema-qualified (LOW-BV-1).
-- ============================================================================
create or replace function transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  -- The transition map (OD-PROC-6 config seam): legal (from → [allowed to]) superset, as data.
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Quote Selected','Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled'),
    'Ordered',         jsonb_build_array('Received','Cancelled'),
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled'),
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array()
  );
  v_allowed_roles text[];  -- per-transition allowed role set (besides Admin)
begin
  v_is_admin := (v_role = 'Admin');

  -- Load + lock the row (serializes concurrent transitions on the SAME procurement). P0002 if absent.
  select status, org_id, requested_by_id, approved_by_id
    into v_from, v_org, v_requester, v_approver
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-PROC-004a, AC-807): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-PROC-001/002): (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Role×transition authorization (OD-PROC-1 matrix, as data keyed by transition) + SoD. Admin = break-glass.
  --
  -- Two transitions are "requester-or-role" scoped (the requester is permitted regardless of role):
  --   • Draft → Requested  : ANY member (the requester submits their own request)
  --   • Rejected → Draft    : the requester reworks
  --   • Ordered → Received  : the requester OR a Project Manager (OD-PROC-1)
  -- For these, being the requester is sufficient; otherwise the role must be in the listed set.
  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        -- Cancel boundary (OD-PROC-7-B): requester may cancel while in {Draft,Requested}; later only PM/Fin/Exec.
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];  -- requester satisfies below
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'           and p_to = 'Requested'       then array['Executive','Project Manager','Finance','Engineer']  -- any member submits
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end  -- requester reworks
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end  -- requester OR PM
          when v_from = 'Received'        and p_to = 'Vendor Invoiced' then array['Finance']
          when v_from = 'Vendor Invoiced' and p_to = 'Paid'            then array['Finance']
          else array[]::text[]
        end;
      end if;

      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;

    -- SoD-a (requester ≠ approver): the requester may not Approve/Reject their own procurement.
    if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
      raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
    end if;

    -- SoD-b (approver ≠ payer): the approver may not mark their own approved procurement Paid.
    if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
  end if;

  -- Atomic single update: status + minted PR#/PO# (coalesce → immutable once minted) + approver/notes stamps.
  -- The mint and the status write are the SAME statement ⇒ no observable partial state (NFR-PROC-ATOM-001).
  update public.procurements set
    status         = p_to,
    pr_number      = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number      = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    updated_at     = now()
  where id = p_id;
end; $$;
revoke all     on function transition_procurement(uuid, procurement_status, text) from public;
grant  execute on function transition_procurement(uuid, procurement_status, text) to   authenticated;
revoke execute on function transition_procurement(uuid, procurement_status, text) from anon;

-- ============================================================================
-- A6 — create_procurement_quotation: thin creation RPC, parent-org guard + 4-role gate, mints VQ# (FR-PROC-011/016).
-- SECURITY DEFINER: re-asserts the parent procurement is in auth_org_id() (HIGH-BV-1 parent-org guard) and
-- auth_role() ∈ 4 roles. Removing either check bypasses RLS — they MUST stay. search_path pinned to public.
-- ============================================================================
create or replace function create_procurement_quotation(
  p_procurement_id uuid, p_vendor_id uuid, p_total_amount numeric, p_received_date date)
  returns procurement_quotations language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_quotations;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_quotations (procurement_id, vendor_id, total_amount, received_date, vq_number)
    values (p_procurement_id, p_vendor_id, p_total_amount, p_received_date,
            next_procurement_doc_number(v_org, 'VQ'))
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_quotation(uuid, uuid, numeric, date) from public;
grant  execute on function create_procurement_quotation(uuid, uuid, numeric, date) to   authenticated;
revoke execute on function create_procurement_quotation(uuid, uuid, numeric, date) from anon;

-- ============================================================================
-- A7 — create_procurement_receipt: same guard shape, mints GR# (FR-PROC-011/016).
-- SECURITY DEFINER: parent-org guard + 4-role gate re-asserted internally MUST stay. search_path pinned.
-- ============================================================================
create or replace function create_procurement_receipt(
  p_procurement_id uuid, p_status procurement_receipt_status, p_receipt_date date)
  returns procurement_receipts language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_receipts;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_receipts (procurement_id, status, receipt_date, gr_number)
    values (p_procurement_id, p_status, p_receipt_date,
            next_procurement_doc_number(v_org, 'GR'))
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_receipt(uuid, procurement_receipt_status, date) from public;
grant  execute on function create_procurement_receipt(uuid, procurement_receipt_status, date) to   authenticated;
revoke execute on function create_procurement_receipt(uuid, procurement_receipt_status, date) from anon;

-- ============================================================================
-- A8 — create_procurement_invoice: same guard shape, mints VI# (FR-PROC-011/016).
-- SECURITY DEFINER: parent-org guard + 4-role gate re-asserted internally MUST stay. search_path pinned.
-- ============================================================================
create or replace function create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.procurement_invoices (procurement_id, status, invoice_date, vi_number)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'))
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_invoice(uuid, procurement_invoice_status, date) from public;
grant  execute on function create_procurement_invoice(uuid, procurement_invoice_status, date) to   authenticated;
revoke execute on function create_procurement_invoice(uuid, procurement_invoice_status, date) from anon;
