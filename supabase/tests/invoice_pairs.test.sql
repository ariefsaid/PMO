-- invoice_pairs.test.sql — ECA-5 (#1602): pair a PMO-raised invoice with the same invoice already in the ERP, so revenue
-- and receivables count it once (AC-ECA-030; PD-ECA-10/11). Migration under test: 0484_invoice_pairs.sql.
-- Fixtures load with no JWT (a server load); every assertion runs as a real caller.
begin;
create extension if not exists pgtap;
select plan(63);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
insert into public.organizations (id, name) values
  ('04840000-0000-0000-0000-000000000001', 'Pairs org'),
  ('04840000-0000-0000-0000-000000000002', 'Pairs foreign org');
insert into auth.users (id, email) values
  ('04840000-0000-0000-0000-0000000000a1', 'pair-fin@example.test'),
  ('04840000-0000-0000-0000-0000000000a2', 'pair-eng@example.test'),
  ('04840000-0000-0000-0000-0000000000a3', 'pair-admin@example.test'),
  ('04840000-0000-0000-0000-0000000000a4', 'pair-pm@example.test'),
  ('04840000-0000-0000-0000-0000000000b1', 'pair-xfin@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('04840000-0000-0000-0000-0000000000a1', '04840000-0000-0000-0000-000000000001', 'Pair Finance', 'pair-fin@example.test', 'Finance', 'active'),
  ('04840000-0000-0000-0000-0000000000a2', '04840000-0000-0000-0000-000000000001', 'Pair Engineer', 'pair-eng@example.test', 'Engineer', 'active'),
  ('04840000-0000-0000-0000-0000000000a3', '04840000-0000-0000-0000-000000000001', 'Pair Admin', 'pair-admin@example.test', 'Admin', 'active'),
  ('04840000-0000-0000-0000-0000000000a4', '04840000-0000-0000-0000-000000000001', 'Pair PM', 'pair-pm@example.test', 'Project Manager', 'active'),
  ('04840000-0000-0000-0000-0000000000b1', '04840000-0000-0000-0000-000000000002', 'Pair Foreign Finance', 'pair-xfin@example.test', 'Finance', 'active');
insert into public.companies (id, org_id, name, type) values
  ('04840000-0000-0000-0000-0000000000f1', '04840000-0000-0000-0000-000000000001', 'Pair Client', 'Client'),
  ('04840000-0000-0000-0000-0000000000f2', '04840000-0000-0000-0000-000000000002', 'Pair Foreign Client', 'Client');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                             tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('04840000-0000-0000-0000-0000000000c1', '04840000-0000-0000-0000-000000000001', 'Pair P', 'Ongoing Project', 'USD',
   1000000, 'exclusive', 0, 0, 1, 1, false, '04840000-0000-0000-0000-0000000000f1', '04840000-0000-0000-0000-0000000000a4');
insert into public.work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount) values
  ('04840000-0000-0000-0000-0000000000d1', '04840000-0000-0000-0000-000000000001', '04840000-0000-0000-0000-0000000000c1',
   'Pair WO', 'Issued', 'WO-PAIR-1', 500000, 'exclusive', 0);
insert into public.external_domain_ownership (org_id, external_tier, domain) values
  ('04840000-0000-0000-0000-000000000001', 'erpnext', 'revenue'),
  ('04840000-0000-0000-0000-000000000002', 'erpnext', 'revenue');

-- N1: PMO-raised (10,000 + 1,100 tax, exclusive as PMO stores it), same sale as ERP invoice E1 (11,100 inclusive, the ERP grand total, PO-7, March). N2: PMO-raised, no ERP twin.
-- N3: PMO-raised WITH a PMO receipt, ERP twin E3 exists. N5: two ERP candidates (ambiguous).
insert into public.sales_invoices (id, org_id, project_id, work_order_id, customer_id, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, reference_number,
                                   native_lines, pmo_native, author_user_id, pmo_number) values
  ('04840000-0000-0000-0000-0000000005a1', '04840000-0000-0000-0000-000000000001', '04840000-0000-0000-0000-0000000000c1',
   '04840000-0000-0000-0000-0000000000d1', '04840000-0000-0000-0000-0000000000f1', '2026-03-10', 10000, 11100,
   'exclusive', 1100, 'USD', 'Unpaid', 'PO-7', '[{"description":"n1"}]', true, '04840000-0000-0000-0000-0000000000a1', 'PMO-N1'),
  ('04840000-0000-0000-0000-0000000005a2', '04840000-0000-0000-0000-000000000001', '04840000-0000-0000-0000-0000000000c1',
   null, '04840000-0000-0000-0000-0000000000f1', '2026-03-11', 5000, 5000,
   'exclusive', 0, 'USD', 'Unpaid', 'PO-9', '[{"description":"n2"}]', true, '04840000-0000-0000-0000-0000000000a1', 'PMO-N2'),
  ('04840000-0000-0000-0000-0000000005a3', '04840000-0000-0000-0000-000000000001', '04840000-0000-0000-0000-0000000000c1',
   null, '04840000-0000-0000-0000-0000000000f1', '2026-03-12', 3000, 2000,
   'exclusive', 0, 'USD', 'Unpaid', 'PO-3', '[{"description":"n3"}]', true, '04840000-0000-0000-0000-0000000000a1', 'PMO-N3'),
  ('04840000-0000-0000-0000-0000000005a5', '04840000-0000-0000-0000-000000000001', '04840000-0000-0000-0000-0000000000c1',
   null, '04840000-0000-0000-0000-0000000000f1', '2026-03-13', 7000, 7000,
   'exclusive', 0, 'USD', 'Unpaid', 'PO-5', '[{"description":"n5"}]', true, '04840000-0000-0000-0000-0000000000a1', 'PMO-N5');
insert into public.incoming_payments (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount, withheld_amount,
                                      status, currency, pmo_native, pmo_number) values
  ('04840000-0000-0000-0000-0000000006a3', '04840000-0000-0000-0000-000000000001', '04840000-0000-0000-0000-0000000000f1',
   '04840000-0000-0000-0000-0000000005a3', '2026-03-20', 1000, 1000, 0, 'Paid', 'USD', true, 'PMO-R3');
-- ERP side: brought in by the feed (not native, submitted, an ERP number), not yet attributed to a project.
insert into public.sales_invoices (id, org_id, project_id, work_order_id, customer_id, si_number, invoice_date, amount,
                                   erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus, reference_number) values
  ('04840000-0000-0000-0000-0000000005e1', '04840000-0000-0000-0000-000000000001', null, null, '04840000-0000-0000-0000-0000000000f1',
   'SI-E1', '2026-03-20', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 1, 'PO-7'),
  ('04840000-0000-0000-0000-0000000005e3', '04840000-0000-0000-0000-000000000001', null, null, '04840000-0000-0000-0000-0000000000f1',
   'SI-E3', '2026-03-21', 3000, 3000, 'inclusive', 0, 'USD', 'Unpaid', 1, 'PO-3'),
  ('04840000-0000-0000-0000-0000000005e5', '04840000-0000-0000-0000-000000000001', null, null, '04840000-0000-0000-0000-0000000000f1',
   'SI-E5A', '2026-03-22', 7000, 7000, 'inclusive', 0, 'USD', 'Unpaid', 1, 'PO-5'),
  ('04840000-0000-0000-0000-0000000005e6', '04840000-0000-0000-0000-000000000001', null, null, '04840000-0000-0000-0000-0000000000f1',
   'SI-E5B', '2026-03-23', 7000, 7000, 'inclusive', 0, 'USD', 'Unpaid', 1, 'PO-5');
-- N7: PMO-raised, no project. A foreign-org ERP invoice F1 carries N7's exact keys AND points at org A's client, so only the
-- org predicates (not the client join) keep N7 from pairing across orgs.
insert into public.sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, reference_number, native_lines, pmo_native, author_user_id, pmo_number) values
  ('04840000-0000-0000-0000-0000000005a7', '04840000-0000-0000-0000-000000000001', null, '04840000-0000-0000-0000-0000000000f1',
   '2026-03-15', 4200, 4200, 'exclusive', 0, 'USD', 'Unpaid', 'PO-X', '[{"description":"n7"}]', true, '04840000-0000-0000-0000-0000000000a1', 'PMO-N7');
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, erp_docstatus, reference_number) values
  ('04840000-0000-0000-0000-0000000005f1', '04840000-0000-0000-0000-000000000002', null, '04840000-0000-0000-0000-0000000000f1',
   'SI-X1', '2026-03-20', 4200, 4200, 'inclusive', 0, 'USD', 'Unpaid', 1, 'PO-X');

