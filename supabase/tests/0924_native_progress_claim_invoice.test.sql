-- 0924_native_progress_claim_invoice.test.sql — an organisation where no ERP owns revenue raises a progress claim's invoice in PMO.
-- AC-NAR-040..049 (docs/specs/no-erp-revenue.spec.md), AC-PBL-NAT-001..004 (docs/specs/progress-billing.spec.md §9). Ids: 09240000-… (synthetic).
-- Org a1 has no ERP; a2 is foreign; a3 has ONE user (the sole operator); a4 is ERP-owned.
-- Users: b1 fin1 (creates + evidences the claims), b5 fin3 (raises them), b2 fin2 and b3 admin (approve), b4 pm, b6 engineer,
-- b7 executive, b8 foreign admin, b9 disabled admin, ba sole-operator Finance (a3), bb ERP-org Finance (a4).
begin;
create extension if not exists pgtap;
select plan(108);

insert into organizations (id, name, default_currency, default_timezone) values
  ('09240000-0000-0000-0000-0000000000a1', 'NPC Org A', 'IDR', 'UTC'),
  ('09240000-0000-0000-0000-0000000000a2', 'NPC Org B', 'IDR', 'UTC'),
  ('09240000-0000-0000-0000-0000000000a3', 'NPC Sole', 'IDR', 'UTC'),
  ('09240000-0000-0000-0000-0000000000a4', 'NPC ERP', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('09240000-0000-0000-0000-0000000000b1', 'npc-fin1@example.com'),
  ('09240000-0000-0000-0000-0000000000b2', 'npc-fin2@example.com'),
  ('09240000-0000-0000-0000-0000000000b3', 'npc-admin@example.com'),
  ('09240000-0000-0000-0000-0000000000b4', 'npc-pm@example.com'),
  ('09240000-0000-0000-0000-0000000000b5', 'npc-fin3@example.com'),
  ('09240000-0000-0000-0000-0000000000b6', 'npc-eng@example.com'),
  ('09240000-0000-0000-0000-0000000000b7', 'npc-exec@example.com'),
  ('09240000-0000-0000-0000-0000000000b8', 'npc-foreign@example.com'),
  ('09240000-0000-0000-0000-0000000000b9', 'npc-off@example.com'),
  ('09240000-0000-0000-0000-0000000000ba', 'npc-sole@example.com'),
  ('09240000-0000-0000-0000-0000000000bb', 'npc-erp@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09240000-0000-0000-0000-0000000000b1', '09240000-0000-0000-0000-0000000000a1', 'NPC Finance 1', 'npc-fin1@example.com', 'Finance', 'active'),
  ('09240000-0000-0000-0000-0000000000b2', '09240000-0000-0000-0000-0000000000a1', 'NPC Finance 2', 'npc-fin2@example.com', 'Finance', 'active'),
  ('09240000-0000-0000-0000-0000000000b3', '09240000-0000-0000-0000-0000000000a1', 'NPC Admin', 'npc-admin@example.com', 'Admin', 'active'),
  ('09240000-0000-0000-0000-0000000000b4', '09240000-0000-0000-0000-0000000000a1', 'NPC PM', 'npc-pm@example.com', 'Project Manager', 'active'),
  ('09240000-0000-0000-0000-0000000000b5', '09240000-0000-0000-0000-0000000000a1', 'NPC Finance 3', 'npc-fin3@example.com', 'Finance', 'active'),
  ('09240000-0000-0000-0000-0000000000b6', '09240000-0000-0000-0000-0000000000a1', 'NPC Engineer', 'npc-eng@example.com', 'Engineer', 'active'),
  ('09240000-0000-0000-0000-0000000000b7', '09240000-0000-0000-0000-0000000000a1', 'NPC Executive', 'npc-exec@example.com', 'Executive', 'active'),
  ('09240000-0000-0000-0000-0000000000b8', '09240000-0000-0000-0000-0000000000a2', 'NPC Foreign Admin', 'npc-foreign@example.com', 'Admin', 'active'),
  ('09240000-0000-0000-0000-0000000000b9', '09240000-0000-0000-0000-0000000000a1', 'NPC Disabled Admin', 'npc-off@example.com', 'Admin', 'disabled'),
  ('09240000-0000-0000-0000-0000000000ba', '09240000-0000-0000-0000-0000000000a3', 'NPC Sole Finance', 'npc-sole@example.com', 'Finance', 'active'),
  ('09240000-0000-0000-0000-0000000000bb', '09240000-0000-0000-0000-0000000000a4', 'NPC ERP Finance', 'npc-erp@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('09240000-0000-0000-0000-0000000000cc', '09240000-0000-0000-0000-0000000000a1', 'NPC Client', 'Client'),
  ('09240000-0000-0000-0000-0000000000cd', '09240000-0000-0000-0000-0000000000a3', 'NPC Sole Client', 'Client'),
  ('09240000-0000-0000-0000-0000000000ce', '09240000-0000-0000-0000-0000000000a4', 'NPC ERP Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('09240000-0000-0000-0000-0000000000c1', '09240000-0000-0000-0000-0000000000a1', 'NPC no VAT', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09240000-0000-0000-0000-0000000000cc'),
  ('09240000-0000-0000-0000-0000000000c2', '09240000-0000-0000-0000-0000000000a1', 'NPC VAT', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, 12, 11, 12, true, '09240000-0000-0000-0000-0000000000cc'),
  ('09240000-0000-0000-0000-0000000000c3', '09240000-0000-0000-0000-0000000000a1', 'NPC no client', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, null),
  ('09240000-0000-0000-0000-0000000000c4', '09240000-0000-0000-0000-0000000000a1', 'NPC variants', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09240000-0000-0000-0000-0000000000cc'),
  ('09240000-0000-0000-0000-0000000000c5', '09240000-0000-0000-0000-0000000000a1', 'NPC VAT no rate', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, true, '09240000-0000-0000-0000-0000000000cc'),
  ('09240000-0000-0000-0000-0000000000c6', '09240000-0000-0000-0000-0000000000a1', 'NPC work order', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09240000-0000-0000-0000-0000000000cc'),
  ('09240000-0000-0000-0000-0000000000d1', '09240000-0000-0000-0000-0000000000a3', 'NPC sole project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09240000-0000-0000-0000-0000000000cd'),
  ('09240000-0000-0000-0000-0000000000e1', '09240000-0000-0000-0000-0000000000a4', 'NPC ERP project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09240000-0000-0000-0000-0000000000ce');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('09240000-0000-0000-0000-000000000e01', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000),
  ('09240000-0000-0000-0000-000000000e02', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c1', 'STATION', 'Station build', 'unit', 5, 100000),
  ('09240000-0000-0000-0000-000000000e03', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c2', 'SURVEY', 'Route survey', 'km', 10, 50000),
  ('09240000-0000-0000-0000-000000000e04', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c3', 'CABLE', 'Cable pull', 'km', 10, 1000),
  ('09240000-0000-0000-0000-000000000e05', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c4', 'POLE', 'Pole set', 'unit', 100, 10000),
  ('09240000-0000-0000-0000-000000000e06', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c5', 'DUCT', 'Duct', 'm', 10, 1000),
  ('09240000-0000-0000-0000-000000000e07', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c6', 'MAST', 'Mast', 'unit', 5, 100000),
  ('09240000-0000-0000-0000-000000000e08', '09240000-0000-0000-0000-0000000000a3', '09240000-0000-0000-0000-0000000000d1', 'SOLE', 'Sole line', 'unit', 10, 1000);
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency) values
  ('09240000-0000-0000-0000-0000000000f4', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c6', 'NPC WO', 'Issued', 'WO-NPC-4', 1000000, 'exclusive', 0, 'IDR');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000f4', '09240000-0000-0000-0000-000000000e07', 5);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path)
select ('09240000-0000-0000-0000-00000000' || d.n)::uuid, d.org::uuid, d.project::uuid, 'Contract', 'NPC evidence ' || d.n, 'Approved', d.author::uuid,
       d.org || '/' || d.project || '/' || '09240000-0000-0000-0000-00000000' || d.n || '/npc.pdf'
  from (values
    ('0f01', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c1', '09240000-0000-0000-0000-0000000000b1'),
    ('0f02', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c2', '09240000-0000-0000-0000-0000000000b1'),
    ('0f03', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c3', '09240000-0000-0000-0000-0000000000b1'),
    ('0f04', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c4', '09240000-0000-0000-0000-0000000000b1'),
    ('0f05', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c5', '09240000-0000-0000-0000-0000000000b1'),
    ('0f06', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c6', '09240000-0000-0000-0000-0000000000b1'),
    ('0f07', '09240000-0000-0000-0000-0000000000a3', '09240000-0000-0000-0000-0000000000d1', '09240000-0000-0000-0000-0000000000ba'),
    ('0f08', '09240000-0000-0000-0000-0000000000a4', '09240000-0000-0000-0000-0000000000e1', '09240000-0000-0000-0000-0000000000bb')
  ) as d(n, org, project, author);

create temp table _state (k text primary key, v text not null) on commit drop;
grant all on _state to authenticated;
create function pg_temp.detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics d = pg_exception_detail; return sqlstate || ' ' || coalesce(d, ''); end $$;
create function pg_temp.st(p_k text) returns text language sql as $$ select v from _state where k = p_k $$;
create function pg_temp.bill(p_project uuid, p_key text) returns numeric language sql as $$ select (public.get_project_billing(p_project) ->> p_key)::numeric $$;
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"09240000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.doc(p_n text) returns uuid language sql as $$ select ('09240000-0000-0000-0000-00000000' || p_n)::uuid $$;

-- ── AC-NAR-040: a no-ERP org makes a down payment claim (no item to choose), evidences it and raises its invoice ──
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'dp1', create_progress_claim('09240000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text$q$,
  'AC-NAR-040 Finance bills a down payment in an organisation with no ERP and no down payment item');
select is((select dp_item_code from progress_claims where id = pg_temp.st('dp1')::uuid), public.native_down_payment_item(),
  'AC-NAR-040 the claim names the one fixed native item');
select is(public.native_down_payment_item(), 'DOWN-PAYMENT', 'AC-NAR-040 the native item is one fixed value');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('dp1')::uuid, pg_temp.doc('0f01'))$q$, 'AC-NAR-040 evidence attaches with no ERP');
select pg_temp.as_user('b5');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_billed'), 0::numeric, 'AC-PBL-NAT-001 CONTROL before the raise nothing is billed');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('dp1')::uuid)$q$, 'AC-NAR-041 Finance raises the down payment invoice in PMO');
reset role;
select is((select row(status, pmo_native, amount, billing_kind, currency, work_order_id is null, si_number is null)::text from sales_invoices where id = pg_temp.st('dp1')::uuid),
  row('Draft', true, 200000.00::numeric, 'contract', 'IDR', true, true)::text,
  'AC-NAR-041 the invoice is a native Draft with the claim id, the claim amount and contract billing');
select is((select native_lines::text from sales_invoices where id = pg_temp.st('dp1')::uuid),
  '[{"qty": 1, "rate": 200000.00, "role": "down_payment", "amount": 200000.00, "item_code": null, "description": "Down payment"}]',
  'AC-NAR-041 the down payment line is named by role and description, never by the native item code');
select is((select array_agg(user_id order by user_id) from sales_invoice_authors where sales_invoice_id = pg_temp.st('dp1')::uuid),
  array['09240000-0000-0000-0000-0000000000b1','09240000-0000-0000-0000-0000000000b5']::uuid[],
  'AC-NAR-044 the authors are the claim creator and the person who raised the invoice');
select is((select count(*)::int from audit_events where action = 'progress_claim_native_invoice.create' and entity_id = pg_temp.st('dp1')::uuid), 1,
  'AC-NAR-041 the raise is audited once');
select pg_temp.as_user('b5');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_billed'), 0::numeric, 'AC-PBL-NAT-001 a Draft down payment invoice is not yet billed');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'not_submitted'), 200000::numeric, 'AC-PBL-NAT-001 a Draft invoice shows once, as not submitted');

-- ── AC-NAR-044: approval is by someone who is not an author ────────────────────────────────────
select is(pg_temp.detail($q$select transition_native_sales_invoice(pg_temp.st('dp1')::uuid, 'Unpaid')$q$), '42501 sod-self-approval', 'AC-NAR-044 the person who raised it cannot approve');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select transition_native_sales_invoice(pg_temp.st('dp1')::uuid, 'Unpaid')$q$), '42501 sod-self-approval', 'AC-NAR-044 the claim''s creator cannot approve');
select pg_temp.as_user('b2');
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('dp1')::uuid, 'Unpaid')$q$, 'AC-NAR-044 a second Finance user approves');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_billed'), 200000::numeric, 'AC-PBL-NAT-001 the approved down payment is held once');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'not_submitted'), 0::numeric, 'AC-PBL-NAT-001 and is no longer not submitted');

-- ── AC-PBL-NAT-002: a progress claim recovering part of the advance — held, recovered and remaining each move once ──
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'pc1', create_progress_claim('09240000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e01","quantity":4}]'::jsonb)::text$q$, 'AC-PBL-NAT-002 a 200,000 progress claim recovers 20% of the advance');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('pc1')::uuid, pg_temp.doc('0f01'))$q$, 'AC-PBL-NAT-002 evidence attached');
select pg_temp.as_user('b5');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$, 'AC-PBL-NAT-002 the claim''s invoice is raised in PMO');
reset role;
select is((select row(amount, tax_amount, status)::text from sales_invoices where id = pg_temp.st('pc1')::uuid), row(160000.00::numeric, 0.00::numeric, 'Draft')::text,
  'AC-PBL-NAT-002 the invoice total is the claim''s net: 200,000 gross less the 40,000 recovered');
select is((select native_lines::text from sales_invoices where id = pg_temp.st('pc1')::uuid),
  '[{"qty": 4.000, "rate": 50000.00, "amount": 200000.00, "item_code": "SURVEY", "description": "Route survey (km)"}, '
  || '{"qty": 1, "rate": -40000.00, "role": "down_payment_recovery", "amount": -40000.00, "item_code": null, "description": "Down payment recovery"}]',
  'AC-PBL-NAT-002 the lines are the claim line as claimed and one negative recovery line');
select pg_temp.as_user('b5');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'work_billed'), 0::numeric, 'AC-PBL-NAT-002 CONTROL a Draft claim invoice bills no work yet');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_recovered'), 0::numeric, 'AC-PBL-NAT-002 CONTROL and recovers nothing yet');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'not_submitted'), 160000::numeric, 'AC-PBL-NAT-002 the Draft shows once, at its net');
select pg_temp.as_user('b3');
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('pc1')::uuid, 'Unpaid')$q$, 'AC-PBL-NAT-002 an Admin approves it');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'work_billed'), 200000::numeric, 'AC-PBL-NAT-002 work billed moves once, by the claim''s gross');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_billed'), 200000::numeric, 'AC-PBL-NAT-002 the advance held is unchanged');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_recovered'), 40000::numeric, 'AC-PBL-NAT-002 the advance recovered moves once');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_billed') - pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_recovered'), 160000::numeric,
  'AC-PBL-NAT-002 the advance remaining is 160,000');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'not_submitted'), 0::numeric, 'AC-PBL-NAT-002 and nothing is left as not submitted');
