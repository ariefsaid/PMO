-- 0960_billing_stages.test.sql — billing stages: a claim's stage plan, its checklist and the invoice gate.
-- AC-BST-001..006 (docs/specs/billing-stages.spec.md). Ids: 09600000-… (synthetic).
-- Org a1 has no ERP; a2 is foreign. Users: b1 fin1 (claims), b2 fin2 (raises), b3 admin, b4 pm, b6 engineer, b8 foreign admin.
begin;
create extension if not exists pgtap;
select plan(50);

insert into organizations (id, name, default_currency, default_timezone) values
  ('09600000-0000-0000-0000-0000000000a1', 'BST Org A', 'IDR', 'UTC'),
  ('09600000-0000-0000-0000-0000000000a2', 'BST Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('09600000-0000-0000-0000-0000000000b1', 'bst-fin1@example.com'),
  ('09600000-0000-0000-0000-0000000000b2', 'bst-fin2@example.com'),
  ('09600000-0000-0000-0000-0000000000b3', 'bst-admin@example.com'),
  ('09600000-0000-0000-0000-0000000000b4', 'bst-pm@example.com'),
  ('09600000-0000-0000-0000-0000000000b6', 'bst-eng@example.com'),
  ('09600000-0000-0000-0000-0000000000b8', 'bst-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09600000-0000-0000-0000-0000000000b1', '09600000-0000-0000-0000-0000000000a1', 'BST Finance 1', 'bst-fin1@example.com', 'Finance', 'active'),
  ('09600000-0000-0000-0000-0000000000b2', '09600000-0000-0000-0000-0000000000a1', 'BST Finance 2', 'bst-fin2@example.com', 'Finance', 'active'),
  ('09600000-0000-0000-0000-0000000000b3', '09600000-0000-0000-0000-0000000000a1', 'BST Admin', 'bst-admin@example.com', 'Admin', 'active'),
  ('09600000-0000-0000-0000-0000000000b4', '09600000-0000-0000-0000-0000000000a1', 'BST PM', 'bst-pm@example.com', 'Project Manager', 'active'),
  ('09600000-0000-0000-0000-0000000000b6', '09600000-0000-0000-0000-0000000000a1', 'BST Engineer', 'bst-eng@example.com', 'Engineer', 'active'),
  ('09600000-0000-0000-0000-0000000000b8', '09600000-0000-0000-0000-0000000000a2', 'BST Foreign Admin', 'bst-foreign@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('09600000-0000-0000-0000-0000000000cc', '09600000-0000-0000-0000-0000000000a1', 'BST Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('09600000-0000-0000-0000-0000000000c1', '09600000-0000-0000-0000-0000000000a1', 'BST staged', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09600000-0000-0000-0000-0000000000cc'),
  ('09600000-0000-0000-0000-0000000000c2', '09600000-0000-0000-0000-0000000000a1', 'BST other', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '09600000-0000-0000-0000-0000000000cc');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('09600000-0000-0000-0000-000000000e01', '09600000-0000-0000-0000-0000000000a1', '09600000-0000-0000-0000-0000000000c1', 'TRENCH', 'Trench', 'm', 100, 10000),
  ('09600000-0000-0000-0000-000000000e02', '09600000-0000-0000-0000-0000000000a1', '09600000-0000-0000-0000-0000000000c2', 'TRENCH', 'Trench', 'm', 100, 10000);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path)
select d.id::uuid, '09600000-0000-0000-0000-0000000000a1'::uuid, d.project::uuid, 'Contract', d.title, d.status::doc_status,
       '09600000-0000-0000-0000-0000000000b1'::uuid,
       case when d.has_file then '09600000-0000-0000-0000-0000000000a1/' || d.project || '/' || d.id || '/doc.pdf' end
  from (values
    ('09600000-0000-0000-0000-000000000f01', '09600000-0000-0000-0000-0000000000c1', 'BST measurement sheet', 'Approved', true),
    ('09600000-0000-0000-0000-000000000f02', '09600000-0000-0000-0000-0000000000c1', 'BST joint survey minutes', 'Issued', true),
    ('09600000-0000-0000-0000-000000000f03', '09600000-0000-0000-0000-0000000000c1', 'BST draft', 'Draft', true),
    ('09600000-0000-0000-0000-000000000f04', '09600000-0000-0000-0000-0000000000c1', 'BST no file', 'Approved', false),
    ('09600000-0000-0000-0000-000000000f05', '09600000-0000-0000-0000-0000000000c2', 'BST other project', 'Approved', true),
    ('09600000-0000-0000-0000-000000000f06', '09600000-0000-0000-0000-0000000000c1', 'BST client approval', 'Approved', true)
  ) as d(id, project, title, status, has_file);

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
  perform set_config('request.jwt.claims', '{"sub":"09600000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.stage(p_claim text, p_pos int) returns uuid language sql as $$
  select s.id from claim_billing_stages s where s.claim_id = pg_temp.st(p_claim)::uuid and s.position = p_pos $$;
create function pg_temp.item(p_claim text, p_pos int, p_item int) returns uuid language sql as $$
  select d.id from claim_billing_stage_documents d join claim_billing_stages s on s.id = d.stage_id
   where s.claim_id = pg_temp.st(p_claim)::uuid and s.position = p_pos and d.position = p_item $$;

-- ── AC-BST-002: only Finance or an Admin replaces the stage list ──────────────────────────────────
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select set_billing_stage_template('09600000-0000-0000-0000-0000000000c1', '[{"name":"x"}]'::jsonb)$q$),
  '42501 ', 'AC-BST-002 a Project Manager cannot replace the stage list');
select pg_temp.as_user('b6');
select is(pg_temp.detail($q$select set_billing_stage_template('09600000-0000-0000-0000-0000000000c1', '[{"name":"x"}]'::jsonb)$q$),
  '42501 ', 'AC-BST-002 an Engineer cannot replace the stage list');
select pg_temp.as_user('b8');
select is(pg_temp.detail($q$select set_billing_stage_template('09600000-0000-0000-0000-0000000000c1', '[{"name":"x"}]'::jsonb)$q$),
  'P0002 ', 'AC-BST-006 a foreign Admin cannot reach the project');
select pg_temp.as_user('b1');
select is(pg_temp.detail($q$select set_billing_stage_template('09600000-0000-0000-0000-0000000000c1', '[{"name":"  "}]'::jsonb)$q$),
  '23514 stage-name-missing', 'AC-BST-002 every stage needs a name');
select lives_ok($q$select set_billing_stage_template('09600000-0000-0000-0000-0000000000c1', '[
  {"name":"Internal measurement","documents":[{"name":"Measurement sheet","required":true}]},
  {"name":"Joint survey","client_side":true,"documents":[{"name":"Survey minutes","required":true},{"name":"Photos","required":false}]},
  {"name":"Client approval","client_side":true,"documents":[{"name":"Approval letter","required":true}]}
]'::jsonb)$q$, 'AC-BST-002 Finance replaces the stage list');
select is((select string_agg(name || ':' || client_side::text, ' > ' order by position) from billing_stage_templates
            where project_id = '09600000-0000-0000-0000-0000000000c1'),
  'Internal measurement:false > Joint survey:true > Client approval:true', 'AC-BST-001 the list is stored in order');

-- ── AC-BST-001: a progress claim takes a copy; a down payment does not ─────────────────────────────
select lives_ok($q$insert into _state select 'pc1', create_progress_claim('09600000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09600000-0000-0000-0000-000000000e01","quantity":10}]'::jsonb)::text$q$, 'AC-BST-001 Finance creates a progress claim');
select is((select string_agg(name || ':' || coalesce(started_on::text, '-'), ' > ' order by position) from claim_billing_stages
            where claim_id = pg_temp.st('pc1')::uuid),
  'Internal measurement:' || current_date::text || ' > Joint survey:- > Client approval:-',
  'AC-BST-001 the claim has the three stages in order, the first current from the claim date');
select is((select count(*)::int from claim_billing_stage_documents where claim_id = pg_temp.st('pc1')::uuid), 4,
  'AC-BST-001 the checklist is copied with the stages');
select lives_ok($q$insert into _state select 'dp1', create_progress_claim('09600000-0000-0000-0000-0000000000c1', 'down_payment',
  p_down_payment_amount => 100000, p_recovery_pct => 10)::text$q$, 'AC-BST-001 a down payment claim on the same project');
select is((select count(*)::int from claim_billing_stages where claim_id = pg_temp.st('dp1')::uuid), 0,
  'AC-BST-001 a down payment claim has no stage plan');

-- AC-BST-002: a later change to the list does not touch the claim already made
select lives_ok($q$select set_billing_stage_template('09600000-0000-0000-0000-0000000000c1', '[{"name":"Only one"}]'::jsonb)$q$,
  'AC-BST-002 Finance changes the list again');
select is((select count(*)::int from claim_billing_stages where claim_id = pg_temp.st('pc1')::uuid), 3,
  'AC-BST-002 the earlier claim keeps its three-stage plan');
select is((select count(*)::int from billing_stage_templates where project_id = '09600000-0000-0000-0000-0000000000c1'), 1,
  'AC-BST-002 the list is replaced as a whole');

-- ── FR-BST-003: no client write grant on the plan ──────────────────────────────────────────────────
select is(pg_temp.detail($q$update claim_billing_stages set completed_on = current_date where claim_id = pg_temp.st('pc1')::uuid$q$),
  '42501 ', 'FR-BST-003 a stage cannot be completed by a direct write');
select is(pg_temp.detail($q$delete from claim_billing_stages where claim_id = pg_temp.st('pc1')::uuid$q$),
  '42501 ', 'FR-BST-003 a stage cannot be deleted by a direct write');
select is(pg_temp.detail($q$insert into billing_stage_templates (project_id, position, name) values ('09600000-0000-0000-0000-0000000000c1', 9, 'x')$q$),
  '42501 ', 'FR-BST-003 the list cannot be written directly');

-- ── AC-BST-003: a required document gates completion; attaching makes it evidence ──────────────────
select pg_temp.as_user('b4');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pc1', 1), current_date)$q$),
  '55000 stage-documents-missing', 'AC-BST-003 a stage with a missing required document cannot complete');
-- AC-BST-006 the document rules
select is(pg_temp.detail($q$select attach_billing_stage_document(pg_temp.item('pc1', 1, 1), '09600000-0000-0000-0000-000000000f03')$q$),
  '55000 document-not-issued', 'AC-BST-006 a draft document cannot be attached');
select is(pg_temp.detail($q$select attach_billing_stage_document(pg_temp.item('pc1', 1, 1), '09600000-0000-0000-0000-000000000f04')$q$),
  '55000 document-without-file', 'AC-BST-006 a document without a file cannot be attached');
select is(pg_temp.detail($q$select attach_billing_stage_document(pg_temp.item('pc1', 1, 1), '09600000-0000-0000-0000-000000000f05')$q$),
  '23514 document-other-project', 'AC-BST-006 another project''s document cannot be attached');
select pg_temp.as_user('b6');
select is(pg_temp.detail($q$select attach_billing_stage_document(pg_temp.item('pc1', 1, 1), '09600000-0000-0000-0000-000000000f01')$q$),
  '42501 ', 'AC-BST-006 an Engineer cannot record billing stages');
select pg_temp.as_user('b8');
select is(pg_temp.detail($q$select attach_billing_stage_document(pg_temp.item('pc1', 1, 1), '09600000-0000-0000-0000-000000000f01')$q$),
  'P0002 ', 'AC-BST-006 a foreign Admin cannot reach the stage');
select is((select count(*)::int from claim_billing_stages), 0, 'AC-BST-006 a foreign Admin sees no stages');
select pg_temp.as_user('b4');
select lives_ok($q$select attach_billing_stage_document(pg_temp.item('pc1', 1, 1), '09600000-0000-0000-0000-000000000f01')$q$,
  'AC-BST-003 a Project Manager attaches the approved measurement sheet');
select is((select count(*)::int from progress_claim_evidence where claim_id = pg_temp.st('pc1')::uuid
            and document_id = '09600000-0000-0000-0000-000000000f01'), 1, 'AC-BST-003 the document is now the claim''s billing evidence');

-- ── AC-BST-004: order, client reference, date ──────────────────────────────────────────────────────
select lives_ok($q$select attach_billing_stage_document(pg_temp.item('pc1', 2, 1), '09600000-0000-0000-0000-000000000f02')$q$,
  'AC-BST-004 the survey minutes attach ahead of time');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pc1', 2), current_date, 'JS-001')$q$),
  '55000 stage-out-of-order', 'AC-BST-004 the second stage cannot complete before the first');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pc1', 1), current_date + 1)$q$),
  '22023 stage-date-future', 'AC-BST-004 a future completion date is refused');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('pc1', 1), current_date)$q$, 'AC-BST-003 the first stage completes');
