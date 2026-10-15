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