-- ── 1. the column and the surface ─────────────────────────────────────────────────────────────
select has_column('public', 'sales_invoices', 'paired_erp_invoice_id', 'PD-ECA-11 sales_invoices carries paired_erp_invoice_id');
select ok(not has_function_privilege('anon', 'public.accept_invoice_pairs(jsonb)', 'execute'), 'accept_invoice_pairs is not anon-executable');
select ok(has_function_privilege('authenticated', 'public.accept_invoice_pairs(jsonb)', 'execute'), 'accept_invoice_pairs is authenticated-executable');

-- ── 2. propose: roles, tenancy, keys ──────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select * from public.propose_invoice_pairs()$$, '42501', null, 'an Engineer cannot read pair proposals');
select throws_ok($$select * from public.list_unpaired_native_invoices()$$, '42501', null, 'an Engineer cannot read the unpaired list');
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a1","erp":"04840000-0000-0000-0000-0000000005e1"}]'::jsonb)$$,
                 '42501', null, 'AC-ECA-030 an Engineer cannot accept a pair');
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select pmo_invoice_id, erp_invoice_id from public.propose_invoice_pairs() where not ambiguous$$,
                  $$values ('04840000-0000-0000-0000-0000000005a1'::uuid, '04840000-0000-0000-0000-0000000005e1'::uuid)$$,
                  'FR-ECA-040 Finance is proposed exactly (N1, E1): same client, reference, tax-inclusive total and month');
