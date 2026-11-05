begin;
drop function if exists public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz);
drop function if exists public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz);
drop function if exists public._erp_statement_nightly_due_at(date,text);
-- The index drops with the table. Destructive to pending obligations by design; a later rollout owns
-- how real outstanding dates are retired. Never touches the 0643 parent objects.
drop table if exists public.erp_statement_nightly_obligation;
commit;
