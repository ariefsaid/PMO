from pathlib import Path
import sys
up = Path('supabase/migrations/2755_org_day_remainder.sql').read_text()
down = Path('supabase/migrations/rollback/2755_org_day_remainder_down.sql').read_text()
setup = '''begin;
create extension if not exists pgtap;
select plan(2);
create temp table snapshots (label text, value text);
create function pg_temp.snapshot() returns text language sql as $$
select md5(string_agg(x, E'\\n' order by x)) from (
  select p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(p.proacl::text, '') as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(array[
     'get_executive_dashboard','guard_crew_loan_archive','guard_tpi_transition',
     'set_procurement_invoice_efaktur','set_sales_invoice_efaktur',
     'get_work_order_performance','work_order_cost_amounts_unrounded',
     'native_org_today','native_org_date','org_today','org_date','equipment_org_today','qcr_org_today',
     'rsv_today','site_checkpoint_today','stock_org_today','wrp_org_today'])
  union all
  select pg_get_viewdef('public.work_order_cost_lines'::regclass) || coalesce(c.relacl::text,'') || coalesce(c.reloptions::text,'')
    from pg_class c where c.oid = 'public.work_order_cost_lines'::regclass
) s $$;
insert into snapshots values ('up', pg_temp.snapshot());
'''
test = setup + down + "\ninsert into snapshots values ('down', pg_temp.snapshot());\n" + up
test += "\nselect is(pg_temp.snapshot(), (select value from snapshots where label='up'), 'up is restored after down and up');\n"
test += down + "\nselect is(pg_temp.snapshot(), (select value from snapshots where label='down'), 'down is repeatable after up and down');\nselect * from finish(); rollback;\n"
Path(sys.argv[1]).write_text(test)
