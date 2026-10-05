-- 0243_management_pack.test.sql — #765. Migration under test: 0243_management_pack.sql.
-- Every denial asserts errcode AND message (0193's oracle discipline). No assertion reads function source.
-- Cast: FIN a1 Finance · PM a2 (P1's PM) · PM2 a3 · ENG a4 · OFF a5 Finance, disabled · XORG b1 Admin, org B.
begin;
create extension if not exists pgtap;
select plan(40);

insert into organizations (id, name, default_currency, default_timezone) values
  ('07650000-0000-0000-0000-000000000001', 'Pack Org', 'IDR', 'Asia/Jakarta'),
  ('07650000-0000-0000-0000-000000000002', 'Pack Other Org', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('07650000-0000-0000-0000-0000000000a1', 'pack-fin@example.com'),
  ('07650000-0000-0000-0000-0000000000a2', 'pack-pm@example.com'),
  ('07650000-0000-0000-0000-0000000000a3', 'pack-pm2@example.com'),
  ('07650000-0000-0000-0000-0000000000a4', 'pack-eng@example.com'),
  ('07650000-0000-0000-0000-0000000000a5', 'pack-off@example.com'),
  ('07650000-0000-0000-0000-0000000000b1', 'pack-xorg@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('07650000-0000-0000-0000-0000000000a1', '07650000-0000-0000-0000-000000000001', 'Pack Fin',  'pack-fin@example.com',  'Finance',         'active'),
  ('07650000-0000-0000-0000-0000000000a2', '07650000-0000-0000-0000-000000000001', 'Pack PM',   'pack-pm@example.com',   'Project Manager', 'active'),
  ('07650000-0000-0000-0000-0000000000a3', '07650000-0000-0000-0000-000000000001', 'Pack PM2',  'pack-pm2@example.com',  'Project Manager', 'active'),
  ('07650000-0000-0000-0000-0000000000a4', '07650000-0000-0000-0000-000000000001', 'Pack Eng',  'pack-eng@example.com',  'Engineer',        'active'),
  ('07650000-0000-0000-0000-0000000000a5', '07650000-0000-0000-0000-000000000001', 'Pack Off',  'pack-off@example.com',  'Finance',         'disabled'),
  ('07650000-0000-0000-0000-0000000000b1', '07650000-0000-0000-0000-000000000002', 'Pack XOrg', 'pack-xorg@example.com', 'Admin',           'active');

-- P1 on hand, inclusive contract (net 1,000,000). P2 a Lead. P3 archived Close Out WITH an in-window invoice.
-- P4 archived Ongoing with none. P9 another org.
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency,
                      project_manager_id, start_date, end_date, archived_at) values
  ('07650000-0000-0000-0000-0000000000c1', '07650000-0000-0000-0000-000000000001', 'Pack P1', 'Ongoing Project', 1110000, 'inclusive', 110000, 'IDR',
   '07650000-0000-0000-0000-0000000000a2', '2026-01-01', '2026-12-31', null),
  ('07650000-0000-0000-0000-0000000000c2', '07650000-0000-0000-0000-000000000001', 'Pack P2', 'Leads',           0, null, null, 'IDR', null, null, null, null),
  ('07650000-0000-0000-0000-0000000000c3', '07650000-0000-0000-0000-000000000001', 'Pack P3', 'Close Out',       0, null, null, 'IDR', null, null, null, now()),
  ('07650000-0000-0000-0000-0000000000c4', '07650000-0000-0000-0000-000000000001', 'Pack P4', 'Ongoing Project', 0, null, null, 'IDR', null, null, null, now()),
  ('07650000-0000-0000-0000-0000000000c9', '07650000-0000-0000-0000-000000000002', 'Pack P9', 'Ongoing Project', 0, null, null, 'IDR', null, null, null, null);

insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('07650000-0000-0000-0000-0000000000e1', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-03-15', 555000, 'inclusive', 55000, 'IDR', 'Unpaid'),
  ('07650000-0000-0000-0000-0000000000e2', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-03-31', 100000, 'exclusive', 11000, 'IDR', 'Paid'),
  ('07650000-0000-0000-0000-0000000000e3', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-04-01',  50000, 'exclusive', 0, 'IDR', 'Draft'),
  ('07650000-0000-0000-0000-0000000000e4', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-04-02',  70000, 'exclusive', 0, 'IDR', 'Cancelled'),
  ('07650000-0000-0000-0000-0000000000e5', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2025-12-20', 200000, 'exclusive', 0, 'IDR', 'Submitted'),
  ('07650000-0000-0000-0000-0000000000e6', '07650000-0000-0000-0000-000000000001', null,                                   '2026-02-10',  30000, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('07650000-0000-0000-0000-0000000000e7', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c3', '2026-05-05',  40000, 'exclusive', 0, 'IDR', 'Paid'),
  ('07650000-0000-0000-0000-0000000000e8', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-06-01',  10000, 'exclusive', 0, 'USD', 'Paid'),
  ('07650000-0000-0000-0000-0000000000ea', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', null,           9999, 'exclusive', 0, 'IDR', 'Paid'),
  ('07650000-0000-0000-0000-0000000000e9', '07650000-0000-0000-0000-000000000002', '07650000-0000-0000-0000-0000000000c9', '2026-03-01',  77000, 'exclusive', 0, 'IDR', 'Paid');

-- Entries before the window: only the LATEST (2025-11) may be carried in.
insert into project_progress_entries (org_id, project_id, month, pct_complete) values
  ('07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2025-10-01', 10),
  ('07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2025-11-01', 20);

-- ═══ AC-MMP-003 (pure helper, no role needed) ═══
select is(public.org_current_month('Asia/Jakarta', '2026-09-30 17:30:00+00'), '2026-10-01'::date,
  'AC-MMP-003 17:30 UTC on 30 Sep is already October in Jakarta');                                     -- 1
select is(public.org_current_month('UTC', '2026-09-30 17:30:00+00'), '2026-09-01'::date,
  'AC-MMP-003 the same instant is still September in UTC');                                             -- 2

-- ═══ Finance reads the pack ═══
set local role authenticated;
set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin perform set_config('pack.j', public.get_management_pack('2026-01-01', '2026-12-01')::text, true); end $$;

-- AC-MMP-001
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'currency' = 'IDR' and x->>'month' = '2026-03-01'),
  600000::numeric, 'AC-MMP-001 inclusive counts net of tax, exclusive at amount, in the invoice-date month');  -- 3
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'month' = '2026-04-01'),
  0, 'AC-MMP-001 Draft and Cancelled invoices are not counted');                                         -- 4
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced_before') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'currency' = 'IDR'),
  200000::numeric, 'AC-MMP-001 invoices before the window arrive as one before-window total');           -- 5
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->'project_id' = 'null'::jsonb and x->>'month' = '2026-02-01'),
  30000::numeric, 'AC-MMP-001 an invoice with no project is reported as unassigned');                    -- 6
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD' and x->>'month' = '2026-06-01'),
  10000::numeric, 'AC-MMP-001 an invoice in another currency keeps its own currency key');               -- 7
select is((current_setting('pack.j')::jsonb->>'undated_invoice_count')::int, 1,
  'AC-MMP-001 a counted invoice with no date is reported, not counted');                                 -- 8

-- AC-MMP-002
select is((select (x->>'contract_net')::numeric from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c1'),
  1000000::numeric, 'AC-MMP-002 an inclusive contract value is reported net of its tax');                 -- 9
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c2'),
  0, 'AC-MMP-002 a pipeline (Leads) project is not in the pack');                                        -- 10
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c3'),
  1, 'AC-MMP-002 an archived project invoiced in the window is in the pack');                            -- 11
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c4'),
  0, 'AC-MMP-002 an archived project with nothing in the window is not');                               -- 12

-- AC-MMP-003 (defaults + window rules)
do $$ begin perform set_config('pack.d', public.get_management_pack()::text, true); end $$;
select is(current_setting('pack.d')::jsonb->>'timezone', 'Asia/Jakarta',
  'AC-MMP-003 the default month is computed in the organisation timezone');                              -- 13
select is((current_setting('pack.d')::jsonb->>'to')::date, public.org_current_month('Asia/Jakarta', now()),
  'AC-MMP-003 the default as-at month is the org''s current month');                                     -- 14
select is((current_setting('pack.d')::jsonb->>'from')::date,
          date_trunc('year', public.org_current_month('Asia/Jakarta', now()))::date,
  'AC-MMP-003 the default window starts in January of the as-at year');                                  -- 15
select throws_ok($$select public.get_management_pack('2026-05-01', '2026-04-01')$$, '22023',
  'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it',
  'AC-MMP-003 a start after the as-at month is refused');                                                 -- 16
select throws_ok($$select public.get_management_pack('2024-03-01', '2026-03-01')$$, '22023',
  'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it',
  'AC-MMP-003 a 25-month window is refused');                                                             -- 17
select lives_ok($$select public.get_management_pack('2024-04-01', '2026-03-01')$$,
  'AC-MMP-003 a 24-month window is served');                                                              -- 18

-- ═══ AC-MMP-005 progress writes ═══
select lives_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-03-17', 40)$$,
  'AC-MMP-005 Finance records progress on any project');                                                  -- 19
select is((select month::text || ':' || pct_complete::text from public.project_progress_entries
            where project_id = '07650000-0000-0000-0000-0000000000c1' and month >= '2026-01-01'),
  '2026-03-01:40.00', 'AC-MMP-005 the month is stored as its first day');                                 -- 20
select lives_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-03-01', 45, 'site visit')$$,
  'AC-MMP-005 re-recording the same month is accepted');                                                  -- 21
