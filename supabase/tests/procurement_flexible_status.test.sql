-- procurement_flexible_status.test.sql — 0362. Owns AC-PFE-002, AC-PFE-003, AC-PFE-007, AC-PFE-012, AC-PFE-013.
begin;
select plan(44);
select is((select count(*) from procurement_status_events where notes like 'Derived:%'), 0::bigint, 'AC-PFE-012 nothing pre-existing was derived');

insert into organizations (id, name, default_currency) values ('03620000-0000-0000-0000-0000000000f0','PFS','IDR');
insert into auth.users (id, email) values
  ('03620000-0000-0000-0000-0000000000f1','pfs-req@example.com'), ('03620000-0000-0000-0000-0000000000f2','pfs-fin1@example.com'),
  ('03620000-0000-0000-0000-0000000000f3','pfs-fin2@example.com'), ('03620000-0000-0000-0000-0000000000f4','pfs-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03620000-0000-0000-0000-0000000000f1','03620000-0000-0000-0000-0000000000f0','Req','pfs-req@example.com','Project Manager','active'),
  ('03620000-0000-0000-0000-0000000000f2','03620000-0000-0000-0000-0000000000f0','Fin1','pfs-fin1@example.com','Finance','active'),
  ('03620000-0000-0000-0000-0000000000f3','03620000-0000-0000-0000-0000000000f0','Fin2','pfs-fin2@example.com','Finance','active'),
  ('03620000-0000-0000-0000-0000000000f4','03620000-0000-0000-0000-0000000000f0','Admin','pfs-admin@example.com','Admin','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, approved_by_id, approved_total_value) values
  ('03620000-0000-0000-0000-000000000a01','03620000-0000-0000-0000-0000000000f0','D1','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a02','03620000-0000-0000-0000-0000000000f0','D2','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a03','03620000-0000-0000-0000-0000000000f0','D3','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a04','03620000-0000-0000-0000-0000000000f0','D4','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a05','03620000-0000-0000-0000-0000000000f0','D5','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','O6','03620000-0000-0000-0000-0000000000f1','IDR',100,'Ordered',null,null),
  ('03620000-0000-0000-0000-000000000a07','03620000-0000-0000-0000-0000000000f0','D7','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','M8','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a09','03620000-0000-0000-0000-0000000000f0','A9','03620000-0000-0000-0000-0000000000f1','IDR',100,'Vendor Invoiced','03620000-0000-0000-0000-0000000000f2',100),
  ('03620000-0000-0000-0000-000000000a10','03620000-0000-0000-0000-0000000000f0','S10','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a11','03620000-0000-0000-0000-0000000000f0','R11','03620000-0000-0000-0000-0000000000f1','IDR',100,'Received',null,null);

-- User writes (claims set, role stays postgres so fixtures bypass grants): evidence derives status.
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03620000-0000-0000-0000-000000000a01','03620000-0000-0000-0000-0000000000f0','Received',100,'IDR','exclusive',0);
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a01'), 'Vendor Invoiced', 'AC-PFE-002 an invoice on a Draft purchase derives Vendor Invoiced');
insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a01','03620000-0000-0000-0000-0000000000f0','Issued');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a01'), 'Vendor Invoiced', 'AC-PFE-002 a later order never moves status back');
select is((select count(*) from procurement_status_events where procurement_id = '03620000-0000-0000-0000-000000000a01' and notes like 'Derived:%'), 1::bigint, 'FR-PFE-007 one derived event');
-- AC-PFE-007 many documents per step.
insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Issued'), ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Issued');
insert into procurement_receipts (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Partial'), ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Partial');
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Received',50,'IDR','exclusive',0), ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Received',50,'IDR','exclusive',0);
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a08'), 'Vendor Invoiced', 'AC-PFE-007 furthest of many documents');
insert into payments (procurement_id, org_id, status, amount) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Paid',100);
select results_eq($$ select (select status::text from procurements where id = '03620000-0000-0000-0000-000000000a08'),
  (select count(*)::int from purchase_orders where procurement_id = '03620000-0000-0000-0000-000000000a08'),
  (select count(*)::int from procurement_receipts where procurement_id = '03620000-0000-0000-0000-000000000a08'),
  (select count(*)::int from procurement_invoices where procurement_id = '03620000-0000-0000-0000-000000000a08') $$,
  $$ values ('Paid', 2, 2, 2) $$, 'AC-PFE-007 a paid payment derives Paid and every document stays attached');
