-- #2584 S2: the derive of a subcontractor progress certificate from validated daily reports at the agreed rates, and its snapshot
-- (AC-SPC-001, 002, 005, 008, 017 certificate rows; FR-SPC-004..009, 011). Migration under test: 1136_subcontract_certificates.sql.
-- The hand calculation is the spec's "Definitions" table: A 40.000 x 10.00, B 12.500 x 8.40, C 3.333 x 9.99 = 538.30; backcharge 38.30; net 500.00.
begin;
create extension if not exists pgtap;
select plan(49);

-- ── shared fixture (the hand-calculation month, spec "Definitions"): org A (multi-member), org B (another tenant). ──
-- PO quantity 100 and rate 12.00 on every item; vendor V1's crew works work order W1 in March 2026.
insert into organizations (id, name, default_currency) values
  ('25840000-0000-0000-0000-00000000000a', 'SPC Org',       'IDR'),
  ('25840000-0000-0000-0000-00000000000b', 'SPC Other Org', 'IDR');
insert into auth.users (id, email) values
  ('25840000-0000-0000-0000-0000000000a1', 'spc-admin@example.com'),
  ('25840000-0000-0000-0000-0000000000a2', 'spc-fin1@example.com'),
  ('25840000-0000-0000-0000-0000000000a3', 'spc-fin2@example.com'),
  ('25840000-0000-0000-0000-0000000000a4', 'spc-pm@example.com'),
  ('25840000-0000-0000-0000-0000000000a5', 'spc-eng@example.com'),
  ('25840000-0000-0000-0000-0000000000a6', 'spc-exec@example.com'),
  ('25840000-0000-0000-0000-0000000000a7', 'spc-pm2@example.com'),
  ('25840000-0000-0000-0000-0000000000b1', 'spc-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25840000-0000-0000-0000-0000000000a1', '25840000-0000-0000-0000-00000000000a', 'SPC Admin', 'spc-admin@example.com', 'Admin', 'active'),
  ('25840000-0000-0000-0000-0000000000a2', '25840000-0000-0000-0000-00000000000a', 'SPC Fin1',  'spc-fin1@example.com',  'Finance', 'active'),
  ('25840000-0000-0000-0000-0000000000a3', '25840000-0000-0000-0000-00000000000a', 'SPC Fin2',  'spc-fin2@example.com',  'Finance', 'active'),
  ('25840000-0000-0000-0000-0000000000a4', '25840000-0000-0000-0000-00000000000a', 'SPC PM',    'spc-pm@example.com',    'Project Manager', 'active'),
  ('25840000-0000-0000-0000-0000000000a5', '25840000-0000-0000-0000-00000000000a', 'SPC Eng',   'spc-eng@example.com',   'Engineer', 'active'),
  ('25840000-0000-0000-0000-0000000000a6', '25840000-0000-0000-0000-00000000000a', 'SPC Exec',  'spc-exec@example.com',  'Executive', 'active'),
  ('25840000-0000-0000-0000-0000000000a7', '25840000-0000-0000-0000-00000000000a', 'SPC PM2',   'spc-pm2@example.com',   'Project Manager', 'active'),
  ('25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-00000000000b', 'SPC XOrg',  'spc-xorg@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25840000-0000-0000-0000-0000000000d1', '25840000-0000-0000-0000-00000000000a', 'SPC Site',  'Ongoing Project', '25840000-0000-0000-0000-0000000000a4'),
  ('25840000-0000-0000-0000-0000000000d2', '25840000-0000-0000-0000-00000000000a', 'SPC Other', 'Ongoing Project', '25840000-0000-0000-0000-0000000000a7');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25840000-0000-0000-0000-0000000000e1', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'A', 'Item A', 'm3', 100, 12),
  ('25840000-0000-0000-0000-0000000000e2', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'B', 'Item B', 'm3', 100, 12),
  ('25840000-0000-0000-0000-0000000000e3', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'C', 'Item C', 'm3', 100, 12),
  ('25840000-0000-0000-0000-0000000000e4', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'D', 'Item D', 'm3', 100, 12);
