-- #2584 AC-SPC-018 — mutation checks of the money-path rules. Each rule is broken in a savepoint (the check removed from the
-- shipped function body, or the index dropped): the action the rule refuses then SUCCEEDS, so the owning AC test (which asserts
-- the refusal) goes red; the savepoint is rolled back (restore) and the refusal is back. Evidence is the three-step triple.
-- Rules mutated: (M1) approver != preparer/submitter (SOD-CHECK in approve_subcontract_certificate), (M2) the cap pre-check at
-- approval (CAP-CHECK), (M3) one live claim per measured work (unique index), (M4) the payment ceiling net of the deduction,
-- (M5) the immutability guard of an approved certificate's lines.
begin;
create extension if not exists pgtap;
select plan(17);

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
select pg_temp.report('911', '2026-04-05', 'validated'); select pg_temp.pline('911', 1, '701', 1.000, '801');
select pg_temp.report('912', '2026-05-05', 'validated'); select pg_temp.pline('912', 1, '701', 2.000, '801');
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e1'), 'm3', 10.00, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e2'), 'm3',  8.40, 'IDR', '2026-03-01');
select set_subcontractor_rate(pg_temp.u('c1'), pg_temp.u('e3'), 'm3',  9.99, 'IDR', '2026-03-01');
select set_config('spc.mar', prepare_subcontract_certificate(pg_temp.po(), '2026-03-01')::text, true);
select set_certificate_deselection(pg_temp.cid('mar'), '2026-03-10', '25840000-0000-0000-0000-000000000704', '25840000-0000-0000-0000-000000000801', true, 'no rate agreed');
select submit_subcontract_certificate(pg_temp.cid('mar'));
select set_config('spc.apr', prepare_subcontract_certificate(pg_temp.po(), '2026-04-01')::text, true);
select submit_subcontract_certificate(pg_temp.cid('apr'));
select set_config('spc.may', prepare_subcontract_certificate(pg_temp.po(), '2026-05-01')::text, true);
select submit_subcontract_certificate(pg_temp.cid('may'));
reset role;

-- M2 the cap pre-check at approval (no acceptance is confirmed yet: verified 0).
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('apr')) $$, 'SC001', null, 'AC-SPC-009 baseline: the cap pre-check refuses April (verified 0)');
reset role;
savepoint m2;
do $m$ declare d text := pg_get_functiondef('public.approve_subcontract_certificate(uuid)'::regprocedure);
begin
  d := regexp_replace(d, '-- CAP-CHECK[\s\S]*?-- /CAP-CHECK', '', 'g');
  if d = pg_get_functiondef('public.approve_subcontract_certificate(uuid)'::regprocedure) then raise exception 'mutation M2 did not apply'; end if;
  execute d;
end $m$;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select lives_ok($$ select approve_subcontract_certificate(pg_temp.cid('apr')) $$, 'AC-SPC-018 M2 with the cap pre-check removed, the over-cap certificate is approved — so AC-SPC-009 goes red');
reset role;
rollback to savepoint m2;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('apr')) $$, 'SC001', null, 'AC-SPC-018 M2 restored: the refusal is back (AC-SPC-009 green)');
reset role;

-- M1 approver != preparer/submitter (March was prepared and submitted by a2).
select pg_temp.accept(40, 12.5, 3.333);
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, '42501', 'separation of duties: a certificate needs a different approver',
  'AC-SPC-006 baseline: the submitter cannot approve her own certificate');
reset role;
savepoint m1;
do $m$ declare d text := pg_get_functiondef('public.approve_subcontract_certificate(uuid)'::regprocedure);
begin
  d := regexp_replace(d, '-- SOD-CHECK[\s\S]*?-- /SOD-CHECK', '', 'g');
  if d = pg_get_functiondef('public.approve_subcontract_certificate(uuid)'::regprocedure) then raise exception 'mutation M1 did not apply'; end if;
  execute d;
end $m$;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, '23514', null,
  'AC-SPC-018 M1a with only the function check removed, the row CHECK (approved_by differs from preparer and submitter) still refuses: two independent layers');
reset role;
alter table subcontract_certificates drop constraint subcontract_certificates_sod;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select lives_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, 'AC-SPC-018 M1 with the SoD check AND its row CHECK removed, the submitter approves her own certificate — so AC-SPC-006 goes red');
select is((select approved_by from subcontract_certificates where id = pg_temp.cid('mar')), pg_temp.u('a2'), 'AC-SPC-018 M1 the self-approval is recorded (approved_by = submitted_by)');
reset role;
rollback to savepoint m1;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a2'));
select throws_ok($$ select approve_subcontract_certificate(pg_temp.cid('mar')) $$, '42501', 'separation of duties: a certificate needs a different approver',
  'AC-SPC-018 M1 restored: self-approval is refused again (AC-SPC-006 green)');
