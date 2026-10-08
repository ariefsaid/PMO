-- 0281_employee_ledger_read_scope.sql — align PLE Employee-party reads with the ledger read scope.
-- Reverse: rollback/0281_employee_ledger_read_scope_down.sql.
create policy erp_payment_ledger_mirror_employee_read_scope on public.erp_payment_ledger_mirror
  as restrictive for select to authenticated
  using (party_type is distinct from 'Employee' or public.holds_spend_approval_authority(public.auth_role()));
