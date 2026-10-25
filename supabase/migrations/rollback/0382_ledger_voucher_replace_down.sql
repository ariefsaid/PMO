-- Reverses 0382: drops the voucher replace functions and the Payment Ledger mirror's voucher columns.
-- The one-off cursor rewind is not reversed: the feed re-advances the cursors on its next full tick.

drop function if exists public.replace_erp_ple_voucher_rows(uuid, text, text, text, jsonb, text[]);
drop function if exists public.replace_erp_gl_voucher_rows(uuid, text, text, text, jsonb, text[]);
drop function if exists public.erp_ledger_voucher_replace_check(uuid, text, text, text, jsonb, text[]);
drop index if exists public.erp_payment_ledger_mirror_org_voucher_idx;
alter table public.erp_payment_ledger_mirror
  drop column if exists voucher_no,
  drop column if exists voucher_type;
