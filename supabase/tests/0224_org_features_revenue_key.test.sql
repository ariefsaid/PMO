-- 0224_org_features_revenue_key.test.sql
-- AC-ENT-REV-001 [pgTAP]: the `revenue` entitlement (Sales Invoices, Incoming Payments, Revenue by
-- Project) is Operator-togglable via operator_toggle_feature — the CHECK registry accepts the key the
-- FE already declares in FEATURE_KEYS. Before 0224 the registry rejected it (23514), so no org could
-- ever be entitled to the Finance section. Mirrors 0144.
begin;
select plan(2);

insert into organizations (id, name) values
  ('02240000-0000-0000-0000-000000000001','AC-ENT-REV-001 Org');
insert into auth.users (id, email) values
  ('02240000-0000-0000-0000-0000000000f1','rev-op@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02240000-0000-0000-0000-0000000000f1','02240000-0000-0000-0000-000000000001','Op','rev-op@example.com','Admin');
insert into platform_operators (user_id) values ('02240000-0000-0000-0000-0000000000f1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02240000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_toggle_feature('02240000-0000-0000-0000-000000000001','revenue',true) $$,
  'AC-ENT-REV-001 Operator enables revenue (CHECK registry accepts the key)');
select is(
  (select enabled from public.org_features
     where org_id = '02240000-0000-0000-0000-000000000001' and feature_key = 'revenue'),
  true, 'AC-ENT-REV-001 the revenue entitlement row persisted enabled=true');
reset role;

select * from finish();
rollback;
