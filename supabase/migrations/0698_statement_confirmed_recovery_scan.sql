-- 0698: recovery scan for confirmed posts the change trigger missed (#1932). The 0685 post-confirm trigger
-- fires only on UPDATE OF state, so a row inserted already-confirmed (or whose confirmation bookkeeping
-- failed and rolled back) raises no statement intent and waits for the nightly full publish. Confirmations
-- that PRE-date this migration are stamped by the backfill below — deliberately NOT left for the scan: NULL
-- on a confirmed row means "missed after rollout", so the first scan raises no spurious replay of history.
-- The scan reuses 0685's lease, intent_revision and backoff machinery unchanged: it stamps exactly the
-- missed rows and raises ONE coalesced reserved-path intent, so the next sweep tick refreshes instead of
-- waiting for the organization-local 02:00. The feature stays OFF by default (0681 per-org enable flag);
-- the sweep calls the scan only for enabled organizations, next to the nightly materialization.
-- Rollback: rollback/0698_statement_confirmed_recovery_scan_down.sql.
begin;

-- NULL on a confirmed ERPNext row = this confirmation never reached the post-confirm trigger. The trigger
-- stamps every confirmation it sees; the scan stamps (and raises the intent for) exactly the rest. The
-- stamp lives and dies with the row, so recovery bookkeeping adds no retention surface.
alter table public.external_command_outbox add column statement_intent_at timestamptz;
comment on column public.external_command_outbox.statement_intent_at is
 'Set by the post-confirm statement trigger (0685) when it recorded the change-driven refresh intent; NULL on a confirmed row means the recovery scan (0698) has not accounted for this confirmation yet.';

-- Backfill the already-confirmed history at migration time (every tier — the post-confirm trigger stamps
-- each confirmation it sees regardless of tier, and the column contract above is tier-agnostic): from
-- rollout on, NULL must mean "confirmed after rollout and never seen by the trigger", never "confirmed
-- before 0698 existed", so the first scan raises no extra refresh for the historical confirmations. The
-- row's own updated_at keeps the stamp truthful about when that confirmation happened.
update public.external_command_outbox set statement_intent_at=updated_at where state='confirmed';

-- The scan's per-tick predicate gets its own partial index, created AFTER the backfill so it builds
-- empty: confirmed rows never leave the outbox, so without this every sweep tick of an enabled
-- organization would scan that organization's whole outbox history to find (usually) nothing.
create index external_command_outbox_statement_recovery_idx
 on public.external_command_outbox (org_id)
 where external_tier='erpnext' and state='confirmed' and statement_intent_at is null;

-- Same trigger contract as 0685, plus stamping the row as accounted. Stamp and intent bump are one
-- subtransaction: if either fails, both roll back, the warning is swallowed and the confirmation is never
-- blocked or failed — the scan recovers the unstamped row on a later tick. Setting no state column, the
-- stamp UPDATE does not re-fire this UPDATE OF state trigger.
create or replace function public.request_erp_statement_refresh_after_post()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 begin
  update public.erp_statement_change_state set intent_revision=intent_revision+1
   where org_id=new.org_id and enabled;
  update public.external_command_outbox set statement_intent_at=clock_timestamp() where id=new.id;
 exception when others then
  raise warning 'statement refresh intent after confirmed post failed: %',sqlstate;
 end;
 return new;
end $$;

-- Sweep-side recovery scan, fenced by the same lease/binding/scope prefix as every 0685 writer (same
-- signature as record_erp_statement_nightly_due). One intent per scan whatever the number of misses;
-- the UPDATE re-checks the predicate, so a confirmation committing alongside cannot be double-stamped.
create function public.scan_erp_statement_confirmed_misses(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype; v_missed integer:=0;
begin
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found or state.binding_id is distinct from p_binding_id or state.activated_at is distinct from p_activated_at
    or state.binding_context is distinct from ctx then
  raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 if not state.enabled then
  perform public._erp_statement_change_lease_check(p_org_id,p_holder);
  return jsonb_build_object('status','disabled');
 end if;
 update public.external_command_outbox o
    set statement_intent_at=clock_timestamp()
  where o.org_id=p_org_id and o.external_tier='erpnext' and o.state='confirmed' and o.statement_intent_at is null;
 get diagnostics v_missed=row_count;
 if v_missed>0 then
  update public.erp_statement_change_state set intent_revision=intent_revision+1 where org_id=p_org_id returning * into state;
 end if;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 return jsonb_build_object('status','scanned','missed',v_missed,'intent_revision',state.intent_revision::text);
end $$;

alter function public.request_erp_statement_refresh_after_post() owner to postgres;
alter function public.scan_erp_statement_confirmed_misses(uuid,uuid,uuid,timestamptz) owner to postgres;
revoke all on function public.request_erp_statement_refresh_after_post() from public,anon,authenticated,service_role;
revoke all on function public.scan_erp_statement_confirmed_misses(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.scan_erp_statement_confirmed_misses(uuid,uuid,uuid,timestamptz) to service_role;
commit;