-- the payment is received in PMO and the figures do not move again
select lives_ok($q$select record_native_receipt(pg_temp.st('pc1')::uuid, p_amount => 160000, p_date => current_date)$q$, 'AC-NAR-045 the payment is received in PMO');
select is((select status from sales_invoices where id = pg_temp.st('pc1')::uuid), 'Paid', 'AC-NAR-045 the invoice is Paid');
select is(row(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'work_billed'), pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_billed'),
              pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_recovered'))::text, row(200000.00::numeric, 200000.00::numeric, 40000.00::numeric)::text,
  'AC-NAR-045 paying it moves no billing figure a second time');

-- ── AC-PBL-NAT-003: a cancelled native claim invoice is treated like a cancelled ERP one ────────
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'pc2', create_progress_claim('09240000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e02","quantity":1}]'::jsonb)::text$q$, 'AC-PBL-NAT-003 a second claim, 100,000');
select is((select dp_recovery_amount from progress_claims where id = pg_temp.st('pc2')::uuid), 20000.00::numeric, 'AC-PBL-NAT-003 it recovers 20,000 of the remaining advance');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('pc2')::uuid, pg_temp.doc('0f01'))$q$, 'AC-PBL-NAT-003 evidence attached');
select pg_temp.as_user('b5');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc2')::uuid)$q$, 'AC-PBL-NAT-003 invoice raised');
select is(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'not_submitted'), 80000::numeric, 'AC-PBL-NAT-003 the Draft counts once');
select pg_temp.as_user('b3');
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('pc2')::uuid, 'Cancelled')$q$, 'AC-PBL-NAT-003 the Admin cancels the Draft');
select is(row(pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'not_submitted'), pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'work_billed'),
              pg_temp.bill('09240000-0000-0000-0000-0000000000c1', 'dp_recovered'))::text, row(0::numeric, 200000.00::numeric, 40000.00::numeric)::text,
  'AC-PBL-NAT-003 a cancelled native invoice counts nowhere');
