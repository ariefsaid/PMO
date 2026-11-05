-- 0644: dormant per-organization native statement nightly obligations and the service-only manual
-- intent bookkeeping, stacked on the reviewed 0643 change-state lease/binding/context prefix.
--
-- Nothing here schedules, admits, publishes or enables anything: state stays disabled (0643 default),
-- there is no caller, no user endpoint, no actor identity, no acknowledgement and no completion
-- writer. `published_generation`/`completed_at` are reserved for a later atomic publisher and are
-- never written by this migration's functions.
begin;
create table public.erp_statement_nightly_obligation (
 org_id uuid not null references public.erp_statement_change_state(org_id) on delete cascade,
 local_date date not null,
 timezone text not null check (btrim(timezone) <> ''),
 due_at timestamptz not null,
 published_generation uuid,
 completed_at timestamptz,
 primary key (org_id, local_date),
 check ((published_generation is null) = (completed_at is null))
);
-- Outstanding work is looked up per organization by due instant; the partial predicate keeps the
-- index off already completed dates.
create index erp_statement_nightly_unfinished
 on public.erp_statement_nightly_obligation(org_id,due_at) where completed_at is null;
alter table public.erp_statement_nightly_obligation enable row level security;
alter table public.erp_statement_nightly_obligation force row level security;
revoke all on public.erp_statement_nightly_obligation from public,anon,authenticated,service_role;
grant select on public.erp_statement_nightly_obligation to service_role;

-- Schedules one organization-local date at the first instant whose local wall clock is at or after
-- 02:00 on that date. The grid is enumerated in UTC (so the session timezone cannot affect the
-- answer) at one-minute resolution: contemporary IANA transitions are minute-aligned, and this makes
-- no claim about historical second-level offsets. The first chronological match therefore selects the
-- first instant of a repeated (overlap) hour, and the first valid instant after a skipped (gap) hour.
-- A date that does not exist locally at all falls back to the first instant whose local wall clock is
-- at or after 02:00 on the skipped date, which keeps the skipped date as its own obligation key.
create function public._erp_statement_nightly_due_at(p_local_date date,p_timezone text)
returns timestamptz language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_start timestamptz; v_due timestamptz;
begin
 if p_local_date is null or p_timezone is null then
  raise exception 'invalid nightly schedule input' using errcode='22023';
 end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
  raise exception 'invalid nightly schedule input' using errcode='22023';
 end if;
 v_start:=(p_local_date::timestamp at time zone 'UTC') - interval '18 hours';
 select min(t) into v_due
  from generate_series(v_start,v_start+interval '60 hours',interval '1 minute') t
  where (t at time zone p_timezone)::date=p_local_date
    and (t at time zone p_timezone)::time>=time '02:00';
 if v_due is null then
  select min(t) into v_due
   from generate_series(v_start,v_start+interval '60 hours',interval '1 minute') t
   where (t at time zone p_timezone)>=p_local_date::timestamp+interval '2 hours';
 end if;
 if v_due is null then
  raise exception 'invalid nightly schedule input' using errcode='22023';
 end if;
 return v_due;
end $$;

-- Materializes at most 31 missed organization-local dates and advances the durable cursor by exactly
-- the dates whose row was verified. A row that already exists keeps its frozen instant and timezone
-- even if the organization timezone changed since; only newly materialized dates use the current one.
-- Every return path rechecks the live lease immediately before returning, so a lease that expires
-- while this transaction runs rolls the whole transaction back.
create function public.record_erp_statement_nightly_due(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype;
 obligation public.erp_statement_nightly_obligation%rowtype;
 v_now timestamptz; v_cursor date; v_due timestamptz; v_next timestamptz;
 v_inserted integer:=0; v_more boolean:=false; v_exists boolean; i integer;
begin
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found or state.binding_id is distinct from p_binding_id
    or state.activated_at is distinct from p_activated_at
    or state.binding_context is distinct from ctx then
  raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 if not state.enabled then
  perform public._erp_statement_change_lease_check(p_org_id,p_holder);
  return jsonb_build_object('status','disabled');
 end if;
 v_now:=clock_timestamp();
 v_cursor:=state.next_nightly_date;
 for i in 1..31 loop
  select * into obligation from public.erp_statement_nightly_obligation
   where org_id=p_org_id and local_date=v_cursor;
  v_exists:=found;
  if v_exists then
   v_due:=obligation.due_at;
  else
   v_due:=public._erp_statement_nightly_due_at(v_cursor,ctx->>'timezone');
  end if;
  exit when v_due>v_now;
  if not v_exists then
   insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at)
    values(p_org_id,v_cursor,ctx->>'timezone',v_due)
    on conflict (org_id,local_date) do nothing;
   if found then v_inserted:=v_inserted+1; end if;
   select * into obligation from public.erp_statement_nightly_obligation
    where org_id=p_org_id and local_date=v_cursor;
   if not found or obligation.due_at is null or btrim(obligation.timezone)='' then
    raise exception 'statement nightly obligation unavailable' using errcode='55000';
   end if;
   -- A row that appeared with its own (later) frozen instant is evaluated on that instant: advancing
   -- past it would claim a date that is not due yet.
   exit when obligation.due_at>v_now;
  end if;
  v_cursor:=v_cursor+1;
 end loop;
 update public.erp_statement_change_state set next_nightly_date=v_cursor where org_id=p_org_id;
 select * into obligation from public.erp_statement_nightly_obligation
  where org_id=p_org_id and local_date=v_cursor;
 if found then
  v_next:=obligation.due_at;
 else
  v_next:=public._erp_statement_nightly_due_at(v_cursor,ctx->>'timezone');
 end if;
 v_more:=v_next<=v_now;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 return jsonb_build_object('status','recorded','inserted',v_inserted,
  'next_nightly_date',v_cursor::text,'more_due',v_more);
end $$;

-- Records one internal manual intent inside the organization-wide five-minute quota. Only the intent
-- revision and the quota instant change; retry/backoff, diagnostics, acknowledgements, scope and the
-- legacy cadence are untouched, so a scope rotation cannot erase the quota or the backoff.
create function public.request_erp_statement_manual_intent(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype; v_now timestamptz;
begin
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found or state.binding_id is distinct from p_binding_id
    or state.activated_at is distinct from p_activated_at
    or state.binding_context is distinct from ctx then
  raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 if not state.enabled then
  perform public._erp_statement_change_lease_check(p_org_id,p_holder);
  return jsonb_build_object('status','disabled');
 end if;
 v_now:=clock_timestamp();
 if state.last_manual_at is null or v_now>=state.last_manual_at+interval '5 minutes' then
  update public.erp_statement_change_state
   set intent_revision=intent_revision+1,last_manual_at=v_now
   where org_id=p_org_id returning * into state;
  perform public._erp_statement_change_lease_check(p_org_id,p_holder);
  return jsonb_build_object('status','accepted','intent_revision',state.intent_revision::text,
   'manual_available_at',to_char((v_now+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end if;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 return jsonb_build_object('status','coalesced','intent_revision',state.intent_revision::text,
  'manual_available_at',to_char((state.last_manual_at+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;

alter function public._erp_statement_nightly_due_at(date,text) owner to postgres;
alter function public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz) owner to postgres;
alter function public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz) owner to postgres;
revoke all on function public._erp_statement_nightly_due_at(date,text) from public,anon,authenticated,service_role;
revoke all on function public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz) to service_role;
commit;