insert into companies (id, org_id, name, type) values
  ('25840000-0000-0000-0000-0000000000c1', '25840000-0000-0000-0000-00000000000a', 'SPC Vendor One', 'Vendor'),
  ('25840000-0000-0000-0000-0000000000c2', '25840000-0000-0000-0000-00000000000a', 'SPC Vendor Two', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'SPC WO', 0, 'exclusive', 0);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e1', 100),
  ('25840000-0000-0000-0000-000000000702', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e2', 100),
  ('25840000-0000-0000-0000-000000000703', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e3', 100),
  ('25840000-0000-0000-0000-000000000704', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000b1', '25840000-0000-0000-0000-0000000000e4', 100);
insert into crews (id, org_id, code, name, kind, vendor_company_id) values
  ('25840000-0000-0000-0000-000000000801', '25840000-0000-0000-0000-00000000000a', 'V1-A', 'Vendor One crew', 'vendor', '25840000-0000-0000-0000-0000000000c1'),
  ('25840000-0000-0000-0000-000000000802', '25840000-0000-0000-0000-00000000000a', 'OWN-A', 'Own crew', 'own', null),
  ('25840000-0000-0000-0000-000000000803', '25840000-0000-0000-0000-00000000000a', 'V2-A', 'Vendor Two crew', 'vendor', '25840000-0000-0000-0000-0000000000c2');
insert into procurements (id, org_id, title, project_id, vendor_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('25840000-0000-0000-0000-0000000000f1', '25840000-0000-0000-0000-00000000000a', 'SPC subcontract', '25840000-0000-0000-0000-0000000000d1',
   '25840000-0000-0000-0000-0000000000c1', '25840000-0000-0000-0000-0000000000a4', 'Ordered', 4800, 4800,
   '25840000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency, work_order_id) values
  ('25840000-0000-0000-0000-000000000101', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000f1', 'PO-SPC-1', 'Issued', current_date, 'IDR',
   '25840000-0000-0000-0000-0000000000b1');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e1', 100, 12, 'm3'),
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e2', 100, 12, 'm3'),
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e3', 100, 12, 'm3'),
  ('25840000-0000-0000-0000-000000000101', 1, '25840000-0000-0000-0000-0000000000e4', 100, 12, 'm3');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('25840000-0000-0000-0000-000000000101', '25840000-0000-0000-0000-0000000000f1', 1, 'Issued', 4800, '25840000-0000-0000-0000-0000000000a4', 'standard');
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('25840000-0000-0000-0000-000000000201', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA 1', 'Issued',
   '25840000-0000-0000-0000-00000000000a/25840000-0000-0000-0000-0000000000d1/25840000-0000-0000-0000-000000000201/ba1.pdf');

-- Daily reports (validated unless noted). One report per work order and day; the lines carry the crew (OD-SPC-1).
create or replace function pg_temp.report(p_id text, p_date date, p_status text, p_superseded boolean default false) returns void language sql as $$
  insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at, superseded_at)
  values (('25840000-0000-0000-0000-000000000' || p_id)::uuid, '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1',
          '25840000-0000-0000-0000-0000000000b1', p_date, p_status, '25840000-0000-0000-0000-0000000000a5', now(),
          case when p_status = 'validated' then '25840000-0000-0000-0000-0000000000a4'::uuid end,
          case when p_status = 'validated' then now() end,
          case when p_superseded then now() end)
$$;
create or replace function pg_temp.pline(p_report text, p_pos int, p_wol text, p_qty numeric, p_crew text) returns void language sql as $$
  insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit, crew_id)
  values ('25840000-0000-0000-0000-00000000000a', ('25840000-0000-0000-0000-000000000' || p_report)::uuid, p_pos,
          ('25840000-0000-0000-0000-000000000' || p_wol)::uuid, p_qty, 'm3',
          case when p_crew is null then null else ('25840000-0000-0000-0000-000000000' || p_crew)::uuid end)
$$;
select pg_temp.report('901', '2026-03-03', 'validated');   select pg_temp.pline('901', 1, '701', 15.000, '801');
select pg_temp.report('902', '2026-03-09', 'validated');   select pg_temp.pline('902', 1, '701', 25.000, '801'); select pg_temp.pline('902', 2, '701', 4.000, '802');
select pg_temp.report('903', '2026-03-10', 'validated');   select pg_temp.pline('903', 1, '702', 12.500, '801'); select pg_temp.pline('903', 2, '703', 3.333, '801'); select pg_temp.pline('903', 3, '704', 6.000, '801');
select pg_temp.report('904', '2026-03-11', 'submitted');   select pg_temp.pline('904', 1, '701', 2.000, '801');
select pg_temp.report('905', '2026-03-12', 'validated', true); select pg_temp.pline('905', 1, '701', 7.000, '801');
select pg_temp.report('906', '2026-02-27', 'validated');   select pg_temp.pline('906', 1, '701', 9.000, '801');  -- outside the period

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_super() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;
create or replace function pg_temp.u(p_k text) returns uuid language sql as $$ select ('25840000-0000-0000-0000-0000000000' || p_k)::uuid $$;
-- a confirmed signed acceptance for the given cumulative quantities (appended as superuser, as the shipped tests do)
create or replace function pg_temp.accept(p_a numeric, p_b numeric, p_c numeric) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, confirmed_by, confirmed_at, confirm_basis, document_id)
  values (v, '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000d1', '25840000-0000-0000-0000-000000000101', current_date,
          'Confirmed', '25840000-0000-0000-0000-0000000000a4', '25840000-0000-0000-0000-0000000000a2', clock_timestamp(), 'standard',
          '25840000-0000-0000-0000-000000000201');
  insert into subcontract_acceptance_lines values (v, '25840000-0000-0000-0000-0000000000e1', p_a), (v, '25840000-0000-0000-0000-0000000000e2', p_b),
                                                  (v, '25840000-0000-0000-0000-0000000000e3', p_c);
  return v;
end $$;

create or replace function pg_temp.po() returns uuid language sql as $$ select '25840000-0000-0000-0000-000000000101'::uuid $$;
create or replace function pg_temp.cid() returns uuid language sql as $$ select current_setting('spc.c1')::uuid $$;
create or replace function pg_temp.d(p_path text[]) returns jsonb language sql as $$
  select subcontract_certificate_view(pg_temp.cid())->'derived' #> p_path
$$;
-- The card (Finance): A 10.00, B 8.40, C 9.99; D has none.
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 10.00, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e2'), 'm3',  8.40, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e3'), 'm3',  9.99, 'IDR', '2026-03-01');

