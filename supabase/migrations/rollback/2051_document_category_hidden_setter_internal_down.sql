-- rollback of 2051_document_category_hidden_setter_internal.sql: the client grant 2047 gave.
grant execute on function public.set_document_category_hidden_job_roles(uuid, text[]) to authenticated;
