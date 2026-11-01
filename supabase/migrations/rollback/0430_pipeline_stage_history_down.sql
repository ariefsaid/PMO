-- 0430_pipeline_stage_history_down.sql — reverses 0430. Loses stage history; business rows untouched
-- (contract_date / decided_at keep whatever re-dates set them to; the audit trail keeps the old values).
begin;
drop trigger if exists projects_zy_stage_entry on public.projects;
drop function if exists public.import_project_stage_history(uuid, jsonb);
drop function if exists public.add_skipped_stage_entry(uuid, project_status, date);
drop function if exists public.redate_stage_entry(uuid, date);
drop function if exists public.stage_entry_set_date(uuid, date);
drop function if exists public.assert_stage_date_editor(uuid);
drop function if exists public.backfill_project_stage_entries(uuid);
drop function if exists public.project_stage_entry_append();
drop function if exists public.stage_entries_pull_back(uuid, numeric, date);
delete from public.record_history_config where entity_type = 'project_stage_entry';
delete from public.record_changes where entity_type = 'project_stage_entry';
drop table if exists public.project_stage_entries;
drop function if exists public.project_stage_entries_assert_order();
drop function if exists public.stage_org_date(uuid, timestamptz);
-- 0281's record_history_visible (no project_stage_entry arm), then 0385's two reads, verbatim:
create or replace function public.record_history_visible(p_entity_type text,p_entity_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public as $$
begin
 case p_entity_type
  when 'project' then return exists(select 1 from public.projects where id=p_entity_id);
  when 'budget_version' then return exists(select 1 from public.budget_versions where id=p_entity_id);
  when 'budget_line_item' then return exists(select 1 from public.budget_line_items where id=p_entity_id);
  when 'work_order' then return exists(select 1 from public.work_orders where id=p_entity_id);
  when 'procurement' then return exists(select 1 from public.procurements where id=p_entity_id);
  when 'purchase_request' then return exists(select 1 from public.purchase_requests where id=p_entity_id);
  when 'rfq' then return exists(select 1 from public.rfqs where id=p_entity_id);
  when 'purchase_order' then return exists(select 1 from public.purchase_orders where id=p_entity_id);
  when 'payment' then return exists(select 1 from public.payments where id=p_entity_id);
  when 'task' then return exists(select 1 from public.tasks where id=p_entity_id);
  when 'company' then return exists(select 1 from public.companies where id=p_entity_id);
  when 'contact' then return exists(select 1 from public.contacts where id=p_entity_id);
  when 'sales_invoice' then return exists(select 1 from public.sales_invoices where id=p_entity_id);
  when 'procurement_invoice' then return exists(select 1 from public.procurement_invoices where id=p_entity_id);
  when 'vendor_withholding_slip' then return exists(select 1 from public.vendor_withholding_slips where id=p_entity_id);
  when 'vendor_withholding_slip_bill' then return exists(select 1 from public.vendor_withholding_slip_bills where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;
create or replace function public.get_win_rate(p_from date default null, p_to date default null)
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with decided as (
    -- Keep the existing decided_at contract byte-for-byte: all-time includes undated outcomes,
    -- while a bounded window requires a decision date.
    select status, contract_value, currency from projects
    where ((p_from is null and p_to is null) or decided_at is not null)
      and (p_from is null or decided_at >= p_from)
      and (p_to   is null or decided_at <  (p_to + 1)::timestamptz)
  ),
  agg as (
    select
      count(*) filter (where status::text = any(on_hand_project_statuses())) as wins_count,
      count(*) filter (where status = 'Loss Tender') as losses_count,
      count(*) filter (where status = 'Declined') as declined_count
    from decided
  ),
  currency_agg as (
    select currency,
      coalesce(sum(contract_value) filter (where status::text = any(on_hand_project_statuses())), 0) as wins_value,
      coalesce(sum(contract_value) filter (where status = 'Loss Tender'), 0) as losses_value
    from decided
    group by currency
  ),
  value_totals as (
    select count(*) as currency_count,
      coalesce(sum(wins_value), 0) as wins_value,
      coalesce(sum(losses_value), 0) as losses_value,
      coalesce(json_agg(json_build_object(
        'currency', currency,
        'wins_value', wins_value,
        'losses_value', losses_value,
        'win_rate_value', case when wins_value + losses_value > 0
          then wins_value / (wins_value + losses_value) else null end
      ) order by currency), '[]'::json) as value_by_currency
    from currency_agg
  ),
  current_open as (
    select p.id, p.org_id, p.status, p.created_at, p.contract_value, p.currency,
      coalesce(stage_change.changed_at, p.created_at) as stage_started_at
    from projects p
    left join lateral (
      select rc.created_at as changed_at
      from record_changes rc
      where rc.org_id = p.org_id
        and rc.entity_type = 'project'
        and rc.entity_id = p.id
        and rc.op = 'update'
        and rc.changes ? 'status'
      order by rc.seq desc
      limit 1
    ) stage_change on true
    where p.status::text = any(pipeline_project_statuses())
      and p.archived_at is null
  ),
  period_open as (
    select * from current_open
    where (p_from is null or created_at >= p_from::timestamptz)
      and (p_to is null or created_at < (p_to + 1)::timestamptz)
  ),
  -- Open cohort count follows the selected creation period; stale remains a present-day pipeline total.
  open_totals as (
    select (select count(*) from period_open) as open_count,
      count(*) filter (where stage_started_at <= now() - interval '90 days') as stale_count
    from current_open
  ),
  bid_currency_rows as (
    select currency,
      count(*) filter (where status::text = any(on_hand_project_statuses())) as wins_count,
      count(*) filter (where status = 'Loss Tender') as losses_count,
      0::bigint as open_count,
      coalesce(sum(contract_value) filter (where status::text = any(on_hand_project_statuses())), 0) as wins_value,
      coalesce(sum(contract_value) filter (where status = 'Loss Tender'), 0) as losses_value,
      0::numeric as open_value
    from decided
    where status::text = any(on_hand_project_statuses()) or status = 'Loss Tender'
    group by currency
    union all
    select currency, 0::bigint, 0::bigint, count(*), 0::numeric, 0::numeric,
      coalesce(sum(contract_value), 0)
    from period_open
    group by currency
  ),
  bid_currency as (
    select currency,
      sum(wins_count)::int as wins_count,
      sum(losses_count)::int as losses_count,
      sum(open_count)::int as open_count,
      sum(wins_value) as wins_value,
      sum(losses_value) as losses_value,
      sum(open_value) as open_value
    from bid_currency_rows
    group by currency
  )
  select json_build_object(
    'wins_count', agg.wins_count,
    'losses_count', agg.losses_count,
    'declined_count', agg.declined_count,
    'wins_value', case when value_totals.currency_count = 1 then value_totals.wins_value else null end,
    'losses_value', case when value_totals.currency_count = 1 then value_totals.losses_value else null end,
    'win_rate_count', case when agg.wins_count + agg.losses_count > 0
        then agg.wins_count::numeric / (agg.wins_count + agg.losses_count) else 0 end,
    'win_rate_value', case
      when value_totals.currency_count <> 1 then null
      when value_totals.wins_value + value_totals.losses_value > 0
        then value_totals.wins_value / (value_totals.wins_value + value_totals.losses_value)
      else 0 end,
    'value_by_currency', value_totals.value_by_currency,
    'open_count', open_totals.open_count,
    'stale_count', open_totals.stale_count,
    'bids_by_currency', coalesce((
      select json_agg(json_build_object(
        'currency', currency,
        'wins_count', wins_count,
        'losses_count', losses_count,
        'open_count', open_count,
        'wins_value', wins_value,
        'losses_value', losses_value,
        'open_value', open_value
      ) order by currency)
      from bid_currency
    ), '[]'::json)
  )
  from agg cross join value_totals cross join open_totals;
$$;

create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.short_name,
      p.code,
      p.pmo_project_number,
      p.service_line,p.sector,p.location,p.award_type,p.bidding_entity,
      p.client_id,
      p.end_client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.tax_treatment,
      p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
      p.last_update,
      p.project_manager_id,
      coalesce(stage_change.changed_at, p.created_at) as stage_started_at,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    left join lateral (
      select rc.created_at as changed_at
      from record_changes rc
      where rc.org_id = p.org_id
        and rc.entity_type = 'project'
        and rc.entity_id = p.id
        and rc.op = 'update'
        and rc.changes ? 'status'
      order by rc.seq desc
      limit 1
    ) stage_change on true
    where p.status::text = any(pipeline_project_statuses())
      and p.archived_at is null
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',              pl.id,
          'name',            pl.name,
          'short_name',      pl.short_name,
          'code',            pl.code,
          'pmo_project_number', pl.pmo_project_number,
          'service_line', pl.service_line,
          'sector', pl.sector,
          'location', pl.location,
          'award_type', pl.award_type,
          'bidding_entity', pl.bidding_entity,
          'client_name',     coalesce(nullif(btrim(co.short_name), ''), co.name),
          'client_legal_name', co.name,
          'end_client_id',   pl.end_client_id,
          'end_client_name', coalesce(nullif(btrim(ec.short_name), ''), ec.name),
          'end_client_legal_name', ec.name,
          'status',          pl.status,
          'contract_value',  pl.contract_value,
          'currency',        pl.currency,
          'tax_treatment',   pl.tax_treatment,
          'tax_rate', pl.tax_rate,
          'tax_base_numerator', pl.tax_base_numerator,
          'tax_base_denominator', pl.tax_base_denominator,
          'win_probability', pl.win_prob,
          'last_update',     pl.last_update,
          'stage_started_at', pl.stage_started_at,
          'pm_name',         pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join companies ec on ec.id = pl.end_client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

revoke all on function public.get_sales_pipeline() from public, anon;
grant execute on function public.get_sales_pipeline() to authenticated;

comment on function public.get_win_rate(date, date) is
  'Decided bids use decided_at; open bids use created_at for period conversion and current stage age for staleness. Security invoker reads remain RLS scoped.';
comment on function public.get_sales_pipeline() is
  'Open project rows include stage_started_at from the latest status-change record, falling back to created_at. Security invoker reads remain RLS scoped.';

notify pgrst, 'reload schema';
commit;
