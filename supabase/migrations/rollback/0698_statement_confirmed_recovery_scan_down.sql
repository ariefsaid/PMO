-- Restores the 0685 post-confirm trigger function (intent bump only, no stamp), drops the recovery scan
-- RPC and the stamp column. Stamps written by 0698 are lost with the column; a later re-apply recovers
-- the same rows again (the scan is derived state, no data loss).
begin;
drop function if exists public.scan_erp_statement_confirmed_misses(uuid,uuid,uuid,timestamptz);
create or replace function public.request_erp_statement_refresh_after_post()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 begin
  update public.erp_statement_change_state set intent_revision=intent_revision+1
   where org_id=new.org_id and enabled;
 exception when others then
  raise warning 'statement refresh intent after confirmed post failed: %',sqlstate;
 end;
 return new;
end $$;
alter function public.request_erp_statement_refresh_after_post() owner to postgres;
revoke all on function public.request_erp_statement_refresh_after_post() from public,anon,authenticated,service_role;
alter table public.external_command_outbox drop column if exists statement_intent_at;
commit;
