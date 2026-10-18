-- 0321 — semantic invalidation, trusted publication context, and incremental native refresh.
-- Existing publications remain readable. In-progress legacy batches are invalidated lazily because
-- their admission rows have NULL planning fields and are rebuilt by the new fenced opener.

create sequence public.erp_financial_statement_dirty_revision_seq;
revoke all on sequence public.erp_financial_statement_dirty_revision_seq from public,anon,authenticated,service_role;

create table public.erp_financial_statement_dirty_date (
  org_id uuid not null references public.organizations(id) on delete cascade,
  company text not null check (btrim(company) <> ''),
  posting_date date not null,
  revision bigint not null check (revision > 0),
  primary key (org_id,company,posting_date)
);
alter table public.erp_financial_statement_dirty_date enable row level security;
alter table public.erp_financial_statement_dirty_date force row level security;
revoke all on public.erp_financial_statement_dirty_date from public,anon,authenticated,service_role;
grant select on public.erp_financial_statement_dirty_date to service_role;

create table public.erp_financial_statement_published_context (
  org_id uuid not null references public.organizations(id) on delete cascade,
  company text not null check (btrim(company) <> ''),
  snapshot_id uuid not null,
  source_generation uuid not null,
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  primary key (org_id,company,snapshot_id)
);
alter table public.erp_financial_statement_published_context enable row level security;
alter table public.erp_financial_statement_published_context force row level security;
revoke all on public.erp_financial_statement_published_context from public,anon,authenticated,service_role;
grant select on public.erp_financial_statement_published_context to service_role;

alter table public.erp_financial_statement_report_batch
  add column dirty_revision_cutoff bigint not null default 0,
  add column effective_date date,
  add column planning_timezone text;
alter table public.erp_financial_statement_report_batch
  alter column dirty_revision_cutoff drop default;

alter table public.erp_financial_statement_report_pending
  add column retained_source_snapshot_id uuid;

alter table public.erp_financial_statement_snapshot
  add column published_at timestamptz;
alter table public.erp_financial_statement_snapshot
  drop constraint erp_financial_statement_snapshot_capture_window_check;
alter table public.erp_financial_statement_snapshot
  add constraint erp_financial_statement_snapshot_capture_window_check
  check (
    (capture_started_at is null and capture_completed_at is null and published_at is null)
    or (capture_started_at is not null and capture_completed_at is not null
        and capture_started_at <= capture_completed_at
        and ((published_at is null and as_of=capture_completed_at)
          or (published_at is not null and capture_completed_at <= published_at and as_of = published_at)))
  );
alter table public.erp_financial_statement_snapshot
  drop constraint erp_financial_statement_snapshot_display_rounding_method_check;
alter table public.erp_financial_statement_snapshot
  add constraint erp_financial_statement_snapshot_display_rounding_method_check
  check (display_rounding_method in (
    'Banker''s Rounding','Banker''s Rounding (legacy)','Commercial Rounding','erpnext_report_output'
  ));

comment on table public.erp_financial_statement_dirty_date is
  'Internal semantic invalidation watermark by organization, native company and posting date. No statement amounts are stored.';
comment on table public.erp_financial_statement_published_context is
  'Private exact ERP-native context for the currently retained statement generation; never exposed through user reads.';
comment on column public.erp_financial_statement_snapshot.published_at is
  'Publication completion time. capture_started_at/capture_completed_at bound native side acquisitions, which may predate publication when rows are retained.';

create or replace function public.track_erp_statement_dirty_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_key bigint;
  v_new_key bigint;
  v_first_key bigint;
  v_second_key bigint;
  v_old_valid boolean := false;
  v_new_valid boolean := false;
  v_changed boolean := false;