select is((select coalesce((select (l ->> 'claimed_quantity')::numeric from jsonb_array_elements(get_project_billing('09240000-0000-0000-0000-0000000000c1') -> 'boq') l
                              where l ->> 'boq_item_id' = '09240000-0000-0000-0000-000000000e02'), -1)), 0::numeric,
  'AC-PBL-NAT-003 and its quantity is claimable again');
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('pc2')::uuid)$q$), 'P0001 claim-already-invoiced',
  'AC-NAR-043 a cancelled invoice still blocks a second one for the claim');

-- ── AC-NAR-046: tax parity with the generic native invoice and with the ERP's body (tax on the net) ──
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'dp2', create_progress_claim('09240000-0000-0000-0000-0000000000c2', 'down_payment', p_down_payment_amount => 100000, p_recovery_pct => 50)::text$q$, 'AC-NAR-046 VAT project: down payment claim');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('dp2')::uuid, pg_temp.doc('0f02'))$q$, 'AC-NAR-046 evidence');
select pg_temp.as_user('b5');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('dp2')::uuid)$q$, 'AC-NAR-046 down payment invoiced');
select pg_temp.as_user('b2');
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('dp2')::uuid, 'Unpaid')$q$, 'AC-NAR-046 and approved');
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'pc3', create_progress_claim('09240000-0000-0000-0000-0000000000c2', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e03","quantity":6}]'::jsonb)::text$q$, 'AC-NAR-046 a 300,000 claim that recovers the remaining 100,000');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('pc3')::uuid, pg_temp.doc('0f02'))$q$, 'AC-NAR-046 evidence');
select pg_temp.as_user('b5');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc3')::uuid)$q$, 'AC-NAR-046 invoiced');
select lives_ok($q$insert into _state select 'generic', create_native_sales_invoice('09240000-0000-0000-0000-0000000000c2', '09240000-0000-0000-0000-0000000000cc',
  '[{"description":"Net of the claim","qty":1,"rate":200000}]'::jsonb)::text$q$, 'AC-NAR-046 the generic creator invoices the claim''s net as one line');
reset role;
select is((select row(a.amount, a.tax_rate, a.tax_amount, a.tax_base_numerator, a.tax_base_denominator, a.tax_treatment, a.currency)::text from sales_invoices a where a.id = pg_temp.st('pc3')::uuid),
          (select row(b.amount, b.tax_rate, b.tax_amount, b.tax_base_numerator, b.tax_base_denominator, b.tax_treatment, b.currency)::text from sales_invoices b where b.id = pg_temp.st('generic')::uuid),
  'AC-NAR-046 amount, VAT rate, base, tax and currency equal the generic native invoice of the claim''s net');
select is((select tax_amount from sales_invoices where id = pg_temp.st('pc3')::uuid), 22000.00::numeric, 'AC-NAR-046 CONTROL the VAT is 12% on 11/12 of the net 200,000, not of the gross');
select is((select tax_amount from sales_invoices where id = pg_temp.st('dp2')::uuid), 11000.00::numeric, 'AC-NAR-046 CONTROL a down payment invoice carries VAT on its amount');

-- ── AC-NAR-042: the gate, role, tenant, ownership and claim rules ───────────────────────────────
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'v1', create_progress_claim('09240000-0000-0000-0000-0000000000c4', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e05","quantity":1}]'::jsonb)::text$q$, 'AC-NAR-043 a claim with no evidence');
select pg_temp.as_user('b5');
select throws_ok($q$select create_native_progress_claim_invoice(pg_temp.st('v1')::uuid)$q$, '55000',
  'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice',
  'AC-NAR-043 a claim with no evidence is refused');
select pg_temp.as_user('b1');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('v1')::uuid)$q$, 'AC-NAR-043 the claim is withdrawn (no ERP needed)');
select pg_temp.as_user('b5');
select throws_ok($q$select create_native_progress_claim_invoice(pg_temp.st('v1')::uuid)$q$, '55000',
  'this progress claim was withdrawn, so no invoice can be raised for it', 'AC-NAR-043 a withdrawn claim is refused');
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'v2', create_progress_claim('09240000-0000-0000-0000-0000000000c3', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e04","quantity":1}]'::jsonb)::text$q$, 'AC-NAR-043 a claim on a project with no client');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('v2')::uuid, pg_temp.doc('0f03'))$q$, 'AC-NAR-043 evidence');
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('v2')::uuid)$q$), 'P0002 no-client', 'AC-NAR-043 a project with no client is refused with no-client');
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'v3', create_progress_claim('09240000-0000-0000-0000-0000000000c5', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e06","quantity":1}]'::jsonb)::text$q$, 'AC-NAR-043 a claim on a VAT project with no rate');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('v3')::uuid, pg_temp.doc('0f05'))$q$, 'AC-NAR-043 evidence');
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('v3')::uuid)$q$), 'P0001 vat-rate-missing', 'AC-NAR-043 a VAT project with no rate is refused with vat-rate-missing');
reset role;
-- owner-built variants: header disagreeing with its lines, another currency, a time-and-materials claim, a fully recovered claim
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, dp_recovery_amount, created_by) values
  ('09240000-0000-0000-0000-000000000101', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c4', 'progress', 'IDR', 1000, 0, '09240000-0000-0000-0000-0000000000b1'),
  ('09240000-0000-0000-0000-000000000102', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c4', 'progress', 'USD', 1000, 0, '09240000-0000-0000-0000-0000000000b1');
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, dp_recovery_amount, dp_item_code, created_by) values
  ('09240000-0000-0000-0000-000000000104', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c4', 'progress', 'IDR', 1000, 1000, 'X', '09240000-0000-0000-0000-0000000000b1');
insert into progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit, quantity, rate, amount) values
  ('09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-000000000101', '09240000-0000-0000-0000-000000000e05', 'POLE', 'Pole set', 'unit', 1, 900, 900),
  ('09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-000000000102', '09240000-0000-0000-0000-000000000e05', 'POLE', 'Pole set', 'unit', 1, 1000, 1000),
  ('09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-000000000104', '09240000-0000-0000-0000-000000000e05', 'POLE', 'Pole set', 'unit', 1, 1000, 1000);
insert into progress_claim_evidence (org_id, claim_id, document_id, document_status, attached_by)
select '09240000-0000-0000-0000-0000000000a1', c, pg_temp.doc('0f04'), 'Approved', '09240000-0000-0000-0000-0000000000b1'
  from unnest(array['09240000-0000-0000-0000-000000000101','09240000-0000-0000-0000-000000000102','09240000-0000-0000-0000-000000000104']::uuid[]) c;
insert into tm_claims (id, org_id, project_id, period_from, period_to, status, currency, gross_amount, prepared_by)
values ('09240000-0000-0000-0000-000000000103', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c4', '2026-10-01', '2026-10-31', 'Draft', 'IDR', 0, '09240000-0000-0000-0000-0000000000b4');
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, dp_recovery_amount, created_by)
values ('09240000-0000-0000-0000-000000000103', '09240000-0000-0000-0000-0000000000a1', '09240000-0000-0000-0000-0000000000c4', 'time_materials', 'IDR', 0, 0, '09240000-0000-0000-0000-0000000000b4');
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice('09240000-0000-0000-0000-000000000101')$q$), '23514 claim-total-mismatch',
  'AC-NAR-043 a claim whose lines do not add up to its total is refused');
