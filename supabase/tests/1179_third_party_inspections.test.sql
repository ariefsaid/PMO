-- 1179_third_party_inspections.test.sql — #2580 (docs/specs/third-party-inspections.spec.md; plan docs/plans/2026-11-20-third-party-inspections.md).
-- Migrations under test: 1179_third_party_inspections.sql, 1131_third_party_inspection_rpcs.sql, 1132_third_party_inspection_history.sql.
-- AC-TPI-004 no direct status write, no skipped step · AC-TPI-005 report needs a file and a real result, 10-file cap ·
-- AC-TPI-006 a reported inspection's files are append-only · AC-TPI-008 waiver rules · AC-TPI-009 section refused pre-#2576 ·
-- AC-TPI-010 cancel only when required for no gate · AC-TPI-013 org / Engineer limits · AC-TPI-017 the creator cannot waive ·
-- history (FR-TPI-005) and audit rows. The purchase link and the reads are 1133_*.test.sql and 1134_*.test.sql.
-- Every denial asserts the errcode AND the message. Fixtures are written as the table owner; every client check runs as `authenticated`.
begin;
create extension if not exists pgtap;
select plan(57);

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into organizations (id, name, default_currency) values
  ('25800000-0000-0000-0000-00000000000a', 'TPI Org', 'USD'), ('25800000-0000-0000-0000-00000000000b', 'TPI Other', 'USD');
