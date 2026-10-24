-- Round trip for 0373 (queued procurement gate, document currency, committed spend per currency): down, then up
-- again. Run by scripts/test-procurement-queue-gate-rollback.sh, which inlines the migration files at the markers.
-- The down half doubles as the mutation check: without 0373 a queued order is claimed past the org's rule, a document
-- that never counted zeroes a stated total, a capture on a USD purchase lands in IDR, and committed spend adds USD to IDR.
begin;
select plan(13);
insert into organizations (id, name, default_currency, procurement_gates) values
  ('03739000-0000-0000-0000-00000000000a','PQG RT','IDR','{"approval_before_order":true}');
insert into auth.users (id, email) values ('03739000-0000-0000-0000-0000000000a1','pqg-rt@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03739000-0000-0000-0000-0000000000a1','03739000-0000-0000-0000-00000000000a','RT Fin','pqg-rt@example.com','Finance','active');
insert into projects (id, org_id, name, status, currency) values
  ('03739000-0000-0000-0000-0000000000d1','03739000-0000-0000-0000-00000000000a','RT P','Ongoing Project','IDR');
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('03739000-0000-0000-0000-0000000000e1','03739000-0000-0000-0000-00000000000a','RT draft','03739000-0000-0000-0000-0000000000a1',null,'IDR',0,'Draft'),
  ('03739000-0000-0000-0000-0000000000e2','03739000-0000-0000-0000-00000000000a','RT stated down','03739000-0000-0000-0000-0000000000a1',null,'USD',100,'Draft'),
  ('03739000-0000-0000-0000-0000000000e3','03739000-0000-0000-0000-00000000000a','RT stated up','03739000-0000-0000-0000-0000000000a1',null,'USD',100,'Draft'),
  ('03739000-0000-0000-0000-0000000000e4','03739000-0000-0000-0000-00000000000a','RT IDR','03739000-0000-0000-0000-0000000000a1','03739000-0000-0000-0000-0000000000d1','IDR',100,'Ordered'),
  ('03739000-0000-0000-0000-0000000000e5','03739000-0000-0000-0000-00000000000a','RT USD','03739000-0000-0000-0000-0000000000a1','03739000-0000-0000-0000-0000000000d1','USD',50,'Ordered');
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, actor_user_id) values
  ('03739000-0000-0000-0000-0000000000c1','03739000-0000-0000-0000-00000000000a','procurement','po-rt-1','k-rt-1','erpnext','create','pending',
   '{"erp_doc_kind":"purchase-order","procurementId":"03739000-0000-0000-0000-0000000000e1"}','03739000-0000-0000-0000-0000000000a1'),
  ('03739000-0000-0000-0000-0000000000c2','03739000-0000-0000-0000-00000000000a','procurement','po-rt-2','k-rt-2','erpnext','create','pending',
   '{"erp_doc_kind":"purchase-order","procurementId":"03739000-0000-0000-0000-0000000000e1"}','03739000-0000-0000-0000-0000000000a1');
set local request.jwt.claims = '{"role":"service_role"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount, erp_docstatus) values
  ('03739000-0000-0000-0000-0000000000e2','03739000-0000-0000-0000-00000000000a','Received',5000,'IDR','exclusive',0,1),
  ('03739000-0000-0000-0000-0000000000e3','03739000-0000-0000-0000-00000000000a','Received',5000,'IDR','exclusive',0,1);
reset request.jwt.claims;

-- @0373_DOWN@
select hasnt_function('public','procurement_create_refusal', array['uuid','uuid','text','uuid'], 'down 0373: the queued-create question is gone');
select is((select state from claim_outbox_for_commit('03739000-0000-0000-0000-0000000000c1')), 'committing',
  'down 0373 (mutation check): without the re-check a queued order is claimed past the org''s approval rule');
set local request.jwt.claims = '{"role":"service_role"}';
update procurement_invoices set amount = 6000 where procurement_id = '03739000-0000-0000-0000-0000000000e2';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03739000-0000-0000-0000-0000000000e2'), 0::numeric,
  'down 0373 (mutation check): editing a document in another currency zeroes the stated total');
select is(project_committed_spend('03739000-0000-0000-0000-0000000000d1'), 150::numeric,
  'down 0373 (mutation check): committed spend is one sum across currencies');
update organizations set procurement_gates = '{}' where id = '03739000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03739000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select create_purchase_order('03739000-0000-0000-0000-0000000000e2', null, null, current_date, 10) $$, 'down 0373: fixture order on the USD purchase');
reset role;
reset request.jwt.claims;
select is((select currency from purchase_orders where procurement_id = '03739000-0000-0000-0000-0000000000e2'), 'IDR',
  'down 0373 (mutation check): a capture on a USD purchase lands in the org currency');
update organizations set procurement_gates = '{"approval_before_order":true}' where id = '03739000-0000-0000-0000-00000000000a';

-- @0373_UP@
select has_function('public','procurement_create_refusal', array['uuid','uuid','text','uuid'], 'up again: the queued-create question');
select ok(not has_function_privilege('authenticated','public.procurement_create_refusal(uuid,uuid,text,uuid)','execute')
          and not has_function_privilege('anon','public.procurement_create_refusal(uuid,uuid,text,uuid)','execute'),
  'up again: the queued-create question is not callable by clients');
select throws_ok($$ select claim_outbox_for_commit('03739000-0000-0000-0000-0000000000c2') $$,
  'P0001', 'procurement-create-refused: gate_approval_before_order', 'up again: a queued order past the org''s rule is refused');
set local request.jwt.claims = '{"role":"service_role"}';
update procurement_invoices set amount = 6000 where procurement_id = '03739000-0000-0000-0000-0000000000e3';
reset request.jwt.claims;
select is((select total_value from procurements where id = '03739000-0000-0000-0000-0000000000e3'), 100::numeric,
  'up again: editing a document in another currency leaves the stated total');
select results_eq($$ select currency, amount from project_committed_spend('03739000-0000-0000-0000-0000000000d1') $$,
  $$ values ('IDR'::text, 100::numeric), ('USD'::text, 50::numeric) $$, 'up again: committed spend per currency');
update organizations set procurement_gates = '{}' where id = '03739000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03739000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select create_purchase_order('03739000-0000-0000-0000-0000000000e3', null, null, current_date, 10) $$, 'up again: fixture order on the USD purchase');
reset role;
reset request.jwt.claims;
select is((select currency from purchase_orders where procurement_id = '03739000-0000-0000-0000-0000000000e3'), 'USD',
  'up again: a capture on a USD purchase is in USD');
select * from finish();
rollback;
