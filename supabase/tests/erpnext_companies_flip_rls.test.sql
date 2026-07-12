-- erpnext_companies_flip_rls.test.sql
-- The spec §7-mandated per-table proof for the parties flip: `companies` + `contacts`
-- (task 3.4, migration 0096). REFERENCES AC-ENA-072 (money-flip RLS — owned by slice 6's
-- erpnext_money_flip_rls.test.sql) and AC-ENA-003 (org-scoped procurement flip — owned by slice 4's
-- erpnext_procurement_flip_rls.test.sql); this file does NOT own either AC — it is the §7 per-table
-- proof for the parties tables only.
--
-- Asserts (spec §7 row for companies/contacts, FR-ENA-090/091/095):
--   companies: org-A user-JWT INSERT/UPDATE of a native mirror col (name/type/erp_supplier_name/
--   erp_customer_name/erp_tax_id/erp_payment_terms_days) -> 42501; org-A service-role write ->
--   lives_ok; org-A user UPDATE of archived_at (enhancement) -> lives_ok; an Internal-type row is
--   NEVER flipped (user write still lives_ok even while the org's companies domain is externally-owned);
--   org-B (not flipped) user native write -> lives_ok (byte-for-byte).
--   contacts: native (full_name/email/phone) user write -> 42501; enhancement (title/notes/archived_at)
--   user write -> lives_ok (contacts ride the companies domain flip — FR-ENA-095, no separate 'contacts'
--   domain).
begin;
select plan(18);

insert into organizations (id, name) values
  ('00960000-0000-0000-0000-000000000001','AC-ENA Parties Org A (flipped)'),
  ('00960000-0000-0000-0000-000000000002','AC-ENA Parties Org B (PMO-owned)');

insert into auth.users (id, email) values
  ('00960000-0000-0000-0000-0000000000a1','parties-a-manager@example.com'),
  ('00960000-0000-0000-0000-0000000000b1','parties-b-manager@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('00960000-0000-0000-0000-0000000000a1','00960000-0000-0000-0000-000000000001','Org A Manager','parties-a-manager@example.com','Project Manager','active'),
  ('00960000-0000-0000-0000-0000000000b1','00960000-0000-0000-0000-000000000002','Org B Manager','parties-b-manager@example.com','Project Manager','active');

reset role;
insert into companies (id, org_id, name, type, erp_party_type, erp_supplier_name, erp_tax_id) values
  ('00960000-0000-0000-0000-000000000101','00960000-0000-0000-0000-000000000001','Acme Vendor Co','Vendor','Vendor','Acme Vendor Co','TAX-1'),
  ('00960000-0000-0000-0000-000000000102','00960000-0000-0000-0000-000000000001','Org A Internal','Internal',null,null,null),
  ('00960000-0000-0000-0000-000000000201','00960000-0000-0000-0000-000000000002','Org B Native Vendor','Vendor',null,null,null);

insert into contacts (id, org_id, company_id, full_name, email, phone) values
  ('00960000-0000-0000-0000-000000000111','00960000-0000-0000-0000-000000000001','00960000-0000-0000-0000-000000000101','Jane Doe','jane@acme.test','+62-800');

insert into external_domain_ownership (org_id, external_tier, domain)
values ('00960000-0000-0000-0000-000000000001','erpnext','companies');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── companies: native writes denied while flipped ──
select throws_ok(
  $$ insert into companies (org_id, name, type)
     values ('00960000-0000-0000-0000-000000000001','Denied Insert Co','Vendor') $$,
  '42501', null,
  'companies: user-JWT INSERT denied while companies externally-owned');
select throws_ok(
  $$ update companies set name = 'Renamed' where id = '00960000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'companies: user-JWT UPDATE of native col name denied while externally-owned');
select throws_ok(
  $$ update companies set type = 'Client' where id = '00960000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'companies: user-JWT UPDATE of native col type denied while externally-owned');
select throws_ok(
  $$ update companies set erp_supplier_name = 'Hacked' where id = '00960000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'companies: user-JWT UPDATE of native col erp_supplier_name denied while externally-owned');
select throws_ok(
  $$ update companies set erp_customer_name = 'Hacked' where id = '00960000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'companies: user-JWT UPDATE of native col erp_customer_name denied while externally-owned');
select throws_ok(
  $$ update companies set erp_tax_id = 'HACKED' where id = '00960000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'companies: user-JWT UPDATE of native col erp_tax_id denied while externally-owned');
select throws_ok(
  $$ update companies set erp_payment_terms_days = 999 where id = '00960000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'companies: user-JWT UPDATE of native col erp_payment_terms_days denied while externally-owned');

-- enhancement column stays user-writable while flipped
select lives_ok(
  $$ update companies set archived_at = now() where id = '00960000-0000-0000-0000-000000000101' $$,
  'companies: user-JWT UPDATE of enhancement col archived_at lives while externally-owned');
update companies set archived_at = null where id = '00960000-0000-0000-0000-000000000101';

-- Internal-type row is NEVER ERP-flipped (FR-ENA-090/091) — native-field write still lives.
select lives_ok(
  $$ update companies set name = 'Org A Internal Renamed' where id = '00960000-0000-0000-0000-000000000102' $$,
  'companies: Internal-type row user native-field UPDATE lives even while companies externally-owned');

-- ── contacts: ride the companies domain flip (no separate 'contacts' domain, FR-ENA-095) ──
select throws_ok(
  $$ update contacts set full_name = 'Hacked Name' where id = '00960000-0000-0000-0000-000000000111' $$,
  '42501', null,
  'contacts: user-JWT UPDATE of native col full_name denied while parent companies domain externally-owned');
select throws_ok(
  $$ update contacts set email = 'hacked@example.com' where id = '00960000-0000-0000-0000-000000000111' $$,
  '42501', null,
  'contacts: user-JWT UPDATE of native col email denied while parent companies domain externally-owned');
select throws_ok(
  $$ update contacts set phone = '+00-000' where id = '00960000-0000-0000-0000-000000000111' $$,
  '42501', null,
  'contacts: user-JWT UPDATE of native col phone denied while parent companies domain externally-owned');
select lives_ok(
  $$ update contacts set title = 'CFO', notes = 'met at trade show', archived_at = now()
      where id = '00960000-0000-0000-0000-000000000111' $$,
  'contacts: user-JWT UPDATE of enhancement cols (title/notes/archived_at) lives while externally-owned');
update contacts set archived_at = null where id = '00960000-0000-0000-0000-000000000111';
-- M-2 (audit): a user-JWT INSERT of a contact mirror row is DENIED while the parent companies domain
-- is externally-owned (an ERP Contact is machine-written via service_role) — closes the hole.
select throws_ok(
  $$ insert into contacts (org_id, company_id, full_name)
       values ('00960000-0000-0000-0000-000000000001','00960000-0000-0000-0000-000000000101','Smuggled Contact') $$,
  '42501', null,
  'contacts: user-JWT INSERT denied while parent companies domain externally-owned (M-2)');

-- ── service-role mirror writes bypass the native-column pin only for a flipped org ──
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update companies set name = 'Acme Vendor Co (mirrored)', erp_supplier_name = 'Acme Vendor Co (mirrored)'
      where id = '00960000-0000-0000-0000-000000000101' $$,
  'companies: service-role native-field UPDATE lives for a flipped org');
select lives_ok(
  $$ insert into companies (id, org_id, name, type, erp_party_type, erp_customer_name)
       values ('00960000-0000-0000-0000-000000000103','00960000-0000-0000-0000-000000000001','Acme Customer Co','Client','Client','Acme Customer Co') $$,
  'companies: service-role INSERT lives for a flipped org');

-- ── org B (not flipped) stays byte-for-byte ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00960000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$ update companies set name = 'Org B Native Vendor Updated' where id = '00960000-0000-0000-0000-000000000201' $$,
  'companies: org-B (not flipped) user native-field UPDATE lives (byte-for-byte)');
select lives_ok(
  $$ insert into companies (org_id, name, type)
       values ('00960000-0000-0000-0000-000000000002','Org B New Native Co','Vendor') $$,
  'companies: org-B (not flipped) user INSERT lives (byte-for-byte)');

select finish();
rollback;
