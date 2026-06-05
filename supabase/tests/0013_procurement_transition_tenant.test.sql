-- 0013_procurement_transition_tenant.test.sql
-- AC-807: cross-org transition raises 42501 (tenant isolation inside the RPC).
-- The security-definer transition_procurement re-asserts auth_org_id() internally,
-- so an org-A user cannot transition an org-B procurement even though definer bypasses RLS.
begin;
select plan(1);

-- Fixtures: two orgs, one user each, one procurement per org (inserted as table owner).
insert into organizations (id, name) values
  ('00130000-0000-0000-0000-000000000001','Proc Tenant A'),
  ('00130000-0000-0000-0000-000000000002','Proc Tenant B');

insert into auth.users (id, email) values
  ('00130000-0000-0000-0000-0000000000a1','pm-ta@example.com'),
  ('00130000-0000-0000-0000-0000000000b1','pm-tb@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00130000-0000-0000-0000-0000000000a1','00130000-0000-0000-0000-000000000001','PM Tenant A','pm-ta@example.com','Project Manager'),
  ('00130000-0000-0000-0000-0000000000b1','00130000-0000-0000-0000-000000000002','PM Tenant B','pm-tb@example.com','Project Manager');

-- Org-B procurement in Draft (target for org-A's cross-org attempt).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00130000-0000-0000-0000-000000000010','00130000-0000-0000-0000-000000000002',
   'Proc Tenant B Draft','Draft','00130000-0000-0000-0000-0000000000b1');

-- Become org-A user (PM, authorized for transitions in general).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00130000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-807: org-A user calling transition_procurement on an org-B procurement → 42501.
select throws_ok(
  $$ select transition_procurement('00130000-0000-0000-0000-000000000010','Requested') $$,
  '42501', null,
  'AC-807: cross-org transition raises 42501 (tenant isolation inside RPC)');

reset role;
select * from finish();
rollback;
