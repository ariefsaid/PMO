-- #2290: the date the ledger posted on, as Odoo says it (ADR-0048, the ledger is the oracle). Odoo posts a document dated inside a
-- locked period on another date instead of refusing it; the read-back mirrors that date here and flags the difference. Written by
-- the mirror writers only, for Odoo-held rows; the entered date (`invoice_date` / `date`) stays as the person typed it.
-- The invoice attention check gains the three ledger codes (`odoo_attention` holds one reason per invoice).
-- No function changes; no index (never filtered on).
-- Rollback: supabase/migrations/rollback/0883_odoo_ledger_posting_date_down.sql
alter table public.procurement_invoices add column if not exists erp_posting_date date;
alter table public.sales_invoices       add column if not exists erp_posting_date date;
alter table public.payments             add column if not exists erp_posting_date date;
alter table public.incoming_payments    add column if not exists erp_posting_date date;

comment on column public.procurement_invoices.erp_posting_date is
  'The accounting date the ledger posted the bill on (Odoo account.move.date); differs from invoice_date when the ledger moved it. Mirror writers only.';
comment on column public.sales_invoices.erp_posting_date is
  'The accounting date the ledger posted the invoice on (Odoo account.move.date); differs from invoice_date when the ledger moved it. Mirror writers only.';
comment on column public.payments.erp_posting_date is
  'The date the ledger posted the payment on (Odoo account.payment.date); differs from the entered date when the ledger moved it. Mirror writers only.';
comment on column public.incoming_payments.erp_posting_date is
  'The date the ledger posted the receipt on (Odoo account.payment.date); differs from date when the ledger moved it. Mirror writers only.';

alter table public.sales_invoices
  drop constraint sales_invoices_odoo_attention_check,
  add constraint sales_invoices_odoo_attention_check check (
    odoo_attention in (
      'total-mismatch', 'cost-account-missing', 'money-unreadable', 'lines-unreadable', 'advance-account-mismatch',
      'ledger-date-differs', 'ledger-date-unreadable', 'ledger-reference-differs'
    )
  );

-- Same classification as its 0506/0511 mirror siblings: a read-side ledger fact the machine writes, not a history event
-- (AC-CHG-011's catalog gate fails on an unclassified column). incoming_payments is not a tracked record type.
update public.record_history_config
   set omit_cols = omit_cols || array['erp_posting_date']
 where table_name in ('payments', 'procurement_invoices', 'sales_invoices');
