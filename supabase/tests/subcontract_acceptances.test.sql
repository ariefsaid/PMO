-- #1513 S2: subcontract acceptance (AC-SCA-006, FR-SCA-010..015, PQ-8, PQ-12, NFR-SCA-006).
-- Fixture F1 + F2 of docs/plans/2026-11-01-subcontract-acceptance.md, plus S2 extras.
begin;
create extension if not exists pgtap;
select plan(72);

-- F1: org A (multi-member), org B (other tenant), org S (sole member). Inserted as superuser, before `set local role`.
insert into organizations (id, name, default_currency) values
  ('15130000-0000-0000-0000-00000000000a', 'SCA Org',       'IDR'),
  ('15130000-0000-0000-0000-00000000000b', 'SCA Other Org', 'IDR'),
  ('15130000-0000-0000-0000-00000000000c', 'SCA Solo Org',  'IDR');
insert into auth.users (id, email) values
  ('15130000-0000-0000-0000-0000000000a1', 'sca-admin@example.com'),
  ('15130000-0000-0000-0000-0000000000a2', 'sca-fin1@example.com'),
  ('15130000-0000-0000-0000-0000000000a3', 'sca-fin2@example.com'),
  ('15130000-0000-0000-0000-0000000000a4', 'sca-pm@example.com'),
  ('15130000-0000-0000-0000-0000000000a5', 'sca-eng@example.com'),
  ('15130000-0000-0000-0000-0000000000a6', 'sca-exec@example.com'),
  ('15130000-0000-0000-0000-0000000000a7', 'sca-pm-off@example.com'),
  ('15130000-0000-0000-0000-0000000000a8', 'sca-fin-off@example.com'),
  ('15130000-0000-0000-0000-0000000000b1', 'sca-xorg@example.com'),
  ('15130000-0000-0000-0000-0000000000c1', 'sca-solo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000a1', '15130000-0000-0000-0000-00000000000a', 'SCA Admin', 'sca-admin@example.com', 'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000a2', '15130000-0000-0000-0000-00000000000a', 'SCA Fin1',  'sca-fin1@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a3', '15130000-0000-0000-0000-00000000000a', 'SCA Fin2',  'sca-fin2@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-00000000000a', 'SCA PM',    'sca-pm@example.com',    'Project Manager', 'active'),
  ('15130000-0000-0000-0000-0000000000a5', '15130000-0000-0000-0000-00000000000a', 'SCA Eng',   'sca-eng@example.com',   'Engineer', 'active'),
  ('15130000-0000-0000-0000-0000000000a6', '15130000-0000-0000-0000-00000000000a', 'SCA Exec',  'sca-exec@example.com',  'Executive', 'active'),
  ('15130000-0000-0000-0000-0000000000a7', '15130000-0000-0000-0000-00000000000a', 'SCA PM Off', 'sca-pm-off@example.com', 'Project Manager', 'disabled'),
  ('15130000-0000-0000-0000-0000000000a8', '15130000-0000-0000-0000-00000000000a', 'SCA Fin Off', 'sca-fin-off@example.com', 'Finance', 'disabled'),
  ('15130000-0000-0000-0000-0000000000b1', '15130000-0000-0000-0000-00000000000b', 'SCA XOrg',  'sca-xorg@example.com',  'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000c1', '15130000-0000-0000-0000-00000000000c', 'SCA Solo',  'sca-solo@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-00000000000a', 'SCA Site',  'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d2', '15130000-0000-0000-0000-00000000000a', 'SCA Site Two', 'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-00000000000c', 'SCA Solo Site', 'Ongoing Project', null);
