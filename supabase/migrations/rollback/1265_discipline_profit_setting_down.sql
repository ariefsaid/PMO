-- Rollback of 1265_discipline_profit_setting.sql. Apply 1266's rollback first.
drop function if exists public.set_org_discipline_profit_enabled(boolean);
drop function if exists public.get_org_discipline_profit_enabled();
drop index if exists public.boq_items_discipline_idx;
alter table public.boq_items drop column if exists discipline_id;
alter table public.organizations drop column if exists discipline_profit_enabled;