-- Preparing (FR-SPC-004): the PM of the project, Finance and Admin; not an Engineer, not another project's PM, not Executive.
select pg_temp.act_as(pg_temp.u('a5'));
select throws_ok($$ select prepare_subcontract_certificate(pg_temp.po(), '2026-03-01') $$, '42501', null, 'AC-SPC-017 an Engineer cannot prepare a certificate');
select pg_temp.act_as(pg_temp.u('a7'));
select throws_ok($$ select prepare_subcontract_certificate(pg_temp.po(), '2026-03-01') $$, '42501', null, 'AC-SPC-017 a PM of another project cannot prepare it');
select pg_temp.act_as(pg_temp.u('a6'));
select throws_ok($$ select prepare_subcontract_certificate(pg_temp.po(), '2026-03-01') $$, '42501', null, 'AC-SPC-017 an Executive reads, never prepares');
select pg_temp.act_as(pg_temp.u('b1'));
select throws_ok($$ select prepare_subcontract_certificate(pg_temp.po(), '2026-03-01') $$, 'P0002', null, 'AC-SPC-017 another organisation''s purchase order reads as absent');
select pg_temp.act_as(pg_temp.u('a4'));
select throws_ok($$ select prepare_subcontract_certificate(pg_temp.po(), '2026-03-10') $$, '23514', null, 'FR-SPC-004 the period is a calendar month');
select set_config('spc.c1', prepare_subcontract_certificate(pg_temp.po(), '2026-03-01')::text, true);
select throws_ok($$ select prepare_subcontract_certificate(pg_temp.po(), '2026-03-01') $$, '23505', null, 'FR-SPC-004 at most one non-cancelled certificate per PO and period');

-- AC-SPC-001 the hand calculation.
select is((pg_temp.d('{gross}'))::text::numeric, 538.30, 'AC-SPC-001 gross is 538.30');
select is((select jsonb_object_agg(x->>'item_code', (x->>'amount')::numeric) from jsonb_array_elements(pg_temp.d('{lines}')) x),
  '{"A": 400.00, "B": 105.00, "C": 33.30}'::jsonb, 'AC-SPC-001 lines are A 400.00, B 105.00, C 33.30 (33.29667 rounds to 33.30)');
select is((select (x->>'measured_quantity')::numeric from jsonb_array_elements(pg_temp.d('{lines}')) x where x->>'item_code' = 'A'), 40.000,
  'AC-SPC-001 A''s measured quantity is the sum of the two validated vendor-crew days (15.000 + 25.000)');
