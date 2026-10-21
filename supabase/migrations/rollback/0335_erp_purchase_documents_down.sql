-- Revert 0335.
begin;
drop function if exists public.upsert_erp_purchase_documents(uuid, jsonb);
drop table if exists public.erp_purchase_documents;
drop index if exists public.erp_gl_entry_mirror_org_voucher_idx;
delete from public.external_sync_watermarks where external_tier = 'erpnext' and domain like 'purchases::%';
commit;
