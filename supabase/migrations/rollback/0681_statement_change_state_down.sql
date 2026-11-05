begin;
drop function if exists public.observe_erp_statement_change(uuid,uuid,uuid,timestamptz,uuid,jsonb);
drop function if exists public.sync_erp_statement_change_scope(uuid,uuid,uuid,timestamptz);
drop function if exists public._erp_statement_change_validate(jsonb,uuid,timestamptz,text);
drop function if exists public._erp_statement_change_lease_check(uuid,uuid);
drop function if exists public._erp_statement_change_context(uuid,uuid,uuid,timestamptz);
drop table if exists public.erp_statement_change_state;
commit;
