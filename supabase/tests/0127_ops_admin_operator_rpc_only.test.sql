-- 0127_ops_admin_operator_rpc_only.test.sql
-- AC-OPR-001 [pgTAP]: Operator powers are RPC-only; platform_operators is append-only-by-omission.
-- Pins FR-OPR-001: exactly ONE policy FOR SELECT USING (user_id = auth.uid()); NO write policy for
-- any role → append-only-by-omission (INSERT throws 42501; UPDATE/DELETE silently affect 0 rows).
-- And FR-OPR-002: is_operator() (plain SECURITY INVOKER) returns true ONLY under an Operator's JWT
-- (their own row is visible via the SELECT policy) and false for everyone else.
begin;
select plan(8);

-- ── Fixtures: an Operator (in platform_operators) + a plain org-Admin (not in it). ──
insert into organizations (id, name) values
  ('01140000-0000-0000-0000-000000000001','AC-OPR-001 Org');
insert into auth.users (id, email) values
  ('01140000-0000-0000-0000-0000000000f1','opr001-operator@example.com'),
  ('01140000-0000-0000-0000-0000000000a1','opr001-admin@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01140000-0000-0000-0000-0000000000f1','01140000-0000-0000-0000-000000000001','Op One','opr001-operator@example.com','Admin'),
  ('01140000-0000-0000-0000-0000000000a1','01140000-0000-0000-0000-000000000001','Ad One','opr001-admin@example.com','Admin');
-- The Operator grant, inserted AS TABLE OWNER (service_role / seed SQL — the only writers).
insert into platform_operators (user_id) values
  ('01140000-0000-0000-0000-0000000000f1');

-- ════════════════════════════════════════════════════════════════════════════
-- (a) Append-only-by-omission: even the OPERATOR cannot INSERT/UPDATE/DELETE platform_operators.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select throws_ok(
  $$ insert into platform_operators (user_id) values ('01140000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'AC-OPR-001 Operator INSERT into platform_operators denied (no write policy — append-only-by-omission)');

with upd as (update platform_operators set granted_by = auth.uid() returning user_id)
select is((select count(*)::int from upd), 0,
  'AC-OPR-001 Operator UPDATE on platform_operators affects 0 rows (no UPDATE policy)');

with del as (delete from platform_operators returning user_id)
select is((select count(*)::int from del), 0,
  'AC-OPR-001 Operator DELETE on platform_operators affects 0 rows (no DELETE policy)');

-- (b)/(c) is_operator() under the Operator JWT returns true; their own SELECT returns exactly 1 row.
select is(public.is_operator(), true,
  'AC-OPR-001 is_operator()=true under Operator JWT (own row visible via SELECT policy)');
select is((select count(*)::int from platform_operators), 1,
  'AC-OPR-001 Operator SELECT sees exactly their own row');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- (d) A non-Operator (plain org-Admin): is_operator()=false; SELECT returns 0 rows.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(public.is_operator(), false,
  'AC-OPR-001 is_operator()=false under a non-Operator JWT (no own row visible)');
select is((select count(*)::int from platform_operators), 0,
  'AC-OPR-001 non-Operator SELECT sees 0 platform_operators rows');
select throws_ok(
  $$ insert into platform_operators (user_id) values ('01140000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'AC-OPR-001 non-Operator INSERT into platform_operators denied');

reset role;

select * from finish();
rollback;