select is((select count(*)::int from public.propose_invoice_pairs() where pmo_invoice_id = '04840000-0000-0000-0000-0000000005a3'), 0,
          'PD-ECA-11 N3 (it has a PMO receipt) is never proposed');
select is((select count(*)::int from public.propose_invoice_pairs() where pmo_invoice_id = '04840000-0000-0000-0000-0000000005a2'), 0,
          'N2 (no ERP twin) is not proposed');
select is((select count(*)::int from public.propose_invoice_pairs()
            where pmo_invoice_id = '04840000-0000-0000-0000-0000000005a5' and ambiguous), 2,
          'two ERP candidates for N5: both listed, both flagged ambiguous');
select is((select count(*)::int from public.propose_invoice_pairs() where erp_invoice_id = '04840000-0000-0000-0000-0000000005f1'), 0,
          'another org''s ERP invoice with the same keys is never a candidate');
reset role;
-- amount off by one: no pair
set local session_replication_role = replica;
update public.sales_invoices set amount = 11101 where id = '04840000-0000-0000-0000-0000000005e1';
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.propose_invoice_pairs() where pmo_invoice_id = '04840000-0000-0000-0000-0000000005a1'), 0,
          'FR-ECA-040 an amount that differs by 1 proposes nothing');
reset role;
set local session_replication_role = replica;
update public.sales_invoices set amount = 11100 where id = '04840000-0000-0000-0000-0000000005e1';
-- a different month: no pair
update public.sales_invoices set invoice_date = '2026-04-02' where id = '04840000-0000-0000-0000-0000000005e1';
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.propose_invoice_pairs() where pmo_invoice_id = '04840000-0000-0000-0000-0000000005a1'), 0,
          'FR-ECA-040 a different invoice month proposes nothing');
reset role;
set local session_replication_role = replica;
update public.sales_invoices set invoice_date = '2026-03-20' where id = '04840000-0000-0000-0000-0000000005e1';
-- an ERP invoice cancelled in the ERP is not a candidate
update public.sales_invoices set erp_cancelled_at = now() where id = '04840000-0000-0000-0000-0000000005e1';
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.propose_invoice_pairs() where pmo_invoice_id = '04840000-0000-0000-0000-0000000005a1'), 0,
          'a cancelled ERP invoice is not a candidate');
reset role;
set local session_replication_role = replica;
update public.sales_invoices set erp_cancelled_at = null where id = '04840000-0000-0000-0000-0000000005e1';
set local session_replication_role = origin;
-- the foreign org's Finance sees nothing of org A
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.propose_invoice_pairs()), 0, 'another org''s Finance is proposed nothing of org A');
select is((select count(*)::int from public.list_unpaired_native_invoices()), 0, 'another org''s Finance lists no unpaired invoice of org A');
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a1","erp":"04840000-0000-0000-0000-0000000005e1"}]'::jsonb)$$,
                 '23514', null, 'AC-ECA-030 another org''s Finance cannot pair org A''s rows');
