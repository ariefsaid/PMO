-- 0119_usage_operator_vs_admin_scope.test.sql
-- AC-USE-001 [pgTAP]: Operator sees all orgs; org-Admin sees own org only. Pins FR-USE-004:
-- operator_usage_summary() (no filter) returns aggregates across every org; org_usage_summary()
-- returns only the caller's own org. operator_usage_summary(p_org_id) filters to one org.
begin;
select plan(5);

insert into organizations (id, name) values
  ('01190000-0000-0000-0000-000000000001','AC-USE-001 Org A'),
  ('01190000-0000-0000-0000-000000000002','AC-USE-001 Org B');
insert into auth.users (id, email) values
  ('01190000-0000-0000-0000-0000000000a1','use001-a-admin@example.com'),
  ('01190000-0000-0000-0000-0000000000b1','use001-b-admin@example.com'),
  ('01190000-0000-0000-0000-0000000000f1','use001-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01190000-0000-0000-0000-0000000000a1','01190000-0000-0000-0000-000000000001','A Admin','use001-a-admin@example.com','Admin'),
  ('01190000-0000-0000-0000-0000000000b1','01190000-0000-0000-0000-000000000002','B Admin','use001-b-admin@example.com','Admin'),
  ('01190000-0000-0000-0000-0000000000f1','01190000-0000-0000-0000-000000000001','Operator','use001-operator@example.com','Admin');
insert into platform_operators (user_id) values ('01190000-0000-0000-0000-0000000000f1');

insert into agent_usage (org_id, owner_id, model, cost, action) values
  ('01190000-0000-0000-0000-000000000001','01190000-0000-0000-0000-0000000000a1','gpt-test', 10, 'chat'),
  ('01190000-0000-0000-0000-000000000002','01190000-0000-0000-0000-0000000000b1','gpt-test', 20, 'chat');

-- (1) org-A Admin's org_usage_summary() sees only org A's row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from org_usage_summary()), 1, 'AC-USE-001 org-A Admin sees 1 aggregate row (own org only)');
select is((select cost from org_usage_summary() limit 1), 10::numeric, 'AC-USE-001 org-A Admin aggregate is org A''s cost');
reset role;

-- (2) org-B Admin cannot call operator_usage_summary meaningfully (is_operator() false -> 0 rows).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01190000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from operator_usage_summary()), 0, 'AC-USE-001 non-Operator org-B Admin gets 0 rows from operator_usage_summary');
reset role;

-- (3) the Operator's operator_usage_summary() (no filter) sees BOTH orgs' aggregates.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01190000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from operator_usage_summary()), 2, 'AC-USE-001 Operator sees 2 aggregate rows (both orgs)');

-- (4) the Operator's operator_usage_summary(p_org_id) filters to one org.
select is(
  (select count(*)::int from operator_usage_summary('01190000-0000-0000-0000-000000000002')),
  1, 'AC-USE-001 Operator filtered to org B sees 1 aggregate row');
reset role;

select * from finish();
rollback;
