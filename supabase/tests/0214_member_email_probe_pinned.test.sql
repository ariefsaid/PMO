-- 0214_member_email_probe_pinned.test.sql — #627. The invite duplicate probe answers for the TARGET org
-- on the Operator branch too; assert_org_destroyable is no longer a member-callable oracle.
begin;
select plan(5);

insert into organizations (id, name) values
  ('02140000-0000-0000-0000-00000000000a','0214 Org A (operator home)'),
  ('02140000-0000-0000-0000-00000000000b','0214 Org B (target)');
insert into auth.users (id, email) values
  ('02140000-0000-0000-0000-0000000000a1','op-0214@example.com'),
  ('02140000-0000-0000-0000-0000000000a2','shared-0214@example.com'),
  ('02140000-0000-0000-0000-0000000000b1','only-b-0214@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02140000-0000-0000-0000-0000000000a1','02140000-0000-0000-0000-00000000000a','Op','op-0214@example.com','Admin','active'),
  ('02140000-0000-0000-0000-0000000000a2','02140000-0000-0000-0000-00000000000a','In A only','shared-0214@example.com','Engineer','active'),
  ('02140000-0000-0000-0000-0000000000b1','02140000-0000-0000-0000-00000000000b','In B','only-b-0214@example.com','Engineer','active');
insert into platform_operators (user_id) values ('02140000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02140000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-INV-020: an Operator probing org B for an email that lives only in org A gets FALSE (was TRUE).
select is(org_has_member_email('02140000-0000-0000-0000-00000000000b','shared-0214@example.com'), false,
  'AC-INV-020 operator probe is pinned to the target org: an email in another org is not a duplicate');
-- AC-INV-021: …and TRUE for an email that really is in org B (the branch still works).
select is(org_has_member_email('02140000-0000-0000-0000-00000000000b','only-b-0214@example.com'), true,
  'AC-INV-021 operator probe still finds a member of the target org');
-- AC-INV-022: own-org Admin path unchanged.
select is(org_has_member_email('02140000-0000-0000-0000-00000000000a','SHARED-0214@example.com'), true,
  'AC-INV-022 own-org Admin probe still finds the member (case-insensitive)');

-- AC-ORG-020: assert_org_destroyable is not member-callable any more.
select ok(not has_function_privilege('authenticated','public.assert_org_destroyable(uuid)','EXECUTE'),
  'AC-ORG-020 authenticated may not EXECUTE assert_org_destroyable');
select throws_ok($$ select assert_org_destroyable('02140000-0000-0000-0000-00000000000b') $$, '42501', null,
  'AC-ORG-020 a member calling it gets permission denied, not a lifecycle answer');

select * from finish();
rollback;
