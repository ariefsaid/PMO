begin;
\ir ../migrations/rollback/2450_receiving_contracts_down.sql
select plan(7);
select ok(position('order_receiving' in pg_get_functiondef('public.my_waiting_decisions()'::regprocedure)) > 0,
  'AC-RGO-013 2450 rollback restores the preceding receiving waiting body');
select is((select cmd from pg_policies where schemaname='public' and tablename='order_receiving_settings' and policyname='receiving_settings_write'), 'ALL',
  'AC-RGO-013 rollback restores the preceding settings write policy');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='order_receiving_settings' and policyname in ('receiving_settings_insert','receiving_settings_update')), 0,
  'AC-RGO-013 rollback removes the split settings policies');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename in ('order_receiving_settings','order_stock_mappings','order_receiving_requests','order_receiving_reversals','order_receiving_excess_approvals') and policyname='light_account_deny_select'), 0,
  'AC-RGO-013 rollback removes the five policies introduced by 2450');
\ir ../migrations/rollback/2224_order_receiving_waiting_down.sql
select ok(position('''check_in''::text' in pg_get_functiondef('public.my_waiting_decisions()'::regprocedure)) > 0,
  'AC-RGO-013 pre-receiving waiting body retains clock-in decisions');
select is(position('order_receiving' in pg_get_functiondef('public.my_waiting_decisions()'::regprocedure)), 0,
  'AC-RGO-013 pre-receiving waiting body has no receiving dependency');
select is(has_function_privilege('anon','public.my_waiting_decisions()','execute'), false,
  'AC-RGO-013 rollback retains the waiting-list audience');
select * from finish();
rollback;
