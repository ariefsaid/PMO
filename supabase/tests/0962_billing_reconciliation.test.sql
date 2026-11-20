-- 0962_billing_reconciliation.test.sql — per-item reconciliation of progress, measured and billed quantities, and the full trace
-- of one work order from progress to invoice with every document attached and retention held.
-- AC-BST-020, AC-TRACE-001 (docs/specs/billing-stages.spec.md). Ids: 09620000-… (synthetic).
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency, default_timezone) values
  ('09620000-0000-0000-0000-0000000000a1', 'REC Org A', 'IDR', 'UTC'),
  ('09620000-0000-0000-0000-0000000000a2', 'REC Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('09620000-0000-0000-0000-0000000000b1', 'rec-fin1@example.com'),
  ('09620000-0000-0000-0000-0000000000b2', 'rec-fin2@example.com'),
  ('09620000-0000-0000-0000-0000000000b4', 'rec-pm@example.com'),
  ('09620000-0000-0000-0000-0000000000b8', 'rec-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09620000-0000-0000-0000-0000000000b1', '09620000-0000-0000-0000-0000000000a1', 'REC Finance 1', 'rec-fin1@example.com', 'Finance', 'active'),
  ('09620000-0000-0000-0000-0000000000b2', '09620000-0000-0000-0000-0000000000a1', 'REC Finance 2', 'rec-fin2@example.com', 'Finance', 'active'),
  ('09620000-0000-0000-0000-0000000000b4', '09620000-0000-0000-0000-0000000000a1', 'REC PM', 'rec-pm@example.com', 'Project Manager', 'active'),
  ('09620000-0000-0000-0000-0000000000b8', '09620000-0000-0000-0000-0000000000a2', 'REC Foreign', 'rec-foreign@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('09620000-0000-0000-0000-0000000000cc', '09620000-0000-0000-0000-0000000000a1', 'REC Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('09620000-0000-0000-0000-0000000000c1', '09620000-0000-0000-0000-0000000000a1', 'REC project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09620000-0000-0000-0000-0000000000cc');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, line_no) values
  ('09620000-0000-0000-0000-000000000e01', '09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000c1', 'A', 'Item A', 'm', 20, 100000, 1),
  ('09620000-0000-0000-0000-000000000e02', '09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000c1', 'B', 'Item B', 'unit', 8, 50000, 2),
  ('09620000-0000-0000-0000-000000000e03', '09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000c1', 'D', 'Item D', 'unit', 10, 1000, 3);
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency) values
  ('09620000-0000-0000-0000-0000000000f1', '09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000c1', 'REC WO 1', 'Issued', 'WO-REC-1', 5000000, 'exclusive', 0, 'IDR'),
  ('09620000-0000-0000-0000-0000000000f2', '09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000c1', 'REC WO 2', 'Issued', 'WO-REC-2', 5000000, 'exclusive', 0, 'IDR');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000f1', '09620000-0000-0000-0000-000000000e01', 10),
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000f1', '09620000-0000-0000-0000-000000000e02', 5),
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000f1', '09620000-0000-0000-0000-000000000e03', 4),
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000f2', '09620000-0000-0000-0000-000000000e03', 6);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path)
select d.id::uuid, '09620000-0000-0000-0000-0000000000a1'::uuid, '09620000-0000-0000-0000-0000000000c1'::uuid, 'Contract', d.title,
       'Approved'::doc_status, '09620000-0000-0000-0000-0000000000b1'::uuid,
       '09620000-0000-0000-0000-0000000000a1/09620000-0000-0000-0000-0000000000c1/' || d.id || '/doc.pdf'
  from (values ('09620000-0000-0000-0000-000000000d01', 'REC measurement sheet'),
               ('09620000-0000-0000-0000-000000000d02', 'REC client acceptance')) as d(id, title);
