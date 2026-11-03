-- 0508_odoo_vendor_payment_gate.sql — #1505 O2 P6 (AC-OPP-064 DB half, FR-OPP-063).
--
-- The route out of a HELD Odoo vendor payment. A payment's anchor is a free-text memo a person can edit in Odoo, so when the recovery
-- cannot tell whether a payment was already made it HOLDS the command rather than create a second payment (ADR-0058 §4). Holding
-- is only safe if a person can then decide. This RPC records that decision and returns the row to `failed`, so the ordinary bounded
-- recovery re-runs every gate and the probe (it never fabricates a success):
--   * 'absent': the operator checked Odoo and no payment exists; the probe then looks for the exact memo only.
--   * 'adopt':  the operator names the Odoo payment (account.payment:<id>); the probe verifies it is reconciled to the bill.
-- Not the person who dispatched the command (the same separation as paying a bill one entered), never another org, only a held row.
-- Payment kind on the Odoo tier only: other kinds have no consumer for a resolution yet, so they stay refused.
--
-- One more object: at most ONE in-flight Odoo payment command per bill (below). Without it, two intents for one bill (two payers, two tabs,
-- or a fresh intent after a response was lost) each pass the residual check and each pay: Odoo accepts an overpayment. The command's own
-- record id (`external_command_outbox_one_inflight_per_record`) cannot serialize them, because each intent has its own.
--
-- No other object changes. The payment rule and ceiling (`procurement_payment_allowed`, `procurement_payment_within_ceiling`) take a
-- purchase id and never a tier; the bill-author and needs-attention arms read the outbox with the service client in the edge function.
-- Reversible: rollback/0508_odoo_vendor_payment_gate_down.sql.

-- In flight = the states `external_command_outbox_one_inflight_per_record` uses. `failed` is not: a failed command made no payment (an
-- ambiguous one stays committing, quarantined or held) and its own retry stays possible, so a rejected payment never wedges its bill.
create unique index external_command_outbox_one_inflight_odoo_payment_per_bill
  on public.external_command_outbox (org_id, (payload->>'odoo_bill_ref'))
  where external_tier = 'odoo' and domain = 'procurement' and payload->>'erp_doc_kind' = 'payment'
    and payload->>'odoo_bill_ref' is not null
    and state in ('pending','committing','committed','quarantined','held');

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
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select o.org_id, o.state, o.domain, o.external_tier, o.actor_user_id, o.pmo_record_id, o.payload
    into v_org, v_state, v_domain, v_tier, v_creator, v_record, v_payload
    from public.external_command_outbox o where o.id = p_outbox_id for update;
  if v_org is null then
    raise exception 'outbox command not found' using errcode = 'P0002';
  end if;

  -- DEFINER bypasses RLS and is reachable by any signed-in caller: org, role and active membership are re-asserted here. A command
  -- whose dispatcher is unknown cannot be shown not to be the resolver, so it is refused too (fail closed).
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
  if v_tier is distinct from 'odoo' or v_domain is distinct from 'procurement' or v_payload->>'erp_doc_kind' is distinct from 'payment' then
    raise exception 'only a held Odoo vendor payment can be resolved here' using errcode = 'P0001';
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

  -- `failed`, as release_outbox_hold: recovery treats it as claimable and keeps the failure history. The generation bump fences out a
  -- claimant that is still running.
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

revoke all     on function public.resolve_held_outbox_command(uuid, text, text, text) from public;
grant  execute on function public.resolve_held_outbox_command(uuid, text, text, text) to   authenticated;
revoke execute on function public.resolve_held_outbox_command(uuid, text, text, text) from anon;
