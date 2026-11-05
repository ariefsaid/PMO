-- 0655: change-driven native statement refresh. Builds on the dormant change state (0653) and nightly
-- obligations (0654): the sweep checks the source every 15 minutes (hint only) and refreshes statements
-- only for a nightly obligation, an internal/user "Refresh now" intent, a confirmed ERP posting, or a first
-- publication. Publication writes only the diff: payloads of changed/new keys, deletes of absent keys, and a
-- header-only touch for unchanged rows so readers keep their one-snapshot_id-per-generation contract.
-- Rollback: rollback/0655_statement_change_driven_down.sql (restores the 0321 delete-all publisher).
begin;

-- ON by default at deploy (0653 default). The sweep falls back to today's hourly full refresh whenever
-- the checker errors.
create or replace function public.publish_erp_financial_statements(p_org_id uuid,p_holder uuid,p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.erp_sweep_lock%rowtype;
  v_binding public.external_org_bindings%rowtype;
  v_batch public.erp_financial_statement_report_batch%rowtype;
  v_context jsonb;
  v_snapshot_id uuid;
  v_started_at timestamptz;
  v_previous_completion timestamptz;
  v_acquisition_started_at timestamptz;
  v_acquisition_completed_at timestamptz;
  v_published_at timestamptz;
  v_validated_acquired_at timestamptz;
  v_source public.erp_financial_statement_snapshot%rowtype;
  v_expected_count integer;
  v_actual_count integer;
  v_missing_count integer;
  v_safe_calendar jsonb;
  v_pending public.erp_financial_statement_report_pending%rowtype;
  v_selection jsonb;
  v_deleted integer;
  v_touched integer;
  v_written integer;
begin
  if p_org_id is null or p_holder is null or p_batch_id is null then
    raise exception 'invalid native statement publication identity' using errcode='22023';
  end if;
  select * into v_lock from public.erp_sweep_lock where org_id=p_org_id for update;
  if not found or v_lock.holder is distinct from p_holder or v_lock.locked_until<=clock_timestamp() then
    raise exception 'statement lease is not current' using errcode='55000';
  end if;
  select * into v_binding from public.external_org_bindings
   where org_id=p_org_id and external_tier='erpnext' for update;
  if not found or v_binding.activated_at is null or v_binding.version_major is distinct from 16 then
    raise exception 'statement binding is unavailable' using errcode='55000';
  end if;
  -- A response may have been lost after commit. The batch UUID is the durable idempotency key.
  select snapshot_id into v_snapshot_id from public.erp_financial_statement_snapshot
   where org_id=p_org_id and source_generation=p_batch_id and capture_started_at is not null
   order by snapshot_id limit 1;
  if v_snapshot_id is not null then
    if clock_timestamp() >= (select locked_until from public.erp_sweep_lock where org_id=p_org_id and holder=p_holder) then
      raise exception 'statement lease expired during publication' using errcode='55000';
    end if;
    return v_snapshot_id;
  end if;

  select * into v_batch from public.erp_financial_statement_report_batch
   where org_id=p_org_id and batch_id=p_batch_id for update;
  if not found then raise exception 'statement batch is not current' using errcode='55000'; end if;
  v_context := v_batch.context;
  v_started_at := v_batch.started_at;
  perform public._erp_statement_report_context_validate(p_org_id,v_context);

  drop table if exists pg_temp.pmo_native_expected;
  create temporary table pmo_native_expected on commit drop as
    select * from public._erp_statement_report_plan(v_context);
  select count(*) into v_expected_count from pg_temp.pmo_native_expected;
  select count(*),count(*) filter(where normalized_report is null or raw_response_text is null or raw_sha256 is null or acquired_at is null)
    into v_actual_count,v_missing_count
    from public.erp_financial_statement_report_pending where org_id=p_org_id and batch_id=p_batch_id;
  if v_expected_count=0 or v_actual_count<>v_expected_count or v_missing_count<>0
     or exists (
       select 1 from pg_temp.pmo_native_expected e
       left join public.erp_financial_statement_report_pending p
         on p.org_id=p_org_id and p.batch_id=p_batch_id and p.ordinal=e.ordinal
        and p.statement=e.statement and p.project_id is not distinct from e.project_id
        and p.period_kind=e.period_kind and p.current_start=e.current_start and p.current_end=e.current_end
        and p.prior_start=e.prior_start and p.prior_end=e.prior_end and p.side=e.side
       where p.ordinal is null
     ) or exists (
       select 1 from public.erp_financial_statement_report_pending p
       left join pg_temp.pmo_native_expected e
         on e.ordinal=p.ordinal and e.statement=p.statement and e.project_id is not distinct from p.project_id
        and e.period_kind=p.period_kind and e.current_start=p.current_start and e.current_end=p.current_end
        and e.prior_start=p.prior_start and e.prior_end=p.prior_end and e.side=p.side
       where p.org_id=p_org_id and p.batch_id=p_batch_id and e.ordinal is null
     ) then
    raise exception 'native statement batch is incomplete' using errcode='55000';
  end if;

  if exists (
    select 1 from public.erp_financial_statement_report_pending c
    join public.erp_financial_statement_report_pending p
      on p.org_id=c.org_id and p.batch_id=c.batch_id and p.statement=c.statement
     and p.project_id is not distinct from c.project_id and p.period_kind=c.period_kind
     and p.current_start=c.current_start and p.current_end=c.current_end
     and p.prior_start=c.prior_start and p.prior_end=c.prior_end and p.side='prior'
    where c.org_id=p_org_id and c.batch_id=p_batch_id and c.side='current'
      and (c.retained_source_snapshot_id is distinct from p.retained_source_snapshot_id)
  ) then
    raise exception 'native comparison pair mixes fresh and retained sides' using errcode='55000';
  end if;

  for v_pending in select * from public.erp_financial_statement_report_pending
    where org_id=p_org_id and batch_id=p_batch_id order by ordinal loop
    v_selection := jsonb_build_object(
      'statement',v_pending.statement,'projectId',v_pending.project_id,'periodKind',v_pending.period_kind,
      'currentStart',v_pending.current_start::text,'currentEnd',v_pending.current_end::text,
      'priorStart',v_pending.prior_start::text,'priorEnd',v_pending.prior_end::text,'side',v_pending.side);
    if encode(extensions.digest(convert_to(v_pending.raw_response_text,'UTF8'),'sha256'),'hex') is distinct from v_pending.raw_sha256
       or v_pending.normalized_report->'provenance'->>'rawSha256' is distinct from v_pending.raw_sha256 then
      raise exception 'staged native report integrity check failed' using errcode='55000';
    end if;
    if v_pending.retained_source_snapshot_id is null then
      v_validated_acquired_at:=public._erp_statement_report_validate(
        v_context,v_selection,v_pending.normalized_report,v_pending.raw_response_text,v_started_at);
      if v_validated_acquired_at is distinct from v_pending.acquired_at
         or v_pending.acquired_at<v_started_at then
        raise exception 'fresh native report capture time changed' using errcode='55000';
      end if;
    else
      select s.* into v_source
        from public.erp_financial_statement_snapshot s
        join public.erp_financial_statement_published_context trusted
          on trusted.org_id=s.org_id and trusted.company=s.company and trusted.snapshot_id=s.snapshot_id
         and trusted.source_generation=s.source_generation and trusted.context=v_context
       where s.org_id=p_org_id and s.company=v_context->>'company'
         and s.snapshot_id=v_pending.retained_source_snapshot_id
         and s.statement=v_pending.statement
         and s.scope_kind=case when v_pending.project_id is null then 'company' else 'project' end
         and s.project_id is not distinct from v_pending.project_id
         and s.view_kind='account_breakdown' and s.period_kind=v_pending.period_kind
         and s.current_start=v_pending.current_start and s.current_end=v_pending.current_end
         and s.prior_start=v_pending.prior_start and s.prior_end=v_pending.prior_end
         and s.capture_started_at is not null and s.capture_completed_at is not null
         and s.payload->v_pending.side=v_pending.normalized_report
         and s.raw_reports->>v_pending.side=v_pending.raw_response_text;
      if not found then raise exception 'retained native source changed' using errcode='55000'; end if;
      v_validated_acquired_at:=public._erp_statement_report_validate(
        v_context,v_selection,v_pending.normalized_report,v_pending.raw_response_text,v_source.capture_started_at);
      if v_validated_acquired_at is distinct from v_pending.acquired_at
         or v_pending.acquired_at>v_source.capture_completed_at then
        raise exception 'retained native source capture bounds changed' using errcode='55000';
      end if;
    end if;
  end loop;

  select min(acquired_at),max(acquired_at)
    into v_acquisition_started_at,v_acquisition_completed_at
    from public.erp_financial_statement_report_pending
   where org_id=p_org_id and batch_id=p_batch_id;
  v_published_at:=clock_timestamp();
  select max(as_of) into v_previous_completion
    from public.erp_financial_statement_snapshot
   where org_id=p_org_id and company=v_context->>'company';
  if v_previous_completion is not null and v_published_at<=v_previous_completion then
    raise exception 'native statement publication is not newer' using errcode='55000';
  end if;
  if v_acquisition_started_at is null or v_acquisition_completed_at is null
     or v_acquisition_started_at>v_acquisition_completed_at
     or v_acquisition_completed_at>v_published_at then
    raise exception 'native statement acquisition envelope is invalid' using errcode='55000';
  end if;

  drop table if exists pg_temp.pmo_native_output;
  create temporary table pmo_native_output on commit drop as
  with paired as (
    select c.statement,c.project_id,c.period_kind,c.current_start,c.current_end,c.prior_start,c.prior_end,
      c.normalized_report current_report,p.normalized_report prior_report,
      c.raw_response_text current_raw,p.raw_response_text prior_raw
    from public.erp_financial_statement_report_pending c
    join public.erp_financial_statement_report_pending p
      on p.org_id=c.org_id and p.batch_id=c.batch_id and p.statement=c.statement
     and p.project_id is not distinct from c.project_id and p.period_kind=c.period_kind
     and p.current_start=c.current_start and p.current_end=c.current_end
     and p.prior_start=c.prior_start and p.prior_end=c.prior_end
     and p.side='prior'
    where c.org_id=p_org_id and c.batch_id=p_batch_id and c.side='current'
  ), detail_rows as (
    select statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,
      'account_breakdown'::text view_kind,
      jsonb_build_object('current',current_report,'prior',prior_report) payload,
      jsonb_build_object('current',current_raw,'prior',prior_raw) raw_reports,
      public._erp_statement_native_has_amount_rows(current_report)
        or public._erp_statement_native_has_amount_rows(prior_report) has_activity,
      current_report->>'reportName' source_report,
      current_report->'profile'->>'erpVersion' report_version,
      jsonb_build_object('current',current_report->'provenance'->'filters',
                         'prior',prior_report->'provenance'->'filters') filters
    from paired
  ), all_rows as (
    select d.*,case when d.view_kind='project_totals' then null else d.source_report end final_source_report,
      case when d.view_kind='project_totals' then null else d.report_version end final_report_version,
      case when d.view_kind='project_totals' then null else d.filters end final_filters,
      case when d.view_kind='project_totals' then null else jsonb_build_object(
        'profile',v_context->'profile','language',v_context->'language',
        'presentation',v_context->'presentation','filterProfile',v_context->'filterProfile') end final_settings
    from detail_rows d
    union all
    select statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,
      'project_totals',
      jsonb_build_object(
        'current',jsonb_build_object('income',current_report->'summary'->0->'value',
          'expense',current_report->'summary'->1->'value','net',current_report->'summary'->2->'value'),
        'prior',jsonb_build_object('income',prior_report->'summary'->0->'value',
          'expense',prior_report->'summary'->1->'value','net',prior_report->'summary'->2->'value')),
      null::jsonb,
      public._erp_statement_native_has_amount_rows(current_report)
        or public._erp_statement_native_has_amount_rows(prior_report),
      null::text,null::text,null::jsonb,
      null::text,null::text,null::jsonb,null::jsonb
    from paired where project_id is not null and statement='profit_and_loss'
  )
  select statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,view_kind,
    payload,raw_reports,has_activity,final_source_report source_report,final_report_version report_version,
    final_filters filters,final_settings settings
  from all_rows;

  select jsonb_agg(jsonb_build_object('start',entry->>'start','end',entry->>'end') order by entry->>'start')
    into v_safe_calendar from jsonb_array_elements(v_context->'calendar') entry;
  v_snapshot_id := gen_random_uuid();
  -- Diff publication. Only keys absent from the validated full catalogue are deleted; rows whose content
  -- is identical (payload, raw reports, every content column) keep their TOASTed payload and receive a
  -- header-only touch so the readers' one-snapshot_id-per-generation contract is unchanged; changed and new
  -- keys are upserted in full. Content equality is exact (acquiredAt is inside the payload), never a hash.
  insert into public.erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
  values (p_org_id,v_context->>'company',v_snapshot_id,p_batch_id,v_context)
  on conflict (org_id,company,snapshot_id) do nothing;
  delete from public.erp_financial_statement_snapshot s
   where s.org_id=p_org_id and s.company=v_context->>'company'
     and not exists (select 1 from pg_temp.pmo_native_output o
       where o.statement=s.statement and o.project_id is not distinct from s.project_id
         and o.view_kind=s.view_kind and o.period_kind=s.period_kind
         and o.current_start=s.current_start and o.current_end=s.current_end
         and o.prior_start=s.prior_start and o.prior_end=s.prior_end);
  get diagnostics v_deleted = row_count;
  update public.erp_financial_statement_snapshot s
     set snapshot_id=v_snapshot_id,source_generation=p_batch_id,as_of=v_published_at,
         capture_started_at=v_acquisition_started_at,capture_completed_at=v_acquisition_completed_at,
         published_at=v_published_at
    from pg_temp.pmo_native_output o
   where s.org_id=p_org_id and s.company=v_context->>'company'
     and o.statement=s.statement and o.project_id is not distinct from s.project_id
     and o.view_kind=s.view_kind and o.period_kind=s.period_kind
     and o.current_start=s.current_start and o.current_end=s.current_end
     and o.prior_start=s.prior_start and o.prior_end=s.prior_end
     and o.payload is not distinct from s.payload and o.raw_reports is not distinct from s.raw_reports
     and o.has_activity is not distinct from s.has_activity
     and o.source_report is not distinct from s.source_report and o.report_version is not distinct from s.report_version
     and o.filters is not distinct from s.filters and o.settings is not distinct from s.settings;
  get diagnostics v_touched = row_count;
  insert into public.erp_financial_statement_snapshot(
    org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
    current_start,current_end,prior_start,prior_end,currency,as_of,capture_started_at,capture_completed_at,published_at,
    source_report,report_version,filters,settings,payload,raw_reports,has_activity,display_precision,display_rounding_method
  )
  select p_org_id,v_context->>'company',v_snapshot_id,p_batch_id,o.statement,
    case when o.project_id is null then 'company' else 'project' end,o.project_id,o.view_kind,o.period_kind,
    o.current_start,o.current_end,o.prior_start,o.prior_end,'IDR',v_published_at,
    v_acquisition_started_at,v_acquisition_completed_at,v_published_at,
    o.source_report,o.report_version,o.filters,o.settings,o.payload,o.raw_reports,o.has_activity,
    (v_context->'presentation'->'metadata'->>'currencyPrecision')::integer,
    v_context->'presentation'->'metadata'->>'roundingMethod'
  from pg_temp.pmo_native_output o
  on conflict on constraint erp_financial_statement_snapshot_scope_period_unique do update set
    snapshot_id=excluded.snapshot_id,source_generation=excluded.source_generation,as_of=excluded.as_of,
    capture_started_at=excluded.capture_started_at,capture_completed_at=excluded.capture_completed_at,
    published_at=excluded.published_at,currency=excluded.currency,source_report=excluded.source_report,
    report_version=excluded.report_version,filters=excluded.filters,settings=excluded.settings,
    payload=excluded.payload,raw_reports=excluded.raw_reports,has_activity=excluded.has_activity,
    display_precision=excluded.display_precision,display_rounding_method=excluded.display_rounding_method
  where public.erp_financial_statement_snapshot.snapshot_id is distinct from excluded.snapshot_id;
  get diagnostics v_written = row_count;
  delete from public.erp_financial_statement_published_context
   where org_id=p_org_id and company=v_context->>'company' and snapshot_id<>v_snapshot_id;
  raise log 'statement diff publish org=% deleted=% header_only=% payload_written=%',p_org_id,v_deleted,v_touched,v_written;

  update public.external_org_bindings
     set statement_update_delayed=false,statement_calendar=v_safe_calendar
   where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';
  perform public._erp_ack_statement_dirty_dates(p_org_id,v_context->>'company',v_batch.dirty_revision_cutoff);
  delete from public.erp_financial_statement_report_batch where org_id=p_org_id and batch_id=p_batch_id;
  if not exists(select 1 from public.erp_sweep_lock l
    where l.org_id=p_org_id and l.holder=p_holder and l.locked_until>clock_timestamp()) then
    raise exception 'statement lease expired during publication' using errcode='55000';
  end if;
  return v_snapshot_id;
end;
$$;

-- Decides, under the lease, whether this tick runs a statement refresh. 'legacy' = state disabled (today's
-- hourly cadence applies); 'wait' = failed run still inside its persisted backoff; 'skip' = nothing due;
-- 'run' = a first/context-drifted publication, an unfinished nightly date, or an unacknowledged intent.
-- A changed hint alone (dirty revision) never runs: it waits for the nightly obligation.
create function public.plan_erp_statement_pass(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz,p_scope_epoch uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype; v_reason text; v_night date;
begin
 if p_scope_epoch is null then raise exception 'invalid statement scope' using errcode='22023'; end if;
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found or state.binding_id is distinct from p_binding_id or state.activated_at is distinct from p_activated_at
    or state.binding_context is distinct from ctx or state.scope_epoch is distinct from p_scope_epoch then
  raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 if not state.enabled then return jsonb_build_object('mode','legacy'); end if;
 if clock_timestamp()<state.retry_at then return jsonb_build_object('mode','wait','retry_at',state.retry_at); end if;
 select max(local_date) into v_night from public.erp_statement_nightly_obligation
  where org_id=p_org_id and completed_at is null and due_at<=clock_timestamp();
 if not exists(select 1 from public.erp_financial_statement_published_context pc
   where pc.org_id=p_org_id and pc.company=state.company
     and pc.context->'binding'->>'id'=p_binding_id::text and (pc.context->'binding'->>'activatedAt')::timestamptz=p_activated_at) then
  v_reason:='first_publication';
 elsif v_night is not null then v_reason:='nightly';
 elsif state.intent_revision>state.intent_acked then v_reason:='intent';
 end if;
 if v_reason is null then return jsonb_build_object('mode','skip'); end if;
 return jsonb_build_object('mode','run','reason',v_reason,'dirty_cut',state.dirty_revision::text,
  'intent_cut',state.intent_revision::text,'nightly_cut',v_night);
end $$;

-- Settles a PUBLISHED run: acknowledges only the revisions captured at admission (later work survives),
-- completes the nightly dates up to the captured date, and clears the failure backoff.
create function public.complete_erp_statement_pass(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz,
  p_scope_epoch uuid,p_dirty_cut bigint,p_intent_cut bigint,p_nightly_cut date,p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype; v_done integer:=0;
begin
 if p_scope_epoch is null or p_dirty_cut is null or p_intent_cut is null or p_snapshot_id is null then
  raise exception 'invalid statement scope' using errcode='22023';
 end if;
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found or state.binding_id is distinct from p_binding_id or state.activated_at is distinct from p_activated_at
    or state.binding_context is distinct from ctx or state.scope_epoch is distinct from p_scope_epoch then
  raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 if not exists(select 1 from public.erp_financial_statement_snapshot s
   where s.org_id=p_org_id and s.company=state.company and s.snapshot_id=p_snapshot_id) then
  raise exception 'statement generation is not published' using errcode='55000';
 end if;
 if p_nightly_cut is not null then
  update public.erp_statement_nightly_obligation set published_generation=p_snapshot_id,completed_at=clock_timestamp()
   where org_id=p_org_id and local_date<=p_nightly_cut and completed_at is null;
  get diagnostics v_done=row_count;
 end if;
 -- A nightly publication also clears the hint dirtiness captured at admission; an intent-only run does not.
 update public.erp_statement_change_state set
   dirty_acked=case when p_nightly_cut is not null then greatest(dirty_acked,least(p_dirty_cut,dirty_revision)) else dirty_acked end,
   intent_acked=greatest(intent_acked,least(p_intent_cut,intent_revision)),
   retry_failures=0,retry_at=clock_timestamp()
  where org_id=p_org_id;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 return jsonb_build_object('status','completed','nightly_completed',v_done);
end $$;

-- A failed run backs off 5/15/30/60 minutes, then hourly; nothing silently expires.
create function public.fail_erp_statement_pass(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz,p_scope_epoch uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype; v_fail integer;
begin
 if p_scope_epoch is null then raise exception 'invalid statement scope' using errcode='22023'; end if;
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found or state.binding_id is distinct from p_binding_id or state.activated_at is distinct from p_activated_at
    or state.binding_context is distinct from ctx or state.scope_epoch is distinct from p_scope_epoch then
  raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 v_fail:=least(state.retry_failures+1,5);
 update public.erp_statement_change_state set retry_failures=v_fail,
   retry_at=clock_timestamp()+(case v_fail when 1 then interval '5 minutes' when 2 then interval '15 minutes'
     when 3 then interval '30 minutes' else interval '60 minutes' end)
  where org_id=p_org_id returning * into state;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 return jsonb_build_object('status','backoff','retry_failures',state.retry_failures,'retry_at',state.retry_at);
end $$;

-- "Refresh now" for the signed-in user. No scope input: org, role and company come from the session.
-- One accepted request per organization per five minutes, shared with the internal manual intent.
create function public.request_financial_statement_refresh()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.auth_org_id(); state public.erp_statement_change_state%rowtype; v_now timestamptz;
begin
 if v_org is null or not public.is_active_member() or public.auth_role()::text not in ('Admin','Finance','Executive') then
  raise exception 'not allowed' using errcode='42501';
 end if;
 select * into state from public.erp_statement_change_state where org_id=v_org for update;
 if not found or not state.enabled then return jsonb_build_object('status','unavailable'); end if;
 v_now:=clock_timestamp();
 if state.last_manual_at is null or v_now>=state.last_manual_at+interval '5 minutes' then
  update public.erp_statement_change_state set intent_revision=intent_revision+1,last_manual_at=v_now
   where org_id=v_org returning * into state;
  return jsonb_build_object('status','accepted','available_at',v_now+interval '5 minutes');
 end if;
 return jsonb_build_object('status','coalesced','available_at',state.last_manual_at+interval '5 minutes');
end $$;

-- A confirmed ERP posting requests a refresh on the reserved path (no user quota). It never blocks or
-- fails the confirmation: any error here is swallowed with a warning and the nightly run still catches up.
create function public.request_erp_statement_refresh_after_post()
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
create trigger external_command_outbox_statement_refresh
  after update of state on public.external_command_outbox
  for each row when (new.state='confirmed' and old.state is distinct from 'confirmed' and new.external_tier='erpnext')
  execute function public.request_erp_statement_refresh_after_post();

alter function public.plan_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid) owner to postgres;
alter function public.complete_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid,bigint,bigint,date,uuid) owner to postgres;
alter function public.fail_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid) owner to postgres;
alter function public.request_financial_statement_refresh() owner to postgres;
alter function public.request_erp_statement_refresh_after_post() owner to postgres;
revoke all on function public.plan_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.complete_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid,bigint,bigint,date,uuid) from public,anon,authenticated,service_role;
revoke all on function public.fail_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.request_financial_statement_refresh() from public,anon,authenticated,service_role;
revoke all on function public.request_erp_statement_refresh_after_post() from public,anon,authenticated,service_role;
grant execute on function public.plan_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.complete_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid,bigint,bigint,date,uuid) to service_role;
grant execute on function public.fail_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.request_financial_statement_refresh() to authenticated;
commit;
