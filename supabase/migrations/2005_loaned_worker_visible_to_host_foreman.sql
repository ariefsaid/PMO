-- 2005_loaned_worker_visible_to_host_foreman.sql — walk 24 Nov: a worker lent to a crew for a day was missing from the host foreman's phone
-- roster, and the foreman's "add someone" list was empty. The phone roster (work_order_roster, security invoker) reads crew_loans, and 1462
-- hid crew_loans from every light account, so the foreman's roster could not see the loan the office had recorded.
-- A light account now reads the loans of a crew it can already see (light_can_see_crew, 1205: the crew it leads or belongs to), and no
-- other loan row. Full accounts are unchanged. Writing a loan stays with the people who manage crews: this changes no write right.
-- The restrictive deny-select policy 1462 put on crew_loans is replaced by this scoped one; nothing else on the table changes.
-- Proven by supabase/tests/2005_loaned_worker_visible_to_host_foreman.test.sql.
-- Rollback: supabase/migrations/rollback/2005_loaned_worker_visible_to_host_foreman_down.sql
drop policy if exists light_account_deny_select on public.crew_loans;
create policy light_account_scope_select on public.crew_loans as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true or public.light_can_see_crew(host_crew_id));