reset role;

-- ── 3. before accept: the double count the slice fixes ────────────────────────────────────────
-- E1 is attributed to the project (as the project mapping does once the ERP invoice is read in).
set local session_replication_role = replica;
update public.sales_invoices set project_id = '04840000-0000-0000-0000-0000000000c1' where id = '04840000-0000-0000-0000-0000000005e1';
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04840000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 36100::numeric,
          'before accept: invoiced counts N1 and E1 (the double count) + N2 + N3 + N5');
select is((public.get_project_finances('04840000-0000-0000-0000-0000000000c1') #>> '{invoices,0,outstanding}')::numeric, 36200::numeric,
          'before accept: receivable counts N1 and E1');
select is((select sum((x ->> 'net')::numeric) from jsonb_array_elements(public.get_management_pack('2026-01-01', '2026-12-01') -> 'invoiced') x
            where x ->> 'project_id' = '04840000-0000-0000-0000-0000000000c1'), 35000::numeric,
          'before accept: the management pack bills 35,000 net');

-- ── 4. accept (AC-ECA-030) ────────────────────────────────────────────────────────────────────
select is(public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a1","erp":"04840000-0000-0000-0000-0000000005e1"}]'::jsonb), 1,
          'AC-ECA-030 Finance accepts the pair: one pair applied');
reset role;
select is((select paired_erp_invoice_id from public.sales_invoices where id = '04840000-0000-0000-0000-0000000005a1'),
          '04840000-0000-0000-0000-0000000005e1'::uuid, 'AC-ECA-030 the PMO invoice links to the ERP one');
select is((select paired_by from public.sales_invoices where id = '04840000-0000-0000-0000-0000000005a1'),
          '04840000-0000-0000-0000-0000000000a1'::uuid, 'the accepting person is recorded');
select ok((select paired_at is not null from public.sales_invoices where id = '04840000-0000-0000-0000-0000000005a1'), 'the accept time is recorded');
select is((select work_order_id from public.sales_invoices where id = '04840000-0000-0000-0000-0000000005e1'),
          '04840000-0000-0000-0000-0000000000d1'::uuid, 'AC-ECA-030 the ERP invoice takes the PMO invoice''s work order');
select is((select project_id from public.sales_invoices where id = '04840000-0000-0000-0000-0000000005e1'),
          '04840000-0000-0000-0000-0000000000c1'::uuid, 'the ERP invoice stays on the project');
select is((select count(*)::int from public.audit_events where action = 'revenue.invoice_pair'
            and org_id = '04840000-0000-0000-0000-000000000001'), 1, 'one audit row records the accept');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04840000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 26100::numeric,
          'AC-ECA-030 get_project_finances: invoiced counts the sale once');
select is((public.get_project_finances('04840000-0000-0000-0000-0000000000c1') #>> '{invoices,0,outstanding}')::numeric, 25100::numeric,
          'AC-ECA-030 get_project_finances: the receivable counts the sale once');
select is((public.get_project_finances('04840000-0000-0000-0000-0000000000c1') #>> '{invoices,0,work_revenue}')::numeric, 25000::numeric,
          'AC-ECA-030 get_project_finances: work revenue counts the sale once');
select is((public.get_project_finances('04840000-0000-0000-0000-0000000000c1') ->> 'contract_invoiced')::numeric, 25000::numeric,
          'AC-ECA-030 get_project_finances: the contract draw-down counts the sale once');
select is((select sum((x ->> 'net')::numeric) from jsonb_array_elements(public.get_management_pack('2026-01-01', '2026-12-01') -> 'invoiced') x
            where x ->> 'project_id' = '04840000-0000-0000-0000-0000000000c1'), 25000::numeric,
          'AC-ECA-030 get_management_pack bills the sale once');
select is((public.get_project_billing('04840000-0000-0000-0000-0000000000c1') ->> 'work_billed')::numeric, 25000::numeric,
          'AC-ECA-030 get_project_billing bills the sale once');
select is((select count(*)::int from public.sales_invoice_work_billed where id = '04840000-0000-0000-0000-0000000005a1'), 0,
          'AC-ECA-030 sales_invoice_work_billed has no row for the paired PMO invoice');
select is((select count(*)::int from public.sales_invoice_work_billed where id = '04840000-0000-0000-0000-0000000005e1'), 1,
          'sales_invoice_work_billed keeps the ERP invoice');
select is((select count(*)::int from public.work_order_billing_lines where work_order_id = '04840000-0000-0000-0000-0000000000d1'), 1,
          'AC-ECA-030 work_order_billing_lines bills the work order once');
select is((select invoiced from public.work_order_billing where work_order_id = '04840000-0000-0000-0000-0000000000d1'), 10000::numeric,
          'AC-ECA-030 work_order_billing counts the work order''s invoice once');
-- the dashboards that read the shared view
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select (x ->> 'realized_margin')::numeric from json_array_elements(public.get_pm_dashboard_projects()) x
            where x ->> 'id' = '04840000-0000-0000-0000-0000000000c1'), 25000::numeric,
          'AC-ECA-030 get_pm_dashboard_projects bills the sale once (billed revenue less no spend)');
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select (x ->> 'known_billed_revenue')::numeric from json_array_elements(public.get_executive_dashboard() -> 'on_hand_realized_margin_by_currency') x
            where x ->> 'currency' = 'USD'), 25000::numeric,
          'AC-ECA-030 get_executive_dashboard bills the sale once');
