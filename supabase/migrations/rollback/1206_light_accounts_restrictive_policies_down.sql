drop trigger if exists aa_tasks_light_status_only on public.tasks;
drop function if exists public.tasks_light_status_only();
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
            where schemaname = 'public' and (policyname = 'light_account_deny' or policyname like 'light_account_scope_%') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