insert into auth.users (id, email) values
  ('25800000-0000-0000-0000-0000000000a1', 'tpi-admin@example.com'), ('25800000-0000-0000-0000-0000000000a2', 'tpi-pm2@example.com'), ('25800000-0000-0000-0000-0000000000a3', 'tpi-pm@example.com'),
  ('25800000-0000-0000-0000-0000000000a4', 'tpi-eng@example.com'), ('25800000-0000-0000-0000-0000000000a5', 'tpi-eng2@example.com'), ('25800000-0000-0000-0000-0000000000a6', 'tpi-fin@example.com'),
  ('25800000-0000-0000-0000-0000000000a7', 'tpi-exec@example.com'), ('25800000-0000-0000-0000-0000000000b1', 'tpi-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25800000-0000-0000-0000-0000000000a1', '25800000-0000-0000-0000-00000000000a', 'TPI Admin', 'tpi-admin@example.com', 'Admin', 'active'),
  ('25800000-0000-0000-0000-0000000000a2', '25800000-0000-0000-0000-00000000000a', 'TPI PM Two', 'tpi-pm2@example.com', 'Project Manager', 'active'),
  ('25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-00000000000a', 'TPI PM', 'tpi-pm@example.com', 'Project Manager', 'active'),
  ('25800000-0000-0000-0000-0000000000a4', '25800000-0000-0000-0000-00000000000a', 'TPI Eng', 'tpi-eng@example.com', 'Engineer', 'active'),
  ('25800000-0000-0000-0000-0000000000a5', '25800000-0000-0000-0000-00000000000a', 'TPI Eng Two', 'tpi-eng2@example.com', 'Engineer', 'active'),
  ('25800000-0000-0000-0000-0000000000a6', '25800000-0000-0000-0000-00000000000a', 'TPI Fin', 'tpi-fin@example.com', 'Finance', 'active'),
  ('25800000-0000-0000-0000-0000000000a7', '25800000-0000-0000-0000-00000000000a', 'TPI Exec', 'tpi-exec@example.com', 'Executive', 'active'),
  ('25800000-0000-0000-0000-0000000000b1', '25800000-0000-0000-0000-00000000000b', 'TPI XOrg', 'tpi-xorg@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-00000000000a', 'TPI Site', 'Ongoing Project', '25800000-0000-0000-0000-0000000000a3'),
  ('25800000-0000-0000-0000-0000000000d9', '25800000-0000-0000-0000-00000000000b', 'TPI Other Site', 'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'TPI WO', 'Issued', 10000, 'exclusive', 0),
  ('25800000-0000-0000-0000-000000000402', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'TPI WO cancelled', 'Cancelled', 10000, 'exclusive', 0),
  ('25800000-0000-0000-0000-000000000409', '25800000-0000-0000-0000-00000000000b', '25800000-0000-0000-0000-0000000000d9', 'TPI WO other', 'Issued', 10000, 'exclusive', 0);
insert into companies (id, org_id, name, type) values
  ('25800000-0000-0000-0000-0000000000c1', '25800000-0000-0000-0000-00000000000a', 'TPI Lab', 'Vendor'), ('25800000-0000-0000-0000-0000000000c9', '25800000-0000-0000-0000-00000000000b', 'TPI Other Lab', 'Vendor');
insert into procurements (id, org_id, title, project_id, requested_by_id, status) values
  ('25800000-0000-0000-0000-000000000601', '25800000-0000-0000-0000-00000000000a', 'case one', '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000602', '25800000-0000-0000-0000-00000000000a', 'case two', '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft'),
  ('25800000-0000-0000-0000-000000000603', '25800000-0000-0000-0000-00000000000a', 'case three', '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000a3', 'Draft');

-- ── AC-TPI-009 / FR-TPI-001: create ───────────────────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select lives_ok($$ select tpi_create('25800000-0000-0000-0000-000000000401', 'Soil test', 'soil', '2026-12-01', '25800000-0000-0000-0000-0000000000c1', 1500, 'USD', 'note',
    array['billing','readiness'], null) $$, 'AC-TPI-009: with the section null, a Project Manager creates a required inspection');
select is((select project_id from third_party_inspections where title = 'Soil test'), '25800000-0000-0000-0000-0000000000d1'::uuid,
  'FR-TPI-001: the project is derived from the work order');
select throws_ok($$ select tpi_create('25800000-0000-0000-0000-000000000401', 'Sectioned', null, '2026-12-01', null, null, null, null, '{}', '25800000-0000-0000-0000-0000000000f1') $$,
  '23514', 'TPI_SECTION_UNAVAILABLE: work-order sections are not available yet', 'AC-TPI-009: a non-null section is refused until #2576');
select throws_ok($$ select tpi_create('25800000-0000-0000-0000-000000000402', 'On cancelled', null, '2026-12-01', null, null, null, null, '{}') $$,
  '23514', 'TPI_WO_SCOPE: the work order is not available for an inspection', 'FR-TPI-001: a Cancelled work order is refused');
select throws_ok($$ select tpi_create('25800000-0000-0000-0000-000000000409', 'On foreign', null, '2026-12-01', null, null, null, null, '{}') $$,
  '23514', 'TPI_WO_SCOPE: the work order is not available for an inspection', 'FR-TPI-001: a work order of another organisation is refused');
select throws_ok($$ select tpi_create('25800000-0000-0000-0000-000000000401', 'Bad vendor', null, '2026-12-01', '25800000-0000-0000-0000-0000000000c9', null, null, null, '{}') $$,
  '23514', 'TPI_VENDOR_SCOPE: the vendor is not available', 'FR-TPI-001: a vendor of another organisation is refused');
select is((select count(*) from third_party_inspections where work_order_id = '25800000-0000-0000-0000-000000000401'), 1::bigint,
  'AC-TPI-009: the null-section inspection counts in the work order roll-up (and the refused ones left no row)');

-- fixtures at fixed states (owner; the transition guard fires on UPDATE only, so a row may be INSERTED in any state)
reset role;
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, required_for, status, created_by, procurement_id, invited_on, invited_by, executed_on, executed_by) values
  ('25800000-0000-0000-0000-000000000a01', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Req requested', '2026-12-01', '{billing}', 'requested', '25800000-0000-0000-0000-0000000000a3', null, null, null, null, null),
  ('25800000-0000-0000-0000-000000000a02', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Req raised',    '2026-12-01', '{billing}', 'purchase_raised', '25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-000000000601', null, null, null, null),
  ('25800000-0000-0000-0000-000000000a03', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Req invited',   '2026-12-01', '{billing}', 'invited', '25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-000000000602', '2026-11-19', '25800000-0000-0000-0000-0000000000a3', null, null),
  ('25800000-0000-0000-0000-000000000a04', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Req executed',  '2026-12-01', '{billing}', 'executed', '25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-000000000603', '2026-11-19', '25800000-0000-0000-0000-0000000000a3', '2026-11-19', '25800000-0000-0000-0000-0000000000a3');
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, required_for, status, created_by) values
  ('25800000-0000-0000-0000-000000000b01', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Tracked by eng',   '2026-12-01', '{}', 'requested', '25800000-0000-0000-0000-0000000000a4'),
  ('25800000-0000-0000-0000-000000000b02', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Tracked by eng 2', '2026-12-01', '{}', 'requested', '25800000-0000-0000-0000-0000000000a4'),
  ('25800000-0000-0000-0000-000000000b03', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Tracked pm',       '2026-12-01', '{}', 'requested', '25800000-0000-0000-0000-0000000000a3');

-- ── AC-TPI-004 ───────────────────────────────────────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select throws_ok($$ update third_party_inspections set status = 'reported' where id = '25800000-0000-0000-0000-000000000a01' $$,
  '42501', 'permission denied for table third_party_inspections', 'AC-TPI-004: no client may write status directly');
select throws_ok($$ select tpi_record_invitation('25800000-0000-0000-0000-000000000a01', '2026-11-19', 'Lab', 'phone') $$,
  '23514', 'TPI_STEP: complete the previous step', 'AC-TPI-004: invite before the purchase is refused');
select throws_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a02', 'pass') $$,
  '23514', 'TPI_STEP: complete the previous step', 'AC-TPI-004: report before execute (a step skipped) is refused');
select throws_ok($$ select tpi_record_execution('25800000-0000-0000-0000-000000000a02', '2026-11-19') $$,
  '23514', 'TPI_STEP: complete the previous step', 'AC-TPI-004: execute before invite is refused');
select throws_ok($$ delete from third_party_inspections where id = '25800000-0000-0000-0000-000000000a01' $$,
  '42501', 'permission denied for table third_party_inspections', 'AC-TPI-010: an inspection is never hard-deleted by a client');

-- the forward chain through the RPCs, as an Engineer from the invitation on
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select lives_ok($$ select tpi_record_invitation('25800000-0000-0000-0000-000000000a02', '2026-11-19', 'Lab contact', 'email') $$,
  'FR-TPI-011: an Engineer records the invitation once the purchase is raised');
select throws_ok($$ select tpi_record_execution('25800000-0000-0000-0000-000000000a03', current_date + 3) $$,
  '23514', 'TPI_EXECUTE_FUTURE: the execution date cannot be in the future', 'FR-TPI-012: an execution date in the future is refused');
select lives_ok($$ select tpi_record_execution('25800000-0000-0000-0000-000000000a03', '2026-11-19') $$, 'FR-TPI-012: execution recorded');
select is((select status || '/' || invited_by::text from third_party_inspections where id = '25800000-0000-0000-0000-000000000a02'),
  'invited/25800000-0000-0000-0000-0000000000a4', 'FR-TPI-002: the invitation stamps the actor');

-- ── AC-TPI-005 report needs a file and a real result ─────────────────────────────────────────────────
reset role;
insert into storage.objects (bucket_id, name) values
  ('inspection-reports', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a04/25800000-0000-0000-0000-000000000f01/report.pdf'),
  ('inspection-reports', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a03/25800000-0000-0000-0000-000000000f02/report.pdf');
select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select throws_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a04', 'pass') $$,
  '23514', 'TPI_REPORT_FILE: attach the report before marking it reported', 'AC-TPI-005: no attachment, no report');
select lives_ok($$ insert into third_party_inspection_files (id, inspection_id, file_path) values
  ('25800000-0000-0000-0000-000000000f01', '25800000-0000-0000-0000-000000000a04', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a04/25800000-0000-0000-0000-000000000f01/report.pdf') $$,
  'FR-TPI-013: an Engineer attaches the report file');
select throws_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a04', 'pending') $$,
  '23514', 'TPI_RESULT: record a result of pass, fail or conditional', 'AC-TPI-005: a result left pending is refused');
select throws_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a04', null) $$,
  '23514', 'TPI_RESULT: record a result of pass, fail or conditional', 'AC-TPI-005: no result is refused (the default is not a result)');
select throws_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a04', 'excellent') $$,
  '23514', null, 'AC-TPI-005: a result outside pass/fail/conditional is refused');
select lives_ok($$ select tpi_record_report('25800000-0000-0000-0000-000000000a04', 'fail') $$, 'AC-TPI-005: with one attachment and a result it is reported');
select is((select status || '/' || result from third_party_inspections where id = '25800000-0000-0000-0000-000000000a04'), 'reported/fail', 'AC-TPI-005: reported with the recorded result');

-- 11th live attachment
reset role;
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, required_for, status, created_by, procurement_id, invited_on, invited_by, executed_on, executed_by) values
  ('25800000-0000-0000-0000-000000000a05', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000401', '25800000-0000-0000-0000-0000000000d1', 'Cap test', '2026-12-01', '{billing}', 'executed', '25800000-0000-0000-0000-0000000000a3', null, '2026-11-19', '25800000-0000-0000-0000-0000000000a3', '2026-11-19', '25800000-0000-0000-0000-0000000000a3');
insert into storage.objects (bucket_id, name)
  select 'inspection-reports', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a05/' || ('25800000-0000-0000-0000-0000000e00' || lpad(g::text, 2, '0')) || '/r.pdf' from generate_series(1, 11) g;
insert into third_party_inspection_files (id, inspection_id, file_path)
  select ('25800000-0000-0000-0000-0000000e00' || lpad(g::text, 2, '0'))::uuid, '25800000-0000-0000-0000-000000000a05',
         '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a05/' || ('25800000-0000-0000-0000-0000000e00' || lpad(g::text, 2, '0')) || '/r.pdf' from generate_series(1, 10) g;
select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select throws_ok($$ insert into third_party_inspection_files (id, inspection_id, file_path) values
  ('25800000-0000-0000-0000-0000000e0011', '25800000-0000-0000-0000-000000000a05', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a05/25800000-0000-0000-0000-0000000e0011/r.pdf') $$,
  '23514', 'TPI_FILE_CAP: an inspection holds at most 10 report files', 'AC-TPI-005: an 11th live attachment is refused');

-- ── AC-TPI-006 append-only once reported ─────────────────────────────────────────────────────────────
select throws_ok($$ update third_party_inspection_files set archived_at = now() where id = '25800000-0000-0000-0000-000000000f01' $$,
  '23514', 'TPI_FILE_APPEND_ONLY: the report of a reported inspection cannot be removed or replaced; attach a new file',
  'AC-TPI-006: a report file of a reported inspection cannot be removed');
select throws_ok($$ update third_party_inspection_files set file_path = 'x' where id = '25800000-0000-0000-0000-000000000f01' $$,
  '42501', null, 'AC-TPI-006: a report file cannot be replaced (only archived_at is writable at all)');
reset role;
insert into storage.objects (bucket_id, name) values ('inspection-reports', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a04/25800000-0000-0000-0000-000000000f03/second.pdf');
select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select lives_ok($$ insert into third_party_inspection_files (id, inspection_id, file_path) values
  ('25800000-0000-0000-0000-000000000f03', '25800000-0000-0000-0000-000000000a04', '25800000-0000-0000-0000-00000000000a/25800000-0000-0000-0000-000000000a04/25800000-0000-0000-0000-000000000f03/second.pdf') $$,
  'AC-TPI-006: a new attachment is accepted on a reported inspection');

-- ── AC-TPI-008 / AC-TPI-017 waiver ───────────────────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a3');
select throws_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a01', 'client agreed') $$,
  '42501', 'TPI_WAIVE_SELF: you cannot waive an inspection you created', 'AC-TPI-017: the creator cannot waive through the RPC');
select throws_ok($$ update third_party_inspections set waived_at = now(), waived_by = '25800000-0000-0000-0000-0000000000a2', waiver_reason = 'x' where id = '25800000-0000-0000-0000-000000000a01' $$,
  '42501', 'permission denied for table third_party_inspections', 'AC-TPI-017: no role may write the waiver columns directly');
select is((select waived_at is null from third_party_inspections where id = '25800000-0000-0000-0000-000000000a01'), true, 'AC-TPI-017: the creator''s attempts left it unwaived');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select throws_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a01', 'client agreed') $$,
  '42501', 'you cannot waive an inspection', 'AC-TPI-013: an Engineer cannot waive');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a2');
select throws_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a01', '   ') $$,
  '23514', 'TPI_WAIVE_REASON: a waiver needs a reason', 'AC-TPI-008: a waiver without a reason is refused');
select throws_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000b03', 'no gate here') $$,
  '23514', 'TPI_WAIVE_NOT_REQUIRED: this inspection is required for no gate, so there is nothing to waive',
  'AC-TPI-008: a waiver on a tracked-only inspection is refused');
select lives_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a01', 'client accepted the supplier certificate') $$,
  'AC-TPI-008: a different Project Manager waives with a reason');
select throws_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a01', 'again') $$,
  '23514', 'TPI_WAIVED: this inspection is already waived', 'AC-TPI-008: it cannot be waived twice');