select is((select started_on from claim_billing_stages where id = pg_temp.stage('pc1', 2)), current_date,
  'AC-BST-003 the next stage is current from that date');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pc1', 1), current_date)$q$),
  '55000 stage-already-completed', 'AC-BST-004 a completed stage cannot be recorded again');
select is(pg_temp.detail($q$select attach_billing_stage_document(pg_temp.item('pc1', 1, 1), '09600000-0000-0000-0000-000000000f06')$q$),
  '55000 stage-already-completed', 'FR-BST-013 a completed stage''s checklist does not change');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pc1', 2), current_date, '  ')$q$),
  '23514 client-reference-missing', 'AC-BST-004 a client-side stage needs the client''s document number');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pc1', 2), current_date - 1, 'JS-001')$q$),
  '22023 stage-date-before-previous', 'AC-BST-004 a stage cannot complete before the previous one');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('pc1', 2), current_date, 'JS-001', 'Signed on site')$q$,
  'AC-BST-004 the joint survey completes with the client''s reference (the optional photos are not needed)');

-- ── AC-BST-005: the invoice gate, native and ERP ───────────────────────────────────────────────────
select pg_temp.as_user('b2');
select is(pg_temp.detail($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$),
  '55000 billing-stages-incomplete', 'AC-BST-005 the native invoice is refused while a stage is open');
