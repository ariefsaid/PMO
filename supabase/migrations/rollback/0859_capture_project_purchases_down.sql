do $migration$
declare v_def text; v_old constant text := $old$'set_project_contract_value', 'transition_project', 'import_budget_line_v2'$old$;
  v_new constant text := $new$'set_project_contract_value', 'transition_project', 'import_budget_line_v2', 'purchase_capture_source_page', 'purchase_capture_ledger_page', 'purchase_capture_feed_health', 'purchase_capture_actuals_witness', 'capture_existing_purchases'$new$;
begin
  select pg_get_functiondef('public.api_client_request_guard()'::regprocedure) into v_def;
  if position(v_new in v_def) > 0 then
    execute replace(v_def,v_new,v_old);
  elsif position(v_old || ', ''purchase_capture_source_page'', ''purchase_capture_ledger_page'', ''purchase_capture_feed_health'', ''capture_existing_purchases''' in v_def) > 0 then
    execute replace(v_def, v_old || ', ''purchase_capture_source_page'', ''purchase_capture_ledger_page'', ''purchase_capture_feed_health'', ''capture_existing_purchases''', v_old);
  elsif position(v_old || ', ''purchase_capture_source_page'', ''purchase_capture_ledger_page'', ''capture_existing_purchases''' in v_def) > 0 then
    execute replace(v_def, v_old || ', ''purchase_capture_source_page'', ''purchase_capture_ledger_page'', ''capture_existing_purchases''', v_old);
  elsif position(v_old || ', ''purchase_capture_source_page'', ''capture_existing_purchases''' in v_def) > 0 then
    execute replace(v_def, v_old || ', ''purchase_capture_source_page'', ''capture_existing_purchases''', v_old);
  elsif position(v_old in v_def) = 0 then
    raise exception 'capture rollback: expected admin RPC list';
  end if;
end $migration$;
do $$ begin
  if exists (select 1 from public.procurements where capture_history_notice is not null) then
    raise exception 'Undo captured purchase history before reversing this migration';
  end if;
end $$;
drop function if exists public.purchase_capture_actuals_witness(uuid);
drop function if exists public.purchase_capture_feed_health();
drop function if exists public.record_purchase_capture_feed_completion(uuid,uuid,timestamptz);
drop table if exists public.erp_purchase_capture_feed_state;
drop function if exists public.purchase_capture_ledger_page(uuid, integer);
drop function if exists public.purchase_capture_source_page(uuid, uuid, integer);
drop function public.capture_existing_purchases(jsonb, boolean);
drop function if exists public.classify_capture_invoice(uuid);
drop function public.capture_history_link_internal(jsonb, boolean);
drop table public.erp_capture_sources;
alter table public.procurements drop column capture_history_notice;
notify pgrst, 'reload schema';
