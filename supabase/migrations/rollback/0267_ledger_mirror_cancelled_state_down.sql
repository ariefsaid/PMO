-- Reverses 0267_ledger_mirror_cancelled_state.sql.
comment on column public.erp_gl_entry_mirror.is_cancelled is null;
alter table public.erp_payment_ledger_mirror drop column if exists delinked;
