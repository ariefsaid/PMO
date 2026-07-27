-- 0162_contract_value_nonneg.test.sql
-- FR-HRD-040 [pgTAP]: set_project_contract_value must reject values that are not valid money (negative
-- OR NaN OR Infinity) with a good error message, AND the underlying column must carry the CHECK that
-- is the ACTUAL authority for every writer that reaches the column via UPDATE (see 0169's header for
-- the pre-existing, out-of-scope INSERT-time gap — this RPC is not the sole writer of contract_value).
-- Evidence of the original gap: 0076_audit_events.sql:212 updates contract_value with no sign check,
-- and projects.contract_value had no CHECK constraint at all.
--
-- HIGH-1 (security-auditor, 2026-07-28): a bare `>= 0` does NOT reject NaN — Postgres numeric orders
-- NaN greater than every ordinary number, so `'NaN'::numeric >= 0` is true, and NaN poisons every
-- sum(contract_value) aggregate org-wide. Assertions 4 and 7 prove NaN is rejected at BOTH layers.
begin;
select plan(7);

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

-- 1. The column-level CHECK exists on contract_value specifically and is the authority (owner role
-- bypasses RLS + the RPC). col_has_check, not has_check — has_check is TABLE-scoped, so any unrelated
-- CHECK added to projects later would make this pass forever while its own description names
-- contract_value.
select col_has_check('public','projects','contract_value',
  'FR-HRD-040 projects.contract_value has a CHECK constraint');

-- 2. LOW-1: the constraint must be VALIDATED, not just present — a NOT VALID-only constraint would
-- still pass assertion 1 while enforcing nothing on pre-existing rows and being silently skippable by
-- a future migration that never gets around to VALIDATE.
select is(
  (select convalidated from pg_constraint where conname = 'projects_contract_value_nonneg'),
  true,
  'FR-HRD-040 projects_contract_value_nonneg is VALIDATED, not just present');

select throws_ok(
  $$ update public.projects set contract_value = -1
      where id = '01620000-0000-0000-0000-0000000000b1' $$,
  '23514', null,
  'FR-HRD-040 a direct UPDATE to a negative contract_value violates the CHECK');

-- 4. HIGH-1: NaN must ALSO violate the CHECK directly (not just via the RPC guard) — it is the
-- authority for every other writer, including a hypothetical future RPC or a service_role backfill.
select throws_ok(
  $$ update public.projects set contract_value = 'NaN'::numeric
      where id = '01620000-0000-0000-0000-0000000000b1' $$,
  '23514', null,
  'FR-HRD-040 a direct UPDATE of contract_value to NaN violates the CHECK');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01620000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 5. The RPC rejects the negative with the CHECK-violation errcode AND the readable message that
-- reaches the user's toast (0169's guard exists FOR this message — without asserting it, deleting the
-- guard is invisible: the inner UPDATE still hits the column CHECK and raises the same bare 23514).
select throws_ok(
  $$ select set_project_contract_value('01620000-0000-0000-0000-0000000000b1'::uuid, -500) $$,
  '23514', 'contract value must be a non-negative number',
  'FR-HRD-040 set_project_contract_value rejects a negative value with the readable guard message');

-- 6. HIGH-1: the RPC guard rejects NaN too, with the same readable message (not a bare 23514 from
-- falling through to the column CHECK) — proves the fix at the layer users actually hit first.
select throws_ok(
  $$ select set_project_contract_value('01620000-0000-0000-0000-0000000000b1'::uuid, 'NaN'::numeric) $$,
  '23514', 'contract value must be a non-negative number',
  'FR-HRD-040 set_project_contract_value rejects NaN with the readable guard message');

-- 7. No behaviour regression: a valid value still writes.
select lives_ok(
  $$ select set_project_contract_value('01620000-0000-0000-0000-0000000000b1'::uuid, 500) $$,
  'FR-HRD-040 a non-negative value is still accepted (no regression)');

reset role;
select * from finish();
rollback;
