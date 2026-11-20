-- 0961_retention.test.sql — retention held on a progress claim and released later (#1572).
-- AC-RET-001..003 (docs/specs/billing-stages.spec.md), ADR-0105. Ids: 09610000-… (synthetic).
-- Users: b1 fin1 (claims), b2 fin2 (raises), b3 admin (approves), b4 pm, b8 foreign admin.
begin;
create extension if not exists pgtap;
select plan(52);

insert into organizations (id, name, default_currency, default_timezone) values
  ('09610000-0000-0000-0000-0000000000a1', 'RET Org A', 'IDR', 'UTC'),
  ('09610000-0000-0000-0000-0000000000a2', 'RET Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('09610000-0000-0000-0000-0000000000b1', 'ret-fin1@example.com'),
  ('09610000-0000-0000-0000-0000000000b2', 'ret-fin2@example.com'),
  ('09610000-0000-0000-0000-0000000000b3', 'ret-admin@example.com'),
  ('09610000-0000-0000-0000-0000000000b4', 'ret-pm@example.com'),
  ('09610000-0000-0000-0000-0000000000b8', 'ret-foreign@example.com'),
  ('09610000-0000-0000-0000-0000000000b9', 'ret-disabled@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09610000-0000-0000-0000-0000000000b1', '09610000-0000-0000-0000-0000000000a1', 'RET Finance 1', 'ret-fin1@example.com', 'Finance', 'active'),
  ('09610000-0000-0000-0000-0000000000b2', '09610000-0000-0000-0000-0000000000a1', 'RET Finance 2', 'ret-fin2@example.com', 'Finance', 'active'),
  ('09610000-0000-0000-0000-0000000000b3', '09610000-0000-0000-0000-0000000000a1', 'RET Admin', 'ret-admin@example.com', 'Admin', 'active'),
  ('09610000-0000-0000-0000-0000000000b4', '09610000-0000-0000-0000-0000000000a1', 'RET PM', 'ret-pm@example.com', 'Project Manager', 'active'),
  ('09610000-0000-0000-0000-0000000000b8', '09610000-0000-0000-0000-0000000000a2', 'RET Foreign Admin', 'ret-foreign@example.com', 'Admin', 'active'),
  ('09610000-0000-0000-0000-0000000000b9', '09610000-0000-0000-0000-0000000000a1', 'RET Disabled', 'ret-disabled@example.com', 'Finance', 'disabled');
insert into companies (id, org_id, name, type) values
  ('09610000-0000-0000-0000-0000000000cc', '09610000-0000-0000-0000-0000000000a1', 'RET Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('09610000-0000-0000-0000-0000000000c1', '09610000-0000-0000-0000-0000000000a1', 'RET project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09610000-0000-0000-0000-0000000000cc');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('09610000-0000-0000-0000-000000000e01', '09610000-0000-0000-0000-0000000000a1', '09610000-0000-0000-0000-0000000000c1', 'PIPE', 'Pipe laying', 'm', 1000, 10000);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path)
select d.id::uuid, '09610000-0000-0000-0000-0000000000a1'::uuid, '09610000-0000-0000-0000-0000000000c1'::uuid, 'Contract', d.title,
       d.status::doc_status, '09610000-0000-0000-0000-0000000000b1'::uuid,
       '09610000-0000-0000-0000-0000000000a1/09610000-0000-0000-0000-0000000000c1/' || d.id || '/doc.pdf'
  from (values ('09610000-0000-0000-0000-000000000f01', 'RET progress report', 'Approved'),
               ('09610000-0000-0000-0000-000000000f02', 'RET handover certificate', 'Approved'),
               ('09610000-0000-0000-0000-000000000f03', 'RET draft', 'Draft')) as d(id, title, status);

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
  perform set_config('request.jwt.claims', '{"sub":"09610000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.ret(p_claim text) returns text language sql as $$
  select row(r.retention_amount, r.scheduled, r.released, r.held)::text from claim_retention r where r.claim_id = pg_temp.st(p_claim)::uuid $$;

-- ── AC-RET-003: only Finance or an Admin sets the project's retention ───────────────────────────────
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select set_project_retention('09610000-0000-0000-0000-0000000000c1', 5)$q$), '42501 ',
  'AC-RET-003 a Project Manager cannot set the retention percentage');
select is(pg_temp.detail($q$update projects set retention_pct = 5 where id = '09610000-0000-0000-0000-0000000000c1'$q$), '42501 ',
  'AC-RET-003 nor write it on the project row');
select pg_temp.as_user('b8');
select is(pg_temp.detail($q$select set_project_retention('09610000-0000-0000-0000-0000000000c1', 5)$q$), 'P0002 ',
  'AC-RET-003 a foreign Admin cannot reach the project');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select set_project_retention('09610000-0000-0000-0000-0000000000c1', 100)$q$), '22023 retention-pct',
  'FR-RET-001 retention is under 100%');