select throws_ok($q$select create_native_progress_claim_invoice('09240000-0000-0000-0000-000000000102')$q$, '23514', 'the claim is in USD but the project is in IDR',
  'AC-NAR-043 a claim in another currency than its project is refused');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice('09240000-0000-0000-0000-000000000103')$q$), 'P0001 claim-kind',
  'AC-NAR-043 a time-and-materials claim is not invoiced here');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice('09240000-0000-0000-0000-000000000104')$q$), '23514 invoice-total-invalid',
  'AC-NAR-043 a claim recovered in full has nothing to invoice');
-- roles and tenants
select pg_temp.as_user('b4');
select throws_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$, '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-042 a Project Manager cannot raise it');
select pg_temp.as_user('b6');
select throws_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$, '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-042 an Engineer cannot raise it');
select pg_temp.as_user('b7');
select throws_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$, '42501', 'only Finance or an Admin can raise a customer invoice', 'AC-NAR-042 an Executive cannot raise it');
select pg_temp.as_user('b9');
select throws_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$, '42501', null, 'AC-NAR-042 a disabled Admin is refused');
select pg_temp.as_user('b8');
select throws_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$, 'P0002', 'claim not found', 'AC-NAR-042 another organisation''s claim is not found');
reset role;
select ok(not has_function_privilege('anon', 'public.create_native_progress_claim_invoice(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.create_native_progress_claim_invoice(uuid)', 'execute')
          and (select p.prosecdef and p.proconfig = array['search_path=public'] from pg_proc p where p.oid = 'public.create_native_progress_claim_invoice(uuid)'::regprocedure),
  'AC-NAR-042 anon cannot execute it, authenticated can, and it is a pinned security definer');
