-- #1102: ledger mirror read-policy alignment.
alter policy erp_gl_entry_mirror_select on public.erp_gl_entry_mirror using (
  org_id = public.auth_org_id() and public.is_active_member()
  and public.auth_role() in ('Admin','Finance','Executive')
);
alter policy erp_payment_ledger_mirror_select on public.erp_payment_ledger_mirror using (
  org_id = public.auth_org_id() and public.is_active_member()
  and public.auth_role() in ('Admin','Finance','Executive')
);
