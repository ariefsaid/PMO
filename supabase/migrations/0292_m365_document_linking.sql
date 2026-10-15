-- 0292_m365_document_linking.sql — nullable Microsoft reference source for project documents.
-- Additive phase-1 migration; source constraints and other target relations follow in this migration.

create type public.doc_source as enum ('upload', 'onedrive');

alter table public.project_documents
  add column source public.doc_source,
  add column ms_drive_id text,
  add column ms_item_id text,
  add column ms_web_url text,
  add column ms_item_name text,
  add column ms_item_kind text,
  add column ms_linked_by uuid references public.profiles(id),
  add column ms_linked_at timestamptz,
  add column ms_last_verified_at timestamptz,
  add column ms_content_tag_at_issue text,
  add column ms_version_id_at_issue text,
  add column ms_drift_state text,
  add column ms_check_claim uuid,
  add column ms_check_claimed_at timestamptz;

-- Preserve existing uploads as uploads; metadata-only rows remain source-null.
update public.project_documents
set source = 'upload'
where file_path is not null;

create function public.m365_browser_url_valid(value text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(value ~* '^https://[[:alnum:]]([[:alnum:].-]*[[:alnum:]])?(:[0-9]{1,5})?(/[^[:space:]]*)?$'
    and value !~ '[[:cntrl:]]', false)
$$;

create function public.m365_ref_complete(
  drive text, item text, url text, name text, kind text, actor uuid, at_time timestamptz
) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(btrim(drive) <> '' and btrim(item) <> '' and btrim(name) <> ''
    and public.m365_browser_url_valid(url) and kind in ('file', 'folder')
    and actor is not null and at_time is not null, false)
$$;

revoke all on function public.m365_browser_url_valid(text) from public, anon;
revoke all on function public.m365_ref_complete(text,text,text,text,text,uuid,timestamptz) from public, anon;
grant execute on function public.m365_browser_url_valid(text) to authenticated, service_role;
grant execute on function public.m365_ref_complete(text,text,text,text,text,uuid,timestamptz) to authenticated, service_role;

alter table public.procurement_documents
  add column source public.doc_source,
  add column ms_drive_id text,
  add column ms_item_id text,
  add column ms_item_name text,
  add column ms_item_kind text,
  add column ms_linked_by uuid references public.profiles(id),
  add column ms_linked_at timestamptz,
  add column ms_last_verified_at timestamptz;

alter table public.project_documents
  add constraint project_documents_source_complete check (((
    (source is null and file_path is null and num_nonnulls(
      ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,
      ms_last_verified_at,ms_content_tag_at_issue,ms_version_id_at_issue,ms_drift_state,
      ms_check_claim,ms_check_claimed_at)=0)
    or (source='upload' and file_path is not null and num_nonnulls(
      ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,
      ms_last_verified_at,ms_content_tag_at_issue,ms_version_id_at_issue,ms_drift_state,
      ms_check_claim,ms_check_claimed_at)=0)
    or (source='onedrive' and file_path is null and public.m365_ref_complete(
      ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at)
      and (ms_content_tag_at_issue is null or btrim(ms_content_tag_at_issue)<>'')
      and (ms_version_id_at_issue is null or btrim(ms_version_id_at_issue)<>'')
      and (ms_drift_state is null or ms_drift_state in ('clean','drifted','not_verified'))
      and (ms_drift_state is null or ms_drift_state='not_verified' or ms_content_tag_at_issue is not null)
      and ((ms_check_claim is null)=(ms_check_claimed_at is null))
      and (ms_item_kind='file' or num_nonnulls(ms_content_tag_at_issue,ms_version_id_at_issue,
        ms_drift_state,ms_check_claim,ms_check_claimed_at)=0))
  ) is true));

alter table public.procurement_documents
  add constraint procurement_documents_source_complete check (((
    (source is null and num_nonnulls(ms_drive_id,ms_item_id,ms_item_name,ms_item_kind,
      ms_linked_by,ms_linked_at,ms_last_verified_at)=0)
    or (source='onedrive' and public.m365_ref_complete(ms_drive_id,ms_item_id,link,
      ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at))
  ) is true));