select lives_ok($q$select set_project_retention('09610000-0000-0000-0000-0000000000c1', 5)$q$, 'AC-RET-001 Finance sets 5% retention');

-- ── AC-RET-001: a down payment holds none; a progress claim holds 5% of its gross, invoice unchanged ──
select lives_ok($q$insert into _state select 'dp', create_progress_claim('09610000-0000-0000-0000-0000000000c1', 'down_payment',
  p_down_payment_amount => 1000000, p_recovery_pct => 20)::text$q$, 'AC-RET-001 a down payment of 1,000,000 recovered at 20%');
select is(pg_temp.ret('dp'), row(0.00::numeric, 0::numeric, 0::numeric, 0.00::numeric)::text, 'AC-RET-001 a down payment holds no retention');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('dp')::uuid, '09610000-0000-0000-0000-000000000f01')$q$, 'evidence');
select pg_temp.as_user('b2');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('dp')::uuid)$q$, 'the down payment invoice is raised');
select pg_temp.as_user('b3');
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('dp')::uuid, 'Unpaid')$q$, 'and approved');

select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'pc', create_progress_claim('09610000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09610000-0000-0000-0000-000000000e01","quantity":100}]'::jsonb)::text$q$, 'AC-RET-001 a 1,000,000 progress claim');
select is((select row(gross_amount, dp_recovery_amount, retention_pct, retention_amount)::text from progress_claims where id = pg_temp.st('pc')::uuid),
  row(1000000.00::numeric, 200000.00::numeric, 5.00::numeric, 50000.00::numeric)::text,
  'AC-RET-001 the claim stamps 5% and holds 50,000 (5% of the 1,000,000 gross)');
select is(pg_temp.ret('pc'), row(50000.00::numeric, 0::numeric, 0::numeric, 50000.00::numeric)::text, 'FR-RET-020 all 50,000 is held');
select is(pg_temp.detail($q$update progress_claims set retention_amount = 0 where id = pg_temp.st('pc')::uuid$q$), '42501 ',
  'AC-RET-001 the retention cannot be edited');
reset role;
select is(pg_temp.detail($q$update progress_claims set retention_amount = 0 where id = pg_temp.st('pc')::uuid$q$), '42501 ',
  'AC-RET-001 not even by a server-side write (the claim is immutable)');

-- ── AC-RET-002: schedule within the retention; release only once the invoice is submitted ───────────
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select schedule_retention_release(pg_temp.st('pc')::uuid, 25000, current_date + 30)$q$), '42501 ',
  'AC-RET-003 a Project Manager cannot schedule a release');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select schedule_retention_release(pg_temp.st('dp')::uuid, 1, current_date)$q$), '55000 no-retention',
  'FR-RET-010 a claim with no retention has nothing to release');
select is(pg_temp.detail($q$select schedule_retention_release(pg_temp.st('pc')::uuid, 0, current_date)$q$), '23514 release-amount',
  'FR-RET-010 a release is a positive amount');
