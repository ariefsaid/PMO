-- procurement_payment_allowed.test.sql — 0368 (#1319 slice G review). One payment rule for every path:
-- procurement_payment_allowed (the dispatch gate and the Paid update guard), procurement_gate_violation refusing
-- every ERP write while a purchase awaits approval, and claim_outbox_for_commit re-checking a queued payment.
begin;
select plan(33);

insert into organizations (id, name, default_currency) values ('03680000-0000-0000-0000-0000000000f0','PPA','IDR');
insert into auth.users (id, email) values
  ('03680000-0000-0000-0000-0000000000f1','ppa-req@example.com'), ('03680000-0000-0000-0000-0000000000f2','ppa-fin1@example.com'),
  ('03680000-0000-0000-0000-0000000000f3','ppa-fin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03680000-0000-0000-0000-0000000000f1','03680000-0000-0000-0000-0000000000f0','Req','ppa-req@example.com','Project Manager','active'),
  ('03680000-0000-0000-0000-0000000000f2','03680000-0000-0000-0000-0000000000f0','Fin1','ppa-fin1@example.com','Finance','active'),
  ('03680000-0000-0000-0000-0000000000f3','03680000-0000-0000-0000-0000000000f0','Fin2','ppa-fin2@example.com','Finance','active');
insert into companies (id, org_id, name, type) values ('03680000-0000-0000-0000-0000000000c1','03680000-0000-0000-0000-0000000000f0','PPA Vendor','Vendor');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, approved_by_id, approved_total_value, pr_number, vendor_id) values
  -- b01 awaiting approval: a request number, no approver.
  ('03680000-0000-0000-0000-000000000b01','03680000-0000-0000-0000-0000000000f0','Q01','03680000-0000-0000-0000-0000000000f1','IDR',100,'Requested',null,null,'PR-01',null),
  -- b02 approved at 100, a quote of 200 waiting to be selected (re-opened below by the real quote path).
  ('03680000-0000-0000-0000-000000000b02','03680000-0000-0000-0000-0000000000f0','V02','03680000-0000-0000-0000-0000000000f1','IDR',100,'Vendor Quoted','03680000-0000-0000-0000-0000000000f2',100,'PR-02','03680000-0000-0000-0000-0000000000c1'),
  -- b03 never entered approval.
  ('03680000-0000-0000-0000-000000000b03','03680000-0000-0000-0000-0000000000f0','D03','03680000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null,null,null),
  -- b04 / b05 closed, each with an approved amount the ceiling would accept.
  ('03680000-0000-0000-0000-000000000b04','03680000-0000-0000-0000-0000000000f0','C04','03680000-0000-0000-0000-0000000000f1','IDR',100,'Cancelled','03680000-0000-0000-0000-0000000000f2',100,'PR-04',null),
  ('03680000-0000-0000-0000-000000000b05','03680000-0000-0000-0000-0000000000f0','R05','03680000-0000-0000-0000-0000000000f1','IDR',100,'Rejected',null,null,'PR-05',null),
  -- b06 Rejected -> Draft -> Ordered: entered approval once, never approved.
  ('03680000-0000-0000-0000-000000000b06','03680000-0000-0000-0000-0000000000f0','O06','03680000-0000-0000-0000-0000000000f1','IDR',100,'Ordered',null,null,'PR-06',null),
  -- b07 approved, ordered.
  ('03680000-0000-0000-0000-000000000b07','03680000-0000-0000-0000-0000000000f0','O07','03680000-0000-0000-0000-0000000000f1','IDR',100,'Ordered','03680000-0000-0000-0000-0000000000f2',100,'PR-07',null),
  -- b08 Requested yet carrying an approved amount the ceiling accepts (only status says "awaiting approval").
  ('03680000-0000-0000-0000-000000000b08','03680000-0000-0000-0000-0000000000f0','Q08','03680000-0000-0000-0000-0000000000f1','IDR',100,'Requested',null,100,null,null),
  -- b09 approved at 100, billed 200.
  ('03680000-0000-0000-0000-000000000b09','03680000-0000-0000-0000-0000000000f0','I09','03680000-0000-0000-0000-0000000000f1','IDR',200,'Vendor Invoiced','03680000-0000-0000-0000-0000000000f2',100,'PR-09',null),
  -- b10 approved, to be cancelled after its payment is queued.
  ('03680000-0000-0000-0000-000000000b10','03680000-0000-0000-0000-0000000000f0','O10','03680000-0000-0000-0000-0000000000f1','IDR',100,'Ordered','03680000-0000-0000-0000-0000000000f2',100,'PR-10',null);
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date, vq_number, is_selected) values
  ('03680000-0000-0000-0000-0000000000e1','03680000-0000-0000-0000-0000000000f0','03680000-0000-0000-0000-000000000b02','03680000-0000-0000-0000-0000000000c1',200,'2026-03-01','VQ-02',false);
