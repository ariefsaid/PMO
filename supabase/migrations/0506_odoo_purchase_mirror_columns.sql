-- 0506_odoo_purchase_mirror_columns.sql (#1505 O2 P7, AC-OPP-070, FR-OPP-080/084)
-- What the shipped erp_* set already holds for an Odoo document, and what it cannot (P7-T1, read at origin/dev):
--   reused as is   erp_docstatus (0 draft / 1 issued, done or posted / 2 cancelled), erp_modified (Odoo's write_date, a naive
--                  UTC 'YYYY-MM-DD HH:MM:SS' that sorts as text), erp_cancelled_at (the cancel tombstone),
--                  procurement_invoices.erp_outstanding_amount, and the money columns the ERPNext bill writer fills
--                  (amount = gross, tax_amount, withheld_amount, tax_treatment).
--   new, additive  erp_state         Odoo's own state word (draft, purchase, done, posted, cancel, deleted ...), the fact the
--                                    docstatus number flattens;
--                  erp_attention     a plain reason a document needs a person (mismatch, incomplete or invalid header);
--                  erp_read_at       when the sweep last read the document (the as-of age, FR-OPP-090);
--                  erp_census_seen_at the census run that last saw the id (FR-OPP-085).
--   erp_purchase_documents (Odoo-native visibility rows, 0335): external_ref (the model-qualified Odoo ref, the row's identity
--                  for the feed and the census), erp_state, erp_attention, adoption_key (an anchor that names a PMO record
--                  with no link row: an adoption proposal, never a PMO row), erp_read_at, erp_census_seen_at.
--   procurement_receipts.odoo_booked / odoo_entered   what Odoo booked per order line and what the receipt entered (FR-OPP-034, P4 build
--                  note 10): lists of {lineId, productId, quantity}, written by the receipt mirror writer from the adapter's canonical.
-- Guard: the four mirror tables already pin their native columns while a domain is externally owned (0099/0100/0189/0481). The
-- new columns are pinned unconditionally by one trigger, because (a) the receipt and bill tables keep a table-level INSERT
-- grant, so only a trigger can stop a user stating them on insert, and (b) the pre-cut-over exemption in 0481 must not reach
-- machine-written facts. Only the service role (the sweep) and the owner (migrations) may write them.
-- Reversal: rollback/0506_odoo_purchase_mirror_columns_down.sql.

alter table public.purchase_orders
  add column erp_state text, add column erp_attention text, add column erp_read_at timestamptz, add column erp_census_seen_at timestamptz;
alter table public.procurement_receipts
  add column erp_state text, add column erp_attention text, add column erp_read_at timestamptz, add column erp_census_seen_at timestamptz;
alter table public.procurement_invoices
  add column erp_state text, add column erp_attention text, add column erp_read_at timestamptz, add column erp_census_seen_at timestamptz;
alter table public.payments
  add column erp_state text, add column erp_attention text, add column erp_read_at timestamptz, add column erp_census_seen_at timestamptz;

alter table public.procurement_receipts
  add column odoo_booked jsonb check (jsonb_typeof(odoo_booked) = 'array'),
  add column odoo_entered jsonb check (jsonb_typeof(odoo_entered) = 'array');

alter table public.erp_purchase_documents
  add column external_ref text, add column erp_state text, add column erp_attention text, add column adoption_key text,
  add column erp_read_at timestamptz, add column erp_census_seen_at timestamptz;
create unique index erp_purchase_documents_external_ref_idx on public.erp_purchase_documents (org_id, external_ref) where external_ref is not null;

-- Invoker, not definer: it reads nothing, and the caller's role decides. `role` is the session role PostgREST sets, so a definer
-- RPC called on a user's behalf is still refused. Allow-list: the service role, the owner roles and a session with no role set
-- (migrations); any other role, including one added later, is refused.
create or replace function public.odoo_mirror_columns_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') in ('', 'none', 'postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.erp_state is not null or new.erp_attention is not null or new.erp_read_at is not null or new.erp_census_seen_at is not null then
      raise exception '% Odoo mirror columns are machine-written', tg_table_name using errcode = '42501';
    end if;
  elsif new.erp_state is distinct from old.erp_state or new.erp_attention is distinct from old.erp_attention
     or new.erp_read_at is distinct from old.erp_read_at or new.erp_census_seen_at is distinct from old.erp_census_seen_at then
    raise exception '% Odoo mirror columns are machine-written', tg_table_name using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.odoo_mirror_columns_guard() from public, anon, authenticated;

create trigger purchase_orders_odoo_mirror_columns_guard_trg before insert or update on public.purchase_orders
  for each row execute function public.odoo_mirror_columns_guard();
create trigger procurement_receipts_odoo_mirror_columns_guard_trg before insert or update on public.procurement_receipts
  for each row execute function public.odoo_mirror_columns_guard();
create trigger procurement_invoices_odoo_mirror_columns_guard_trg before insert or update on public.procurement_invoices
  for each row execute function public.odoo_mirror_columns_guard();
create trigger payments_odoo_mirror_columns_guard_trg before insert or update on public.payments
  for each row execute function public.odoo_mirror_columns_guard();

-- The receipt's quantities are machine-written like the rest of the Odoo facts: the same allow-list, on the one table that has them.
create or replace function public.odoo_receipt_quantities_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') in ('', 'none', 'postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.odoo_booked is not null or new.odoo_entered is not null))
     or (tg_op = 'UPDATE' and (new.odoo_booked is distinct from old.odoo_booked or new.odoo_entered is distinct from old.odoo_entered)) then
    raise exception 'procurement_receipts Odoo quantities are machine-written' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.odoo_receipt_quantities_guard() from public, anon, authenticated;

create trigger procurement_receipts_odoo_quantities_guard_trg before insert or update on public.procurement_receipts
  for each row execute function public.odoo_receipt_quantities_guard();

-- Record history (AC-CHG-011): the four sync-bookkeeping columns are written by the sweep, not by a person, so they are
-- omitted from history on the tracked tables.
update public.record_history_config
   set omit_cols = omit_cols || array['erp_state','erp_attention','erp_read_at','erp_census_seen_at']
 where table_name in ('payments','procurement_invoices','purchase_orders');
