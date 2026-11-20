-- csr_requisition.test.sql — #2585 client material requisitions: header, lines, send, cancel, reservations, access.
-- Spec docs/specs/client-material-requisitions.spec.md · plan docs/plans/2026-11-20-client-material-requisitions.md.
-- Migrations under test: 1086_client_requisitions.sql (tables), 1087_client_requisition_rpcs.sql (RPCs).
-- AC-CSR-004 reserved may not exceed requested · AC-CSR-013 send freezes lines and is replay-safe; a cancelled
-- requisition takes no reservation or release · AC-CSR-014 an allocation row of another work order, or a closed work
-- order, is refused · AC-CSR-015 a reservation notifies the creator · AC-CSR-016 no client role writes any of the four
-- tables or the append-only event log · AC-CSR-017 another organisation reads and writes nothing; a same-org role
-- without the action is refused, reads follow the material-request audience · FR-CSR-001/005 create + idempotency.
begin;
create extension if not exists pgtap;
select plan(46);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25850000-0000-0000-0000-00000000020a', 'CSR Req Org', 'IDR', 'Asia/Jakarta'),
  ('25850000-0000-0000-0000-00000000020b', 'CSR Req Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25850000-0000-0000-0000-0000000002a1', 'csrr-admin@example.com'),
  ('25850000-0000-0000-0000-0000000002a2', 'csrr-creator@example.com'),
  ('25850000-0000-0000-0000-0000000002a3', 'csrr-pm@example.com'),
  ('25850000-0000-0000-0000-0000000002a4', 'csrr-eng@example.com'),
  ('25850000-0000-0000-0000-0000000002b1', 'csrr-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25850000-0000-0000-0000-0000000002a1', '25850000-0000-0000-0000-00000000020a', 'CSRR Admin',   'csrr-admin@example.com',   'Admin', 'active'),
  ('25850000-0000-0000-0000-0000000002a2', '25850000-0000-0000-0000-00000000020a', 'CSRR Creator', 'csrr-creator@example.com', 'Engineer', 'active'),
  ('25850000-0000-0000-0000-0000000002a3', '25850000-0000-0000-0000-00000000020a', 'CSRR PM',      'csrr-pm@example.com',      'Project Manager', 'active'),
  ('25850000-0000-0000-0000-0000000002a4', '25850000-0000-0000-0000-00000000020a', 'CSRR Eng',     'csrr-eng@example.com',     'Engineer', 'active'),
  ('25850000-0000-0000-0000-0000000002b1', '25850000-0000-0000-0000-00000000020b', 'CSRR XOrg',    'csrr-xorg@example.com',    'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25850000-0000-0000-0000-0000000002d1', '25850000-0000-0000-0000-00000000020a', 'CSRR P1', 'Ongoing Project', '25850000-0000-0000-0000-0000000002a3'),
  ('25850000-0000-0000-0000-0000000002d2', '25850000-0000-0000-0000-00000000020a', 'CSRR P2', 'Ongoing Project', '25850000-0000-0000-0000-0000000002a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25850000-0000-0000-0000-000000002401', '25850000-0000-0000-0000-00000000020a', '25850000-0000-0000-0000-0000000002d1', 'CSRR WO1', 'Issued', 10000, 'exclusive', 0),
  ('25850000-0000-0000-0000-000000002402', '25850000-0000-0000-0000-00000000020a', '25850000-0000-0000-0000-0000000002d2', 'CSRR WO2', 'Issued', 10000, 'exclusive', 0);
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('25850000-0000-0000-0000-000000002403', '25850000-0000-0000-0000-00000000020a', '25850000-0000-0000-0000-0000000002d1', 'CSRR WO closed', 'Closed', 0, 'exclusive', 0, 'IDR');
set local session_replication_role = origin;
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25850000-0000-0000-0000-000000002201', '25850000-0000-0000-0000-00000000020a', '25850000-0000-0000-0000-0000000002d1', 'B1', 'Slab', 'm3', 10, 1000),
  ('25850000-0000-0000-0000-000000002202', '25850000-0000-0000-0000-00000000020a', '25850000-0000-0000-0000-0000000002d2', 'B2', 'Wall', 'm3', 10, 1000);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('25850000-0000-0000-0000-000000002211', '25850000-0000-0000-0000-00000000020a', '25850000-0000-0000-0000-000000002401', '25850000-0000-0000-0000-000000002201', 10),
  ('25850000-0000-0000-0000-000000002212', '25850000-0000-0000-0000-00000000020a', '25850000-0000-0000-0000-000000002402', '25850000-0000-0000-0000-000000002202', 10);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25850000-0000-0000-0000-000000002301', '25850000-0000-0000-0000-00000000020a', 'BAG', 'Bag', true);
