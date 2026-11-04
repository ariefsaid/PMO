-- Reverse 0642. The marker is scheduling state only: no PMO-owned fact is lost, and a dropped marker
-- simply makes every org due on the next tick (the sweep re-creates it on its next published pass).
drop function if exists public.defer_erp_statement_pass(uuid, uuid, int);
drop function if exists public.mark_erp_statement_pass_done(uuid, uuid);
drop table if exists public.erp_statement_pass_run;