reset role;

-- M3 one live claim per measured work.
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select approve_subcontract_certificate(pg_temp.cid('mar'));
reset role;
select set_config('pmo.spc_freeze', 'on', true);
select throws_ok($$ insert into subcontract_certificate_claims (certificate_id, work_order_id, work_date, work_order_line_id, crew_id, boq_item_id, quantity)
  values (pg_temp.cid('may'), pg_temp.u('b1'), '2026-03-03', '25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-000000000801', pg_temp.u('e1'), 15.000) $$,
  '23505', null, 'AC-SPC-012 baseline: a second live claim on March''s 3 March work is refused');
savepoint m3;
drop index public.subcontract_certificate_claims_one_live;
select lives_ok($$ insert into subcontract_certificate_claims (certificate_id, work_order_id, work_date, work_order_line_id, crew_id, boq_item_id, quantity)
  values (pg_temp.cid('may'), pg_temp.u('b1'), '2026-03-03', '25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-000000000801', pg_temp.u('e1'), 15.000) $$,
  'AC-SPC-018 M3 with the unique index dropped, the same work is claimed twice — so AC-SPC-012 goes red');
rollback to savepoint m3;
select throws_ok($$ insert into subcontract_certificate_claims (certificate_id, work_order_id, work_date, work_order_line_id, crew_id, boq_item_id, quantity)
  values (pg_temp.cid('may'), pg_temp.u('b1'), '2026-03-03', '25840000-0000-0000-0000-000000000701', '25840000-0000-0000-0000-000000000801', pg_temp.u('e1'), 15.000) $$,
  '23505', null, 'AC-SPC-018 M3 restored: the duplicate claim is refused again');
select set_config('pmo.spc_freeze', '', true);

-- M5 immutability of an approved certificate's lines.
select throws_ok($$ update subcontract_certificate_lines set rate = 99 where certificate_id = pg_temp.cid('mar') $$, '42501', null,
  'AC-SPC-007 baseline: an approved certificate''s line rate cannot change');
savepoint m5;
alter table subcontract_certificate_lines disable trigger subcontract_certificate_lines_guard;
select lives_ok($$ update subcontract_certificate_lines set rate = 99 where certificate_id = pg_temp.cid('mar') $$,
  'AC-SPC-018 M5 with the line guard removed the approved rate is rewritten — so AC-SPC-007 goes red');
rollback to savepoint m5;
select throws_ok($$ update subcontract_certificate_lines set rate = 99 where certificate_id = pg_temp.cid('mar') $$, '42501', null,
  'AC-SPC-018 M5 restored: the line is immutable again');

-- M4 the payment ceiling net of the deduction: a bill carrying a 38.30 deduction (inserted as the bill path would).
select set_config('pmo.subcontract_capture', 'on', true), set_config('pmo.spc_bill', 'on', true);
with i as (insert into procurement_invoices (id, org_id, procurement_id, po_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount, deduction_amount)
  values ('25840000-0000-0000-0000-000000000b01', '25840000-0000-0000-0000-00000000000a', '25840000-0000-0000-0000-0000000000f1', pg_temp.po(), 'VI-SPC-M4', current_date,
          'Received', 538.30, 'IDR', 'exclusive', 0, 38.30) returning id)
insert into procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate) select id, pg_temp.u('e1'), 40, 10.00 from i;
select set_config('pmo.subcontract_capture', '', true), set_config('pmo.spc_bill', '', true);
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select throws_ok($$ select create_payment('25840000-0000-0000-0000-0000000000f1', '25840000-0000-0000-0000-000000000b01', 'PAY-M4', 'Scheduled', current_date, 538.30) $$,
  '23514', null, 'AC-SPC-011 baseline: a payment above the payable 500.00 is refused');
reset role;
savepoint m4;
drop trigger payments_zz_net_of_deduction on public.payments;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select lives_ok($$ select create_payment('25840000-0000-0000-0000-0000000000f1', '25840000-0000-0000-0000-000000000b01', 'PAY-M4', 'Scheduled', current_date, 538.30) $$,
  'AC-SPC-018 M4 with the net ceiling removed, the vendor is paid the backcharge too — so AC-SPC-011 goes red');
reset role;
rollback to savepoint m4;
set local role authenticated; select pg_temp.act_as(pg_temp.u('a3'));
select throws_ok($$ select create_payment('25840000-0000-0000-0000-0000000000f1', '25840000-0000-0000-0000-000000000b01', 'PAY-M4', 'Scheduled', current_date, 538.30) $$,
  '23514', null, 'AC-SPC-018 M4 restored: the overpayment is refused again');
reset role;

select * from finish();
rollback;
