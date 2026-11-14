-- Historical provenance must remain in force until document captures are retired.
do $$ begin
  if exists (select 1 from public.erp_purchase_captures group by procurement_id having count(*)>1) then
    raise exception 'multiple_capture_history_exists' using errcode='55000';
  end if;
  if exists (select 1 from public.erp_purchase_captures where kind in ('order','supplier_invoice')) or exists (select 1 from public.erp_capture_batches) then
    raise exception 'capture_history_exists' using errcode='55000';
  end if;
end $$;
drop trigger z_record_only_capture_link_guard on public.procurement_erp_links;
drop function public.guard_capture_document_link();
drop function public.undo_captured_purchase(uuid,text,boolean);
alter function public.undo_captured_journal_purchase(uuid,text,boolean) rename to undo_captured_purchase;
grant execute on function public.undo_captured_purchase(uuid,text,boolean) to service_role, authenticated;
drop function public.unlink_erp_purchase_document(uuid);
alter function public.unlink_erp_purchase_document_unchecked(uuid) rename to unlink_erp_purchase_document;
grant execute on function public.unlink_erp_purchase_document(uuid) to service_role, authenticated;
-- Reverse the new read entry point; no purchase or audit history is removed.
drop function if exists public.purchase_capture_source_page(uuid, uuid, integer);
drop function if exists public.capture_history_apply(uuid,uuid,uuid,text,jsonb,jsonb,boolean);
drop function if exists public.capture_history_apply_internal(uuid,uuid,uuid,text,jsonb,jsonb,boolean,boolean);
drop function if exists public.purchase_capture_ledger_page(uuid,integer,uuid);
drop function if exists public.capture_source_evidence(uuid,uuid,uuid[]);
drop function if exists public.capture_source_kind(text);
drop function if exists public.purchase_capture_feed_health();
drop function if exists public.record_capture_feed_completion(uuid,uuid,text,timestamptz,uuid);
drop function if exists public.record_capture_feed_start(uuid,uuid,text,timestamptz,uuid);
drop table if exists public.erp_capture_feed_witnesses;
do $$
declare v_table text;
begin
  foreach v_table in array array['erp_purchase_documents','procurement_erp_links','erp_purchase_document_marks',
    'erp_gl_entry_mirror','erp_journal_line_links','budget_category_account_map','erp_account_mirror',
    'erp_actuals_snapshot','erp_financial_statement_snapshot','erp_financial_statement_published_context',
    'external_org_bindings','external_refs','projects','companies','procurements','external_domain_ownership',
    'organizations','erp_purchase_captures','purchase_requests','purchase_orders','procurement_receipts',
    'procurement_invoices','payments'] loop
    execute format('drop trigger if exists capture_census_fence on public.%I',v_table);
  end loop;
end $$;
drop function if exists public.fence_capture_source_change();

drop function if exists public.capture_history_batch(uuid,uuid,uuid,text,jsonb,jsonb);
drop table if exists public.erp_capture_batches;
drop index public.erp_purchase_captures_one_journal_idx;
drop index public.erp_purchase_captures_procurement_idx;
alter table public.erp_purchase_captures drop constraint erp_purchase_captures_pkey;
alter table public.erp_purchase_captures add primary key (procurement_id);
