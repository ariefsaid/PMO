-- Reverses 0260: drops the capture trigger from every tracked table, the three functions and both tables.
-- Loses the recorded history (the accepted cost); never touches business rows. The triggers are dropped by
-- the same fixed list 0260 seeded into the registry, so this runs even if the registry is already gone.
do $$
declare t text;
begin
  foreach t in array array['budget_line_items','budget_versions','companies','contacts','payments','procurements',
                           'projects','purchase_orders','purchase_requests','rfqs','tasks','work_orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_zz_record_change', t);
  end loop;
end $$;
drop function if exists public.list_record_history(text, uuid, boolean, text[], bigint, timestamptz, integer);
drop policy if exists record_changes_select on public.record_changes;
drop function if exists public.record_history_visible(text, uuid);
drop function if exists public.record_change_capture();
drop table if exists public.record_changes;
drop table if exists public.record_history_config;
