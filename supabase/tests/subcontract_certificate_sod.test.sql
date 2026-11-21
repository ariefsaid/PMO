-- #2584 S3 (money path): separation of duties, the over-claim rules and the immutability of an approved subcontract certificate
-- (AC-SPC-006, 007, 009, 012, 015, 017; FR-SPC-012, 013; NFR-SPC-002). Migrations under test: 1185 and 1186.
-- The SoD line and the cap pre-check are mutation-checked in subcontract_certificate_mutation.test.sql (AC-SPC-018).
begin;
create extension if not exists pgtap;
select plan(36);

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
create or replace function pg_temp.cid(k text) returns uuid language sql as $$ select current_setting('spc.' || k)::uuid $$;
-- Extra measured work: April (A 1.000) and May (A 1.000), validated, vendor crew.
select pg_temp.report('911', '2026-04-05', 'validated'); select pg_temp.pline('911', 1, '701', 1.000, '801');
select pg_temp.report('912', '2026-05-05', 'validated'); select pg_temp.pline('912', 1, '701', 1.000, '801');
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 10.00, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e2'), 'm3',  8.40, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e3'), 'm3',  9.99, 'IDR', '2026-03-01');
-- March: prepared and submitted by Finance 1 (a2), with the 38.30 backcharge.
select set_config('spc.mar', prepare_subcontract_certificate(pg_temp.po(), '2026-03-01')::text, true);
select set_config('spc.bc', record_subcontract_backcharge(pg_temp.u('c1'), pg_temp.u('d1'), pg_temp.u('b1'), 38.30, 'IDR', 'rework')::text, true);
select set_certificate_backcharge(pg_temp.cid('mar'), pg_temp.cid('bc'), true);
select set_certificate_deselection(pg_temp.cid('mar'), '2026-03-10', '25840000-0000-0000-0000-000000000704', '25840000-0000-0000-0000-000000000801', true, 'no rate agreed');
select submit_subcontract_certificate(pg_temp.cid('mar'));

-- AC-SPC-006 separation of duties.
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, '42501', 'separation of duties: a certificate needs a different approver',
  'AC-SPC-006 the submitter (and preparer) cannot approve the certificate');