select is((public.get_projects_money_collection(array['04840000-0000-0000-0000-0000000000c1']::uuid[])).project_id,
          '04840000-0000-0000-0000-0000000000c1'::uuid, 'get_projects_money_collection still answers for the project');
reset role;

-- ── 5. unpaired invoices keep counting and are listed with a reason ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select reason from public.list_unpaired_native_invoices() where invoice_id = '04840000-0000-0000-0000-0000000005a2'), 'no-match',
          'AC-ECA-030 N2 still counts and is listed: no match');
select is((select reason from public.list_unpaired_native_invoices() where invoice_id = '04840000-0000-0000-0000-0000000005a3'), 'has-receipt',
          'AC-ECA-030 N3 is listed: PMO already recorded a payment');
select is((select reason from public.list_unpaired_native_invoices() where invoice_id = '04840000-0000-0000-0000-0000000005a5'), 'ambiguous',
          'N5 is listed: more than one ERP candidate');
select is((select count(*)::int from public.list_unpaired_native_invoices() where invoice_id = '04840000-0000-0000-0000-0000000005a1'), 0,
          'the paired N1 is not listed as unpaired');
select is((select count(*)::int from public.propose_invoice_pairs() where pmo_invoice_id = '04840000-0000-0000-0000-0000000005a1'), 0,
          'a paired invoice is not proposed again');

-- ── 6. refusals ───────────────────────────────────────────────────────────────────────────────
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a3","erp":"04840000-0000-0000-0000-0000000005e3"}]'::jsonb)$$,
                 '23514', null, 'AC-ECA-030 a pair whose PMO invoice has a receipt is refused (no receipt counted twice)');
select is(public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a1","erp":"04840000-0000-0000-0000-0000000005e1"}]'::jsonb), 0,
          'accepting the same pair twice is a no-op');
reset role;
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, erp_docstatus, reference_number) values
  ('04840000-0000-0000-0000-0000000005e2', '04840000-0000-0000-0000-000000000001', null, '04840000-0000-0000-0000-0000000000f1',
   'SI-E1B', '2026-03-25', 11100, 11100, 'inclusive', 1100, 'USD', 'Unpaid', 1, 'PO-7');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a1","erp":"04840000-0000-0000-0000-0000000005e2"}]'::jsonb)$$,
                 '23514', null, 'a PMO invoice already paired cannot pair to a second ERP invoice');
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a5","erp":"04840000-0000-0000-0000-0000000005e5"}]'::jsonb)$$,
                 '23514', null, 'an ambiguous pair is refused (two ERP candidates)');
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a2","erp":"04840000-0000-0000-0000-0000000005e1"}]'::jsonb)$$,
                 '23514', null, 'an ERP invoice already counted as a pair target cannot take a second PMO invoice');
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a2","erp":"04840000-0000-0000-0000-0000000005e3"}]'::jsonb)$$,
                 '23514', null, 'a pair that does not match on reference and amount is refused (the list is never trusted)');
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a7","erp":"04840000-0000-0000-0000-0000000005f1"}]'::jsonb)$$,
                 '23514', null, 'AC-ECA-030 a cross-org pair with matching keys is refused');