-- FR-PFE-003: evidence ranked below the current status never lowers it (a Received purchase gets its order late).
insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a11','03620000-0000-0000-0000-0000000000f0','Issued');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a11'), 'Received', 'FR-PFE-003 an order recorded on a Received purchase never moves it back to Ordered');
reset request.jwt.claims;

-- Direct SQL (seed/migration/fixture) never derives (NFR-PFE-010).
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03620000-0000-0000-0000-000000000a10','03620000-0000-0000-0000-0000000000f0','Received',50,'IDR','exclusive',0);
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a10'), 'Draft', 'NFR-PFE-010 a direct SQL write derives nothing');

-- Transition RPC: forward skip + idempotence (FR-PFE-005/006).
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a02','Paid') $$, 'FR-PFE-005 Finance pays a Draft purchase with gates off');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a02'), 'Paid', 'FR-PFE-005 status Paid');
select lives_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a01','Vendor Invoiced') $$, 'FR-PFE-006 requesting a held document step is a no-op');
reset role;

-- Gates (AC-PFE-003): each ON refuses on the transition and on the record insert.
update organizations set procurement_gates = '{"approval_before_order":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a03','Ordered') $$, '23514', null, 'AC-PFE-003 approval_before_order refuses the transition');
reset role;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a03','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  '23514', 'Your organization requires an approval before an order.', 'AC-PFE-003 approval_before_order refuses the record');
reset request.jwt.claims;
update organizations set procurement_gates = '{"request_before_order":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a04','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  '23514', null, 'AC-PFE-003 request_before_order refuses an order without a request');
insert into purchase_requests (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a05','03620000-0000-0000-0000-0000000000f0','Submitted');
select lives_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a05','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  'AC-PFE-003 request_before_order allows an order once a request exists');
reset request.jwt.claims;
update organizations set procurement_gates = '{"receipt_before_invoice":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','Received',1,'IDR','exclusive',0) $$,
  '23514', null, 'AC-PFE-003 receipt_before_invoice refuses an invoice before a receipt');
insert into procurement_receipts (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','Complete');
select lives_ok($$ insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','Received',1,'IDR','exclusive',0) $$,
  'AC-PFE-003 receipt_before_invoice allows the invoice after a receipt');
reset request.jwt.claims;
update organizations set procurement_gates = '{"approval_before_payment":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a07','Paid') $$, '23514', null, 'AC-PFE-003 approval_before_payment refuses paying an unapproved purchase');
reset role;
update organizations set procurement_gates = '{}' where id = '03620000-0000-0000-0000-0000000000f0';

-- SoD (AC-PFE-013): approver ≠ payer on every path to Paid.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a09','Paid') $$, '42501', null, 'AC-PFE-013 the approver cannot pay by transition');
reset role;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into payments (procurement_id, org_id, status, amount) values ('03620000-0000-0000-0000-000000000a09','03620000-0000-0000-0000-0000000000f0','Paid',100) $$,
  '42501', null, 'AC-PFE-013 the approver cannot pay by recording a paid payment');
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a09','Paid') $$, 'AC-PFE-013 a different Finance member pays');
reset role;

-- Machine writer (ERP mirror): a refused derivation keeps the record and audits (FR-PFE-008).
-- A10's bill (50, direct SQL above) exceeds its approved 10, so the 0349 ceiling refuses the derived Paid.
update procurements set status = 'Vendor Invoiced', approved_by_id = '03620000-0000-0000-0000-0000000000f2', approved_total_value = 10 where id = '03620000-0000-0000-0000-000000000a10';
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into payments (procurement_id, org_id, status, amount) values ('03620000-0000-0000-0000-000000000a10','03620000-0000-0000-0000-0000000000f0','Paid',100) $$,
  'FR-PFE-008 the mirror write is kept even when its derivation is refused');
reset request.jwt.claims;
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a10'), 'Vendor Invoiced', 'FR-PFE-008 status is left unchanged');
select ok(exists (select 1 from audit_events where action = 'procurement.derive_skipped' and entity_id = '03620000-0000-0000-0000-000000000a10'), 'FR-PFE-008 the skip is audited');

