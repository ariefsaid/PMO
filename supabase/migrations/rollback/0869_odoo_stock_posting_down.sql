do $$ begin
  if exists(select 1 from public.stock_erp_mirror) then
    raise exception 'STK_ROLLBACK_MIRROR_EXISTS: stock mirror evidence prevents rollback';
  end if;
  if exists(select 1 from public.external_command_outbox where domain='inventory') then
    raise exception 'STK_ROLLBACK_COMMANDS_EXIST: connected stock commands prevent rollback';
  end if;
end $$;
revoke update (status, posted_by, posted_at) on public.stock_documents from service_role;
drop trigger stock_documents_command_guard on public.stock_documents;
drop trigger stock_document_lines_command_guard on public.stock_document_lines;
drop trigger external_command_outbox_zz_stock_command on public.external_command_outbox;
drop trigger external_command_outbox_stock_hold_released on public.external_command_outbox;
drop trigger external_domain_ownership_stock_drafts on public.external_domain_ownership;
drop trigger external_domain_ownership_stock_release on public.external_domain_ownership;
drop function public.guard_stock_command_document();
drop function public.guard_stock_command();
drop function public.guard_stock_employment();
drop function public.guard_stock_release();
drop function public.stock_command_actor_rank(uuid,uuid);
drop function public.write_stock_erp_mirror(uuid,uuid,integer,integer,text,text,text,text,numeric,numeric,text,timestamptz,timestamptz,text);
drop function public.get_stock_erp_value(uuid);
drop function public.stock_command_live(uuid,uuid);
drop function public.keep_stock_hold_released();
alter table public.external_command_outbox drop column stock_hold_released_at;
drop table public.stock_erp_mirror;
drop index public.stock_documents_org_id_id_uniq;
