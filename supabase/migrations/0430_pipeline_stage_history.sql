-- 0430_pipeline_stage_history.sql — #1638 CRM-grade pipeline stage history.
-- Spec: docs/specs/pipeline-stage-history.spec.md · Plan: docs/plans/2026-11-01-pipeline-stage-history.md
-- §1 table + RLS + grants · §2 ordering constraint + append trigger · §3 correction RPCs · §4 import RPC
-- §5 audit registration · §6 stage age reads (0385 bodies, lateral swapped) · §7 backfill · §8 self-assertion
-- transition_project (0236) is NOT modified (NFR-PSH-002).
-- Reversibility: rollback/0430_pipeline_stage_history_down.sql.

-- §1 ─────────────────────────────────────────────────────────────────────────────────────────────
create table public.project_stage_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  project_id  uuid not null references public.projects(id) on delete cascade,
  stage       project_status not null,
  entered_on  date not null,
  position    numeric not null,
  source      text not null check (source in ('origination','transition','added','import','backfill')),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  redated_at  timestamptz,
  unique (project_id, position)
);
create index project_stage_entries_project_idx on public.project_stage_entries (project_id, position desc);
comment on table public.project_stage_entries is
  '#1638: one row per stage a deal entered; entered_on is the stage key date. Written only by the projects '
  'trigger and the stage RPCs; ordering rule enforced by project_stage_entries_order.';

alter table public.project_stage_entries enable row level security;
alter table public.project_stage_entries force row level security;
create policy project_stage_entries_select on public.project_stage_entries
  for select to authenticated
  using (org_id = public.auth_org_id()
         and public.is_active_member()
         and exists (select 1 from public.projects p where p.id = project_stage_entries.project_id));
revoke all on table public.project_stage_entries from public, anon, authenticated;
grant select on table public.project_stage_entries to authenticated;
-- 0137_service_role_grants: every public base table keeps service_role DML (e2e fixtures use it).
grant select, insert, update, delete on table public.project_stage_entries to service_role;

