-- Reverse 0744. Mirror rows are reconstructible from the Odoo feed; they stay.
drop function if exists public.finish_odoo_ledger_census(uuid,timestamptz,integer);
drop function if exists public.mark_odoo_ledger_census_seen(uuid,timestamptz,text[]);
drop function if exists public.apply_odoo_ledger_page(uuid,jsonb,text);
drop function if exists public.odoo_ledger_line_id(text);
drop table if exists public.odoo_ledger_census_seen;
drop index if exists public.erp_gl_entry_mirror_odoo_line_idx;
drop index if exists public.erp_gl_entry_mirror_org_voucher_date_account_idx;