select is((select jsonb_path_query_first(work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', null, 'billing') -> 'inspections',
            '$[*] ? (@.id == "25800000-0000-0000-0000-000000000a01")') ->> 'complete'), 'true', 'AC-TPI-008: the prerequisite read shows the waived inspection complete');
reset role;
select is((select count(*) from audit_events where action = 'third_party_inspection.waive' and entity_id = '25800000-0000-0000-0000-000000000a01'), 1::bigint,
  'AC-TPI-008: the waiver is audited');
select is((select count(*) from record_changes where entity_type = 'third_party_inspection' and entity_id = '25800000-0000-0000-0000-000000000a01' and changes ? 'waived_at'), 1::bigint,
  'FR-TPI-005: the waiver is in record history with its actor');
select is((select actor_id from record_changes where entity_type = 'third_party_inspection' and entity_id = '25800000-0000-0000-0000-000000000a01' and changes ? 'waived_at'),
  '25800000-0000-0000-0000-0000000000a2'::uuid, 'FR-TPI-005: record history names the waiving user');
select pg_temp.as_user('25800000-0000-0000-0000-0000000000a6');
select lives_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a02', 'finance accepted the certificate') $$, 'AC-TPI-017: Finance (not the creator) may waive');

-- ── AC-TPI-010 cancel ────────────────────────────────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a4');
select lives_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000b01', 'no longer needed') $$, 'AC-TPI-013: the creator (Engineer) cancels their tracked-only inspection while requested');
select is((select status || '/' || cancel_reason || '/' || cancelled_by::text from third_party_inspections where id = '25800000-0000-0000-0000-000000000b01'),
  'cancelled/no longer needed/25800000-0000-0000-0000-0000000000a4', 'AC-TPI-010: the row is kept with its reason and actor');
