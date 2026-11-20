-- 1030_stock_document_files_down.sql — reverse 1030.
drop trigger if exists stock_storage_no_posted_delete on storage.objects;
drop function if exists public.guard_stock_storage_delete();
drop trigger if exists stock_document_files_zz_object on public.stock_document_files;
drop function if exists public.guard_stock_file_object();
drop policy if exists storage_stock_documents_read on storage.objects;
drop policy if exists storage_stock_documents_insert on storage.objects;
drop policy if exists storage_stock_documents_delete on storage.objects;
delete from storage.buckets where id = 'stock-documents';
drop trigger if exists stock_document_files_audit on public.stock_document_files;
drop function if exists public.audit_stock_file_add();
drop function if exists public.archive_stock_document_file(uuid, text);
drop trigger if exists stock_document_files_no_delete on public.stock_document_files;
drop function if exists public.guard_stock_file_delete();
drop table if exists public.stock_document_files;
drop function if exists public.stock_can_attach(uuid);

create or replace function public.stock_post_core(p_document_id uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare d public.stock_documents; v_uid uuid := auth.uid(); v_override boolean := false;
begin
  select * into d from public.stock_documents x where x.id = p_document_id for update;                   -- lock order (1)
  if not found or d.org_id is distinct from public.auth_org_id() then
    raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status = 'Posted' then return; end if;                                                           -- replay-safe
  if d.status = 'Cancelled' then raise exception 'STK_IMMUTABLE: a cancelled document cannot be posted' using errcode = 'P0001'; end if;
  perform public.stock_assert_standalone(d.org_id);
  perform public.stock_assert_dates(d.org_id, d.occurred_on);
  if d.kind in ('receive','transfer','issue','return') then
    v_override := public.stock_assert_keeper(d.org_id, d.warehouse_id, v_uid);
  end if;
  -- Archive vs post (#1512 S2b): share-lock the document's warehouses and items before the check, so an archive in flight
  -- finishes first (the check then sees it) and an archive started now waits for this post (its stock guard then sees the stock).
  perform 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) order by w.id for share;   -- mut:archivelock_wh
  perform 1 from public.stock_items i where i.id in (select l.item_id from public.stock_document_lines l where l.document_id = d.id) order by i.id for share;   -- mut:archivelock_item
  if exists (select 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) and w.archived_at is not null)
     or exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a warehouse or item on this document was archived' using errcode = 'P0001'; end if;
  perform public.stock_apply(d, true);
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = d.id;
  if v_override then
    perform public.log_audit('stock.admin_post', d.org_id, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', d.warehouse_id, 'number', d.number));
  end if;
end $$;

