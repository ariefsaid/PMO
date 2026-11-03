-- Reverse 0513. The side mirror is reconstructible from the Odoo feed; existing PMO invoice/payment rows remain.
drop function if exists public.finish_odoo_revenue_census(uuid,text,timestamptz,text);
drop function if exists public.mark_odoo_revenue_census_seen(uuid,text,timestamptz,text[]);
drop function if exists public.apply_odoo_revenue_page(uuid,text,jsonb,text);
drop function if exists public.odoo_revenue_page_rows(text,jsonb);
drop function if exists public.odoo_revenue_model(text);
drop table if exists public.odoo_revenue_census_seen;
drop table if exists public.revenue_erp_mirror;

-- Restore the 0508 vendor-payment resolver body. CREATE OR REPLACE preserves its ACL.
-- Restore the 0512 C5 receipt resolver. CREATE OR REPLACE preserves its grants.
create or replace function public.resolve_held_outbox_command(
  p_outbox_id uuid, p_resolution text, p_external_record_id text default null, p_reason text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_org     uuid;
  v_state   text;
  v_domain  text;
  v_tier    text;
  v_creator uuid;
  v_record  text;
  v_payload jsonb;
  v_kind    text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select o.org_id, o.state, o.domain, o.external_tier, o.actor_user_id, o.pmo_record_id, o.payload, o.payload->>'erp_doc_kind'
    into v_org, v_state, v_domain, v_tier, v_creator, v_record, v_payload, v_kind
    from public.external_command_outbox o where o.id = p_outbox_id for update;
  if v_org is null then
    raise exception 'outbox command not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from public.auth_org_id()
     or public.auth_role() not in ('Admin', 'Finance')
     or not public.is_active_member()
     or v_creator is null
     or v_creator = v_actor then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_state is distinct from 'held' then
    raise exception 'outbox command is % — only a held command can be resolved', v_state using errcode = 'P0001';
  end if;
  if v_tier is distinct from 'odoo'
     or not ((v_domain = 'procurement' and v_kind = 'payment') or (v_domain = 'revenue' and v_kind = 'incoming-payment')) then
    raise exception 'only a held Odoo vendor payment or customer receipt can be resolved here' using errcode = 'P0001';
  end if;

  if p_resolution = 'adopt' then
    if p_external_record_id is null or p_external_record_id !~ '^account\.payment:[0-9]+$' then
      raise exception 'adopt names an Odoo payment as account.payment:<id>' using errcode = '22023';
    end if;
    if exists (select 1 from public.external_refs r
                where r.org_id = v_org and r.external_tier = 'odoo' and r.external_record_id = p_external_record_id
                  and not (r.domain = v_domain and r.pmo_record_id = v_record)) then
      raise exception '% is already linked to another record', p_external_record_id using errcode = 'P0001';
    end if;
    v_payload := v_payload || jsonb_build_object('odoo_adopted_ref', p_external_record_id);
  elsif p_resolution = 'absent' then
    if p_external_record_id is not null then
      raise exception 'absent names no document' using errcode = '22023';
    end if;
    v_payload := v_payload || jsonb_build_object('odoo_absent_confirmed', true);
  else
    raise exception 'resolution must be adopt or absent' using errcode = '22023';
  end if;

  update public.external_command_outbox
     set state            = 'failed',
         payload          = v_payload,
         last_error       = 'hold resolved (' || p_resolution || ') by operator ' || v_actor::text || ': ' || coalesce(p_reason, ''),
         claim_generation = claim_generation + 1,
         updated_at       = now()
   where id = p_outbox_id;

  perform public.log_audit(
    'resolve_held_outbox_command', v_org, v_actor, p_outbox_id,
    jsonb_build_object('resolution', p_resolution, 'external_record_id', p_external_record_id, 'reason', p_reason, 'resolved_from', v_state)
  );
end;
$$;

revoke all on function public.resolve_held_outbox_command(uuid, text, text, text) from public;
grant execute on function public.resolve_held_outbox_command(uuid, text, text, text) to authenticated;
revoke execute on function public.resolve_held_outbox_command(uuid, text, text, text) from anon;

notify pgrst, 'reload schema';
