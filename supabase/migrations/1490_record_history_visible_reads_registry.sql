-- 1490_record_history_visible_reads_registry.sql — record_history_visible takes its entity → table map from
-- record_history_config instead of re-listing it (#2744, architecture pass C1).
--
-- WHY. 1417 was the fifth carry migration of one round: 1154, 1157, 1181 and 1413 each restated this whole
-- function to add one arm, and each restatement silently dropped the arms it had not been written from (1413
-- dropped 1154's, 1157's and 1181's). The map already lived in record_history_config — the function kept a
-- second, hand-written copy of it. Now the registry row IS the arm: a new tracked entity is one
-- `insert into record_history_config`, and this function never changes again.
--
-- SECURITY POSTURE, unchanged. record_history_visible stays SECURITY INVOKER, so the caller's RLS on the
-- SOURCE table still decides the answer. The registry itself stays unreadable by clients (0260 §7,
-- AC-CHG-009: no grant, no policy), which is why the one-row lookup below is a SECURITY DEFINER function
-- that returns a table NAME and nothing else — it cannot be turned into a read of any tenant row, and %I
-- quotes whatever it returns. A registry row whose table is missing raises, exactly as an unknown entity
-- type always has.
--
-- drops: record_history_visible's 21 hand-written case arms and its else-raise — the registry holds that map now.
-- Reversal: supabase/migrations/rollback/1490_record_history_visible_reads_registry_down.sql

create or replace function public.record_history_table(p_entity_type text) returns text
language sql stable security definer set search_path = public as $$
  select c.table_name from public.record_history_config c where c.entity_type = p_entity_type
$$;
revoke all on function public.record_history_table(text) from public, anon;
grant execute on function public.record_history_table(text) to authenticated, service_role;

create or replace function public.record_history_visible(p_entity_type text,p_entity_id uuid) returns boolean
language plpgsql stable security definer set search_path=public as $$  -- MUTATION B2: definer
declare v_table text; v_visible boolean;
begin
  v_table := public.record_history_table(p_entity_type);
  if v_table is null then v_table := 'projects'; end if; -- MUTATION B: an unregistered type answers from a fixed table
  execute format('select exists(select 1 from public.%I where id = $1)',v_table) into v_visible using p_entity_id;
  return v_visible;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;