-- A timestamp's calendar day in the org's timezone (mirrors native_org_today, 0275:113).
create or replace function public.stage_org_date(p_org uuid, p_at timestamptz) returns date
  language sql stable set search_path = public as $$
  select (p_at at time zone coalesce(
            (select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date
$$;
revoke all on function public.stage_org_date(uuid, timestamptz) from public, anon, authenticated;

-- §2 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.project_stage_entries_assert_order() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from (
      select entered_on, lag(entered_on) over (order by position) as prev_on
      from public.project_stage_entries where project_id = new.project_id
    ) s
    where s.prev_on is not null and s.entered_on < s.prev_on        -- mut:order
  ) then
    raise exception 'a stage date cannot be earlier than the stage before it in the journey'
      using errcode = '23514';
  end if;
  return null;
end; $$;
revoke all on function public.project_stage_entries_assert_order() from public, anon, authenticated;
create constraint trigger project_stage_entries_order
  after insert or update of entered_on, position on public.project_stage_entries
  deferrable initially immediate
  for each row execute function public.project_stage_entries_assert_order();

-- Spec FR-PSH-004a / plan D5a: before a key date (contract date, decision date) lands on an entry, move back
-- every EARLIER entry dated after it that the system dated; refuse if a person dated one of them.
create or replace function public.stage_entries_pull_back(p_project_id uuid, p_before numeric, p_on date)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.project_stage_entries e
              where e.project_id = p_project_id and e.position < p_before and e.entered_on > p_on
                and (e.redated_at is not null or e.source in ('added','import'))) then   -- mut:pullback_person
    raise exception 'an earlier stage date set by a person is after %; change that stage date first', p_on
      using errcode = '23514';
  end if;
  update public.project_stage_entries e set entered_on = p_on, redated_at = now()
   where e.project_id = p_project_id and e.position < p_before and e.entered_on > p_on;
end; $$;
revoke all on function public.stage_entries_pull_back(uuid, numeric, date) from public, anon, authenticated, service_role;

create or replace function public.project_stage_entry_append() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_on  date;
  v_pos numeric;
  v_key public.project_stage_entries;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    -- Key dates changed without a move (seed.sql sets contract_date/decided_at AFTER inserting a won/lost
    -- row; seed.sql:310-314; stage_entry_set_date §3). Keep Signed = contract_date and the current
    -- Lost/Declined entry = decided_at.
    if new.contract_date is distinct from old.contract_date and new.contract_date is not null then
      select * into v_key from public.project_stage_entries
       where project_id = new.id and stage = 'Won, Pending KoM' order by position desc limit 1;
      if v_key.id is not null and v_key.entered_on is distinct from new.contract_date then
        perform public.stage_entries_pull_back(new.id, v_key.position, new.contract_date);
        update public.project_stage_entries set entered_on = new.contract_date where id = v_key.id;
      end if;
    end if;
    if new.decided_at is distinct from old.decided_at and new.decided_at is not null
       and new.status in ('Loss Tender','Declined') then
      select * into v_key from public.project_stage_entries
       where project_id = new.id order by position desc limit 1;
      v_on := public.stage_org_date(new.org_id, new.decided_at);
      if v_key.stage = new.status and v_key.entered_on is distinct from v_on then
        perform public.stage_entries_pull_back(new.id, v_key.position, v_on);
        update public.project_stage_entries set entered_on = v_on where id = v_key.id;
      end if;
    end if;
    return null;
  end if;
  v_on := case
    when new.status = 'Won, Pending KoM' and new.contract_date is not null then new.contract_date
    when new.status in ('Loss Tender','Declined') and new.decided_at is not null
      then public.stage_org_date(new.org_id, new.decided_at)
    when tg_op = 'INSERT' then public.stage_org_date(new.org_id, coalesce(new.created_at, now()))
    else public.stage_org_date(new.org_id, now())
  end;
  select coalesce(max(position), 0) + 1 into v_pos
    from public.project_stage_entries where project_id = new.id;
  -- A win's contract date (or a decision date) can precede entries the system dated today (spec T17).
  perform public.stage_entries_pull_back(new.id, v_pos, v_on);
  insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
  values (new.org_id, new.id, new.status, v_on, v_pos,
          case when tg_op = 'INSERT' then 'origination' else 'transition' end, auth.uid());
  return null;
end; $$;
revoke all on function public.project_stage_entry_append() from public, anon, authenticated;
-- Created BEFORE the §7 backfill: CREATE TRIGGER locks projects against writes until commit, so no
-- project can appear between the backfill snapshot and the trigger. AFTER triggers fire in name order, so
-- `projects_zy_…` runs before the project's own `projects_zz_record_change`.
create trigger projects_zy_stage_entry
  after insert or update of status, contract_date, decided_at on public.projects
  for each row execute function public.project_stage_entry_append();

-- §3 ─────────────────────────────────────────────────────────────────────────────────────────────
-- Spec OQ-PSH-2: "Project admin and above, including PMs" = role rank >= Project Manager (20).
create or replace function public.assert_stage_date_editor(p_org uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if p_org is distinct from public.auth_org_id()                                   -- mut:editor_org
     or not public.is_active_member()                                              -- mut:editor_active
     or not coalesce(public.role_rank(public.auth_role()) >= 20, false) then       -- mut:editor_rank
    raise exception 'not authorized' using errcode = '42501';
  end if;
end; $$;
revoke all on function public.assert_stage_date_editor(uuid) from public, anon, authenticated, service_role;

-- The one place an entry's date changes; syncs the project's key dates (FR-PSH-009). No gate: callers gate.
create or replace function public.stage_entry_set_date(p_entry_id uuid, p_entered_on date)
  returns public.project_stage_entries
  language plpgsql security definer set search_path = public as $$
declare
  e       public.project_stage_entries;
  v_last  boolean;
  v_status project_status;
  v_project uuid;
begin
  -- Lock order = transition_project's: the project row first, then the entry. The project lock serialises
  -- every journey write, so the ordering check below never runs against a neighbour another transaction
  -- is changing (plan D7).
  select project_id into v_project from public.project_stage_entries where id = p_entry_id;
  if v_project is null then
    raise exception 'stage entry not found' using errcode = 'P0002';
  end if;
  select status into v_status from public.projects where id = v_project for update;
  select * into e from public.project_stage_entries where id = p_entry_id for update;
  if p_entered_on is null or p_entered_on > public.native_org_today(e.org_id) then      -- mut:future
    raise exception 'a stage date cannot be in the future' using errcode = '23514';
  end if;
  update public.project_stage_entries
     set entered_on = p_entered_on, redated_at = now()
   where id = e.id;                                   -- project_stage_entries_order checks the neighbours
  v_last := not exists (select 1 from public.project_stage_entries x
                         where x.project_id = e.project_id and x.position > e.position);
  if e.stage = 'Won, Pending KoM' then
    update public.projects
       set contract_date = p_entered_on, decided_at = p_entered_on::timestamptz, last_update = now()
     where id = e.project_id;
  elsif e.stage in ('Loss Tender','Declined') and v_last and v_status = e.stage then
    -- Local midnight, so stage_org_date(decided_at) gives back exactly p_entered_on in every timezone.
    update public.projects
       set decided_at = p_entered_on::timestamp at time zone coalesce(
             (select o.default_timezone from public.organizations o where o.id = e.org_id), 'UTC'),
           last_update = now()
     where id = e.project_id;
  end if;
  return e;   -- the row as it was BEFORE the change (callers audit old -> new)
end; $$;
revoke all on function public.stage_entry_set_date(uuid, date) from public, anon, authenticated, service_role;

create or replace function public.redate_stage_entry(p_entry_id uuid, p_entered_on date) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  old   public.project_stage_entries;
begin
  select org_id into v_org from public.project_stage_entries where id = p_entry_id;
  if v_org is null then
    raise exception 'stage entry not found' using errcode = 'P0002';
  end if;
  perform public.assert_stage_date_editor(v_org);
  old := public.stage_entry_set_date(p_entry_id, p_entered_on);
  perform public.log_audit('project.stage_entry.redate', v_org, auth.uid(), old.project_id,
    jsonb_build_object('entry_id', old.id, 'stage', old.stage::text,
                       'from', old.entered_on, 'to', p_entered_on));
end; $$;

create or replace function public.add_skipped_stage_entry(
  p_before_entry_id uuid, p_stage project_status, p_entered_on date) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  nxt   public.project_stage_entries;
  v_prev numeric;
  v_id   uuid;
begin
  select * into nxt from public.project_stage_entries where id = p_before_entry_id;
  if nxt.id is null then
    raise exception 'stage entry not found' using errcode = 'P0002';
  end if;
  perform public.assert_stage_date_editor(nxt.org_id);
  perform 1 from public.projects where id = nxt.project_id for update;          -- serialize journey edits
  if p_stage::text <> all(public.pipeline_project_statuses()) then             -- mut:preaward
    raise exception 'only a pre-award stage can be added to the history' using errcode = 'P0001';
  end if;
  if p_entered_on is null or p_entered_on > public.native_org_today(nxt.org_id) then
    raise exception 'a stage date cannot be in the future' using errcode = '23514';
  end if;
  select coalesce(max(position), 0) into v_prev from public.project_stage_entries
   where project_id = nxt.project_id and position < nxt.position;
  insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
  values (nxt.org_id, nxt.project_id, p_stage, p_entered_on, (v_prev + nxt.position) / 2, 'added', auth.uid())
  returning id into v_id;                                        -- project_stage_entries_order checks both sides
  perform public.log_audit('project.stage_entry.add', nxt.org_id, auth.uid(), nxt.project_id,
    jsonb_build_object('entry_id', v_id, 'stage', p_stage::text, 'entered_on', p_entered_on,
                       'before_entry_id', nxt.id));
  return v_id;
end; $$;

-- §4 ─────────────────────────────────────────────────────────────────────────────────────────────
-- p_entries: [{stage, entered_on}] in canonical order; an optional first {"stage":"Leads"} dates the lead.
-- It writes THROUGH the §2 trigger (no off switch): every stage but the last is inserted directly, the last one
-- is appended by the trigger when the status moves, then dated.
create or replace function public.import_project_stage_history(p_project_id uuid, p_entries jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_status project_status;
  v_count  int;
  v_n      int := jsonb_array_length(coalesce(p_entries, '[]'::jsonb));
  v_i      int := 0;
  v_idx    int;
  v_prev   int := 0;
  v_stage  project_status;
  v_on     date;
  v_lead   uuid;
  v_last   project_status;
  x        jsonb;
begin
  select org_id, status into v_org, v_status from public.projects where id = p_project_id for update;
  if v_org is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  perform public.assert_stage_date_editor(v_org);
  select count(*) into v_count from public.project_stage_entries where project_id = p_project_id;
  if v_status <> 'Leads' or v_count <> 1 then                         -- idempotent: only a fresh Leads row
    raise exception 'stage history can be imported only into a new lead' using errcode = 'P0001';
  end if;
  select id into v_lead from public.project_stage_entries where project_id = p_project_id;
  for x in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_idx := array_position(public.pipeline_project_statuses(), x ->> 'stage');
    if v_idx is null or v_idx <= v_prev then                           -- pre-award only, canonical order
      raise exception 'imported stage % is not a pre-award stage in journey order', x ->> 'stage' using errcode = 'P0001';
    end if;
    v_prev  := v_idx;
    v_stage := (x ->> 'stage')::project_status;
    v_on    := (x ->> 'entered_on')::date;
    if v_on is null or v_on > public.native_org_today(v_org) then
      raise exception 'a stage date cannot be in the future' using errcode = '23514';
    end if;
    if v_i = 1 then
      -- The lead: its own date when given, else no later than the first imported date (spec FR-PSH-020).
      update public.project_stage_entries
         set entered_on = case when v_stage = 'Leads' then v_on else least(entered_on, v_on) end
       where id = v_lead;
    end if;
    continue when v_stage = 'Leads';
    if v_i < v_n then
      insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by)
      select v_org, p_project_id, v_stage, v_on, max(position) + 1, 'import', auth.uid()
        from public.project_stage_entries where project_id = p_project_id;
    else
      -- Pre-award stages carry no SoD; the move is an editor's and goes on the audit trail below. The trigger
      -- appends the entry dated today; date it and mark it imported.
      update public.projects set status = v_stage, last_update = now() where id = p_project_id;
      update public.project_stage_entries set entered_on = v_on, source = 'import'
       where project_id = p_project_id
         and position = (select max(position) from public.project_stage_entries where project_id = p_project_id);
    end if;
    v_last := v_stage;
  end loop;
  if v_last is not null then
    perform public.log_audit('project.transition', v_org, auth.uid(), p_project_id,
      jsonb_build_object('from', 'Leads', 'to', v_last::text, 'source', 'import', 'entries', p_entries));
  end if;
end; $$;

-- §6 ─────────────────────────────────────────────────────────────────────────────────────────────
-- Stage age = the latest stage entry's business date (FR-PSH-015). 0385's two bodies verbatim; only the
-- stage_change lateral reads project_stage_entries instead of record_changes.
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
      select (e.entered_on::timestamp at time zone 'UTC') as changed_at
      from project_stage_entries e
      where e.project_id = p.id
      order by e.position desc
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
      select (e.entered_on::timestamp at time zone 'UTC') as changed_at
      from project_stage_entries e
      where e.project_id = p.id
      order by e.position desc
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
  'Decided bids use decided_at; open bids use created_at for period conversion and the latest project_stage_entries.entered_on (#1638) for staleness. Security invoker reads remain RLS scoped.';
comment on function public.get_sales_pipeline() is
  'Open project rows include stage_started_at = the latest project_stage_entries.entered_on (#1638) at UTC midnight, falling back to created_at. Security invoker reads remain RLS scoped.';

notify pgrst, 'reload schema';

-- §7 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.backfill_project_stage_entries(p_project_id uuid default null) returns int
  language plpgsql security definer set search_path = public as $$
declare
  r   public.projects;
  v_n int := 0;
begin
  set constraints public.project_stage_entries_order deferred;
  for r in select p.* from public.projects p
            where (p_project_id is null or p.id = p_project_id)
              and not exists (select 1 from public.project_stage_entries e where e.project_id = p.id)
  loop
    insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source)
    select r.org_id, r.id,
           coalesce((select (rc.changes -> 'status' ->> 'old')::project_status
                       from public.record_changes rc
                      where rc.org_id = r.org_id and rc.entity_type = 'project' and rc.entity_id = r.id
                        and rc.op = 'update' and rc.changes ? 'status'
                      order by rc.seq limit 1), r.status),
           public.stage_org_date(r.org_id, r.created_at), 1, 'backfill';
    insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source, recorded_by, recorded_at)
    select r.org_id, r.id, (rc.changes -> 'status' ->> 'new')::project_status,
           public.stage_org_date(r.org_id, rc.created_at), 1 + row_number() over (order by rc.seq),
           'backfill', rc.actor_id, rc.created_at
      from public.record_changes rc
     where rc.org_id = r.org_id and rc.entity_type = 'project' and rc.entity_id = r.id
       and rc.op = 'update' and rc.changes ? 'status';
    -- Key dates (FR-PSH-004).
    update public.project_stage_entries e set entered_on = r.contract_date
     where e.project_id = r.id and e.stage = 'Won, Pending KoM' and r.contract_date is not null;
    if r.status in ('Loss Tender','Declined') and r.decided_at is not null then
      update public.project_stage_entries e set entered_on = public.stage_org_date(r.org_id, r.decided_at)
       where e.project_id = r.id
         and e.position = (select max(position) from public.project_stage_entries where project_id = r.id);
    end if;
    -- record_changes can miss a move (rows written before 0260 registered a column, or deleted by hand): end the
    -- journey at the current status so §8's invariant (latest entry = status) holds on every org's data.
    if (select e.stage from public.project_stage_entries e where e.project_id = r.id
         order by e.position desc limit 1) is distinct from r.status then
      insert into public.project_stage_entries (org_id, project_id, stage, entered_on, position, source)
      select r.org_id, r.id, r.status,
             case when r.status = 'Won, Pending KoM' and r.contract_date is not null then r.contract_date
                  when r.status in ('Loss Tender','Declined') and r.decided_at is not null
                    then public.stage_org_date(r.org_id, r.decided_at)
                  else public.stage_org_date(r.org_id, r.last_update) end,
             max(e.position) + 1, 'backfill'
        from public.project_stage_entries e where e.project_id = r.id;
    end if;
    -- Clamp backwards so dates never decrease along the journey (suffix minimum).
    update public.project_stage_entries e set entered_on = s.clamped
      from (select id, min(entered_on) over (order by position desc
                                              rows between unbounded preceding and current row) as clamped
              from public.project_stage_entries where project_id = r.id) s
     where e.id = s.id and e.entered_on <> s.clamped;
    v_n := v_n + 1;
  end loop;
  set constraints public.project_stage_entries_order immediate;
  return v_n;
