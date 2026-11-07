-- Reverse 0746. Read-only functions (plus the fiscal-year-end setter); no data is touched, a stored fiscal_year_end stays in the binding config.
drop function if exists public.get_odoo_statement_catalogue(uuid);
drop function if exists public.get_odoo_statement(text, jsonb, uuid);
drop function if exists public.odoo_project_ledger(uuid, text, date);
drop function if exists public.odoo_statement_generation();
drop function if exists public.odoo_period_bounds(text, date, integer);
drop function if exists public.odoo_ledger_in_use();
drop function if exists public.odoo_fiscal_end_month();
drop function if exists public.set_odoo_fiscal_year_end(uuid, integer, integer);