insert into procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes) values
  ('03680000-0000-0000-0000-000000000b06','03680000-0000-0000-0000-0000000000f0','Draft','Requested','03680000-0000-0000-0000-0000000000f1','fixture'),
  ('03680000-0000-0000-0000-000000000b06','03680000-0000-0000-0000-0000000000f0','Requested','Rejected','03680000-0000-0000-0000-0000000000f2','fixture');
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03680000-0000-0000-0000-000000000b09','03680000-0000-0000-0000-0000000000f0','Received',200,'IDR','exclusive',0);

-- ── Grants: the dispatch path's service role only. ──
select ok(has_function_privilege('service_role','public.procurement_payment_allowed(uuid)','execute')
          and not has_function_privilege('authenticated','public.procurement_payment_allowed(uuid)','execute')
          and not has_function_privilege('anon','public.procurement_payment_allowed(uuid)','execute'),
  'C1 procurement_payment_allowed is executable by the service role only');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_catalog'] from pg_proc
            where oid = 'public.procurement_payment_allowed(uuid)'::regprocedure),
  'C1 procurement_payment_allowed is SECURITY DEFINER with a pinned search_path');

-- Re-open b02 through the real path: the 200 quote exceeds its 100 approval, so it returns to Requested.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03680000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select lives_ok($$ select select_procurement_quote('03680000-0000-0000-0000-0000000000e1') $$, 'fixture: the quote above the approval re-opens b02');
reset role;
reset request.jwt.claims;
select is((select status::text || '/' || coalesce(approved_by_id::text,'null') from procurements where id = '03680000-0000-0000-0000-000000000b02'),
  'Requested/null', 'fixture: b02 is back to Requested with its approval cleared');

-- ── C1: the one payment rule. ──
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b01'), 'awaiting_approval', 'C1 Requested with a request number and no approver is refused');
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b02'), 'awaiting_approval', 'C1 a purchase re-opened by a quote over its approval is refused');
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b08'), 'awaiting_approval', 'C1 Requested is refused outright, even carrying an approved amount');
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b03'), null, 'C1 a purchase that never entered approval may be paid');
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b04'), 'purchase_closed', 'C1 a Cancelled purchase is refused');
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b05'), 'purchase_closed', 'C1 a Rejected purchase is refused');
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b06'), 'approval_missing', 'C1 Rejected -> Draft -> Ordered (entered approval, never approved) is refused');
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b07'), null, 'C1 an approved purchase is allowed (its ceiling is asked separately)');
select is(procurement_payment_allowed('03680000-0000-0000-0000-0000000000ff'), 'purchase_not_found', 'C1 an unknown purchase is refused');
update organizations set procurement_gates = '{"approval_before_payment":true}' where id = '03680000-0000-0000-0000-0000000000f0';
select is(procurement_payment_allowed('03680000-0000-0000-0000-000000000b03'), 'gate_approval_before_payment', 'C1 with approval_before_payment ON a never-approved purchase is refused');
update organizations set procurement_gates = '{}' where id = '03680000-0000-0000-0000-0000000000f0';

-- The Paid update guard answers from the same function (direct SQL reaches the guard; status is definer-written).
select throws_ok($$ update procurements set status = 'Paid' where id = '03680000-0000-0000-0000-000000000b08' $$,
  '23514', 'This purchase is awaiting approval. Record its documents after it is approved.', 'C1 the guard refuses paying a Requested purchase');
select throws_ok($$ update procurements set status = 'Paid' where id = '03680000-0000-0000-0000-000000000b04' $$,
  '23514', 'This purchase is closed.', 'C1 the guard refuses paying a Cancelled purchase');
select throws_ok($$ update procurements set status = 'Paid' where id = '03680000-0000-0000-0000-000000000b06' $$,
  '23514', 'Cannot pay without a recorded approved amount.', 'C1 the guard keeps 0362''s entered-approval refusal');

-- ── I1: every ERP write kind is refused while the purchase awaits approval. ──
select is(procurement_gate_violation('03680000-0000-0000-0000-000000000b01','Ordered'), 'awaiting_approval', 'I1 a purchase order is refused while Requested');
select is(procurement_gate_violation('03680000-0000-0000-0000-000000000b01','Received'), 'awaiting_approval', 'I1 a goods receipt is refused while Requested');
select is(procurement_gate_violation('03680000-0000-0000-0000-000000000b02','Vendor Invoiced'), 'awaiting_approval', 'I1 a vendor invoice is refused on a re-opened purchase');
select is(procurement_gate_violation('03680000-0000-0000-0000-000000000b01','Paid'), 'awaiting_approval', 'I1 a payment is refused while Requested');
select is(procurement_gate_violation('03680000-0000-0000-0000-000000000b03','Ordered'), null, 'I1 a Draft purchase with gates off is not refused');