-- an ERP that owns revenue keeps the ERP path; the module switch refuses
set local session_replication_role = replica;
insert into external_domain_ownership (org_id, external_tier, domain) values ('09240000-0000-0000-0000-0000000000a1', 'erpnext', 'revenue');
set local session_replication_role = origin;
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice('09240000-0000-0000-0000-000000000101')$q$), '42501 erp-owns-revenue', 'AC-NAR-042 an organisation whose ERP owns revenue is refused with erp-owns-revenue');
reset role;
delete from external_domain_ownership where org_id = '09240000-0000-0000-0000-0000000000a1';
insert into org_features (org_id, feature_key, enabled) values ('09240000-0000-0000-0000-0000000000a1', 'sales_invoices', false);
select pg_temp.as_user('b5');
select throws_ok($q$select create_native_progress_claim_invoice('09240000-0000-0000-0000-000000000101')$q$, 'P0001', 'feature_off', 'AC-NAR-042 with sales invoices switched off it refuses feature_off');
reset role;
delete from org_features where org_id = '09240000-0000-0000-0000-0000000000a1' and feature_key = 'sales_invoices';

-- ── a work-order claim: its work order's billed total does not change when its claim becomes an invoice ──
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'w1', create_progress_claim('09240000-0000-0000-0000-0000000000c6', 'progress', '09240000-0000-0000-0000-0000000000f4',
  '[{"boq_item_id":"09240000-0000-0000-0000-000000000e07","quantity":2}]'::jsonb)::text$q$, 'AC-NAR-047 a claim on a work order');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('w1')::uuid, pg_temp.doc('0f06'))$q$, 'AC-NAR-047 evidence');
