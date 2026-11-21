-- Rollback of 1229: restore the single restrictive `for all` light_account_deny policy on each table that carries the per-command set.
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_policies
            where schemaname = 'public' and policyname = 'light_account_deny_select' loop
    execute format('drop policy light_account_deny_select on %I.%I', r.schemaname, r.tablename);
    execute format('drop policy if exists light_account_deny_insert on %I.%I', r.schemaname, r.tablename);
    execute format('drop policy if exists light_account_deny_update on %I.%I', r.schemaname, r.tablename);
    execute format('drop policy if exists light_account_deny_delete on %I.%I', r.schemaname, r.tablename);
    execute format('create policy light_account_deny on %I.%I as restrictive for all to authenticated using ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
  end loop;
end $$;
