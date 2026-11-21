-- 1229 (#2710): reshape the light-account deny policy from ONE `for all` restrictive policy into per-command restrictive policies.
-- Rollback: supabase/migrations/rollback/1229_light_account_policy_shape_down.sql
-- The repo's policy-shape guards forbid `for all` policies (outside an allowlist) and any DELETE policy on a table the client
-- cannot delete from. The predicate is unchanged: `(select public.actor_is_light()) is not true`, so the outcome for every caller
-- is the same as 1206/1219. Per table: select, insert, update; delete only where `authenticated` holds a DELETE grant.
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_policies
            where schemaname = 'public' and policyname = 'light_account_deny' loop
    execute format('drop policy light_account_deny on %I.%I', r.schemaname, r.tablename);
    execute format('create policy light_account_deny_select on %I.%I as restrictive for select to authenticated using ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    execute format('create policy light_account_deny_insert on %I.%I as restrictive for insert to authenticated with check ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    execute format('create policy light_account_deny_update on %I.%I as restrictive for update to authenticated using ((select public.actor_is_light()) is not true) with check ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    if has_table_privilege('authenticated', format('%I.%I', r.schemaname, r.tablename), 'DELETE') then
      execute format('create policy light_account_deny_delete on %I.%I as restrictive for delete to authenticated using ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    end if;
  end loop;
end $$;
