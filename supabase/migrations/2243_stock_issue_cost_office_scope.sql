-- Office scope for the stock costing configuration and captured purchase basis.
-- No field-account screen consumes either table. Rollback: rollback/2243_stock_issue_cost_office_scope_down.sql.
create policy light_account_deny_select on public.stock_issue_cost_settings
 as restrictive for select to authenticated using ((select public.actor_is_light()) is not true);
create policy light_account_deny_select on public.stock_issue_cost_purchases
 as restrictive for select to authenticated using ((select public.actor_is_light()) is not true);