-- ── I2: a queued purchase payment is re-checked when claimed. ──
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, actor_user_id, reconcile_after) values
  ('03680000-0000-0000-0000-0000000000d1','03680000-0000-0000-0000-0000000000f0','procurement','pay-d1','k-d1','erpnext','create','pending',
   '{"erp_doc_kind":"payment","procurementId":"03680000-0000-0000-0000-000000000b10"}','03680000-0000-0000-0000-0000000000f3',null),
  ('03680000-0000-0000-0000-0000000000d2','03680000-0000-0000-0000-0000000000f0','procurement','pay-d2','k-d2','erpnext','create','failed',
   '{"erp_doc_kind":"payment","procurementId":"03680000-0000-0000-0000-000000000b02"}','03680000-0000-0000-0000-0000000000f3',null),
  ('03680000-0000-0000-0000-0000000000d3','03680000-0000-0000-0000-0000000000f0','procurement','pay-d3','k-d3','erpnext','create','pending',
   '{"erp_doc_kind":"payment","procurementId":"03680000-0000-0000-0000-000000000b07"}','03680000-0000-0000-0000-0000000000f3',null),
  ('03680000-0000-0000-0000-0000000000d4','03680000-0000-0000-0000-0000000000f0','procurement','pay-d4','k-d4','erpnext','create','pending',
   '{"erp_doc_kind":"payment","procurementId":"03680000-0000-0000-0000-000000000b07"}','03680000-0000-0000-0000-0000000000f2',null),
  ('03680000-0000-0000-0000-0000000000d5','03680000-0000-0000-0000-0000000000f0','procurement','pay-d5','k-d5','erpnext','create','pending',
   '{"erp_doc_kind":"payment","procurementId":"03680000-0000-0000-0000-000000000b09"}','03680000-0000-0000-0000-0000000000f3',null),
  ('03680000-0000-0000-0000-0000000000d6','03680000-0000-0000-0000-0000000000f0','procurement','pay-d6','k-d6','erpnext','create','pending',
   '{"erp_doc_kind":"payment","procurementId":"not-a-uuid"}','03680000-0000-0000-0000-0000000000f3',null),
  ('03680000-0000-0000-0000-0000000000d7','03680000-0000-0000-0000-0000000000f0','procurement','pay-d7','k-d7','erpnext','create','pending',
   '{"erp_doc_kind":"payment","procurementId":"03680000-0000-0000-0000-000000000b03"}',null,null),
  -- A quarantined payment's claim only probes/adopts or holds (a Payment Entry is never reissued), so it is not re-gated.
  ('03680000-0000-0000-0000-0000000000d8','03680000-0000-0000-0000-0000000000f0','procurement','pay-d8','k-d8','erpnext','create','quarantined',
   '{"erp_doc_kind":"payment","procurementId":"03680000-0000-0000-0000-000000000b04"}','03680000-0000-0000-0000-0000000000f3',now() - interval '1 minute'),
  -- Another procurement kind is not the payment branch.
  ('03680000-0000-0000-0000-0000000000d9','03680000-0000-0000-0000-0000000000f0','procurement','po-d9','k-d9','erpnext','create','pending',
   '{"erp_doc_kind":"purchase-order","procurementId":"03680000-0000-0000-0000-000000000b04"}','03680000-0000-0000-0000-0000000000f3',null);

-- The purchase is cancelled after its payment was queued.
update procurements set status = 'Cancelled' where id = '03680000-0000-0000-0000-000000000b10';

select throws_ok($$ select claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'procurement-payment-refused: purchase_closed', 'I2 a queued payment on a purchase cancelled since is not claimed');
select is((select state || '/' || attempt_count from external_command_outbox where id = '03680000-0000-0000-0000-0000000000d1'), 'pending/0',
  'I2 the refused row is untouched (never committing)');
select throws_ok($$ select claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d2') $$,
  'P0001', 'procurement-payment-refused: awaiting_approval', 'I2 a failed payment on a purchase re-opened since is not revived');
select is((select state from external_command_outbox where id = '03680000-0000-0000-0000-0000000000d2'), 'failed', 'I2 the re-opened row stays failed');
select throws_ok($$ select claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d4') $$,
  'P0001', 'procurement-payment-refused: separation_of_duties', 'I2 a payment recorded by the purchase''s approver is not claimed');
select throws_ok($$ select claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d5') $$,
  'P0001', 'procurement-payment-refused: exceeds_approved_amount', 'I2 a payment whose bills now exceed the approved amount is not claimed');
select throws_ok($$ select claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d6') $$,
  'P0001', 'procurement-payment-refused: purchase_not_found', 'I2 a payment row naming no readable purchase is not claimed (fail closed)');
select throws_ok($$ select claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d7') $$,
  'P0001', 'procurement-payment-refused: actor_missing', 'I2 an unattributable payment row is not claimed (fail closed)');
select is((select state from claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d3')), 'committing',
  'I2 a payment on an approved purchase, by a non-approver, within the ceiling is claimed');
select is((select state from claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d8')), 'committing',
  'I2 a quarantined payment still resolves (adopt-or-hold, never a new Payment Entry)');
select is((select state from claim_outbox_for_commit('03680000-0000-0000-0000-0000000000d9')), 'committing',
  'I2 other procurement kinds are not re-gated by the payment branch');

select * from finish();
rollback;
