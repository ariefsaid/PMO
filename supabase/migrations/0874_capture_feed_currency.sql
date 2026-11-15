-- The ledger witness carries the ERPNext company currency read by the ledger feed run, and feed freshness
-- matches the hourly cadence: a completed run stays current for two hours (one missed or failed hourly run
-- is tolerated; a second one is refused). Currency comes only from the ledger witness and must equal the
-- organization currency, else it is refused with a named reason. Health also names the feed state.
-- The five-argument completion stays for the deploy window and records an unknown currency.
-- Rollback: rollback/0874_capture_feed_currency_down.sql
alter table public.erp_capture_feed_witnesses add column ledger_currency text check (ledger_currency ~ '^[A-Z]{3}$');

create or replace function public.record_capture_feed_completion(p_org_id uuid,p_binding_id uuid,p_kind text,p_started_at timestamptz,p_run_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  update public.erp_capture_feed_witnesses set completed=true,ledger_currency=null
    where org_id=p_org_id and binding_id=p_binding_id and feed_kind=p_kind and started_at=p_started_at and run_id=p_run_id
      and exists (select 1 from public.external_org_bindings b where b.id=p_binding_id and b.org_id=p_org_id
        and b.status='active' and b.activated_at is not null and p_started_at >= b.activated_at);
end $$;

create function public.record_capture_feed_completion(p_org_id uuid,p_binding_id uuid,p_kind text,p_started_at timestamptz,p_run_id uuid,p_currency text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  -- A blank or malformed currency is recorded as unknown, never as a value.
  update public.erp_capture_feed_witnesses set completed=true,ledger_currency=case when p_currency ~ '^[A-Z]{3}$' then p_currency end
    where org_id=p_org_id and binding_id=p_binding_id and feed_kind=p_kind and started_at=p_started_at and run_id=p_run_id
      and exists (select 1 from public.external_org_bindings b where b.id=p_binding_id and b.org_id=p_org_id
        and b.status='active' and b.activated_at is not null and p_started_at >= b.activated_at);
end $$;
revoke all on function public.record_capture_feed_completion(uuid,uuid,text,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.record_capture_feed_completion(uuid,uuid,text,timestamptz,uuid,text) to service_role;

create or replace function public.purchase_capture_feed_health()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_binding uuid; v_count integer; v_since timestamptz; v_window timestamptz;
  v_purchase public.erp_capture_feed_witnesses%rowtype; v_ledger public.erp_capture_feed_witnesses%rowtype;
  v_caught boolean; v_currency text; v_mismatch boolean; v_state text;
begin
  if auth.uid() is null or v_org is null or not public.is_active_member() or public.auth_role()::text is distinct from 'Admin' then
    raise exception 'Only an active Admin can read capture health.' using errcode='42501';
  end if;
  select count(*),(array_agg(id))[1],(array_agg(activated_at))[1] into v_count,v_binding,v_since
    from public.external_org_bindings where org_id=v_org and status='active' and activated_at is not null;
  if v_count <> 1 then return jsonb_build_object('caught_up',false,'reason','binding_unavailable'); end if;
  select * into v_purchase from public.erp_capture_feed_witnesses where org_id=v_org and binding_id=v_binding and feed_kind='purchases';
  select * into v_ledger from public.erp_capture_feed_witnesses where org_id=v_org and binding_id=v_binding and feed_kind='ledger';
  -- Two hours: the hourly full run plus one missed or failed run. Pinned to the sweep cadence by sweepCadence.test.ts.
  v_window := greatest(v_since,now()-interval '2 hours');
  v_caught := coalesce(v_purchase.completed and v_ledger.completed and v_purchase.started_at >= v_window and v_ledger.started_at >= v_window,false);
  v_state := case when v_purchase.binding_id is null or v_ledger.binding_id is null then 'never'
    -- An unfinished run counts as running only inside the freshness window; a crashed run then reads stale.
    when (not v_purchase.completed and v_purchase.started_at >= v_window) or (not v_ledger.completed and v_ledger.started_at >= v_window) then 'running'
    when v_caught then 'current' else 'stale' end;
  if v_ledger.completed then
    v_currency := case when v_ledger.ledger_currency = (select o.default_currency from public.organizations o where o.id=v_org) then v_ledger.ledger_currency end;
    v_mismatch := v_ledger.ledger_currency is not null and v_currency is null;
  end if;
  return jsonb_build_object('caught_up',v_caught,'feed_state',v_state,
    'purchases_started_at',case when v_purchase.completed then v_purchase.started_at end,
    'ledger_started_at',case when v_ledger.completed then v_ledger.started_at end,
    'ledger_currency',v_currency,
    -- Named on its own so a mismatch on a stale feed is still reported as a mismatch, not as an unknown currency.
    'ledger_currency_mismatch',coalesce(v_mismatch,false),
    'reason',case when not v_caught then 'feed_not_current' when coalesce(v_mismatch,false) then 'ledger_currency_mismatch' end);
end $$;
