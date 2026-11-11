-- 0349 — the payment ceiling compares pre-tax billed amounts to the pre-tax approved amount, counts live
-- bills once, refuses foreign-currency bills, and offers an approval path for a higher billed amount.
begin;
select plan(59);

insert into organizations(id,name,default_currency) values
 ('03492000-0000-0000-0000-000000000001','Payment Ceiling Org','IDR'),
 ('03492000-0000-0000-0000-000000000002','Other Ceiling Org','IDR');
insert into auth.users(id,email) values
 ('03492000-0000-0000-0000-000000000011','pc-requester@example.com'),
 ('03492000-0000-0000-0000-000000000012','pc-approver@example.com'),
 ('03492000-0000-0000-0000-000000000013','pc-payer@example.com'),
 ('03492000-0000-0000-0000-000000000014','pc-bill-recorder@example.com'),
 ('03492000-0000-0000-0000-000000000015','pc-amount-approver@example.com'),
 ('03492000-0000-0000-0000-000000000016','pc-quote-selector@example.com'),
 ('03492000-0000-0000-0000-000000000017','pc-admin@example.com'),
 ('03492000-0000-0000-0000-000000000018','pc-executive@example.com'),
 ('03492000-0000-0000-0000-000000000019','pc-other-org@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03492000-0000-0000-0000-000000000011','03492000-0000-0000-0000-000000000001','Requester','pc-requester@example.com','Project Manager','active'),
 ('03492000-0000-0000-0000-000000000012','03492000-0000-0000-0000-000000000001','Approver','pc-approver@example.com','Project Manager','active'),
 ('03492000-0000-0000-0000-000000000013','03492000-0000-0000-0000-000000000001','Payer','pc-payer@example.com','Finance','active'),
 ('03492000-0000-0000-0000-000000000014','03492000-0000-0000-0000-000000000001','Bill Recorder','pc-bill-recorder@example.com','Finance','active'),
 ('03492000-0000-0000-0000-000000000015','03492000-0000-0000-0000-000000000001','Amount Approver','pc-amount-approver@example.com','Finance','active'),
 ('03492000-0000-0000-0000-000000000016','03492000-0000-0000-0000-000000000001','Quote Selector','pc-quote-selector@example.com','Finance','active'),
 ('03492000-0000-0000-0000-000000000017','03492000-0000-0000-0000-000000000001','Admin','pc-admin@example.com','Admin','active'),
 ('03492000-0000-0000-0000-000000000018','03492000-0000-0000-0000-000000000001','Executive','pc-executive@example.com','Executive','active'),
 ('03492000-0000-0000-0000-000000000019','03492000-0000-0000-0000-000000000002','Other Org Finance','pc-other-org@example.com','Finance','active');
insert into companies(id,org_id,name,type) values
 ('03492000-0000-0000-0000-000000000021','03492000-0000-0000-0000-000000000001','Ceiling Vendor','Vendor');
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency) values
 ('03492000-0000-0000-0000-000000000101','03492000-0000-0000-0000-000000000001','Exclusive bill','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000102','03492000-0000-0000-0000-000000000001','Inclusive bill','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000103','03492000-0000-0000-0000-000000000001','Over bill','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000104','03492000-0000-0000-0000-000000000001','Amended bill','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000105','03492000-0000-0000-0000-000000000001','Foreign bill','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000106','03492000-0000-0000-0000-000000000001','Quote reroute','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000107','03492000-0000-0000-0000-000000000001','Admin bill','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000109','03492000-0000-0000-0000-000000000001','Routed amount','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000113','03492000-0000-0000-0000-000000000001','Admin reroute','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000114','03492000-0000-0000-0000-000000000001','Bill row recorder','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000115','03492000-0000-0000-0000-000000000001','Invoiced mover','03492000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03492000-0000-0000-0000-000000000116','03492000-0000-0000-0000-000000000001','Admin requester','03492000-0000-0000-0000-000000000017','Requested',1000,'IDR');
