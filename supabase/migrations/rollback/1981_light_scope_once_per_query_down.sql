-- reverse 1981: the per-row helper policy as created in 1206.
alter policy light_account_scope_select on public.crew_members
  using ((select public.actor_is_light()) is not true or public.light_can_see_crew_member(crew_id, worker_id));