begin
  if tg_op <> 'INSERT' then
    v_old_valid := old.org_id is not null and old.company is not null and btrim(old.company) <> ''
      and old.posting_date is not null;
  end if;
  if tg_op <> 'DELETE' then
    v_new_valid := new.org_id is not null and new.company is not null and btrim(new.company) <> ''
      and new.posting_date is not null;
  end if;

  if tg_op = 'INSERT' or tg_op = 'DELETE' then
    v_changed := true;
  else
    v_changed := row(old.org_id,old.erp_name,old.account,old.cost_center,old.fiscal_year,old.project,
        old.party_type,old.party,old.voucher_type,old.voucher_no,old.company,old.posting_date,
        old.debit,old.credit,old.is_cancelled,old.erp_docstatus,old.is_opening,old.finance_book)
      is distinct from
      row(new.org_id,new.erp_name,new.account,new.cost_center,new.fiscal_year,new.project,
        new.party_type,new.party,new.voucher_type,new.voucher_no,new.company,new.posting_date,
        new.debit,new.credit,new.is_cancelled,new.erp_docstatus,new.is_opening,new.finance_book);
  end if;
  if not v_changed then return new; end if;

  if v_old_valid and v_new_valid and old.org_id=new.org_id and old.company=new.company
     and old.posting_date=new.posting_date then
    v_old_key := hashtextextended(old.org_id::text || ':' || old.company,0);
    perform pg_advisory_xact_lock(v_old_key);
    insert into public.erp_financial_statement_dirty_date(org_id,company,posting_date,revision)
      values (old.org_id,old.company,old.posting_date,nextval('public.erp_financial_statement_dirty_revision_seq'))
    on conflict (org_id,company,posting_date) do update set revision=excluded.revision;
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if v_old_valid then v_old_key := hashtextextended(old.org_id::text || ':' || old.company,0); end if;
  if v_new_valid then v_new_key := hashtextextended(new.org_id::text || ':' || new.company,0); end if;
  if v_old_valid and v_new_valid then
    v_first_key := least(v_old_key,v_new_key);
    v_second_key := greatest(v_old_key,v_new_key);
    perform pg_advisory_xact_lock(v_first_key);
    if v_second_key <> v_first_key then perform pg_advisory_xact_lock(v_second_key); end if;
  elsif v_old_valid then
    perform pg_advisory_xact_lock(v_old_key);
  elsif v_new_valid then
    perform pg_advisory_xact_lock(v_new_key);
  end if;

  if v_old_valid then
    insert into public.erp_financial_statement_dirty_date(org_id,company,posting_date,revision)
      values (old.org_id,old.company,old.posting_date,nextval('public.erp_financial_statement_dirty_revision_seq'))
    on conflict (org_id,company,posting_date) do update set revision=excluded.revision;
  end if;
  if v_new_valid and (not v_old_valid or old.org_id is distinct from new.org_id
      or old.company is distinct from new.company or old.posting_date is distinct from new.posting_date) then
    insert into public.erp_financial_statement_dirty_date(org_id,company,posting_date,revision)
      values (new.org_id,new.company,new.posting_date,nextval('public.erp_financial_statement_dirty_revision_seq'))
    on conflict (org_id,company,posting_date) do update set revision=excluded.revision;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public._erp_statement_report_refresh_plan(
  p_org_id uuid,p_context jsonb,p_effective_date date,p_cutoff bigint
)
returns table (
  ordinal integer, statement text, project_id uuid, period_kind text,
  current_start date, current_end date, prior_start date, prior_end date, side text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with catalogue as (
    select * from public._erp_statement_report_plan(p_context)
  ), routine as (
    select distinct on (p.period_kind) p.period_kind,p.current_start,p.current_end,
      p.prior_start,p.prior_end
    from catalogue p
    where p.current_start<=p_effective_date
    order by p.period_kind,p.current_start desc,p.current_end desc
  )
  select p.ordinal,p.statement,p.project_id,p.period_kind,p.current_start,p.current_end,
    p.prior_start,p.prior_end,p.side
  from catalogue p
  where exists (
    select 1 from routine r where r.period_kind=p.period_kind
      and r.current_start=p.current_start and r.current_end=p.current_end
      and r.prior_start=p.prior_start and r.prior_end=p.prior_end
  ) or exists (
    select 1 from routine r join public.erp_financial_statement_dirty_date d
      on d.org_id=p_org_id and d.company=p_context->>'company' and d.revision<=p_cutoff
    where r.period_kind=p.period_kind
      and p.current_start<r.current_start
      and ((p.statement in ('trial_balance','balance_sheet') and d.posting_date<=p.current_end)
        or (p.statement='profit_and_loss' and d.posting_date between p.prior_start and p.current_end))
  )
$$;

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
   order by ordinal limit 1;
  v_complete:=not found;
  if clock_timestamp()>=(select locked_until from public.erp_sweep_lock
      where org_id=p_org_id and holder=p_holder) then
    raise exception 'statement lease expired during batch open' using errcode='55000';
  end if;
  return jsonb_build_object(
    'batchId',v_batch_id,'startedAt',v_started_at,
    'nextRequest',case when v_complete then null else jsonb_build_object(
      'statement',v_next.statement,'projectId',v_next.project_id,'periodKind',v_next.period_kind,
      'currentStart',v_next.current_start::text,'currentEnd',v_next.current_end::text,
      'priorStart',v_next.prior_start::text,'priorEnd',v_next.prior_end::text,'side',v_next.side
    ) end,'complete',v_complete
  );
end;
$$;
revoke all on function public.track_erp_statement_dirty_date() from public,anon,authenticated,service_role;
create trigger erp_gl_entry_mirror_statement_dirty_date
  after insert or update or delete on public.erp_gl_entry_mirror
  for each row execute function public.track_erp_statement_dirty_date();

create or replace function public.persist_erp_statement_published_context()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context jsonb;
  v_source_generation uuid;
begin
  select b.context into v_context from public.erp_financial_statement_report_batch b
   where b.org_id=new.org_id and b.batch_id=new.source_generation;
  if not found then return new; end if;
  insert into public.erp_financial_statement_published_context
    (org_id,company,snapshot_id,source_generation,context)
  values (new.org_id,new.company,new.snapshot_id,new.source_generation,v_context)
  on conflict (org_id,company,snapshot_id) do nothing;
  select source_generation,context into v_source_generation,v_context
    from public.erp_financial_statement_published_context
   where org_id=new.org_id and company=new.company and snapshot_id=new.snapshot_id;
  if v_source_generation is distinct from new.source_generation or v_context is distinct from (
      select b.context from public.erp_financial_statement_report_batch b
       where b.org_id=new.org_id and b.batch_id=new.source_generation) then
    raise exception 'published statement context changed during insertion' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function public.persist_erp_statement_published_context() from public,anon,authenticated,service_role;
create trigger erp_financial_statement_snapshot_persist_native_context
  after insert on public.erp_financial_statement_snapshot
  for each row execute function public.persist_erp_statement_published_context();

create or replace function public.remove_erp_statement_published_context()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.erp_financial_statement_snapshot s
      where s.org_id=old.org_id and s.company=old.company and s.snapshot_id=old.snapshot_id) then
    delete from public.erp_financial_statement_published_context
     where org_id=old.org_id and company=old.company and snapshot_id=old.snapshot_id;
  end if;
  return old;
