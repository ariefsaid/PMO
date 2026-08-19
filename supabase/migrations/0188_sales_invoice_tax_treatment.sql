-- 0188_sales_invoice_tax_treatment.sql — DD-XING-4(2) / #478 part B: the tax fields a PMO-authored
-- sales invoice needs before an ERPNext Sales Invoice can be reconstructed from it.
--
-- ── WHY (the deadline item, not an ordering item) ───────────────────────────────────────────────
-- `sales_invoices` (0123) carries `amount numeric(14,2)` and nothing else about the money. Its INSERT
-- policy is gated on `not domain_externally_owned(auth_org_id(),'revenue')`, so a STANDALONE org —
-- which is what RIS is from go-live until ERPNext lands — authors invoices natively into it. An
-- Indonesian sales invoice carries PPN and an ERPNext Sales Invoice REQUIRES a tax treatment; one
-- undifferentiated `amount` cannot be reconstructed into one, because whether the figure is tax-
-- INCLUSIVE or tax-EXCLUSIVE is recorded nowhere and no later inference recovers it. Cheap now,
-- unrecoverable after the first real invoice.
--
-- ── THE COLUMN THAT MATTERS, AND ITS EXACT MEANING ─────────────────────────────────────────────
-- `tax_treatment` answers exactly one question: **does THIS ROW's `amount` already include
-- `tax_amount`?** ('inclusive') or does the tax sit on top of it? ('exclusive'). It is deliberately
-- NOT "how were the ERP item rates keyed in" — that is an ERPNext authoring detail PMO does not hold.
-- Pinning it to this row's own `amount` makes the column TOTAL and always answerable:
--     net   = (tax_treatment = 'inclusive') ? amount - tax_amount : amount
--     gross = (tax_treatment = 'inclusive') ? amount              : amount + tax_amount
-- and it stays true across the ERP mirror: once a pushed invoice's `amount` is overwritten with
-- ERPNext's `grand_total`, the row IS inclusive — writing the author's original 'exclusive' next to a
-- grand total would be the lie. The mirror writers (readModelWriters.ts / erpnextFeedDeps.ts) set it
-- from that fact, not from a guess.
--
-- ── text, NOT boolean — on purpose ──────────────────────────────────────────────────────────────
-- `is_tax_inclusive boolean not null` looks equivalent and is not: a client that omits the field, or
-- hands over a JS falsy default, writes `false` = 'exclusive' — a WRONG value that is indistinguishable
-- from a deliberate one. A two-value text domain with NO DEFAULT makes an omission a hard 23502 and a
-- garbage value a hard 23514. The whole point of this migration is that a wrong marker is
-- unrecoverable, so the encoding must have no accidental-success path.
--
-- ── NOT NULL, and what is deliberately NULLABLE ────────────────────────────────────────────────
--   • tax_treatment — NOT NULL, NO DEFAULT. The irrecoverable one.
--   • tax_amount    — NOT NULL, NO DEFAULT. Always knowable by whoever raises the invoice (0 when
--     there is no tax); ERPNext states it on the header as `total_taxes_and_charges`.
--   • tax_rate      — NULLABLE, and that is a decision, not an omission. A mirrored ERP invoice's
--     rate lives on the `taxes` CHILD table, which the sweep's list endpoint cannot return; deriving
--     it as tax_amount/net*100 would be PMO COMPUTING a money figure it is supposed to READ
--     (ADR-0048) and would round differently from the authored rate. NULL means "not recorded on this
--     row", never "0%" — `tax_amount` + `tax_treatment` still determine the arithmetic completely.
--   • tax_template  — NULLABLE. The ERPNext "Sales Taxes and Charges Template" name is CONNECT-TIME
--     org config (DD-XING-4, DD-OPS-3: the PPN template is RIS's accounting call), so a standalone
--     org legitimately has none.
--
-- ── BACKFILL of pre-existing rows (stated, because a NOT NULL add cannot avoid one) ─────────────
-- Verified at authoring time: 0 rows in `sales_invoices` locally. Every row that could exist today is
-- an ERP MIRROR (there is no shipped PMO-native SI write path — the flip policies are forward-compat
-- seams), and a mirror row's `amount` is ERPNext's `grand_total`, which includes taxes by definition
-- ⇒ 'inclusive' is a FACT about those rows, not a guess. `tax_amount` is backfilled 0 meaning "no tax
-- split was ever recorded for this pre-#478 row"; that is the one figure here that is a placeholder,
-- and it is confined to demo/staging data raised before this migration. It is a one-time backfill and
-- NOT a column DEFAULT — nothing written after this migration can inherit it.
--
-- ── Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse block:
--   alter table public.sales_invoices drop column if exists tax_template;
--   alter table public.sales_invoices drop column if exists tax_rate;
--   alter table public.sales_invoices drop column if exists tax_amount;
--   alter table public.sales_invoices drop column if exists tax_treatment;
--   -- then re-run 0125's sales_invoices_native_mirror_guard() body (pre-0189, without the tax lines).

alter table public.sales_invoices
  add column if not exists tax_treatment text,
  add column if not exists tax_amount    numeric(14,2),
  add column if not exists tax_rate      numeric(6,3),
  add column if not exists tax_template  text;

-- One-time backfill (see header) — never a DEFAULT.
update public.sales_invoices
   set tax_treatment = coalesce(tax_treatment, 'inclusive'),
       tax_amount    = coalesce(tax_amount, 0)
 where tax_treatment is null or tax_amount is null;

alter table public.sales_invoices alter column tax_treatment set not null;
alter table public.sales_invoices alter column tax_amount    set not null;

alter table public.sales_invoices
  add constraint sales_invoices_tax_treatment_domain
  check (tax_treatment in ('inclusive','exclusive'));

-- `>= 0` alone is NOT sufficient: Postgres orders numeric NaN ABOVE every ordinary value, so
-- `'NaN'::numeric >= 0` is TRUE and PostgREST coerces the JSON string "NaN" straight into the column.
-- The upper bound is what actually rejects NaN (NaN < 'Infinity' is FALSE). Same construction and
-- same reason as 0169_contract_value_nonneg.
alter table public.sales_invoices
  add constraint sales_invoices_tax_amount_nonneg
  check (tax_amount >= 0 and tax_amount < 'Infinity'::numeric);

alter table public.sales_invoices
  add constraint sales_invoices_tax_rate_pct
  check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100));

