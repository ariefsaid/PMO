-- 2783_billing_invoice_step.test.sql — a step list may name one invoice step; the invoice then waits only for the steps
-- before it, and the later steps stay open and completable (#3022). AC-BIS-001..005. Ids: 27830000-… (synthetic).
-- Org a1: b1 fin1 (claims), b2 fin2 (raises), b4 pm (manager of c1 and c2).
begin;
create extension if not exists pgtap;
select plan(36);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27830000-0000-0000-0000-0000000000a1', 'BIS Org A', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27830000-0000-0000-0000-0000000000b1', 'bis-fin1@example.com'),
  ('27830000-0000-0000-0000-0000000000b2', 'bis-fin2@example.com'),
  ('27830000-0000-0000-0000-0000000000b4', 'bis-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27830000-0000-0000-0000-0000000000b1', '27830000-0000-0000-0000-0000000000a1', 'BIS Finance 1', 'bis-fin1@example.com', 'Finance', 'active'),
  ('27830000-0000-0000-0000-0000000000b2', '27830000-0000-0000-0000-0000000000a1', 'BIS Finance 2', 'bis-fin2@example.com', 'Finance', 'active'),
  ('27830000-0000-0000-0000-0000000000b4', '27830000-0000-0000-0000-0000000000a1', 'BIS PM', 'bis-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('27830000-0000-0000-0000-0000000000cc', '27830000-0000-0000-0000-0000000000a1', 'BIS Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('27830000-0000-0000-0000-0000000000c1', '27830000-0000-0000-0000-0000000000a1', 'BIS marked', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '27830000-0000-0000-0000-0000000000cc', '27830000-0000-0000-0000-0000000000b4'),
  ('27830000-0000-0000-0000-0000000000c2', '27830000-0000-0000-0000-0000000000a1', 'BIS unmarked', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '27830000-0000-0000-0000-0000000000cc', '27830000-0000-0000-0000-0000000000b4');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('27830000-0000-0000-0000-000000000e01', '27830000-0000-0000-0000-0000000000a1', '27830000-0000-0000-0000-0000000000c1', 'TRENCH', 'Trench', 'm', 1000, 10000),
  ('27830000-0000-0000-0000-000000000e02', '27830000-0000-0000-0000-0000000000a1', '27830000-0000-0000-0000-0000000000c2', 'TRENCH', 'Trench', 'm', 1000, 10000);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('27830000-0000-0000-0000-000000000f01', '27830000-0000-0000-0000-0000000000a1', '27830000-0000-0000-0000-0000000000c1', 'Contract', 'BIS measurement sheet', 'Approved',
   '27830000-0000-0000-0000-0000000000b1', '27830000-0000-0000-0000-0000000000a1/27830000-0000-0000-0000-0000000000c1/27830000-0000-0000-0000-000000000f01/doc.pdf'),
  ('27830000-0000-0000-0000-000000000f02', '27830000-0000-0000-0000-0000000000a1', '27830000-0000-0000-0000-0000000000c2', 'Contract', 'BIS measurement sheet 2', 'Approved',
   '27830000-0000-0000-0000-0000000000b1', '27830000-0000-0000-0000-0000000000a1/27830000-0000-0000-0000-0000000000c2/27830000-0000-0000-0000-000000000f02/doc.pdf');

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
  perform set_config('request.jwt.claims', '{"sub":"27830000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.as_job() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.stage(p_claim text, p_pos int) returns uuid language sql as $$
  select s.id from claim_billing_stages s where s.claim_id = pg_temp.st(p_claim)::uuid and s.position = p_pos $$;
create function pg_temp.marked(p_claim text) returns text language sql as $$
  select coalesce(string_agg(position::text, ',' order by position), '-') from claim_billing_stages
   where claim_id = pg_temp.st(p_claim)::uuid and invoice_step $$;
create function pg_temp.new_claim(p_key text, p_project text, p_boq text) returns text language plpgsql as $$
declare v uuid;
begin
  v := create_progress_claim(p_project::uuid, 'progress', p_lines => jsonb_build_array(jsonb_build_object('boq_item_id', p_boq, 'quantity', 1)));
  insert into _state values (p_key, v::text);
  return v::text;
end $$;

-- ═══ AC-BIS-001: one invoice step per list, copied template → project → claim ═══════════════════
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select save_billing_step_template(null, 'Two', '[{"name":"a","invoice_step":true},{"name":"b","invoice_step":true}]'::jsonb)$q$),
  '23514 invoice-step-repeated', 'AC-BIS-001 a template cannot have two invoice steps');