select lives_ok($q$insert into _state select 'r1', schedule_retention_release(pg_temp.st('pc')::uuid, 25000, current_date, 'Provisional handover')::text$q$,
  'AC-RET-002 Finance schedules 25,000 at handover');
select lives_ok($q$insert into _state select 'r2', schedule_retention_release(pg_temp.st('pc')::uuid, 25000, current_date + 365, 'End of defects period')::text$q$,
  'AC-RET-002 and 25,000 at the end of the defects period');
select is(pg_temp.detail($q$select schedule_retention_release(pg_temp.st('pc')::uuid, 1, current_date)$q$), '23514 retention-exceeded',
  'AC-RET-002 a further 1 would release more than is held');
select is(pg_temp.ret('pc'), row(50000.00::numeric, 50000.00::numeric, 0::numeric, 50000.00::numeric)::text,
  'FR-RET-020 scheduled 50,000, released 0, held 50,000');
select is(pg_temp.detail($q$select release_retention(pg_temp.st('r1')::uuid, current_date)$q$), '55000 invoice-not-submitted',
  'AC-RET-002 a release cannot be recorded before the claim is invoiced');

select lives_ok($q$select attach_claim_evidence(pg_temp.st('pc')::uuid, '09610000-0000-0000-0000-000000000f01')$q$, 'evidence');
select pg_temp.as_user('b2');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc')::uuid)$q$, 'AC-RET-001 the progress invoice is raised');
reset role;
select is((select row(amount, native_lines::text)::text from sales_invoices where id = pg_temp.st('pc')::uuid),
  row(800000.00::numeric, '[{"qty": 100.000, "rate": 10000.00, "amount": 1000000.00, "item_code": "PIPE", "description": "Pipe laying (m)"}, {"qty": 1, "rate": -200000.00, "role": "down_payment_recovery", "amount": -200000.00, "item_code": null, "description": "Down payment recovery"}]')::text,
  'AC-RET-001 / FR-RET-003 the invoice is unchanged: 800,000 net, no retention line');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select release_retention(pg_temp.st('r1')::uuid, current_date)$q$), '55000 invoice-not-submitted',
  'AC-RET-002 not while the invoice is a Draft');
select pg_temp.as_user('b3');
select lives_ok($q$select transition_native_sales_invoice(pg_temp.st('pc')::uuid, 'Unpaid')$q$, 'the progress invoice is approved');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select release_retention(pg_temp.st('r1')::uuid, current_date + 1)$q$), '22023 release-date',
  'FR-RET-011 a release date cannot be in the future');
select is(pg_temp.detail($q$select release_retention(pg_temp.st('r1')::uuid, current_date - 1)$q$), '22023 release-date',
  'FR-RET-011 a release date cannot precede the invoice');
select is(pg_temp.detail($q$select release_retention(pg_temp.st('r1')::uuid, current_date, 'HO-1', '09610000-0000-0000-0000-000000000f03')$q$), '55000 document-not-issued',
  'FR-RET-011 the proof must be an issued or approved document');
select lives_ok($q$select release_retention(pg_temp.st('r1')::uuid, current_date, 'HO-1', '09610000-0000-0000-0000-000000000f02')$q$,
  'AC-RET-002 Finance records the handover release with its certificate');
select is(pg_temp.ret('pc'), row(50000.00::numeric, 50000.00::numeric, 25000.00::numeric, 25000.00::numeric)::text,
  'AC-RET-002 25,000 released, 25,000 still held');
select is(pg_temp.detail($q$select cancel_retention_release(pg_temp.st('r1')::uuid)$q$), '55000 release-recorded',
  'AC-RET-002 a recorded release cannot be cancelled');
select is(pg_temp.detail($q$select release_retention(pg_temp.st('r1')::uuid, current_date)$q$), '55000 release-recorded',
  'FR-RET-012 nor recorded twice');
