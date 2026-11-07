-- Reverse 0746. Read-only functions; no data is touched.
drop function if exists public.get_odoo_statement_catalogue(uuid);
drop function if exists public.get_odoo_statement(text, jsonb, uuid);
drop function if exists public.odoo_project_ledger(uuid, jsonb);
drop function if exists public.odoo_fiscal_end_month();