end;
$$;
revoke all on function public.remove_erp_statement_published_context() from public,anon,authenticated,service_role;
create trigger erp_financial_statement_snapshot_remove_native_context
  after delete on public.erp_financial_statement_snapshot
  for each row execute function public.remove_erp_statement_published_context();


create or replace function public._erp_statement_report_context_validate(p_org_id uuid,p_context jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_binding public.external_org_bindings%rowtype;
  v_entry jsonb;
  v_name text;
  v_start date;
  v_end date;
  v_previous_end date;
  v_names text[] := array[]::text[];
  v_previous_start date;
  v_project record;
  v_project_map jsonb;
  v_activation timestamptz;
  v_metadata jsonb;
  v_presentation_context jsonb;
  v_raw jsonb;
  v_currency_raw jsonb;
  v_fraction_units numeric;
  v_remaining numeric;
  v_expected_precision integer;
  v_power_two integer;
  v_power_five integer;
  v_number_format text;
  v_branch text;
begin
  if jsonb_typeof(p_context) is distinct from 'object'
     or (p_context - array['binding','company','profile','calendar','projectMap','language','presentation','filterProfile']) <> '{}'::jsonb
     or not (p_context ?& array['binding','company','profile','calendar','projectMap','language','presentation','filterProfile']) then
    raise exception 'invalid statement context' using errcode='22023';
  end if;
  select * into v_binding from public.external_org_bindings
   where org_id=p_org_id and external_tier='erpnext';
  if not found or v_binding.activated_at is null or v_binding.version_major is distinct from 16
     or jsonb_typeof(v_binding.config) is distinct from 'object'
     or jsonb_typeof(v_binding.config->'company') is distinct from 'string'
     or btrim(v_binding.config->>'company') = ''
     or jsonb_typeof(p_context->'company') is distinct from 'string'
     or p_context->>'company' is distinct from v_binding.config->>'company' then
    raise exception 'statement binding changed' using errcode='55000';
  end if;
  if jsonb_typeof(p_context->'binding') is distinct from 'object'
     or ((p_context->'binding') - array['id','activatedAt','versionMajor']) <> '{}'::jsonb
     or not ((p_context->'binding') ?& array['id','activatedAt','versionMajor'])
     or jsonb_typeof(p_context->'binding'->'id') is distinct from 'string'
     or jsonb_typeof(p_context->'binding'->'activatedAt') is distinct from 'string'
     or jsonb_typeof(p_context->'binding'->'versionMajor') is distinct from 'number'
     or (p_context->'binding'->>'versionMajor') !~ '^16$' then
    raise exception 'invalid statement binding context' using errcode='22023';
  end if;
  begin
    v_activation := (p_context->'binding'->>'activatedAt')::timestamptz;
  exception when others then
    raise exception 'invalid statement binding context' using errcode='22023';
  end;
  if (p_context->'binding'->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (p_context->'binding'->>'id')::uuid is distinct from v_binding.id
     or v_activation is distinct from v_binding.activated_at then
    raise exception 'statement binding changed' using errcode='55000';
  end if;
  if jsonb_typeof(p_context->'profile') is distinct from 'object'
     or ((p_context->'profile') - array['erpVersion','frappeVersion']) <> '{}'::jsonb
     or not ((p_context->'profile') ?& array['erpVersion','frappeVersion'])
     or p_context->'profile'->>'erpVersion' <> '16.33.0'
     or p_context->'profile'->>'frappeVersion' <> '16.31.0'
     or jsonb_typeof(p_context->'language') is distinct from 'string'
     or length(p_context->>'language') > 64
     or (p_context->>'language') !~ '^[A-Za-z]{1,8}([-_][A-Za-z0-9]{1,8})*$'
     or p_context->>'filterProfile' <> 'erpnext-v16-standard-statements-v1' then
    raise exception 'invalid statement profile or filter context' using errcode='22023';
  end if;
  if jsonb_typeof(p_context->'calendar') is distinct from 'array'
     or jsonb_array_length(p_context->'calendar') = 0 then
    raise exception 'invalid statement calendar' using errcode='22023';
  end if;
  for v_entry in select entry.value from jsonb_array_elements(p_context->'calendar') entry(value) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or (v_entry - array['name','start','end']) <> '{}'::jsonb
       or not (v_entry ?& array['name','start','end'])
       or jsonb_typeof(v_entry->'name') is distinct from 'string'
       or btrim(v_entry->>'name') = ''
       or jsonb_typeof(v_entry->'start') is distinct from 'string'
       or (v_entry->>'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(v_entry->'end') is distinct from 'string'
       or (v_entry->>'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid statement calendar entry' using errcode='22023';
    end if;
    begin
      v_start := (v_entry->>'start')::date;
      v_end := (v_entry->>'end')::date;
    exception when others then
      raise exception 'invalid statement calendar date' using errcode='22023';
    end;
    if to_char(v_start,'YYYY-MM-DD') <> v_entry->>'start'
       or to_char(v_end,'YYYY-MM-DD') <> v_entry->>'end'
       or extract(year from v_start) < 1 or extract(year from v_start) > 9999
       or extract(year from v_end) < 1 or extract(year from v_end) > 9999
       or extract(day from v_start) <> 1
       or v_end <> (v_start + interval '12 months' - interval '1 day')::date
       or (v_previous_end is not null and (v_start <= v_previous_end or v_start <= v_previous_start))
       or v_entry->>'name' = any(v_names) then
      raise exception 'invalid or overlapping statement fiscal year' using errcode='22023';
    end if;
    v_names := array_append(v_names,v_entry->>'name');
    v_previous_start := v_start;
    v_previous_end := v_end;
  end loop;

  v_project_map := coalesce(v_binding.config->'project_map','{}'::jsonb);
  if jsonb_typeof(v_project_map) is distinct from 'object'
     or jsonb_typeof(p_context->'projectMap') is distinct from 'object'
     or p_context->'projectMap' is distinct from v_project_map then
    raise exception 'statement project map changed' using errcode='55000';
  end if;
  for v_project in select entry.key,entry.value from jsonb_each(v_project_map) entry loop
    if v_project.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_project.value) is distinct from 'string'
       or btrim(v_project.value #>> '{}') = '' then
      raise exception 'invalid statement project mapping' using errcode='22023';
    end if;
    if not exists(select 1 from public.projects p where p.id=v_project.key::uuid and p.org_id=p_org_id) then
      raise exception 'invalid statement project mapping' using errcode='22023';
    end if;
  end loop;
  if exists(select 1 from jsonb_each_text(v_project_map) e group by e.value having count(*)>1) then
    raise exception 'duplicate statement project mapping' using errcode='22023';
  end if;

  if jsonb_typeof(p_context->'presentation') is distinct from 'object'
     or ((p_context->'presentation') - array['metadata','context']) <> '{}'::jsonb
     or not ((p_context->'presentation') ?& array['metadata','context'])
     or jsonb_typeof(p_context->'presentation'->'metadata') is distinct from 'object'
     or jsonb_typeof(p_context->'presentation'->'context') is distinct from 'object' then
    raise exception 'invalid statement presentation context' using errcode='22023';
  end if;
  v_metadata := p_context->'presentation'->'metadata';
  v_presentation_context := p_context->'presentation'->'context';
  if (v_presentation_context - array['requestLanguage','currencyPrecisionBranch','raw']) <> '{}'::jsonb
     or not (v_presentation_context ?& array['requestLanguage','currencyPrecisionBranch','raw'])
     or jsonb_typeof(v_presentation_context->'raw') is distinct from 'object' then
    raise exception 'invalid statement presentation provenance' using errcode='22023';
  end if;
  v_raw := v_presentation_context->'raw';
  v_currency_raw := v_raw->'currency';
  v_branch := v_presentation_context->>'currencyPrecisionBranch';
  if (v_raw - array['company','accountsSettings','currency']) <> '{}'::jsonb
     or not (v_raw ?& array['company','accountsSettings','currency'])
     or jsonb_typeof(v_raw->'company') is distinct from 'object'
     or ((v_raw->'company') - array['name','currency','defaultFinanceBook']) <> '{}'::jsonb
     or not ((v_raw->'company') ?& array['name','currency','defaultFinanceBook'])
     or jsonb_typeof(v_raw->'accountsSettings') is distinct from 'object'
     or ((v_raw->'accountsSettings') - array['ignoreOpeningCheck','ignoreAccountClosingBalance']) <> '{}'::jsonb
     or not ((v_raw->'accountsSettings') ?& array['ignoreOpeningCheck','ignoreAccountClosingBalance'])
     or jsonb_typeof(v_currency_raw) is distinct from 'object'
     or ((v_currency_raw) - array['fractionUnits','numberFormat']) <> '{}'::jsonb
     or not ((v_currency_raw) ?& array['fractionUnits','numberFormat'])
     or v_metadata->>'erpVersion' is distinct from p_context->'profile'->>'erpVersion'
     or v_metadata->>'frappeVersion' is distinct from p_context->'profile'->>'frappeVersion'
     or v_metadata->>'currency' is distinct from 'IDR'
     or v_metadata->'calendar' is distinct from p_context->'calendar'
     or jsonb_typeof(v_metadata->'currencyPrecision') is distinct from 'number'
     or (v_metadata->>'currencyPrecision') !~ '^(0|[1-9])$'
     or jsonb_typeof(v_metadata->'roundingMethod') is distinct from 'string'
     or v_metadata->>'roundingMethod' is distinct from 'erpnext_report_output'
     or p_context->>'language' is distinct from 'en'
     or v_presentation_context->>'requestLanguage' is distinct from 'en'
     or jsonb_typeof(v_currency_raw->'numberFormat') not in ('string','null')
     or jsonb_typeof(v_currency_raw->'fractionUnits') not in ('number','string','null') then
    raise exception 'invalid statement presentation metadata' using errcode='22023';
  end if;
  if v_currency_raw->'fractionUnits' is distinct from 'null'::jsonb then
    if (v_currency_raw->>'fractionUnits') !~ '^(0|[1-9][0-9]*)$' then
      raise exception 'invalid Currency fraction units provenance' using errcode='22023';
    end if;
    v_fraction_units := (v_currency_raw->>'fractionUnits')::numeric;
    if v_fraction_units > 9007199254740991
       or v_metadata->'fractionUnits' is distinct from to_jsonb(v_fraction_units) then
      raise exception 'Currency fraction units provenance changed' using errcode='22023';
    end if;
  elsif v_metadata->'fractionUnits' is distinct from 'null'::jsonb then
    raise exception 'Currency fraction units provenance changed' using errcode='22023';
  end if;
  v_number_format := case when v_currency_raw->'numberFormat' = 'null'::jsonb then null else v_currency_raw->>'numberFormat' end;
  if v_branch = 'currency_number_format' then
    v_expected_precision := case v_number_format
      when '#,###.##' then 2 when '#.###,##' then 2 when '# ###.##' then 2
      when '# ###,##' then 2 when '#''###.##' then 2 when '#, ###.##' then 2
      when '#,##,###.##' then 2 when '#,###.###' then 3 when '#.###' then 0
      when '#,###' then 0 else null end;
  elsif v_branch = 'currency_fraction_units' and v_number_format is null then
    if v_fraction_units is null then
      raise exception 'Currency fraction units are unavailable' using errcode='22023';
    end if;
    if v_fraction_units in (0,1) then
      v_expected_precision := 0;
    else
      v_remaining := v_fraction_units;
      v_power_two := 0;
      v_power_five := 0;
      while mod(v_remaining,2)=0 loop v_remaining := v_remaining/2; v_power_two := v_power_two+1; end loop;
      while mod(v_remaining,5)=0 loop v_remaining := v_remaining/5; v_power_five := v_power_five+1; end loop;
      v_expected_precision := greatest(v_power_two,v_power_five);
      if v_remaining <> 1 or v_expected_precision > 9 then v_expected_precision := null; end if;
    end if;
  else
    v_expected_precision := null;
  end if;
  if v_expected_precision is null or v_metadata->>'currencyPrecision' <> v_expected_precision::text
     or (v_branch='currency_fraction_units' and v_number_format is not null)
     or (v_branch='currency_number_format' and v_number_format is null) then
    raise exception 'Currency presentation precision is not source-bound' using errcode='22023';
  end if;
end;
$$;


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

create or replace function public._erp_ack_statement_dirty_dates(p_org_id uuid,p_company text,p_cutoff bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context jsonb;
  v_effective_date date;
  v_timezone text;
  v_consumed_through date;
begin
  select b.context,b.effective_date,b.planning_timezone
    into v_context,v_effective_date,v_timezone
    from public.erp_financial_statement_report_batch b
   where b.org_id=p_org_id and b.context->>'company'=p_company
     and b.dirty_revision_cutoff=p_cutoff for update;
  if not found or v_effective_date is null or v_timezone is null then
    raise exception 'statement dirty acknowledgment has no admitted batch' using errcode='55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_company,0));
  select max(r.current_end) into v_consumed_through
    from (
      select distinct on (plan.period_kind) plan.period_kind,plan.current_end
        from public._erp_statement_report_plan(v_context) plan
       where plan.current_start<=v_effective_date
       order by plan.period_kind,plan.current_start desc,plan.current_end desc
    ) r;
  if v_consumed_through is not null then
    delete from public.erp_financial_statement_dirty_date
     where org_id=p_org_id and company=p_company and revision<=p_cutoff
       and posting_date<=v_consumed_through;
  end if;
end;
$$;
revoke all on function public._erp_ack_statement_dirty_dates(uuid,text,bigint) from public,anon,authenticated,service_role;

revoke all on function public._erp_statement_report_refresh_plan(uuid,jsonb,date,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.open_erp_statement_report_batch(uuid,uuid,jsonb)
  from public,anon,authenticated;
revoke all on function public.publish_erp_financial_statements(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.open_erp_statement_report_batch(uuid,uuid,jsonb) to service_role;
grant execute on function public.publish_erp_financial_statements(uuid,uuid,uuid) to service_role;



-- Generation time remains the publication timestamp; capture bounds describe native acquisitions.
create or replace view public.erp_financial_statement_availability
with (security_barrier = true)
as
select
  case when public.auth_role()::text in ('Admin','Finance','Executive')
       then nullif(btrim(binding.config->>'company'),'') else null end as company_label,
  case when latest.snapshot_id is not null then coalesce((
    select jsonb_agg(jsonb_build_object('start',entry.value->>'start','end',entry.value->>'end') order by entry.ordinality)
    from jsonb_array_elements(case when jsonb_typeof(binding.statement_calendar)='array'
      then binding.statement_calendar else '[]'::jsonb end) with ordinality entry(value,ordinality)
    where jsonb_typeof(entry.value)='object'
      and jsonb_typeof(entry.value->'start')='string' and jsonb_typeof(entry.value->'end')='string'
      and (entry.value->>'start') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (entry.value->>'end') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),'[]'::jsonb) else '[]'::jsonb end as calendar,
  latest.as_of as last_success_at,
  latest.snapshot_id,
  latest.source_generation,
  binding.statement_update_delayed as delayed,
  latest.capture_started_at,
  latest.capture_completed_at
from public.external_org_bindings binding
left join lateral (
  select snapshot.snapshot_id,snapshot.source_generation,snapshot.as_of,
    snapshot.capture_started_at,snapshot.capture_completed_at
  from public.erp_financial_statement_snapshot snapshot
  where snapshot.org_id=binding.org_id and snapshot.company=btrim(binding.config->>'company')
    and snapshot.capture_started_at is not null and snapshot.capture_completed_at is not null
  order by coalesce(snapshot.published_at,snapshot.as_of) desc,snapshot.snapshot_id desc limit 1
) latest on true
where binding.org_id=public.auth_org_id() and public.is_active_member()
  and public.auth_role()::text in ('Admin','Finance','Executive','Project Manager','Engineer')
  and binding.external_tier='erpnext' and binding.activated_at is not null
  and nullif(btrim(binding.config->>'company'),'') is not null;

alter view public.erp_financial_statement_availability owner to postgres;
revoke all on public.erp_financial_statement_availability from public,anon,authenticated,service_role;
grant select on public.erp_financial_statement_availability to authenticated;

create or replace function public.get_financial_statement_catalogue(p_project_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_bad boolean;
  v_project_map jsonb;
begin
  if v_org_id is null or not coalesce(public.is_active_member(),false)
     or v_role not in ('Admin','Finance','Executive','Project Manager','Engineer') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_project_id is null and v_role not in ('Admin','Finance','Executive') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_project_id is not null and not exists(select 1 from public.projects p
    where p.id=p_project_id and p.org_id=v_org_id) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_project_id is null then
    select binding.config->'project_map' into v_project_map
    from public.external_org_bindings binding
    where binding.org_id=v_org_id and binding.external_tier='erpnext' and binding.activated_at is not null
    limit 1;
  end if;
  select exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and (
          (s.scope_kind='company' and s.project_id is null)
          or (s.scope_kind='project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map)='object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text)='string'
              and btrim(v_project_map->>s.project_id::text)<>'',false)
            and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
      and (s.source_generation is distinct from a.source_generation or s.as_of is distinct from a.last_success_at
        or s.capture_started_at is distinct from a.capture_started_at
        or s.capture_completed_at is distinct from a.capture_completed_at)
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and (
          (s.scope_kind='company' and s.project_id is null)
          or (s.scope_kind='project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map)='object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text)='string'
              and btrim(v_project_map->>s.project_id::text)<>'',false)
            and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    group by s.snapshot_id
    having count(distinct s.display_precision)>1 or count(distinct s.display_rounding_method)>1
      or count(distinct s.capture_started_at)>1 or count(distinct s.capture_completed_at)>1
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and (
          (s.scope_kind='company' and s.project_id is null)
          or (s.scope_kind='project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map)='object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text)='string'
              and btrim(v_project_map->>s.project_id::text)<>'',false)
            and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    group by s.period_kind,s.current_start
    having count(distinct (s.current_end,s.prior_start,s.prior_end))>1
  ) into v_bad;
  if v_bad then raise exception 'Invalid statement selection' using errcode='22023'; end if;

  return (
    with availability as materialized (
      select company_label,calendar,last_success_at,snapshot_id,source_generation,capture_started_at,capture_completed_at,delayed
      from public.erp_financial_statement_availability
    ), candidates as materialized (
      select s.id,s.snapshot_id,s.source_generation,s.as_of,s.capture_started_at,s.capture_completed_at,
        s.currency,s.display_precision,s.display_rounding_method,s.statement,s.scope_kind,s.project_id,s.view_kind,
        s.period_kind,s.current_start,s.current_end,s.prior_start,s.prior_end
      from availability a join public.erp_financial_statement_snapshot s
        on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
      where a.snapshot_id is not null and s.capture_started_at is not null
        and ((p_project_id is null and (
            (s.scope_kind='company' and s.project_id is null)
            or (s.scope_kind='project' and s.project_id is not null
              and coalesce(jsonb_typeof(v_project_map)='object'
                and v_project_map ? s.project_id::text
                and jsonb_typeof(v_project_map->s.project_id::text)='string'
                and btrim(v_project_map->>s.project_id::text)<>'',false)
              and exists(select 1 from public.projects p where p.id=s.project_id and p.org_id=v_org_id))))
          or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    ), generation_row as (
      select * from candidates order by as_of desc,capture_completed_at desc,snapshot_id desc,id limit 1
    ), period_rows as (
      select distinct period_kind,current_start,current_end,prior_start,prior_end from candidates
    ), periods as (
      select coalesce(jsonb_agg(jsonb_build_object('kind',period_kind,'currentStart',current_start::text,
        'currentEnd',current_end::text,'priorStart',prior_start::text,'priorEnd',prior_end::text)
        order by current_start,case period_kind when 'month' then 0 when 'quarter' then 1 else 2 end),'[]'::jsonb) value
      from period_rows
    ), scope_keys as (select distinct scope_kind,project_id from candidates), scopes as (
      select coalesce(jsonb_agg(jsonb_build_object('scopeKind',scope.scope_kind,'projectId',scope.project_id,
        'statements',(select coalesce(jsonb_agg(k.statement order by case k.statement when 'trial_balance' then 0 when 'profit_and_loss' then 1 else 2 end),'[]'::jsonb)
          from (select distinct c.statement from candidates c where c.scope_kind=scope.scope_kind and c.project_id is not distinct from scope.project_id) k),
        'viewKinds',(select coalesce(jsonb_agg(k.view_kind order by case k.view_kind when 'account_breakdown' then 0 else 1 end),'[]'::jsonb)
          from (select distinct c.view_kind from candidates c where c.scope_kind=scope.scope_kind and c.project_id is not distinct from scope.project_id) k)
        ) order by case scope.scope_kind when 'company' then 0 else 1 end,scope.project_id),'[]'::jsonb) value
      from scope_keys scope
    )
    select jsonb_build_object(
      'state',case when exists(select 1 from candidates) then 'complete' else 'unavailable' end,
      'companyLabel',(select company_label from availability limit 1),
      'generation',case when g.snapshot_id is null then null else jsonb_build_object(
        'snapshotId',g.snapshot_id,'sourceGeneration',g.source_generation,'asOf',g.as_of,
        'captureStartedAt',g.capture_started_at,'captureCompletedAt',g.capture_completed_at,
        'currency',g.currency,'presentation',jsonb_build_object('precision',g.display_precision,'roundingMethod',g.display_rounding_method),
        'delayed',(select delayed from availability limit 1)) end,
      'periods',periods.value,'scopes',scopes.value
    ) from periods cross join scopes left join generation_row g on true
  );
end;
$$;

create or replace function public.get_financial_statement(
  p_period_kind text,p_period_start date,p_statement text,p_project_id uuid default null,
  p_view_kind text default 'account_breakdown',p_unassigned boolean default false
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_scope text;
  v_bad boolean;
begin
  if p_period_kind is null or p_period_kind not in ('month','quarter','fiscal_year')
     or p_period_start is null or not isfinite(p_period_start)
     or p_statement is null or p_statement not in ('trial_balance','profit_and_loss','balance_sheet')
     or p_view_kind is null or p_view_kind not in ('account_breakdown','project_totals')
     or p_unassigned is distinct from false then
    raise exception 'Invalid statement selection' using errcode='22023';
  end if;
  if p_project_id is not null and (p_statement<>'profit_and_loss' or p_unassigned) then
    raise exception 'Invalid statement selection' using errcode='22023';
  end if;
  if p_project_id is null and p_view_kind<>'account_breakdown' then
    raise exception 'Invalid statement selection' using errcode='22023';
  end if;
  if v_org_id is null or not coalesce(public.is_active_member(),false)
     or v_role not in ('Admin','Finance','Executive','Project Manager','Engineer') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_project_id is not null then
    -- Projects visibility is checked before every statement-absence lookup.
    if not exists(select 1 from public.projects p where p.id=p_project_id and p.org_id=v_org_id) then
      raise exception 'Not permitted' using errcode='42501';
    end if;
    v_scope := 'project';
  else
    v_scope := 'company';
  end if;
  if v_role in ('Project Manager','Engineer') then
    if p_project_id is null or p_statement<>'profit_and_loss' or p_view_kind<>'project_totals' then
      raise exception 'Not permitted' using errcode='42501';
    end if;
  end if;

  select exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null and s.scope_kind=v_scope and s.project_id is not distinct from p_project_id
      and (s.source_generation is distinct from a.source_generation or s.as_of is distinct from a.last_success_at
        or s.capture_started_at is distinct from a.capture_started_at or s.capture_completed_at is distinct from a.capture_completed_at)
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null and s.scope_kind=v_scope and s.project_id is not distinct from p_project_id
    group by s.snapshot_id having count(distinct s.display_precision)>1 or count(distinct s.display_rounding_method)>1
      or count(distinct s.capture_started_at)>1 or count(distinct s.capture_completed_at)>1
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null and s.scope_kind=v_scope and s.project_id is not distinct from p_project_id
    group by s.period_kind,s.current_start having count(distinct (s.current_end,s.prior_start,s.prior_end))>1
  ) into v_bad;
  if v_bad then raise exception 'Invalid statement selection' using errcode='22023'; end if;

  return (
    with availability as materialized (
      select company_label,last_success_at,snapshot_id,source_generation,capture_started_at,capture_completed_at,delayed
      from public.erp_financial_statement_availability
    ), candidates as materialized (
      select s.id,s.snapshot_id,s.source_generation,s.as_of,s.capture_started_at,s.capture_completed_at,
        s.currency,s.display_precision,s.display_rounding_method,s.statement,s.scope_kind,s.project_id,s.view_kind,
        s.period_kind,s.current_start,s.current_end,s.prior_start,s.prior_end,s.has_activity,s.payload,
        s.source_report,s.report_version,s.filters,s.settings
      from availability a join public.erp_financial_statement_snapshot s
        on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
      where a.snapshot_id is not null and s.capture_started_at is not null
        and s.scope_kind=v_scope and s.project_id is not distinct from p_project_id
    ), generation_row as (
      select * from candidates order by as_of desc,capture_completed_at desc,snapshot_id desc,id limit 1
    ), selected as (
      select * from candidates where period_kind=p_period_kind and current_start=p_period_start
        and statement=p_statement and scope_kind=v_scope and project_id is not distinct from p_project_id
        and view_kind=p_view_kind limit 1
    )
    select jsonb_build_object(
      'state',case when selected.id is null then 'unavailable' else 'complete' end,
      'companyLabel',(select company_label from availability limit 1),
      'generation',case when g.snapshot_id is null then null else jsonb_build_object(
        'snapshotId',g.snapshot_id,'sourceGeneration',g.source_generation,'asOf',g.as_of,
        'captureStartedAt',g.capture_started_at,'captureCompletedAt',g.capture_completed_at,
        'currency',g.currency,'presentation',jsonb_build_object('precision',g.display_precision,'roundingMethod',g.display_rounding_method),
        'delayed',(select delayed from availability limit 1)) end,
      'selection',jsonb_build_object('periodKind',p_period_kind,'periodStart',p_period_start::text,
        'statement',p_statement,'scopeKind',v_scope,'projectId',p_project_id,'viewKind',p_view_kind),
      'result',case when selected.id is null then null else jsonb_build_object(
        'viewKind',selected.view_kind,
        'period',jsonb_build_object('kind',selected.period_kind,'currentStart',selected.current_start::text,
          'currentEnd',selected.current_end::text,'priorStart',selected.prior_start::text,'priorEnd',selected.prior_end::text),
        'hasActivity',selected.has_activity,'payload',selected.payload
      ) || case when selected.view_kind='account_breakdown' then jsonb_build_object(
        'provenance',jsonb_build_object('sourceReport',selected.source_report,'reportVersion',selected.report_version,
          'filters',selected.filters,'settings',selected.settings)) else '{}'::jsonb end end
    ) from (select 1) singleton left join generation_row g on true left join selected on true
  );
end;
$$;
