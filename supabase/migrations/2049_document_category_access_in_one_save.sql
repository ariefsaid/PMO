-- 2049_document_category_access_in_one_save.sql — a document category's role access and its hidden job roles change in one
-- Admin-only save. The hidden list is written first and both writes run in one transaction: if either is refused, neither
-- changes, so a save never leaves role access open without the hiding that was meant to go with it.
-- The same guards as the two setters it calls: an active, non-field Admin of the category's organisation.
-- Proven by supabase/tests/2049_document_category_access_in_one_save.test.sql.
-- Rollback: rollback/2049_document_category_access_in_one_save_down.sql

create function public.set_document_category_access(p_id uuid, p_roles public.user_role[], p_hidden_job_roles text[])
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  perform public.assert_document_category_admin();
  perform public.set_document_category_hidden_job_roles(p_id, p_hidden_job_roles);                          -- mut:rr_access_hidden_first
  perform public.set_document_category_roles(p_id, p_roles);
end $$;
comment on function public.set_document_category_access(uuid, public.user_role[], text[]) is
  'Admin only: a document category''s viewer roles and hidden job roles, saved together (both or neither).';
revoke all on function public.set_document_category_access(uuid, public.user_role[], text[]) from public, anon;
grant execute on function public.set_document_category_access(uuid, public.user_role[], text[]) to authenticated, service_role;
