begin;
drop trigger if exists external_command_outbox_statement_refresh on public.external_command_outbox;
drop function if exists public.request_erp_statement_refresh_after_post();
drop function if exists public.request_financial_statement_refresh();
drop function if exists public.fail_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid);
drop function if exists public.complete_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid,bigint,bigint,date,uuid);
drop function if exists public.plan_erp_statement_pass(uuid,uuid,uuid,timestamptz,uuid);
-- Restores the 0321 delete-all publisher body verbatim.
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
  delete from public.erp_financial_statement_snapshot
   where org_id=p_org_id and company=v_context->>'company';
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
  from pg_temp.pmo_native_output o;

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
commit;