end; $$;
revoke all on function public.backfill_project_stage_entries(uuid) from public, anon, authenticated;

select public.backfill_project_stage_entries();

-- §5 ─────────────────────────────────────────────────────────────────────────────────────────────
insert into public.record_history_config(entity_type,table_name,parent_type,parent_col,parent_via,captured,flag_cols,omit_cols) values
('project_stage_entry','project_stage_entries','project','project_id',null,
 '{"project_id":"ref","stage":"enum","entered_on":"date","source":"text","redated_at":"timestamp"}',
 '{}','{id,org_id,position,recorded_by,recorded_at}');
create trigger project_stage_entries_zz_record_change
  after insert or update on public.project_stage_entries
  for each row execute function public.record_change_capture();

-- The catalog gate (record_changes_catalog_gate.test.sql, AC-CHG-011) requires a visibility arm for every
-- registered entity. 0281's body verbatim plus one arm.
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
  when 'project_stage_entry' then return exists(select 1 from public.project_stage_entries where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;

-- §8 ─────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.redate_stage_entry(uuid, date) from public, anon;
revoke all on function public.add_skipped_stage_entry(uuid, project_status, date) from public, anon;
revoke all on function public.import_project_stage_history(uuid, jsonb) from public, anon;
revoke all on function public.project_stage_entries_assert_order() from service_role;
revoke all on function public.project_stage_entry_append() from service_role;
revoke all on function public.backfill_project_stage_entries(uuid) from service_role;
grant execute on function public.redate_stage_entry(uuid, date) to authenticated;
grant execute on function public.add_skipped_stage_entry(uuid, project_status, date) to authenticated;
grant execute on function public.import_project_stage_history(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from public.projects p
              where p.status is distinct from (select e.stage from public.project_stage_entries e
                                                where e.project_id = p.id order by e.position desc limit 1)) then
    raise exception '0430: a project''s latest stage entry does not match its status';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in
       ('projects_zy_stage_entry','project_stage_entries_order','project_stage_entries_zz_record_change')) <> 3 then
    raise exception '0430: stage history triggers missing';
  end if;
  if has_table_privilege('authenticated', 'public.project_stage_entries', 'INSERT')
     or has_table_privilege('authenticated', 'public.project_stage_entries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.project_stage_entries', 'DELETE') then
    raise exception '0430: clients must not write project_stage_entries directly';
  end if;
  if has_function_privilege('authenticated', 'public.backfill_project_stage_entries(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.stage_entry_set_date(uuid, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assert_stage_date_editor(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.stage_entries_pull_back(uuid, numeric, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.redate_stage_entry(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.add_skipped_stage_entry(uuid, project_status, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.import_project_stage_history(uuid, jsonb)', 'EXECUTE') then
    raise exception '0430: internal stage functions must not be client-callable';
  end if;
end $$;