-- Client BoQ items: L1 (100 m3), L2 (50 m) on project d1; L9 on the solo project.
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15130000-0000-0000-0000-0000000000e1', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L1', 'Excavation', 'm3', 100, 150000),
  ('15130000-0000-0000-0000-0000000000e2', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L2', 'Piping',     'm',  50,  90000),
  ('15130000-0000-0000-0000-0000000000e9', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'L9', 'Solo work',  'ls', 10,  10000);
-- Subcontract purchase SP (Ordered, approved 12,000,000, Subcontractors line) and its PO.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-00000000000a', 'SCA earthworks subcontract',
   '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 12000000, 12000000,
   '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f9', '15130000-0000-0000-0000-00000000000c', 'SCA solo subcontract',
   '15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-0000000000c1', 'Ordered', 100000, null,
   null, 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'PO-SCA-1', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000f9', 'PO-SCA-9', 'Issued', current_date, 'IDR');
-- Signed Berita Acara documents (Issued, with a file) on each project.
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('15130000-0000-0000-0000-000000000201', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA period 1', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d1/15130000-0000-0000-0000-000000000201/ba1.pdf'),
  ('15130000-0000-0000-0000-000000000202', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d2', 'Acceptance', 'BA other project', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d2/15130000-0000-0000-0000-000000000202/ba2.pdf'),
  ('15130000-0000-0000-0000-000000000209', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'Acceptance', 'BA solo', 'Issued',
   '15130000-0000-0000-0000-00000000000c/15130000-0000-0000-0000-0000000000d9/15130000-0000-0000-0000-000000000209/ba9.pdf');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- F2: revision 1 of PO …101 (L1 100 m3 @ 100,000 + L2 50 m @ 40,000 = 12,000,000) and of PO …109 (L9 10 ls @ 10,000).
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e1', 100, 100000, 'm3'),
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e2',  50,  40000, 'm'),
  ('15130000-0000-0000-0000-000000000109', 1, '15130000-0000-0000-0000-0000000000e9',  10,  10000, 'ls');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-0000000000f1', 1, 'Issued', 12000000, '15130000-0000-0000-0000-0000000000a4', 'standard'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-0000000000f9', 1, 'Issued',   100000, '15130000-0000-0000-0000-0000000000c1', 'standard');
-- S2 extras: a Project Manager who does not manage the project (a9); a Cancelled subcontract purchase with lines (PQ-12);
-- a subcontract purchase whose PO has no issued revision.
insert into auth.users (id, email) values ('15130000-0000-0000-0000-0000000000a9', 'sca-pm2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000a9', '15130000-0000-0000-0000-00000000000a', 'SCA PM Two', 'sca-pm2@example.com', 'Project Manager', 'active');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000fb', '15130000-0000-0000-0000-00000000000a', 'SCA cancelled sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000fc', '15130000-0000-0000-0000-00000000000a', 'SCA unlined sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fb', 'PO-SCA-11', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-00000000010c', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fc', 'PO-SCA-12', 'Issued', current_date, 'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-00000000010b', 1, '15130000-0000-0000-0000-0000000000e1', 1, 1000, 'm3');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-0000000000fb', 1, 'Issued', 1000, '15130000-0000-0000-0000-0000000000a4', 'standard');
update procurements set status = 'Cancelled' where id = '15130000-0000-0000-0000-0000000000fb';
-- A live subcontract purchase that is cancelled only after a draft is prepared (confirm-side PQ-12).
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000fd', '15130000-0000-0000-0000-00000000000a', 'SCA later-cancelled sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-00000000010d', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fd', 'PO-SCA-13', 'Issued', current_date, 'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-00000000010d', 1, '15130000-0000-0000-0000-0000000000e1', 1, 1000, 'm3');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-00000000010d', '15130000-0000-0000-0000-0000000000fd', 1, 'Issued', 1000, '15130000-0000-0000-0000-0000000000a4', 'standard');
-- Draft lookup by note (the caller's RLS applies).
create or replace function pg_temp.acc(p_note text) returns uuid language sql as $$
  select id from subcontract_acceptances where note = p_note
$$;

-- ── Grants and the owning AC-SCA-006 journey ────────────────────────────────────────────────────────────────
select is(has_table_privilege('authenticated', 'public.subcontract_acceptances', 'INSERT'), false,
  'FR-SCA-015 clients hold no insert on acceptances');
select is(has_table_privilege('authenticated', 'public.subcontract_acceptance_lines', 'INSERT'), false,
  'FR-SCA-015 clients hold no insert on acceptance lines');
select is(has_table_privilege('authenticated', 'public.subcontract_acceptances', 'UPDATE')
       or has_table_privilege('authenticated', 'public.subcontract_acceptances', 'DELETE')
       or has_table_privilege('authenticated', 'public.subcontract_acceptance_lines', 'UPDATE')
       or has_table_privilege('authenticated', 'public.subcontract_acceptance_lines', 'DELETE'), false,
  'FR-SCA-015 clients hold no update or delete on acceptances or their lines');
select is((select count(*)::int from pg_class where oid in ('public.subcontract_acceptances'::regclass, 'public.subcontract_acceptance_lines'::regclass)
            and relforcerowsecurity), 2, 'FR-SCA-015 both acceptance tables are FORCE RLS');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":10}]') $$, '42501', null,
  'FR-SCA-010 an Engineer cannot prepare a subcontract acceptance');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a9');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":10}]') $$, '42501', null,
  'FR-SCA-010 a Project Manager who does not manage the project cannot prepare');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a7');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":10}]') $$, '42501', null,
  'FR-SCA-010 a disabled project manager cannot prepare');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":10}]') $$, 'P0002', null,
  'NFR-SCA-003 another organisation cannot prepare against this PO');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');  -- Fin1 is the preparer "A"
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":120}]', '15130000-0000-0000-0000-000000000201') $$,
  'FR-SCA-013 a verified quantity above the PO (120 > 100) is accepted on the draft');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":1}]') $$, '23514', null,
  'FR-SCA-010 a line not on the effective PO revision is refused');
