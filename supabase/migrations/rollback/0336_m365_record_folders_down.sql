drop function if exists public.m365_link_record_folder(text,uuid,jsonb,text,text,timestamptz);
drop function if exists public.m365_record_folder_created(uuid,text,uuid,text,text);
drop function if exists public.m365_record_folder_candidates(text,uuid);
drop function if exists public.m365_record_folder_default_matches(text,text,timestamptz);
drop index if exists public.m365_folder_created_identity_idx;
drop index if exists public.project_documents_folder_parent_idx;
drop index if exists public.procurement_documents_folder_parent_idx;