select is((select jsonb_object_agg(x->>'item_code' || ':' || (x->>'reason'), (x->>'quantity')::numeric)
             from jsonb_array_elements(pg_temp.d('{excluded}')) x),
  '{"A:not_vendor_crew": 4.000, "A:report_not_validated": 2.000, "A:report_superseded": 7.000, "D:unrated_no_rate": 6.000}'::jsonb,
  'AC-SPC-001 D (no card line), the own-crew line, the unvalidated and the superseded line are listed excluded with their reasons; the out-of-period line is not');
select is(pg_temp.d('{unrated}')->0->>'item_code', 'D', 'AC-SPC-001 D is the one unrated item');
select is((select count(*)::int from jsonb_array_elements(pg_temp.d('{lines}')) x where (x->>'cap_ok')::boolean), 0,
  'FR-SPC-008 with no signed acceptance every item is over its verified cap, and says so');
select is((select bool_and((x->>'verified_short')::boolean) from jsonb_array_elements(pg_temp.d('{lines}')) x), true,
  'FR-SPC-008 "verified is short" is flagged so the screen can offer "prepare acceptance"');

-- AC-SPC-002 the backcharge and the net.
select set_config('spc.bc', record_subcontract_backcharge(pg_temp.u('c1'), pg_temp.u('d1'), pg_temp.u('b1'), 38.30, 'IDR', 'rework', 'redo slab')::text, true);
select lives_ok($$ select set_certificate_backcharge(pg_temp.cid(), current_setting('spc.bc')::uuid, true) $$, 'FR-SPC-009 the backcharge is included');
select is(pg_temp.d('{net}')::text::numeric, 500.00, 'AC-SPC-002 net is exactly 500.00 (538.30 less 38.30)');
select is(pg_temp.d('{backcharge_total}')::text::numeric, 38.30, 'AC-SPC-002 and the backcharge is shown apart from gross');

-- AC-SPC-005 a card rate above the PO rate, or in another currency, leaves the item unrated.
select pg_temp.act_as(pg_temp.u('a2'));
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e4'), 'm3', 13.00, 'IDR', '2026-03-01');
select pg_temp.act_as(pg_temp.u('a4'));
select is((select x->>'reason' from jsonb_array_elements(pg_temp.d('{unrated}')) x where x->>'item_code' = 'D'), 'unrated_above_po_rate',
  'AC-SPC-005 a card rate above the PO line rate (13.00 > 12.00) leaves the item unrated');
select is(pg_temp.d('{gross}')::text::numeric, 538.30, 'AC-SPC-005 and it contributes 0');
reset role;
set local session_replication_role = replica;
update subcontractor_rate_lines set currency = 'USD' where boq_item_id = pg_temp.u('e4');
set local session_replication_role = origin;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a4'));
select is((select x->>'reason' from jsonb_array_elements(pg_temp.d('{unrated}')) x where x->>'item_code' = 'D'), 'unrated_currency',
  'AC-SPC-005 a card rate in another currency than the PO leaves the item unrated');

-- FR-SPC-007 a measured day set aside needs a reason and stays available.
select throws_ok($$ select set_certificate_deselection(pg_temp.cid(), '2026-03-03', '25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-000000000801', true) $$,
  '22023', null, 'FR-SPC-007 setting a line aside needs a reason');
select lives_ok($$ select set_certificate_deselection(pg_temp.cid(), '2026-03-03', '25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-000000000801', true, 'disputed') $$,
  'FR-SPC-007 a measured day can be set aside with a reason');
select is((select (x->>'measured_quantity')::numeric from jsonb_array_elements(pg_temp.d('{lines}')) x where x->>'item_code' = 'A'), 25.000,
  'FR-SPC-007 A drops to 25.000 and the set-aside day is listed excluded as deselected');
select lives_ok($$ select set_certificate_deselection(pg_temp.cid(), '2026-03-03', '25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-000000000801', false) $$,
  'FR-SPC-007 and it can be put back');
select is(pg_temp.d('{gross}')::text::numeric, 538.30, 'FR-SPC-007 gross is 538.30 again');

-- A client never writes a quantity or an amount (FR-SPC-005): no DML at all.
select throws_ok($$ insert into subcontract_certificate_lines (certificate_id, boq_item_id, item_code, unit, measured_quantity, rate, po_rate)
  values (pg_temp.cid(), pg_temp.u('e1'), 'A', 'm3', 1, 1, 1) $$, '42501', null, 'FR-SPC-005 a client cannot insert a certificate line');
select throws_ok($$ update subcontract_certificates set gross = 1 where id = pg_temp.cid() $$, '42501', null, 'FR-SPC-005 a client cannot write a total');

