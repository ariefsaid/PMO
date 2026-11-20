-- Reverse of 1093.
drop function if exists public.refile_document_lineage(uuid, uuid);
drop function if exists public.reorder_document_categories(uuid[]);
drop function if exists public.restore_document_category(uuid);
drop function if exists public.archive_document_category(uuid);
drop function if exists public.set_document_category_roles(uuid, public.user_role[]);
drop function if exists public.rename_document_category(uuid, text);
drop function if exists public.create_document_category(text, public.user_role[]);
drop function if exists public.assert_document_category_admin();
