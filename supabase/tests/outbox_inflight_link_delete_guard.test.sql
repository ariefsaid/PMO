-- outbox_inflight_link_delete_guard.test.sql
-- Luna re-audit BLOCK #11 [pgTAP]: the cross-org link pre-flight is TOCTOU-prone — a linked
-- project/customer/invoice could be deleted between the pre-flight SELECT and the mirror insert,
-- after the ERP POST had already created real money.
--
-- 0109 §2 closes the window from the DB side: while an external money command naming a row is still
-- IN FLIGHT (outbox state not yet confirmed/failed), that row cannot be deleted. These proofs pin
-- both directions — the guard must block a delete during the window and must NOT become a permanent
-- lock once the command resolves.
begin;
select plan(7);

insert into organizations (id, name) values
  ('01191000-0000-0000-0000-000000000001','Luna B11 Org');
insert into auth.users (id, email) values
  ('01191000-0000-0000-0000-0000000000a1','b11-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01191000-0000-0000-0000-0000000000a1','01191000-0000-0000-0000-000000000001','B Admin','b11-admin@example.com','Admin','active');

insert into projects (id, org_id, name, status, project_manager_id) values
  ('01191000-0000-0000-0000-0000000b0001','01191000-0000-0000-0000-000000000001','B11 Project','Internal Project','01191000-0000-0000-0000-0000000000a1'),
  ('01191000-0000-0000-0000-0000000b0002','01191000-0000-0000-0000-000000000001','B11 Unreferenced','Internal Project','01191000-0000-0000-0000-0000000000a1');
insert into companies (id, org_id, name, type) values
  ('01191000-0000-0000-0000-0000000c0001','01191000-0000-0000-0000-000000000001','B11 Customer','Client');
insert into sales_invoices (id, org_id, customer_id, si_number, amount) values
  ('01191000-0000-0000-0000-0000000e0001','01191000-0000-0000-0000-000000000001','01191000-0000-0000-0000-0000000c0001','ACC-SINV-B11-0001',9000.00);

-- An IN-FLIGHT sales-invoice create: the ERP POST may already have minted the document, and the
-- mirror insert (which needs project_id + customer_id to resolve) has not landed yet.
insert into external_command_outbox
  (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
values
  ('01191000-0000-0000-0000-0000000a0001','01191000-0000-0000-0000-000000000001','revenue','pmo-si-1',
   '3f2504e0-4f89-41d3-9a0c-0305e82c3301','erpnext','create','committed',
   '{"erp_doc_kind":"sales-invoice","projectId":"01191000-0000-0000-0000-0000000b0001","customerId":"01191000-0000-0000-0000-0000000c0001"}'::jsonb);
-- An in-flight incoming-payment create naming the invoice above.
insert into external_command_outbox
  (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
values
  ('01191000-0000-0000-0000-0000000a0002','01191000-0000-0000-0000-000000000001','revenue','pmo-ip-1',
   '3f2504e0-4f89-41d3-9a0c-0305e82c3302','erpnext','create','pending',
   '{"erp_doc_kind":"incoming-payment","salesInvoiceId":"01191000-0000-0000-0000-0000000e0001"}'::jsonb);

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCK: deleting a row an in-flight money command names is refused.
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ delete from projects where id = '01191000-0000-0000-0000-0000000b0001' $$,
  '55006', null,
  'Luna B11 a project named by an in-flight (committed) money command cannot be deleted');
select throws_ok(
  $$ delete from companies where id = '01191000-0000-0000-0000-0000000c0001' $$,
  '55006', null,
  'Luna B11 a customer named by an in-flight money command cannot be deleted');
select throws_ok(
  $$ delete from sales_invoices where id = '01191000-0000-0000-0000-0000000e0001' $$,
  '55006', null,
  'Luna B11 a sales invoice named by an in-flight (pending) money command cannot be deleted');

-- ════════════════════════════════════════════════════════════════════════════
-- ALLOW: an unrelated row is unaffected — the guard is not a blanket delete lock.
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ delete from projects where id = '01191000-0000-0000-0000-0000000b0002' $$,
  'Luna B11 a project no in-flight command names is still deletable');

-- ════════════════════════════════════════════════════════════════════════════
-- RELEASE: once the command RESOLVES the guard lifts — it is a window, not a permanent lock.
-- 'confirmed' = fully mirrored; 'failed' = never committed to ERP. Both hold no claim.
-- ════════════════════════════════════════════════════════════════════════════
update external_command_outbox set state = 'confirmed' where id = '01191000-0000-0000-0000-0000000a0001';
select lives_ok(
  $$ delete from projects where id = '01191000-0000-0000-0000-0000000b0001' $$,
  'Luna B11 a CONFIRMED command releases its project (the guard is a window, not a permanent lock)');

update external_command_outbox set state = 'failed' where id = '01191000-0000-0000-0000-0000000a0002';
select lives_ok(
  $$ delete from sales_invoices where id = '01191000-0000-0000-0000-0000000e0001' $$,
  'Luna B11 a FAILED command releases its sales invoice');

-- A 'held' (operator-resolution) command still holds its claim: the PE may yet be found and mirrored.
update external_command_outbox set state = 'held',
  payload = '{"erp_doc_kind":"incoming-payment","customerId":"01191000-0000-0000-0000-0000000c0001"}'::jsonb
  where id = '01191000-0000-0000-0000-0000000a0002';
select throws_ok(
  $$ delete from companies where id = '01191000-0000-0000-0000-0000000c0001' $$,
  '55006', null,
  'Luna B11 a HELD command still blocks — an unresolved payment entry may still need the link');

select * from finish();
rollback;
