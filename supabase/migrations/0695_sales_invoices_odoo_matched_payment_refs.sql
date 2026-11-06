-- #1825 — the receipt references the invoice read-back shows matched (the 'Receipt sent, awaiting Odoo' flag clears on one system's evidence).
-- 0511's four odoo_* columns hold what an invoice push read back. This column extends the read-back with
-- what a RECEIPT's settle proved: `account.payment:<id>` references the settle read back as reconciled
-- against THIS invoice (the adapter refuses to commit a receipt Odoo did not reconcile with it). The
-- receipt finalize's mirror writer merges each committed receipt's reference here, together with the
-- money that same read showed (erp_outstanding_amount / status / erp_modified / odoo_read_at), so the
-- flag clears because the reference appears in the invoice's own read-back — never because one wall
-- clock passed another. Written only by the service-role mirror writer: pinned by
-- sales_invoices_native_mirror_guard against every non-service caller, like the 0511 facts.
-- Reversal: rollback/0695_sales_invoices_odoo_matched_payment_refs_down.sql.

-- `default '{}'` (review M3): the writer treats null as empty, but a fresh row now states its own
-- empty set — a default rewrites nothing on PG16 and keeps 'no references yet' from reading as
-- 'never read' alongside the 0511 facts (which stay nullable: they are facts ABOUT a read, this is a SET).
alter table public.sales_invoices
  add column odoo_matched_payment_refs text[] default '{}';

comment on column public.sales_invoices.odoo_matched_payment_refs is
  'Receipt references (account.payment:<id>) an Odoo read-back showed reconciled with this invoice; written by the receipt finalize mirror writer only. #1825: the awaiting-Odoo flag clears when the sent receipt''s own reference appears here.';

create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  -- 0511 (#1506 C3): the Odoo facts are written only by the service-role mirror writer. Pinned before the externally-owned early
  -- return, so a person never sets them directly, whoever owns revenue (the client UPDATE grant is already revoked, 0176; this is the trigger layer).
  -- 0695 (#1825): the matched receipt references join them — the flag's single-system evidence.
  if new.odoo_state is distinct from old.odoo_state
     or new.odoo_attention is distinct from old.odoo_attention
     or new.odoo_sent_total is distinct from old.odoo_sent_total
     or new.odoo_read_at is distinct from old.odoo_read_at
     or new.odoo_matched_payment_refs is distinct from old.odoo_matched_payment_refs then
    raise exception 'the Odoo facts of an invoice are written only by the mirror' using errcode = '42501';
  end if;
  -- 0498 (#1602): the pair columns are written only by accept_invoice_pairs (a definer, current_user = postgres, flag set
  -- in its own transaction). Pinned before the externally-owned early return: a person never sets them directly.
  if (new.paired_erp_invoice_id is distinct from old.paired_erp_invoice_id
      or new.paired_at is distinct from old.paired_at
      or new.paired_by is distinct from old.paired_by
      or new.paired_filled is distinct from old.paired_filled)
     and not (current_user = 'postgres' and coalesce(current_setting('pmo.invoice_pairing', true), '') = 'on') then
    raise exception 'an invoice is paired only by accepting a proposed pair' using errcode = '42501';
  end if;
  -- A paired copy counts through its ERP invoice: no native status, amount or balance write, even if PMO later owns revenue again.
  if old.paired_erp_invoice_id is not null and new.paired_erp_invoice_id is not distinct from old.paired_erp_invoice_id
     and (new.status is distinct from old.status or new.amount is distinct from old.amount
          or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
          or new.overpaid_amount is distinct from old.overpaid_amount
          or new.native_lines is distinct from old.native_lines) then
    raise exception 'a paired invoice counts through its ERP invoice and cannot be changed in PMO' using errcode = '42501';
  end if;
  if new.erp_project is distinct from old.erp_project then
    raise exception 'ERP project provenance is read-only' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
     or (new.billing_kind is distinct from old.billing_kind and current_user <> 'postgres') -- 0410 (#1471): only the definer RPCs change it
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
     or (new.work_order_id is distinct from old.work_order_id    -- 0193 (#498): which scope grant this bills
         and not (current_user = 'postgres' and coalesce(current_setting('pmo.invoice_pairing', true), '') = 'on')) -- 0498: accept fills an empty one, unpair clears what it filled
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0275 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0275 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0275 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0275 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0275 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0275 (#784, DD-NAR-16)
     or (old.pmo_native and new.received_date is distinct from old.received_date) -- 0275: a PMO invoice is frozen whole
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;


-- #1825 (review I2): the receipt finalize's read-back merge is THIS ONE STATEMENT. The dispatch writer
-- used to select the invoice's references, merge in JS, and update — two statements a second receipt
-- finalizing on the same invoice could interleave: the loser's stale merge dropped the winner's
-- reference, and with the clock fallback disabled that receipt's awaiting-Odoo flag never cleared.
-- Concurrent callers here serialize on the invoice row lock — each update re-reads the committed
-- references inside the statement, so every committed reference survives — and
-- `array(select distinct …)` collapses a replay's duplicate (set semantics: the flag's oracle is
-- `contains reference`, so order is unspecified and nothing may depend on it). A NULL fact argument
-- keeps the column it would have written: an unreadable read-back header never erases what the ledger
-- said (erp_modified / odoo_read_at included — review M1), and the money keys move only when the
-- header carried a readable outstanding figure (p_outstanding / p_status non-null together, derived by
-- the writer). A wrong org simply matches no row (the where clause is the org guard).
create or replace function public.record_sales_invoice_receipt_read_back(
  p_org          uuid,
  p_invoice_id   uuid,
  p_refs         text[],
  p_erp_modified text,
  p_outstanding  numeric,
  p_status       text,
  p_odoo_read_at timestamptz
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update public.sales_invoices set
    odoo_matched_payment_refs = (select array(select distinct r from unnest(sales_invoices.odoo_matched_payment_refs || p_refs) as r)),
    erp_modified             = coalesce(p_erp_modified, sales_invoices.erp_modified),
    odoo_read_at             = coalesce(p_odoo_read_at, sales_invoices.odoo_read_at),
    erp_outstanding_amount   = coalesce(p_outstanding, sales_invoices.erp_outstanding_amount),
    status                   = coalesce(p_status, sales_invoices.status)
  where sales_invoices.org_id = p_org
    and sales_invoices.id = p_invoice_id;
end $$;

-- ── ACL discipline (0163 pattern): SECURITY DEFINER over a guard-pinned table; MACHINE-ONLY. The only
-- caller is the service-role dispatch edge fn (the mirror writer). A client principal could otherwise
-- forge the read-back evidence — the awaiting-Odoo flag's oracle — for any org's invoice. The 0511
-- mirror guard above still governs the write itself: it passes only under service-role JWT claims,
-- which is the only shape in which the edge fn can reach this function. ─────────────────────────────
revoke all     on function public.record_sales_invoice_receipt_read_back(uuid, uuid, text[], text, numeric, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.record_sales_invoice_receipt_read_back(uuid, uuid, text[], text, numeric, text, timestamptz) to   service_role;
