-- Rollback of 0745_odoo_ledger_health.sql (#1507 S4).
begin;
drop function if exists public.get_odoo_ledger_lines(uuid, text, text, integer);
drop function if exists public.get_odoo_ledger_health(uuid);
drop function if exists public.record_odoo_ledger_check(uuid, timestamptz, jsonb, text, text);
drop table if exists public.odoo_ledger_checks;
notify pgrst, 'reload schema';
commit;
