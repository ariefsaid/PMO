-- ECA-3 (#1606): the send drain. Proposals an Admin accepted as "send" wait in state `sending` (0480); the sweep claims them, sends
-- each master through the money outbox and records the result here. Reversal: rollback/0482_erp_connect_sends_down.sql.
-- Service role only: the drain reads the org from the connection it works for and every function re-scopes by it.

alter table public.erp_connect_proposals add column send_claimed_at timestamptz;   -- the drain's lease; decided_at is the accept time
alter table public.erp_connect_proposals add column send_failures int not null default 0;   -- ticks that ended in trouble nobody can classify

-- Leases up to p_limit waiting sends of the org's activated connection. A lease lasts five minutes (the outbox quarantine window,
-- money-path primer "Numeric relationships"); a send the ERP has not answered is claimed again after it.
create or replace function public.claim_connect_sends(p_org_id uuid, p_tier text, p_limit int) returns setof public.erp_connect_proposals
language sql security definer set search_path = public, pg_temp as $$
  update public.erp_connect_proposals p set send_claimed_at = now()
   where p.id in (
     select q.id from public.erp_connect_proposals q
      where q.org_id = p_org_id and q.external_tier = p_tier and q.state = 'sending' and q.outcome = 'send'
        and q.binding_id = (select b.id from public.external_org_bindings b
                             where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active' and b.activated_at is not null)
        and (q.send_claimed_at is null or q.send_claimed_at < now() - interval '5 minutes')
      order by q.send_claimed_at nulls first, q.id
      limit least(greatest(coalesce(p_limit, 1), 1), 50)
      for update skip locked)
  returning p.*
$$;

-- C1: the ERP id a PMO record is already linked to, or null. The drain asks before any ERP call: a record that has its link is never
-- sent again (a second send would make a second ERP record and, for a company, move the link). Same stores apply_connect_link writes.
create or replace function public.connect_send_existing_link(p_org_id uuid, p_tier text, p_kind text, p_pmo text) returns text
language sql security definer set search_path = public, pg_temp as $$
  select case p_kind
    when 'party' then (select r.external_record_id from public.external_refs r
                        where r.org_id = p_org_id and r.domain = 'companies' and r.pmo_record_id = p_pmo)
    when 'project' then (select b.config->'project_map'->>p_pmo from public.external_org_bindings b
                          where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
    when 'item' then (select b.config->'item_map'->>p_pmo from public.external_org_bindings b
                       where b.org_id = p_org_id and b.external_tier = p_tier and b.status = 'active')
  end
$$;

-- I1: trouble nobody can classify (not a refusal, not a hold, not an unreachable ERP) is counted; the fifth one in a row ends the send as a
-- review row in plain words instead of retrying for ever. Returns true when it ended the send.
create or replace function public.record_connect_send_failure(p_org_id uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return false; end if;
  update public.erp_connect_proposals set send_failures = send_failures + 1 where id = p.id returning send_failures into p.send_failures;
  if p.send_failures < 5 then return false; end if;
  perform public.record_connect_send_result(p_org_id, p_id, null, 'We could not finish sending this record. Check it in the ERP, then try again.');
  return true;
end $$;

-- One send ended well (p_rejection null: link it) or badly (p_rejection: plain words for the Admin). A result for a proposal that is
-- no longer waiting changes nothing, so a repeat is harmless; a proposal of another organisation is refused.
create or replace function public.record_connect_send_result(p_org_id uuid, p_id uuid, p_external_id text, p_rejection text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype; v_reason text;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return; end if;
  if p_rejection is null then
    if coalesce(p_external_id, '') = '' then raise exception 'a successful send names the ERP record' using errcode = '22023'; end if;
    -- the one link writer for every kind (apply_connect_link): it never re-points an existing link and answers a clash in plain words below
    begin
      if p.kind = 'item' and p_external_id = p.pmo_ids[1] then v_reason := null;   -- the line name is the ERP code: nothing to map
      else v_reason := public.apply_connect_link(p.org_id, p.external_tier, p.kind, p.pmo_ids[1], p_external_id, '{"reviewed":true}'::jsonb, p.decided_by);
      end if;
    exception when others then
      raise warning 'record_connect_send_result % : % %', p.kind, sqlstate, sqlerrm;   -- the Admin gets plain words; the log keeps the cause
      v_reason := 'This row could not be applied';
    end;
    if v_reason is null then
      update public.erp_connect_proposals set state = 'applied', reason_text = null where id = p.id;
      perform public.settle_connect_run(p.org_id, p.external_tier);
      return;
    end if;
  else
    v_reason := p_rejection;
  end if;
  -- a refused send is a review row no matcher run writes (run_id null, an identity of its own): the next run cannot overwrite or delete it
  update public.erp_connect_proposals
     set outcome = 'review', reason = 'rejected', reason_text = left(v_reason, 300), state = 'open', run_id = null,
         identity = 'review|' || to_jsonb(p.pmo_ids)::text || '|' || to_jsonb(p.external_ids)::text || '|send:' || p.id::text
   where id = p.id;
  perform public.settle_connect_run(p.org_id, p.external_tier);
end $$;

-- The outbox could not decide whether the ERP created the record (NFR-ECA-004): never reported as done, never created again behind the Admin's back.
create or replace function public.record_connect_send_held(p_org_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.erp_connect_proposals%rowtype;
begin
  select * into p from public.erp_connect_proposals where id = p_id and org_id = p_org_id for update;
  if not found then raise exception 'unknown proposal' using errcode = 'P0002'; end if;
  if p.state <> 'sending' or p.outcome <> 'send' then return; end if;
  update public.erp_connect_proposals
     set outcome = 'review', reason = 'held', reason_text = 'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.', state = 'open', run_id = null,
         identity = 'review|' || to_jsonb(p.pmo_ids)::text || '|' || to_jsonb(p.external_ids)::text || '|send:' || p.id::text
   where id = p.id;
  perform public.settle_connect_run(p.org_id, p.external_tier);
end $$;

-- I2: a held send's way out. An Admin who checked the ERP and found nothing sends it again: the hold is released (audited, release_outbox_hold)
-- and the proposal waits for the drain again, which looks the record up before it creates anything.
create or replace function public.retry_connect_send(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_org uuid := public.auth_org_id(); r public.erp_connect_proposals%rowtype; o public.external_command_outbox%rowtype;
        v_domain text;
begin
  if v_actor is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.erp_connect_proposals where id = p_id and org_id = v_org for update;
  if not found or r.outcome <> 'review' or r.reason is distinct from 'held' or r.state <> 'open' or r.kind not in ('party','project','item') then
    raise exception 'held send not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.external_org_bindings where id = r.binding_id and status = 'active') then
    raise exception 'no active connection for this ERP' using errcode = 'P0001';
  end if;
  v_domain := case r.kind when 'party' then 'companies' when 'project' then 'projects' else 'items' end;
  select * into o from public.external_command_outbox
   where org_id = v_org and domain = v_domain and pmo_record_id = r.pmo_ids[1] and idempotency_key = 'seed:' || r.kind || ':' || r.pmo_ids[1] for update;
  if found and o.state = 'held' then
    perform public.release_outbox_hold(o.id, 'send tried again from the setup checklist', v_domain);
  end if;
  update public.erp_connect_proposals
     set outcome = 'send', reason = null, reason_text = null, state = 'sending', send_claimed_at = null, send_failures = 0, decided_by = v_actor, decided_at = now(),
         identity = 'send|' || to_jsonb(pmo_ids)::text || '|[]|again:' || id::text
   where id = r.id;
  perform public.log_audit('integration.connect_send_retry', v_org, v_actor, p_id, jsonb_build_object('tier', r.external_tier, 'kind', r.kind, 'pmoId', r.pmo_ids[1]));
end $$;

-- I2: a send that did not come from a proposal (a project created from its own page) that the outbox held leaves the same decision row, so the
-- Admin sees it and has the same way out. One open row per record.
create or replace function public.record_connect_record_held(p_org_id uuid, p_tier text, p_kind text, p_pmo text, p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_binding uuid;
begin
  select id into v_binding from public.external_org_bindings where org_id = p_org_id and external_tier = p_tier and status = 'active';
  if v_binding is null then return; end if;
  insert into public.erp_connect_proposals (org_id, binding_id, external_tier, run_id, kind, outcome, identity, pmo_ids, external_ids, reason, reason_text, snapshot, state)
    values (p_org_id, v_binding, p_tier, null, p_kind, 'review', 'review|' || to_jsonb(array[p_pmo])::text || '|[]|held', array[p_pmo], '{}', 'held',
            'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.',
            jsonb_build_object('name', left(coalesce(p_name, ''), 200)), 'open')
    on conflict (org_id, external_tier, kind, identity) do update set state = 'open', reason = 'held', outcome = 'review'
      where public.erp_connect_proposals.state in ('open', 'dismissed');
end $$;

revoke all on function public.claim_connect_sends(uuid, text, int), public.record_connect_send_result(uuid, uuid, text, text),
  public.record_connect_send_held(uuid, uuid), public.connect_send_existing_link(uuid, text, text, text), public.record_connect_send_failure(uuid, uuid),
  public.retry_connect_send(uuid), public.record_connect_record_held(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_connect_sends(uuid, text, int), public.record_connect_send_result(uuid, uuid, text, text),
  public.record_connect_send_held(uuid, uuid), public.connect_send_existing_link(uuid, text, text, text), public.record_connect_send_failure(uuid, uuid),
  public.record_connect_record_held(uuid, text, text, text, text) to service_role;
grant execute on function public.retry_connect_send(uuid) to authenticated;   -- Admin only, re-asserted in the body (the 0148 pattern)

-- ECA3-T12 (FR-ECA-016, PD-ECA-15): once an Admin has accepted the item kind, a new item name on an open purchase is queued as a send with
-- no person: the sweep calls this once a tick before it claims. One proposal per name (identity, plus the check for any proposal that names
-- it), so a name already decided, linked (item_map) or waiting is never queued; the claim, the link lookup and the outbox key keep the send once.
create or replace function public.enqueue_new_item_sends(p_org_id uuid, p_tier text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_binding public.external_org_bindings%rowtype; v_n int;
begin
  select * into v_binding from public.external_org_bindings
   where org_id = p_org_id and external_tier = p_tier and status = 'active' and activated_at is not null;
  if not found then return 0; end if;
  if not exists (select 1 from public.erp_connect_census c
                  where c.org_id = p_org_id and c.external_tier = p_tier and c.kind = 'item' and c.accepted_at is not null) then return 0; end if;
  -- ponytail: 100 names a tick; a larger backlog drains over the next ticks
  insert into public.erp_connect_proposals (org_id, binding_id, external_tier, run_id, kind, outcome, identity, pmo_ids, external_ids, snapshot, state, decided_at)
    select p_org_id, v_binding.id, p_tier, null, 'item', 'send', 'send|' || to_jsonb(array[n.name])::text || '|[]', array[n.name], '{}',
           '{"auto":true}'::jsonb, 'sending', now()
      from (select distinct i.name from public.procurement_items i join public.procurements p on p.id = i.procurement_id
             where i.org_id = p_org_id and p.org_id = p_org_id and p.status not in ('Paid', 'Cancelled') and coalesce(i.name, '') <> ''
             order by i.name limit 100) n
     where not (coalesce(v_binding.config->'item_map', '{}'::jsonb) ? n.name)
       and not exists (select 1 from public.erp_connect_proposals q
                        where q.org_id = p_org_id and q.external_tier = p_tier and q.kind = 'item' and n.name = any(q.pmo_ids))
    on conflict (org_id, external_tier, kind, identity) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.enqueue_new_item_sends(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_new_item_sends(uuid, text) to service_role;

-- I6: a reconnect reuses the binding row, so a send accepted for the old site would go to the new one. The disconnect purge (0480) takes the
-- waiting sends with it, and with them the outbox rows that never reached an ERP. A row that did (committing, quarantined, committed) is never
-- deleted: it is held, so a send of that record under the new connection stops for a person instead of reading the old site's answer.
create or replace function public.purge_connect_sends_on_disconnect() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.erp_connect_proposals where org_id = new.org_id and external_tier = new.external_tier and state = 'sending';
  delete from public.external_command_outbox
   where org_id = new.org_id and external_tier = new.external_tier and idempotency_key like 'seed:%' and state in ('pending', 'failed');
  update public.external_command_outbox
     set state = 'held', last_error = 'the connection changed while this send was undecided', claim_generation = claim_generation + 1, updated_at = now()
   where org_id = new.org_id and external_tier = new.external_tier and idempotency_key like 'seed:%' and state in ('committing', 'quarantined', 'committed');
  return null;
end $$;
create trigger erp_connect_purge_sends_on_disconnect after update of status on public.external_org_bindings
  for each row when (new.status = 'disconnected' and old.status is distinct from 'disconnected')
  execute function public.purge_connect_sends_on_disconnect();
revoke all on function public.purge_connect_sends_on_disconnect() from public, anon, authenticated;
