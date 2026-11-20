-- rollback/1147_erp_fiscal_year_ensure_down.sql
-- Refuse to drop while intents have post_started_at and an outbox row not confirmed.
-- Otherwise drop fiscal_year config, RPCs, and intent table.

do $$
begin
  if exists (
    select 1
      from public.erp_fiscal_year_intents i
      join public.external_command_outbox o on o.id = i.post_outbox_id
     where i.post_started_at is not null
       and o.state <> 'confirmed'
  ) then
    raise exception 'refusing to roll back while unresolved fiscal year intents exist' using errcode = 'P0001';
  end if;
end;
$$;

update public.external_org_bindings
   set config = config - 'fiscal_year'
 where config ? 'fiscal_year';

drop function if exists public.record_fiscal_year_observation(uuid,uuid,text,text,timestamptz,timestamptz,jsonb);
drop function if exists public.record_fiscal_year_status(uuid,uuid,text,text,timestamptz,uuid,uuid,bigint,jsonb);
drop function if exists public.begin_fiscal_year_post(uuid,uuid,uuid,bigint);
drop function if exists public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text);

drop table if exists public.erp_fiscal_year_intents;