select throws_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000b03', 'not mine') $$,
  '42501', 'you cannot cancel this inspection', 'AC-TPI-013: an Engineer cannot cancel another''s inspection');
select throws_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000a03', 'drop the gate') $$,
  '42501', 'you cannot cancel this inspection', 'AC-TPI-013: an Engineer cannot cancel a required inspection');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a2');
select throws_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000a03', 'drop the gate') $$,
  '23514', 'TPI_CANCEL_REQUIRED: this inspection is required for a gate; report it or waive it',
  'AC-TPI-010: a required inspection cannot be cancelled, even by a manager');
select throws_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000b03', ' ') $$,
  '23514', 'TPI_CANCEL_REASON: cancelling needs a reason', 'FR-TPI-003: cancelling needs a reason');
select lives_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000b03', 'duplicate request') $$, 'AC-TPI-010: a manager cancels a tracked-only inspection');
select is((select (work_order_inspection_prerequisites('25800000-0000-0000-0000-000000000401', null, 'billing') -> 'inspections') @> '[{"id":"25800000-0000-0000-0000-000000000a03"}]'), true,
  'AC-TPI-010: the refused cancel left the required inspection blocking');
select throws_ok($$ select tpi_cancel('25800000-0000-0000-0000-000000000b03', 'again') $$,
  '23514', 'TPI_TERMINAL: a cancelled inspection cannot change', 'FR-TPI-003: a cancelled inspection is terminal');

