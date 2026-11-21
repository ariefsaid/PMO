-- rollback/1147_erp_fiscal_year_ensure_down.sql
-- Refuse to drop while any fiscal-year intent is unresolved.
-- Otherwise drop fiscal_year config, RPCs, and intent table.

do $$
begin
  if exists (
    select 1
      from public.erp_fiscal_year_intents i
      left join public.external_command_outbox o on o.id = i.post_outbox_id
      left join public.external_org_bindings b on b.id = i.binding_id and b.org_id = i.org_id
     where i.post_outbox_id is null or o.id is null or o.state <> 'confirmed'
        or o.canonical->'status'->>'state' in ('needs-operator', 'refused')
        or (b.config->'fiscal_year'->>'state' = 'needs-operator'
            and b.config->'fiscal_year'->>'intentId' = i.id::text)
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
