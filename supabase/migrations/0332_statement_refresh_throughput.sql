-- 0332 — record native report attempts and rotate failed reads behind never-attempted work (no plan change:
-- publish_erp_financial_statements requires the exact plan, so every planned period is still fetched).
alter table public.erp_financial_statement_report_pending
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_attempt_at timestamptz;

create or replace function public.open_erp_statement_report_batch(p_org_id uuid,p_holder uuid,p_context jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.erp_sweep_lock%rowtype;
  v_binding public.external_org_bindings%rowtype;
  v_batch public.erp_financial_statement_report_batch%rowtype;
  v_source public.erp_financial_statement_snapshot%rowtype;
  v_pair record;
  v_batch_id uuid;
  v_started_at timestamptz;
  v_effective_date date;
  v_timezone text;
  v_cutoff bigint;
  v_next record;
  v_complete boolean;
  v_count integer;
  v_routine_count integer;
  v_selection jsonb;
  v_current_report jsonb;
  v_prior_report jsonb;
  v_current_raw text;
  v_prior_raw text;
  v_current_hash text;
  v_prior_hash text;
  v_current_acquired timestamptz;
  v_prior_acquired timestamptz;
begin
  if p_org_id is null or p_holder is null then
    raise exception 'invalid statement batch identity' using errcode='22023';
  end if;
  select * into v_lock from public.erp_sweep_lock where org_id=p_org_id for update;
  if not found or v_lock.holder is distinct from p_holder or v_lock.locked_until<=clock_timestamp() then
    raise exception 'statement lease is not current' using errcode='55000';
  end if;
  select * into v_binding from public.external_org_bindings
   where org_id=p_org_id and external_tier='erpnext' for update;
  if not found then raise exception 'statement binding is unavailable' using errcode='55000'; end if;
  perform public._erp_statement_report_context_validate(p_org_id,p_context);

  select coalesce(nullif(btrim(o.default_timezone),''),'Asia/Jakarta') into v_timezone
    from public.organizations o where o.id=p_org_id;
  if not found or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then
    raise exception 'organization statement timezone is invalid' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || (p_context->>'company'),0));

  select * into v_batch from public.erp_financial_statement_report_batch
   where org_id=p_org_id for update;
  if found then
    if v_batch.context=p_context and v_batch.effective_date is not null
       and v_batch.planning_timezone=v_timezone then
      v_batch_id:=v_batch.batch_id;
      v_started_at:=v_batch.started_at;
      v_effective_date:=v_batch.effective_date;
      v_cutoff:=v_batch.dirty_revision_cutoff;
      if not exists(select 1 from public.erp_financial_statement_report_pending
        where org_id=p_org_id and batch_id=v_batch_id) then
        raise exception 'stored statement batch plan is missing' using errcode='55000';
      end if;
    else
      delete from public.erp_financial_statement_report_batch where org_id=p_org_id;
      v_batch.batch_id:=null;
    end if;
  end if;

  if v_batch.batch_id is null then
    v_batch_id:=gen_random_uuid();
    v_started_at:=clock_timestamp();
    v_effective_date:=(v_started_at at time zone v_timezone)::date;
    select coalesce(max(revision),0) into v_cutoff
      from public.erp_financial_statement_dirty_date
     where org_id=p_org_id and company=p_context->>'company';
    select count(distinct period_kind) into v_routine_count
      from public._erp_statement_report_plan(p_context)
     where current_start<=v_effective_date;
    if v_routine_count=0 then
      raise exception 'statement calendar has no begun comparison pair' using errcode='22023';
    end if;
    insert into public.erp_financial_statement_report_batch
      (org_id,batch_id,started_at,context,dirty_revision_cutoff,effective_date,planning_timezone)
    values (p_org_id,v_batch_id,v_started_at,p_context,v_cutoff,v_effective_date,v_timezone);
    update public.external_org_bindings set statement_update_delayed=true
     where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';
    insert into public.erp_financial_statement_report_pending(
      org_id,batch_id,statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,side,ordinal
    )
    select p_org_id,v_batch_id,plan.statement,plan.project_id,plan.period_kind,
      plan.current_start,plan.current_end,plan.prior_start,plan.prior_end,plan.side,plan.ordinal
    from public._erp_statement_report_plan(p_context) plan;
    get diagnostics v_count=row_count;
    if v_count=0 then raise exception 'statement calendar has no supported comparison ranges' using errcode='22023'; end if;
    drop table if exists pg_temp.pmo_native_refresh_plan;
    create temporary table pmo_native_refresh_plan on commit drop as
      select * from public._erp_statement_report_refresh_plan(
        p_org_id,p_context,v_effective_date,v_cutoff);

    -- Retain only complete, byte-identical native comparison pairs with an exact trusted context.
    for v_pair in
      select p.statement,p.project_id,p.period_kind,p.current_start,p.current_end,p.prior_start,p.prior_end
        from public.erp_financial_statement_report_pending p
       where p.org_id=p_org_id and p.batch_id=v_batch_id and p.side='current'
         and not exists(select 1 from pg_temp.pmo_native_refresh_plan fresh
           where fresh.statement=p.statement and fresh.project_id is not distinct from p.project_id
             and fresh.period_kind=p.period_kind and fresh.current_start=p.current_start
             and fresh.current_end=p.current_end and fresh.prior_start=p.prior_start
             and fresh.prior_end=p.prior_end)
       order by p.ordinal
    loop
      select s.* into v_source
        from public.erp_financial_statement_snapshot s
        join public.erp_financial_statement_published_context trusted
          on trusted.org_id=s.org_id and trusted.company=s.company and trusted.snapshot_id=s.snapshot_id
         and trusted.source_generation=s.source_generation and trusted.context=p_context
       where s.org_id=p_org_id and s.company=p_context->>'company'
         and s.statement=v_pair.statement
         and s.scope_kind=case when v_pair.project_id is null then 'company' else 'project' end
         and s.project_id is not distinct from v_pair.project_id
         and s.view_kind='account_breakdown' and s.period_kind=v_pair.period_kind
         and s.current_start=v_pair.current_start and s.current_end=v_pair.current_end
         and s.prior_start=v_pair.prior_start and s.prior_end=v_pair.prior_end
         and s.capture_started_at is not null and s.capture_completed_at is not null
         and jsonb_typeof(s.payload)='object' and jsonb_typeof(s.raw_reports)='object'
         and jsonb_typeof(s.payload->'current')='object' and jsonb_typeof(s.payload->'prior')='object'
         and jsonb_typeof(s.raw_reports->'current')='string' and jsonb_typeof(s.raw_reports->'prior')='string'
       order by s.capture_completed_at desc,s.snapshot_id desc limit 1;
      if not found then continue; end if;
      v_current_report:=v_source.payload->'current';
      v_prior_report:=v_source.payload->'prior';
      v_current_raw:=v_source.raw_reports->>'current';
      v_prior_raw:=v_source.raw_reports->>'prior';
      v_current_hash:=v_current_report->'provenance'->>'rawSha256';
      v_prior_hash:=v_prior_report->'provenance'->>'rawSha256';
      if v_current_hash is null or v_prior_hash is null
         or encode(extensions.digest(convert_to(v_current_raw,'UTF8'),'sha256'),'hex') is distinct from v_current_hash
         or encode(extensions.digest(convert_to(v_prior_raw,'UTF8'),'sha256'),'hex') is distinct from v_prior_hash then
        continue;
      end if;
      begin
        v_selection:=jsonb_build_object('statement',v_pair.statement,'projectId',v_pair.project_id,
          'periodKind',v_pair.period_kind,'currentStart',v_pair.current_start::text,
          'currentEnd',v_pair.current_end::text,'priorStart',v_pair.prior_start::text,
          'priorEnd',v_pair.prior_end::text,'side','current');
        v_current_acquired:=public._erp_statement_report_validate(
          p_context,v_selection,v_current_report,v_current_raw,v_source.capture_started_at);
        v_selection:=jsonb_set(v_selection,'{side}','"prior"'::jsonb);
        v_prior_acquired:=public._erp_statement_report_validate(
          p_context,v_selection,v_prior_report,v_prior_raw,v_source.capture_started_at);
        if v_current_acquired>v_source.capture_completed_at or v_prior_acquired>v_source.capture_completed_at
           or v_current_acquired<(v_source.capture_started_at)
           or v_prior_acquired<(v_source.capture_started_at) then
          raise exception 'retained source bounds are invalid' using errcode='22023';
        end if;
      exception when others then
        continue;
      end;
      update public.erp_financial_statement_report_pending
         set normalized_report=v_current_report,raw_response_text=v_current_raw,
             raw_sha256=v_current_hash,acquired_at=v_current_acquired,
             retained_source_snapshot_id=v_source.snapshot_id
       where org_id=p_org_id and batch_id=v_batch_id and statement=v_pair.statement
         and project_id is not distinct from v_pair.project_id and period_kind=v_pair.period_kind
         and current_start=v_pair.current_start and current_end=v_pair.current_end
         and prior_start=v_pair.prior_start and prior_end=v_pair.prior_end and side='current';
      update public.erp_financial_statement_report_pending
         set normalized_report=v_prior_report,raw_response_text=v_prior_raw,
             raw_sha256=v_prior_hash,acquired_at=v_prior_acquired,
             retained_source_snapshot_id=v_source.snapshot_id
       where org_id=p_org_id and batch_id=v_batch_id and statement=v_pair.statement
         and project_id is not distinct from v_pair.project_id and period_kind=v_pair.period_kind
         and current_start=v_pair.current_start and current_end=v_pair.current_end
         and prior_start=v_pair.prior_start and prior_end=v_pair.prior_end and side='prior';
    end loop;
  end if;

  update public.external_org_bindings set statement_update_delayed=true
   where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';
  select * into v_next from public.erp_financial_statement_report_pending
   where org_id=p_org_id and batch_id=v_batch_id and normalized_report is null
     and (attempts=0 or last_attempt_at + make_interval(secs=>least(3600,300*power(2,least(attempts-1,3)))::int)<=clock_timestamp())
   order by attempts asc,ordinal limit 1;
  v_complete:=not exists(select 1 from public.erp_financial_statement_report_pending
    where org_id=p_org_id and batch_id=v_batch_id and normalized_report is null);
  if clock_timestamp()>=(select locked_until from public.erp_sweep_lock
      where org_id=p_org_id and holder=p_holder) then
    raise exception 'statement lease expired during batch open' using errcode='55000';
  end if;
  return jsonb_build_object(
    'batchId',v_batch_id,'startedAt',v_started_at,
    'nextRequest',case when v_complete or v_next.ordinal is null then null else jsonb_build_object(
      'statement',v_next.statement,'projectId',v_next.project_id,'periodKind',v_next.period_kind,
      'currentStart',v_next.current_start::text,'currentEnd',v_next.current_end::text,
      'priorStart',v_next.prior_start::text,'priorEnd',v_next.prior_end::text,'side',v_next.side
    ) end,'complete',v_complete
  );
