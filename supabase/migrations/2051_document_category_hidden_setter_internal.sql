-- 2051_document_category_hidden_setter_internal.sql — a category's hidden job roles are set only through the one access save.
-- set_document_category_access (2049) is the client command; set_document_category_hidden_job_roles is its internal step and no
-- client role executes it.
-- Proven by supabase/tests/0178_anon_executable_definers.test.sql (AC-ACL-004) and 2047_document_category_hidden_job_roles.test.sql.
-- Rollback: rollback/2051_document_category_hidden_setter_internal_down.sql
revoke execute on function public.set_document_category_hidden_job_roles(uuid, text[]) from public, anon, authenticated;
