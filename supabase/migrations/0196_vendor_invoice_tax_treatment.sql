-- 0196_vendor_invoice_tax_treatment.sql — #505: the input-PPN mirror of #478's output-PPN fix.
--
-- `procurement_invoices.amount` (0040) is an authored money figure carrying exactly the ambiguity
-- 0188 removed from `sales_invoices.amount`: a recorded total with no marker saying whether it
-- already includes tax cannot be disambiguated later by ANY means. Input PPN on a vendor invoice is
-- the mirror of output PPN on a sales invoice, and the argument for irrecoverability is the same
-- argument, so this migration is 0188 clause for clause. Where it deviates, it says why.
--
-- ⛔ DEADLINE CLASS: this must land before RIS records a vendor invoice natively. In standalone,
-- PMO owns the procurement chain and users author these directly.
--
-- ── THE FOUR COLUMNS (0188's shapes, unchanged) ─────────────────────────────────────────────────
--   • tax_treatment — text, NOT NULL, NO DEFAULT. The irrecoverable one. Text and not boolean: a
--     client that omits a boolean, or hands over a JS falsy default, writes `false` = 'exclusive' —
--     a WRONG value indistinguishable from a deliberate one. A two-value text domain with no default
--     makes an omission a hard 23502 and a garbage value a hard 23514.
--   • tax_amount    — NOT NULL, NO DEFAULT. Always knowable by whoever records the invoice (0 when
--     there is no tax). ERPNext states it on the Purchase Invoice header.
--   • tax_rate      — NULLABLE. A mirrored ERP invoice keeps its rate on the `taxes` CHILD table,
--     which the sweep's list endpoint cannot return; deriving it as tax_amount/net*100 would be PMO
--     COMPUTING a money figure it is supposed to READ (ADR-0048). NULL = "not recorded", never 0%.
--   • tax_template  — NULLABLE. The ERPNext "Purchase Taxes and Charges Template" name is
--     CONNECT-TIME org config, so a standalone org legitimately has none.
--
-- ── GRANTS: none, and that is the DEVIATION from 0188 worth reading ─────────────────────────────
-- 0188 had to `grant insert (…)` because `sales_invoices` still holds a COLUMN-LEVEL insert grant.
-- `procurement_invoices` does not: `0174` revoked INSERT and `0175` revoked UPDATE from
-- `authenticated`/`anon` with no re-grant, so `authenticated` holds SELECT only and
-- `create_procurement_invoice` (SECURITY DEFINER) is the sole client insert path. Granting the four
-- columns here would re-open a door two migrations deliberately closed. The RPC is where the tax
-- treatment enters, which is also why the RPC gains an explicit gate below rather than relying on
-- the NOT NULL constraint.
--
-- ── BACKFILL (stated, because a NOT NULL add cannot avoid one) ──────────────────────────────────
-- 6 rows exist locally, all seed/demo. ⚑ Unlike 0188 — whose 'inclusive' was a FACT about mirror
-- rows, since a mirrored `amount` IS ERPNext's grand_total — these are PMO-authored seed rows and
-- 'inclusive' is a PLACEHOLDER, not a fact. It is confined to demo/staging data raised before this
-- migration, it is a one-time UPDATE and NOT a column DEFAULT, so nothing written after this
-- migration can inherit it. Said plainly rather than dressed up: the honest alternative would be a
-- nullable column, and that is precisely the ambiguity this migration exists to abolish.
--
-- ── Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse, in order:
--   -- re-run 0189 §4's procurement_invoices_native_mirror_guard body verbatim (without the tax lines);
--   drop function if exists public.capture_vendor_invoice(uuid, procurement_invoice_status, date, text, numeric, text, text, numeric, numeric, text);
--   drop function if exists public.create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz, text, numeric, numeric, text);
--   -- then re-run 0056's capture_vendor_invoice and 0180's create_procurement_invoice verbatim;
--   alter table public.procurement_invoices
--     drop column if exists tax_template, drop column if exists tax_rate,
--     drop column if exists tax_amount,   drop column if exists tax_treatment;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the columns.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.procurement_invoices
  add column if not exists tax_treatment text,
  add column if not exists tax_amount    numeric(14,2),
  add column if not exists tax_rate      numeric(6,3),
  add column if not exists tax_template  text;

