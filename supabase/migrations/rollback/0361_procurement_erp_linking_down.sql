-- Reverses 0361. Linked documents become orphans again; purchases created from them stay (Draft or derived status).
drop function if exists public.link_procurement_sharepoint_item(uuid, text, uuid, jsonb);
drop function if exists public.unlink_erp_purchase_document(uuid);
drop function if exists public.link_erp_purchase_documents(jsonb, boolean);
drop function if exists public.refresh_erp_linked_purchase_total(uuid);
drop function if exists public.project_committed_spend(uuid);
drop function if exists public.procurement_open_commitment(public.procurements);
drop function if exists public.procurement_ledger_held(uuid);
drop trigger if exists procurement_documents_record_guard on public.procurement_documents;
drop function if exists public.guard_procurement_document_record();
alter table public.procurement_documents drop constraint if exists procurement_documents_record_pair,
  drop column if exists record_id, drop column if exists record_kind;
update public.record_history_config set omit_cols = array_remove(omit_cols, 'origin') where table_name = 'procurements';
alter table public.procurements drop column if exists origin;
delete from public.procurement_erp_links;
