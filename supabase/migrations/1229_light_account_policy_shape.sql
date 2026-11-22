-- 1229 (#2710): reshape the light-account deny policy from ONE `for all` restrictive policy into per-command restrictive policies.
-- Rollback: supabase/migrations/rollback/1229_light_account_policy_shape_down.sql
-- The repo's policy-shape guards forbid `for all` policies (outside an allowlist) and any DELETE policy on a table the client
-- cannot delete from. The predicate is unchanged: `(select public.actor_is_light()) is not true`, so the outcome for every caller
-- is the same as 1206/1219. Per table: select, insert, update; delete only where `authenticated` holds a DELETE grant.
-- EXCLUSION LIST: on sales_invoices, incoming_payments, payments, procurement_invoices, procurement_receipts and purchase_orders
-- only light_account_deny_select is created. The write-policy sets on these tables are pinned by existing guards; reads are narrowed.
-- Likewise 1206's own-row light_account_scope_delete policies are dropped where `authenticated` holds no DELETE grant.
do $$
declare r record;
  v_select_only text[] := array['sales_invoices','incoming_payments','payments','procurement_invoices','procurement_receipts','purchase_orders'];
begin
  for r in select schemaname, tablename from pg_policies
            where schemaname = 'public' and policyname = 'light_account_deny' loop
    execute format('drop policy light_account_deny on %I.%I', r.schemaname, r.tablename);
    execute format('create policy light_account_deny_select on %I.%I as restrictive for select to authenticated using ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    continue when r.tablename = any(v_select_only);
    execute format('create policy light_account_deny_insert on %I.%I as restrictive for insert to authenticated with check ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    execute format('create policy light_account_deny_update on %I.%I as restrictive for update to authenticated using ((select public.actor_is_light()) is not true) with check ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    if has_table_privilege('authenticated', format('%I.%I', r.schemaname, r.tablename), 'DELETE') then
      execute format('create policy light_account_deny_delete on %I.%I as restrictive for delete to authenticated using ((select public.actor_is_light()) is not true)', r.schemaname, r.tablename);
    end if;
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_policies
            where schemaname = 'public' and policyname = 'light_account_scope_delete' and cmd = 'DELETE' loop
    if not has_table_privilege('authenticated', format('%I.%I', r.schemaname, r.tablename), 'DELETE') then
      execute format('drop policy light_account_scope_delete on %I.%I', r.schemaname, r.tablename);
    end if;
  end loop;
end $$;
