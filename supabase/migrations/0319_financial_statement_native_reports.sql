-- 0319 — native ERPNext statement capture, storage and safe display reads.
-- This additive migration intentionally replaces the unreleased computed-payload publisher API.

alter table public.erp_financial_statement_snapshot
  add column raw_reports jsonb,
  add column capture_started_at timestamptz,
  add column capture_completed_at timestamptz;

alter table public.erp_financial_statement_snapshot
  drop constraint erp_financial_statement_snapshot_detail_payload_check,
  drop constraint erp_financial_statement_snapshot_totals_payload_check;

alter table public.erp_financial_statement_snapshot
  add constraint erp_financial_statement_snapshot_capture_window_check
  check (
    (capture_started_at is null and capture_completed_at is null)
    or (capture_started_at is not null and capture_completed_at is not null
        and capture_started_at <= capture_completed_at and as_of = capture_completed_at)
  ),
  add constraint erp_financial_statement_snapshot_detail_payload_check
  check (
    case
      when view_kind <> 'account_breakdown' then true
      when capture_started_at is null then
        jsonb_typeof(payload) = 'object' and payload ? 'rows'
        and (payload - array['rows']) = '{}'::jsonb
        and jsonb_typeof(payload->'rows') = 'array'
      else
        jsonb_typeof(payload) = 'object'
        and payload ?& array['current','prior']
        and (payload - array['current','prior']) = '{}'::jsonb
        and jsonb_typeof(payload->'current') = 'object'
        and jsonb_typeof(payload->'prior') = 'object'
    end is true
  ),
  add constraint erp_financial_statement_snapshot_native_raw_reports_check
  check (
    case
      when view_kind = 'project_totals' then raw_reports is null
      when capture_started_at is null then raw_reports is null
      else jsonb_typeof(raw_reports) = 'object'
        and raw_reports ?& array['current','prior']
        and (raw_reports - array['current','prior']) = '{}'::jsonb
        and jsonb_typeof(raw_reports->'current') = 'string'
        and jsonb_typeof(raw_reports->'prior') = 'string'
    end is true
  ),
  add constraint erp_financial_statement_snapshot_totals_payload_check
  check (
    case
      when view_kind <> 'project_totals' then true
      when jsonb_typeof(payload) is distinct from 'object' then false
      when not (payload ?& array['current', 'prior']) then false
      when (payload - array['current', 'prior']) <> '{}'::jsonb then false
      when jsonb_typeof(payload->'current') is distinct from 'object' then false
      when not ((payload->'current') ?& array['income', 'expense', 'net']) then false
      when ((payload->'current') - array['income', 'expense', 'net']) <> '{}'::jsonb then false
      when jsonb_typeof(payload->'prior') is distinct from 'object' then false
      when not ((payload->'prior') ?& array['income', 'expense', 'net']) then false
      when ((payload->'prior') - array['income', 'expense', 'net']) <> '{}'::jsonb then false
      when jsonb_typeof(payload->'current'->'income') is distinct from 'string' then false
      when jsonb_typeof(payload->'current'->'expense') is distinct from 'string' then false
      when jsonb_typeof(payload->'current'->'net') is distinct from 'string' then false
      when jsonb_typeof(payload->'prior'->'income') is distinct from 'string' then false
      when jsonb_typeof(payload->'prior'->'expense') is distinct from 'string' then false
      when jsonb_typeof(payload->'prior'->'net') is distinct from 'string' then false
      when (payload->'current'->>'income') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then false
      when (payload->'current'->>'expense') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then false
      when (payload->'current'->>'net') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then false
      when (payload->'prior'->>'income') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then false
      when (payload->'prior'->>'expense') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then false
      when (payload->'prior'->>'net') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then false
      else source_report is null and report_version is null and filters is null and settings is null and raw_reports is null
    end is true
  );

-- The private capture descriptor lives outside the ordinarily-readable binding row.
create table public.erp_financial_statement_report_batch (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  batch_id uuid not null unique,
  started_at timestamptz not null,
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  unique (org_id,batch_id)
);
alter table public.erp_financial_statement_report_batch enable row level security;
alter table public.erp_financial_statement_report_batch force row level security;
revoke all on public.erp_financial_statement_report_batch from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.erp_financial_statement_report_batch to service_role;