-- Progress to date (the latest monthly assessment): A 6, B 5, D 3. An earlier month says less and is superseded.
insert into project_progress_entries (id, org_id, project_id, month, pct_complete, entered_by) values
  ('09620000-0000-0000-0000-000000000901', '09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000c1', date_trunc('month', current_date - interval '1 month')::date, 10, '09620000-0000-0000-0000-0000000000b4'),
  ('09620000-0000-0000-0000-000000000902', '09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-0000000000c1', date_trunc('month', current_date)::date, 30, '09620000-0000-0000-0000-0000000000b4');
insert into progress_assessment_quantities (org_id, entry_id, boq_item_id, quantity_to_date) values
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-000000000901', '09620000-0000-0000-0000-000000000e01', 2),
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-000000000902', '09620000-0000-0000-0000-000000000e01', 6),
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-000000000902', '09620000-0000-0000-0000-000000000e02', 5),
  ('09620000-0000-0000-0000-0000000000a1', '09620000-0000-0000-0000-000000000902', '09620000-0000-0000-0000-000000000e03', 3);

create temp table _state (k text primary key, v text not null) on commit drop;
grant all on _state to authenticated;
create function pg_temp.detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics d = pg_exception_detail; return sqlstate || ' ' || coalesce(d, ''); end $$;
create function pg_temp.st(p_k text) returns text language sql as $$ select v from _state where k = p_k $$;
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"09620000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.rec(p_code text, p_wo uuid default '09620000-0000-0000-0000-0000000000f1') returns text language sql as $$
  select row(trim_scale(r.scope_qty), trim_scale(r.progress_qty), trim_scale(r.measured_qty), trim_scale(r.billed_qty),
              trim_scale(r.unbilled_qty), trim_scale(r.surplus_qty), trim_scale(r.billed_amount), r.status)::text
    from billing_reconciliation('09620000-0000-0000-0000-0000000000c1', p_wo) r where r.item_code = p_code $$;