select is((select count(*)::text || ':' || max(pct_complete)::text from public.project_progress_entries
            where project_id = '07650000-0000-0000-0000-0000000000c1' and month = '2026-03-01'),
  '1:45.00', 'AC-MMP-005 re-recording replaces the month, it never adds a second row');                   -- 22
select is((select entered_by from public.project_progress_entries
            where project_id = '07650000-0000-0000-0000-0000000000c1' and month = '2026-03-01'),
  '07650000-0000-0000-0000-0000000000a1'::uuid, 'AC-MMP-005 the recorder is stamped server-side');       -- 23
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-05-01', 100.01)$$,
  '23514', 'percent complete must be between 0 and 100', 'AC-MMP-005 more than 100% is refused');        -- 24
select ok(not has_column_privilege('authenticated', 'public.project_progress_entries', 'entered_by', 'INSERT'),
  'AC-MMP-005 clients cannot supply the recorder on insert');                                             -- 25
select ok(not has_column_privilege('authenticated', 'public.project_progress_entries', 'entered_by', 'UPDATE'),
  'AC-MMP-005 clients cannot rewrite the recorder');                                                      -- 26
select ok(not has_column_privilege('authenticated', 'public.project_progress_entries', 'project_id', 'UPDATE'),
  'AC-MMP-005 an entry cannot be moved to another project');                                              -- 27