-- Approved by a recorded approver, but carrying no recorded approved amount.
insert into procurements(id,org_id,title,requested_by_id,approved_by_id,status,total_value,currency) values
 ('03492000-0000-0000-0000-000000000108','03492000-0000-0000-0000-000000000001','Missing amount','03492000-0000-0000-0000-000000000011','03492000-0000-0000-0000-000000000012','Vendor Invoiced',1000,'IDR');

set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000012","role":"authenticated"}';
select transition_procurement(id,'Approved') from procurements
 where id in ('03492000-0000-0000-0000-000000000101','03492000-0000-0000-0000-000000000102','03492000-0000-0000-0000-000000000103',
              '03492000-0000-0000-0000-000000000104','03492000-0000-0000-0000-000000000105','03492000-0000-0000-0000-000000000106',
              '03492000-0000-0000-0000-000000000107','03492000-0000-0000-0000-000000000113','03492000-0000-0000-0000-000000000114',
              '03492000-0000-0000-0000-000000000115','03492000-0000-0000-0000-000000000116');
reset role;
update procurements set status='Received' where id in
 ('03492000-0000-0000-0000-000000000101','03492000-0000-0000-0000-000000000102','03492000-0000-0000-0000-000000000103',
  '03492000-0000-0000-0000-000000000107');

-- Bills recorded by the bill recorder through the real capture RPC (records the actor).
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000014","role":"authenticated"}';
select capture_vendor_invoice(p_procurement_id=>'03492000-0000-0000-0000-000000000101',p_status=>'Received',p_invoice_date=>'2026-10-01',
  p_amount=>1000,p_tax_treatment=>'exclusive',p_tax_amount=>110);
select capture_vendor_invoice(p_procurement_id=>'03492000-0000-0000-0000-000000000102',p_status=>'Received',p_invoice_date=>'2026-10-01',
  p_amount=>1110,p_tax_treatment=>'inclusive',p_tax_amount=>110);
select capture_vendor_invoice(p_procurement_id=>'03492000-0000-0000-0000-000000000103',p_status=>'Received',p_invoice_date=>'2026-10-01',
  p_amount=>1200,p_tax_treatment=>'exclusive',p_tax_amount=>132);
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000017","role":"authenticated"}';
select capture_vendor_invoice(p_procurement_id=>'03492000-0000-0000-0000-000000000107',p_status=>'Received',p_invoice_date=>'2026-10-01',
  p_amount=>1300,p_tax_treatment=>'exclusive',p_tax_amount=>0);
reset role;

-- ── Net-vs-net comparison ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$select transition_procurement('03492000-0000-0000-0000-000000000101','Paid')$$,
  'AC-SEC-208: a 1,000 pre-tax approval pays a 1,000 net bill carrying 110 VAT on top');
select lives_ok($$select transition_procurement('03492000-0000-0000-0000-000000000102','Paid')$$,
  'AC-SEC-208: a tax-inclusive bill is compared on its amount net of tax');
select throws_ok($$select transition_procurement('03492000-0000-0000-0000-000000000103','Paid')$$,
  '23514',null,'AC-SEC-208: a 1,200 net bill against a 1,000 approval is blocked at payment');
select is((select billed_net from procurement_payment_within_ceiling('03492000-0000-0000-0000-000000000103')),1200::numeric,
  'AC-SEC-208: the ceiling read reports the billed amount net of tax');
select is((select approved_amount from procurement_payment_within_ceiling('03492000-0000-0000-0000-000000000103')),1000::numeric,
  'AC-SEC-208: the ceiling read reports the approved amount it compared against');
reset role;

-- ── Live bills only: a cancelled ERP bill and its amended replacement count once ────────────────────
update procurements set status='Vendor Invoiced' where id='03492000-0000-0000-0000-000000000104';
insert into procurement_invoices(id,org_id,procurement_id,status,vi_number,amount,tax_treatment,tax_amount,erp_docstatus,erp_cancelled_at) values
 ('03492000-0000-0000-0000-000000000401','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000104','Received','PINV-0104',1110,'inclusive',110,2,now());
insert into procurement_invoices(id,org_id,procurement_id,status,vi_number,amount,tax_treatment,tax_amount,erp_docstatus,erp_amended_from) values
 ('03492000-0000-0000-0000-000000000402','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000104','Received','PINV-0104-1',1110,'inclusive',110,1,'PINV-0104');
