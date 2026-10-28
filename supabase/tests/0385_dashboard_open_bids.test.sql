-- 0385_dashboard_open_bids.test.sql — #1380 / #1441
-- The win-rate card combines decided outcomes by decided_at with currently-open bids by created_at.
-- Staleness uses the last project status change, falling back to project creation for legacy rows.
begin;
select plan(9);

insert into organizations (id, name) values
  ('03850000-0000-0000-0000-000000000001', 'Dashboard Bid Metrics Org'),
  ('03850000-0000-0000-0000-000000000002', 'Other Dashboard Metrics Org');
insert into auth.users (id, email) values
  ('03850000-0000-0000-0000-0000000000a1', 'exec@dashboard-bids.example');
insert into profiles (id, org_id, full_name, email, role) values
  ('03850000-0000-0000-0000-0000000000a1', '03850000-0000-0000-0000-000000000001',
   'Executive 0385', 'exec@dashboard-bids.example', 'Executive');

insert into projects (id, org_id, code, name, status, project_manager_id, contract_value,
                     budget, spent, decided_at, tax_treatment, tax_amount, currency,
                     created_at, archived_at)
values
  ('38500000-0000-0000-0000-000000000101', '03850000-0000-0000-0000-000000000001',
   'W-USD', 'Won USD Bid', 'Ongoing Project', '03850000-0000-0000-0000-0000000000a1',
   8000000, 0, 0, current_date - 20, 'exclusive', 0, 'USD', now() - interval '200 days', null),
  ('38500000-0000-0000-0000-000000000102', '03850000-0000-0000-0000-000000000001',
   'L-USD', 'Lost USD Bid', 'Loss Tender', '03850000-0000-0000-0000-0000000000a1',
   650000, 0, 0, current_date - 17, 'exclusive', 0, 'USD', now() - interval '180 days', null),
  ('38500000-0000-0000-0000-000000000103', '03850000-0000-0000-0000-000000000001',
   'O-IDR', 'Recent IDR Bid', 'Tender Submitted', '03850000-0000-0000-0000-0000000000a1',
   1000000, 0, 0, null, 'exclusive', 0, 'IDR', now() - interval '10 days', null),
  ('38500000-0000-0000-0000-000000000104', '03850000-0000-0000-0000-000000000001',
   'S-IDR', 'Stale IDR Bid', 'PQ Submitted', '03850000-0000-0000-0000-0000000000a1',
   2000000, 0, 0, null, 'exclusive', 0, 'IDR', now() - interval '200 days', null),
  ('38500000-0000-0000-0000-000000000105', '03850000-0000-0000-0000-000000000001',
   'F-USD', 'Fresh Stage USD Bid', 'Negotiation', '03850000-0000-0000-0000-0000000000a1',
   3000000, 0, 0, null, 'exclusive', 0, 'USD', now() - interval '200 days', null),
  ('38500000-0000-0000-0000-000000000106', '03850000-0000-0000-0000-000000000001',
   'B-IDR', 'Legacy IDR Bid', 'Leads', '03850000-0000-0000-0000-0000000000a1',
   4000000, 0, 0, null, 'exclusive', 0, 'IDR', now() - interval '100 days', null),
  ('38500000-0000-0000-0000-000000000107', '03850000-0000-0000-0000-000000000001',
   'A-IDR', 'Archived IDR Bid', 'Leads', '03850000-0000-0000-0000-0000000000a1',
   5000000, 0, 0, null, 'exclusive', 0, 'IDR', now() - interval '5 days', now()),
  ('38500000-0000-0000-0000-000000000201', '03850000-0000-0000-0000-000000000002',
   'X-IDR', 'Other Org Bid', 'Tender Submitted', null,
   9000000, 0, 0, null, 'exclusive', 0, 'IDR', now() - interval '3 days', null);

-- Synthetic update events provide deterministic stage-age witnesses; INSERT events are excluded
-- because an insert starts the first stage at projects.created_at.
insert into record_changes (org_id, entity_type, entity_id, op, changes, currency, created_at)
values
  ('03850000-0000-0000-0000-000000000001', 'project', '38500000-0000-0000-0000-000000000104', 'update',
   '{"status":{"old":"Leads","new":"PQ Submitted"}}', 'IDR', now() - interval '95 days'),
  ('03850000-0000-0000-0000-000000000001', 'project', '38500000-0000-0000-0000-000000000105', 'update',
   '{"status":{"old":"Quotation Submitted","new":"Negotiation"}}', 'USD', now() - interval '20 days');

set local role authenticated;
set local request.jwt.claims to '{"sub":"03850000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (get_win_rate(current_date - 30, current_date) ->> 'wins_count')::int,
  1,
  'AC-1380: decided win count still uses the selected decided_at period'
);
select is(
  (get_win_rate(current_date - 30, current_date) ->> 'win_rate_count')::numeric,
  0.5::numeric,
  'AC-1380: decided count rate remains wins over wins plus losses'
);
select is(
  (get_win_rate(current_date - 30, current_date) ->> 'open_count')::int,
  1,
  'AC-1441: selected-period open count uses created_at and excludes archived and other-org rows'
);
select is(
  (get_win_rate(current_date - 30, current_date) ->> 'stale_count')::int,
  2,
  'AC-1441: current stale count ignores period and uses stage age with created_at fallback'
);
select ok(
  (select (c ->> 'wins_count')::int = 1 and (c ->> 'losses_count')::int = 1
          and (c ->> 'open_count')::int = 0
          and (c ->> 'wins_value')::numeric = 8000000
          and (c ->> 'losses_value')::numeric = 650000
     from json_array_elements(get_win_rate(current_date - 30, current_date) -> 'bids_by_currency') c
    where c ->> 'currency' = 'USD'),
  'AC-1441: USD bid counts and values keep won and lost figures in one currency'
);
select ok(
  (select (c ->> 'wins_count')::int = 0 and (c ->> 'losses_count')::int = 0
          and (c ->> 'open_count')::int = 1 and (c ->> 'open_value')::numeric = 1000000
     from json_array_elements(get_win_rate(current_date - 30, current_date) -> 'bids_by_currency') c
    where c ->> 'currency' = 'IDR'),
  'AC-1441: IDR open value is isolated from the USD decided outcomes'
);
select is(
  (select (p ->> 'stage_started_at')::timestamptz
     from json_array_elements(get_sales_pipeline() -> 'projects') p
    where p ->> 'id' = '38500000-0000-0000-0000-000000000104'),
  (select created_at from record_changes
    where entity_id = '38500000-0000-0000-0000-000000000104' and op = 'update'),
  'AC-1441: pipeline row uses the last recorded status change'
);
select is(
  (select (p ->> 'stage_started_at')::timestamptz
     from json_array_elements(get_sales_pipeline() -> 'projects') p
    where p ->> 'id' = '38500000-0000-0000-0000-000000000106'),
  (select created_at from projects where id = '38500000-0000-0000-0000-000000000106'),
  'AC-1441: pipeline row without a status event falls back to project creation'
);
select ok(
  has_function_privilege('authenticated', 'public.get_win_rate(date,date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_win_rate(date,date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_sales_pipeline()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_sales_pipeline()', 'EXECUTE'),
  'AC-1441: dashboard RPC execution remains authenticated-only'
);

reset role;
select * from finish();
rollback;
