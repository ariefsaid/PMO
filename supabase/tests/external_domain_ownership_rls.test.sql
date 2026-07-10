-- external_domain_ownership_rls.test.sql
-- AC-EAS-010 [pgTAP]: a fresh org with no config ⇒ 0 rows (default empty; all domains PMO-owned).
-- AC-EAS-011 [pgTAP]: org isolation — org B member reads nothing of org A's rows.
-- AC-EAS-012 [pgTAP]: Operator-only write — non-Operator INSERT denied (42501); a spoofed cross-org
--                     org_id write denied (42501); Operator writes via operator_set_domain_ownership;
--                     a direct Operator insert stamps org_id server-side (column default).
begin;
select plan(7);

insert into organizations (id, name) values
  ('00850000-0000-0000-0000-000000000001','AC-EAS Org A'),
  ('00850000-0000-0000-0000-000000000002','AC-EAS Org B');
insert into auth.users (id, email) values
  ('00850000-0000-0000-0000-0000000000a1','eas-a-member@example.com'),
  ('00850000-0000-0000-0000-0000000000b1','eas-b-member@example.com'),
  ('00850000-0000-0000-0000-0000000000f1','eas-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00850000-0000-0000-0000-0000000000a1','00850000-0000-0000-0000-000000000001','A Member','eas-a-member@example.com','Admin','active'),
  ('00850000-0000-0000-0000-0000000000b1','00850000-0000-0000-0000-000000000002','B Member','eas-b-member@example.com','Admin','active'),
  ('00850000-0000-0000-0000-0000000000f1','00850000-0000-0000-0000-000000000001','Operator','eas-operator@example.com','Admin','active');
insert into platform_operators (user_id) values ('00850000-0000-0000-0000-0000000000f1');

-- AC-EAS-010: fresh org B (no config) ⇒ 0 rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00850000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from external_domain_ownership), 0,
  'AC-EAS-010 fresh org reads 0 ownership rows (default empty)');

-- Seed an org-A row AS OWNER (bypasses RLS) for the isolation + write tests.
reset role;
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00850000-0000-0000-0000-000000000001','reference','reference');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00850000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- AC-EAS-011: org-B member still reads 0 (org-A row invisible cross-org).
select is((select count(*)::int from external_domain_ownership), 0,
  'AC-EAS-011 org-B member reads nothing of org-A ownership (org isolation)');
-- org-A member reads the 1 own-org row.
set local request.jwt.claims = '{"sub":"00850000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from external_domain_ownership), 1,
  'AC-EAS-011 org-A member reads own-org ownership row');

-- AC-EAS-012(a): non-Operator (org-A Admin) INSERT denied (42501 — no matching Operator policy).
select throws_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('00850000-0000-0000-0000-000000000001','reference','tasks') $$,
  '42501', null,
  'AC-EAS-012 non-Operator INSERT denied (Operator-only)');
-- AC-EAS-012(b): spoofed cross-org org_id by a non-Operator also denied (42501).
select throws_ok(
  $$ insert into external_domain_ownership (org_id, external_tier, domain) values ('00850000-0000-0000-0000-000000000002','reference','reference') $$,
  '42501', null,
  'AC-EAS-012 spoofed cross-org org_id INSERT denied');

-- Operator provisions org B (cross-org) via the RPC; then an owner-path insert under the
-- Operator JWT proves the org_id column default stamps from auth context without any client write grant.
set local request.jwt.claims = '{"sub":"00850000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select operator_set_domain_ownership('00850000-0000-0000-0000-000000000002','reference','reference','employ') $$,
  'AC-EAS-012 Operator cross-org employ via RPC succeeds');
reset role;
insert into external_domain_ownership (external_tier, domain) values ('reference','tasks')
  returning org_id;
select is((select org_id from external_domain_ownership where external_tier='reference' and domain='tasks'),
  '00850000-0000-0000-0000-000000000001'::uuid,
  'AC-EAS-012 owner-path insert under Operator JWT stamps own org_id server-side (column default)');

select finish();
rollback;
