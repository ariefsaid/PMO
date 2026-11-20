-- #2584 S1: the subcontractor rate card and the crew on a progress line (AC-SPC-004, AC-SPC-017 rate rows; FR-SPC-001..003, OD-SPC-1/2/3).
-- Migration under test: 1135_subcontractor_rate_card.sql. Plan docs/plans/2026-11-20-subcontractor-progress-certificate.md.
begin;
create extension if not exists pgtap;
select plan(28);

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

-- Finance keeps the card: A 10.00 from March 2026.
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select lives_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 10.00, 'IDR', '2026-03-01') $$,
  'AC-SPC-004 Finance sets a rate from a month start');
select throws_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e2'), 'm3', 8.40, 'IDR', '2026-03-15') $$, '23514', null,
  'AC-SPC-004 an effective_from that is not a month start is refused');
select throws_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e2'), 'm3', 8.405, 'IDR', '2026-03-01') $$, '22023', null,
  'AC-SPC-004 a rate with more than 2 decimals is refused');
-- A change from April ends March's line the day before; March keeps the version current on its dates.
select lives_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 11.00, 'IDR', '2026-04-01') $$,
  'AC-SPC-004 a rate change from next month is accepted');
select is((select jsonb_agg(jsonb_build_array(version, rate, effective_from, effective_to) order by version)::text from subcontractor_rate_lines
            where boq_item_id = pg_temp.u('e1')),
  '[[1, 10.00, "2026-03-01", "2026-03-31"], [2, 11.00, "2026-04-01", null]]',
  'AC-SPC-004 the earlier period keeps version 1 (10.00, ended 31 March); version 2 is open-ended from April');
select throws_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 9.00, 'IDR', '2026-03-01', '2026-03-31') $$, '23P01', null,
  'AC-SPC-004 an overlapping window of the same vendor and item is refused');
select throws_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 9.00, 'IDR', '2026-05-01', '2026-05-20') $$, '23514', null,
  'AC-SPC-004 a window must end on a month end');
select lives_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 9.00, 'IDR', '2026-06-01') $$,
  'AC-SPC-004 a later change from June ends April''s open-ended line (a change, not an overlap)');
select is((select effective_to from subcontractor_rate_lines where boq_item_id = pg_temp.u('e1') and version = 2), '2026-05-31'::date,
  'AC-SPC-004 and April''s line now ends on 31 May');
-- Roles and tenancy (FR-SPC-003, AC-SPC-017).
select pg_temp.act_as(pg_temp.u('a4'));
select throws_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e3'), 'm3', 9.99, 'IDR', '2026-03-01') $$, '42501', null,
  'AC-SPC-017 a Project Manager cannot write the rate card');
select is((select count(*)::int from subcontractor_rate_lines), 3, 'AC-SPC-017 the PM of a project with a subcontract to this vendor reads its rate lines');
select pg_temp.act_as(pg_temp.u('a7'));
select is((select count(*)::int from subcontractor_rate_lines), 0, 'AC-SPC-017 a PM of another project reads none');
select pg_temp.act_as(pg_temp.u('a5'));
select is((select count(*)::int from subcontractor_rate_lines), 0, 'AC-SPC-017 an Engineer reads none (rate is cost-sensitive)');
select throws_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e3'), 'm3', 9.99, 'IDR', '2026-03-01') $$, '42501', null,
  'AC-SPC-017 an Engineer cannot write it');
select pg_temp.act_as(pg_temp.u('a6'));
select is((select count(*)::int from subcontractor_rate_lines), 3, 'AC-SPC-017 an Executive reads the card');
select pg_temp.act_as(pg_temp.u('b1'));
select is((select count(*)::int from subcontractor_rate_lines), 0, 'AC-SPC-017 another organisation reads none');
select throws_ok($$ select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e3'), 'm3', 9.99, 'IDR', '2026-03-01') $$, 'P0002', null,
  'AC-SPC-017 another organisation''s vendor reads as absent');
select pg_temp.act_as(pg_temp.u('a2'));
select throws_ok($$ update subcontractor_rate_lines set rate = 1 $$, '42501', null, 'AC-SPC-017 no client UPDATE on the card, even for Finance');
select throws_ok($$ delete from subcontractor_rate_lines $$, '42501', null, 'AC-SPC-017 no client DELETE on the card');
reset role;
select is((select count(*)::int from audit_events where action = 'subcontractor_rate.set'), 3,
  'AC-SPC-002 every accepted change is audited (three rate writes, three audit rows)');
select throws_ok($$ update subcontractor_rate_lines set rate = 1 $$, '42501', null, 'AC-SPC-002 a rate line is not edited even as the table owner');
select throws_ok($$ delete from subcontractor_rate_lines $$, '42501', null, 'AC-SPC-002 a rate line is not deleted even as the table owner');

-- OD-SPC-1: the crew on a progress line. A PM enters a report whose line names a crew; a foreign crew is refused.
set local role authenticated; select pg_temp.act_as(pg_temp.u('a4'));
select set_config('spc.rep', dsr_save_draft(jsonb_build_object('work_order_id', pg_temp.u('b1'), 'work_date', '2026-03-20',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '25840000-0000-0000-0000-000000000701', 'quantity', 5,
                                                   'crew_id', '25840000-0000-0000-0000-000000000801'))))::text, true);
select is((select crew_id::text from dsr_progress_lines where report_id = current_setting('spc.rep')::uuid), '25840000-0000-0000-0000-000000000801',
  'OD-SPC-1 a progress line stores its crew');
select throws_ok($$ select dsr_save_draft(jsonb_build_object('id', current_setting('spc.rep'),
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '25840000-0000-0000-0000-000000000701', 'quantity', 5,
                                                   'crew_id', gen_random_uuid())))) $$, '23503', null,
  'OD-SPC-1 a crew that is not this organisation''s is refused');
select lives_ok($$ select dsr_save_draft(jsonb_build_object('id', current_setting('spc.rep'),
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '25840000-0000-0000-0000-000000000701', 'quantity', 5)))) $$,
  'OD-SPC-1 a line with no crew is still accepted');
select is((select crew_id from dsr_progress_lines where report_id = current_setting('spc.rep')::uuid), null,
  'OD-SPC-1 and stays unattributed (it can never enter a certificate)');
-- A correction carries the crew of the line it corrects.
select lives_ok($$ select dsr_correct('25840000-0000-0000-0000-000000000901', 'quantity re-measured') $$, 'OD-SPC-1 a validated report can still be corrected');
select is((select count(*)::int from dsr_progress_lines l join daily_site_reports r on r.id = l.report_id
            where r.supersedes_id = '25840000-0000-0000-0000-000000000901' and l.crew_id = '25840000-0000-0000-0000-000000000801'), 1,
  'OD-SPC-1 the correction keeps the crew on its copied line');
reset role;

select * from finish();
rollback;