-- Rated and signed: submit freezes (AC-SPC-008). The unrated D (USD card line) blocks neither the submit nor, later, the approval of a certificate whose unrated list is empty.
select lives_ok($$ select submit_subcontract_certificate(pg_temp.cid()) $$, 'FR-SPC-011 the preparer submits');
select is((select status from subcontract_certificates where id = pg_temp.cid()), 'submitted', 'FR-SPC-011 the certificate is submitted');
select is((select count(*)::int from subcontract_certificate_lines where certificate_id = pg_temp.cid()), 3, 'FR-SPC-011 three lines are frozen');
select is((select gross::text || '/' || backcharge_total::text || '/' || net::text from subcontract_certificates where id = pg_temp.cid()), '538.30/38.30/500.00',
  'AC-SPC-002 the same figures are stored at submit: gross 538.30, backcharge 38.30, net 500.00');
select is((select count(*)::int from subcontract_certificate_claims where certificate_id = pg_temp.cid()), 4,
  'FR-SPC-011 the four measured days (A on the 3rd and 9th, B, C) are claimed');
select throws_ok($$ select submit_subcontract_certificate(pg_temp.cid()) $$, '23514', null, 'AC-SPC-012 a second submit of the same certificate is refused');
select is((select count(*)::int from subcontract_certificate_claims where certificate_id = pg_temp.cid()), 4, 'AC-SPC-012 and takes no second claim');

-- AC-SPC-008 the snapshot does not move when a report is corrected or the card changes.
reset role;
update dsr_progress_lines set quantity = 30.000 where report_id = '25840000-0000-0000-0000-000000000901';
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e2'), 'm3', 9.00, 'IDR', '2026-06-01');
select pg_temp.act_as(pg_temp.u('a4'));
select is(pg_temp.d('{gross}')::text::numeric, 538.30, 'AC-SPC-008 after a later report correction and a card change the submitted snapshot is unchanged');
select is((select measured_quantity from subcontract_certificate_lines where certificate_id = pg_temp.cid() and item_code = 'A'), 40.000,
  'AC-SPC-008 the frozen quantity of A is still 40.000');
-- return -> resubmit reflects them
select pg_temp.act_as(pg_temp.u('a2'));
select lives_ok($$ select return_subcontract_certificate(pg_temp.cid(), 'report 3 March was corrected') $$, 'AC-SPC-008 Finance returns it with a reason');
select is((select count(*)::int from subcontract_certificate_claims where certificate_id = pg_temp.cid()), 0, 'AC-SPC-008 a returned certificate holds no claim');
select is((select count(*)::int from subcontract_certificate_lines where certificate_id = pg_temp.cid()), 0, 'AC-SPC-008 and no frozen line');
select pg_temp.act_as(pg_temp.u('a4'));
select is(pg_temp.d('{gross}')::text::numeric, 688.30, 'AC-SPC-008 after return the derive reflects the corrected 3 March quantity (A 55.000 x 10.00 = 550.00, gross 688.30)');
select lives_ok($$ select submit_subcontract_certificate(pg_temp.cid()) $$, 'AC-SPC-008 and it can be resubmitted');
select is((select gross from subcontract_certificates where id = pg_temp.cid()), 688.30, 'AC-SPC-008 the resubmitted snapshot carries the corrected figures');

-- Visibility of certificates (AC-SPC-017).
select is((select count(*)::int from subcontract_certificates), 1, 'AC-SPC-017 the project''s PM reads the certificate');
select pg_temp.act_as(pg_temp.u('a7'));
select is((select count(*)::int from subcontract_certificates), 0, 'AC-SPC-017 another project''s PM reads none');
select throws_ok($$ select subcontract_certificate_view(pg_temp.cid()) $$, 'P0002', null, 'AC-SPC-017 nor its view');
select pg_temp.act_as(pg_temp.u('a5'));
select is((select count(*)::int from subcontract_certificates), 0, 'AC-SPC-017 an Engineer reads none');
select is((select count(*)::int from subcontract_backcharges), 0, 'AC-SPC-017 nor the backcharges');
select pg_temp.act_as(pg_temp.u('b1'));
select is((select count(*)::int from subcontract_certificates), 0, 'AC-SPC-017 another organisation reads none');
select pg_temp.act_as(pg_temp.u('a6'));
select is((select count(*)::int from subcontract_certificates), 1, 'AC-SPC-017 an Executive reads it');
reset role;

select * from finish();
rollback;
