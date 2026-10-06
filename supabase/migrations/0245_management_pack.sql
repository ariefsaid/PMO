-- 0245_management_pack.sql — #765 monthly management pack (ADR-0076, DD-MMP-1..6).
-- Adds: project_progress_entries (a project's month-end percent complete, a management ESTIMATE — never pushed
-- to any external system), its writer record_project_progress, the reader get_management_pack, the helpers
-- org_current_month / may_record_project_progress / stamp_project_progress_entry, and an (org_id, invoice_date)
-- index on sales_invoices. No SECURITY DEFINER anywhere: both RPCs run as the caller so RLS remains the
-- tenancy boundary. Reversible via supabase/migrations/rollback/0245_management_pack_down.sql.

-- §1 the table ─────────────────────────────────────────────────────────────────────────────────────
create table public.project_progress_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id   uuid not null references public.projects(id),
  month        date not null,
  -- `<= 100` is what rejects NaN: Postgres orders NaN above every number (0169/0188 lesson).
  pct_complete numeric(5,2) not null,
  note         text,
  -- WITNESS, never an input: stamped by project_progress_entries_stamp_entered, withheld from every grant.
  entered_by   uuid references public.profiles(id),
  entered_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint project_progress_entries_month_first check (month = date_trunc('month', month)::date),
  constraint project_progress_entries_pct_range check (pct_complete >= 0 and pct_complete <= 100),
  constraint project_progress_entries_note_len check (note is null or char_length(note) <= 500),
  constraint project_progress_entries_project_month_key unique (project_id, month)
);
create index project_progress_entries_org_project_month_idx
  on public.project_progress_entries (org_id, project_id, month);
create index project_progress_entries_entered_by_idx on public.project_progress_entries (entered_by);

comment on table public.project_progress_entries is
  '#765 / ADR-0076: a project''s cumulative percent complete at a month end. A management estimate that '
  'switches the project to progress-basis recognition in the management pack from that month. Never a ledger '
  'entry; never pushed to an external system.';

-- §2 stamps. 0074's org stamp (attached BY NAME, as every new table must) + the recorder witness.
create trigger project_progress_entries_stamp_org_id
  before insert on public.project_progress_entries
  for each row execute function public.stamp_org_id();

create or replace function public.stamp_project_progress_entry() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.entered_by := auth.uid();
  new.entered_at := now();
  return new;
end; $$;
revoke all on function public.stamp_project_progress_entry() from public, anon, authenticated;

create trigger project_progress_entries_stamp_entered
  before insert or update on public.project_progress_entries
  for each row execute function public.stamp_project_progress_entry();

-- §3 who may record (DD-MMP-4) — rank, not a role list (ADR-0070). INVOKER: the projects read is the
-- caller's own RLS, so a project in another org is simply not found.
create or replace function public.may_record_project_progress(p_project_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.org_id = public.auth_org_id()
       and (   public.holds_won_value_authority(public.auth_role())
            or (public.holds_pipeline_value_authority(public.auth_role())
                and p.project_manager_id = auth.uid())))
$$;
revoke all     on function public.may_record_project_progress(uuid) from public, anon;
grant  execute on function public.may_record_project_progress(uuid) to authenticated;

-- §4 RLS (FORCE per AC-LOW-1; is_active_member() conjoined explicitly — 0063's pass is not standing).
alter table public.project_progress_entries enable row level security;
alter table public.project_progress_entries force row level security;

create policy project_progress_entries_select on public.project_progress_entries for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy project_progress_entries_insert on public.project_progress_entries for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.may_record_project_progress(project_id));
create policy project_progress_entries_update on public.project_progress_entries for update
  using (org_id = public.auth_org_id() and public.is_active_member() and public.may_record_project_progress(project_id))
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.may_record_project_progress(project_id));
-- No DELETE policy and no DELETE grant: an estimate is corrected by re-recording, not removed.

-- §5 grants — column-level so the witness columns stay server-owned. Hosted Supabase grants ALL on new
-- public tables by default; revoke first or the column lists below are a silent no-op.
revoke all on public.project_progress_entries from anon, authenticated;
grant select on public.project_progress_entries to authenticated;
grant insert (project_id, month, pct_complete, note) on public.project_progress_entries to authenticated;
grant update (pct_complete, note) on public.project_progress_entries to authenticated;

-- §6 the org's current month (FR-MMP-002). Takes the instant as a parameter so pgTAP can pin it.
create or replace function public.org_current_month(p_timezone text, p_at timestamptz) returns date
  language sql stable set search_path = pg_catalog as $$
  select date_trunc('month', (p_at at time zone coalesce(p_timezone, 'UTC')))::date
$$;
revoke all     on function public.org_current_month(text, timestamptz) from public, anon;
grant  execute on function public.org_current_month(text, timestamptz) to authenticated;

