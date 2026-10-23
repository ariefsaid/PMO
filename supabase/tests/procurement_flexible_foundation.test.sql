-- procurement_flexible_foundation.test.sql — 0360 (spec procurement-flexible-entry). AC-PFE-003 (defaults), AC-PFE-012, AC-PFE-016 (link table RLS).
begin;
select plan(14);

-- AC-PFE-012: nothing is derived by the migration or the seed.
select is((select count(*) from procurement_status_events where notes like 'Derived:%'), 0::bigint,
  'AC-PFE-012 no status was derived by migrating or seeding');

insert into organizations (id, name, default_currency) values
  ('03600000-0000-0000-0000-00000000000a','PFE0 A','IDR'), ('03600000-0000-0000-0000-00000000000b','PFE0 B','IDR');
insert into auth.users (id, email) values
  ('03600000-0000-0000-0000-0000000000a1','pfe0-admin@example.com'),
  ('03600000-0000-0000-0000-0000000000a2','pfe0-fin@example.com'),
  ('03600000-0000-0000-0000-0000000000b1','pfe0-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03600000-0000-0000-0000-0000000000a1','03600000-0000-0000-0000-00000000000a','PFE0 Admin','pfe0-admin@example.com','Admin','active'),
  ('03600000-0000-0000-0000-0000000000a2','03600000-0000-0000-0000-00000000000a','PFE0 Fin','pfe0-fin@example.com','Finance','active'),
  ('03600000-0000-0000-0000-0000000000b1','03600000-0000-0000-0000-00000000000b','PFE0 B','pfe0-b@example.com','Finance','active');

select has_table('public','procurement_erp_links','link table exists');
select col_is_unique('public','procurement_erp_links', array['erp_purchase_document_id'], 'FR-PFE-021 one purchase per ERP document');
select has_column('public','erp_purchase_documents','net_total','mirror carries net_total');
select lives_ok($$ insert into erp_purchase_documents (org_id, erp_doctype, erp_name, erp_docstatus, erp_modified)
                   values ('03600000-0000-0000-0000-00000000000a','Payment Entry','PE-0',1,'2026-01-01'),
                          ('03600000-0000-0000-0000-00000000000a','Purchase Receipt','PR-0',1,'2026-01-01') $$,
  'FR-PFE-040 the mirror accepts Purchase Receipts and Payment Entries');
select is(procurement_step_rank('Paid'), 8, 'step rank: Paid is furthest');
select is(procurement_step_rank('Cancelled'), -1, 'step rank: Cancelled is unranked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03600000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(get_procurement_gates(),
  '{"request_before_order":false,"approval_before_order":false,"approval_before_payment":false,"receipt_before_invoice":false}'::jsonb,
  'AC-PFE-003 every gate is OFF by default');
select throws_ok($$ select set_procurement_gates('{"approval_before_payment":true}') $$, '42501', null,
  'FR-PFE-011 only an Admin changes purchase rules');
select throws_ok($$ insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
                    values ('03600000-0000-0000-0000-00000000000a', gen_random_uuid(), gen_random_uuid()) $$, '42501', null,
  'NFR-PFE-012 no client writes links directly');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03600000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(set_procurement_gates('{"approval_before_payment":true}') ->> 'approval_before_payment', 'true',
  'FR-PFE-011 an Admin turns a gate on');
select throws_ok($$ select set_procurement_gates('{"approval_before_lunch":true}') $$, '22023', null,
  'FR-PFE-011 unknown gate keys are refused');
select throws_ok($$ select set_procurement_gates('{"approval_before_order":"yes"}') $$, '22023', null,
  'FR-PFE-011 non-boolean gate values are refused');
reset role;
select ok(exists (select 1 from audit_events where action = 'organization.procurement_gates'
                   and org_id = '03600000-0000-0000-0000-00000000000a'), 'FR-PFE-011 a gate change is audited');

select * from finish();
rollback;
