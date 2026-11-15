-- #2290 AC-ODR-005: the ledger's posting date lives beside the entered date, and the invoice attention check admits the ledger codes.
begin;
select plan(10);
select has_column('public', 'procurement_invoices', 'erp_posting_date', 'AC-ODR-005 bills carry the ledger posting date');
select has_column('public', 'sales_invoices', 'erp_posting_date', 'AC-ODR-005 invoices carry the ledger posting date');
select has_column('public', 'payments', 'erp_posting_date', 'AC-ODR-005 vendor payments carry the ledger posting date');
select has_column('public', 'incoming_payments', 'erp_posting_date', 'AC-ODR-005 receipts carry the ledger posting date');
select col_type_is('public', 'sales_invoices', 'erp_posting_date', 'date', 'AC-ODR-005 the posting date is a date');
select col_is_null('public', 'sales_invoices', 'erp_posting_date', 'AC-ODR-005 the posting date is nullable (ERPNext rows and legacy rows have none)');
select is((select count(*)::int from pg_constraint where conname = 'sales_invoices_odoo_attention_check'
  and pg_get_constraintdef(oid) like '%''ledger-date-differs''%'), 1,
  'AC-ODR-005 the invoice attention check admits ledger-date-differs');
select is((select count(*)::int from pg_constraint where conname = 'sales_invoices_odoo_attention_check'
  and pg_get_constraintdef(oid) like '%''ledger-reference-differs''%' and pg_get_constraintdef(oid) like '%''ledger-date-unreadable''%'
  and pg_get_constraintdef(oid) like '%''advance-account-mismatch''%' and pg_get_constraintdef(oid) like '%''total-mismatch''%'), 1,
  'AC-ODR-005 the invoice attention check names the other two ledger codes and keeps every earlier one');
select is((select count(*)::int from pg_constraint where conname = 'sales_invoices_odoo_attention_check'
  and pg_get_constraintdef(oid) like '%''ledger-anything''%'), 0,
  'AC-ODR-005 the invoice attention check is still a closed list');
select is((select count(*)::int from information_schema.column_privileges
  where column_name = 'erp_posting_date' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')
    and table_schema = 'public' and table_name in ('procurement_invoices', 'sales_invoices', 'payments', 'incoming_payments')), 0,
  'AC-ODR-005 no client role can write the posting date: the mirror writers (service role) alone set it');
select * from finish();
rollback;
