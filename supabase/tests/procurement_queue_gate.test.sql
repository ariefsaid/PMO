-- procurement_queue_gate.test.sql — 0373. A queued ERP procurement create (order, receipt, vendor invoice, payment) is
-- re-checked against the org's CURRENT purchase rules when it is claimed, with the same question the foreground
-- dispatch asks (procurement_gate_violation for the target step) plus the payment rule, actor and amount checks.
-- A refusal claims nothing (zero ERP writes). A quarantined row still resolves (adopt an already-landed document).
begin;
select plan(20);

insert into organizations (id, name, default_currency) values ('03730000-0000-0000-0000-0000000000f0','PQG','IDR');
insert into auth.users (id, email) values
  ('03730000-0000-0000-0000-0000000000f1','pqg-req@example.com'), ('03730000-0000-0000-0000-0000000000f2','pqg-fin1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03730000-0000-0000-0000-0000000000f1','03730000-0000-0000-0000-0000000000f0','Req','pqg-req@example.com','Project Manager','active'),
  ('03730000-0000-0000-0000-0000000000f2','03730000-0000-0000-0000-0000000000f0','Fin1','pqg-fin1@example.com','Finance','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, approved_by_id, approved_total_value, pr_number) values
  -- b01 ordered without ever entering approval (no approver, no request number): payable while every gate is off.
  ('03730000-0000-0000-0000-000000000b01','03730000-0000-0000-0000-0000000000f0','O01','03730000-0000-0000-0000-0000000000f1','IDR',100,'Ordered',null,null,null),
  -- b02 a Draft purchase: an order is allowed while the gates are off.
  ('03730000-0000-0000-0000-000000000b02','03730000-0000-0000-0000-0000000000f0','D02','03730000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null,null),
  -- b03 a Draft purchase sent for approval after its vendor invoice was queued.
  ('03730000-0000-0000-0000-000000000b03','03730000-0000-0000-0000-0000000000f0','D03','03730000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null,null),
  -- b04 an approved, ordered purchase with no goods receipt.
  ('03730000-0000-0000-0000-000000000b04','03730000-0000-0000-0000-0000000000f0','O04','03730000-0000-0000-0000-0000000000f1','IDR',100,'Ordered','03730000-0000-0000-0000-0000000000f2',100,'PR-04');

insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, actor_user_id, reconcile_after) values
  ('03730000-0000-0000-0000-0000000000d1','03730000-0000-0000-0000-0000000000f0','procurement','pay-d1','k-d1','erpnext','create','pending',
   '{"erp_doc_kind":"payment","procurementId":"03730000-0000-0000-0000-000000000b01"}','03730000-0000-0000-0000-0000000000f2',null),
  ('03730000-0000-0000-0000-0000000000d2','03730000-0000-0000-0000-0000000000f0','procurement','po-d2','k-d2','erpnext','create','pending',
   '{"erp_doc_kind":"purchase-order","procurementId":"03730000-0000-0000-0000-000000000b02"}','03730000-0000-0000-0000-0000000000f2',null),
  ('03730000-0000-0000-0000-0000000000d3','03730000-0000-0000-0000-0000000000f0','procurement','pi-d3','k-d3','erpnext','create','failed',
   '{"erp_doc_kind":"purchase-invoice","procurementId":"03730000-0000-0000-0000-000000000b03"}','03730000-0000-0000-0000-0000000000f2',null),
  ('03730000-0000-0000-0000-0000000000d4','03730000-0000-0000-0000-0000000000f0','procurement','pi-d4','k-d4','erpnext','create','pending',
   '{"erp_doc_kind":"purchase-invoice","procurementId":"03730000-0000-0000-0000-000000000b04"}','03730000-0000-0000-0000-0000000000f2',null),
  ('03730000-0000-0000-0000-0000000000d5','03730000-0000-0000-0000-0000000000f0','procurement','gr-d5','k-d5','erpnext','create','pending',
   '{"erp_doc_kind":"goods-receipt","procurementId":"03730000-0000-0000-0000-000000000b04"}','03730000-0000-0000-0000-0000000000f2',null),
  -- Quarantined rows past their window: the claim only probes first (adopt an already-landed document).
  ('03730000-0000-0000-0000-0000000000d6','03730000-0000-0000-0000-0000000000f0','procurement','pay-d6','k-d6','erpnext','create','quarantined',
   '{"erp_doc_kind":"payment","procurementId":"03730000-0000-0000-0000-000000000b01"}','03730000-0000-0000-0000-0000000000f2',now() - interval '1 minute'),
  ('03730000-0000-0000-0000-0000000000d7','03730000-0000-0000-0000-0000000000f0','procurement','po-d7','k-d7','erpnext','create','quarantined',
   '{"erp_doc_kind":"purchase-order","procurementId":"03730000-0000-0000-0000-000000000b02"}','03730000-0000-0000-0000-0000000000f2',now() - interval '1 minute');

-- ── The shared question: service role only, definer, pinned search_path. ──
select ok(has_function_privilege('service_role','public.procurement_create_refusal(uuid,uuid,text,uuid)','execute')
          and not has_function_privilege('authenticated','public.procurement_create_refusal(uuid,uuid,text,uuid)','execute')
          and not has_function_privilege('anon','public.procurement_create_refusal(uuid,uuid,text,uuid)','execute'),
  'procurement_create_refusal is executable by the service role only');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_catalog'] from pg_proc
            where oid = 'public.procurement_create_refusal(uuid,uuid,text,uuid)'::regprocedure),
  'procurement_create_refusal is SECURITY DEFINER with a pinned search_path');

