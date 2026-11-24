-- Reverses 2005: a light account reads no crew loans again (the 1462 shape).
drop policy if exists light_account_scope_select on public.crew_loans;
create policy light_account_deny_select on public.crew_loans as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
