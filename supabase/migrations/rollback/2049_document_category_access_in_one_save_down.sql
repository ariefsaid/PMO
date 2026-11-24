-- rollback/2049_document_category_access_in_one_save_down.sql
drop function if exists public.set_document_category_access(uuid, public.user_role[], text[]);