-- An org turns on "approval before order" after the payment and the order were queued.
update organizations set procurement_gates = '{"approval_before_order":true}' where id = '03730000-0000-0000-0000-0000000000f0';

select throws_ok($$ select claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'procurement-payment-refused: gate_approval_before_order',
  'a queued payment is refused once the org requires an approval before an order and the purchase has none');
select is((select state || '/' || attempt_count from external_command_outbox where id = '03730000-0000-0000-0000-0000000000d1'), 'pending/0',
  'the refused payment row is untouched (never committing, so no ERP write)');
select throws_ok($$ select claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d2') $$,
  'P0001', 'procurement-create-refused: gate_approval_before_order',
  'a queued purchase order is refused once the org requires an approval before an order');
select is((select state || '/' || attempt_count from external_command_outbox where id = '03730000-0000-0000-0000-0000000000d2'), 'pending/0',
  'the refused order row is untouched');
select is(procurement_create_refusal('03730000-0000-0000-0000-0000000000f0','03730000-0000-0000-0000-000000000b02','purchase-order','03730000-0000-0000-0000-0000000000f2'),
  'gate_approval_before_order', 'the shared question names the same reason the foreground gate gives');
select is(procurement_gate_violation('03730000-0000-0000-0000-000000000b02','Ordered'), 'gate_approval_before_order',
  'control: the foreground gate refuses the same order');

-- A quarantined row still resolves: its claim probes first and adopts an already-landed document.
select is((select state from claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d6')), 'committing',
  'a quarantined payment is still claimed so an already-landed Payment Entry can be adopted');
select is((select state from claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d7')), 'committing',
  'a quarantined order is still claimed so an already-landed order can be adopted');

-- The purchase whose vendor invoice failed is sent for approval before the retry.
update procurements set status = 'Requested', pr_number = 'PR-03' where id = '03730000-0000-0000-0000-000000000b03';
select throws_ok($$ select claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d3') $$,
  'P0001', 'procurement-create-refused: awaiting_approval', 'a failed vendor invoice on a purchase now awaiting approval is not revived');
select is((select state from external_command_outbox where id = '03730000-0000-0000-0000-0000000000d3'), 'failed', 'the refused invoice row stays failed');

-- "Receipt before invoice" turned on after the invoice was queued.
update organizations set procurement_gates = '{"receipt_before_invoice":true}' where id = '03730000-0000-0000-0000-0000000000f0';
select throws_ok($$ select claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d4') $$,
  'P0001', 'procurement-create-refused: gate_receipt_before_invoice', 'a queued vendor invoice is refused once a receipt must come first');
select is((select state from claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d5')), 'committing',
  'control: the queued goods receipt the rule asks for is claimed');

-- Gates off again: the same rows are claimable (the refusal is the rule, not the row).
update organizations set procurement_gates = '{}' where id = '03730000-0000-0000-0000-0000000000f0';
select is((select state from claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d1')), 'committing',
  'control: with the gates off the queued payment is claimed');
select is((select state from claim_outbox_for_commit('03730000-0000-0000-0000-0000000000d2')), 'committing',
  'control: with the gates off the queued order is claimed');

-- The shared question keeps the payment checks the claim already made.
select is(procurement_create_refusal('03730000-0000-0000-0000-0000000000f0','03730000-0000-0000-0000-000000000b04','payment','03730000-0000-0000-0000-0000000000f2'),
  'separation_of_duties', 'a payment by the purchase''s approver is refused');
select is(procurement_create_refusal('03730000-0000-0000-0000-0000000000f0','03730000-0000-0000-0000-000000000b01','payment',null),
  'actor_missing', 'an unattributable payment is refused');
select is(procurement_create_refusal('03730000-0000-0000-0000-0000000000ff','03730000-0000-0000-0000-000000000b01','purchase-order','03730000-0000-0000-0000-0000000000f2'),
  'purchase_not_found', 'a purchase in another org is not found');
select is(procurement_create_refusal('03730000-0000-0000-0000-0000000000f0',null,'goods-receipt','03730000-0000-0000-0000-0000000000f2'),
  'purchase_not_found', 'a create naming no purchase is refused (fail closed)');

select * from finish();
rollback;