select is((select billed_net from procurement_payment_within_ceiling('03492000-0000-0000-0000-000000000104')),1000::numeric,
  'AC-SEC-209: a cancelled ERP bill is not counted next to its amended replacement');
update procurement_invoices set erp_docstatus=1, erp_cancelled_at=null where id='03492000-0000-0000-0000-000000000401';
select is((select billed_net from procurement_payment_within_ceiling('03492000-0000-0000-0000-000000000104')),1000::numeric,
  'AC-SEC-209: a bill superseded by an amendment is not counted even before its cancellation is mirrored');
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$select transition_procurement('03492000-0000-0000-0000-000000000104','Paid')$$,
  'AC-SEC-209: an amended bill within the approved amount is payable');
reset role;

-- ── Currency: a bill in another currency is refused, never converted ───────────────────────────────
update procurements set status='Vendor Invoiced' where id='03492000-0000-0000-0000-000000000105';
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount,currency) values
 ('03492000-0000-0000-0000-000000000501','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000105','Received',10,'exclusive',0,'USD');
select is((select currency from procurement_invoices where id='03492000-0000-0000-0000-000000000501'),'USD',
  'AC-SEC-210: fixture bill carries a foreign currency');
select is((select reason from procurement_payment_within_ceiling('03492000-0000-0000-0000-000000000105')),
  'bill currency differs from procurement currency','AC-SEC-210: the ceiling names the currency mismatch');
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000013","role":"authenticated"}';
select throws_ok($$select transition_procurement('03492000-0000-0000-0000-000000000105','Paid')$$,
  '23514',null,'AC-SEC-210: a bill in a different currency is refused at payment');
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000015","role":"authenticated"}';
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000105',2000)$$,
  '23514','bill currency differs from procurement currency','AC-SEC-210: a higher amount cannot be approved across currencies');
reset role;

-- ── Overage approval: SoD exclusions, floor, then payment ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000000103', 1200), 'requester', 'AC-SEC-211: eligibility reflects requester');
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000103',1200)$$,
  '42501','separation of duties: requester cannot approve the procurement amount','AC-SEC-211: the requester cannot approve the higher amount');
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000014","role":"authenticated"}';
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000000103', 1200), 'bill_recorder', 'AC-SEC-211: eligibility reflects bill recorder');
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000103',1200)$$,
  '42501','separation of duties: the bill recorder cannot approve the billed amount','AC-SEC-211: the actor who recorded the bill cannot approve the higher amount');
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000015","role":"authenticated"}';
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000103',1100)$$,
  '23514','the approved amount cannot be below the billed amount','AC-SEC-211: the approved amount is never set below the billed net');
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000101',2000)$$,
  'P0001',null,'AC-SEC-211: only a procurement awaiting payment takes a higher approved amount');
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000000103', 1200), 'allowed', 'AC-SEC-211: eligibility reflects eligible actor');
select lives_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000103',1200)$$,
  'AC-SEC-211: an eligible approver who is neither requester nor bill recorder approves the higher amount');
reset role;
select is((select approved_total_value from procurements where id='03492000-0000-0000-0000-000000000103'),1200::numeric,
  'AC-SEC-211: the approved amount is raised to the approved figure');
select is((select count(*)::int from audit_events where action='procurement.amount_approved'
            and entity_id='03492000-0000-0000-0000-000000000103' and actor_id='03492000-0000-0000-0000-000000000015'
            and (detail->>'to')::numeric=1200 and (detail->>'from')::numeric=1000),1,
  'AC-SEC-211: the higher amount approval is audited with its actor and both amounts');
set local role authenticated;
select throws_ok($$select transition_procurement('03492000-0000-0000-0000-000000000103','Paid')$$,
  '42501','separation of duties: approver cannot pay own procurement','AC-SEC-211: the approver of the higher amount cannot pay it');
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$select transition_procurement('03492000-0000-0000-0000-000000000103','Paid')$$,
  'AC-SEC-211: after the higher amount is approved a different payer can pay');
reset role;