reset role;
select is((select sum(billed)::text from work_order_billing_lines where work_order_id = '09240000-0000-0000-0000-0000000000f4'), '200000.00', 'AC-NAR-047 CONTROL the unraised claim counts against its work order at gross');
select pg_temp.as_user('b5');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('w1')::uuid)$q$, 'AC-NAR-047 the work-order claim is invoiced');
reset role;
select is((select sum(billed)::text from work_order_billing_lines where work_order_id = '09240000-0000-0000-0000-0000000000f4'), '200000.00', 'AC-NAR-047 the work order''s billed total does not change');
select is((select work_order_id from sales_invoices where id = pg_temp.st('w1')::uuid), '09240000-0000-0000-0000-0000000000f4'::uuid, 'AC-NAR-047 the invoice names the work order');

-- ── AC-NAR-048: a sole-operator organisation cannot approve its own invoice ─────────────────────
select pg_temp.as_user('ba');
select lives_ok($q$insert into _state select 'so', create_progress_claim('09240000-0000-0000-0000-0000000000d1', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e08","quantity":2}]'::jsonb)::text$q$, 'AC-NAR-048 the only user makes a claim');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('so')::uuid, pg_temp.doc('0f07'))$q$, 'AC-NAR-048 evidences it');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('so')::uuid)$q$, 'AC-NAR-048 and raises it');
select is(pg_temp.detail($q$select transition_native_sales_invoice(pg_temp.st('so')::uuid, 'Unpaid')$q$), '42501 sod-self-approval', 'AC-NAR-048 and cannot approve it');
reset role;
select is((select status from sales_invoices where id = pg_temp.st('so')::uuid), 'Draft', 'AC-NAR-048 the invoice stays a Draft');

-- ── AC-NAR-049: an ERP-owned organisation is unchanged ──────────────────────────────────────────
set local session_replication_role = replica;
insert into external_domain_ownership (org_id, external_tier, domain) values ('09240000-0000-0000-0000-0000000000a4', 'erpnext', 'revenue');
set local session_replication_role = origin;
select pg_temp.as_user('bb');
select throws_ok($q$select create_progress_claim('09240000-0000-0000-0000-0000000000e1', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10)$q$,
  'P0001', 'set the down payment item in Administration → Accounting before billing a down payment',
  'AC-NAR-049 an ERP-owned organisation with no item still gets today''s refusal');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice('09240000-0000-0000-0000-000000000101')$q$), '42501 erp-owns-revenue'
  , 'AC-NAR-049 and cannot raise a native invoice');
