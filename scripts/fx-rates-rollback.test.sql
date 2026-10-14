-- Run via scripts/fx-rates-rollback.test.sh while holding with-db-lock.sh.
-- Supabase's pgTAP runner stages this file without mounting sibling migration paths,
-- so the wrapper applies the shipped rollback migration before running these assertions.
create extension if not exists pgtap;
select plan(3);
select hasnt_table('public','fx_rates','AC-FX-002 rollback removes table');
select ok(to_regprocedure('public.fx_rate_on(text,text,date)') is null,'AC-FX-003 rollback removes selector');
select ok(to_regprocedure('public.upsert_fx_rates(jsonb)') is null,'AC-FX-002 rollback removes writer');
select * from finish();