-- Admin does not bypass the bill-recorder exclusion.
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000017","role":"authenticated"}';
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000107',1300)$$,
  '42501','separation of duties: the bill recorder cannot approve the billed amount','AC-SEC-211: an Admin who recorded the bill cannot approve the higher amount');
-- Each recorder signal excludes on its own: the bill row's recorder, and whoever moved it to Vendor Invoiced.
reset role;
set local request.jwt.claims='{}';
update procurements set status='Vendor Invoiced' where id in ('03492000-0000-0000-0000-000000000114','03492000-0000-0000-0000-000000000116');
update procurements set status='Received' where id='03492000-0000-0000-0000-000000000115';
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values
 ('03492000-0000-0000-0000-000000001601','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000116','Received',1300,'exclusive',0);
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000014","role":"authenticated"}';
select create_procurement_invoice(p_procurement_id=>'03492000-0000-0000-0000-000000000114',p_status=>'Received',p_invoice_date=>'2026-10-01',
  p_amount=>1300,p_tax_treatment=>'exclusive',p_tax_amount=>0);
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000114',1300)$$,
  '42501','separation of duties: the bill recorder cannot approve the billed amount','AC-SEC-211: whoever recorded a bill row cannot approve the higher amount');
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000016","role":"authenticated"}';
select transition_procurement('03492000-0000-0000-0000-000000000115','Vendor Invoiced');
reset role;
set local request.jwt.claims='{}';
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values
 ('03492000-0000-0000-0000-000000001501','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000115','Received',1300,'exclusive',0);
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000016","role":"authenticated"}';
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000115',1300)$$,
  '42501','separation of duties: the bill recorder cannot approve the billed amount','AC-SEC-211: whoever moved the request to Vendor Invoiced cannot approve the higher amount');
-- Admin does not bypass the requester exclusion.
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000017","role":"authenticated"}';
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000116',1300)$$,
  '42501','separation of duties: requester cannot approve the procurement amount','AC-SEC-211: an Admin requester cannot approve the higher amount');
-- Cross-organization callers are refused and read nothing.
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000019","role":"authenticated"}';
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000107',1300)$$,
  '42501','not authorized','AC-SEC-211: a caller from another organization cannot approve the amount');
select is((select count(*)::int from procurement_payment_within_ceiling('03492000-0000-0000-0000-000000000107')),0,
  'AC-SEC-211: a caller from another organization reads no ceiling');
reset role;

-- ── Quote re-route: the selector neither approves the re-route nor a later overage ────────────────
reset role;
insert into procurement_quotations(id,org_id,procurement_id,vendor_id,total_amount) values
 ('03492000-0000-0000-0000-000000000601','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000106','03492000-0000-0000-0000-000000000021',1500);
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000016","role":"authenticated"}';
select lives_ok($$select transition_procurement('03492000-0000-0000-0000-000000000106','Vendor Quoted')$$,'AC-SEC-212: request enters quoting');
select lives_ok($$select select_procurement_quote('03492000-0000-0000-0000-000000000601')$$,'AC-SEC-212: over-approval quote re-routes for approval');
reset role;
select is((select status::text from procurements where id='03492000-0000-0000-0000-000000000106'),'Requested',
  'AC-SEC-212: the over-approval quote returned the request for approval');
select is((select count(*)::int from procurement_status_events where procurement_id='03492000-0000-0000-0000-000000000106'
            and from_status='Vendor Quoted' and to_status='Requested' and actor_id='03492000-0000-0000-0000-000000000016'),1,
  'AC-SEC-212: the re-route is recorded with the selector as its actor');
select is((select count(*)::int from notifications where owner_id='03492000-0000-0000-0000-000000000012'
            and metadata->'entity'->>'id'='03492000-0000-0000-0000-000000000106' and title='Procurement awaiting your approval'),1,
  'AC-SEC-213: approvers are notified when a quote returns a request for approval');
