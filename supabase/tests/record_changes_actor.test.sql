-- record_changes_actor.test.sql — #719 record change history, attribution (spec D1 "Actor", FR-CHG-005).
-- AC-CHG-005: a definer RPC attributes to its JWT caller; a service-role write with no JWT takes the
-- transaction-local app.actor_id when set and null when not; a JWT caller can never be re-attributed through
-- app.actor_id. Migration under test: 0260_record_change_history.sql.
-- Cast (org A): a1 Admin · a2 Finance · a4 PM.
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a1', 'chg-admin@example.com'),
  ('07190000-0000-0000-0000-0000000000a2', 'chg-fin@example.com'),
  ('07190000-0000-0000-0000-0000000000a4', 'chg-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a1', '07190000-0000-0000-0000-000000000001', 'CHG Admin', 'chg-admin@example.com', 'Admin', 'active'),
  ('07190000-0000-0000-0000-0000000000a2', '07190000-0000-0000-0000-000000000001', 'CHG Fin', 'chg-fin@example.com', 'Finance', 'active'),
  ('07190000-0000-0000-0000-0000000000a4', '07190000-0000-0000-0000-000000000001', 'CHG PM', 'chg-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, code, name, status, contract_value, tax_treatment, tax_amount) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Won One', 'Won, Pending KoM', 1000, 'exclusive', 0),
  ('07190000-0000-0000-0000-0000000000c2', '07190000-0000-0000-0000-000000000001', 'CHG-2', 'Service Two', 'Ongoing Project', 0, 'exclusive', 0);

-- ── definer RPC under Finance's JWT ──────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('07190000-0000-0000-0000-0000000000c1', 2500, p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'AC-CHG-005 (setup) Finance sets the contract value on a won project through the definer RPC');
reset role;
set local request.jwt.claims = '';

select is(
  (select actor_id from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  '07190000-0000-0000-0000-0000000000a2'::uuid, 'AC-CHG-005 the definer RPC''s event is attributed to Finance');
select is(
  (select changes->'contract_value' from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  '{"old":1000,"new":2500}'::jsonb, 'AC-CHG-005 the RPC''s value change is captured with old and new');

-- ── service role, no JWT: app.actor_id set, then unset ──────────────────────────────────────────
set local role service_role;
set local app.actor_id = '07190000-0000-0000-0000-0000000000a1';
update projects set name = 'Service Two (imported)' where id = '07190000-0000-0000-0000-0000000000c2';
set local app.actor_id = '';
update projects set name = 'Service Two (synced)' where id = '07190000-0000-0000-0000-0000000000c2';
reset role;

select is(
  (select actor_id from record_changes
    where entity_id = '07190000-0000-0000-0000-0000000000c2' and op = 'update'
      and changes->'name'->>'new' = 'Service Two (imported)'),
  '07190000-0000-0000-0000-0000000000a1'::uuid, 'AC-CHG-005 a service-role write with app.actor_id set records that actor');
select is(
  (select actor_id from record_changes
    where entity_id = '07190000-0000-0000-0000-0000000000c2' and op = 'update'
      and changes->'name'->>'new' = 'Service Two (synced)'),
  null::uuid, 'AC-CHG-005 a service-role write with app.actor_id unset records a null (System) actor');

-- ── a JWT caller cannot re-attribute through app.actor_id ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
set local app.actor_id = '07190000-0000-0000-0000-0000000000a1';
update projects set name = 'Service Two (PM edit)' where id = '07190000-0000-0000-0000-0000000000c2';
reset role;
set local request.jwt.claims = '';
set local app.actor_id = '';

select is(
  (select actor_id from record_changes
    where entity_id = '07190000-0000-0000-0000-0000000000c2' and op = 'update'
      and changes->'name'->>'new' = 'Service Two (PM edit)'),
  '07190000-0000-0000-0000-0000000000a4'::uuid,
  'AC-CHG-005 a JWT user who sets app.actor_id to another user is still recorded as themselves');
select is(
  (select count(*)::int from record_changes
    where entity_id = '07190000-0000-0000-0000-0000000000c2' and op = 'update'
      and actor_id = '07190000-0000-0000-0000-0000000000a1'),
  1, 'AC-CHG-005 the Admin id appears only on the service-role event it was set for');

select * from finish();
rollback;
