-- Reverses 0382: drops the voucher replace functions and the Payment Ledger mirror's voucher columns.
-- Any repair marker the feed has not yet consumed is removed (older feeds never read it).

drop function if exists public.finish_erp_ple_voucher_backfill(uuid, text);
drop function if exists public.replace_erp_ple_voucher_rows(uuid, text, text, text, jsonb, text[]);
drop function if exists public.replace_erp_gl_voucher_rows(uuid, text, text, text, jsonb, text[]);
drop function if exists public.erp_ledger_voucher_replace_check(uuid, text, text, text, jsonb, text[]);
drop index if exists public.erp_payment_ledger_mirror_org_voucher_idx;
alter table public.erp_payment_ledger_mirror
  drop column if exists voucher_no,
  drop column if exists voucher_type;
delete from public.external_sync_watermarks
 where external_tier = 'erpnext' and domain in ('ledger::GL Entry::repair', 'ledger::Payment Ledger Entry::repair');