create table public.erp_financial_statement_report_pending (
  org_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  statement text not null check (statement in ('trial_balance','profit_and_loss','balance_sheet')),
  project_id uuid,
  period_kind text not null check (period_kind in ('month','quarter','fiscal_year')),
  current_start date not null,
  current_end date not null,
  prior_start date not null,
  prior_end date not null,
  side text not null check (side in ('current','prior')),
  ordinal integer not null check (ordinal > 0),
  normalized_report jsonb,
  raw_response_text text,
  raw_sha256 text,
  acquired_at timestamptz,
  constraint erp_financial_statement_report_pending_pk primary key (org_id,batch_id,ordinal),
  constraint erp_financial_statement_report_pending_batch_fk
    foreign key (org_id,batch_id)
    references public.erp_financial_statement_report_batch(org_id,batch_id) on delete cascade,
  constraint erp_financial_statement_report_pending_selection_unique
    unique nulls not distinct (org_id,batch_id,statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,side),
  constraint erp_financial_statement_report_pending_range_check
    check (current_start <= current_end and prior_start <= prior_end),
  constraint erp_financial_statement_report_pending_capture_check
    check (
      (normalized_report is null and raw_response_text is null and raw_sha256 is null and acquired_at is null)
      or (normalized_report is not null and raw_response_text is not null and raw_sha256 is not null and acquired_at is not null
          and raw_sha256 ~ '^[0-9a-f]{64}$')
    )
);

create index erp_financial_statement_report_pending_next_idx
  on public.erp_financial_statement_report_pending(org_id,batch_id,ordinal)
  where normalized_report is null;

alter table public.erp_financial_statement_report_pending enable row level security;
alter table public.erp_financial_statement_report_pending force row level security;
revoke all on public.erp_financial_statement_report_pending from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.erp_financial_statement_report_pending to service_role;

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
  if v_metadata->>'erpVersion' is distinct from p_context->'profile'->>'erpVersion'
     or v_metadata->>'frappeVersion' is distinct from p_context->'profile'->>'frappeVersion'
     or v_metadata->>'currency' is distinct from 'IDR'
     or v_metadata->'calendar' is distinct from p_context->'calendar'
     or jsonb_typeof(v_metadata->'currencyPrecision') is distinct from 'number'
     or (v_metadata->>'currencyPrecision') !~ '^(0|[1-9])$'
     or jsonb_typeof(v_metadata->'roundingMethod') is distinct from 'string'
     or v_metadata->>'roundingMethod' not in ('Banker''s Rounding','Banker''s Rounding (legacy)','Commercial Rounding')
     or p_context->'presentation'->'context'->>'requestLanguage' is distinct from p_context->>'language' then
    raise exception 'invalid statement presentation metadata' using errcode='22023';
  end if;
end;
$$;

