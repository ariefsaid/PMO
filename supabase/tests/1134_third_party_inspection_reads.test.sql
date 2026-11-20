-- 1134_third_party_inspection_reads.test.sql — #2580 (docs/specs/third-party-inspections.spec.md), the spec's hand-worked example.
-- Migration under test: 1134_third_party_inspection_reads.sql (tpi_costs, work_order_inspection_prerequisites, run_tpi_overdue_sweep).
-- AC-TPI-001 cost per inspection per currency, Draft orders and other cases' records excluded, Engineer sees no amounts ·
-- AC-TPI-007 the prerequisite and the completeness rule · AC-TPI-011 the overdue notice fires once per recipient.
-- Every denial asserts the errcode AND the message. Fixtures are written as the table owner.
begin;
create extension if not exists pgtap;
select plan(23);

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into organizations (id, name, default_currency) values ('25800000-0000-0000-0000-00000000000a', 'TPR Org', 'USD'), ('25800000-0000-0000-0000-00000000000b', 'TPR Other', 'USD');
insert into auth.users (id, email) values
  ('25800000-0000-0000-0000-0000000000a1', 'tpr-admin@example.com'), ('25800000-0000-0000-0000-0000000000a3', 'tpr-pm@example.com'), ('25800000-0000-0000-0000-0000000000a4', 'tpr-eng@example.com'),
  ('25800000-0000-0000-0000-0000000000a6', 'tpr-fin@example.com'), ('25800000-0000-0000-0000-0000000000a7', 'tpr-exec@example.com'), ('25800000-0000-0000-0000-0000000000b1', 'tpr-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25800000-0000-0000-0000-0000000000a1', '25800000-0000-0000-0000-00000000000a', 'TPR Admin', 'tpr-admin@example.com', 'Admin', 'active'),
  ('25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-00000000000a', 'TPR PM', 'tpr-pm@example.com', 'Project Manager', 'active'),
  ('25800000-0000-0000-0000-0000000000a4', '25800000-0000-0000-0000-00000000000a', 'TPR Eng', 'tpr-eng@example.com', 'Engineer', 'active'),
  ('25800000-0000-0000-0000-0000000000a6', '25800000-0000-0000-0000-00000000000a', 'TPR Fin', 'tpr-fin@example.com', 'Finance', 'active'),
  ('25800000-0000-0000-0000-0000000000a7', '25800000-0000-0000-0000-00000000000a', 'TPR Exec', 'tpr-exec@example.com', 'Executive', 'active'),
  ('25800000-0000-0000-0000-0000000000b1', '25800000-0000-0000-0000-00000000000b', 'TPR XOrg', 'tpr-xorg@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-00000000000a', 'TPR Site', 'Ongoing Project', '25800000-0000-0000-0000-0000000000a3'),
  ('25800000-0000-0000-0000-0000000000d9', '25800000-0000-0000-0000-00000000000b', 'TPR Other Site', 'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'WO-1', 'Issued', 10000, 'exclusive', 0),
  ('25800000-0000-0000-0000-000000000404', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'WO-2 (a failed test)', 'Issued', 10000, 'exclusive', 0);
insert into procurements (id, org_id, title, project_id, requested_by_id, status) values
  ('25800000-0000-0000-0000-000000000601', '25800000-0000-0000-0000-00000000000a', 'case A', '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000602', '25800000-0000-0000-0000-00000000000a', 'case B', '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000603', '25800000-0000-0000-0000-00000000000a', 'case not linked', '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft');

-- the hand-worked example: A reported pass, B executed (no report), C unlinked EUR estimate; E overdue; F cancelled; D a failed test on WO-2
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, estimate, estimate_currency, required_for, status, result, created_by, procurement_id, reported_at, reported_by) values
  ('25800000-0000-0000-0000-000000000a01', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'A soil test', '2026-11-02', null, null, '{billing}', 'reported', 'pass', '25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-000000000601', now(), '25800000-0000-0000-0000-0000000000a3'),
  ('25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'B weld test', '2026-12-01', null, null, '{billing}', 'executed', 'pending', '25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-000000000602', null, null),
  ('25800000-0000-0000-0000-000000000a03', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'C tracked',   '2026-12-01', 500, 'EUR', '{}', 'requested', 'pending', '25800000-0000-0000-0000-0000000000a3', null, null, null),
  ('25800000-0000-0000-0000-000000000a05', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'E overdue',   '2026-11-01', null, null, '{}', 'requested', 'pending', '25800000-0000-0000-0000-0000000000a4', null, null, null),
  ('25800000-0000-0000-0000-000000000a06', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'F cancelled', '2026-11-01', null, null, '{}', 'requested', 'pending', '25800000-0000-0000-0000-0000000000a4', null, null, null),
  ('25800000-0000-0000-0000-000000000a04', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000404', '25800000-0000-0000-0000-0000000000d1', 'D failed',    '2026-12-01', null, null, '{billing}', 'reported', 'fail', '25800000-0000-0000-0000-0000000000a3', null, now(), '25800000-0000-0000-0000-0000000000a3');
update third_party_inspections set status = 'cancelled', cancelled_at = now(), cancelled_by = '25800000-0000-0000-0000-0000000000a3', cancel_reason = 'x' where id = '25800000-0000-0000-0000-000000000a06';
-- the linked cases' records, written AFTER the links so FR-TPI-021 stamps the work order (they are inserted naming none)
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('25800000-0000-0000-0000-000000000611', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'PO-A', 'Issued', '2026-11-16', 1000, 'USD'),
  ('25800000-0000-0000-0000-000000000612', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000602', 'PO-B1', 'Acknowledged', '2026-11-16', 2500, 'USD'),
  ('25800000-0000-0000-0000-000000000613', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000602', 'PO-B2', 'Draft', '2026-11-16', 800, 'USD'),
  ('25800000-0000-0000-0000-000000000614', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000603', 'PO-X', 'Issued', '2026-11-16', 5000, 'USD');
update purchase_orders set work_order_id = '25800000-0000-0000-0000-000000000401' where id = '25800000-0000-0000-0000-000000000614';   -- names the work order, but its case is not linked
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, tax_treatment, tax_amount, currency, amount) values
  ('25800000-0000-0000-0000-000000000621', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000601', 'VI-A', '2026-11-17', 'Received', 'exclusive', 0, 'USD', 1000),
  ('25800000-0000-0000-0000-000000000622', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000602', 'VI-B', '2026-11-17', 'Received', 'exclusive', 0, 'USD', 2400),
  ('25800000-0000-0000-0000-000000000623', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000602', 'VI-B-void', '2026-11-17', 'Received', 'exclusive', 0, 'USD', 77);
set local pmo.bill_void = 'on';
update procurement_invoices set voided_at = '2026-11-18 00:00', erp_cancelled_at = '2026-11-18 00:00', void_reason = 'dup', voided_by = '25800000-0000-0000-0000-0000000000a3' where id = '25800000-0000-0000-0000-000000000623';
set local pmo.bill_void = 'off';

-- ── AC-TPI-001 ───────────────────────────────────────────────────────────────────────────────────────
select is((select count(*) from purchase_orders where work_order_id = '25800000-0000-0000-0000-000000000401' and procurement_id in ('25800000-0000-0000-0000-000000000601','25800000-0000-0000-0000-000000000602')), 3::bigint,
  'FR-TPI-021: the linked cases'' orders were stamped with the work order on insert (fixture precondition)');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select is((select jsonb_agg(jsonb_build_array(inspection_id, currency, committed, billed) order by inspection_id) from tpi_costs('25800000-0000-0000-0000-000000000401')),
  '[["25800000-0000-0000-0000-000000000a01","USD",1000.00,1000.00],["25800000-0000-0000-0000-000000000a02","USD",2500.00,2400.00],["25800000-0000-0000-0000-000000000a03",null,null,null],["25800000-0000-0000-0000-000000000a05",null,null,null]]'::jsonb,
  'AC-TPI-001: A 1,000/1,000 and B 2,500/2,400 (B''s 800 Draft order, its voided bill and the unlinked case''s 5,000 excluded); C, E have no purchase; cancelled F absent for a money role');
select is((select sum(committed)::text || '/' || sum(billed)::text from tpi_costs('25800000-0000-0000-0000-000000000401') where currency = 'USD'), '3500.00/3400.00',
  'AC-TPI-001: work order totals 3,500 committed / 3,400 billed USD');
select is((select count(*) from tpi_costs('25800000-0000-0000-0000-000000000401') where currency = 'EUR'), 0::bigint,
  'AC-TPI-001: C''s EUR estimate is in no figure and no EUR is added to USD');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select is((select jsonb_agg(jsonb_build_array(inspection_id, currency, committed, billed) order by inspection_id) from tpi_costs('25800000-0000-0000-0000-000000000401')),
  '[["25800000-0000-0000-0000-000000000a01",null,null,null],["25800000-0000-0000-0000-000000000a02",null,null,null],["25800000-0000-0000-0000-000000000a03",null,null,null],["25800000-0000-0000-0000-000000000a05",null,null,null],["25800000-0000-0000-0000-000000000a06",null,null,null]]'::jsonb,
  'AC-TPI-001: an Engineer receives the inspections with no amounts (the server fence, not the screen)');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a7');
select is((select sum(committed)::text from tpi_costs('25800000-0000-0000-0000-000000000401')), '3500.00', 'FR-TPI-008: an Executive reads the amounts');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a6');
select is((select sum(billed)::text from tpi_costs('25800000-0000-0000-0000-000000000401')), '3400.00', 'FR-TPI-008: Finance reads the amounts');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000b1');
select throws_ok($$ select * from tpi_costs('25800000-0000-0000-0000-000000000401') $$, 'P0002', 'work order not found', 'AC-TPI-013: another organisation reads no cost (the work order reads as absent)');

-- ── AC-TPI-007 the prerequisite ──────────────────────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select is((select work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', null, 'billing') ->> 'complete'), 'false', 'AC-TPI-007: billing is not complete while B has no report');
select is((select jsonb_agg(e ->> 'title' order by e ->> 'title') from jsonb_array_elements(work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', null, 'billing') -> 'inspections') e
            where (e ->> 'complete')::boolean is not true), '["B weld test"]'::jsonb, 'AC-TPI-007: B is the blocking inspection');
select is((select work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', null, 'readiness')), '{"complete": true, "inspections": []}'::jsonb,
  'FR-TPI-016: the readiness gate counts only inspections required for readiness');
select is((select work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000404', null, 'billing') ->> 'complete'), 'false', 'AC-TPI-007: a fail result stays incomplete');
select throws_ok($$ select work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000f1', 'billing') $$, '23514',
  'TPI_SECTION_UNAVAILABLE: work-order sections are not available yet', 'FR-TPI-016: a section is refused until #2576');
select throws_ok($$ select work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', null, 'shipping') $$, '22023', 'unknown gate', 'FR-TPI-016: an unknown gate is refused');
reset role;
insert into storage.objects (bucket_id, name) values ('inspection-reports', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a02/25800000-0000-0000-0000-000000000f01/r.pdf');
insert into third_party_inspection_files (id, inspection_id, file_path) values ('25800000-0000-0000-0000-000000000f01', '25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a02/25800000-0000-0000-0000-000000000f01/r.pdf');
select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a02', 'conditional') $$, 'AC-TPI-007: B is reported conditional');
select is((select work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', null, 'billing') ->> 'complete'), 'true', 'AC-TPI-007: a conditional result completes the prerequisite');
select ok(tpi_is_complete('reported', 'pass', null) and tpi_is_complete('reported', 'conditional', null) and tpi_is_complete('executed', 'pending', now())
          and not tpi_is_complete('reported', 'fail', null) and not tpi_is_complete('reported', 'pending', null) and not tpi_is_complete('cancelled', 'pass', null),
  'AC-TPI-007: the completeness rule (pass/conditional or waived; fail, pending and cancelled are not)');

-- ── AC-TPI-011 the overdue notice ────────────────────────────────────────────────────────────────────
reset role; select set_config('request.jwt.claims', '', true);   -- the sweep runs from cron: no caller
select is(run_tpi_overdue_sweep('2026-11-20'), 1, 'AC-TPI-011: the first sweep notifies the one overdue, unreported, uncancelled inspection (E)');
select is(run_tpi_overdue_sweep('2026-11-20'), 0, 'AC-TPI-011: the second sweep notifies nothing');
select is((select count(*) from notifications where metadata -> 'entity' ->> 'id' = '25800000-0000-0000-0000-000000000a05' and owner_id = '25800000-0000-0000-0000-0000000000a4'), 1::bigint,
  'AC-TPI-011: the requester has exactly one notice');
select is((select count(*) from notifications where metadata -> 'entity' ->> 'id' = '25800000-0000-0000-0000-000000000a05' and owner_id = '25800000-0000-0000-0000-0000000000a3'), 1::bigint,
  'AC-TPI-011: the project manager has exactly one notice');
select is((select count(*) from notifications where org_id = '25800000-0000-0000-0000-00000000000a'), 2::bigint,
  'AC-TPI-011: a reported (A) and a cancelled (F) inspection past their date produce no notice');
select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select throws_ok($$ select run_tpi_overdue_sweep('2026-11-20') $$, '42501', 'permission denied for function run_tpi_overdue_sweep',
  'AC-TPI-011: the sweep is not callable by a client role');

select * from finish();
rollback;