reset role;
update organizations set down_payment_item = 'ERP-ITEM' where id = '09240000-0000-0000-0000-0000000000a4';
select pg_temp.as_user('bb');
select lives_ok($q$insert into _state select 'edp', create_progress_claim('09240000-0000-0000-0000-0000000000e1', 'down_payment', p_down_payment_amount => 1000, p_recovery_pct => 10)::text$q$,
  'AC-NAR-049 with its item set an ERP-owned organisation bills a down payment');
select is((select dp_item_code from progress_claims where id = pg_temp.st('edp')::uuid), 'ERP-ITEM', 'AC-NAR-049 and the claim names the organisation''s own item');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('edp')::uuid, pg_temp.doc('0f08'))$q$, 'AC-NAR-049 evidence attaches');
reset role;
select lives_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09240000-0000-0000-0000-0000000000a4', 'revenue', pg_temp.st('edp'), 'npc-edp', 'erpnext', 'create', 'pending')$q$, 'AC-NAR-049 the ERP raise of a claim with the organisation''s item goes through the fence');

-- ── AC-NAR-050: the ERP raise never carries PMO's own item ─────────────────────────────────────
select throws_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09240000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('dp1'), 'npc-dp1', 'erpnext', 'create', 'pending')$q$, '55000',
  'this claim uses the down payment item PMO applies when no ERP is connected: set the ERP''s down payment item in Administration → Accounting, then withdraw this claim and assemble it again',
  'AC-NAR-050 a claim that names PMO''s own down payment item is refused at the ERP raise, in plain words');