select is((select count(*)::int from notifications where owner_id='03492000-0000-0000-0000-000000000016'
            and metadata->'entity'->>'id'='03492000-0000-0000-0000-000000000106' and title='Procurement awaiting your approval'),0,
  'AC-SEC-213: the selector who caused the re-route is not asked to approve it');
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000016","role":"authenticated"}';
select throws_ok($$select transition_procurement('03492000-0000-0000-0000-000000000106','Approved')$$,
  '42501','separation of duties: quote selector cannot approve the revised amount','AC-SEC-212: the quote selector cannot approve the re-routed amount');
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select transition_procurement('03492000-0000-0000-0000-000000000106','Approved')$$,
  'AC-SEC-212: a different eligible approver approves the re-routed amount');
reset role;
update procurements set status='Vendor Invoiced' where id='03492000-0000-0000-0000-000000000106';
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values
 ('03492000-0000-0000-0000-000000000602','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000106','Received',1700,'exclusive',0);
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000016","role":"authenticated"}';
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000000106', 1700), 'quote_selector', 'AC-SEC-211: eligibility reflects quote selector');
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000106',1700)$$,
  '42501','separation of duties: quote selector cannot approve the revised amount','AC-SEC-212: the quote selector cannot approve a later higher amount');
reset role;

-- An Admin who selected the over-approval quote does not bypass the exclusion either.
reset role;
set local request.jwt.claims='{}';
insert into procurement_quotations(id,org_id,procurement_id,vendor_id,total_amount) values
 ('03492000-0000-0000-0000-000000001301','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000113','03492000-0000-0000-0000-000000000021',2000);
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000017","role":"authenticated"}';
select transition_procurement('03492000-0000-0000-0000-000000000113','Vendor Quoted');
select lives_ok($$select select_procurement_quote('03492000-0000-0000-0000-000000001301')$$,'AC-SEC-212: an Admin selects an over-approval quote');
select throws_ok($$select transition_procurement('03492000-0000-0000-0000-000000000113','Approved')$$,
  '42501','separation of duties: quote selector cannot approve the revised amount','AC-SEC-212: an Admin quote selector cannot approve the re-routed amount');
reset role;

-- ── Missing approved amount and direct column writes ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000013","role":"authenticated"}';
select throws_ok($$select transition_procurement('03492000-0000-0000-0000-000000000108','Paid')$$,
  '23514','Cannot pay without a recorded approved amount.','AC-SEC-214: an approved request with no recorded approved amount cannot be paid');
reset role;
-- Grant the columns for this transaction only, so the trigger (not the privilege system) must refuse.
grant update (approved_total_value, amount_approved_by_id) on public.procurements to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000017","role":"authenticated"}';
select throws_ok($$update procurements set approved_total_value=1 where id='03492000-0000-0000-0000-000000000109'$$,
  '42501','Approved amount is server managed.','AC-SEC-214: the approved amount trigger refuses a client write');
select throws_ok($$update procurements set amount_approved_by_id='03492000-0000-0000-0000-000000000017' where id='03492000-0000-0000-0000-000000000109'$$,
  '42501','Approved amount is server managed.','AC-SEC-214: the amount approver trigger refuses a client write');
reset role;
revoke update (approved_total_value, amount_approved_by_id) on public.procurements from authenticated;

-- ── Routing: eligibility for the higher amount reuses the approval route ───────────────────────────
insert into spend_approvers(org_id,project_id,profile_id) values
 ('03492000-0000-0000-0000-000000000001',null,'03492000-0000-0000-0000-000000000012');
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select transition_procurement('03492000-0000-0000-0000-000000000109','Approved')$$,'AC-SEC-215: routed request approved by the named approver');
reset role;
set local request.jwt.claims='{}';
update procurements set status='Vendor Invoiced' where id='03492000-0000-0000-0000-000000000109';
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values
 ('03492000-0000-0000-0000-000000000901','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000109','Received',1500,'exclusive',0);
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000018","role":"authenticated"}';
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000000109', 1500), 'routing', 'AC-SEC-211: eligibility reflects unrouted actor');
select throws_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000109',1500)$$,
  '42501','approval routing: no_project requires a named approver','AC-SEC-215: a caller the approval route does not name cannot approve the higher amount');
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000012","role":"authenticated"}';
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000000109', 1500), 'allowed', 'AC-SEC-211: eligibility reflects routed actor');
select lives_ok($$select approve_procurement_amount('03492000-0000-0000-0000-000000000109',1500)$$,
  'AC-SEC-215: the approver the route names approves the higher amount');