-- ════ Review round (0362): a pending or re-opened approval cannot be skipped; terminal purchases never derive. ════
insert into companies (id, org_id, name, type) values ('03620000-0000-0000-0000-0000000000c1','03620000-0000-0000-0000-0000000000f0','PFS Vendor','Vendor');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, approved_by_id, approved_total_value, pr_number, vendor_id, amount_approved_by_id) values
  ('03620000-0000-0000-0000-000000000a12','03620000-0000-0000-0000-0000000000f0','Q12','03620000-0000-0000-0000-0000000000f1','IDR',100,'Requested',null,null,'PR-12',null,null),
  ('03620000-0000-0000-0000-000000000a13','03620000-0000-0000-0000-0000000000f0','V13','03620000-0000-0000-0000-0000000000f1','IDR',100,'Vendor Quoted','03620000-0000-0000-0000-0000000000f4',100,'PR-13','03620000-0000-0000-0000-0000000000c1',null),
  ('03620000-0000-0000-0000-000000000a14','03620000-0000-0000-0000-0000000000f0','D14','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null,'PR-14',null,null),
  ('03620000-0000-0000-0000-000000000a15','03620000-0000-0000-0000-0000000000f0','D15','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null,null,null,null),
  ('03620000-0000-0000-0000-000000000a16','03620000-0000-0000-0000-0000000000f0','I16','03620000-0000-0000-0000-0000000000f1','IDR',100,'Vendor Invoiced','03620000-0000-0000-0000-0000000000f4',null,null,null,null),
  ('03620000-0000-0000-0000-000000000a17','03620000-0000-0000-0000-0000000000f0','I17','03620000-0000-0000-0000-0000000000f1','IDR',100,'Vendor Invoiced','03620000-0000-0000-0000-0000000000f4',100,null,null,'03620000-0000-0000-0000-0000000000f3'),
  ('03620000-0000-0000-0000-000000000a18','03620000-0000-0000-0000-0000000000f0','C18','03620000-0000-0000-0000-0000000000f1','IDR',100,'Cancelled',null,null,null,null,null),
  ('03620000-0000-0000-0000-000000000a19','03620000-0000-0000-0000-0000000000f0','R19','03620000-0000-0000-0000-0000000000f1','IDR',100,'Rejected',null,null,null,null,null),
  ('03620000-0000-0000-0000-000000000a20','03620000-0000-0000-0000-0000000000f0','R20','03620000-0000-0000-0000-0000000000f1','IDR',100,'Received',null,null,null,null,null);
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date, vq_number, is_selected) values
  ('03620000-0000-0000-0000-0000000000e1','03620000-0000-0000-0000-0000000000f0','03620000-0000-0000-0000-000000000a13','03620000-0000-0000-0000-0000000000c1',200,'2026-03-01','VQ-13',false);
insert into procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes) values ('03620000-0000-0000-0000-000000000a15','03620000-0000-0000-0000-0000000000f0','Draft','Requested','03620000-0000-0000-0000-0000000000f1','fixture: entered approval once');

select ok((select count(*) from pg_trigger t where not t.tgisinternal and t.tgfoid = 'public.lock_procurement_for_record()'::regprocedure
            and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
            and t.tgrelid in ('public.purchase_orders'::regclass,'public.procurement_receipts'::regclass,'public.procurement_invoices'::regclass,'public.payments'::regclass)) = 4,
  'M1 every document table locks its purchase BEFORE INSERT (ahead of the FK share lock)');

-- (a) Requested never derives: a user write is refused, the mirror write is kept and audited.
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a12','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  '23514', 'This purchase is awaiting approval. Record its documents after it is approved.', 'SoD recording an order on a purchase awaiting approval is refused');
reset request.jwt.claims;
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a12'), 'Requested', 'SoD the purchase stays Requested');
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values ('03620000-0000-0000-0000-000000000a12','03620000-0000-0000-0000-0000000000f0','Received',100,'IDR','exclusive',0) $$,
  'FR-PFE-008 the mirror''s invoice on a purchase awaiting approval is kept');