select throws_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, '42501', null,
  'AC-SCA-006 the preparer cannot confirm in an org with other active members');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');  -- the project's PM holds no confirm authority
select throws_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, '42501', null,
  'AC-SCA-006 a Project Manager (not Admin or Finance) cannot confirm');
select throws_ok($$ select withdraw_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, '42501', null,
  'FR-SCA-010 a Project Manager who did not prepare the draft cannot withdraw it');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a8');  -- disabled Finance
select throws_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, '42501', null,
  'AC-SCA-006 a disabled Finance member cannot confirm');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');  -- Fin2 confirms
select lives_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$,
  'AC-SCA-006 a different Finance member confirms with the signed document');
select is((select confirm_basis from subcontract_acceptances where po_id = '15130000-0000-0000-0000-000000000101'
  and status = 'Confirmed'), 'standard', 'AC-SCA-006 basis standard is recorded');
select is((select confirmed_by from subcontract_acceptances where po_id = '15130000-0000-0000-0000-000000000101'
  and status = 'Confirmed'), '15130000-0000-0000-0000-0000000000a3'::uuid, 'AC-SCA-006 confirmed_by is the confirming Finance member');
select throws_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Confirmed')) $$, '42501', null,
  'AC-SCA-006 a confirmed acceptance cannot be confirmed again');
select throws_ok($$ select withdraw_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Confirmed')) $$, '42501', null,
  'AC-SCA-006 a confirmed acceptance cannot be withdrawn');
reset role;
select throws_ok($$ update subcontract_acceptances set note = 'x' where status = 'Confirmed' $$, '42501', null,
  'AC-SCA-006 a confirmed acceptance cannot be updated');
select throws_ok($$ delete from subcontract_acceptances where status = 'Confirmed' $$, '42501', null,
  'AC-SCA-006 a confirmed acceptance cannot be deleted');
select throws_ok($$ delete from subcontract_acceptance_lines where acceptance_id in
  (select id from subcontract_acceptances where status = 'Confirmed') $$, '42501', null,
  'AC-SCA-006 confirmed lines cannot be deleted');
select throws_ok($$ update subcontract_acceptance_lines set quantity = 1 where acceptance_id in
  (select id from subcontract_acceptances where status = 'Confirmed') $$, '42501', null,
  'AC-SCA-006 confirmed lines cannot be updated');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":110}]', '15130000-0000-0000-0000-000000000201') $$,
  '23514', null, 'FR-SCA-014 a cumulative quantity below the latest confirmed (120) is refused');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":5}]', '15130000-0000-0000-0000-000000000202') $$,
  '23514', null, 'FR-SCA-011 a document from another project is refused at prepare (ADR-0091 shape)');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":5}]') $$,
  'FR-SCA-011 a draft may be prepared before its document is attached …');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select throws_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, '23514', null,
  'FR-SCA-011 … but confirming needs a same-project signed document with a file');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select withdraw_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, 'FR-SCA-010 the preparer withdraws a draft');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000c1');  -- sole member of org S
select lives_ok($$ select confirm_subcontract_acceptance(prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000109',
  current_date, '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":3}]', '15130000-0000-0000-0000-000000000209')) $$,
  'AC-SCA-006 the sole active member prepares and confirms');