reset role;

-- ── Backfill: the approved amount is the routed request amount, not a later total ──────────────────
insert into procurements(id,org_id,title,requested_by_id,approved_by_id,status,total_value,currency) values
 ('03492000-0000-0000-0000-000000000110','03492000-0000-0000-0000-000000000001','Raised later','03492000-0000-0000-0000-000000000011','03492000-0000-0000-0000-000000000012','Ordered',5000,'IDR'),
 ('03492000-0000-0000-0000-000000000111','03492000-0000-0000-0000-000000000001','No audit','03492000-0000-0000-0000-000000000011','03492000-0000-0000-0000-000000000012','Ordered',700,'IDR');
insert into audit_events(org_id,actor_id,action,entity_id,detail,created_at) values
 ('03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000012','procurement.approval_route','03492000-0000-0000-0000-000000000110',
  '{"to":"Rejected","request_amount":400}', now() - interval '3 days'),
 ('03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000012','procurement.approval_route','03492000-0000-0000-0000-000000000110',
  '{"to":"Approved","request_amount":1000}', now() - interval '2 days'),
 ('03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000012','procurement.approval_route','03492000-0000-0000-0000-000000000110',
  '{"to":"Rejected","request_amount":9999}', now() - interval '1 day');
select backfill_procurement_approved_total();
select is((select approved_total_value from procurements where id='03492000-0000-0000-0000-000000000110'),1000::numeric,
  'AC-SEC-216: backfill uses the amount routed for approval, not the total raised afterwards');
select is((select approved_total_value from procurements where id='03492000-0000-0000-0000-000000000111'),700::numeric,
  'AC-SEC-216: backfill falls back to the current total only when no approval route was audited');

-- ── Scheduled payments cannot exceed the gross of live bills ───────────────────────────────────────
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency) values
 ('03492000-0000-0000-0000-000000000112','03492000-0000-0000-0000-000000000001','Scheduled pay','03492000-0000-0000-0000-000000000011','Vendor Invoiced',1000,'IDR');
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values
 ('03492000-0000-0000-0000-000000001201','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000112','Received',1000,'exclusive',110),
 ('03492000-0000-0000-0000-000000001202','03492000-0000-0000-0000-000000000001','03492000-0000-0000-0000-000000000112','Received',5000,'exclusive',0);
update procurement_invoices set erp_docstatus=2, erp_cancelled_at=now() where id='03492000-0000-0000-0000-000000001202';
set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$select create_payment('03492000-0000-0000-0000-000000000112',null,'PAY-1','Scheduled','2026-10-02',1000)$$,
  'AC-SEC-217: a scheduled payment within the live bill gross is recorded');
select throws_ok($$select create_payment('03492000-0000-0000-0000-000000000112',null,'PAY-2','Scheduled','2026-10-02',111)$$,
  '23514','scheduled payments cannot exceed the billed gross amount','AC-SEC-217: scheduled payments cannot exceed the live bill gross');
select lives_ok($$select create_payment('03492000-0000-0000-0000-000000000112',null,'PAY-3','Scheduled','2026-10-02',110)$$,
  'AC-SEC-217: scheduled payments may reach exactly the live bill gross');
reset role;
select is((select billed_net from procurement_payment_within_ceiling('03492000-0000-0000-0000-000000000112')),1000::numeric,
  'AC-SEC-209: a cancelled bill without a replacement is not counted');

set local role authenticated;
set local request.jwt.claims='{"sub":"03492000-0000-0000-0000-000000000019","role":"authenticated"}';
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000000103',1200), null::text, 'cross-organization amount eligibility reveals no detail');
select is(public.procurement_amount_eligibility('03492000-0000-0000-0000-000000009999',1200), null::text, 'missing amount eligibility reveals no detail');
reset role;
select ok(not has_function_privilege('anon','public.procurement_amount_eligibility(uuid,numeric)','EXECUTE'), 'anonymous callers cannot read amount eligibility');

select finish();
rollback;