-- One-time backfill (see header) — never a DEFAULT.
update public.procurement_invoices
   set tax_treatment = coalesce(tax_treatment, 'inclusive'),
       tax_amount    = coalesce(tax_amount, 0)
 where tax_treatment is null or tax_amount is null;

alter table public.procurement_invoices alter column tax_treatment set not null;
alter table public.procurement_invoices alter column tax_amount    set not null;

alter table public.procurement_invoices
  add constraint procurement_invoices_tax_treatment_domain
  check (tax_treatment in ('inclusive','exclusive'));

-- `>= 0` alone is NOT sufficient: Postgres orders numeric NaN ABOVE every ordinary value, so
-- `'NaN'::numeric >= 0` is TRUE and PostgREST coerces the JSON string "NaN" straight into the
-- column. The upper bound is what actually rejects NaN (NaN < 'Infinity' is FALSE). Same
-- construction and same reason as 0169_contract_value_nonneg and 0188.
alter table public.procurement_invoices
  add constraint procurement_invoices_tax_amount_nonneg
  check (tax_amount >= 0 and tax_amount < 'Infinity'::numeric);

alter table public.procurement_invoices
  add constraint procurement_invoices_tax_rate_pct
  check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100));

comment on column public.procurement_invoices.tax_treatment is
  '#505: does THIS row''s `amount` already include `tax_amount` (''inclusive'') or not '
  '(''exclusive'')? NOT NULL with no default — the one fact about a vendor invoice that no later '
  'inference recovers. An ERP-mirrored row is ''inclusive'' because its `amount` is ERPNext grand_total.';
comment on column public.procurement_invoices.tax_amount is
  '#505: total input tax on the invoice, in `currency`. ERPNext Purchase Invoice header '
  '`total_taxes_and_charges`. 0 means no tax; it never means unknown.';
comment on column public.procurement_invoices.tax_rate is
  '#505: the authored tax percentage (e.g. 11.000 for PPN 11%). NULL = not recorded on this row '
  '(an ERP mirror keeps its rate on the taxes child table) — never 0%.';
comment on column public.procurement_invoices.tax_template is
  '#505: ERPNext "Purchase Taxes and Charges Template" name. Connect-time org config, so NULL for a '
  'standalone org.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — `create_procurement_invoice`: four new TRAILING params, and an EXPLICIT gate.
--
-- ⚑ Postgres identifies a function by its exact arg list, so adding params changes the identity and
-- the OLD 8-param signature must be DROPPED with its EXACT current types — otherwise both overloads
-- coexist and PostgREST's named-param `.rpc()` errors "could not choose the best candidate function".
-- The types below are 0180's verbatim (the lineage is 0006 → 0041 → 0072 → 0100 → 0176 → 0180; only
-- 0041 and 0072 ever dropped, so the live identity is 0072's 8-arg list).
--
-- ⚑ WHY THE NEW PARAMS CARRY `default null` AND ARE THEN REJECTED IN THE BODY. Postgres forbids a
-- non-defaulted param after a defaulted one, so the alternative was to INSERT them mid-list, ahead
-- of `p_reference_number`. Every positional caller — `capture_vendor_invoice`, and every pgTAP call
-- site — would then have silently re-bound its reference number into `p_tax_treatment`: text into
-- text, no type error, caught only by the domain CHECK. A trailing default plus an explicit gate
-- fails LOUDLY and correctly instead, and it is the same move 0176 made for `p_status`: "a NULL
-- would otherwise have fallen through to the NOT NULL constraint — the wrong error".
--
-- The gate is therefore not belt-and-braces. It is the difference between "23502: null value in
-- column tax_treatment" and a message that names the omission and what to do about it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.create_procurement_invoice(
  uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz);

