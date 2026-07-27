-- 0162_contract_value_nonneg.test.sql
-- FR-HRD-040 [pgTAP]: set_project_contract_value must reject negatives with a good error message,
-- AND the underlying column must carry the CHECK that is the actual authority. The RPC guard alone
-- is not enough: any other writer (an RPC added later, a service_role backfill) bypasses it.
-- Evidence of the gap: 0076_audit_events.sql:212 updates contract_value with no sign check, and
-- projects.contract_value has no CHECK constraint.
begin;
select plan(4);

insert into organizations (id, name) values
  ('01620000-0000-0000-0000-000000000001','FR-HRD-040 Org');
insert into auth.users (id, email) values
  ('01620000-0000-0000-0000-0000000000a1','money-guard@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01620000-0000-0000-0000-0000000000a1','01620000-0000-0000-0000-000000000001',
   'Money Guard','money-guard@example.com','Executive');
insert into projects (id, org_id, name, status) values
  ('01620000-0000-0000-0000-0000000000b1','01620000-0000-0000-0000-000000000001',
   'FR-HRD-040 Project','Won, Pending KoM');

-- 1. The column-level CHECK exists and is the authority (owner role bypasses RLS + the RPC).
select has_check('public','projects','FR-HRD-040 projects has a CHECK constraint on contract_value');
select throws_ok(
  $$ update public.projects set contract_value = -1
      where id = '01620000-0000-0000-0000-0000000000b1' $$,
  '23514', null,
  'FR-HRD-040 a direct UPDATE to a negative contract_value violates the CHECK');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01620000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 2. The RPC rejects the negative with the CHECK-violation errcode (maps to the existing toast).
select throws_ok(
  $$ select set_project_contract_value('01620000-0000-0000-0000-0000000000b1'::uuid, -500) $$,
  '23514', null,
  'FR-HRD-040 set_project_contract_value rejects a negative value');

-- 3. No behaviour regression: a valid value still writes.
select lives_ok(
  $$ select set_project_contract_value('01620000-0000-0000-0000-0000000000b1'::uuid, 500) $$,
  'FR-HRD-040 a non-negative value is still accepted (no regression)');

reset role;
select * from finish();
rollback;