reset role;
select is(pg_temp.detail($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09600000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('pc1'), 'bst-k1', 'erpnext', 'create', 'pending')$q$),
  '55000 billing-stages-incomplete', 'AC-BST-005 the ERP outbox command is refused while a stage is open');
select pg_temp.as_user('b4');
select lives_ok($q$select attach_billing_stage_document(pg_temp.item('pc1', 3, 1), '09600000-0000-0000-0000-000000000f06')$q$, 'AC-BST-005 approval letter attached');
select lives_ok($q$select complete_billing_stage(pg_temp.stage('pc1', 3), current_date, 'APP-77')$q$, 'AC-BST-005 the last stage completes');
reset role;
select lives_ok($q$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('09600000-0000-0000-0000-0000000000a1', 'revenue', pg_temp.st('pc1'), 'bst-k1', 'erpnext', 'create', 'pending')$q$,
  'AC-BST-005 CONTROL with every stage complete the ERP outbox command is accepted');
delete from external_command_outbox where idempotency_key = 'bst-k1';
select pg_temp.as_user('b2');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc1')::uuid)$q$, 'AC-BST-005 CONTROL and the native invoice is raised');

-- A claim on a project with no list is unaffected (only evidence gates it, as before).
select pg_temp.as_user('b1');
select lives_ok($q$insert into _state select 'pc2', create_progress_claim('09600000-0000-0000-0000-0000000000c2', 'progress',
  p_lines => '[{"boq_item_id":"09600000-0000-0000-0000-000000000e02","quantity":1}]'::jsonb)::text$q$, 'FR-BST-002 a claim on a project with no list');
