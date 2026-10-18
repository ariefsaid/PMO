-- 0317 — fenced, atomic replacement of a complete financial-statement catalogue.
-- Rollback: rollback/0317_financial_statement_publisher_down.sql
create or replace function public.publish_erp_financial_statements(
  p_org_id uuid,
  p_company text,
  p_holder uuid,
  p_refresh_id uuid,
  p_as_of timestamptz,
  p_source_context jsonb,
  p_rows jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.erp_sweep_lock%rowtype;
  v_binding public.external_org_bindings%rowtype;
  v_metadata jsonb;
  v_project_map jsonb;
  v_binding_context jsonb;
  v_fingerprints jsonb;
  v_calendar_entry jsonb;
  v_row jsonb;
  v_periods jsonb;
  v_current jsonb;
  v_prior jsonb;
  v_payload jsonb;
  v_detail jsonb;
  v_safe_calendar jsonb;
  v_snapshot_id uuid := gen_random_uuid();
  v_start date;
  v_end date;
  v_activation timestamptz;
  v_current_start date;
  v_current_end date;
  v_prior_start date;
  v_prior_end date;
  v_expected_count integer;
  v_actual_count integer;
  v_chart_count integer;
  v_pairs integer;
  v_ord bigint;
  v_detail_ord bigint;
  v_stmt text;
  v_scope text;
  v_view text;
  v_period_kind text;
  v_project uuid;
  v_key text;
  v_parent text;
  v_depth integer;
  v_kind text;
  v_money jsonb;
  v_field text;
  v_previous_as_of timestamptz;
begin
  if p_org_id is null or p_company is null or btrim(p_company) = ''
     or p_holder is null or p_refresh_id is null or p_as_of is null then
    raise exception 'invalid publication identity' using errcode = '22023';
  end if;

  -- The existing per-org source lease is the publication fence. Lock it before the binding.
  select * into v_lock
    from public.erp_sweep_lock
   where org_id = p_org_id
   for update;
  if not found or v_lock.holder is distinct from p_holder
     or v_lock.locked_until <= clock_timestamp() then
    raise exception 'publication lease is not current' using errcode = '55000';
  end if;

  select * into v_binding
    from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'erpnext'
   for update;
  if not found or v_binding.activated_at is null or v_binding.version_major is distinct from 16
     or v_binding.config ->> 'company' is distinct from p_company
     or v_binding.statement_full_ledger_replay_needed
     or v_binding.statement_last_attempt_at is distinct from p_as_of then
    raise exception 'publication binding is not current' using errcode = '55000';
  end if;

  if jsonb_typeof(p_source_context) is distinct from 'object'
     or (p_source_context - array['metadata','project_map','binding','fingerprints']) <> '{}'::jsonb
     or not (p_source_context ?& array['metadata','project_map','binding','fingerprints']) then
    raise exception 'invalid source context' using errcode = '22023';
  end if;
  v_metadata := p_source_context -> 'metadata';
  v_project_map := p_source_context -> 'project_map';
  v_binding_context := p_source_context -> 'binding';
  v_fingerprints := p_source_context -> 'fingerprints';

  if jsonb_typeof(v_metadata) is distinct from 'object'
     or (v_metadata - array[
       'erpVersion','frappeVersion','currency','defaultFinanceBook','hasFinanceBooks','calendar',
       'currencyPrecision','floatPrecision','bsOpeningPrecision','roundingMethod','fractionUnits',
       'ignoreOpeningCheck','ignoreAccountClosingBalance'
     ]) <> '{}'::jsonb
     or not (v_metadata ?& array[
       'erpVersion','frappeVersion','currency','defaultFinanceBook','hasFinanceBooks','calendar',
       'currencyPrecision','floatPrecision','bsOpeningPrecision','roundingMethod','fractionUnits',
       'ignoreOpeningCheck','ignoreAccountClosingBalance'
     ])
     or jsonb_typeof(v_metadata -> 'erpVersion') is distinct from 'string'
     or v_metadata ->> 'erpVersion' <> '16.33.0'
     or jsonb_typeof(v_metadata -> 'frappeVersion') is distinct from 'string'
     or v_metadata ->> 'frappeVersion' <> '16.31.0'
     or jsonb_typeof(v_metadata -> 'currency') is distinct from 'string'
     or v_metadata ->> 'currency' <> 'IDR'
     or (jsonb_typeof(v_metadata -> 'defaultFinanceBook') is distinct from 'string'
         and jsonb_typeof(v_metadata -> 'defaultFinanceBook') is distinct from 'null')
     or jsonb_typeof(v_metadata -> 'hasFinanceBooks') is distinct from 'boolean'
     or jsonb_typeof(v_metadata -> 'currencyPrecision') is distinct from 'number'
     or (v_metadata ->> 'currencyPrecision') !~ '^(0|[1-9])$'
     or jsonb_typeof(v_metadata -> 'floatPrecision') is distinct from 'number'
     or (v_metadata ->> 'floatPrecision') !~ '^(0|[1-9])$'
     or jsonb_typeof(v_metadata -> 'bsOpeningPrecision') is distinct from 'number'
     or (v_metadata ->> 'bsOpeningPrecision') !~ '^(0|[1-9])$'
     or jsonb_typeof(v_metadata -> 'fractionUnits') is distinct from 'number'
     or (v_metadata ->> 'fractionUnits') !~ '^(0|[1-9][0-9]*)$'
     or jsonb_typeof(v_metadata -> 'roundingMethod') is distinct from 'string'
     or v_metadata ->> 'roundingMethod' not in (
       'Banker''s Rounding','Banker''s Rounding (legacy)','Commercial Rounding'
     )
     or jsonb_typeof(v_metadata -> 'ignoreOpeningCheck') is distinct from 'boolean'
     or jsonb_typeof(v_metadata -> 'ignoreAccountClosingBalance') is distinct from 'boolean'
     or jsonb_typeof(v_metadata -> 'calendar') is distinct from 'array'
     or jsonb_array_length(v_metadata -> 'calendar') = 0 then
    raise exception 'invalid statement metadata' using errcode = '22023';
  end if;

  if jsonb_typeof(v_binding_context) is distinct from 'object'
     or (v_binding_context - array['id','activated_at','version_major']) <> '{}'::jsonb
     or not (v_binding_context ?& array['id','activated_at','version_major'])
     or jsonb_typeof(v_binding_context -> 'id') is distinct from 'string'
     or jsonb_typeof(v_binding_context -> 'activated_at') is distinct from 'string'
     or (v_binding_context ->> 'activated_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
     or jsonb_typeof(v_binding_context -> 'version_major') is distinct from 'number'
     or (v_binding_context ->> 'version_major') !~ '^16$' then
    raise exception 'invalid binding context' using errcode = '22023';
  end if;
  begin
    v_activation := (v_binding_context ->> 'activated_at')::timestamptz;
  exception when others then
    raise exception 'invalid binding context' using errcode = '22023';
  end;
  if (v_binding_context ->> 'id')::uuid is distinct from v_binding.id
     or v_activation is distinct from v_binding.activated_at then
    raise exception 'binding context changed' using errcode = '55000';
  end if;

  if jsonb_typeof(v_fingerprints) is distinct from 'object'
     or (v_fingerprints - array['chart','metadata','binding']) <> '{}'::jsonb
     or not (v_fingerprints ?& array['chart','metadata','binding'])
     or jsonb_typeof(v_fingerprints -> 'chart') is distinct from 'string'
     or (v_fingerprints ->> 'chart') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(v_fingerprints -> 'metadata') is distinct from 'string'
     or (v_fingerprints ->> 'metadata') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(v_fingerprints -> 'binding') is distinct from 'string'
     or (v_fingerprints ->> 'binding') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid source fingerprints' using errcode = '22023';
  end if;

  if v_binding.config ? 'project_map' then
    v_project_map := v_binding.config -> 'project_map';
    if jsonb_typeof(v_project_map) is distinct from 'object' then
      raise exception 'invalid bound project map' using errcode = '22023';
    end if;
  else
    v_project_map := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_source_context -> 'project_map') is distinct from 'object'
     or p_source_context -> 'project_map' is distinct from v_project_map then
    raise exception 'bound project map changed' using errcode = '55000';
  end if;
  if exists (
    select 1 from jsonb_each(v_project_map) e
     where e.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(e.value) is distinct from 'string'
        or btrim(e.value #>> '{}') = ''
  ) or exists (
    select 1 from jsonb_each_text(v_project_map) e
     group by e.value having count(*) > 1
  ) or exists (
    select 1 from jsonb_each_text(v_project_map) e
     where not exists (select 1 from public.projects p where p.id = e.key::uuid and p.org_id = p_org_id)
  ) then
    raise exception 'invalid bound project map' using errcode = '22023';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'statement catalogue must be nonempty' using errcode = '22023';
  end if;

  select count(*) into v_chart_count
    from public.erp_account_mirror a
   where a.org_id = p_org_id and a.company = p_company;
  if v_chart_count = 0 or exists (
    select 1 from public.erp_account_mirror a
     where a.org_id = p_org_id and a.company = p_company
       and (a.refresh_id is distinct from p_refresh_id or a.as_of is distinct from p_as_of)
  ) or exists (
    select 1 from public.erp_account_mirror a
     where a.org_id = p_org_id and a.company = p_company
       and (btrim(a.erp_name) = '' or btrim(a.account_name) = '' or a.lft <= 0 or a.rgt <= a.lft
         or a.root_type not in ('Asset','Liability','Equity','Income','Expense')
         or a.report_type not in ('Balance Sheet','Profit and Loss')
         or a.report_type <> case when a.root_type in ('Asset','Liability','Equity') then 'Balance Sheet' else 'Profit and Loss' end)
  ) or exists (
    select 1 from public.erp_account_mirror a
    join public.erp_account_mirror p on p.org_id = a.org_id and p.company = a.company and p.erp_name = a.parent_account
    where a.org_id = p_org_id and a.company = p_company
      and (not p.is_group or p.root_type <> a.root_type or p.report_type <> a.report_type
        or p.lft >= a.lft or p.rgt <= a.rgt)
  ) or exists (
    select 1 from public.erp_account_mirror a
     where a.org_id = p_org_id and a.company = p_company and a.parent_account is not null
       and not exists (select 1 from public.erp_account_mirror p where p.org_id=a.org_id and p.company=a.company and p.erp_name=a.parent_account)
  ) or exists (
    select 1 from public.erp_account_mirror a
    join public.erp_account_mirror b on b.org_id=a.org_id and b.company=a.company and b.erp_name>a.erp_name
     where a.org_id=p_org_id and a.company=p_company
       and (a.lft=b.lft or a.lft=b.rgt or a.rgt=b.lft or a.rgt=b.rgt
         or (a.lft < b.lft and b.lft < a.rgt and a.rgt < b.rgt)
         or (b.lft < a.lft and a.lft < b.rgt and b.rgt < a.rgt))
  ) or exists (
    select 1
      from public.erp_account_mirror a
      join public.erp_account_mirror p
        on p.org_id=a.org_id and p.company=a.company and p.erp_name=a.parent_account
      join public.erp_account_mirror intermediate
        on intermediate.org_id=a.org_id and intermediate.company=a.company
       and intermediate.erp_name not in (a.erp_name,p.erp_name)
       and intermediate.lft>p.lft and intermediate.rgt<p.rgt
       and intermediate.lft<a.lft and intermediate.rgt>a.rgt
     where a.org_id=p_org_id and a.company=p_company
  ) or exists (
    select 1 from public.erp_account_mirror a
     where a.org_id=p_org_id and a.company=p_company
       and a.is_group is distinct from exists (
         select 1 from public.erp_account_mirror c
          where c.org_id=a.org_id and c.company=a.company and c.parent_account=a.erp_name
       )
  ) or exists (
    select 1 from public.erp_gl_entry_mirror gl
     where gl.org_id=p_org_id and gl.company=p_company and not coalesce(gl.is_cancelled,false)
       and not exists (select 1 from public.erp_account_mirror a where a.org_id=gl.org_id and a.company=gl.company and a.erp_name=gl.account)
  ) then
    raise exception 'statement account chart is not a complete valid generation' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.erp_account_mirror a
     where a.org_id=p_org_id and a.company=p_company and a.parent_account is null
       and exists (select 1 from public.erp_account_mirror b where b.org_id=a.org_id and b.company=a.company
          and b.erp_name<>a.erp_name and b.parent_account is null and b.lft>a.lft and b.rgt<a.rgt)
  ) then
    raise exception 'statement account chart roots overlap' using errcode = '55000';
  end if;

  drop table if exists pg_temp.pmo_fs_calendar;
  drop table if exists pg_temp.pmo_fs_candidate;
  drop table if exists pg_temp.pmo_fs_pair;
  drop table if exists pg_temp.pmo_fs_expected;
  drop table if exists pg_temp.pmo_fs_actual;
  drop table if exists pg_temp.pmo_fs_detail;
  create temporary table pmo_fs_calendar (
    name text primary key, start_date date not null unique, end_date date not null
  ) on commit drop;
  create temporary table pmo_fs_candidate (
    kind text not null, start_date date not null, end_date date not null,
    fiscal_year text not null, year_start date not null,
    primary key (kind,start_date,end_date)
  ) on commit drop;
  create temporary table pmo_fs_pair (
    kind text not null, current_start date not null, current_end date not null,
    current_fiscal_year text not null, current_year_start date not null,
    prior_start date not null, prior_end date not null,
    prior_fiscal_year text not null, prior_year_start date not null,
    periods jsonb not null,
    primary key (kind,current_start,current_end,prior_start,prior_end)
  ) on commit drop;
  create temporary table pmo_fs_expected (
    row_key text primary key, statement text not null, scope_kind text not null,
    project_id uuid, view_kind text not null, periods jsonb not null, filters jsonb
  ) on commit drop;
  create temporary table pmo_fs_actual (
    ord bigint primary key, row_key text not null unique, statement text not null,
    scope_kind text not null, project_id uuid, view_kind text not null,
    periods jsonb not null, filters jsonb, payload jsonb not null
  ) on commit drop;
  create temporary table pmo_fs_detail (
    envelope_ord bigint not null, row_ord bigint not null, row_key text not null,
    parent_key text, depth integer not null, kind text not null,
    account_name text not null, account_number text, current_value jsonb not null,
    prior_value jsonb not null,
    primary key (envelope_ord,row_key), unique (envelope_ord,row_ord)
  ) on commit drop;

  for v_calendar_entry in select value from jsonb_array_elements(v_metadata -> 'calendar') loop
    if jsonb_typeof(v_calendar_entry) is distinct from 'object'
       or (v_calendar_entry - array['name','start','end']) <> '{}'::jsonb
       or not (v_calendar_entry ?& array['name','start','end'])
       or jsonb_typeof(v_calendar_entry -> 'name') is distinct from 'string'
       or btrim(v_calendar_entry ->> 'name') = ''
       or jsonb_typeof(v_calendar_entry -> 'start') is distinct from 'string'
       or (v_calendar_entry ->> 'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(v_calendar_entry -> 'end') is distinct from 'string'
       or (v_calendar_entry ->> 'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid statement calendar entry' using errcode = '22023';
    end if;
    begin
      v_start := (v_calendar_entry ->> 'start')::date;
      v_end := (v_calendar_entry ->> 'end')::date;
    exception when others then
      raise exception 'invalid statement calendar date' using errcode = '22023';
    end;
    if to_char(v_start,'YYYY-MM-DD') <> v_calendar_entry ->> 'start'
       or to_char(v_end,'YYYY-MM-DD') <> v_calendar_entry ->> 'end'
       or extract(year from v_start) < 1 or extract(year from v_start) > 9999
       or extract(year from v_end) < 1 or extract(year from v_end) > 9999
       or extract(day from v_start) <> 1
       or v_end <> (v_start + interval '12 months' - interval '1 day')::date then
      raise exception 'invalid statement fiscal year range' using errcode = '22023';
    end if;
    insert into pg_temp.pmo_fs_calendar(name,start_date,end_date)
    values (v_calendar_entry ->> 'name',v_start,v_end);
  end loop;
  if exists (
    select 1 from pg_temp.pmo_fs_calendar a join pg_temp.pmo_fs_calendar b
      on a.name < b.name and a.start_date <= b.end_date and b.start_date <= a.end_date
  ) then
    raise exception 'overlapping statement fiscal years' using errcode = '22023';
  end if;

  insert into pg_temp.pmo_fs_candidate(kind,start_date,end_date,fiscal_year,year_start)
  select 'month', (fy.start_date + make_interval(months => m.month_offset))::date,
         ((fy.start_date + make_interval(months => m.month_offset + 1)) - interval '1 day')::date,
         fy.name, fy.start_date
    from pg_temp.pmo_fs_calendar fy cross join generate_series(0,11) as m(month_offset)
  union all
  select 'quarter', (fy.start_date + make_interval(months => q.month_offset))::date,
         ((fy.start_date + make_interval(months => q.month_offset + 3)) - interval '1 day')::date,
         fy.name, fy.start_date
    from pg_temp.pmo_fs_calendar fy cross join generate_series(0,9,3) as q(month_offset)
  union all
  select 'fiscal_year',fy.start_date,fy.end_date,fy.name,fy.start_date
    from pg_temp.pmo_fs_calendar fy;

  insert into pg_temp.pmo_fs_pair(
    kind,current_start,current_end,current_fiscal_year,current_year_start,
    prior_start,prior_end,prior_fiscal_year,prior_year_start,periods
  )
  select c.kind,c.start_date,c.end_date,c.fiscal_year,c.year_start,
         p.start_date,p.end_date,p.fiscal_year,p.year_start,
         jsonb_build_object(
           'kind',c.kind,
           'current',jsonb_build_object('start',c.start_date::text,'end',c.end_date::text,'fiscalYear',c.fiscal_year,'yearStart',c.year_start::text),
           'prior',jsonb_build_object('start',p.start_date::text,'end',p.end_date::text,'fiscalYear',p.fiscal_year,'yearStart',p.year_start::text)
         )
    from pg_temp.pmo_fs_candidate c
    join pg_temp.pmo_fs_candidate p
      on p.kind=c.kind
     and p.start_date=(c.start_date - make_interval(months => case c.kind when 'month' then 1 when 'quarter' then 3 else 12 end))::date
     and p.end_date=c.start_date - 1;
  select count(*) into v_pairs from pg_temp.pmo_fs_pair;
  if v_pairs = 0 then
    raise exception 'statement calendar has no supported comparison periods' using errcode = '22023';
  end if;

  with scopes(statement,scope_kind,project_id,view_kind,project_name) as (
    select s.statement,'company'::text,null::uuid,'account_breakdown'::text,null::text
      from (values ('trial_balance'),('profit_and_loss'),('balance_sheet')) s(statement)
    union all
    select 'profit_and_loss','unassigned',null::uuid,'account_breakdown',null::text
    union all
    select 'profit_and_loss','project',e.key::uuid,'account_breakdown',e.value
      from jsonb_each_text(v_project_map) e
    union all
    select 'profit_and_loss','project',e.key::uuid,'project_totals',e.value
      from jsonb_each_text(v_project_map) e
  ),
  enriched as (
    select s.*,p.*,
      case when s.scope_kind='project' then jsonb_build_array(s.project_name) else '[]'::jsonb end as projects
    from scopes s cross join pg_temp.pmo_fs_pair p
  ),
  filters as (
    select e.*,
      case when e.statement='trial_balance' then jsonb_build_object(
        'company',p_company,'finance_book','','presentation_currency','IDR','cost_center',to_jsonb(array[]::text[]),
        'include_default_book_entries',1,'project',e.projects,'fiscal_year',e.current_fiscal_year,
        'from_date',e.current_start::text,'to_date',e.current_end::text,
        'with_period_closing_entry_for_opening',1,'with_period_closing_entry_for_current_period',1,
        'show_group_accounts',1,'show_net_values',1,'show_zero_values',0,'show_unclosed_fy_pl_balances',0
      ) else jsonb_build_object(
        'company',p_company,'finance_book','','presentation_currency','IDR','cost_center',to_jsonb(array[]::text[]),
        'include_default_book_entries',1,'project',e.projects,'filter_based_on','Date Range',
        'period_start_date',e.current_start::text,'period_end_date',e.current_end::text,
        'from_fiscal_year',e.current_fiscal_year,'to_fiscal_year',e.current_fiscal_year,
        'periodicity',case e.kind when 'month' then 'Monthly' when 'quarter' then 'Quarterly' else 'Yearly' end,
        'accumulated_values',case when e.statement='balance_sheet' then 1 else 0 end,
        'selected_view','Report','report_template','','show_zero_values',0
      ) end as current_filter,
      case when e.statement='trial_balance' then jsonb_build_object(
        'company',p_company,'finance_book','','presentation_currency','IDR','cost_center',to_jsonb(array[]::text[]),
        'include_default_book_entries',1,'project',e.projects,'fiscal_year',e.prior_fiscal_year,
        'from_date',e.prior_start::text,'to_date',e.prior_end::text,
        'with_period_closing_entry_for_opening',1,'with_period_closing_entry_for_current_period',1,
        'show_group_accounts',1,'show_net_values',1,'show_zero_values',0,'show_unclosed_fy_pl_balances',0
      ) else jsonb_build_object(
        'company',p_company,'finance_book','','presentation_currency','IDR','cost_center',to_jsonb(array[]::text[]),
        'include_default_book_entries',1,'project',e.projects,'filter_based_on','Date Range',
        'period_start_date',e.prior_start::text,'period_end_date',e.prior_end::text,
        'from_fiscal_year',e.prior_fiscal_year,'to_fiscal_year',e.prior_fiscal_year,
        'periodicity',case e.kind when 'month' then 'Monthly' when 'quarter' then 'Quarterly' else 'Yearly' end,
        'accumulated_values',case when e.statement='balance_sheet' then 1 else 0 end,
        'selected_view','Report','report_template','','show_zero_values',0
      ) end as prior_filter
    from enriched e
  )
  insert into pg_temp.pmo_fs_expected(row_key,statement,scope_kind,project_id,view_kind,periods,filters)
  select statement||'|'||scope_kind||'|'||coalesce(project_id::text,'')||'|'||view_kind||'|'||kind||'|'||
         current_start::text||'|'||current_end::text||'|'||prior_start::text||'|'||prior_end::text,
         statement,scope_kind,project_id,view_kind,periods,
         case when view_kind='project_totals' then null else jsonb_build_object('current',current_filter,'prior',prior_filter) end
    from filters;

  select count(*) into v_expected_count from pg_temp.pmo_fs_expected;
  for v_row, v_ord in
    select value,ordinality from jsonb_array_elements(p_rows) with ordinality
  loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or (v_row - array['statement','scopeKind','projectId','viewKind','periods','hasActivity','payload','filters']) <> '{}'::jsonb
       or not (v_row ?& array['statement','scopeKind','projectId','viewKind','periods','hasActivity','payload','filters'])
       or jsonb_typeof(v_row -> 'statement') is distinct from 'string'
       or v_row ->> 'statement' not in ('trial_balance','profit_and_loss','balance_sheet')
       or jsonb_typeof(v_row -> 'scopeKind') is distinct from 'string'
       or v_row ->> 'scopeKind' not in ('company','project','unassigned')
       or jsonb_typeof(v_row -> 'viewKind') is distinct from 'string'
       or v_row ->> 'viewKind' not in ('account_breakdown','project_totals')
       or jsonb_typeof(v_row -> 'hasActivity') is distinct from 'boolean'
       or jsonb_typeof(v_row -> 'periods') is distinct from 'object'
       or ((v_row -> 'periods') - array['kind','current','prior']) <> '{}'::jsonb
       or not ((v_row -> 'periods') ?& array['kind','current','prior']) then
      raise exception 'invalid statement envelope' using errcode = '22023';
    end if;

    v_stmt := v_row ->> 'statement';
    v_scope := v_row ->> 'scopeKind';
    v_view := v_row ->> 'viewKind';
    v_periods := v_row -> 'periods';
    v_period_kind := v_periods ->> 'kind';
    if jsonb_typeof(v_periods -> 'kind') is distinct from 'string'
       or v_period_kind not in ('month','quarter','fiscal_year') then
      raise exception 'invalid statement period kind' using errcode = '22023';
    end if;
    v_current := v_periods -> 'current';
    v_prior := v_periods -> 'prior';
    if jsonb_typeof(v_current) is distinct from 'object'
       or (v_current - array['start','end','fiscalYear','yearStart']) <> '{}'::jsonb
       or not (v_current ?& array['start','end','fiscalYear','yearStart'])
       or jsonb_typeof(v_prior) is distinct from 'object'
       or (v_prior - array['start','end','fiscalYear','yearStart']) <> '{}'::jsonb
       or not (v_prior ?& array['start','end','fiscalYear','yearStart']) then
      raise exception 'invalid statement period columns' using errcode = '22023';
    end if;
    if jsonb_typeof(v_current -> 'start') is distinct from 'string'
       or jsonb_typeof(v_current -> 'end') is distinct from 'string'
       or jsonb_typeof(v_current -> 'fiscalYear') is distinct from 'string'
       or jsonb_typeof(v_current -> 'yearStart') is distinct from 'string'
       or jsonb_typeof(v_prior -> 'start') is distinct from 'string'
       or jsonb_typeof(v_prior -> 'end') is distinct from 'string'
       or jsonb_typeof(v_prior -> 'fiscalYear') is distinct from 'string'
       or jsonb_typeof(v_prior -> 'yearStart') is distinct from 'string'
       or (v_current ->> 'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_current ->> 'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_current ->> 'yearStart') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_prior ->> 'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_prior ->> 'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_prior ->> 'yearStart') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid statement period date' using errcode = '22023';
    end if;
    begin
      v_current_start := (v_current ->> 'start')::date;
      v_current_end := (v_current ->> 'end')::date;
      v_prior_start := (v_prior ->> 'start')::date;
      v_prior_end := (v_prior ->> 'end')::date;
    exception when others then
      raise exception 'invalid statement period date' using errcode = '22023';
    end;
    if to_char(v_current_start,'YYYY-MM-DD') <> v_current ->> 'start'
       or to_char(v_current_end,'YYYY-MM-DD') <> v_current ->> 'end'
       or to_char(v_prior_start,'YYYY-MM-DD') <> v_prior ->> 'start'
       or to_char(v_prior_end,'YYYY-MM-DD') <> v_prior ->> 'end' then
      raise exception 'invalid statement period date' using errcode = '22023';
    end if;

    v_project := null;
    if jsonb_typeof(v_row -> 'projectId') is distinct from 'null' then
      if jsonb_typeof(v_row -> 'projectId') is distinct from 'string'
         or (v_row ->> 'projectId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid statement project identity' using errcode = '22023';
      end if;
      v_project := (v_row ->> 'projectId')::uuid;
    end if;

    v_key := v_stmt||'|'||v_scope||'|'||coalesce(v_project::text,'')||'|'||v_view||'|'||v_period_kind||'|'||
             v_current_start::text||'|'||v_current_end::text||'|'||v_prior_start::text||'|'||v_prior_end::text;
    v_payload := v_row -> 'payload';
    if v_view='account_breakdown' then
      if jsonb_typeof(v_row -> 'filters') is distinct from 'object'
         or jsonb_typeof(v_payload) is distinct from 'object'
         or (v_payload - array['rows']) <> '{}'::jsonb
         or not (v_payload ? 'rows')
         or jsonb_typeof(v_payload -> 'rows') is distinct from 'array' then
        raise exception 'invalid detail payload' using errcode = '22023';
      end if;
    else
      if v_row -> 'filters' <> 'null'::jsonb
         or jsonb_typeof(v_payload) is distinct from 'object'
         or (v_payload - array['current','prior']) <> '{}'::jsonb
         or not (v_payload ?& array['current','prior'])
         or jsonb_typeof(v_payload -> 'current') is distinct from 'object'
         or ((v_payload -> 'current') - array['income','expense','net']) <> '{}'::jsonb
         or not ((v_payload -> 'current') ?& array['income','expense','net'])
         or jsonb_typeof(v_payload -> 'prior') is distinct from 'object'
         or ((v_payload -> 'prior') - array['income','expense','net']) <> '{}'::jsonb
         or not ((v_payload -> 'prior') ?& array['income','expense','net']) then
        raise exception 'invalid totals payload' using errcode = '22023';
      end if;
      foreach v_field in array array['income','expense','net'] loop
        if jsonb_typeof(v_payload -> 'current' -> v_field) is distinct from 'string'
           or (v_payload -> 'current' ->> v_field) !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$'
           or jsonb_typeof(v_payload -> 'prior' -> v_field) is distinct from 'string'
           or (v_payload -> 'prior' ->> v_field) !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then
          raise exception 'invalid totals money' using errcode = '22023';
        end if;
      end loop;
    end if;

    if exists (select 1 from pg_temp.pmo_fs_actual a where a.row_key=v_key) then
      raise exception 'duplicate statement envelope' using errcode = '22023';
    end if;
    insert into pg_temp.pmo_fs_actual(ord,row_key,statement,scope_kind,project_id,view_kind,periods,filters,payload)
    values (v_ord,v_key,v_stmt,v_scope,v_project,v_view,v_periods,
            case when v_row->'filters'='null'::jsonb then null else v_row->'filters' end,v_payload);

    if v_view='account_breakdown' then
      for v_detail, v_detail_ord in
        select value,ordinality from jsonb_array_elements(v_payload -> 'rows') with ordinality
      loop
        if jsonb_typeof(v_detail) is distinct from 'object'
           or (v_detail - array['key','parentKey','depth','accountName','accountNumber','kind','current','prior']) <> '{}'::jsonb
           or not (v_detail ?& array['key','parentKey','depth','accountName','accountNumber','kind','current','prior'])
           or jsonb_typeof(v_detail -> 'key') is distinct from 'string'
           or btrim(v_detail ->> 'key') = ''
           or (jsonb_typeof(v_detail -> 'parentKey') is distinct from 'string' and jsonb_typeof(v_detail -> 'parentKey') is distinct from 'null')
           or (jsonb_typeof(v_detail -> 'parentKey')='string' and btrim(v_detail ->> 'parentKey')='')
           or jsonb_typeof(v_detail -> 'depth') is distinct from 'number'
           or (v_detail ->> 'depth') !~ '^(0|[1-9][0-9]*)$'
           or (v_detail ->> 'depth')::numeric > 2147483647
           or jsonb_typeof(v_detail -> 'accountName') is distinct from 'string'
           or btrim(v_detail ->> 'accountName') = ''
           or (jsonb_typeof(v_detail -> 'accountNumber') is distinct from 'string' and jsonb_typeof(v_detail -> 'accountNumber') is distinct from 'null')
           or jsonb_typeof(v_detail -> 'kind') is distinct from 'string'
           or v_detail ->> 'kind' not in ('account','subtotal','total','provisional_profit','unclosed_profit') then
          raise exception 'invalid statement row' using errcode = '22023';
        end if;
        v_key := v_detail ->> 'key';
        v_parent := case when jsonb_typeof(v_detail -> 'parentKey')='null' then null else v_detail ->> 'parentKey' end;
        v_depth := (v_detail ->> 'depth')::integer;
        v_kind := v_detail ->> 'kind';
        if (v_stmt in ('trial_balance','profit_and_loss') and v_kind not in ('account','subtotal','total'))
           or (v_stmt='balance_sheet' and v_kind not in ('account','subtotal','total','provisional_profit','unclosed_profit')) then
          raise exception 'statement row kind is incompatible' using errcode = '22023';
        end if;

        foreach v_money in array array[v_detail -> 'current',v_detail -> 'prior'] loop
          if v_stmt='trial_balance' then
            if jsonb_typeof(v_money) is distinct from 'object'
               or (v_money - array['openingDebit','openingCredit','debit','credit','closingDebit','closingCredit']) <> '{}'::jsonb
               or not (v_money ?& array['openingDebit','openingCredit','debit','credit','closingDebit','closingCredit']) then
              raise exception 'invalid trial balance value' using errcode = '22023';
            end if;
            foreach v_field in array array['openingDebit','openingCredit','debit','credit','closingDebit','closingCredit'] loop
              if jsonb_typeof(v_money -> v_field) is distinct from 'string'
                 or (v_money ->> v_field) !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then
                raise exception 'invalid trial balance money' using errcode = '22023';
              end if;
            end loop;
          else
            if jsonb_typeof(v_money) is distinct from 'string'
               or (v_money #>> '{}') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then
              raise exception 'invalid statement money' using errcode = '22023';
            end if;
          end if;
        end loop;
        if v_kind='account' and not exists (
          select 1 from public.erp_account_mirror a
           where a.org_id=p_org_id and a.company=p_company and a.erp_name=v_detail->>'key'
             and a.account_name=v_detail->>'accountName'
             and a.account_number is not distinct from case when jsonb_typeof(v_detail->'accountNumber')='null' then null else v_detail->>'accountNumber' end
             and (v_stmt='trial_balance' or (v_stmt='profit_and_loss' and a.report_type='Profit and Loss')
               or (v_stmt='balance_sheet' and a.report_type='Balance Sheet'))
        ) then
          raise exception 'statement row account is not in the current chart' using errcode = '22023';
        end if;
        insert into pg_temp.pmo_fs_detail(
          envelope_ord,row_ord,row_key,parent_key,depth,kind,account_name,account_number,current_value,prior_value
        ) values (
          v_ord,v_detail_ord,v_detail->>'key',v_parent,v_depth,v_kind,v_detail->>'accountName',
          case when jsonb_typeof(v_detail->'accountNumber')='null' then null else v_detail->>'accountNumber' end,
          v_detail->'current',v_detail->'prior'
        );
      end loop;
    end if;
  end loop;

  select count(*) into v_actual_count from pg_temp.pmo_fs_actual;
  if v_actual_count <> v_expected_count
     or exists (
       select 1 from pg_temp.pmo_fs_actual a
       left join pg_temp.pmo_fs_expected e using (row_key)
       where e.row_key is null or a.statement is distinct from e.statement
          or a.scope_kind is distinct from e.scope_kind or a.project_id is distinct from e.project_id
          or a.view_kind is distinct from e.view_kind or a.periods is distinct from e.periods
          or a.filters is distinct from e.filters
     ) or exists (
       select 1 from pg_temp.pmo_fs_expected e
       left join pg_temp.pmo_fs_actual a using (row_key)
       where a.row_key is null
     ) then
    raise exception 'statement catalogue does not match complete supported scopes' using errcode = '22023';
  end if;

  if exists (
    select 1 from pg_temp.pmo_fs_detail d
     where (d.parent_key is null and d.depth <> 0)
        or (d.parent_key is not null and (d.depth = 0 or not exists (
          select 1 from pg_temp.pmo_fs_detail p
           where p.envelope_ord=d.envelope_ord and p.row_key=d.parent_key
             and p.row_ord < d.row_ord and p.depth=d.depth-1
        )))
  ) then
    raise exception 'statement row hierarchy is not ordered and complete' using errcode = '22023';
  end if;

  select max(as_of) into v_previous_as_of
    from public.erp_financial_statement_snapshot
   where org_id=p_org_id and company=p_company;
  if v_previous_as_of is not null and p_as_of <= v_previous_as_of then
    raise exception 'statement publication time is not newer' using errcode = '55000';
  end if;

  select jsonb_agg(jsonb_build_object('start',start_date::text,'end',end_date::text) order by start_date)
    into v_safe_calendar from pg_temp.pmo_fs_calendar;
  delete from public.erp_financial_statement_snapshot
   where org_id=p_org_id and company=p_company;

  insert into public.erp_financial_statement_snapshot(
    org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,
    period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,
    source_report,report_version,filters,settings,payload,has_activity,display_precision,display_rounding_method
  )
  select p_org_id,p_company,v_snapshot_id,p_refresh_id,a.statement,a.scope_kind,a.project_id,a.view_kind,
         a.periods->>'kind',(a.periods->'current'->>'start')::date,(a.periods->'current'->>'end')::date,
         (a.periods->'prior'->>'start')::date,(a.periods->'prior'->>'end')::date,'IDR',p_as_of,
         case when a.view_kind='project_totals' then null else
           case a.statement when 'trial_balance' then 'Trial Balance'
                when 'profit_and_loss' then 'Profit and Loss Statement' else 'Balance Sheet' end
         end,
         case when a.view_kind='project_totals' then null else '16.33.0' end,
         a.filters,case when a.view_kind='project_totals' then null else v_metadata end,a.payload,
         (select (raw_row->>'hasActivity')::boolean from jsonb_array_elements(p_rows) with ordinality j(raw_row,ordinality) where j.ordinality=a.ord),
         (v_metadata->>'currencyPrecision')::integer,v_metadata->>'roundingMethod'
    from pg_temp.pmo_fs_actual a
   order by a.ord;

  update public.external_org_bindings
     set statement_update_delayed=false,
         statement_calendar=v_safe_calendar
   where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';

  -- The final lease fence is checked after all writes; any failure rolls back the entire transaction.
  if not exists (
    select 1 from public.erp_sweep_lock l
     where l.org_id=p_org_id and l.holder=p_holder and l.locked_until>clock_timestamp()
  ) then
    raise exception 'publication lease expired during write' using errcode = '55000';
  end if;

  drop table pg_temp.pmo_fs_detail;
  drop table pg_temp.pmo_fs_actual;
  drop table pg_temp.pmo_fs_expected;
  drop table pg_temp.pmo_fs_pair;
  drop table pg_temp.pmo_fs_candidate;
  drop table pg_temp.pmo_fs_calendar;
end;
$$;

revoke all on function public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)
  to service_role;
