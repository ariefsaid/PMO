-- 0117_credits_insert_operator_only.test.sql
-- AC-CRE-002 [pgTAP]: credits INSERT is Operator-only (closes the 0047 revenue hole). Pins FR-CRE-003
-- + NFR-SEC-002: the 0047 `auth_role() = 'Admin'` INSERT policy is replaced by `is_operator()` ONLY,
-- so a client org-Admin can no longer self-grant unlimited credits. SELECT widens to own-org
-- Admin+Executive (grants VIEW); a plain Engineer SELECTs 0.
begin;
select plan(5);

-- ── Fixtures: org X = the Operator's HOME org (single-org seed: the Operator is a member here).
-- The Operator-INSERT-succeeds case is exercised under the Operator's home-org JWT (the policy
-- pins org_id = auth_org_id(); the cross-org path is the operator_grant_credits RPC, FR-CRE-005). ──
insert into organizations (id, name) values
  ('01170000-0000-0000-0000-000000000001','AC-CRE-002 Org X');
insert into auth.users (id, email) values
  ('01170000-0000-0000-0000-0000000000a1','cre002-admin@example.com'),
  ('01170000-0000-0000-0000-0000000000c1','cre002-exec@example.com'),
  ('01170000-0000-0000-0000-0000000000e1','cre002-eng@example.com'),
  ('01170000-0000-0000-0000-0000000000f1','cre002-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01170000-0000-0000-0000-0000000000a1','01170000-0000-0000-0000-000000000001','X Admin','cre002-admin@example.com','Admin'),
  ('01170000-0000-0000-0000-0000000000c1','01170000-0000-0000-0000-000000000001','X Exec','cre002-exec@example.com','Executive'),
  ('01170000-0000-0000-0000-0000000000e1','01170000-0000-0000-0000-000000000001','X Eng','cre002-eng@example.com','Engineer'),
  ('01170000-0000-0000-0000-0000000000f1','01170000-0000-0000-0000-000000000001','Operator','cre002-operator@example.com','Admin');
insert into platform_operators (user_id) values ('01170000-0000-0000-0000-0000000000f1');

-- (1) org-Admin INSERT → 42501 (revenue hole closed; was auth_role()='Admin' in 0047).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01170000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into credits (org_id, owner_id, amount) values ('01170000-0000-0000-0000-000000000001', null, 99999) $$,
  '42501', null,
  'AC-CRE-002 org-Admin credits INSERT denied (Operator-only — revenue hole closed)');
reset role;

-- (2) Operator INSERT → succeeds; granted_by stamped = Operator; owner_id NULL (org-pool grant).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01170000-0000-0000-0000-0000000000f1","role":"authenticated"}';
insert into credits (org_id, owner_id, amount, note)
  values ('01170000-0000-0000-0000-000000000001', null, 500, 'operator grant');
reset role;
select is(
  (select (granted_by, owner_id, amount)::text from credits where org_id = '01170000-0000-0000-0000-000000000001'),
  (select ('01170000-0000-0000-0000-0000000000f1'::uuid, null::uuid, 500::numeric))::text,
  'AC-CRE-002 Operator INSERT stamps granted_by=Operator, owner_id=NULL, amount=500');

-- (3) org-Admin SELECT sees own-org credits rows (read-only grants view).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01170000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from credits), 1,
  'AC-CRE-002 org-Admin SELECT sees own-org credits (read-only grants view)');
reset role;

-- (4) org-Executive SELECT also sees own-org credits (Admin+Exec read).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01170000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from credits), 1,
  'AC-CRE-002 org-Executive SELECT sees own-org credits (Admin+Exec read)');
reset role;

-- (5) Plain Engineer SELECT → 0 (no credits SELECT for non-Admin/Exec).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01170000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from credits), 0,
  'AC-CRE-002 Engineer SELECT sees 0 credits rows (no grants view for non-Admin/Exec)');
reset role;

select * from finish();
rollback;