-- §7 the writer: atomic upsert per (project, month). INVOKER — RLS + the column grants above still apply;
-- the explicit checks exist only to give the caller the RULE instead of a policy name.
create or replace function public.record_project_progress(
  p_project_id uuid, p_month date, p_pct_complete numeric, p_note text default null)
  returns void language plpgsql volatile set search_path = public as $$
begin
  if p_project_id is null or p_month is null or p_pct_complete is null then
    raise exception 'project, month and percent complete are required' using errcode = '23502';
  end if;
  if not (p_pct_complete >= 0 and p_pct_complete <= 100) then
    raise exception 'percent complete must be between 0 and 100' using errcode = '23514';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, p_pct_complete, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note;
end; $$;
revoke all     on function public.record_project_progress(uuid, date, numeric, text) from public, anon;
grant  execute on function public.record_project_progress(uuid, date, numeric, text) to authenticated;

-- §8 the reader. Returns FACTS; the series arithmetic lives in buildManagementPack (ADR-0076).
--   • invoice statuses = REVENUE_STATUSES (src/lib/db/revenue.ts) — a positive allow-list.
--   • net-of-tax CASE byte-identical to get_project_drawdown (0197 §3).
--   • on-hand list = ON_HAND_STATUSES (src/lib/db/projectTransitions.ts); keep the two in step.
create or replace function public.get_management_pack(p_from date default null, p_to date default null)
  returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_tz     text;
  v_cur    text;
  v_to     date;
  v_from   date;
  v_result jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC'), o.default_currency
    into v_tz, v_cur
    from public.organizations o where o.id = v_org;

  v_to   := coalesce(date_trunc('month', p_to)::date, public.org_current_month(v_tz, now()));
  v_from := coalesce(date_trunc('month', p_from)::date, date_trunc('year', v_to)::date);

  if v_from > v_to or v_from < (v_to - interval '23 months')::date then
    raise exception 'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it'
      using errcode = '22023';
  end if;

  with counted as (
    select si.project_id, si.currency,
           date_trunc('month', si.invoice_date)::date as month,
           case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net
      from public.sales_invoices si
     where si.org_id = v_org
       and si.status in ('Submitted', 'Unpaid', 'Paid')
       and si.amount is not null
       and si.invoice_date is not null
       and si.invoice_date < (v_to + interval '1 month')::date
  ),
  in_window as (
    select project_id, currency, month, sum(net) as net, count(*)::int as invoice_count
      from counted where month >= v_from
     group by project_id, currency, month
  ),
  before_window as (
    select project_id, currency, sum(net) as net
      from counted where month < v_from
     group by project_id, currency
  ),
  proj as (
    select p.id, p.name, p.pmo_project_number, p.code, p.status::text as status, p.currency,
           case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                else p.contract_value end as contract_net,
           p.start_date, p.end_date, p.project_manager_id, c.name as client_name
      from public.projects p
      left join public.companies c on c.id = p.client_id
     where p.org_id = v_org
       and (   (p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out') and p.archived_at is null)
            or exists (select 1 from in_window w where w.project_id = p.id))
  ),
  progress as (
    select e.project_id, e.month, e.pct_complete, e.entered_at, pr.full_name as entered_by_name
      from public.project_progress_entries e
      join proj on proj.id = e.project_id
      left join public.profiles pr on pr.id = e.entered_by
     where e.month <= v_to
       and (   e.month >= v_from
            or e.month = (select max(e2.month) from public.project_progress_entries e2
                           where e2.project_id = e.project_id and e2.month < v_from))
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'timezone', v_tz,
    'org_currency', v_cur,
    'undated_invoice_count', (select count(*)::int from public.sales_invoices si
                               where si.org_id = v_org and si.status in ('Submitted', 'Unpaid', 'Paid')
                                 and si.amount is not null and si.invoice_date is null),
    'projects', coalesce((select jsonb_agg(to_jsonb(x) order by x.name, x.id) from proj x), '[]'::jsonb),
    'invoiced', coalesce((select jsonb_agg(to_jsonb(w) order by w.month, w.project_id, w.currency)
                            from in_window w
                           where w.project_id is null or w.project_id in (select id from proj)), '[]'::jsonb),
    'invoiced_before', coalesce((select jsonb_agg(to_jsonb(b) order by b.project_id, b.currency)
                                   from before_window b
                                  where b.project_id is null or b.project_id in (select id from proj)), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(to_jsonb(g) order by g.project_id, g.month) from progress g), '[]'::jsonb)
  ) into v_result;

  return v_result;
end; $$;
revoke all     on function public.get_management_pack(date, date) from public, anon;
grant  execute on function public.get_management_pack(date, date) to authenticated;

-- §9 NFR-MMP-001: the pack scans invoices by org and date.
create index if not exists sales_invoices_org_invoice_date_idx on public.sales_invoices (org_id, invoice_date);