insert into stock_tags (id, org_id, name, zero_cost) values
  ('25850000-0000-0000-0000-000000002321', '25850000-0000-0000-0000-00000000020a', 'Client supplied', true),
  ('25850000-0000-0000-0000-000000002322', '25850000-0000-0000-0000-00000000020a', 'Own stock', false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id) values
  ('25850000-0000-0000-0000-000000002311', '25850000-0000-0000-0000-00000000020a', 'CEM', 'Cement', '25850000-0000-0000-0000-000000002301', '25850000-0000-0000-0000-000000002321'),
  ('25850000-0000-0000-0000-000000002312', '25850000-0000-0000-0000-00000000020a', 'STL', 'Steel',  '25850000-0000-0000-0000-000000002301', '25850000-0000-0000-0000-000000002322'),
  ('25850000-0000-0000-0000-000000002313', '25850000-0000-0000-0000-00000000020a', 'SND', 'Sand',   '25850000-0000-0000-0000-000000002301', null);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

-- ── FR-CSR-022 / AC-CSR-016 structure: RLS forced, no client write privilege on any of the four tables ─────────
select is((select count(*)::int from pg_class where relname in ('client_requisitions','client_requisition_lines','client_requisition_events','client_requisition_pickups')
             and relkind = 'r' and relrowsecurity and relforcerowsecurity), 4, 'FR-CSR-022 RLS is enabled and forced on all four tables');
select is((select count(*)::int from (values ('client_requisitions'),('client_requisition_lines'),('client_requisition_events'),('client_requisition_pickups')) t(n)
            cross join (values ('INSERT'),('UPDATE'),('DELETE')) p(priv)
            where has_table_privilege('authenticated', 'public.' || t.n, p.priv) or has_table_privilege('anon', 'public.' || t.n, p.priv)), 0,
  'AC-CSR-016 neither authenticated nor anon holds INSERT, UPDATE or DELETE on any requisition table');

set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000002a2');

-- ── FR-CSR-001 / 005 create, idempotent ──────────────────────────────────────────────────────────────────────
insert into t_ids values ('r1', public.csr_create(
  jsonb_build_object('work_order_id', '25850000-0000-0000-0000-000000002401', 'client_reference', 'CL-REQ-1'),
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":100,"requested_quantity":100,"work_order_line_id":"25850000-0000-0000-0000-000000002211"},
    {"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":40,"requested_quantity":50}]'::jsonb,
  '25850000-0000-0000-0000-00000000c101'));
