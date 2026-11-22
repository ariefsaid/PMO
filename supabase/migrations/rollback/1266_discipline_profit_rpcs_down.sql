-- Rollback of 1266_discipline_profit_rpcs.sql.
drop function if exists public.project_discipline_revenue(uuid);
drop function if exists public.set_boq_item_discipline(uuid, uuid);