create or replace function public._erp_statement_report_plan(p_context jsonb)
returns table (
  ordinal integer, statement text, project_id uuid, period_kind text,
  current_start date, current_end date, prior_start date, prior_end date, side text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fiscal_years as (
    select entry->>'name' as name,(entry->>'start')::date as start_date,(entry->>'end')::date as end_date
    from jsonb_array_elements(p_context->'calendar') entry
  ), candidates as (
    select 'month'::text kind,(fy.start_date+make_interval(months=>m.month_offset))::date start_date,
      ((fy.start_date+make_interval(months=>m.month_offset+1))-interval '1 day')::date end_date,
      fy.name fiscal_year,fy.start_date year_start
    from fiscal_years fy cross join generate_series(0,11) m(month_offset)
    union all
    select 'quarter',(fy.start_date+make_interval(months=>q.month_offset))::date,
      ((fy.start_date+make_interval(months=>q.month_offset+3))-interval '1 day')::date,
      fy.name,fy.start_date
    from fiscal_years fy cross join generate_series(0,9,3) q(month_offset)
    union all
    select 'fiscal_year',fy.start_date,fy.end_date,fy.name,fy.start_date from fiscal_years fy
  ), pairs as (
    select c.kind,c.start_date current_start,c.end_date current_end,p.start_date prior_start,p.end_date prior_end
    from candidates c join candidates p on p.kind=c.kind
      and p.start_date=(c.start_date-make_interval(months=>case c.kind when 'month' then 1 when 'quarter' then 3 else 12 end))::date
      and p.end_date=c.start_date-1
  ), scopes as (
    select 'trial_balance'::text statement,null::uuid project_id
    union all select 'profit_and_loss',null::uuid
    union all select 'balance_sheet',null::uuid
    union all select 'profit_and_loss',entry.key::uuid from jsonb_each(p_context->'projectMap') entry
  ), sides as (
    select p.kind,p.current_start,p.current_end,p.prior_start,p.prior_end,
      s.statement,s.project_id,side.side
    from pairs p cross join scopes s cross join (values ('current'::text),('prior'::text)) side(side)
  )
  select row_number() over(order by
      case kind when 'month' then 0 when 'quarter' then 1 else 2 end,
      current_start,
      case statement when 'trial_balance' then 0 when 'profit_and_loss' then 1 else 2 end,
      project_id nulls first,
      case side when 'current' then 0 else 1 end
    )::integer,
    statement,project_id,kind,current_start,current_end,prior_start,prior_end,side
  from sides
$$;

create or replace function public._erp_statement_report_filters(p_context jsonb,p_selection jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_statement text := p_selection->>'statement';
  v_period_kind text := p_selection->>'periodKind';
  v_side text := p_selection->>'side';
  v_start date;
  v_end date;
  v_fy text;
  v_project uuid;
  v_project_name text;
  v_project_filter jsonb := '[]'::jsonb;
  v_common jsonb;
begin
  v_start := case when v_side='current' then (p_selection->>'currentStart')::date else (p_selection->>'priorStart')::date end;
  v_end := case when v_side='current' then (p_selection->>'currentEnd')::date else (p_selection->>'priorEnd')::date end;
  select entry->>'name' into v_fy from jsonb_array_elements(p_context->'calendar') entry
   where (entry->>'start')::date <= v_start and (entry->>'end')::date >= v_start;
  if v_fy is null then raise exception 'invalid planned report fiscal year' using errcode='22023'; end if;
  if jsonb_typeof(p_selection->'projectId') <> 'null' then
    v_project := (p_selection->>'projectId')::uuid;
    v_project_name := p_context->'projectMap'->>v_project::text;
    if v_project_name is null then raise exception 'invalid planned report project' using errcode='22023'; end if;
    v_project_filter := jsonb_build_array(v_project_name);
  end if;
  v_common := jsonb_build_object(
    'company',p_context->>'company','finance_book','','presentation_currency','IDR',
    'cost_center',jsonb_build_array(),'include_default_book_entries',1,'project',v_project_filter
  );
  if v_statement='trial_balance' then
    return v_common || jsonb_build_object(
      'fiscal_year',v_fy,'from_date',v_start::text,'to_date',v_end::text,
      'with_period_closing_entry_for_opening',1,'with_period_closing_entry_for_current_period',1,
      'show_group_accounts',1,'show_net_values',1,'show_zero_values',0,'show_unclosed_fy_pl_balances',0
    );
  end if;
  return v_common || jsonb_build_object(
    'filter_based_on','Date Range','period_start_date',v_start::text,'period_end_date',v_end::text,
    'from_fiscal_year',v_fy,'to_fiscal_year',v_fy,
    'periodicity',case v_period_kind when 'month' then 'Monthly' when 'quarter' then 'Quarterly' else 'Yearly' end,
    'accumulated_values',case when v_statement='balance_sheet' then 1 else 0 end,
    'selected_view','Report','report_template','','show_zero_values',0
  );
end;
$$;

create or replace function public._erp_statement_period_matches(
  p_context jsonb,p_period jsonb,p_kind text,p_start date,p_end date
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from_fy text;
  v_to_fy text;
  v_native_kind text := case p_kind when 'fiscal_year' then 'year' else p_kind end;
begin
  if jsonb_typeof(p_period) is distinct from 'object'
     or (p_period - array['fromDate','toDate','fromFiscalYear','toFiscalYear','kind','columnLabel']) <> '{}'::jsonb
     or not ((p_period) ?& array['fromDate','toDate','fromFiscalYear','toFiscalYear','kind'])
     or (p_period ? 'columnLabel' and jsonb_typeof(p_period->'columnLabel') is distinct from 'string') then
    return false;
  end if;
  select entry->>'name' into v_from_fy from jsonb_array_elements(p_context->'calendar') entry
   where (entry->>'start')::date <= p_start and (entry->>'end')::date >= p_start;
  select entry->>'name' into v_to_fy from jsonb_array_elements(p_context->'calendar') entry
   where (entry->>'start')::date <= p_end and (entry->>'end')::date >= p_end;
  return p_period->>'fromDate'=p_start::text
     and p_period->>'toDate'=p_end::text
     and p_period->>'fromFiscalYear'=v_from_fy
     and p_period->>'toFiscalYear'=v_to_fy
     and p_period->>'kind'=v_native_kind
     and v_from_fy is not null and v_to_fy is not null;
end;
$$;

create or replace function public._erp_statement_report_validate(
  p_context jsonb,p_selection jsonb,p_report jsonb,p_raw_text text,p_started_at timestamptz
) returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_statement text := p_selection->>'statement';
  v_period_kind text := p_selection->>'periodKind';
  v_side text := p_selection->>'side';
  v_project_id uuid;
  v_expected_project jsonb := 'null'::jsonb;
  v_period jsonb;
  v_period_pair jsonb;
  v_expected_from date;
  v_expected_to date;
  v_hash text;
  v_acquired timestamptz;
  v_field text;
  v_row jsonb;
  v_has_amount boolean;
  v_summary jsonb;
  v_expected_name text;
begin
  if jsonb_typeof(p_report) is distinct from 'object'
     or not (p_report ?& array['reportName','company','side','period','periodPair','project','language','profile','columns','rows','summary','provenance'])
     or jsonb_typeof(p_report->'columns') is distinct from 'array'
     or jsonb_typeof(p_report->'rows') is distinct from 'array'
     or (jsonb_typeof(p_report->'summary') is distinct from 'array' and jsonb_typeof(p_report->'summary') is distinct from 'null')
     or jsonb_typeof(p_report->'provenance') is distinct from 'object'
     or not (p_report->'provenance' ?& array['endpoint','method','ignorePreparedReport','rawSha256','acquiredAt','filters']) then
    raise exception 'invalid native statement report' using errcode='22023';
  end if;
  v_expected_name := case v_statement when 'trial_balance' then 'Trial Balance'
    when 'profit_and_loss' then 'Profit and Loss Statement' else 'Balance Sheet' end;
  if p_report->>'reportName' is distinct from v_expected_name
     or p_report->>'company' is distinct from p_context->>'company'
     or p_report->>'side' is distinct from v_side
     or p_report->'profile' is distinct from p_context->'profile'
     or p_report->>'language' is distinct from p_context->>'language' then
    raise exception 'native report identity does not match its selection' using errcode='22023';
  end if;
  if jsonb_typeof(p_selection->'projectId') <> 'null' then
    v_project_id := (p_selection->>'projectId')::uuid;
    v_expected_project := jsonb_build_object('projectId',v_project_id,'erpProjectName',p_context->'projectMap'->>v_project_id::text);
  end if;
  if p_report->'project' is distinct from v_expected_project
     or (v_project_id is not null and v_statement <> 'profit_and_loss') then
    raise exception 'native report project does not match its selection' using errcode='22023';
  end if;
  v_expected_from := case when v_side='current' then (p_selection->>'currentStart')::date else (p_selection->>'priorStart')::date end;
  v_expected_to := case when v_side='current' then (p_selection->>'currentEnd')::date else (p_selection->>'priorEnd')::date end;
  v_period := p_report->'period';
  v_period_pair := p_report->'periodPair';
  if jsonb_typeof(v_period_pair) is distinct from 'object'
     or (v_period_pair - array['current','prior']) <> '{}'::jsonb
     or not (v_period_pair ?& array['current','prior'])
     or not public._erp_statement_period_matches(p_context,v_period_pair->'current',v_period_kind,
          (p_selection->>'currentStart')::date,(p_selection->>'currentEnd')::date)
     or not public._erp_statement_period_matches(p_context,v_period_pair->'prior',v_period_kind,
          (p_selection->>'priorStart')::date,(p_selection->>'priorEnd')::date)
     or not public._erp_statement_period_matches(p_context,v_period,v_period_kind,v_expected_from,v_expected_to) then
    raise exception 'native report period does not match its selection' using errcode='22023';
  end if;
  if p_report->'provenance'->>'endpoint' is distinct from '/api/method/frappe.desk.query_report.run'
     or p_report->'provenance'->>'method' is distinct from 'GET'
     or p_report->'provenance'->'ignorePreparedReport' is distinct from '1'::jsonb
     or p_report->'provenance'->'filters' is distinct from public._erp_statement_report_filters(p_context,p_selection)
     or jsonb_typeof(p_report->'provenance'->'rawSha256') is distinct from 'string'
     or (p_report->'provenance'->>'rawSha256') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_report->'provenance'->'acquiredAt') is distinct from 'string'
     or (p_report->'provenance'->>'acquiredAt') !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
     or p_raw_text is null or octet_length(convert_to(p_raw_text,'UTF8')) > 5242880 then
    raise exception 'native report provenance does not match its selection' using errcode='22023';
  end if;
  begin
    perform p_raw_text::jsonb;
    v_acquired := (p_report->'provenance'->>'acquiredAt')::timestamptz;
  exception when others then
    raise exception 'invalid native report capture' using errcode='22023';
  end;
  v_hash := encode(extensions.digest(convert_to(p_raw_text,'UTF8'),'sha256'),'hex');
  if p_report->'provenance'->>'rawSha256' is distinct from v_hash
     or v_acquired < p_started_at or v_acquired > clock_timestamp() then
    raise exception 'native report hash or capture time is invalid' using errcode='22023';
  end if;

  if v_statement='trial_balance' then
    foreach v_field in array array['opening_debit','opening_credit','debit','credit','closing_debit','closing_credit'] loop
      if not exists(select 1 from jsonb_array_elements(p_report->'columns') col
        where col->>'fieldname'=v_field and col->>'type'='currency') then
        raise exception 'native Trial Balance is missing a consumed Currency column' using errcode='22023';
      end if;
    end loop;
    for v_row in select row_value from jsonb_array_elements(p_report->'rows') rows(row_value) loop
      if jsonb_typeof(v_row) is distinct from 'object' then
        raise exception 'invalid native statement row' using errcode='22023';
      end if;
      v_has_amount := false;
      foreach v_field in array array['opening_debit','opening_credit','debit','credit','closing_debit','closing_credit'] loop
        if v_row ? v_field then
          v_has_amount := true;
          if jsonb_typeof(v_row->v_field) is distinct from 'string'
             or (v_row->>v_field) !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then
            raise exception 'invalid native Trial Balance Currency cell' using errcode='22023';
          end if;
        end if;
      end loop;
      if v_has_amount then
        foreach v_field in array array['opening_debit','opening_credit','debit','credit','closing_debit','closing_credit'] loop
          if not (v_row ? v_field) then
            raise exception 'native Trial Balance amount row is missing a consumed cell' using errcode='22023';
          end if;
        end loop;
      end if;
    end loop;
  end if;
  if v_project_id is not null then
    v_summary := p_report->'summary';
    if jsonb_typeof(v_summary) is distinct from 'array' or jsonb_array_length(v_summary)<3 then
      raise exception 'native project summary is incomplete' using errcode='22023';
    end if;
    for v_field in select value from (values ('0'),('1'),('2')) positions(value) loop
      if jsonb_typeof(v_summary->v_field::integer) is distinct from 'object'
         or v_summary->v_field::integer->>'datatype' is distinct from 'Currency'
         or v_summary->v_field::integer->>'currency' is distinct from 'IDR'
         or jsonb_typeof(v_summary->v_field::integer->'value') is distinct from 'string'
         or (v_summary->v_field::integer->>'value') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$' then
        raise exception 'native project summary is invalid' using errcode='22023';
      end if;
    end loop;
  end if;
  return v_acquired;
end;
$$;

create or replace function public._erp_statement_native_has_amount_rows(p_report jsonb)
returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from jsonb_array_elements(p_report->'rows') native_row
    where exists(
      select 1 from jsonb_array_elements(p_report->'columns') native_column
      where native_column->>'type'='currency'
        and jsonb_typeof(native_row->(native_column->>'fieldname')) in ('string','number')
    )
  )
$$;

create function public.open_erp_statement_report_batch(p_org_id uuid,p_holder uuid,p_context jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.erp_sweep_lock%rowtype;
  v_binding public.external_org_bindings%rowtype;
  v_batch public.erp_financial_statement_report_batch%rowtype;
  v_batch_id uuid;
  v_started_at timestamptz;
  v_next record;
  v_complete boolean;
  v_count integer;
begin
  if p_org_id is null or p_holder is null then raise exception 'invalid statement batch identity' using errcode='22023'; end if;
  select * into v_lock from public.erp_sweep_lock where org_id=p_org_id for update;
  if not found or v_lock.holder is distinct from p_holder or v_lock.locked_until<=clock_timestamp() then
    raise exception 'statement lease is not current' using errcode='55000';
  end if;
  select * into v_binding from public.external_org_bindings
   where org_id=p_org_id and external_tier='erpnext' for update;
  if not found then raise exception 'statement binding is unavailable' using errcode='55000'; end if;
  perform public._erp_statement_report_context_validate(p_org_id,p_context);

  select * into v_batch from public.erp_financial_statement_report_batch
   where org_id=p_org_id for update;
  if found then
    if v_batch.context = p_context then
      v_batch_id := v_batch.batch_id;
      v_started_at := v_batch.started_at;
      if not exists (
        select 1 from public.erp_financial_statement_report_pending
         where org_id=p_org_id and batch_id=v_batch_id
      ) then raise exception 'stored statement batch plan is missing' using errcode='55000'; end if;
    else
      delete from public.erp_financial_statement_report_batch where org_id=p_org_id;
      v_batch.batch_id := null;
    end if;
  end if;

  if v_batch.batch_id is null then
    v_batch_id := gen_random_uuid();
    v_started_at := clock_timestamp();
    insert into public.erp_financial_statement_report_batch(org_id,batch_id,started_at,context)
      values (p_org_id,v_batch_id,v_started_at,p_context);
    update public.external_org_bindings
       set statement_update_delayed=true
     where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';
    insert into public.erp_financial_statement_report_pending(
      org_id,batch_id,statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,side,ordinal
    )
    select p_org_id,v_batch_id,plan.statement,plan.project_id,plan.period_kind,
      plan.current_start,plan.current_end,plan.prior_start,plan.prior_end,plan.side,plan.ordinal
    from public._erp_statement_report_plan(p_context) plan;
    get diagnostics v_count = row_count;
    if v_count=0 then raise exception 'statement calendar has no supported comparison ranges' using errcode='22023'; end if;
  else
    update public.external_org_bindings set statement_update_delayed=true
     where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';
  end if;

  select * into v_next from public.erp_financial_statement_report_pending
   where org_id=p_org_id and batch_id=v_batch_id and normalized_report is null
   order by ordinal limit 1;
  v_complete := not found;
  if clock_timestamp() >= (select locked_until from public.erp_sweep_lock where org_id=p_org_id and holder=p_holder) then
    raise exception 'statement lease expired during batch open' using errcode='55000';
  end if;
  return jsonb_build_object(
    'batchId',v_batch_id,'startedAt',v_started_at,
    'nextRequest',case when v_complete then null else jsonb_build_object(
      'statement',v_next.statement,'projectId',v_next.project_id,'periodKind',v_next.period_kind,
      'currentStart',v_next.current_start::text,'currentEnd',v_next.current_end::text,
      'priorStart',v_next.prior_start::text,'priorEnd',v_next.prior_end::text,'side',v_next.side
    ) end,
    'complete',v_complete
  );
end;
$$;

create function public.stage_erp_statement_report(p_org_id uuid,p_holder uuid,p_batch_id uuid,p_report jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.erp_sweep_lock%rowtype;
  v_binding public.external_org_bindings%rowtype;
  v_batch public.erp_financial_statement_report_batch%rowtype;
  v_context jsonb;
  v_selection jsonb;
  v_report jsonb;
  v_pending public.erp_financial_statement_report_pending%rowtype;
  v_project_id uuid;
  v_current_start date;
  v_current_end date;
  v_prior_start date;
  v_prior_end date;
  v_acquired_at timestamptz;
  v_hash text;
  v_started_at timestamptz;
begin
  if p_org_id is null or p_holder is null or p_batch_id is null
     or jsonb_typeof(p_report) is distinct from 'object'
     or (p_report - array['selection','report','rawText']) <> '{}'::jsonb
     or not (p_report ?& array['selection','report','rawText'])
     or jsonb_typeof(p_report->'selection') is distinct from 'object'
     or jsonb_typeof(p_report->'rawText') is distinct from 'string' then
    raise exception 'invalid native report stage envelope' using errcode='22023';
  end if;
  select * into v_lock from public.erp_sweep_lock where org_id=p_org_id for update;
  if not found or v_lock.holder is distinct from p_holder or v_lock.locked_until<=clock_timestamp() then
    raise exception 'statement lease is not current' using errcode='55000';
  end if;
  select * into v_binding from public.external_org_bindings
   where org_id=p_org_id and external_tier='erpnext' for update;
  if not found then raise exception 'statement binding is unavailable' using errcode='55000'; end if;
  select * into v_batch from public.erp_financial_statement_report_batch
   where org_id=p_org_id and batch_id=p_batch_id for update;
  if not found then raise exception 'statement batch is not current' using errcode='55000'; end if;
  v_context := v_batch.context;
  v_started_at := v_batch.started_at;
  perform public._erp_statement_report_context_validate(p_org_id,v_context);
  v_selection := p_report->'selection';
  if (v_selection - array['statement','projectId','periodKind','currentStart','currentEnd','priorStart','priorEnd','side']) <> '{}'::jsonb
     or not (v_selection ?& array['statement','projectId','periodKind','currentStart','currentEnd','priorStart','priorEnd','side'])
     or jsonb_typeof(v_selection->'statement') is distinct from 'string'
     or jsonb_typeof(v_selection->'projectId') not in ('string','null')
     or jsonb_typeof(v_selection->'periodKind') is distinct from 'string'
     or jsonb_typeof(v_selection->'currentStart') is distinct from 'string'
     or jsonb_typeof(v_selection->'currentEnd') is distinct from 'string'
     or jsonb_typeof(v_selection->'priorStart') is distinct from 'string'
     or jsonb_typeof(v_selection->'priorEnd') is distinct from 'string'
     or jsonb_typeof(v_selection->'side') is distinct from 'string' then
    raise exception 'invalid native report selection' using errcode='22023';
  end if;
  begin
    v_project_id := case when jsonb_typeof(v_selection->'projectId')='null' then null else (v_selection->>'projectId')::uuid end;
    v_current_start := (v_selection->>'currentStart')::date;
    v_current_end := (v_selection->>'currentEnd')::date;
    v_prior_start := (v_selection->>'priorStart')::date;
    v_prior_end := (v_selection->>'priorEnd')::date;
  exception when others then
    raise exception 'invalid native report selection' using errcode='22023';
  end;
  if to_char(v_current_start,'YYYY-MM-DD') <> v_selection->>'currentStart'
     or to_char(v_current_end,'YYYY-MM-DD') <> v_selection->>'currentEnd'
     or to_char(v_prior_start,'YYYY-MM-DD') <> v_selection->>'priorStart'
     or to_char(v_prior_end,'YYYY-MM-DD') <> v_selection->>'priorEnd' then
    raise exception 'invalid native report selection' using errcode='22023';
  end if;
  select * into v_pending from public.erp_financial_statement_report_pending p
   where p.org_id=p_org_id and p.batch_id=p_batch_id
     and p.statement=v_selection->>'statement' and p.project_id is not distinct from v_project_id
     and p.period_kind=v_selection->>'periodKind'
     and p.current_start=v_current_start and p.current_end=v_current_end
     and p.prior_start=v_prior_start and p.prior_end=v_prior_end
     and p.side=v_selection->>'side'
   for update;
  if not found then raise exception 'native report selection is not planned' using errcode='22023'; end if;
  if v_selection is distinct from jsonb_build_object(
    'statement',v_pending.statement,'projectId',v_pending.project_id,'periodKind',v_pending.period_kind,
    'currentStart',v_pending.current_start::text,'currentEnd',v_pending.current_end::text,
    'priorStart',v_pending.prior_start::text,'priorEnd',v_pending.prior_end::text,'side',v_pending.side) then
    raise exception 'native report selection is not canonical' using errcode='22023';
  end if;
  v_report := p_report->'report';
  v_acquired_at := public._erp_statement_report_validate(v_context,v_selection,v_report,p_report->>'rawText',v_started_at);
  v_hash := encode(extensions.digest(convert_to(p_report->>'rawText','UTF8'),'sha256'),'hex');
  if v_pending.normalized_report is not null then
    if v_pending.raw_sha256=v_hash and v_pending.normalized_report=v_report then
      if clock_timestamp() >= (select locked_until from public.erp_sweep_lock where org_id=p_org_id and holder=p_holder) then
        raise exception 'statement lease expired during report stage' using errcode='55000';
      end if;
      return;
    end if;
    raise exception 'native report selection was already captured' using errcode='22023';
  end if;
  update public.erp_financial_statement_report_pending
     set normalized_report=v_report,raw_response_text=p_report->>'rawText',raw_sha256=v_hash,acquired_at=v_acquired_at
   where org_id=p_org_id and batch_id=p_batch_id and ordinal=v_pending.ordinal
     and normalized_report is null and raw_response_text is null and raw_sha256 is null and acquired_at is null;
  if not found then raise exception 'native report stage state changed' using errcode='55000'; end if;
  if clock_timestamp() >= (select locked_until from public.erp_sweep_lock where org_id=p_org_id and holder=p_holder) then
    raise exception 'statement lease expired during report stage' using errcode='55000';
  end if;
end;
$$;

drop function public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb);

create function public.publish_erp_financial_statements(p_org_id uuid,p_holder uuid,p_batch_id uuid)
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
  v_completed_at timestamptz;
  v_previous_completion timestamptz;
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
    perform public._erp_statement_report_validate(v_context,v_selection,v_pending.normalized_report,
      v_pending.raw_response_text,v_started_at);
  end loop;

  select max(capture_completed_at) into v_previous_completion
    from public.erp_financial_statement_snapshot
   where org_id=p_org_id and company=v_context->>'company' and capture_completed_at is not null;
  v_completed_at := clock_timestamp();
  if v_previous_completion is not null and v_completed_at <= v_previous_completion then
    raise exception 'native statement completion is not newer' using errcode='55000';
  end if;
  if exists(select 1 from public.erp_financial_statement_report_pending
    where org_id=p_org_id and batch_id=p_batch_id and (acquired_at<v_started_at or acquired_at>v_completed_at)) then
    raise exception 'native report falls outside its capture window' using errcode='55000';
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
    current_start,current_end,prior_start,prior_end,currency,as_of,capture_started_at,capture_completed_at,
    source_report,report_version,filters,settings,payload,raw_reports,has_activity,display_precision,display_rounding_method
  )
  select p_org_id,v_context->>'company',v_snapshot_id,p_batch_id,o.statement,
    case when o.project_id is null then 'company' else 'project' end,o.project_id,o.view_kind,o.period_kind,
    o.current_start,o.current_end,o.prior_start,o.prior_end,'IDR',v_completed_at,v_started_at,v_completed_at,
    o.source_report,o.report_version,o.filters,o.settings,o.payload,o.raw_reports,o.has_activity,
    (v_context->'presentation'->'metadata'->>'currencyPrecision')::integer,
    v_context->'presentation'->'metadata'->>'roundingMethod'
  from pg_temp.pmo_native_output o;

  update public.external_org_bindings
     set statement_update_delayed=false,statement_calendar=v_safe_calendar
   where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';
  delete from public.erp_financial_statement_report_batch where org_id=p_org_id and batch_id=p_batch_id;
  if not exists(select 1 from public.erp_sweep_lock l
    where l.org_id=p_org_id and l.holder=p_holder and l.locked_until>clock_timestamp()) then
    raise exception 'statement lease expired during publication' using errcode='55000';
  end if;
  return v_snapshot_id;
end;
$$;

revoke all on function public._erp_statement_report_context_validate(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public._erp_statement_report_plan(jsonb) from public,anon,authenticated,service_role;
revoke all on function public._erp_statement_report_filters(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public._erp_statement_period_matches(jsonb,jsonb,text,date,date) from public,anon,authenticated,service_role;
revoke all on function public._erp_statement_report_validate(jsonb,jsonb,jsonb,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public._erp_statement_native_has_amount_rows(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.open_erp_statement_report_batch(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.stage_erp_statement_report(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.publish_erp_financial_statements(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.open_erp_statement_report_batch(uuid,uuid,jsonb) to service_role;
grant execute on function public.stage_erp_statement_report(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.publish_erp_financial_statements(uuid,uuid,uuid) to service_role;

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
  order by snapshot.capture_completed_at desc,snapshot.snapshot_id desc limit 1
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
  select exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and s.scope_kind='company' and s.project_id is null)
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
      and (s.source_generation is distinct from a.source_generation or s.as_of is distinct from a.last_success_at
        or s.capture_started_at is distinct from a.capture_started_at
        or s.capture_completed_at is distinct from a.capture_completed_at)
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and s.scope_kind='company' and s.project_id is null)
        or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    group by s.snapshot_id
    having count(distinct s.display_precision)>1 or count(distinct s.display_rounding_method)>1
      or count(distinct s.capture_started_at)>1 or count(distinct s.capture_completed_at)>1
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id and s.org_id=v_org_id
    where a.snapshot_id is not null
      and ((p_project_id is null and s.scope_kind='company' and s.project_id is null)
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
        and ((p_project_id is null and s.scope_kind='company' and s.project_id is null)
          or (p_project_id is not null and s.scope_kind='project' and s.project_id=p_project_id))
    ), generation_row as (
      select * from candidates order by capture_completed_at desc,snapshot_id desc,id limit 1
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
        'snapshotId',g.snapshot_id,'sourceGeneration',g.source_generation,'asOf',g.capture_completed_at,
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
      select * from candidates order by capture_completed_at desc,snapshot_id desc,id limit 1
    ), selected as (
      select * from candidates where period_kind=p_period_kind and current_start=p_period_start
        and statement=p_statement and scope_kind=v_scope and project_id is not distinct from p_project_id
        and view_kind=p_view_kind limit 1
    )
    select jsonb_build_object(
      'state',case when selected.id is null then 'unavailable' else 'complete' end,
      'companyLabel',(select company_label from availability limit 1),
      'generation',case when g.snapshot_id is null then null else jsonb_build_object(
        'snapshotId',g.snapshot_id,'sourceGeneration',g.source_generation,'asOf',g.capture_completed_at,
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

revoke all on function public.get_financial_statement_catalogue(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_financial_statement(text,date,text,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_financial_statement_catalogue(uuid) to authenticated;
grant execute on function public.get_financial_statement(text,date,text,uuid,text,boolean) to authenticated;

-- Ledger reference diagnostics request a replay without changing native report status.
create or replace function public.mark_erp_statement_replay_for_missing_accounts(p_org_id uuid, p_company text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare missing boolean;
begin
  select exists (
    select 1
      from public.erp_gl_entry_mirror gl
     where gl.org_id = p_org_id
       and gl.company = p_company
       and not coalesce(gl.is_cancelled, false)
       and not exists (
         select 1 from public.erp_account_mirror a
          where a.org_id = gl.org_id
            and a.company = gl.company
            and a.erp_name = gl.account
       )
  ) into missing;

  if missing then
    update public.external_org_bindings
       set statement_full_ledger_replay_needed = true
     where org_id = p_org_id and external_tier = 'erpnext';
  end if;
  return missing;
end;
$$;
revoke execute on function public.mark_erp_statement_replay_for_missing_accounts(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_erp_statement_replay_for_missing_accounts(uuid, text) to service_role;
