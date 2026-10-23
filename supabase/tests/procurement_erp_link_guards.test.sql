-- procurement_erp_link_guards.test.sql — 0361 review fixes: approved-amount ceiling counts linked invoices (I-1),
-- an invoice stays with its ERP order's purchase (I-2), no project-less invoice on a project purchase (I-3),
-- re-runs keep a group in one purchase (FR-PFE-028), cancelled documents stop counting (M-1), late PMO pushes
-- are refused (M-2), reasons are codes (M-6).
begin;
select plan(14);

insert into organizations (id, name, default_currency) values ('03640000-0000-0000-0000-00000000000a','PFG A','IDR');
insert into auth.users (id, email) values
  ('03640000-0000-0000-0000-0000000000a1','pfg-fin1@example.com'), ('03640000-0000-0000-0000-0000000000a2','pfg-fin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-00000000000a','Fin One','pfg-fin1@example.com','Finance','active'),
  ('03640000-0000-0000-0000-0000000000a2','03640000-0000-0000-0000-00000000000a','Fin Two','pfg-fin2@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03640000-0000-0000-0000-0000000000d1','03640000-0000-0000-0000-00000000000a','PFG P1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03640000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03640000-0000-0000-0000-0000000000d1":"ERP-A"}}'::jsonb, now(), 'active');
select upsert_erp_purchase_documents('03640000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Order","erp_name":"PO-A","supplier":"SUP-1","currency":"IDR","grand_total":555,"net_total":500,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-A","supplier":"SUP-1","currency":"IDR","grand_total":555,"net_total":500,"erp_docstatus":1,"erp_project":"ERP-A","purchase_orders":["PO-A"],"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-B","supplier":"SUP-1","currency":"IDR","grand_total":555,"net_total":500,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-B","supplier":"SUP-1","currency":"IDR","grand_total":555,"net_total":500,"erp_docstatus":1,"erp_project":"ERP-A","purchase_orders":["PO-B"],"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-NP","supplier":"SUP-1","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-CEIL","supplier":"SUP-1","currency":"IDR","grand_total":666,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-PUSHED","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-CXL","supplier":"SUP-1","currency":"IDR","grand_total":333,"net_total":300,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Payment Entry","erp_name":"PE-X","supplier":"SUP-1","currency":"IDR","grand_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"X1","supplier":"SUP-1","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"X2","supplier":"SUP-1","currency":"IDR","grand_total":20,"net_total":20,"erp_docstatus":1,"erp_modified":"2026-02-01"}
]$$::jsonb);
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status, approved_by_id, approved_total_value) values
  ('03640000-0000-0000-0000-0000000000e1','03640000-0000-0000-0000-00000000000a','A1','03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-0000000000d1','IDR',500,'Ordered',null,null),
  ('03640000-0000-0000-0000-0000000000e2','03640000-0000-0000-0000-00000000000a','A2','03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-0000000000d1','IDR',500,'Ordered',null,null),
  ('03640000-0000-0000-0000-0000000000e3','03640000-0000-0000-0000-00000000000a','B1','03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-0000000000d1','IDR',500,'Ordered',null,null),
  ('03640000-0000-0000-0000-0000000000e4','03640000-0000-0000-0000-00000000000a','B2','03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-0000000000d1','IDR',500,'Ordered',null,null),
  ('03640000-0000-0000-0000-0000000000e5','03640000-0000-0000-0000-00000000000a','NP','03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-0000000000d1','IDR',100,'Ordered',null,null),
  ('03640000-0000-0000-0000-0000000000e6','03640000-0000-0000-0000-00000000000a','CEIL','03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-0000000000d1','IDR',500,'Ordered','03640000-0000-0000-0000-0000000000a2',500),
  ('03640000-0000-0000-0000-0000000000e7','03640000-0000-0000-0000-00000000000a','PAY','03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-0000000000d1','IDR',100,'Vendor Invoiced',null,null);
-- PINV-PUSHED is pushed by PMO after the last mirror sweep: its pmo_owned stamp is still false.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03640000-0000-0000-0000-00000000000a','procurement','pmo-late','erpnext','PINV-PUSHED');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- I-2 order first, then its invoice.
select is(link_erp_purchase_documents('[{"erp_name":"PO-A","procurement_id":"03640000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link', 'fixture: ERP order linked to A1');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-A","procurement_id":"03640000-0000-0000-0000-0000000000e2"}]') #>> '{results,0,reason}',
  'order_linked_to_another_purchase', 'I-2 an invoice cannot join a purchase other than its ERP order''s');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-A","procurement_id":"03640000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link', 'I-2 the invoice joins its order''s purchase');
