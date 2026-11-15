-- Reverses 0883_odoo_ledger_posting_date.sql (#2290). A ledger code has no place in the narrower check, so it is cleared first
-- (the read-back sets it again on the next post once 0883 is re-applied); the posting dates are mirror facts and are dropped.
update public.sales_invoices set odoo_attention = null
 where odoo_attention in ('ledger-date-differs', 'ledger-date-unreadable', 'ledger-reference-differs');
alter table public.sales_invoices
  drop constraint sales_invoices_odoo_attention_check,
  add constraint sales_invoices_odoo_attention_check check (
    odoo_attention in (
      'total-mismatch', 'cost-account-missing', 'money-unreadable', 'lines-unreadable', 'advance-account-mismatch'
    )
  );
update public.record_history_config
   set omit_cols = array_remove(omit_cols, 'erp_posting_date')
 where table_name in ('payments', 'procurement_invoices', 'sales_invoices');
alter table public.incoming_payments    drop column if exists erp_posting_date;
alter table public.payments             drop column if exists erp_posting_date;
alter table public.sales_invoices       drop column if exists erp_posting_date;
alter table public.procurement_invoices drop column if exists erp_posting_date;