comment on column public.sales_invoices.tax_treatment is
  'DD-XING-4/#478: does THIS row''s `amount` already include `tax_amount` (''inclusive'') or not '
  '(''exclusive'')? NOT NULL with no default — the one fact about an invoice that no later inference '
  'recovers. An ERP-mirrored row is ''inclusive'' because its `amount` is ERPNext grand_total.';
comment on column public.sales_invoices.tax_amount is
  'DD-XING-4/#478: total tax on the invoice, in `currency`. ERPNext header `total_taxes_and_charges`. '
  '0 means no tax; it never means unknown.';
comment on column public.sales_invoices.tax_rate is
  'DD-XING-4/#478: the authored tax percentage (e.g. 11.000 for PPN 11%). NULL = not recorded on this '
  'row (an ERP mirror keeps its rate on the taxes child table) — never 0%.';
comment on column public.sales_invoices.tax_template is
  'DD-XING-4/#478: ERPNext "Sales Taxes and Charges Template" name. Connect-time org config, so NULL '
  'for a standalone org.';

-- Grants: `sales_invoices` INSERT is COLUMN-LEVEL (0176 narrowed it), so a new column is not
-- insertable unless granted — without this the native author path cannot state its own tax treatment.
-- No UPDATE grant: `authenticated` holds none on this table at all (0176) and these columns must not
-- be the exception that re-opens it.
grant insert (tax_treatment, tax_amount, tax_rate, tax_template) on public.sales_invoices to authenticated;