-- I-2 invoice first, then its order.
select is(link_erp_purchase_documents('[{"erp_name":"PINV-B","procurement_id":"03640000-0000-0000-0000-0000000000e3"},{"erp_name":"PO-B","procurement_id":"03640000-0000-0000-0000-0000000000e4"}]') #>> '{results,1,reason}',
  'invoice_linked_to_another_purchase', 'I-2 an order cannot join a purchase other than the one holding its invoice');
-- I-3.
select is(link_erp_purchase_documents('[{"erp_name":"PINV-NP","procurement_id":"03640000-0000-0000-0000-0000000000e5"}]') #>> '{results,0,reason}',
  'document_has_no_project', 'I-3 an invoice with no ERP project is refused on a project purchase');
-- I-1.
select is(link_erp_purchase_documents('[{"erp_name":"PINV-CEIL","procurement_id":"03640000-0000-0000-0000-0000000000e6"}]') #>> '{results,0,outcome}', 'link', 'fixture: 600 invoice linked to a 500-approved purchase');
reset role;
select is((select ok from procurement_payment_within_ceiling('03640000-0000-0000-0000-0000000000e6')), false,
  'I-1 a linked ERP invoice over the approved amount fails the payment ceiling');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- M-6: a guard refusal is reported as a code, not raw error text.
select is(link_erp_purchase_documents('[{"erp_name":"PE-X","procurement_id":"03640000-0000-0000-0000-0000000000e7"}]') #>> '{results,0,reason}',
  'approval_missing', 'M-6 a payment without a recorded approval is refused with a reason code');
-- M-2.
select is(link_erp_purchase_documents('[{"erp_name":"PINV-PUSHED","procurement_id":"03640000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}',
  'document_recorded_by_pmo', 'M-2 a document PMO pushed after the last sweep is refused');
-- FR-PFE-028: run 1 links X1 and refuses X2 (no ERP project yet).
select is(link_erp_purchase_documents('[{"erp_name":"X1","project_id":"03640000-0000-0000-0000-0000000000d1","group":"G"},{"erp_name":"X2","project_id":"03640000-0000-0000-0000-0000000000d1","group":"G"}]') #>> '{results,1,reason}',
  'document_has_no_project', 'FR-PFE-028 run 1 refuses the second row of the group');
-- M-1 fixture: a new purchase from one invoice.
select set_config('pfg.cxl', link_erp_purchase_documents('[{"erp_name":"PINV-CXL","project_id":"03640000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,procurement_id}', true);
reset role;
-- The operator fixes X2 in ERPNext (project set); ERPNext cancels PINV-CXL. The mirror picks both up.
select upsert_erp_purchase_documents('03640000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"X2","supplier":"SUP-1","currency":"IDR","grand_total":20,"net_total":20,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-03-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-CXL","supplier":"SUP-1","currency":"IDR","grand_total":333,"net_total":300,"erp_docstatus":2,"erp_project":"ERP-A","erp_modified":"2026-03-01"}
]$$::jsonb);
select is((select total_value from procurements where id = current_setting('pfg.cxl')::uuid), 0::numeric(14,2),
  'M-1 a cancelled linked document stops counting in its purchase''s total');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"X1","project_id":"03640000-0000-0000-0000-0000000000d1","group":"G"},{"erp_name":"X2","project_id":"03640000-0000-0000-0000-0000000000d1","group":"G"}]') #>> '{results,1,outcome}',
  'link', 'FR-PFE-028 run 2 links the fixed row');
reset role;
select is((select count(distinct l.procurement_id) from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
            where d.erp_name in ('X1','X2') and d.org_id = '03640000-0000-0000-0000-00000000000a'), 1::bigint,
  'FR-PFE-028 a re-run keeps the group in ONE purchase');
select is((select total_value from procurements p where p.id = (select l.procurement_id from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
            where d.erp_name = 'X1' and d.org_id = '03640000-0000-0000-0000-00000000000a')), 30::numeric(14,2),
  'FR-PFE-028 the group''s purchase total covers both invoices');

select * from finish();
rollback;