end;
$$;

create function public.mark_erp_statement_report_attempt(
  p_org_id uuid,p_holder uuid,p_batch_id uuid,p_selection jsonb
) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lock public.erp_sweep_lock%rowtype;
begin
  select * into v_lock from public.erp_sweep_lock where org_id=p_org_id for update;
  if not found or v_lock.holder is distinct from p_holder or v_lock.locked_until<=clock_timestamp() then
    raise exception 'statement lease is not current' using errcode='55000';
  end if;
  update public.erp_financial_statement_report_pending p
     set attempts=attempts+1,last_attempt_at=clock_timestamp()
   where p.org_id=p_org_id and p.batch_id=p_batch_id and p.normalized_report is null
     and p.statement=p_selection->>'statement'
     and p.project_id is not distinct from nullif(p_selection->>'projectId','')::uuid
     and p.period_kind=p_selection->>'periodKind'
     and p.current_start=(p_selection->>'currentStart')::date
     and p.current_end=(p_selection->>'currentEnd')::date
     and p.prior_start=(p_selection->>'priorStart')::date
     and p.prior_end=(p_selection->>'priorEnd')::date
     and p.side=p_selection->>'side';
  if not found then raise exception 'native report attempt is not pending' using errcode='22023'; end if;
end; $$;
revoke all on function public.mark_erp_statement_report_attempt(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mark_erp_statement_report_attempt(uuid,uuid,uuid,jsonb) to service_role;