select is((select status from client_requisitions where id = (select v from t_ids where k = 'r1')), 'draft', 'FR-CSR-001 a new requisition is a draft');
select ok((select number like 'CSR-%' from client_requisitions where id = (select v from t_ids where k = 'r1')), 'FR-CSR-001 it takes a number from the document-number sequence');
select is((select count(*)::int from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r1')), 2, 'FR-CSR-001 both lines are saved');
select is((select unit_code from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r1') and line_no = 1), 'BAG', 'FR-CSR-001 the unit is snapshotted on the line');
select is((select project_id from client_requisitions where id = (select v from t_ids where k = 'r1')), '25850000-0000-0000-0000-0000000002d1'::uuid, 'FR-CSR-001 the project is copied from the work order, not sent by the client');
select is((select org_id from client_requisitions where id = (select v from t_ids where k = 'r1')), '25850000-0000-0000-0000-00000000020a'::uuid, 'FR-CSR-022 org_id is stamped by the server');
select is(public.csr_create(jsonb_build_object('work_order_id', '25850000-0000-0000-0000-000000002401'),
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":1}]'::jsonb, '25850000-0000-0000-0000-00000000c101'),
  (select v from t_ids where k = 'r1'), 'FR-CSR-005 a replayed create returns the first requisition');
select is((select count(*)::int from client_requisitions where client_reference = 'CL-REQ-1'), 1, 'FR-CSR-005 a replay writes no second requisition');
select is((select count(*)::int from client_requisition_events where requisition_id = (select v from t_ids where k = 'r1') and kind = 'created' and line_id is null), 1,
  'FR-CSR-023 the creation is logged once, on the requisition with no line');

-- ── AC-CSR-014 / validation ─────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000002401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":5,"work_order_line_id":"25850000-0000-0000-0000-000000002212"}]'::jsonb) $$,
  'P0001', 'CSR_ALLOCATION: the allocation row belongs to another work order', 'AC-CSR-014 an allocation row of another work order is refused');
select throws_ok($$ select public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000002403"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":5}]'::jsonb) $$,
  'P0001', 'CSR_WORK_ORDER: the work order is closed or cancelled', 'AC-CSR-014 a closed work order is refused');
select throws_ok($$ select public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000002401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002312","takeoff_quantity":5}]'::jsonb) $$,
  'P0001', 'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied', 'FR-CSR-001 an item whose tag is not zero-cost is refused');
select throws_ok($$ select public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000002401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002313","takeoff_quantity":5}]'::jsonb) $$,
  'P0001', 'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied', 'FR-CSR-001 an untagged item is refused');
select throws_ok($$ select public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000002401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":0}]'::jsonb) $$,
  'P0001', 'CSR_INVALID: line 1 needs a take-off quantity above 0 (3 decimals at most)', 'NFR-CSR-002 a zero quantity is refused');
select throws_ok($$ select public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000002401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":1.5}]'::jsonb) $$,
  'P0001', 'CSR_INVALID: line 1 is counted in whole units', 'NFR-CSR-002 a fraction of a whole-unit item is refused');

-- A draft takes no reservation; its lines can still be edited.
select pg_temp._as('25850000-0000-0000-0000-0000000002a3');
select throws_ok($$ select public.csr_record_reservation((select id from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r1') and line_no = 1), 10, 'CL-1') $$,
  'P0001', 'CSR_NOT_OPEN: only an open requisition takes a reservation, release or pickup', 'FR-CSR-006 a draft requisition takes no reservation');
select pg_temp._as('25850000-0000-0000-0000-0000000002a2');
select lives_ok($$ select public.csr_update_draft((select v from t_ids where k = 'r1'), '{"client_reference":"CL-REQ-1b"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":100,"requested_quantity":100,"work_order_line_id":"25850000-0000-0000-0000-000000002211"},
    {"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":40,"requested_quantity":50}]'::jsonb) $$,
  'FR-CSR-004 the author edits a draft');

-- ── AC-CSR-013 send: author only, freezes lines, replay no-op ──────────────────────────────────────────────────
select pg_temp._as('25850000-0000-0000-0000-0000000002a4');
select throws_ok($$ select public.csr_send((select v from t_ids where k = 'r1')) $$, '42501',
  'CSR_FORBIDDEN: only the person who raised the requisition, or an Admin, can change, send or cancel it', 'AC-CSR-017 another engineer cannot send it');
select pg_temp._as('25850000-0000-0000-0000-0000000002a2');
select lives_ok($$ select public.csr_send((select v from t_ids where k = 'r1'), '25850000-0000-0000-0000-00000000c102') $$, 'AC-CSR-013 the author sends the draft');
select is((select status from client_requisitions where id = (select v from t_ids where k = 'r1')), 'open', 'AC-CSR-013 it is open');
select is((select sent_by from client_requisitions where id = (select v from t_ids where k = 'r1')), '25850000-0000-0000-0000-0000000002a2'::uuid, 'FR-CSR-004 who sent it is recorded');
select lives_ok($$ select public.csr_send((select v from t_ids where k = 'r1'), '25850000-0000-0000-0000-00000000c102') $$, 'AC-CSR-013 a send replay is a no-op');
select is((select count(*)::int from client_requisition_events where requisition_id = (select v from t_ids where k = 'r1') and kind = 'sent'), 1, 'AC-CSR-013 the replay logged no second send');
select throws_ok($$ select public.csr_update_draft((select v from t_ids where k = 'r1'), '{}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":1}]'::jsonb) $$,
  'P0001', 'CSR_NOT_DRAFT: only a draft requisition can be changed or sent', 'AC-CSR-013 the lines are frozen once sent');

-- ── AC-CSR-004 reserved may not exceed requested ───────────────────────────────────────────────────────────────
select pg_temp._as('25850000-0000-0000-0000-0000000002a3');
insert into t_ids values ('l1', (select id from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r1') and line_no = 1));
select lives_ok($$ select public.csr_record_reservation((select v from t_ids where k = 'l1'), 60, 'CL-RSV-1', current_date, 'first batch') $$, 'FR-CSR-006 a Project Manager records a reservation');
select throws_ok($$ select public.csr_record_reservation((select v from t_ids where k = 'l1'), 41, 'CL-RSV-2') $$, 'P0001',
  'CSR_OVER_REQUESTED: Reserved would exceed requested by 1', 'AC-CSR-004 a reservation taking reserved to 101 is refused, naming the excess');
select lives_ok($$ select public.csr_record_reservation((select v from t_ids where k = 'l1'), 40, 'CL-RSV-2') $$, 'AC-CSR-004 a reservation taking reserved to exactly 100 is accepted');

-- ── AC-CSR-015 notification of the creator ────────────────────────────────────────────────────────────────────
reset role;
select is((select count(*)::int from notifications where owner_id = '25850000-0000-0000-0000-0000000002a2'
            and metadata->'entity'->>'id' = (select v::text from t_ids where k = 'r1')), 2,
  'AC-CSR-015 the creator is notified once per reservation recorded by someone else');
select is((select count(*)::int from notifications where owner_id = '25850000-0000-0000-0000-0000000002a3'), 0, 'AC-CSR-015 the person recording is not notified');
set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000002a3');

-- ── AC-CSR-017 role gate ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp._as('25850000-0000-0000-0000-0000000002a4');
select throws_ok($$ select public.csr_record_reservation((select v from t_ids where k = 'l1'), 1, 'X') $$, '42501',
  'CSR_FORBIDDEN: only a Project Manager or above records a reservation or release', 'AC-CSR-017 an Engineer cannot record a reservation');
select throws_ok($$ select public.csr_record_release((select v from t_ids where k = 'l1'), 1, 'x') $$, '42501',
  'CSR_FORBIDDEN: only a Project Manager or above records a reservation or release', 'AC-CSR-017 an Engineer cannot record a release');
select is((select count(*)::int from client_requisitions), 1, 'AC-CSR-017 a same-organisation member reads the requisition (material-request read audience)');
select is((select count(*)::int from public.csr_work_order_rollup('25850000-0000-0000-0000-000000002401')), 2, 'FR-CSR-018 the rollup returns one row per line');

-- ── AC-CSR-013 cancel ────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp._as('25850000-0000-0000-0000-0000000002a2');
insert into t_ids values ('r2', public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000002401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000002311","takeoff_quantity":10}]'::jsonb));
select public.csr_send((select v from t_ids where k = 'r2'));
select pg_temp._as('25850000-0000-0000-0000-0000000002a3');
select public.csr_record_reservation((select id from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r2')), 5, 'CL-RSV-9');
select pg_temp._as('25850000-0000-0000-0000-0000000002a2');
select lives_ok($$ select public.csr_cancel((select v from t_ids where k = 'r2'), 'client withdrew the order') $$, 'FR-CSR-004 the author cancels an open requisition with no pickup');
select is((select status from client_requisitions where id = (select v from t_ids where k = 'r2')), 'cancelled', 'FR-CSR-004 it is cancelled and keeps its history');
select pg_temp._as('25850000-0000-0000-0000-0000000002a3');
select throws_ok($$ select public.csr_record_reservation((select id from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r2')), 1, 'late') $$, 'P0001',
  'CSR_CANCELLED: the requisition is cancelled', 'AC-CSR-013 a cancelled requisition takes no reservation');
select throws_ok($$ select public.csr_record_release((select id from client_requisition_lines where requisition_id = (select v from t_ids where k = 'r2')), 1, 'late') $$, 'P0001',
  'CSR_CANCELLED: the requisition is cancelled', 'AC-CSR-013 a cancelled requisition takes no release');

-- ── AC-CSR-016 / 017 direct writes and the other organisation ─────────────────────────────────────────────────────
select throws_ok($$ insert into client_requisition_events (requisition_id, kind, quantity) values ((select v from t_ids where k = 'r1'), 'reserved', 5) $$,
  '42501', null, 'AC-CSR-016 a client role cannot insert an event directly');
select throws_ok($$ update client_requisitions set status = 'cancelled' where id = (select v from t_ids where k = 'r1') $$,
  '42501', null, 'AC-CSR-016 a client role cannot update a requisition directly');
reset role;
select throws_ok($$ update client_requisition_events set quantity = 1 where kind = 'sent' $$, 'P0001', 'CSR_IMMUTABLE: requisition history cannot be changed',
  'AC-CSR-016 a transition event is append-only, against the table owner too');
select throws_ok($$ delete from client_requisition_events where kind = 'reserved' $$, 'P0001', 'CSR_IMMUTABLE: requisition history cannot be changed',
  'AC-CSR-016 a reservation event cannot be deleted');
set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000002b1');
select is((select count(*)::int from client_requisitions) + (select count(*)::int from client_requisition_lines) + (select count(*)::int from client_requisition_events), 0,
  'AC-CSR-017 a user of another organisation reads nothing');
select throws_ok($$ select public.csr_record_reservation((select v from t_ids where k = 'l1'), 1, 'X') $$, 'P0001',
  'CSR_NOT_FOUND: the line is not in your organisation', 'AC-CSR-017 nor can they write against it');
select throws_ok($$ select public.csr_send((select v from t_ids where k = 'r1')) $$, 'P0001',
  'CSR_NOT_FOUND: the requisition is not in your organisation', 'AC-CSR-017 nor send it');

select * from finish();
rollback;