select is((select confirm_basis from subcontract_acceptances where po_id = '15130000-0000-0000-0000-000000000109'),
  'sole_operator', 'AC-SCA-006 basis sole_operator is recorded');
reset role;  -- audit_events is not client-readable
select is((select count(*)::int from audit_events where action like 'subcontract_acceptance.%'
  and entity_id in (select id from subcontract_acceptances)), 6, 'NFR-SCA-006 prepare/withdraw/confirm are audited');

set local role authenticated;
-- ── PQ-8 verified, FR-SCA-014 at confirm, withdraw, replace, input validation ──────────────────────────────────
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from subcontract_verified('15130000-0000-0000-0000-000000000101')), 1,
  'PQ-8 only Confirmed acceptances count: the withdrawn draft adds no line');
select is((select quantity from subcontract_verified('15130000-0000-0000-0000-000000000101')
            where boq_item_id = '15130000-0000-0000-0000-0000000000e1'), 120::numeric, 'PQ-8 L1 is verified at 120');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":30}]', '15130000-0000-0000-0000-000000000201', 'd1') $$,
  'FR-SCA-010 a second draft that omits L1 is allowed');
select is((select count(*)::int from subcontract_verified('15130000-0000-0000-0000-000000000101')), 1,
  'AC-SCA-009 a Draft never counts as verified');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select lives_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('d1')) $$, 'AC-SCA-006 Fin2 confirms the L2 draft');
select is((select quantity from subcontract_verified('15130000-0000-0000-0000-000000000101')
            where boq_item_id = '15130000-0000-0000-0000-0000000000e1'), 120::numeric,
  'PQ-8 an acceptance that omits L1 leaves L1 verified at its last confirmed 120');
select is((select quantity from subcontract_verified('15130000-0000-0000-0000-000000000101')
            where boq_item_id = '15130000-0000-0000-0000-0000000000e2'), 30::numeric, 'PQ-8 L2 is verified at 30');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":40}]', '15130000-0000-0000-0000-000000000201', 'dx') $$, 'FR-SCA-010 draft X (L2 40)');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":35}]', '15130000-0000-0000-0000-000000000201', 'dy') $$, 'FR-SCA-010 draft Y (L2 35)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select lives_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('dx')) $$, 'FR-SCA-010 X is confirmed first');
select throws_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('dy')) $$, '23514', null,
  'FR-SCA-014 Y (35) is refused at confirm: it is now below the confirmed 40');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a1');
select lives_ok($$ select withdraw_subcontract_acceptance(pg_temp.acc('dy')) $$, 'FR-SCA-010 an Admin withdraws another user''s draft');
select is((select quantity from subcontract_verified('15130000-0000-0000-0000-000000000101')
            where boq_item_id = '15130000-0000-0000-0000-0000000000e2'), 40::numeric,
  'AC-SCA-009 a Withdrawn acceptance never counts: L2 stays at the confirmed 40');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":120}]', '15130000-0000-0000-0000-000000000201', 'dz') $$,
  'FR-SCA-014 a quantity equal to the confirmed cumulative is allowed');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":125},{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":45}]',
  '15130000-0000-0000-0000-000000000201', 'dz2', pg_temp.acc('dz')) $$, 'FR-SCA-010 a draft is replaced in place');
select is((select count(*)::int from subcontract_acceptances where note = 'dz'), 0,
  'FR-SCA-010 the replace keeps one header: the old note is gone');
select is((select count(*)::int from subcontract_acceptance_lines where acceptance_id = pg_temp.acc('dz2')), 2,
  'FR-SCA-010 replacing a draft swaps its lines (two lines, not three)');
-- Replacing another member's draft re-stamps the preparer: the replacer cannot then confirm it, the original author can.
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":40}]', '15130000-0000-0000-0000-000000000201', 'dr') $$,
  'FR-SCA-010 Fin1 prepares draft R');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":40}]', '15130000-0000-0000-0000-000000000201', 'dr2', pg_temp.acc('dr')) $$,
  'FR-SCA-010 Fin2 replaces Fin1''s draft R');
select throws_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('dr2')) $$, '42501',
  'separation of duties: the preparer cannot confirm this acceptance',
  'AC-SCA-006 the member who replaced a draft is its preparer and cannot confirm it');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('dr2')) $$,
  'AC-SCA-006 the original author, no longer the preparer, confirms the replaced draft');
