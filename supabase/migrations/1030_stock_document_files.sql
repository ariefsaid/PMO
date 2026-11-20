-- 1030_stock_document_files.sql — #2523: attachments on stock documents (FR-SSW-020..022), spec docs/specs/stock-site-work.spec.md.
-- Proven by supabase/tests/stock_site_work.test.sql (AC-SSW-007, AC-SSW-008).
--   §1 stock_document_files + RLS: read = whoever reads the document; add = the document's author, its warehouses' keepers or an Admin,
--      while the document is Draft or Posted; delete = Draft only (a trigger refuses it for a Posted document for every caller);
--      a Posted document's file is archived with a reason through archive_stock_document_file (audit row).
--   §2 the private bucket stock-documents, path {org}/{document}/{file_id}/{filename}, with the same rules.
--   §3 stock_post_core gains the paper-required check (a transfer of a zero-cost item whose tag requires paper).
-- The posting itself stays immutable: the document row is never touched by an attachment.
-- ── REVERSE (rollback/1030_stock_document_files_down.sql): restore 0413's stock_post_core; drop policies, stock_doc_readable, bucket policies, table.

-- §1 ---------------------------------------------------------------------------------------------------
create table public.stock_document_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  document_id    uuid not null references public.stock_documents(id),
  file_path      text not null check (length(file_path) between 1 and 500),
  label          text check (label is null or length(btrim(label)) between 1 and 120),
  uploaded_by    uuid default auth.uid() references public.profiles(id),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz,
  archived_by    uuid references public.profiles(id),
  archive_reason text check (archive_reason is null or length(btrim(archive_reason)) between 1 and 500),
  constraint stock_document_files_archive_shape check ((archived_at is null) = (archive_reason is null))
);
create index stock_document_files_doc_idx on public.stock_document_files (document_id, created_at desc);
create trigger stock_document_files_stamp_org_id before insert on public.stock_document_files for each row execute function public.stamp_org_id();

-- Who may attach to a document: its author, a keeper of either warehouse, or an Admin. Definer: reads keepers whatever the caller's RLS.
create or replace function public.stock_can_attach(p_document_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.stock_documents d
     where d.id = p_document_id and d.org_id = public.auth_org_id() and d.status in ('Draft', 'Posted')
       and (d.created_by = auth.uid()
            or coalesce(public.role_rank(public.auth_role()) >= 50, false)
            or exists (select 1 from public.stock_warehouse_keepers k
                        where k.org_id = d.org_id and k.user_id = auth.uid() and k.warehouse_id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id))))) $$;
revoke all on function public.stock_can_attach(uuid) from public, anon;
grant execute on function public.stock_can_attach(uuid) to authenticated;

alter table public.stock_document_files enable row level security;
alter table public.stock_document_files force row level security;
create policy stock_document_files_select on public.stock_document_files for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.stock_documents d where d.id = document_id));         -- the document's own read rule
create policy stock_document_files_insert on public.stock_document_files for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.stock_can_attach(document_id));
create policy stock_document_files_delete on public.stock_document_files for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.stock_can_attach(document_id));
revoke all on public.stock_document_files from authenticated, anon;
grant select on public.stock_document_files to authenticated;
grant insert (id, document_id, file_path, label) on public.stock_document_files to authenticated;
grant delete on public.stock_document_files to authenticated;
-- No UPDATE grant: archiving goes through archive_stock_document_file only.

-- Bind the evidence row to the uploaded object and its exact document and file identity.
create or replace function public.guard_stock_file_object() returns trigger
  language plpgsql security definer set search_path = public, storage, pg_temp as $$
begin
  if split_part(new.file_path, '/', 1) is distinct from new.org_id::text
     or split_part(new.file_path, '/', 2) is distinct from new.document_id::text
     or split_part(new.file_path, '/', 3) is distinct from new.id::text
     or array_length(string_to_array(new.file_path, '/'), 1) is distinct from 4
     or split_part(new.file_path, '/', 4) = ''
     or not exists (select 1 from storage.objects o where o.bucket_id = 'stock-documents' and o.name = new.file_path) then
    raise exception 'STK_FILE_MISSING: upload the attachment before linking it' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_stock_file_object() from public, anon, authenticated;
create trigger stock_document_files_zz_object before insert on public.stock_document_files for each row execute function public.guard_stock_file_object();

-- Serialize object deletion with posting; a posted document keeps its uploaded paper.
create or replace function public.guard_stock_storage_delete() returns trigger
  language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare v_status text;
begin
  if old.bucket_id <> 'stock-documents' then return old; end if;
  select d.status into v_status from public.stock_documents d where d.id::text = split_part(old.name, '/', 2) for update;
  if v_status is distinct from 'Draft' then
    raise exception 'STK_FILE_LOCKED: a posted document''s attachment cannot be deleted; archive it with a reason' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke all on function public.guard_stock_storage_delete() from public, anon, authenticated;
create trigger stock_storage_no_posted_delete before delete on storage.objects for each row execute function public.guard_stock_storage_delete();

-- A Posted (or Cancelled) document's attachment is never deleted, by any caller.
create or replace function public.guard_stock_file_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select d.status into v_status from public.stock_documents d where d.id = old.document_id;
  if v_status is distinct from 'Draft' then                                                      -- mut:file_delete
    raise exception 'STK_FILE_LOCKED: a posted document''s attachment cannot be deleted; archive it with a reason' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke all on function public.guard_stock_file_delete() from public, anon, authenticated;
