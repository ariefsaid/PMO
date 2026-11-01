-- 0409 — document preview (ADR-0095, #1474): one durable source per purchase attachment, and the Draft
-- upload-to-Microsoft swap on project documents. Additive and reversible; no backfill, no bulk movement,
-- no existing uploaded byte or Microsoft file is touched.
-- Rollback: supabase/migrations/rollback/0409_document_preview_sources_down.sql
-- Proven by supabase/tests/0409_document_preview_sources.test.sql.

-- §1 — the seven typed purchase attachment tables gain the Microsoft reference columns. A storage-backed
-- attachment stays `source is null` with `file_path` set; a Microsoft-backed one is `source = 'onedrive'`
-- with `file_path` null and a complete reference. `'upload'` is deliberately not accepted here, so each
-- source has exactly one representation. Clients still update only `title` and `archived_at` (0349).
do $$
declare t text;
begin
  foreach t in array array['procurement_quotation_files','procurement_receipt_files','procurement_invoice_files',
    'purchase_request_files','rfq_files','purchase_order_files','payment_files'] loop
    execute format($f$
      alter table public.%1$I
        add column source public.doc_source,
        add column ms_drive_id text,
        add column ms_item_id text,
        add column ms_web_url text,
        add column ms_item_name text,
        add column ms_linked_by uuid references public.profiles(id),
        add column ms_linked_at timestamptz,
        add constraint %1$I_source_one check ((
          (source is null and num_nonnulls(ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_linked_by,ms_linked_at)=0)
          or (source='onedrive' and file_path is null
              and public.m365_ref_complete(ms_drive_id,ms_item_id,ms_web_url,ms_item_name,'file',ms_linked_by,ms_linked_at))
        ) is true) $f$, t);
  end loop;
end $$;

-- §2 — the link actor and time are server-owned: stamped on insert for a Microsoft-backed row (unless a
-- trusted bypass actor, such as a seed or import, supplies them) and cleared for a storage-backed row.
create function public.stamp_procurement_file_ms_source() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.source = 'onedrive' then
    if not public.actor_bypasses_rls() then
      new.ms_linked_by := auth.uid();
      new.ms_linked_at := now();
    end if;
  else
    new.ms_linked_by := null;
    new.ms_linked_at := null;
  end if;
  return new;
end; $$;
revoke all on function public.stamp_procurement_file_ms_source() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['procurement_quotation_files','procurement_receipt_files','procurement_invoice_files',
    'purchase_request_files','rfq_files','purchase_order_files','payment_files'] loop
    -- the zz_ prefix orders this after the 0349 storage-key guard on the same table
    execute format('create trigger zz_%1$s_ms_stamp before insert on public.%1$I for each row execute function public.stamp_procurement_file_ms_source()', t);
  end loop;
end $$;

-- §3 — a connected organisation replaces a Draft private upload with a Microsoft file in ONE statement
-- (`source: upload -> onedrive`, `file_path -> null`). This body is migration 0292's `guard_project_m365_source`
-- with exactly one condition widened (the "already has a file" collision); the Draft-only, author-or-Admin,
-- writer-role and org checks below it still run for the swap because they key on `new.source = 'onedrive'`.
create or replace function public.guard_project_m365_source() returns trigger
language plpgsql set search_path=public as $$
declare v_parent_org uuid;
begin
  if tg_op='INSERT' and new.file_path is not null and new.source is null then new.source:='upload'; end if;
  if public.actor_bypasses_rls() then return new; end if;
  if not public.is_active_member() or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  select p.org_id into v_parent_org from public.projects p where p.id=new.project_id;
  if v_parent_org is distinct from public.auth_org_id() or new.org_id is distinct from public.auth_org_id() then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if new.source='onedrive' and (new.status<>'Draft' or (new.author_id is distinct from auth.uid()
       and public.auth_role()<>'Admin')) then
      raise exception 'Cannot change this document reference.' using errcode='42501';
    end if;
    return new;
  end if;
  if old.source='onedrive' and new.file_path is not null then
    raise exception 'Clear the Microsoft reference before uploading.' using errcode='23514',detail='m365-source-collision';
  end if;
  if new.source='onedrive' and (
       (old.file_path is not null and not (old.source='upload' and new.file_path is null))
       or (old.source is not null and old.source is distinct from 'upload')) then
    raise exception 'This entry already has a file or link.' using errcode='23514',detail='m365-source-collision';
  end if;
  if new.source='onedrive' or old.source='onedrive' then
    if old.status<>'Draft' or (old.author_id is distinct from auth.uid() and public.auth_role()<>'Admin') then
      raise exception 'Cannot change this document reference.' using errcode='42501';
    end if;
  end if;
  if old.source is distinct from 'onedrive' then
    if new.file_path is not null and new.source is null then new.source:='upload';
    elsif old.file_path is not null and new.file_path is null and new.source='upload' then new.source:=null;
    end if;
  end if;
  return new;
end; $$;