select lives_ok($q$select cancel_retention_release(pg_temp.st('r2')::uuid)$q$, 'AC-RET-002 the scheduled one can be cancelled');
select is(pg_temp.ret('pc'), row(50000.00::numeric, 25000.00::numeric, 25000.00::numeric, 25000.00::numeric)::text,
  'FR-RET-020 after the cancel: scheduled 25,000, released 25,000, held 25,000');


-- Retention never exceeds the net claim after down-payment recovery.
select pg_temp.as_user('b1');
select lives_ok($q$select set_project_retention('09610000-0000-0000-0000-0000000000c1', 90)$q$, 'set a retention rate above the net proportion');
select lives_ok($q$insert into _state select 'cap', create_progress_claim('09610000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09610000-0000-0000-0000-000000000e01","quantity":1}]'::jsonb)::text$q$, 'create a claim with down-payment recovery');
select is((select row(gross_amount, dp_recovery_amount, retention_amount)::text from progress_claims where id = pg_temp.st('cap')::uuid),
  row(10000.00::numeric, 2000.00::numeric, 8000.00::numeric)::text, 'retention is capped at the claim net after recovery');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('cap')::uuid)$q$, 'withdraw the uninvoiced capped claim');
select is(pg_temp.detail($q$select schedule_retention_release(pg_temp.st('cap')::uuid, 1, current_date)$q$), '55000 claim-withdrawn', 'a withdrawn claim cannot schedule retention');

-- Atomic project terms: one rejected field must leave every prior term intact.
select pg_temp.as_user('b1');
select lives_ok($q$select set_project_billing_terms('09610000-0000-0000-0000-0000000000c1', '[{"name":"Original","documents":[]}]'::jsonb, 20, 4, 5.25)$q$, 'Finance saves all billing terms together');
select is(pg_temp.detail($q$select set_project_billing_terms('09610000-0000-0000-0000-0000000000c1', '[{"name":"Changed","documents":[]}]'::jsonb, 10, 3, 2.555)$q$), '22023 retention-pct', 'invalid precision rejects the whole terms save');
select is((select name from billing_stage_templates where project_id = '09610000-0000-0000-0000-0000000000c1'), 'Original', 'rejected terms keep prior stage list');
select is((select row(invoice_deadline_day, invoice_deadline_warn_days, retention_pct)::text from projects where id = '09610000-0000-0000-0000-0000000000c1'), row(20, 4, 5.25::numeric)::text, 'rejected terms keep prior deadline and retention');
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select set_project_billing_terms('09610000-0000-0000-0000-0000000000c1', '[]'::jsonb, null, 5, 0)$q$), '42501 ', 'Project Manager cannot save billing terms');
select pg_temp.as_user('b8');
select is(pg_temp.detail($q$select set_project_billing_terms('09610000-0000-0000-0000-0000000000c1', '[]'::jsonb, null, 5, 0)$q$), 'P0002 ', 'foreign Admin cannot save billing terms');
select pg_temp.as_user('b9');
select is(pg_temp.detail($q$select set_project_billing_terms('09610000-0000-0000-0000-0000000000c1', '[]'::jsonb, null, 5, 0)$q$), '42501 ', 'disabled Finance cannot save billing terms');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select set_project_billing_terms('09610000-0000-0000-0000-0000000000c1', '[{"name":"Changed","documents":[]}]'::jsonb, 40, 5, 5)$q$), '22023 deadline-day', 'invalid deadline rejects the whole terms save');

select lives_ok($q$insert into _state select 'round', create_progress_claim('09610000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09610000-0000-0000-0000-000000000e01","quantity":0.001}]'::jsonb)::text$q$, 'create a fractional claim to test retention rounding');
select is((select retention_amount from progress_claims where id = pg_temp.st('round')::uuid), 0.53::numeric,
  'retention rounds the gross percentage to two decimal places');

select * from finish();
rollback;