create trigger stock_document_files_no_delete before delete on public.stock_document_files for each row execute function public.guard_stock_file_delete();

create or replace function public.archive_stock_document_file(p_file_id uuid, p_reason text) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare f public.stock_document_files; v_uid uuid := auth.uid();
begin
  perform public.assert_is_active_member();
  select * into f from public.stock_document_files x where x.id = p_file_id and x.org_id = public.auth_org_id();
  if found then
    perform 1 from public.stock_documents d where d.id = f.document_id for update;
    select * into f from public.stock_document_files x where x.id = p_file_id and x.org_id = public.auth_org_id() for update;
  end if;
  if not found then raise exception 'STK_NOT_FOUND: the file is not in your organisation' using errcode = 'P0001'; end if;
  if not public.stock_can_attach(f.document_id) then raise exception 'you cannot change this document''s attachments' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 500 then raise exception 'STK_INVALID: archiving needs a reason' using errcode = 'P0001'; end if;
  if f.archived_at is not null then return; end if;
  update public.stock_document_files set archived_at = now(), archived_by = v_uid, archive_reason = btrim(p_reason) where id = f.id;
  perform public.log_audit('stock.file.archive', f.org_id, v_uid, f.document_id,
            jsonb_build_object('file_id', f.id, 'label', f.label, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.archive_stock_document_file(uuid, text) from public, anon;
grant execute on function public.archive_stock_document_file(uuid, text) to authenticated;

create or replace function public.audit_stock_file_add() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('stock.file.add', new.org_id, auth.uid(), new.document_id, jsonb_build_object('file_id', new.id, 'label', new.label));
  return null;
end $$;
revoke all on function public.audit_stock_file_add() from public, anon, authenticated;
create trigger stock_document_files_audit after insert on public.stock_document_files for each row execute function public.audit_stock_file_add();

-- §2 bucket ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('stock-documents', 'stock-documents', false, 5242880,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;
-- Definer: the bucket policies below run for every caller touching storage.objects, including roles with no grant on
-- stock_documents; reading the table inline would raise 42501 for unrelated objects. Same rule as the document's own read policy.
create or replace function public.stock_doc_readable(p_document text, p_draft_only boolean default false) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.stock_documents d
     where d.id::text = p_document and d.org_id = public.auth_org_id() and (not p_draft_only or d.status = 'Draft')) $$;
revoke all on function public.stock_doc_readable(text, boolean) from public, anon;
grant execute on function public.stock_doc_readable(text, boolean) to authenticated;
create policy storage_stock_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'stock-documents' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and public.stock_doc_readable(split_part(name, '/', 2)));
create policy storage_stock_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'stock-documents' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and public.stock_can_attach(split_part(name, '/', 2)::uuid));
create policy storage_stock_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'stock-documents' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and public.stock_doc_readable(split_part(name, '/', 2), true)
         and public.stock_can_attach(split_part(name, '/', 2)::uuid));

-- §3 stock_post_core: 0413's body plus the paper-required check ---------------------------------------------
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
  perform 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) order by w.id for share;   -- mut:archivelock_wh_v2
  perform 1 from public.stock_items i where i.id in (select l.item_id from public.stock_document_lines l where l.document_id = d.id) order by i.id for share;   -- mut:archivelock_item_v2
  if exists (select 1 from public.stock_warehouses w where w.id in (d.warehouse_id, coalesce(d.to_warehouse_id, d.warehouse_id)) and w.archived_at is not null)
     or exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id and i.archived_at is not null) then
    raise exception 'STK_ARCHIVED: a warehouse or item on this document was archived' using errcode = 'P0001'; end if;
  -- Retagging is allowed until the first movement; recheck any draft lines under item/tag locks.
  perform 1 from public.stock_tags t where t.id in (select i.tag_id from public.stock_document_lines l join public.stock_items i on i.id = l.item_id where l.document_id = d.id) order by t.id for share;
  if exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id
             join public.stock_tags t on t.id = i.tag_id where l.document_id = d.id and t.zero_cost and l.unit_cost <> 0) then
    raise exception 'STK_ZERO_COST: a client-supplied item is received at cost 0' using errcode = 'P0001';
  end if;
  -- Lock live evidence before checking it, so an archive cannot race the posting.
  perform 1 from public.stock_document_files f where f.document_id = d.id and f.archived_at is null order by f.id for share;
  -- FR-SSW-022: a transfer of a zero-cost item whose tag says "paper required" posts only with a live attachment.
  if d.kind = 'transfer'
     and exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id
                   join public.stock_tags t on t.id = i.tag_id
                  where l.document_id = d.id and t.zero_cost and t.paper_required)                     -- mut:paper
     and not exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path where f.document_id = d.id and f.archived_at is null) then
    raise exception 'STK_PAPER_REQUIRED: attach the delivery paper before posting this client-supplied transfer' using errcode = 'P0001';
  end if;
  perform public.stock_apply(d, true);
  update public.stock_documents set status = 'Posted', posted_by = v_uid, posted_at = now() where id = d.id;
  if v_override then
    perform public.log_audit('stock.admin_post', d.org_id, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', d.warehouse_id, 'number', d.number));
  end if;
end $$;

