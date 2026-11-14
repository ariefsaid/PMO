do $$ begin
  if exists(select 1 from public.external_command_outbox where domain='inventory') then
    raise exception 'STK_ROLLBACK_COMMANDS_EXIST: connected stock commands prevent rollback';
  end if;
end $$;
drop trigger stock_documents_command_guard on public.stock_documents;
drop trigger stock_document_lines_command_guard on public.stock_document_lines;
drop trigger external_command_outbox_zz_stock_command on public.external_command_outbox;
drop trigger external_domain_ownership_stock_drafts on public.external_domain_ownership;
drop function public.guard_stock_command_document();
drop function public.guard_stock_command();
drop function public.guard_stock_employment();
drop function public.stock_command_actor_rank(uuid,uuid);