select is(pg_temp.detail($q$select set_billing_stage_template('27830000-0000-0000-0000-0000000000c2', '[{"name":"a","invoice_step":true},{"name":"b","invoice_step":true}]'::jsonb)$q$),
  '23514 invoice-step-repeated', 'AC-BIS-001 a project list cannot have two invoice steps');
select lives_ok($q$insert into _state select 'T', save_billing_step_template(null, 'Mid invoice', '[
  {"name":"Measure"},{"name":"Input invoice","invoice_step":true},{"name":"Tax invoice"},{"name":"Submit to client"}]'::jsonb)::text$q$,
  'AC-BIS-001 Finance saves a template whose invoice step is second of four');
select is((select string_agg(position::text, ',') from billing_step_template_steps where template_id = pg_temp.st('T')::uuid and invoice_step), '2',
  'AC-BIS-001 the template stores the invoice step');
select lives_ok($q$select load_billing_step_template_onto_project('27830000-0000-0000-0000-0000000000c1', pg_temp.st('T')::uuid)$q$, 'Finance loads it onto the project');
select is((select string_agg(position::text, ',') from billing_stage_templates where project_id = '27830000-0000-0000-0000-0000000000c1' and invoice_step), '2',
  'AC-BIS-001 the project list carries the invoice step');
select lives_ok($q$select pg_temp.new_claim('A', '27830000-0000-0000-0000-0000000000c1', '27830000-0000-0000-0000-000000000e01')$q$, 'claim A is created');
select is(pg_temp.marked('A'), '2', 'AC-BIS-001 the claim snapshot carries the invoice step');

-- ═══ AC-BIS-002: only Finance or an Admin chooses the invoice step; still one per claim ════════════
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 3), '{"invoice_step":true}'::jsonb)$q$), '42501 ',
  'AC-BIS-002 a Project Manager cannot choose the invoice step');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 3), '{"invoice_step":true}'::jsonb)$q$), '23514 invoice-step-repeated',
  'AC-BIS-002 a second invoice step on the claim is refused');
select is(pg_temp.marked('A'), '2', 'AC-BIS-002 the claim still has one invoice step');

-- ═══ AC-BIS-003: the invoice waits only for the steps before the invoice step ══════════════════════
select pg_temp.as_job();
select is(billing_stages_open(pg_temp.st('A')::uuid), true, 'AC-BIS-003 the gate is closed while a step before the invoice step is open');
select pg_temp.as_user('b1');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('A')::uuid, '27830000-0000-0000-0000-000000000f01')$q$, 'claim A has its evidence');
select pg_temp.as_user('b2');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('A')::uuid)$q$), '55000 billing-stages-incomplete',
  'AC-BIS-003 the invoice is refused while the first step is open');
select pg_temp.as_user('b4');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('A', 1), current_date)$q$, 'the first step completes');
select pg_temp.as_job();
select is(billing_stages_open(pg_temp.st('A')::uuid), false, 'AC-BIS-003 the gate opens once every step before the invoice step is done');
select pg_temp.as_user('b2');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('A')::uuid)$q$, 'AC-BIS-003 Finance raises the invoice at its own step');

