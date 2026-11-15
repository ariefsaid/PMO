-- #2282 — Issued material cost through the ledger feed. For an organisation whose inventory posts to Odoo the ERP ledger is the only
-- money source: the cost of issued material is Odoo's `picking_entry` analytic line (it has no journal item), mirrored here once.
-- PMO's stock document supplies the quantity and the work item, never an amount.
--
-- odoo_stock_cost_lines is a SIDE table, never rows in erp_gl_entry_mirror: every GL reader (statements, finance hub, the hourly
-- whole-ledger check) keeps reading GL only, so a real-time valuation's COGS journal line and this analytic line are never summed together.
-- Only the service-role feed writes it, through the definer functions below; no member (Admin included) can create or change a cost.
-- Members read quantities and ties from the table. Amounts reach a member through get_project_consumption (under stock_can_see_cost()) and, like every
-- other actual of the organisation, through the published actuals snapshot (erp_actuals_snapshot, any active member).
-- Rollback: supabase/migrations/rollback/0886_odoo_stock_cost_lines_down.sql
begin;

create table public.odoo_stock_cost_lines (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  analytic_line_id       bigint not null check (analytic_line_id > 0),
  company_id             integer not null,
  -- The project dimension, in the same text form as erp_gl_entry_mirror.project (the Odoo analytic account id).
  analytic_account_id    text check (analytic_account_id is null or analytic_account_id ~ '^[1-9][0-9]*$'),
  picking_ref            text check (picking_ref is null or length(picking_ref) between 1 and 200),
  odoo_picking_id        bigint,
  -- A return picking names the picking it returns (Odoo `return_id`); the tie follows it to the original document.
  odoo_return_of         bigint,
  odoo_product_id        bigint not null check (odoo_product_id > 0),
  unit_amount            numeric(14,3) not null,
  -- amount < 0 in Odoo is a cost: debit; > 0 (a return) is a credit. net = debit - credit.
  debit                  numeric(14,2) not null default 0 check (debit >= 0),
  credit                 numeric(14,2) not null default 0 check (credit >= 0),
  -- The GL account code the cost lands on (the analytic line's account, else the product's expense account).
  account                text,
  posting_date           date not null,
  fiscal_year            text,
  is_cancelled           boolean not null default false,
  -- The no-double-count check found a project-tagged journal line for the same stock move: stored, never counted.
  double_count_risk      boolean not null default false,
  source_write_date      text not null check (source_write_date ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'),
  census_seen_at         timestamptz,
  stock_document_id      uuid,
  stock_document_line_id uuid references public.stock_document_lines(id),
  tie_state              text not null check (tie_state in ('tied','return','no-document','ambiguous','pending')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (org_id, analytic_line_id),
  foreign key (org_id, stock_document_id) references public.stock_documents(org_id, id),
  check (tie_state not in ('tied','return') or (stock_document_id is not null and stock_document_line_id is not null)),
  check (tie_state <> 'no-document' or (stock_document_id is null and stock_document_line_id is null))
);
create index odoo_stock_cost_lines_project_idx on public.odoo_stock_cost_lines (org_id, analytic_account_id) where not is_cancelled;
create index odoo_stock_cost_lines_doc_idx on public.odoo_stock_cost_lines (org_id, stock_document_id) where stock_document_id is not null;
create index odoo_stock_cost_lines_untied_idx on public.odoo_stock_cost_lines (org_id) where tie_state in ('pending','no-document');

alter table public.odoo_stock_cost_lines enable row level security;
alter table public.odoo_stock_cost_lines force row level security;
create policy odoo_stock_cost_lines_select on public.odoo_stock_cost_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.odoo_stock_cost_lines from public, anon, authenticated, service_role;
-- Every column except the amounts: the cost is read only through get_project_consumption under the stock cost permission (the 0879 rule).
grant select (id, org_id, analytic_line_id, company_id, analytic_account_id, picking_ref, odoo_picking_id, odoo_return_of, odoo_product_id,
  unit_amount, account, posting_date, fiscal_year, is_cancelled, double_count_risk, source_write_date, census_seen_at, stock_document_id,
  stock_document_line_id, tie_state, created_at, updated_at) on public.odoo_stock_cost_lines to authenticated;
grant select on public.odoo_stock_cost_lines to service_role;

-- Analytic lines the running census has seen (the 0744 pattern, its own table so the two censuses never share a run).
create table public.odoo_stock_cost_census_seen (
  org_id  uuid not null references public.organizations(id) on delete cascade,
  run_at  timestamptz not null,
  line_id bigint not null,
  primary key (org_id, run_at, line_id)
);
alter table public.odoo_stock_cost_census_seen enable row level security;
alter table public.odoo_stock_cost_census_seen force row level security;
-- No policy and no grant: only the census definer functions (owner bypasses RLS) read or write it.
revoke all on public.odoo_stock_cost_census_seen from public, anon, authenticated, service_role;

-- The stock-cost comparison (Odoo's grouped analytic totals vs this table) and the no-double-count result. Kept apart from
-- odoo_ledger_checks so the GL check and every reader of it stay exactly as they are.
create table public.odoo_stock_cost_checks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  checked_at       timestamptz not null default clock_timestamp(),
  cutoff           timestamptz not null,
  status           text not null check (status in ('matches','differs','not-checked')),
  reason           text check (reason is null or length(reason) <= 200),
  accounts_checked integer not null default 0 check (accounts_checked >= 0),
  double_counts    integer not null default 0 check (double_counts >= 0),
  accounts         jsonb not null default '[]' check (jsonb_typeof(accounts) = 'array' and jsonb_array_length(accounts) <= 200),
  check ((status = 'not-checked') = (reason is not null))
);
create index odoo_stock_cost_checks_org_time_idx on public.odoo_stock_cost_checks (org_id, checked_at desc);
alter table public.odoo_stock_cost_checks enable row level security;
alter table public.odoo_stock_cost_checks force row level security;
create policy odoo_stock_cost_checks_select on public.odoo_stock_cost_checks for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Finance','Executive'));
revoke all on public.odoo_stock_cost_checks from public, anon, authenticated, service_role;
grant select on public.odoo_stock_cost_checks to authenticated;
grant select on public.odoo_stock_cost_checks to service_role;

-- The org's inventory ownership start: earlier analytic lines belong to the standalone epoch (their cost is in stock_ledger).
create function public.odoo_stock_cost_epoch(p_org_id uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select min((w.created_at at time zone coalesce(o.default_timezone, 'UTC'))::date)
    from public.external_domain_ownership w join public.organizations o on o.id = w.org_id
   where w.org_id = p_org_id and w.domain = 'inventory' and w.external_tier = 'odoo'
$$;
revoke all on function public.odoo_stock_cost_epoch(uuid) from public, anon, authenticated, service_role;

-- Resolves one analytic line to the PMO document and line, server-side: picking -> stock_erp_mirror (same org and company) -> document;
-- product -> the document's line through the stock item link (0880). Quantity and work item come from here, never an amount.
create function public.odoo_stock_cost_tie(p_org_id uuid, p_company integer, p_picking_id bigint, p_picking_ref text,
                                           p_product_id bigint, p_is_return boolean)
returns table (document_id uuid, line_id uuid, state text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_doc uuid; v_mirror_state text; v_lines uuid[];
begin
  select m.stock_document_id, m.state into v_doc, v_mirror_state from public.stock_erp_mirror m
   where m.org_id = p_org_id and m.company_id = p_company and m.external_tier = 'odoo' and m.external_model = 'stock.picking'
     and ((p_picking_id is not null and m.external_id = p_picking_id::text)
       or (p_picking_id is null and p_picking_ref is not null and m.external_reference = p_picking_ref))
   order by m.stock_document_id limit 1;
  if v_doc is null then return query select null::uuid, null::uuid, 'no-document'::text; return; end if;
  if v_mirror_state is distinct from 'confirmed' then return query select v_doc, null::uuid, 'pending'::text; return; end if;
  select array_agg(l.id order by l.line_no) into v_lines from public.stock_document_lines l
   where l.org_id = p_org_id and l.document_id = v_doc
     and l.item_id::text in (select r.pmo_record_id from public.external_refs r
                              where r.org_id = p_org_id and r.domain = 'stock_items' and r.external_tier = 'odoo'
                                and r.external_record_id = p_product_id::text);
  if coalesce(array_length(v_lines, 1), 0) <> 1 then return query select v_doc, null::uuid, 'ambiguous'::text; return; end if;
  return query select v_doc, v_lines[1], case when p_is_return then 'return' else 'tied' end;
end $$;
revoke all on function public.odoo_stock_cost_tie(uuid,integer,bigint,text,bigint,boolean) from public, anon, authenticated, service_role;

-- One feed page. The company comes from the active binding, never the payload; a page with a line of another company is refused whole.
-- Lines dated before the inventory ownership start are not stored (D10). Returns how many rows changed amount or state.
create function public.apply_odoo_stock_cost_page(p_org_id uuid, p_rows jsonb, p_cursor text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company int; v_changed int := 0; v_epoch date;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  select (config->>'odoo_company_id')::int into v_company from public.external_org_bindings
   where org_id = p_org_id and external_tier = 'odoo' and status = 'active' and activated_at is not null;
  if v_company is null then raise exception 'OSC_BINDING: no active Odoo binding' using errcode = 'P0001'; end if;
  v_epoch := public.odoo_stock_cost_epoch(p_org_id);
  if v_epoch is null then raise exception 'OSC_OWNERSHIP: inventory is not employed by Odoo' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'OSC_PAGE: rows must be an array' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where (r->>'company_id')::int is distinct from v_company) then   -- mut:osc_company
    raise exception 'OSC_COMPANY: a line is not in the bound company' using errcode = 'P0001';
  end if;
  with src as (
    select * from jsonb_to_recordset(p_rows) as x(analytic_line_id bigint, analytic_account_id text, picking_ref text,
             odoo_picking_id bigint, odoo_return_of bigint, odoo_product_id bigint, unit_amount numeric, debit numeric, credit numeric,
             account text, posting_date date, fiscal_year text, source_write_date text)
     where x.posting_date >= v_epoch
  ), tied as (
    select s.*, t.document_id, t.line_id, t.state from src s
     cross join lateral public.odoo_stock_cost_tie(p_org_id, v_company, coalesce(s.odoo_return_of, s.odoo_picking_id),
                                                   s.picking_ref, s.odoo_product_id, s.odoo_return_of is not null) t
  ), up as (
    insert into public.odoo_stock_cost_lines as m (org_id, analytic_line_id, company_id, analytic_account_id, picking_ref, odoo_picking_id,
             odoo_return_of, odoo_product_id, unit_amount, debit, credit, account, posting_date, fiscal_year, is_cancelled,
             source_write_date, stock_document_id, stock_document_line_id, tie_state)
    select p_org_id, analytic_line_id, v_company, analytic_account_id, picking_ref, odoo_picking_id, odoo_return_of, odoo_product_id,
           unit_amount, coalesce(debit, 0), coalesce(credit, 0), account, posting_date, fiscal_year, false, source_write_date,
           document_id, line_id, state
      from tied
    on conflict (org_id, analytic_line_id) do update set
      analytic_account_id = excluded.analytic_account_id, picking_ref = excluded.picking_ref, odoo_picking_id = excluded.odoo_picking_id,
      odoo_return_of = excluded.odoo_return_of, odoo_product_id = excluded.odoo_product_id, unit_amount = excluded.unit_amount,
      debit = excluded.debit, credit = excluded.credit, account = excluded.account, posting_date = excluded.posting_date,
      fiscal_year = excluded.fiscal_year, is_cancelled = false, source_write_date = excluded.source_write_date,
      stock_document_id = excluded.stock_document_id, stock_document_line_id = excluded.stock_document_line_id,
      tie_state = excluded.tie_state, updated_at = now()
    where m.source_write_date is distinct from excluded.source_write_date or m.is_cancelled
    returning 1
  )
  select count(*) into v_changed from up;
  -- The mirror is written after Odoo validates, so a line read first ties late: re-resolve every untied row (ties carry no money).
  update public.odoo_stock_cost_lines c set stock_document_id = t.document_id, stock_document_line_id = t.line_id, tie_state = t.state, updated_at = now()
    from public.odoo_stock_cost_lines c2
    cross join lateral public.odoo_stock_cost_tie(c2.org_id, c2.company_id, coalesce(c2.odoo_return_of, c2.odoo_picking_id),
                                                  c2.picking_ref, c2.odoo_product_id, c2.odoo_return_of is not null) t
   where c.id = c2.id and c2.org_id = p_org_id and c2.tie_state in ('pending','no-document')
     and (c2.stock_document_id, c2.stock_document_line_id, c2.tie_state) is distinct from (t.document_id, t.line_id, t.state);
  insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
  values (p_org_id, 'odoo', 'ledger-stock-cost:odoo', p_cursor, now())
  on conflict (org_id, external_tier, domain) do update set watermark_cursor = excluded.watermark_cursor, updated_at = now();
  return v_changed;
end $$;
revoke all on function public.apply_odoo_stock_cost_page(uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.apply_odoo_stock_cost_page(uuid,jsonb,text) to service_role;

create function public.mark_odoo_stock_cost_census_seen(p_org_id uuid, p_run timestamptz, p_line_ids text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if exists (select 1 from unnest(coalesce(p_line_ids,'{}')) id where id !~ '^[1-9][0-9]*$') then
    raise exception 'malformed stock cost census id' using errcode = '22023';
  end if;
  insert into public.odoo_stock_cost_census_seen (org_id, run_at, line_id)
    select p_org_id, p_run, id::bigint from unnest(coalesce(p_line_ids,'{}')) id
    on conflict do nothing;
  delete from public.odoo_stock_cost_census_seen where org_id = p_org_id and run_at < p_run - interval '1 day';
end $$;
revoke all on function public.mark_odoo_stock_cost_census_seen(uuid,timestamptz,text[]) from public, anon, authenticated, service_role;
grant execute on function public.mark_odoo_stock_cost_census_seen(uuid,timestamptz,text[]) to service_role;

-- Only a finished, complete census cancels: rows of analytic lines Odoo no longer returns, written before the run began. A cancelled
-- row stays (the audit trail); it is never counted. Returns how many rows it cancelled.
create function public.finish_odoo_stock_cost_census(p_org_id uuid, p_run timestamptz, p_expected_lines integer default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cut text := to_char((p_run - interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS');
  v_seen integer;
  v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  select count(*) into v_seen from public.odoo_stock_cost_census_seen s where s.org_id = p_org_id and s.run_at = p_run;
  if v_seen = 0 and exists (select 1 from public.odoo_stock_cost_lines c where c.org_id = p_org_id and not c.is_cancelled and c.source_write_date < v_cut) then
    raise exception 'stock cost census saw no lines' using errcode = 'P0001';
  end if;
  if p_expected_lines is not null and v_seen <> p_expected_lines then
    raise exception 'stock cost census saw % lines, expected %', v_seen, p_expected_lines using errcode = 'P0001';
  end if;
  update public.odoo_stock_cost_lines c set is_cancelled = true, updated_at = now()
   where c.org_id = p_org_id and not c.is_cancelled and c.source_write_date < v_cut
     and not exists (select 1 from public.odoo_stock_cost_census_seen s
                      where s.org_id = p_org_id and s.run_at = p_run and s.line_id = c.analytic_line_id);
  get diagnostics v_n = row_count;
  update public.odoo_stock_cost_lines c set census_seen_at = p_run
   where c.org_id = p_org_id and exists (select 1 from public.odoo_stock_cost_census_seen s
                                          where s.org_id = p_org_id and s.run_at = p_run and s.line_id = c.analytic_line_id);
  delete from public.odoo_stock_cost_census_seen where org_id = p_org_id and run_at = p_run;
  return v_n;
end $$;
revoke all on function public.finish_odoo_stock_cost_census(uuid,timestamptz,integer) from public, anon, authenticated, service_role;
grant execute on function public.finish_odoo_stock_cost_census(uuid,timestamptz,integer) to service_role;

-- The no-double-count check's full answer for the org: the listed analytic lines have a project-tagged journal line on the same stock
-- move and are excluded from actuals; every other row is cleared. Returns how many rows changed (a change republishes the actuals).
create function public.mark_odoo_stock_cost_double_counts(p_org_id uuid, p_analytic_line_ids bigint[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  update public.odoo_stock_cost_lines c set double_count_risk = (c.analytic_line_id = any(coalesce(p_analytic_line_ids, '{}'))), updated_at = now()
   where c.org_id = p_org_id and c.double_count_risk is distinct from (c.analytic_line_id = any(coalesce(p_analytic_line_ids, '{}')));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mark_odoo_stock_cost_double_counts(uuid,bigint[]) from public, anon, authenticated, service_role;
grant execute on function public.mark_odoo_stock_cost_double_counts(uuid,bigint[]) to service_role;

create function public.record_odoo_stock_cost_check(p_org_id uuid, p_cutoff timestamptz, p_accounts jsonb, p_status text, p_reason text,
                                                    p_accounts_checked integer default 0, p_double_counts integer default 0)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode = '42501'; end if;
  perform public.assert_odoo_activated(p_org_id);
  if p_status is null or p_status not in ('matches','differs','not-checked') or p_cutoff is null
     or jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts) > 200
     or (p_status = 'not-checked') is distinct from (p_reason is not null)
     or (p_reason is not null and p_reason !~ '^[a-z0-9_:-]{1,100}$')
     or coalesce(p_accounts_checked, -1) < 0 or coalesce(p_double_counts, -1) < 0
     or (p_status = 'matches' and (jsonb_array_length(p_accounts) > 0 or p_double_counts > 0)) then
    raise exception 'invalid stock cost check' using errcode = '22023';
  end if;
  insert into public.odoo_stock_cost_checks (org_id, cutoff, status, reason, accounts, accounts_checked, double_counts)
    values (p_org_id, p_cutoff, p_status, p_reason, p_accounts, p_accounts_checked, p_double_counts);
  delete from public.odoo_stock_cost_checks c where c.org_id = p_org_id
     and c.id not in (select k.id from public.odoo_stock_cost_checks k where k.org_id = p_org_id order by k.checked_at desc, k.id desc limit 50);
end $$;
revoke all on function public.record_odoo_stock_cost_check(uuid,timestamptz,jsonb,text,text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.record_odoo_stock_cost_check(uuid,timestamptz,jsonb,text,text,integer,integer) to service_role;

-- Every issue/return movement of one project's work items, from either epoch: the standalone stock_ledger, or, for a document whose
-- Odoo transfer is confirmed, its tied analytic lines. Quantity from the PMO line (an Odoo-side return: its own quantity); value is
-- the ERP amount (debit - credit), never stock_erp_mirror.completed_value. A connected document never writes stock_ledger, so the
-- two sets are disjoint (pgTAP pins it).
create function public.project_consumption_moves(p_org_id uuid, p_project_id uuid)
returns table (occurred_on date, boq_item_id uuid, item_id uuid, issued numeric, returned numeric, value numeric, posted_by uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.occurred_on, l.boq_item_id, l.item_id,
         case when l.kind = 'issue' then -l.qty_delta else 0 end, case when l.kind = 'return' then l.qty_delta else 0 end,
         -l.value_delta, l.posted_by
    from public.stock_ledger l
   where l.org_id = p_org_id and l.project_id = p_project_id and l.kind in ('issue','return')
  union all
  -- An issue: the PMO line's quantity once per line, its tied analytic amounts summed (an Odoo correction moves the amount only).
  select min(c.posting_date), dl.boq_item_id, dl.item_id, max(dl.quantity), 0::numeric, sum(c.debit - c.credit), max(d.posted_by::text)::uuid
    from public.odoo_stock_cost_lines c
    join public.stock_erp_mirror m on m.org_id = c.org_id and m.stock_document_id = c.stock_document_id and m.state = 'confirmed'
    join public.stock_documents d on d.org_id = c.org_id and d.id = c.stock_document_id
    join public.stock_document_lines dl on dl.id = c.stock_document_line_id and dl.document_id = d.id
   where c.org_id = p_org_id and d.project_id = p_project_id and c.tie_state = 'tied' and not c.is_cancelled and not c.double_count_risk
   group by c.stock_document_line_id, dl.boq_item_id, dl.item_id
  union all
  -- An Odoo-side return: no PMO line of its own, so its quantity is Odoo's.
  select c.posting_date, dl.boq_item_id, dl.item_id, 0::numeric, abs(c.unit_amount), c.debit - c.credit, null::uuid
    from public.odoo_stock_cost_lines c
    join public.stock_erp_mirror m on m.org_id = c.org_id and m.stock_document_id = c.stock_document_id and m.state = 'confirmed'
    join public.stock_documents d on d.org_id = c.org_id and d.id = c.stock_document_id
    join public.stock_document_lines dl on dl.id = c.stock_document_line_id and dl.document_id = d.id
   where c.org_id = p_org_id and d.project_id = p_project_id and c.tie_state = 'return' and not c.is_cancelled and not c.double_count_risk
$$;
revoke all on function public.project_consumption_moves(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.get_project_consumption(p_project_id uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_months jsonb; v_allow jsonb; v_unplanned jsonb; v_erp jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                  -- mut:cost_consumption
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'STK_INVALID: a valid date range is required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then   -- mut:consumption_org
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;

  select coalesce(jsonb_agg(m.j order by m.month, m.boq_code, m.item_code), '[]'::jsonb) into v_months from (
    select date_trunc('month', l.occurred_on)::date as month, b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('month', date_trunc('month', l.occurred_on)::date, 'boq_item_id', l.boq_item_id, 'boq_item_code', b.item_code,
                              'boq_description', b.description, 'item_id', l.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'issued',       trim_scale(coalesce(sum(l.issued), 0))::text,
                              'returned',     trim_scale(coalesce(sum(l.returned), 0))::text,
                              'net_consumed', trim_scale(sum(l.issued - l.returned))::text,
                              'issued_by',    coalesce(jsonb_agg(distinct pr.full_name) filter (where l.issued > 0 and pr.full_name is not null), '[]'::jsonb))
           || case when v_cost then jsonb_build_object('net_value', sum(l.value)::text) else '{}'::jsonb end as j
      from public.project_consumption_moves(v_org, p_project_id) l
      join public.boq_items b on b.id = l.boq_item_id
      join public.stock_items i on i.id = l.item_id
      join public.stock_units u on u.id = i.unit_id
      left join public.profiles pr on pr.id = l.posted_by
     where l.occurred_on between p_from and p_to
     group by date_trunc('month', l.occurred_on), l.boq_item_id, b.item_code, b.description, l.item_id, i.code, i.name, u.code) m;

  select coalesce(jsonb_agg(a.j order by a.boq_code, a.item_code), '[]'::jsonb) into v_allow from (
    select b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('id', al.id, 'boq_item_id', al.boq_item_id, 'boq_item_code', b.item_code, 'boq_description', b.description,
                              'item_id', al.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'planned_quantity', trim_scale(al.planned_quantity)::text,
                              'net_to_date', trim_scale(coalesce(c.net, 0))::text,
                              'variance',    trim_scale(coalesce(c.net, 0) - al.planned_quantity)::text,
                              'over_allowance', coalesce(c.net, 0) > al.planned_quantity) as j                                  -- mut:overflag
      from public.boq_material_allowances al
      join public.boq_items b on b.id = al.boq_item_id and b.project_id = p_project_id and b.org_id = v_org
      join public.stock_items i on i.id = al.item_id
      join public.stock_units u on u.id = i.unit_id
      left join lateral (select sum(l.issued - l.returned) as net from public.project_consumption_moves(v_org, p_project_id) l
                          where l.boq_item_id = al.boq_item_id and l.item_id = al.item_id and l.occurred_on <= p_to) c on true) a;

  select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'boq_item_code', x.boq_code, 'boq_description', x.boq_description,
                                               'item_id', x.item_id, 'item_code', x.item_code, 'item_name', x.item_name, 'unit_code', x.unit_code,
                                               'net_to_date', trim_scale(x.net)::text) order by x.boq_code, x.item_code), '[]'::jsonb) into v_unplanned from (
    select l.boq_item_id, b.item_code as boq_code, b.description as boq_description, l.item_id, i.code as item_code, i.name as item_name, u.code as unit_code,
           sum(l.issued - l.returned) as net
      from public.project_consumption_moves(v_org, p_project_id) l
      join public.boq_items b on b.id = l.boq_item_id
      join public.stock_items i on i.id = l.item_id
      join public.stock_units u on u.id = i.unit_id
     where l.occurred_on <= p_to
       and not exists (select 1 from public.boq_material_allowances al where al.boq_item_id = l.boq_item_id and al.item_id = l.item_id)
     group by l.boq_item_id, b.item_code, b.description, l.item_id, i.code, i.name, u.code having sum(l.issued - l.returned) <> 0) x;

  -- Issued material whose cost is in the project's actuals but which has no single work item: made directly in Odoo (no PMO document,
  -- attributed by the project's analytic account), or two lines of one item on the document. Listed, never silently dropped.
  select coalesce(jsonb_agg(jsonb_build_object('picking_ref', e.picking_ref, 'posting_date', e.posting_date, 'tie_state', e.tie_state,
                                               'quantity', trim_scale(e.unit_amount)::text, 'stock_document_id', e.stock_document_id)
                            || case when v_cost then jsonb_build_object('value', (e.debit - e.credit)::text) else '{}'::jsonb end
                            order by e.posting_date, e.analytic_line_id), '[]'::jsonb) into v_erp
    from public.odoo_stock_cost_lines e
   where e.org_id = v_org and not e.is_cancelled and not e.double_count_risk and e.posting_date between p_from and p_to
     and ((e.tie_state = 'no-document' and exists (select 1 from public.external_project_bindings pb
                                                   where pb.org_id = v_org and pb.external_tier = 'odoo' and pb.project_id = p_project_id
                                                     and pb.external_container_id = e.analytic_account_id))
       or (e.tie_state = 'ambiguous' and exists (select 1 from public.stock_documents d
                                                 where d.org_id = v_org and d.id = e.stock_document_id and d.project_id = p_project_id)));

  return jsonb_build_object('project_id', p_project_id, 'from', p_from, 'to', p_to, 'months', v_months, 'allowances', v_allow,
                            'unplanned', v_unplanned, 'erp_unattributed', v_erp);
end $$;
revoke all on function public.get_project_consumption(uuid, date, date) from public, anon;
grant execute on function public.get_project_consumption(uuid, date, date) to authenticated;

-- A project's actual cost on accounts that map to no budget category (GL lines and issued material alike): project_mapped_actuals reads
-- only mapped accounts, so without this the amount would be in the snapshot and on no screen. Same generation and visibility rules.
create function public.project_uncategorised_actuals(p_project_id uuid, p_fiscal_year text default null)
returns table (account text, source_report text, amount numeric, actuals_as_of timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  with generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
     where s.org_id = public.auth_org_id()
     order by s.created_at desc, s.id desc limit 1
  )
  select s.account, s.source_report, sum(s.net), max(s.as_of)
    from public.erp_actuals_snapshot s
   where s.org_id = public.auth_org_id() and s.project_id = p_project_id
     and s.snapshot_id = (select snapshot_id from generation)
     and (p_fiscal_year is null or s.fiscal_year = p_fiscal_year)
     and exists (select 1 from public.projects p where p.id = p_project_id)
     and not exists (select 1 from public.budget_category_account_map m where m.org_id = s.org_id and m.erp_account = s.account)
   group by s.account, s.source_report
$$;
revoke all on function public.project_uncategorised_actuals(uuid,text) from public, anon, authenticated;
grant execute on function public.project_uncategorised_actuals(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