-- Assemble, evidence through the stages, and raise a claim's invoice (the PM records the stages, a second Finance user raises).
create function pg_temp.claim(p_k text, p_lines jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.as_user('b1');
  insert into _state select p_k, create_progress_claim('09620000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '09620000-0000-0000-0000-0000000000f1', p_lines => p_lines)::text;
end $$;
create function pg_temp.walk_and_raise(p_k text) returns void language plpgsql as $$
declare s record;
begin
  perform pg_temp.as_user('b4');
  for s in select cs.id, cs.position, cs.client_side from claim_billing_stages cs where cs.claim_id = pg_temp.st(p_k)::uuid order by cs.position loop
    perform attach_billing_stage_document(d.id, case when s.position = 1 then '09620000-0000-0000-0000-000000000d01'::uuid
                                                     else '09620000-0000-0000-0000-000000000d02'::uuid end)
       from claim_billing_stage_documents d where d.stage_id = s.id;
    perform complete_billing_stage(s.id, current_date, case when s.client_side then 'CLIENT-' || s.position end);
  end loop;
  perform pg_temp.as_user('b2');
  perform create_native_progress_claim_invoice(pg_temp.st(p_k)::uuid);
end $$;

-- Contract terms: two stages with one required document each, 10% retention.
select pg_temp.as_user('b1');
select lives_ok($q$select set_billing_stage_template('09620000-0000-0000-0000-0000000000c1', '[
  {"name":"Internal measurement","documents":[{"name":"Measurement sheet"}]},
  {"name":"Client acceptance","client_side":true,"documents":[{"name":"Acceptance certificate"}]}]'::jsonb)$q$, 'terms: two stages');
select lives_ok($q$select set_project_retention('09620000-0000-0000-0000-0000000000c1', 10)$q$, 'terms: 10% retention');

-- ── AC-BST-020 before any claim: everything unbilled ───────────────────────────────────────────────
select is(pg_temp.rec('A'), row(10::numeric, 6::numeric, 0::numeric, 0::numeric, 6::numeric, 0::numeric, 0::numeric, 'unbilled')::text,
  'AC-BST-020 with no claim, item A is unbilled with 6 of progress unbilled');

-- c1: A 4 (invoiced) · c2: A 2 (not invoiced) · c3: B 6 (invoiced, more than the order's 5) · c4: A 1 (invoiced, then cancelled)
select lives_ok($q$select pg_temp.claim('c1', '[{"boq_item_id":"09620000-0000-0000-0000-000000000e01","quantity":4}]')$q$, 'claim c1: A 4');
select lives_ok($q$select pg_temp.walk_and_raise('c1')$q$, 'AC-TRACE-001 c1 walks both stages with their documents and its invoice is raised');
select lives_ok($q$select pg_temp.claim('c2', '[{"boq_item_id":"09620000-0000-0000-0000-000000000e01","quantity":2}]')$q$, 'claim c2: A 2, not invoiced');
select lives_ok($q$select pg_temp.claim('c3', '[{"boq_item_id":"09620000-0000-0000-0000-000000000e02","quantity":6}]')$q$, 'claim c3: B 6');
select lives_ok($q$select pg_temp.walk_and_raise('c3')$q$, 'c3 invoiced');
select lives_ok($q$select pg_temp.claim('c4', '[{"boq_item_id":"09620000-0000-0000-0000-000000000e01","quantity":1}]')$q$, 'claim c4: A 1');
select lives_ok($q$select pg_temp.walk_and_raise('c4')$q$, 'c4 invoiced');
select pg_temp.as_user('b1');
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('c4')::uuid, 'Cancelled')$q$, 'c4''s invoice is cancelled');

-- ── AC-TRACE-001: the trace of c1 ──────────────────────────────────────────────────────────────────
select pg_temp.as_user('b4');
select is((select count(*)::int from claim_billing_stages where claim_id = pg_temp.st('c1')::uuid and completed_on is not null), 2,
  'AC-TRACE-001 both of c1''s stages are complete');
select is((select count(*)::int from claim_billing_stage_documents where claim_id = pg_temp.st('c1')::uuid and document_id is null), 0,
  'AC-TRACE-001 every checklist document of c1 is attached');
select is((select array_agg(document_id order by document_id)::text from progress_claim_evidence where claim_id = pg_temp.st('c1')::uuid),
  '{09620000-0000-0000-0000-000000000d01,09620000-0000-0000-0000-000000000d02}', 'AC-TRACE-001 and both are c1''s billing evidence');
select is((select client_reference from claim_billing_stages where claim_id = pg_temp.st('c1')::uuid and position = 2), 'CLIENT-2',
  'AC-TRACE-001 the client-side acceptance carries the client''s document number');
select is((select row(status, amount)::text from sales_invoices where id = pg_temp.st('c1')::uuid), row('Draft', 400000.00::numeric)::text,
  'AC-TRACE-001 c1''s invoice is raised for the claim''s full 400,000');
select is((select row(retention_amount, held)::text from claim_retention where claim_id = pg_temp.st('c1')::uuid), row(40000.00::numeric, 40000.00::numeric)::text,
  'AC-TRACE-001 c1 holds 10% retention (40,000), none released');

-- ── AC-BST-020: the per-item reconciliation ────────────────────────────────────────────────────────
select is(pg_temp.rec('A'), row(10::numeric, 6::numeric, 7::numeric, 4::numeric, 2::numeric, 0::numeric, 400000::numeric, 'partly_billed')::text,
  'AC-BST-020 A: progress 6, measured 7 (c4 remains claimed after invoice cancellation), billed 4, 2 unbilled, partly billed');
select is(pg_temp.rec('B'), row(5::numeric, 5::numeric, 6::numeric, 6::numeric, 0::numeric, 1::numeric, 300000::numeric, 'surplus')::text,
  'AC-BST-020 B: billed 6 against an order of 5 is a surplus of 1');
select is(pg_temp.rec('D'), row(4::numeric, null::numeric, 0::numeric, 0::numeric, null::numeric, 0::numeric, 0::numeric, 'unbilled')::text,
  'FR-BST-042 D is shared with another work order: its progress is unknown for this one, never apportioned');
select is(pg_temp.rec('D', '09620000-0000-0000-0000-0000000000f2'),
  row(6::numeric, null::numeric, 0::numeric, 0::numeric, null::numeric, 0::numeric, 0::numeric, 'unbilled')::text,
  'FR-BST-042 the other work order sees D the same way');
select is((select row(trim_scale(r.scope_qty), trim_scale(r.progress_qty), trim_scale(r.billed_qty), r.status)::text from billing_reconciliation('09620000-0000-0000-0000-0000000000c1') r where r.item_code = 'D'),
  row(10::numeric, 3::numeric, 0::numeric, 'unbilled')::text, 'FR-BST-040 the project view shows D''s contract quantity and its progress');
select is((select string_agg(r.item_code, ',' order by b.line_no) from billing_reconciliation('09620000-0000-0000-0000-0000000000c1') r
             join boq_items b on b.id = r.boq_item_id), 'A,B,D', 'FR-BST-040 the project view lists every BoQ item in order');

-- FR-BST-041: billed amount agrees with the invoices, through the one billed-work reader
select is((select sum(billed_amount) from billing_reconciliation('09620000-0000-0000-0000-0000000000c1', '09620000-0000-0000-0000-0000000000f1')),
          (select sum(w.net + w.recovery) from sales_invoice_work_billed w
            where w.work_order_id = '09620000-0000-0000-0000-0000000000f1' and w.status <> 'Cancelled' and not w.is_down_payment),
  'AC-BST-020 / FR-BST-041 the summed billed amount equals the invoiced claims through sales_invoice_work_billed');
select is((select sum(billed_amount) from billing_reconciliation('09620000-0000-0000-0000-0000000000c1', '09620000-0000-0000-0000-0000000000f1')),
  700000.00::numeric, 'AC-BST-020 that amount is 700,000 (A 4 x 100,000 + B 6 x 50,000)');
select is((select sum(billed_qty) from billing_reconciliation('09620000-0000-0000-0000-0000000000c1', '09620000-0000-0000-0000-0000000000f1') where item_code = 'A'),
          (select sum(l.quantity) from progress_claim_lines l join sales_invoices si on si.id = l.claim_id
            where si.status <> 'Cancelled' and l.boq_item_id = '09620000-0000-0000-0000-000000000e01'),
  'AC-BST-020 A''s billed quantity agrees with the invoiced claim lines');

-- c2 raised later moves A to 6 billed (still partly billed: the order says 10)
select lives_ok($q$select pg_temp.walk_and_raise('c2')$q$, 'c2 invoiced');
select pg_temp.as_user('b4');
select is(pg_temp.rec('A'), row(10::numeric, 6::numeric, 7::numeric, 6::numeric, 0::numeric, 0::numeric, 600000::numeric, 'partly_billed')::text,
  'AC-BST-020 A after c2: billed 6, nothing done is unbilled');

-- tenancy: a foreign Admin sees nothing
select pg_temp.as_user('b8');
select is((select count(*)::int from billing_reconciliation('09620000-0000-0000-0000-0000000000c1')), 0,
  'NFR-BST-001 another organisation reads no reconciliation rows');
-- the stage gate still holds for a new claim (unchanged by this migration)
select pg_temp.as_user('b1');
select lives_ok($q$select pg_temp.claim('c5', '[{"boq_item_id":"09620000-0000-0000-0000-000000000e01","quantity":1}]')$q$, 'claim c5');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('c5')::uuid, '09620000-0000-0000-0000-000000000d01')$q$, 'c5 has evidence');
select pg_temp.as_user('b2');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('c5')::uuid)$q$), '55000 billing-stages-incomplete',
  'AC-BST-005 a claim with evidence but open stages cannot be invoiced');

select pg_temp.as_user('b1');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('c5')::uuid)$q$, 'unbilled claim c5 is withdrawn');
select is(pg_temp.rec('A'), row(10::numeric, 6::numeric, 7::numeric, 6::numeric, 0::numeric, 0::numeric, 600000::numeric, 'partly_billed')::text,
  'withdrawn claim quantity is excluded from measured work');

select * from finish();
rollback;
