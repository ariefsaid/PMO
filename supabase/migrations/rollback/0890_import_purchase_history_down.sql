-- Rollback of 0890 (#1855). Refuses while any import exists: dropping the table would erase who vouched for each approval.
select public.assert_purchase_history_rollback_safe();
drop function public.import_purchase_history(jsonb,boolean);
drop function public.import_purchase_history_row(jsonb,boolean);
drop function public.assert_purchase_history_rollback_safe();
drop table public.purchase_history_imports;