-- ── AC-TPI-013 another org, other roles ──────────────────────────────────────────────────────────────
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000b1');
select is((select count(*) from third_party_inspections), 0::bigint, 'AC-TPI-013: another organisation reads no inspection');
select throws_ok($$ select tpi_waive('25800000-0000-0000-0000-000000000a03', 'x') $$, 'P0002', 'inspection not found', 'AC-TPI-013: another organisation cannot waive (reads as absent)');
select throws_ok($$ select tpi_record_invitation('25800000-0000-0000-0000-000000000a03', '2026-11-19', 'x', 'x') $$, 'P0002', 'inspection not found', 'AC-TPI-013: another organisation cannot advance');
select throws_ok($$ select tpi_create('25800000-0000-0000-0000-000000000401', 'Intruder', null, '2026-12-01', null, null, null, null, '{}') $$,
  '23514', 'TPI_WO_SCOPE: the work order is not available for an inspection', 'AC-TPI-013: another organisation cannot create on this work order');
select throws_ok($$ insert into third_party_inspection_files (inspection_id, file_path) values ('25800000-0000-0000-0000-000000000a03', 'x/y/z/w.pdf') $$,
  '42501', null, 'AC-TPI-013: another organisation cannot add a file');
reset role; select pg_temp.as_user('25800000-0000-0000-0000-0000000000a7');
select throws_ok($$ select tpi_create('25800000-0000-0000-0000-000000000401', 'Exec', null, '2026-12-01', null, null, null, null, '{}') $$,
  '42501', 'you cannot create an inspection', 'FR-TPI-019: an Executive reads only');
select ok((select count(*) from third_party_inspections) > 0, 'FR-TPI-019: an Executive reads inspections');
select throws_ok($$ select estimate from third_party_inspections limit 1 $$, '42501', null,
  'FR-TPI-008: the planning estimate is not a readable column of the table (money is read through tpi_costs)');

select * from finish();
rollback;