select lives_ok($q$select attach_claim_evidence(pg_temp.st('pc2')::uuid, '09600000-0000-0000-0000-000000000f05')$q$, 'FR-BST-002 evidence attached');
select pg_temp.as_user('b2');
select lives_ok($q$select create_native_progress_claim_invoice(pg_temp.st('pc2')::uuid)$q$, 'FR-BST-002 CONTROL a claim with no plan is raised as before');

-- ── FR-BST-013: a withdrawn claim's stages are frozen ──────────────────────────────────────────────
select pg_temp.as_user('b1');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('dp1')::uuid)$q$, 'FR-BST-013 the unbilled down payment is withdrawn first');
select lives_ok($q$insert into _state select 'pc3', create_progress_claim('09600000-0000-0000-0000-0000000000c1', 'progress',
  p_lines => '[{"boq_item_id":"09600000-0000-0000-0000-000000000e01","quantity":1}]'::jsonb)::text$q$, 'FR-BST-013 another claim (one-stage plan)');
select lives_ok($q$select withdraw_progress_claim(pg_temp.st('pc3')::uuid)$q$, 'FR-BST-013 it is withdrawn');
select is(pg_temp.detail($q$select complete_billing_stage(pg_temp.stage('pc3', 1), current_date)$q$),
  '55000 claim-withdrawn', 'FR-BST-013 a withdrawn claim''s stage cannot complete');

-- audit
reset role;
select is((select count(*)::int from audit_events where action = 'billing_stage.complete' and org_id = '09600000-0000-0000-0000-0000000000a1'), 3,
  'NFR-BST-002 each completion is audited once');

select * from finish();
rollback;
