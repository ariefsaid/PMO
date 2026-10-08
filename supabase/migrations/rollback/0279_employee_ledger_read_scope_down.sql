-- Reverse of 0279_employee_ledger_read_scope.sql.
begin;
drop policy if exists erp_payment_ledger_mirror_employee_read_scope on public.erp_payment_ledger_mirror;
commit;