reset request.jwt.claims;
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a12'), 'Requested', 'SoD the mirror never derives a purchase awaiting approval');
select ok(exists (select 1 from audit_events where action = 'procurement.derive_skipped' and entity_id = '03620000-0000-0000-0000-000000000a12'), 'SoD the mirror skip is audited');
-- Linking an ERP document into a purchase awaiting approval is refused with a reason code, and links nothing.
insert into erp_purchase_documents (org_id, erp_doctype, erp_name, erp_docstatus, erp_modified, currency, supplier, supplier_name, grand_total, net_total)
values ('03620000-0000-0000-0000-0000000000f0','Purchase Order','PO-PFS-12',1,'2026-01-01','IDR','SUP-12','Supplier 12',100,100);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PO-PFS-12","procurement_id":"03620000-0000-0000-0000-000000000a12"}]') #>> '{results,0,reason}',
  'awaiting_approval', 'SoD linking an ERP order into a purchase awaiting approval is refused as awaiting_approval');
reset role;
select is((select status::text || '/' || (select count(*) from procurement_erp_links where procurement_id = '03620000-0000-0000-0000-000000000a12')::text
             from procurements where id = '03620000-0000-0000-0000-000000000a12'), 'Requested/0', 'SoD the refused link leaves the purchase Requested and unlinked');

-- Quote re-route: a quote above the approved amount sends the purchase back to Requested; no document skips it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select lives_ok($$ select select_procurement_quote('03620000-0000-0000-0000-0000000000e1') $$, 'reroute Finance selects the 200 quote on a 100 approval');
reset role;
select is((select status::text || '/' || coalesce(approved_by_id::text, 'null') || '/' || coalesce(approved_total_value::text, 'null') from procurements where id = '03620000-0000-0000-0000-000000000a13'),
  'Requested/null/null', 'reroute the purchase is back to Requested with its approval cleared');
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a13','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  '23514', 'This purchase is awaiting approval. Record its documents after it is approved.', 'reroute recording an order cannot skip the re-approval');
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a13','Paid') $$, 'P0001', null, 'reroute the re-opened purchase cannot be paid');

-- (b) Paid without an approved amount only for a purchase that never entered approval.
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a14','Paid') $$, '23514', 'Cannot pay without a recorded approved amount.',
  'FR-PFE-017 a purchase with a request number cannot be paid without an approved amount');
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a15','Paid') $$, '23514', 'Cannot pay without a recorded approved amount.',
  'FR-PFE-017 a purchase that once entered approval cannot be paid without an approved amount');
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a16','Paid') $$, '23514', 'Cannot pay without a recorded approved amount.',
  'FR-PFE-017 an approver but no approved amount refuses payment');
-- FR-PFE-016 guard-only: the transition checks only the request approver; the guard stops the amount approver.
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a17','Paid') $$, '42501', 'separation of duties: approver cannot pay own procurement',
  'FR-PFE-016 the approver of a raised amount cannot pay by transition');
reset role;

-- FR-PFE-004: a Cancelled or Rejected purchase never derives.
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency, tax_treatment, tax_amount) values
  ('03620000-0000-0000-0000-000000000a18','03620000-0000-0000-0000-0000000000f0','Received',1,'IDR','exclusive',0), ('03620000-0000-0000-0000-000000000a19','03620000-0000-0000-0000-0000000000f0','Received',1,'IDR','exclusive',0);
reset request.jwt.claims;
select is((select string_agg(status::text, '/' order by title) from procurements where id in ('03620000-0000-0000-0000-000000000a18','03620000-0000-0000-0000-000000000a19')), 'Cancelled/Rejected',
  'FR-PFE-004 recording a document on a Cancelled or Rejected purchase derives nothing');

-- M4 / FR-PFE-006: a lower step the purchase holds evidence for is a no-op; without evidence it stays illegal.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a11','Ordered') $$, 'FR-PFE-006 Received with an order recorded: asking for Ordered is a no-op');
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a20','Ordered') $$, 'P0001', 'illegal transition Received -> Ordered',
  'FR-PFE-006 Received without an order: asking for Ordered is still illegal');
reset role;
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a11'), 'Received', 'FR-PFE-006 the no-op leaves the status');

select * from finish();
rollback;