select throws_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09240000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('pc1'), 'npc-pc1', 'erpnext', 'create', 'pending')$q$, '55000', null,
  'AC-NAR-050 and so is a progress claim that recovers that advance');


-- ── AC-NAR-051: an ERP raise for the claim still in flight blocks the native invoice ───────────────
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'inf', create_progress_claim('09240000-0000-0000-0000-0000000000c4', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e05","quantity":1}]'::jsonb)::text$q$, 'AC-NAR-051 a claim with no down payment to recover');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('inf')::uuid, pg_temp.doc('0f04'))$q$, 'AC-NAR-051 evidence attached');
reset role;
select lives_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09240000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('inf'), 'npc-inf', 'erpnext', 'create', 'pending')$q$, 'AC-NAR-051 an ERP raise of the claim is in flight');
select pg_temp.as_user('b5');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('inf')::uuid)$q$), 'P0001 claim-erp-raise-in-flight',
  'AC-NAR-051 the claim cannot also be invoiced in PMO');
reset role;
update external_command_outbox set state = 'failed' where idempotency_key = 'npc-inf';
select pg_temp.as_user('b5');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('inf')::uuid)$q$, 'AC-NAR-051 CONTROL once that ERP raise has failed the claim can be invoiced in PMO');
reset role;

-- ── AC-NAR-052: a down payment invoiced in PMO is still recoverable after an ERP takes over revenue ──────────
set local session_replication_role = replica;
insert into external_domain_ownership (org_id, external_tier, domain) values ('09240000-0000-0000-0000-0000000000a1', 'erpnext', 'revenue');
set local session_replication_role = origin;
select pg_temp.as_user('b1');
select throws_ok($q$select create_progress_claim('09240000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e02","quantity":1}]'::jsonb, p_recover_remaining => true)$q$,
  'P0001', 'set the down payment item in Administration → Accounting before recovering the down payment',
  'AC-NAR-052 with the ERP in charge and no item set, recovering the PMO down payment says to set the item');
reset role;
update organizations set down_payment_item = 'ERP-A1' where id = '09240000-0000-0000-0000-0000000000a1';
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'rec', create_progress_claim('09240000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09240000-0000-0000-0000-000000000e02","quantity":1}]'::jsonb, p_recover_remaining => true)::text$q$,
  'AC-NAR-052 with the item set, the recovering claim is made');
select is((select dp_item_code from progress_claims where id = pg_temp.st('rec')::uuid), 'ERP-A1', 'AC-NAR-052 and names the organisation''s ERP item, not PMO''s');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('rec')::uuid, pg_temp.doc('0f01'))$q$, 'AC-NAR-052 evidence attached');
reset role;
select lives_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09240000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('rec'), 'npc-rec', 'erpnext', 'create', 'pending')$q$, 'AC-NAR-052 and its ERP raise passes the fence');

-- ── AC-NAR-053: an ERP item that really is called DOWN-PAYMENT is the organisation's own, and passes the fence ──
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
values ('09240000-0000-0000-0000-0000000000e3', '09240000-0000-0000-0000-0000000000a4', '09240000-0000-0000-0000-0000000000e1', 'down_payment', 'IDR', 10, 10, 10, 0,
        'DOWN-PAYMENT', '09240000-0000-0000-0000-0000000000bb');
select pg_temp.as_user('bb');
select lives_ok($q$select attach_claim_evidence('09240000-0000-0000-0000-0000000000e3', pg_temp.doc('0f08'))$q$, 'AC-NAR-053 evidence attached');
reset role;
select throws_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09240000-0000-0000-0000-0000000000a4', 'revenue', '09240000-0000-0000-0000-0000000000e3', 'npc-e3a', 'erpnext', 'create', 'pending')$q$, '55000', null,
  'AC-NAR-053 CONTROL PMO''s item is refused while the organisation''s own item is another');
update organizations set down_payment_item = 'DOWN-PAYMENT' where id = '09240000-0000-0000-0000-0000000000a4';
select lives_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09240000-0000-0000-0000-0000000000a4', 'revenue', '09240000-0000-0000-0000-0000000000e3', 'npc-e3b', 'erpnext', 'create', 'pending')$q$,
  'AC-NAR-053 the same item passes when it is the organisation''s own ERP item');

select * from finish();
rollback;
