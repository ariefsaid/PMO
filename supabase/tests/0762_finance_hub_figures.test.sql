-- 0762_finance_hub_figures.test.sql — #1988. Migration under test: 0762_finance_hub_figures.sql.
-- The Finance hub's three figures (per-currency unbilled at the as-at month, the contract rows and
-- their progress-less count, and the latest company P&L net profit) come from ONE narrow invoker
-- read. Every figure here is compared against what the FULL reads produce on the same data:
-- the pack figures against public.get_management_pack() (the client's own derivation, mirrored in
-- plpgsql below), the net profit against public.get_financial_statement(...) (the client's own
-- extraction, mirrored in plpgsql below). Tenancy: another org sees none of it.
-- Cast: FIN a1 Finance · ADM a2 Admin · EXE a3 Executive · PM a4 · ENG a5 · OFF a6 Finance, disabled
--       · XFIN b1 Finance, org B.
begin;
create extension if not exists pgtap;
select plan(24);

insert into organizations (id, name, default_currency, default_timezone) values
  ('07620000-0000-0000-0000-000000000001', 'Hub Figures Org', 'IDR', 'Asia/Jakarta'),
  ('07620000-0000-0000-0000-000000000002', 'Hub Figures Other Org', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('07620000-0000-0000-0000-0000000000a1', 'hub-fin@example.com'),
  ('07620000-0000-0000-0000-0000000000a2', 'hub-adm@example.com'),
  ('07620000-0000-0000-0000-0000000000a3', 'hub-exe@example.com'),
  ('07620000-0000-0000-0000-0000000000a4', 'hub-pm@example.com'),
  ('07620000-0000-0000-0000-0000000000a5', 'hub-eng@example.com'),
  ('07620000-0000-0000-0000-0000000000a6', 'hub-off@example.com'),
  ('07620000-0000-0000-0000-0000000000b1', 'hub-xfin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('07620000-0000-0000-0000-0000000000a1', '07620000-0000-0000-0000-000000000001', 'Hub Fin', 'hub-fin@example.com', 'Finance',   'active'),
  ('07620000-0000-0000-0000-0000000000a2', '07620000-0000-0000-0000-000000000001', 'Hub Adm', 'hub-adm@example.com', 'Admin',     'active'),
  ('07620000-0000-0000-0000-0000000000a3', '07620000-0000-0000-0000-000000000001', 'Hub Exe', 'hub-exe@example.com', 'Executive', 'active'),
  ('07620000-0000-0000-0000-0000000000a4', '07620000-0000-0000-0000-000000000001', 'Hub PM',  'hub-pm@example.com',  'Project Manager', 'active'),
  ('07620000-0000-0000-0000-0000000000a5', '07620000-0000-0000-0000-000000000001', 'Hub Eng', 'hub-eng@example.com', 'Engineer',  'active'),
  ('07620000-0000-0000-0000-0000000000a6', '07620000-0000-0000-0000-000000000001', 'Hub Off', 'hub-off@example.com', 'Finance',   'disabled'),
  ('07620000-0000-0000-0000-0000000000b1', '07620000-0000-0000-0000-000000000002', 'Hub XFin', 'hub-xfin@example.com', 'Finance', 'active');

-- Org A: P1 progress-basis (before-window + in-window progress, before/month/unassigned/foreign
-- currency/undated/draft/cancelled invoices), P3 archived but invoiced in-window, P4 exercises the
-- half-cent rounding. Org B: one project with progress, one unassigned USD invoice.
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency,
                      start_date, end_date, archived_at) values
  ('07620000-0000-0000-0000-0000000000c1', '07620000-0000-0000-0000-000000000001', 'Hub P1', 'Ongoing Project', 1110000, 'inclusive', 110000, 'IDR', null, null, null),
  ('07620000-0000-0000-0000-0000000000c3', '07620000-0000-0000-0000-000000000001', 'Hub P3', 'Close Out',       0,       null,        null,   'IDR', null, null, now()),
  ('07620000-0000-0000-0000-0000000000c4', '07620000-0000-0000-0000-000000000001', 'Hub P4', 'Ongoing Project', 100.01,  'exclusive', 0,      'IDR', null, null, null),
  ('07620000-0000-0000-0000-0000000000c9', '07620000-0000-0000-0000-000000000002', 'Hub P9', 'Ongoing Project', 777000,  'exclusive', 0,      'IDR', null, null, null);

insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('07620000-0000-0000-0000-0000000000e1', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2025-12-20', 200000, 'exclusive', 0,      'IDR', 'Submitted'),
  ('07620000-0000-0000-0000-0000000000e2', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2026-03-15', 555000, 'inclusive', 55000,  'IDR', 'Unpaid'),
  ('07620000-0000-0000-0000-0000000000e3', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2026-03-31', 100000, 'exclusive', 11000,  'IDR', 'Paid'),
  ('07620000-0000-0000-0000-0000000000e4', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2026-04-02', 50000,  'exclusive', 0,      'IDR', 'Draft'),
  ('07620000-0000-0000-0000-0000000000e5', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2026-04-03', 70000,  'exclusive', 0,      'IDR', 'Cancelled'),
  ('07620000-0000-0000-0000-0000000000e6', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2026-05-01', 10000,  'exclusive', 0,      'USD', 'Paid'),
  ('07620000-0000-0000-0000-0000000000e7', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', null,         9999,   'exclusive', 0,      'IDR', 'Paid'),
  ('07620000-0000-0000-0000-0000000000e8', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2026-06-15', 123.45, 'exclusive', 0,      'IDR', 'Submitted'),
  ('07620000-0000-0000-0000-0000000000e9', '07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c3', '2026-05-05', 40000,  'exclusive', 0,      'IDR', 'Paid'),
  ('07620000-0000-0000-0000-0000000000ea', '07620000-0000-0000-0000-000000000001', null,                                   '2026-02-10', 30000,  'exclusive', 0,      'IDR', 'Unpaid'),
  ('07620000-0000-0000-0000-0000000000f1', '07620000-0000-0000-0000-000000000002', '07620000-0000-0000-0000-0000000000c9', '2026-04-20', 1000,   'exclusive', 0,      'IDR', 'Submitted'),
  ('07620000-0000-0000-0000-0000000000f2', '07620000-0000-0000-0000-000000000002', null,                                   '2026-04-21', 5000,   'exclusive', 0,      'USD', 'Unpaid');

insert into project_progress_entries (org_id, project_id, month, pct_complete) values
  ('07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2025-10-01', 10),
  ('07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2025-11-01', 40),
  ('07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c1', '2026-03-01', 60),
  ('07620000-0000-0000-0000-000000000001', '07620000-0000-0000-0000-0000000000c4', '2026-02-01', 50),
  ('07620000-0000-0000-0000-000000000002', '07620000-0000-0000-0000-0000000000c9', '2026-05-01', 25);

-- Org A statements: one binding, a company trial balance and a company P&L for 2026-01. The P&L's
-- columns exercise the client's extraction: a 'total' column is skipped by name, a hidden currency
-- column is skipped by flag, so the first visible one ('mine') owns the figure; the profit row is
-- matched case-insensitively BEFORE a later same-named row and before an account-only fallback row.
set local role service_role;
insert into public.external_org_bindings
  (id, org_id, external_tier, site_url, secret_ref, version_major, config, activated_at,
   statement_full_ledger_replay_needed, statement_update_delayed, statement_last_attempt_at, statement_calendar)
values
  ('07620000-0000-0000-0000-0000000000b0', '07620000-0000-0000-0000-000000000001', 'erpnext',
   'https://hub-fixtures.invalid', 'hub-fixture', 16, '{"company":"Hub Figures Co","project_map":{}}',
   '2026-10-01T00:00:00Z', false, false, '2026-10-01T00:00:00Z', '[]');

insert into public.erp_financial_statement_snapshot
  (org_id, company, snapshot_id, source_generation, statement, scope_kind, project_id, view_kind,
   period_kind, current_start, current_end, prior_start, prior_end, currency, as_of,
   source_report, report_version, filters, settings, payload, has_activity,
   display_precision, display_rounding_method, capture_started_at, capture_completed_at, raw_reports)
values
  ('07620000-0000-0000-0000-000000000001', 'Hub Figures Co', '07620000-0000-0000-0000-000000000101', '07620000-0000-0000-0000-000000000201',
   'trial_balance', 'company', null, 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31',
   'IDR', '2026-02-01 00:00:00+00', 'Trial Balance', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}',
   '{"current":{"reportName":"Trial Balance","company":"Hub Figures Co","side":"current","rows":[],"columns":[]},"prior":{"reportName":"Trial Balance","company":"Hub Figures Co","side":"prior","rows":[],"columns":[]}}',
   true, 2, 'Commercial Rounding', '2026-01-31 23:59:00+00', '2026-02-01 00:00:00+00', '{"current":"{}","prior":"{}"}'),
  ('07620000-0000-0000-0000-000000000001', 'Hub Figures Co', '07620000-0000-0000-0000-000000000102', '07620000-0000-0000-0000-000000000201',
   'profit_and_loss', 'company', null, 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31',
   'IDR', '2026-02-01 00:00:00+00', 'Profit and Loss', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}',
   '{"current":{"reportName":"Profit and Loss Statement","company":"Hub Figures Co","side":"current",
      "columns":[{"fieldname":"total","label":"Total","type":"currency"},{"fieldname":"amt","label":"Amount","type":"currency","hidden":true},{"fieldname":"mine","label":"This Period","type":"currency"}],
      "rows":[{"account_name":"Revenue","mine":"1000.00","total":"1000.00"},
              {"account_name":"profit for the period","mine":"250.50","total":"250.50"},
              {"account_name":"PROFIT FOR THE PERIOD (restated)","mine":"999.99","total":"999.99"},
              {"account_name":null,"account":"profit for the period (alt)","mine":"0.01","total":"0.01"}]},
    "prior":{"reportName":"Profit and Loss Statement","company":"Hub Figures Co","side":"prior","rows":[],"columns":[]}}',
   true, 2, 'Commercial Rounding', '2026-01-31 23:59:00+00', '2026-02-01 00:00:00+00', '{"current":"{}","prior":"{}"}');
reset role;

-- ═══ grants mirror get_financial_statement: authenticated only ═══
select is(has_function_privilege('authenticated', 'public.get_finance_hub_figures()', 'execute'), true,
  'authenticated may execute the hub figures read');                                                    -- 1
select is(has_function_privilege('anon', 'public.get_finance_hub_figures()', 'execute'), false,
  'anon may not execute the hub figures read');                                                         -- 2
select is(has_function_privilege('service_role', 'public.get_finance_hub_figures()', 'execute'),
          has_function_privilege('service_role', 'public.get_financial_statement(text,date,text,uuid,text,boolean)', 'execute'),
  'service_role privilege matches get_financial_statement');                                             -- 3

-- ═══ Finance reads the figures; the pack side must equal the FULL pack read ═══
set local role authenticated;
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin perform set_config('hub.figures', public.get_finance_hub_figures()::text, true); end $$;

-- The client's own derivation (src/lib/reports/managementPack.ts buildManagementPack) applied to the
-- full get_management_pack facts: cents per (project, currency) summed per month group exactly as the
-- client rounds the facts, progress-basis recognition for the latest entry at or before the as-at
-- month, and every counted key contributing its currency at zero.
do $$
declare
  facts jsonb := public.get_management_pack();
  v_to date := (facts->>'to')::date;
  inv_cents jsonb := '{}'::jsonb;
  unbilled jsonb := '{}'::jsonb;
  r record;
  k text;
  cur text;
  cents bigint;
  inv bigint;
  pct numeric;
  contract_cents bigint;
  recognised bigint;
  derived jsonb;
  expected jsonb;
begin
  for r in
    select coalesce(e->>'project_id', '') as pid, e->>'currency' as cur, round((e->>'net')::numeric * 100)::bigint as cents
      from jsonb_array_elements(facts->'invoiced') e
    union all
    select coalesce(e->>'project_id', ''), e->>'currency', round((e->>'net')::numeric * 100)::bigint
      from jsonb_array_elements(facts->'invoiced_before') e
  loop
    k := r.pid || '|' || r.cur;
    inv_cents := jsonb_set(inv_cents, array[k], to_jsonb(coalesce((inv_cents->>k)::bigint, 0) + r.cents));
  end loop;

  for r in select p->>'id' as pid, p->>'currency' as cur, round((p->>'contract_net')::numeric * 100)::bigint as contract_cents
             from jsonb_array_elements(facts->'projects') p
  loop
    select (g->>'pct_complete')::numeric into pct
      from jsonb_array_elements(facts->'progress') g
     where g->>'project_id' = r.pid and (g->>'month')::date <= v_to
     order by (g->>'month')::date desc
     limit 1;
    k := r.pid || '|' || r.cur;
    inv := coalesce((inv_cents->>k)::bigint, 0);
    recognised := case when pct is not null
                       then floor((2 * r.contract_cents::numeric * round(pct * 100)::bigint + 10000) / 20000)::bigint
                       else inv end;
    unbilled := jsonb_set(unbilled, array[r.cur],
      to_jsonb(coalesce((unbilled->>r.cur)::bigint, 0) + recognised - inv));
  end loop;

  for k in select * from jsonb_object_keys(inv_cents) loop
    cur := split_part(k, '|', 2);
    unbilled := jsonb_set(unbilled, array[cur], to_jsonb(coalesce((unbilled->>cur)::bigint, 0)));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('currency', key, 'cents', value) order by key), '[]'::jsonb)
    into derived
    from jsonb_each(unbilled);

  expected := jsonb_build_object(
    'as_at', v_to,
    'unbilled', derived,
    'contract_rows', jsonb_array_length(facts->'projects'),
    'invoiced_basis_rows', (
      select count(*)::int from jsonb_array_elements(facts->'projects') p
       where not exists (select 1 from jsonb_array_elements(facts->'progress') g
                          where g->>'project_id' = p->>'id' and (g->>'month')::date <= v_to))
  );
  perform set_config('hub.pack_expected', expected::text, true);
end $$;

select is(current_setting('hub.figures')::jsonb->'pack', current_setting('hub.pack_expected')::jsonb,
  'AC-1988 the pack figures equal what the full management pack read produces on the same data');         -- 4

-- The independent money oracle (hand-computed): P1 recognised 60% of 100,000,000c minus invoiced
-- 80,012,345c (before 20,000,000 + March 600,000 — exclusive invoices count at the full amount —
-- plus June 12,345) = −20,012,345c; P3 (zero contract) contributes 0; P4 half-cent 50% of 10,001c
-- rounds up to 5,001c; USD enters at 0.
select is(current_setting('hub.figures')::jsonb->'pack'->'unbilled',
  '[{"currency":"IDR","cents":-20007344},{"currency":"USD","cents":0}]'::jsonb,
  'AC-1988 the unbilled money figure matches the hand-computed oracle (identical before/after)');         -- 5
select is((current_setting('hub.figures')::jsonb->'pack'->>'contract_rows')::int, 3,
  'AC-1988 contract rows count the pack''s projects');                                                    -- 6
select is((current_setting('hub.figures')::jsonb->'pack'->>'invoiced_basis_rows')::int, 1,
  'AC-1988 only the project without progress counts as invoiced-basis');                                  -- 7

-- ═══ the statement side must equal the FULL statement read on the same data ═══
-- The client's own extraction (FinanceHub netProfit): first row whose label matches
-- /profit for the period/i after apostrophe removal, at the first visible non-total currency column.
do $$
declare
  env jsonb := public.get_financial_statement('month', '2026-01-01', 'profit_and_loss', null, 'account_breakdown', false);
  payload jsonb := env->'result'->'payload';
  col text;
  label text;
  row_ jsonb;
  amount numeric := null;
begin
  if env->>'state' = 'complete' and env->'result'->>'viewKind' = 'account_breakdown' then
    select c->>'fieldname' into col
      from jsonb_array_elements(payload->'current'->'columns') c
     where c->>'type' = 'currency' and c->>'fieldname' <> 'total' and coalesce(jsonb_typeof(c->'hidden') <> 'boolean' or (c->'hidden') <> 'true'::jsonb, true)
     limit 1;
    for row_ in select * from jsonb_array_elements(payload->'current'->'rows') loop
      label := case when jsonb_typeof(row_->'account_name') = 'string' then row_->>'account_name'
                    when jsonb_typeof(row_->'account') = 'string' then row_->>'account' end;
      if label is not null and position('profit for the period' in lower(replace(label, '''', ''))) > 0 then
        if jsonb_typeof(row_->col) = 'number' or jsonb_typeof(row_->col) = 'string' then
          amount := (row_->col #>> '{}')::numeric;
        end if;
        exit;
      end if;
    end loop;
  end if;
  perform set_config('hub.statement_expected', coalesce(amount::text, 'null'), true);
end $$;

select is(current_setting('hub.figures')::jsonb->'statement'->>'net_profit',
          current_setting('hub.statement_expected'),
  'AC-1988 the net profit equals what the full P&L read produces on the same data');                      -- 8
select is(current_setting('hub.figures')::jsonb->'statement'->>'net_profit', '250.50',
  'AC-1988 the net profit money figure matches the hand-computed oracle (first match, visible column)');  -- 9
select is(current_setting('hub.figures')::jsonb->'statement'->>'period_start', '2026-01-01',
  'AC-1988 the period is the latest month period at or before today');                                    -- 10
select is(current_setting('hub.figures')::jsonb->'statement'->>'currency', 'IDR',
  'AC-1988 the statement currency is the snapshot currency');                                             -- 11
select is((current_setting('hub.figures')::jsonb->'statement'->>'unpublished')::boolean, false,
  'AC-1988 a published statement set is not unpublished');                                                -- 12

-- ═══ tenancy: another org sees none of it ═══
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$ begin perform set_config('hub.xfigures', public.get_finance_hub_figures()::text, true); end $$;
select is(current_setting('hub.xfigures')::jsonb->'pack'->'unbilled',
  '[{"currency":"IDR","cents":19325000},{"currency":"USD","cents":0}]'::jsonb,
  'AC-1988 the other org sees only its own unbilled figure, none of org A''s');                           -- 13
select is((current_setting('hub.xfigures')::jsonb->'pack'->>'contract_rows')::int, 1,
  'AC-1988 the other org''s contract rows count only its own projects');                                  -- 14
select is((current_setting('hub.xfigures')::jsonb->'statement'->>'unpublished')::boolean, true,
  'AC-1988 with no statements of its own the org is told statements are unpublished');                    -- 15
select is(coalesce(current_setting('hub.xfigures')::jsonb->'statement'->>'period_start', '<none>'), '<none>',
  'AC-1988 the other org has no statement period');                                                       -- 16
select is(coalesce(current_setting('hub.xfigures')::jsonb->'statement'->>'net_profit', '<none>'), '<none>',
  'AC-1988 the other org has no net profit figure');                                                      -- 17

-- ═══ refusals mirror the full reads ═══
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok('select public.get_finance_hub_figures()', '42501',
  'not permitted', 'AC-1988 a Project Manager is refused (the full statement read refuses them too)');    -- 18
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok('select public.get_finance_hub_figures()', '42501',
  'not permitted', 'AC-1988 an Engineer is refused');                                                     -- 19
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok('select public.get_finance_hub_figures()', '42501',
  'not authorized', 'AC-1988 a disabled member is refused');                                              -- 20

-- ═══ Admin and Executive read the same figures ═══
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok('select public.get_finance_hub_figures()',
  'AC-1988 an Admin reads the hub figures');                                                              -- 21
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok('select public.get_finance_hub_figures()',
  'AC-1988 an Executive reads the hub figures');                                                          -- 22

-- ═══ an inconsistent snapshot set refuses BOTH reads with the same error (0321's contract) ═══
reset role;
set local request.jwt.claims = '{}';
set local role service_role;
insert into public.erp_financial_statement_snapshot
  (org_id, company, snapshot_id, source_generation, statement, scope_kind, project_id, view_kind,
   period_kind, current_start, current_end, prior_start, prior_end, currency, as_of,
   source_report, report_version, filters, settings, payload, has_activity,
   display_precision, display_rounding_method, capture_started_at, capture_completed_at, raw_reports)
values
  ('07620000-0000-0000-0000-000000000001', 'Hub Figures Co', '07620000-0000-0000-0000-000000000102', '07620000-0000-0000-0000-000000000299',
   'profit_and_loss', 'company', null, 'account_breakdown', 'month', '2026-02-01', '2026-02-28', '2026-01-01', '2026-01-31',
   'IDR', '2026-01-20 00:00:00+00', 'Profit and Loss', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}',
   '{"current":{},"prior":{}}', true, 2, 'Commercial Rounding', '2026-01-19 23:59:00+00', '2026-01-20 00:00:00+00', '{"current":"{}","prior":"{}"}');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"07620000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok('select public.get_finance_hub_figures()', '22023',
  'Invalid statement selection', 'AC-1988 an inconsistent snapshot set is refused like the full read');   -- 23
select throws_ok('select public.get_financial_statement(''month'',''2026-01-01'',''profit_and_loss'',null,''account_breakdown'',false)',
  '22023', 'Invalid statement selection', 'AC-1988 the full read refuses the same inconsistent snapshot set'); -- 24

reset role;

select * from finish();
rollback;
