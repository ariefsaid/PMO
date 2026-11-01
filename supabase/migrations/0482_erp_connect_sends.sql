-- ECA-3 (#1606): the send drain. Proposals an Admin accepted as "send" wait in state `sending` (0480); the sweep claims them, sends
-- each master through the money outbox and records the result here. Reversal: rollback/0482_erp_connect_sends_down.sql.
-- Service role only: the drain reads the org from the connection it works for and every function re-scopes by it.

alter table public.erp_connect_proposals add column send_claimed_at timestamptz;   -- the drain's lease; decided_at is the accept time

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
    -- the company reference is already there when the outbox finalized it (same ERP id: reconciled); a project or item link lands only here
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
     set outcome = 'review', reason = 'held', reason_text = 'We could not confirm whether the ERP created this record', state = 'open', run_id = null,
         identity = 'review|' || to_jsonb(p.pmo_ids)::text || '|' || to_jsonb(p.external_ids)::text || '|send:' || p.id::text
   where id = p.id;
  perform public.settle_connect_run(p.org_id, p.external_tier);
end $$;

revoke all on function public.claim_connect_sends(uuid, text, int), public.record_connect_send_result(uuid, uuid, text, text),
  public.record_connect_send_held(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_connect_sends(uuid, text, int), public.record_connect_send_result(uuid, uuid, text, text),
  public.record_connect_send_held(uuid, uuid) to service_role;