select is((select status from subcontract_certificates where id = pg_temp.cid('mar')), 'submitted', 'AC-SPC-006 it stays submitted');
select pg_temp.act_as(pg_temp.u('a4'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, '42501', 'only Finance and Admin approve a certificate', 'AC-SPC-017 a Project Manager cannot approve');
select pg_temp.act_as(pg_temp.u('a6'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, '42501', 'only Finance and Admin approve a certificate', 'AC-SPC-017 an Executive cannot approve (OD-SPC-9 default)');
select pg_temp.act_as(pg_temp.u('a5'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, '42501', 'only Finance and Admin approve a certificate', 'AC-SPC-017 an Engineer cannot approve');
select pg_temp.act_as(pg_temp.u('b1'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, 'P0002', 'certificate not found', 'AC-SPC-017 another organisation''s Finance sees no such certificate');
-- AC-SPC-009 over the cap: nothing is signed for 40.
select pg_temp.act_as(pg_temp.u('a3'));
select throws_like($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, 'line A cannot be approved: verified 0, PO 100.000, billed 0, this certificate 40.000',
  'AC-SPC-009 approval is refused naming item, verified, PO quantity and billed');
select is((select status from subcontract_certificates where id = pg_temp.cid('mar')), 'submitted', 'AC-SPC-009 and it stays submitted');
reset role;
select pg_temp.accept(40, 12.5, 3.333);
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select lives_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, 'AC-SPC-006/009 a different Finance user approves once the acceptance is confirmed for 40');
select is((select status || ':' || (approved_by = pg_temp.u('a3'))::text from subcontract_certificates where id = pg_temp.cid('mar')), 'approved:true',
  'AC-SPC-006 the certificate is approved by the other user');

-- AC-SPC-012 April is submitted by Admin (the per-PO lock under two real sessions is subcontract_certificate_concurrency.test.sql).
select pg_temp.act_as(pg_temp.u('a1'));
select set_config('spc.apr', prepare_subcontract_certificate(pg_temp.po(), '2026-04-01')::text, true);
select lives_ok($$ select submit_subcontract_certificate(pg_temp.cid('apr')) $$, 'AC-SPC-012 once released, exactly one submit takes the claim');
select is((select count(*)::int from subcontract_certificate_claims where certificate_id = pg_temp.cid('apr')), 1, 'AC-SPC-012 one claim');
select throws_ok($$ select submit_subcontract_certificate(pg_temp.cid('apr')) $$, '23514', null, 'AC-SPC-012 the repeat is refused');
-- two certificates that would claim the same measured line: the second (a certificate of another PO of the same vendor, here forced
-- at the table) is stopped by the unique index on the claim key, whatever the PO.
reset role;
select set_config('pmo.spc_freeze', 'on', true);
select throws_ok($$ insert into subcontract_certificate_claims (certificate_id, work_order_id, work_date, work_order_line_id, crew_id, boq_item_id, quantity)
  values (pg_temp.cid('apr'), pg_temp.u('b1'), '2026-03-03', '25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-000000000801', pg_temp.u('e1'), 15.000) $$,
  '23505', null, 'AC-SPC-012 a second live claim on the same work order, day, contract line and crew is refused by the database');
select set_config('pmo.spc_freeze', '', true);
-- a second PO of the same vendor on the same work: its March certificate finds the work already certified
insert into procurements (id, org_id, title, project_id, vendor_id, requested_by_id, status, total_value, approved_total_value, approved_by_id, budget_category, currency, is_subcontract)
values ('25840000-0000-0000-0000-0000000000f2', '25840000-0000-0000-0000-00000000000a', 'SPC subcontract 2', pg_temp.u('d1'), pg_temp.u('c1'), pg_temp.u('a4'),
        'Ordered', 4800, 4800, pg_temp.u('a6'), 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency, work_order_id)
values ('25840000-0000-0000-0000-000000000102', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000f2', 'PO-SPC-2', 'Issued', current_date, 'IDR', pg_temp.u('b1'));
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit)
  select '25840000-0000-0000-0000-000000000102', 1, id, 100, 12, 'm3' from boq_items where project_id = pg_temp.u('d1');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis)
  values ('25840000-0000-0000-0000-000000000102', '25840000-0000-0000-0000-0000000000f2', 1, 'Issued', 4800, pg_temp.u('a4'), 'standard');
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select set_config('spc.mar2', prepare_subcontract_certificate('25840000-0000-0000-0000-000000000102', '2026-03-01')::text, true);
select is((select jsonb_array_length(subcontract_certificate_view(pg_temp.cid('mar2'))->'derived'->'lines')), 0,
  'AC-SPC-012 a certificate of another PO of the same vendor finds March''s work already certified and measures nothing');
select is((select count(*)::int from jsonb_array_elements(subcontract_certificate_view(pg_temp.cid('mar2'))->'derived'->'excluded') x
            where x->>'reason' = 'already_certified' and x->>'period_start' = '2026-03-01'), 4,
  'AC-SPC-012 the four claimed days are listed "already certified" with the period that holds them');
select throws_ok($$ select submit_subcontract_certificate(pg_temp.cid('mar2')) $$, '23514', null, 'AC-SPC-012 and its submit is refused: one live claim only');
select lives_ok($$ select cancel_subcontract_certificate(pg_temp.cid('mar2'), 'duplicate') $$, 'FR-SPC-017 a draft can be cancelled');
select pg_temp.act_as(pg_temp.u('a1'));
select throws_ok($$ select set_certificate_backcharge(pg_temp.cid('apr'), pg_temp.cid('bc'), true) $$, '42501', null,
  'FR-SPC-009 a submitted certificate''s backcharges are fixed (April is submitted)');
reset role;

-- AC-SPC-007 an approved certificate is immutable: lines, rates, backcharges, totals, claims — for any caller, owner included.
select throws_ok($$ update subcontract_certificate_lines set rate = 99 where certificate_id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 a line''s rate cannot be updated');
select throws_ok($$ update subcontract_certificate_lines set measured_quantity = 1 where certificate_id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 a line''s quantity cannot be updated');
select throws_ok($$ delete from subcontract_certificate_lines where certificate_id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 a line cannot be deleted');
select set_config('pmo.spc_release', 'on', true);
select throws_ok($$ delete from subcontract_certificate_lines where certificate_id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 not even with the release setting on (the status decides)');
select throws_ok($$ delete from subcontract_certificate_claims where certificate_id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 an approved certificate''s claims cannot be deleted');
select throws_ok($$ update subcontract_backcharges set claimed_by_certificate_id = null where id = pg_temp.cid('bc') $$, '42501', null, 'AC-SPC-007 its backcharge claim is fixed');
select set_config('pmo.spc_release', '', true);
select throws_ok($$ update subcontract_backcharges set amount = 1 where id = pg_temp.cid('bc') $$, '42501', null, 'AC-SPC-007 a backcharge amount cannot be edited');
select throws_ok($$ delete from subcontract_certificate_backcharges where certificate_id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 the backcharge selection cannot be deleted');
select throws_ok($$ update subcontract_certificates set gross = 1, net = 1 - backcharge_total where id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 the totals cannot be updated');
select throws_ok($$ update subcontract_certificates set status = 'billed' where id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 the status moves only inside the RPCs (no direct billed)');
select throws_ok($$ update subcontract_certificates set status = 'draft' where id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 and never back to draft');
select throws_ok($$ delete from subcontract_certificates where id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 a certificate is never deleted');
select throws_ok($$ update subcontract_certificates set vendor_company_id = pg_temp.u('c2') where id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 its vendor never changes');
select set_config('pmo.spc_transition', 'on', true);
select throws_ok($$ update subcontract_certificates set gross = 1, net = 1 - backcharge_total where id = pg_temp.cid('mar') $$, '42501', null, 'AC-SPC-007 and the totals of an approved certificate are fixed even inside a transition');
select set_config('pmo.spc_transition', '', true);

-- AC-SPC-015 a negative net is refused at approval (May: gross 10.00, backcharge 600).
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select set_config('spc.may', prepare_subcontract_certificate(pg_temp.po(), '2026-05-01')::text, true);
select set_config('spc.bc2', record_subcontract_backcharge(pg_temp.u('c1'), pg_temp.u('d1'), null, 600.00, 'IDR', 'damaged', 'crane damage')::text, true);
select set_certificate_backcharge(pg_temp.cid('may'), pg_temp.cid('bc2'), true);
select submit_subcontract_certificate(pg_temp.cid('may'));
select pg_temp.act_as(pg_temp.u('a3'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('may')) $$, '23514', null, 'AC-SPC-015 a net below zero is refused at approval (OD-SPC-8)');
select is((select net from subcontract_certificates where id = pg_temp.cid('may')), -590.00, 'AC-SPC-015 the stored net shows the shortfall (10.00 - 600.00)');
-- a backcharge cannot be archived while in a live certificate; a free one can
select throws_ok($$ select archive_subcontract_backcharge(pg_temp.cid('bc2')) $$, '23514', null, 'FR-SPC-009 a backcharge in a live certificate cannot be archived');
reset role;

select * from finish();
rollback;