do $$ begin perform set_config('pack.j', public.get_management_pack('2026-01-01', '2026-12-01')::text, true); end $$;
select is((select (x->>'pct_complete')::numeric || ':' || (x->>'entered_by_name')
             from jsonb_array_elements(current_setting('pack.j')::jsonb->'progress') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'month' = '2026-03-01'),
  '45.00:Pack Fin', 'AC-MMP-005 the pack returns the entry with its recorder');                           -- 28
select is((select string_agg(x->>'month', ',' order by x->>'month')
             from jsonb_array_elements(current_setting('pack.j')::jsonb->'progress') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'month' < '2026-01-01'),
  '2025-11-01', 'AC-MMP-005 only the latest entry before the window is carried in');                      -- 29

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 50)$$,
  'AC-MMP-005 a PM records progress on a project they manage');                                           -- 30

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 a PM may not record progress on another PM''s project');                                   -- 31
select throws_ok($$insert into public.project_progress_entries (project_id, month, pct_complete)
                   values ('07650000-0000-0000-0000-0000000000c1', '2026-07-01', 10)$$,
  '42501', 'new row violates row-level security policy for table "project_progress_entries"',
  'AC-MMP-005 RLS refuses the same write made directly against the table');                               -- 32

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 an Engineer may not record progress');                                                       -- 33

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 a disabled Finance user may not record progress');                                          -- 34

-- ═══ AC-MMP-004 tenancy + membership ═══
select throws_ok($$select public.get_management_pack('2026-01-01', '2026-12-01')$$, '42501', 'not authorized',
  'AC-MMP-004 a disabled member cannot read the pack');                                                    -- 35

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 another organisation''s Admin may not record progress here');                               -- 36
do $$ begin perform set_config('pack.x', public.get_management_pack('2026-01-01', '2026-12-01')::text, true); end $$;
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.x')::jsonb->'projects') x
            where x->>'id' like '07650000-0000-0000-0000-0000000000c%' and x->>'id' <> '07650000-0000-0000-0000-0000000000c9'),
  0, 'AC-MMP-004 another organisation sees none of this organisation''s projects');                      -- 37
select is((select coalesce(sum((x->>'net')::numeric), 0) from jsonb_array_elements(current_setting('pack.x')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' or x->'project_id' = 'null'::jsonb),
  0::numeric, 'AC-MMP-004 another organisation sees none of this organisation''s invoices');             -- 38

reset role;
select ok(not has_function_privilege('anon', 'public.get_management_pack(date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.record_project_progress(uuid, date, numeric, text)', 'EXECUTE'),
  'AC-MMP-004 anon can execute neither RPC');                                                              -- 39
select ok(not (select prosecdef from pg_proc where oid = 'public.get_management_pack(date, date)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'public.record_project_progress(uuid, date, numeric, text)'::regprocedure),
  'AC-MMP-004 both RPCs run as the caller (SECURITY INVOKER), so RLS stays the boundary');                -- 40

select * from finish();
rollback;