select throws_ok($$select public.accept_invoice_pairs('{"pmo":"x"}'::jsonb)$$, '22023', null, 'a non-array pair list is refused');
reset role;
select is((select paired_erp_invoice_id from public.sales_invoices where id = '04840000-0000-0000-0000-0000000005a7'), null::uuid,
          'N7 was not paired to the other org''s ERP invoice');

-- ── 6b. an unattributed ERP copy takes the PMO copy's project (and the sale still counts once) ──
insert into public.sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, reference_number, native_lines, pmo_native, author_user_id, pmo_number) values
  ('04840000-0000-0000-0000-0000000005a6', '04840000-0000-0000-0000-000000000001', '04840000-0000-0000-0000-0000000000c1',
   '04840000-0000-0000-0000-0000000000f1', '2026-03-14', 2500, 2500, 'exclusive', 0, 'USD', 'Unpaid', 'PO-6',
   '[{"description":"n6"}]', true, '04840000-0000-0000-0000-0000000000a1', 'PMO-N6');
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount,
                                   tax_treatment, tax_amount, currency, status, erp_docstatus, reference_number) values
  ('04840000-0000-0000-0000-0000000005e7', '04840000-0000-0000-0000-000000000001', null, '04840000-0000-0000-0000-0000000000f1',
   'SI-E6', '2026-03-24', 2500, 2500, 'inclusive', 0, 'USD', 'Unpaid', 1, 'PO-6');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a6","erp":"04840000-0000-0000-0000-0000000005e7"}]'::jsonb), 1,
          'an Admin accepts a pair too');
reset role;
select is((select project_id from public.sales_invoices where id = '04840000-0000-0000-0000-0000000005e7'),
          '04840000-0000-0000-0000-0000000000c1'::uuid, 'the unattributed ERP copy takes the PMO copy''s project');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04840000-0000-0000-0000-0000000000c1') #>> '{invoices,0,invoiced}')::numeric, 28600::numeric,
          'the second sale is counted once too (26,100 + 2,500)');
reset role;

-- ── 7. the guard: only the accept may set the pair columns ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update public.sales_invoices set paired_erp_invoice_id = '04840000-0000-0000-0000-0000000005e3' where id = '04840000-0000-0000-0000-0000000005a2'$$,
                 '42501', null, 'PD-ECA-11 a direct write of paired_erp_invoice_id by a person is refused');
reset role;

-- a server-side session (current_user = postgres, no flag) is refused too: the flag, not the role alone, opens the pin
select throws_ok($$update public.sales_invoices set paired_erp_invoice_id = '04840000-0000-0000-0000-0000000005e3', paired_at = now(),
                          paired_by = '04840000-0000-0000-0000-0000000000a1' where id = '04840000-0000-0000-0000-0000000005a2'$$,
                 '42501', null, 'PD-ECA-11 the pair columns need the accept''s own flag, not just a privileged session');
select throws_ok($$update public.sales_invoices set work_order_id = '04840000-0000-0000-0000-0000000000d1' where id = '04840000-0000-0000-0000-0000000005a2'$$,
                 '42501', null, 'a privileged session without the pairing flag cannot fill a work order on an ERP-owned invoice');

-- ── 8. revenue not employed: no pairing at all ────────────────────────────────────────────────
delete from public.external_domain_ownership where org_id = '04840000-0000-0000-0000-000000000001' and domain = 'revenue';
set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.propose_invoice_pairs()), 0, 'no proposals while the ERP does not own revenue');
select throws_ok($$select public.accept_invoice_pairs('[{"pmo":"04840000-0000-0000-0000-0000000005a2","erp":"04840000-0000-0000-0000-0000000005e1"}]'::jsonb)$$,
                 '23514', null, 'no accept while the ERP does not own revenue');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"04840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update public.sales_invoices set paired_erp_invoice_id = '04840000-0000-0000-0000-0000000005e3' where id = '04840000-0000-0000-0000-0000000005a2'$$,
                 '42501', null, 'PD-ECA-11 the pair column is pinned even when the ERP does not own revenue');
reset role;

select * from finish();
rollback;
