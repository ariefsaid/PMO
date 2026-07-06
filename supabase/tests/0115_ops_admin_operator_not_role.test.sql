-- 0115_ops_admin_operator_not_role.test.sql
-- AC-OPR-002 [pgTAP]: Operator is a platform grant, NOT a 6th user_role enum value.
-- Pins FR-OPR-001/002: the user_role enum is UNCHANGED (exactly the 5 values); the Operator grant
-- lives on platform_operators.user_id, so a profile with role='Engineer' who is also in
-- platform_operators has is_operator()=true under their JWT (the grant is decoupled from the role).
begin;
select plan(2);

-- (a) The user_role enum still contains EXACTLY the 5 original values (no 'Operator' added).
select is(
  (select string_agg(enumlabel, ', ' order by enumsortorder) from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role'),
  'Executive, Project Manager, Finance, Engineer, Admin',
  'AC-OPR-002 user_role enum unchanged — Operator is NOT a 6th role value');

-- (b) An Engineer (a non-Admin role) who is in platform_operators IS an Operator.
insert into organizations (id, name) values
  ('01150000-0000-0000-0000-000000000001','AC-OPR-002 Org');
insert into auth.users (id, email) values
  ('01150000-0000-0000-0000-0000000000e1','opr002-eng-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01150000-0000-0000-0000-0000000000e1','01150000-0000-0000-0000-000000000001','Eng Op','opr002-eng-operator@example.com','Engineer');
insert into platform_operators (user_id) values
  ('01150000-0000-0000-0000-0000000000e1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01150000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select is(public.is_operator(), true,
  'AC-OPR-002 role=Engineer + platform_operators grant → is_operator()=true (grant is on user_id, not the role)');

reset role;

select * from finish();
rollback;