create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller. public.capture_vendor_invoice also calls this, but it
  -- is itself a definer invoked under the caller's JWT, so auth.uid() flows through unchanged.
  perform public.assert_is_active_member();
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
  -- ⚑ 0176: the origination-status gate. NULL-safe by construction (`not in` over a NULL p_status is
  -- NULL, so the explicit null check comes first). A NULL p_status would otherwise have fallen through
  -- to the NOT NULL constraint — the wrong error, and the §6 class.
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  -- ⚑ #505: the tax gate. Same construction and same reason as the status gate above.
  if p_tax_treatment is null or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template)
    returning * into v_row;
  return v_row;
end; $$;

-- EXECUTE grants re-issued for the NEW identity (a DROP takes its ACL with it). Byte-preserved from
-- 0100:210-212, which is the last place they were stated.
revoke all     on function public.create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz, text, numeric, numeric, text) from public;
grant  execute on function public.create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz, text, numeric, numeric, text) to   authenticated;
revoke execute on function public.create_procurement_invoice(uuid, procurement_invoice_status, date, text, numeric, text, uuid, timestamptz, text, numeric, numeric, text) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — `capture_vendor_invoice`: the SAME four params, forwarded.
--
-- Not optional. It is a second path that creates a vendor invoice, so leaving it alone would leave
-- exactly the hole this migration closes — and its inner call is POSITIONAL (0056:35), which is the
-- call the trailing-default choice in §2 was made to protect.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.capture_vendor_invoice(
  uuid, procurement_invoice_status, date, text, numeric, text);

create or replace function public.capture_vendor_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null,
  p_notes          text default null,
  p_tax_treatment  text default null,
  p_tax_amount     numeric default null,
  p_tax_rate       numeric default null,
  p_tax_template   text default null)
  returns procurement_invoices
  language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.procurement_invoices;
begin
  -- 1. Advance the case (legal-map + role + SoD + tenancy + status-event log, all in-guard).
  --    A raise here (illegal transition / not authorized) aborts before any invoice is created.
  perform transition_procurement(p_procurement_id, 'Vendor Invoiced'::procurement_status, p_notes);

  -- 2. Create the invoice (its own role gate + tenancy re-assertion, mints VI# server-side).
  --    A raise here rolls back the transition from step 1 — the two are atomic. ⚑ #505: the tax
  --    args are NAMED, not positional — the inner signature now has twelve params and four of them
  --    are not in this function's own order.
  v_invoice := create_procurement_invoice(
    p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount,
    p_tax_treatment  => p_tax_treatment,
    p_tax_amount     => p_tax_amount,
    p_tax_rate       => p_tax_rate,
    p_tax_template   => p_tax_template);

  return v_invoice;
end; $$;

revoke all     on function public.capture_vendor_invoice(uuid, procurement_invoice_status, date, text, numeric, text, text, numeric, numeric, text) from public;
grant  execute on function public.capture_vendor_invoice(uuid, procurement_invoice_status, date, text, numeric, text, text, numeric, numeric, text) to   authenticated;
revoke execute on function public.capture_vendor_invoice(uuid, procurement_invoice_status, date, text, numeric, text, text, numeric, numeric, text) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — the mirror guard: four lines added to an ENUMERATING denial list.
--
-- `procurement_invoices_native_mirror_guard` (0100:110, last replaced by 0189 §4) ENUMERATES its
-- denial set, so a column added later is user-writable while procurement is externally-owned unless
-- it is named here. 0189 skipped `purchase_requests`/`rfqs` precisely because THEIR guards are
-- blanket denials that enumerating would WEAKEN — this one is the opposite case, and the paired edit
-- is mandatory.
--
-- Body below is 0189 §4's verbatim, with four `is distinct from` lines inserted before the
-- id/procurement_id/org_id/created_at tail.
--
-- ⚑ NO TRIGGER IS RE-CREATED HERE, deliberately. `procurement_invoices_native_mirror_guard_trg`
-- (0100:141) binds to this function by OID, and `create or replace function` keeps that OID. 0189
-- records why this matters: live guard-trigger names are NOT uniform across tables (`_zz_…` vs
-- `_…_trg`), so a drop-and-recreate by habit leaves a duplicate trigger under a new name and a
-- changed firing order. 0125 is the incident.
--
-- ⚑ Volatility/security attributes are preserved exactly as they ship today — SECURITY INVOKER with
-- `set search_path = public`. `create or replace function` does NOT inherit them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