-- ═══ AC-BIS-004: the invoice step and the later steps stay open and completable ═══════════════════
select is((select count(*)::int from claim_billing_stages where claim_id = pg_temp.st('A')::uuid and completed_on is null and skipped_on is null), 3,
  'AC-BIS-004 the invoice step and the two later steps are still open on the invoiced claim');
select pg_temp.as_user('b1');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('A', 2), current_date)$q$, 'AC-BIS-004 the invoice step completes after the invoice');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('A', 3), current_date)$q$, 'AC-BIS-004 a later step completes after the invoice');
select is(pg_temp.detail($q$select update_claim_billing_step(pg_temp.stage('A', 4), '{"invoice_step":true}'::jsonb)$q$), '55000 claim-invoiced',
  'AC-BIS-004 the invoice step of an invoiced claim cannot move');

-- ═══ AC-BIS-001: the one-per-list rule holds in the table itself, not only in the functions ═══════════
select pg_temp.as_job();
select is(split_part(pg_temp.detail($q$update claim_billing_stages set invoice_step = true where id = pg_temp.stage('A', 3)$q$), ' ', 1), '23505',
  'AC-BIS-001 a second invoice step on a claim is refused by the table');
select pg_temp.as_user('b1');
select is(split_part(pg_temp.detail($q$select set_billing_stage_template('27830000-0000-0000-0000-0000000000c2', '[{"name":"a","invoice_step":"true"},{"name":"b","invoice_step":"true"}]'::jsonb)$q$), ' ', 1), '23505',
  'AC-BIS-001 two invoice steps sent as text are still refused (by the table)');

-- ═══ AC-BIS-005: a list with no invoice step keeps the full gate ═════════════════════════════════
select lives_ok($q$select set_billing_stage_template('27830000-0000-0000-0000-0000000000c2', '[{"name":"S1"},{"name":"S2"}]'::jsonb)$q$, 'project 2 gets an unmarked list');
select lives_ok($q$select pg_temp.new_claim('B', '27830000-0000-0000-0000-0000000000c2', '27830000-0000-0000-0000-000000000e02')$q$, 'claim B is created');
select is(pg_temp.marked('B'), '-', 'AC-BIS-005 the unmarked list gives a claim with no invoice step');
select pg_temp.as_user('b4');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('B', 1), current_date)$q$, 'claim B first step completes');
select pg_temp.as_user('b1');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('B')::uuid, '27830000-0000-0000-0000-000000000f02')$q$, 'claim B has its evidence');
select pg_temp.as_user('b2');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('B')::uuid)$q$), '55000 billing-stages-incomplete',
  'AC-BIS-005 with no invoice step the invoice still waits for every step');
select pg_temp.as_user('b1');
select lives_ok($q$select set_billing_stage_template('27830000-0000-0000-0000-0000000000c2', '[{"name":"S1"},{"name":"Invoice","invoice_step":true}]'::jsonb)$q$,
  'Finance marks an invoice step on the project list');
select is((select string_agg(position::text, ',') from billing_stage_templates where project_id = '27830000-0000-0000-0000-0000000000c2' and invoice_step), '2',
  'AC-BIS-001 the project list stores the invoice step');
select is(pg_temp.marked('B'), '-', 'AC-BIS-005 a claim already made keeps its own list');

select lives_ok($q$select pg_temp.new_claim('C', '27830000-0000-0000-0000-0000000000c2', '27830000-0000-0000-0000-000000000e02')$q$, 'claim C is created');
select is(pg_temp.marked('C'), '2', 'AC-BIS-001 a claim made from the marked project list carries its invoice step');
select lives_ok($q$select load_billing_step_template_onto_claim(pg_temp.st('C')::uuid, pg_temp.st('T')::uuid)$q$, 'Finance loads the template onto claim C');
select is(pg_temp.marked('C'), '2', 'AC-BIS-001 loading a template onto a claim copies the invoice step');

select * from finish();
rollback;