-- PQ-12 at confirm: a purchase cancelled after prepare takes no confirmation.
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-00000000010d', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]', '15130000-0000-0000-0000-000000000201', 'dc') $$,
  'PQ-12 a draft is prepared on a live purchase');
reset role;
update procurements set status = 'Cancelled' where id = '15130000-0000-0000-0000-0000000000fd';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select throws_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('dc')) $$, '42501', 'this purchase is closed',
  'PQ-12 a purchase cancelled after prepare cannot have its draft confirmed');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
-- FR-SCA-011 at confirm: the document is re-checked when the draft is confirmed, not trusted from prepare.
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":40}]', '15130000-0000-0000-0000-000000000201', 'dm') $$,
  'FR-SCA-011 draft M names the signed document');
reset role;
update project_documents set project_id = '15130000-0000-0000-0000-0000000000d2', file_path = '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d2/15130000-0000-0000-0000-000000000201/ba1.pdf' where id = '15130000-0000-0000-0000-000000000201';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select throws_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('dm')) $$, '23514', null,
  'FR-SCA-011 a document moved to another project after prepare no longer confirms');
reset role;
update project_documents set project_id = '15130000-0000-0000-0000-0000000000d1', file_path = '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d1/15130000-0000-0000-0000-000000000201/ba1.pdf', status = 'Draft' where id = '15130000-0000-0000-0000-000000000201';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select throws_ok($$ select confirm_subcontract_acceptance(pg_temp.acc('dm')) $$, '23514', null,
  'FR-SCA-011 a document that is no longer Issued or Approved no longer confirms');
reset role;
update project_documents set status = 'Issued' where id = '15130000-0000-0000-0000-000000000201';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select withdraw_subcontract_acceptance(pg_temp.acc('dm')) $$, 'FR-SCA-010 the preparer withdraws draft M');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":125}]', null, null,
  (select id from subcontract_acceptances where status = 'Confirmed' limit 1)) $$, 'P0002', null,
  'FR-SCA-015 a Confirmed acceptance cannot be replaced');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1},{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":2}]') $$,
  '23514', null, 'FR-SCA-010 a line named twice is refused');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":-1}]') $$, '23514', null, 'FR-SCA-010 a negative quantity is refused');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1.2345}]') $$, '23514', null,
  'FR-SCA-010 a quantity with more than three decimals is refused');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date, '[]') $$, '23502', null,
  'FR-SCA-010 an acceptance needs at least one line');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', null,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]') $$, '23502', null, 'FR-SCA-010 an acceptance needs a date');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-00000000010c', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]') $$, '42501', null,
  'FR-SCA-010 a PO with no issued BoQ lines takes no acceptance');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-00000000010b', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]') $$, '42501', null,
  'PQ-12 a Cancelled purchase takes no acceptance');

-- ── Reads (RLS): own org only; Engineer outside the purchasing scope sees nothing ────────────────────────────────
select cmp_ok((select count(*)::int from subcontract_acceptances), '>', 0, 'FR-SCA-015 Finance reads acceptances under RLS');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from subcontract_acceptances) + (select count(*)::int from subcontract_acceptance_lines), 0,
  'FR-SCA-015 an Engineer outside the purchase''s scope reads no acceptances or lines');
select is((select count(*)::int from subcontract_verified('15130000-0000-0000-0000-000000000101')), 0,
  'NFR-SCA-005 the verified read returns no row, not a fabricated figure, for a hidden PO');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from subcontract_acceptances) + (select count(*)::int from subcontract_acceptance_lines), 0,
  'NFR-SCA-003 another organisation reads no acceptances or lines');
reset role;
create temp table sca_ids as select (select id from subcontract_acceptances where status = 'Draft' limit 1) as draft_id;
grant select on sca_ids to authenticated;
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');  -- an Admin of the other organisation
select throws_ok($$ select confirm_subcontract_acceptance((select draft_id from sca_ids)) $$, 'P0002', null,
  'NFR-SCA-003 an Admin of another organisation cannot confirm this organisation''s acceptance');
select throws_ok($$ select withdraw_subcontract_acceptance((select draft_id from sca_ids)) $$, 'P0002', null,
  'NFR-SCA-003 an Admin of another organisation cannot withdraw this organisation''s acceptance');
reset role;

select * from finish();
rollback;
