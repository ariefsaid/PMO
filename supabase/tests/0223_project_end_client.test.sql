-- 0223_project_end_client.test.sql — issue #758: record the project's END CUSTOMER.
-- Owning layer for AC-EC-001: column exists + nullable; authenticated column grants; PM same-org
-- insert/update; foreign-org rejection (42501) on insert AND update; NULL accepted; and the
-- get_sales_pipeline() projection carries the end-customer name.
begin;
select plan(15);

-- ── Fixtures: two isolated orgs, a PM, and same/foreign companies ───────────────────────────────
insert into organizations (id, name) values
  ('02230000-0000-0000-0000-000000000001','End Customer Org A (0223)'),
  ('02230000-0000-0000-0000-000000000002','End Customer Org B (0223)');

insert into auth.users (id, email) values
  ('02230000-0000-0000-0000-0000000000a1','ec-pm@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('02230000-0000-0000-0000-0000000000a1','02230000-0000-0000-0000-000000000001',
   'EC PM','ec-pm@example.com','Project Manager','active');

insert into companies (id, org_id, name, type) values
  ('02230000-0000-0000-0000-0000000000c1','02230000-0000-0000-0000-000000000001','Same-Org End Customer','Client'),
  ('02230000-0000-0000-0000-0000000000c2','02230000-0000-0000-0000-000000000002','Foreign-Org Company','Client'),
  ('02230000-0000-0000-0000-0000000000c3','02230000-0000-0000-0000-000000000001','Same-Org Client','Client');

-- ── Schema contract ─────────────────────────────────────────────────────────────────────────────
select has_column('public','projects','end_client_id',
  'AC-EC-001 projects.end_client_id exists');

select col_is_null('public','projects','end_client_id',
  'AC-EC-001 projects.end_client_id is nullable');

-- ── Explicit column grants (the silent-failure trap): authenticated INSERT and UPDATE only. ──────
select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema='public' and table_name='projects'
       and grantee='authenticated' and privilege_type='INSERT'
       and column_name='end_client_id'),
  1,
  'AC-EC-001 authenticated holds INSERT on projects.end_client_id');

select is(
  (select count(*)::int from information_schema.column_privileges
     where table_schema='public' and table_name='projects'
       and grantee='authenticated' and privilege_type='UPDATE'
       and column_name='end_client_id'),
  1,
  'AC-EC-001 authenticated holds UPDATE on projects.end_client_id');

-- ── Role contract, run as the org-A PM ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"02230000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Foreign-org company as end customer on a project of the PM's own org → REFUSED (uniform 42501).
select throws_ok(
  $$ insert into public.projects (org_id, name, status, end_client_id)
       values ('02230000-0000-0000-0000-000000000001','EC Foreign Insert','Leads',
               '02230000-0000-0000-0000-0000000000c2') $$,
  '42501',
  'end customer not in this organization',
  'AC-EC-001 a PM setting a FOREIGN-org end customer at insert is refused with the uniform 42501');

-- Same-org end customer at insert → SUCCEEDS.
select lives_ok(
  $$ insert into public.projects (id, org_id, name, status, client_id, end_client_id)
       values ('02230000-0000-0000-0000-0000000000b1','02230000-0000-0000-0000-000000000001',
               'EC Same-Org Deal','Leads',
               '02230000-0000-0000-0000-0000000000c3',
               '02230000-0000-0000-0000-0000000000c1') $$,
  'AC-EC-001 a PM can insert a project with a same-org end customer');

reset role;
select is(
  (select end_client_id from public.projects where id = '02230000-0000-0000-0000-0000000000b1'),
  '02230000-0000-0000-0000-0000000000c1'::uuid,
  'AC-EC-001 the same-org end customer was stored verbatim');

-- Foreign-org company via UPDATE → REFUSED.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"02230000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update public.projects set end_client_id = '02230000-0000-0000-0000-0000000000c2'
       where id = '02230000-0000-0000-0000-0000000000b1' $$,
  '42501',
  'end customer not in this organization',
  'AC-EC-001 a PM setting a FOREIGN-org end customer via update is refused with the uniform 42501');

-- NULL is accepted (clearing the end customer).
select lives_ok(
  $$ update public.projects set end_client_id = null
       where id = '02230000-0000-0000-0000-0000000000b1' $$,
  'AC-EC-001 a PM can clear the end customer back to NULL');

reset role;
select is(
  (select end_client_id from public.projects where id = '02230000-0000-0000-0000-0000000000b1'),
  null,
  'AC-EC-001 the end customer cleared to NULL is stored as NULL');

-- Same-org set via UPDATE after the clear → SUCCEEDS.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"02230000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update public.projects set end_client_id = '02230000-0000-0000-0000-0000000000c1'
       where id = '02230000-0000-0000-0000-0000000000b1' $$,
  'AC-EC-001 a PM can set a same-org end customer via update');

reset role;
select is(
  (select end_client_id from public.projects where id = '02230000-0000-0000-0000-0000000000b1'),
  '02230000-0000-0000-0000-0000000000c1'::uuid,
  'AC-EC-001 the updated same-org end customer was stored verbatim');

-- ── The APP path: the client never sends org_id (projects_stamp_org_id stamps it from the JWT).
-- The guard must judge the STAMPED org, so it has to fire after the stamp; an insert that omits
-- org_id is the only shape that proves the ordering (an explicit org_id hides it).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"02230000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into public.projects (id, name, status, client_id, end_client_id)
       values ('02230000-0000-0000-0000-0000000000b2','EC App-Path Deal','Leads',
               '02230000-0000-0000-0000-0000000000c3',
               '02230000-0000-0000-0000-0000000000c1') $$,
  'AC-EC-001 the app path (org_id omitted, stamped from the JWT) accepts a same-org end customer');

reset role;
select is(
  (select org_id from public.projects where id = '02230000-0000-0000-0000-0000000000b2'),
  '02230000-0000-0000-0000-000000000001'::uuid,
  'AC-EC-001 the app-path project was stamped into the PM''s own org');

-- ── Pipeline projection: get_sales_pipeline() carries end_client_name for the deal. ─────────────
-- 'Leads' is an open funnel status, so the row above ships in the pipeline payload; the end-customer
-- company join resolves its name. Run under the PM's JWT (security invoker, RLS-scoped).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"02230000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select p->>'end_client_name'
     from json_array_elements((public.get_sales_pipeline())->'projects') p
    where p->>'name' = 'EC Same-Org Deal'),
  'Same-Org End Customer',
  'AC-EC-001 get_sales_pipeline() projects the deal end-customer name');

select * from finish();
rollback;