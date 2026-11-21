-- csr_pickup.test.sql — #2585 client material requisitions: the pickup that posts a zero-cost receipt (MONEY PATH).
-- Spec docs/specs/client-material-requisitions.spec.md · Migrations under test: 1162, 1163 (over 1161).
-- AC-CSR-001 the rollup of the hand calculation (reserved 70, collected 50, still to collect 20, awaiting 30) ·
-- AC-CSR-005 a release cannot take reserved below collected · AC-CSR-006 a pickup above still-to-collect is refused and
-- writes nothing · AC-CSR-007 pickups serialise per line (lock wait + the second of two 15s is refused) · AC-CSR-008 one
-- receipt at unit cost 0, ledger value 0, naming the work order, stock on hand up · AC-CSR-009 the RPC writes the cost
-- itself; an item that is not zero-cost is refused and nothing is written · AC-CSR-010 a replayed pickup is one receipt ·
-- AC-CSR-011 a non-keeper is refused · AC-CSR-012 an ERP-owned inventory refuses before any row · AC-CSR-013 a pickup
-- blocks cancel; a cancelled requisition takes no pickup · AC-CSR-018 stock per work order includes the pickups ·
-- FR-CSR-017 a posted pickup row is never edited or deleted.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(41);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25850000-0000-0000-0000-00000000030a', 'CSR Pickup Org', 'IDR', 'Asia/Jakarta'),
  ('25850000-0000-0000-0000-00000000030b', 'CSR Pickup ERP Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25850000-0000-0000-0000-0000000003a1', 'csrp-admin@example.com'),
  ('25850000-0000-0000-0000-0000000003a2', 'csrp-creator@example.com'),
  ('25850000-0000-0000-0000-0000000003a3', 'csrp-pm@example.com'),
  ('25850000-0000-0000-0000-0000000003a4', 'csrp-keeper@example.com'),
  ('25850000-0000-0000-0000-0000000003a5', 'csrp-other@example.com'),
  ('25850000-0000-0000-0000-0000000003b1', 'csrp-erp@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25850000-0000-0000-0000-0000000003a1', '25850000-0000-0000-0000-00000000030a', 'CSRP Admin',   'csrp-admin@example.com',   'Admin', 'active'),
  ('25850000-0000-0000-0000-0000000003a2', '25850000-0000-0000-0000-00000000030a', 'CSRP Creator', 'csrp-creator@example.com', 'Engineer', 'active'),
  ('25850000-0000-0000-0000-0000000003a3', '25850000-0000-0000-0000-00000000030a', 'CSRP PM',      'csrp-pm@example.com',      'Project Manager', 'active'),
  ('25850000-0000-0000-0000-0000000003a4', '25850000-0000-0000-0000-00000000030a', 'CSRP Keeper',  'csrp-keeper@example.com',  'Engineer', 'active'),
  ('25850000-0000-0000-0000-0000000003a5', '25850000-0000-0000-0000-00000000030a', 'CSRP Other',   'csrp-other@example.com',   'Engineer', 'active'),
  ('25850000-0000-0000-0000-0000000003b1', '25850000-0000-0000-0000-00000000030b', 'CSRP ERP',     'csrp-erp@example.com',     'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25850000-0000-0000-0000-0000000003d1', '25850000-0000-0000-0000-00000000030a', 'CSRP P1', 'Ongoing Project', '25850000-0000-0000-0000-0000000003a3'),
  ('25850000-0000-0000-0000-0000000003d2', '25850000-0000-0000-0000-00000000030a', 'CSRP P2', 'Ongoing Project', '25850000-0000-0000-0000-0000000003a3'),
  ('25850000-0000-0000-0000-0000000003d9', '25850000-0000-0000-0000-00000000030b', 'CSRP ERP P', 'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25850000-0000-0000-0000-000000003401', '25850000-0000-0000-0000-00000000030a', '25850000-0000-0000-0000-0000000003d1', 'CSRP WO1', 'Issued', 10000, 'exclusive', 0),
  ('25850000-0000-0000-0000-000000003409', '25850000-0000-0000-0000-00000000030b', '25850000-0000-0000-0000-0000000003d9', 'CSRP ERP WO', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25850000-0000-0000-0000-000000003301', '25850000-0000-0000-0000-00000000030a', 'BAG', 'Bag', true),
  ('25850000-0000-0000-0000-000000003309', '25850000-0000-0000-0000-00000000030b', 'BAG', 'Bag', true);
insert into stock_tags (id, org_id, name, zero_cost) values
  ('25850000-0000-0000-0000-000000003321', '25850000-0000-0000-0000-00000000030a', 'Client supplied', true),
  ('25850000-0000-0000-0000-000000003322', '25850000-0000-0000-0000-00000000030a', 'Own stock', false),
  ('25850000-0000-0000-0000-000000003329', '25850000-0000-0000-0000-00000000030b', 'Client supplied', true);
insert into stock_items (id, org_id, code, name, unit_id, tag_id) values
  ('25850000-0000-0000-0000-000000003311', '25850000-0000-0000-0000-00000000030a', 'CEM',  'Cement',  '25850000-0000-0000-0000-000000003301', '25850000-0000-0000-0000-000000003321'),
  ('25850000-0000-0000-0000-000000003312', '25850000-0000-0000-0000-00000000030a', 'STL',  'Steel',   '25850000-0000-0000-0000-000000003301', '25850000-0000-0000-0000-000000003322'),
  ('25850000-0000-0000-0000-000000003313', '25850000-0000-0000-0000-00000000030a', 'CEM2', 'Cement 2', '25850000-0000-0000-0000-000000003301', '25850000-0000-0000-0000-000000003321'),
  ('25850000-0000-0000-0000-000000003314', '25850000-0000-0000-0000-00000000030a', 'CEM3', 'Cement 3', '25850000-0000-0000-0000-000000003301', '25850000-0000-0000-0000-000000003321'),
  ('25850000-0000-0000-0000-000000003319', '25850000-0000-0000-0000-00000000030b', 'CEM',  'Cement',  '25850000-0000-0000-0000-000000003309', '25850000-0000-0000-0000-000000003329');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25850000-0000-0000-0000-000000003801', '25850000-0000-0000-0000-00000000030a', 'P-C',  'Central',     'central', null),
  ('25850000-0000-0000-0000-000000003802', '25850000-0000-0000-0000-00000000030a', 'P-S1', 'Site P1',     'site',    '25850000-0000-0000-0000-0000000003d1'),
  ('25850000-0000-0000-0000-000000003803', '25850000-0000-0000-0000-00000000030a', 'P-S2', 'Site P2',     'site',    '25850000-0000-0000-0000-0000000003d2'),
  ('25850000-0000-0000-0000-000000003809', '25850000-0000-0000-0000-00000000030b', 'E-S1', 'ERP site',    'site',    '25850000-0000-0000-0000-0000000003d9');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('25850000-0000-0000-0000-00000000030a', '25850000-0000-0000-0000-000000003801', '25850000-0000-0000-0000-0000000003a4'),
  ('25850000-0000-0000-0000-00000000030a', '25850000-0000-0000-0000-000000003802', '25850000-0000-0000-0000-0000000003a4'),
  ('25850000-0000-0000-0000-00000000030a', '25850000-0000-0000-0000-000000003803', '25850000-0000-0000-0000-0000000003a4'),
  ('25850000-0000-0000-0000-00000000030b', '25850000-0000-0000-0000-000000003809', '25850000-0000-0000-0000-0000000003b1');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
create or replace function pg_temp._ln(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
grant execute on function pg_temp._ln(text) to authenticated;

-- Reads of tables no client role can select (ledger, lines, balances) go through an owner-run helper.
create or replace function pg_temp._q(p_sql text) returns text language plpgsql security definer as $$
declare r text; begin execute p_sql into r; return r; end $$;
grant execute on function pg_temp._q(text) to authenticated;

set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000003a2');
-- R1: L1 (CEM 100/100, the hand calculation), L2 (CEM2 100/100, release rule), L3 (CEM3 20/20, concurrency).
insert into t_ids values ('r1', public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000003401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000003311","takeoff_quantity":100,"requested_quantity":100},
    {"stock_item_id":"25850000-0000-0000-0000-000000003313","takeoff_quantity":100,"requested_quantity":100},
    {"stock_item_id":"25850000-0000-0000-0000-000000003314","takeoff_quantity":20,"requested_quantity":20}]'::jsonb));
select public.csr_send(pg_temp._ln('r1'));
insert into t_ids select 'l1', id from client_requisition_lines where requisition_id = pg_temp._ln('r1') and line_no = 1;
insert into t_ids select 'l2', id from client_requisition_lines where requisition_id = pg_temp._ln('r1') and line_no = 2;
insert into t_ids select 'l3', id from client_requisition_lines where requisition_id = pg_temp._ln('r1') and line_no = 3;

-- Hand calculation: reservations 60 and 20, release 10.
select pg_temp._as('25850000-0000-0000-0000-0000000003a3');
select public.csr_record_reservation(pg_temp._ln('l1'), 60, 'CL-1');
select public.csr_record_reservation(pg_temp._ln('l1'), 20, 'CL-2');
select lives_ok($$ select public.csr_record_release(pg_temp._ln('l1'), 10, 'client took 10 back') $$, 'FR-CSR-008 a release with a reason is recorded');
select throws_ok($$ select public.csr_record_release(pg_temp._ln('l1'), 5, '  ') $$, 'P0001', 'CSR_INVALID: a release needs a reason', 'FR-CSR-008 a release without a reason is refused');
select public.csr_record_reservation(pg_temp._ln('l2'), 60, 'CL-3');
select public.csr_record_reservation(pg_temp._ln('l2'), 20, 'CL-4');
select public.csr_record_release(pg_temp._ln('l2'), 10, 'x');
select public.csr_record_reservation(pg_temp._ln('l3'), 20, 'CL-5');

-- ── Pickup 50 by the keeper of the site ─────────────────────────────────────────────────────────────────────────
select pg_temp._as('25850000-0000-0000-0000-0000000003a4');
insert into t_ids values ('p1', public.csr_record_pickup(pg_temp._ln('l1'), 50, '25850000-0000-0000-0000-000000003802', current_date, 'Driver Budi', 'DN-77', '25850000-0000-0000-0000-00000000c301'));
select is((select count(*)::int from client_requisition_pickups where line_id = pg_temp._ln('l1')), 1, 'FR-CSR-010 the pickup is recorded');
select is((select quantity from client_requisition_pickups where id = pg_temp._ln('p1')), 50.000::numeric, 'FR-CSR-010 with its quantity');

-- AC-CSR-008: one receipt, unit cost 0, ledger value 0, work order named, on-hand up.
select is(pg_temp._q(format($q$select d.kind || '/' || d.status || '/' || (d.work_order_id = '25850000-0000-0000-0000-000000003401')::text
             from client_requisition_pickups p join stock_documents d on d.id = p.stock_document_id where p.id = %L$q$, pg_temp._ln('p1'))),
  'receive/Posted/true', 'AC-CSR-008 the pickup posted one receive naming the work order');
select is(pg_temp._q(format($q$select (l.unit_cost = 0)::text from client_requisition_pickups p join stock_document_lines l on l.document_id = p.stock_document_id where p.id = %L$q$, pg_temp._ln('p1'))),
  'true', 'AC-CSR-008 the receipt line is at unit cost 0');
select is(pg_temp._q(format($q$select sum(g.value_delta)::text || '/' || sum(g.qty_delta)::text from client_requisition_pickups p join stock_ledger g on g.document_id = p.stock_document_id where p.id = %L$q$, pg_temp._ln('p1'))),
  '0.00/50.000', 'AC-CSR-008 the ledger moved 50 at value 0');
select is(pg_temp._q($q$select qty_on_hand::text || '/' || value_on_hand::text from stock_balances where item_id = '25850000-0000-0000-0000-000000003311' and warehouse_id = '25850000-0000-0000-0000-000000003802'$q$),
  '50.000/0.00', 'AC-CSR-008 quantity on hand at the location is up by 50, at value 0');
select is((select count(*)::int from client_requisition_events where line_id = pg_temp._ln('l1') and kind = 'pickup'), 1, 'FR-CSR-023 the pickup is logged');

-- AC-CSR-001: the rollup of the hand calculation.
select is((select reserved::text || '/' || collected::text || '/' || still_to_collect::text || '/' || awaiting_reservation::text
             from public.csr_work_order_rollup('25850000-0000-0000-0000-000000003401') where line_id = pg_temp._ln('l1')),
  '70.000/50.000/20.000/30.000', 'AC-CSR-001 reserved 70, collected 50, still to collect 20, awaiting reservation 30');
select is((select string_agg(e.kind || ':' || e.quantity::text, ',' order by e.seq) from client_requisition_events e
            where e.line_id = pg_temp._ln('l1') and e.kind in ('reserved','released','pickup')),
  'reserved:60.000,reserved:20.000,released:10.000,pickup:50.000', 'AC-CSR-001 the event list shows reservations 60 and 20, the release 10 and the pickup 50');

-- AC-CSR-006: 21 against 20 still to collect is refused and writes nothing; 20 posts.
select is(pg_temp._q($q$select count(*)::text from stock_documents where kind = 'receive' and org_id = '25850000-0000-0000-0000-00000000030a'$q$), '1', 'baseline: one receive exists');
select throws_ok($$ select public.csr_record_pickup(pg_temp._ln('l1'), 21, '25850000-0000-0000-0000-000000003802') $$, 'P0001',
  'CSR_OVER_COLLECT: only 20 is still to collect', 'AC-CSR-006 a pickup of 21 against 20 still to collect is refused, naming the remainder');
select is(pg_temp._q($q$select count(*)::text from stock_documents where kind = 'receive' and org_id = '25850000-0000-0000-0000-00000000030a'$q$), '1', 'AC-CSR-006 and no stock document was written');
select is((select count(*)::int from client_requisition_pickups where line_id = pg_temp._ln('l1')), 1, 'AC-CSR-006 nor a pickup row');
select lives_ok($$ select public.csr_record_pickup(pg_temp._ln('l1'), 20, '25850000-0000-0000-0000-000000003802') $$, 'AC-CSR-006 a pickup of exactly 20 posts');

-- AC-CSR-005: L2 reserved 70, collected 50: a release of 30 is refused, 20 accepted.
select public.csr_record_pickup(pg_temp._ln('l2'), 50, '25850000-0000-0000-0000-000000003802');
select pg_temp._as('25850000-0000-0000-0000-0000000003a3');
select throws_ok($$ select public.csr_record_release(pg_temp._ln('l2'), 30, 'too much') $$, 'P0001',
  'CSR_RELEASE_BELOW_COLLECTED: a release of 30 would take reserved below the 50 already collected', 'AC-CSR-005 a release taking reserved below collected is refused');
select lives_ok($$ select public.csr_record_release(pg_temp._ln('l2'), 20, 'ok') $$, 'AC-CSR-005 a release of 20 is accepted');

-- AC-CSR-007: concurrent pickups of 15 against 20: exactly one succeeds (serialised per line).
select pg_temp._as('25850000-0000-0000-0000-0000000003a4');
select lives_ok($$ select public.csr_record_pickup(pg_temp._ln('l3'), 15, '25850000-0000-0000-0000-000000003802') $$, 'AC-CSR-007 the first pickup of 15 against 20 succeeds');
select throws_ok($$ select public.csr_record_pickup(pg_temp._ln('l3'), 15, '25850000-0000-0000-0000-000000003802') $$, 'P0001',
  'CSR_OVER_COLLECT: only 5 is still to collect', 'AC-CSR-007 the second pickup of 15 is refused');
reset role;
insert into client_requisition_lines (id, org_id, requisition_id, line_no, stock_item_id, takeoff_quantity, requested_quantity, unit_code)
values ('25850000-0000-0000-0000-000000003e02', '25850000-0000-0000-0000-00000000030a', (select v from t_ids where k = 'r1'), 5,
        '25850000-0000-0000-0000-000000003311', 10, 10, 'BAG');
insert into client_requisition_events (org_id, requisition_id, line_id, kind, quantity, client_reference) values
  ('25850000-0000-0000-0000-00000000030a', (select v from t_ids where k = 'r1'), '25850000-0000-0000-0000-000000003e02', 'reserved', 10, 'CL-L');
select dblink_connect('csr_line_lock', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));
select dblink_exec('csr_line_lock', 'begin');
select ok((select count(*) from dblink('csr_line_lock',
  format($q$select pg_advisory_xact_lock(%s)$q$, hashtextextended('csr-line:25850000-0000-0000-0000-000000003e02', 0))) as t(x text)) = 1,
  'AC-CSR-007 another transaction holds the line lock');
set local lock_timeout = '300ms';
set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000003a4');
select throws_ok($$ select public.csr_record_pickup('25850000-0000-0000-0000-000000003e02', 1, '25850000-0000-0000-0000-000000003802') $$, '55P03', null,
  'AC-CSR-007 a pickup waits for the line lock before reading what is still to collect');
reset role;
select dblink_exec('csr_line_lock', 'rollback');
select dblink_disconnect('csr_line_lock');
set local lock_timeout = 0;
set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000003a4');

-- AC-CSR-009: a non-zero-cost item is refused and nothing is written (line planted directly: csr_create would refuse it).
reset role;
insert into client_requisition_lines (id, org_id, requisition_id, line_no, stock_item_id, takeoff_quantity, requested_quantity, unit_code)
values ('25850000-0000-0000-0000-000000003e01', '25850000-0000-0000-0000-00000000030a', (select v from t_ids where k = 'r1'), 4,
        '25850000-0000-0000-0000-000000003312', 10, 10, 'BAG');
insert into client_requisition_events (org_id, requisition_id, line_id, kind, quantity, client_reference) values
  ('25850000-0000-0000-0000-00000000030a', (select v from t_ids where k = 'r1'), '25850000-0000-0000-0000-000000003e01', 'reserved', 10, 'CL-9');
set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000003a4');
select is(pg_temp._q($q$select count(*)::text from stock_documents where kind = 'receive' and org_id = '25850000-0000-0000-0000-00000000030a'$q$), '4', 'baseline: four receives (50, 20, 50, 15)');
select throws_ok($$ select public.csr_record_pickup('25850000-0000-0000-0000-000000003e01', 10, '25850000-0000-0000-0000-000000003802') $$, 'P0001',
  'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied', 'AC-CSR-009 a pickup of an item whose tag is not zero-cost is refused');
select is(pg_temp._q($q$select count(*)::text from stock_documents where kind = 'receive' and org_id = '25850000-0000-0000-0000-00000000030a'$q$), '4', 'AC-CSR-009 and writes no receipt');
select is((select count(*)::int from information_schema.parameters where specific_schema = 'public' and specific_name like 'csr_record_pickup%' and parameter_name ilike '%cost%'), 0,
  'AC-CSR-009 the pickup RPC takes no cost parameter');
select is(pg_temp._q($q$select count(*)::text from stock_ledger g join stock_documents d on d.id = g.document_id
            where d.work_order_id = '25850000-0000-0000-0000-000000003401' and d.kind = 'receive' and g.value_delta <> 0$q$), '0',
  'AC-CSR-009 every receipt written by a pickup has ledger value 0');

-- AC-CSR-010: a replayed pickup is one receipt and one pickup row.
select is(public.csr_record_pickup(pg_temp._ln('l1'), 50, '25850000-0000-0000-0000-000000003802', current_date, 'Driver Budi', 'DN-77', '25850000-0000-0000-0000-00000000c301'),
  pg_temp._ln('p1'), 'AC-CSR-010 a replay returns the original pickup');
select is((select count(*)::int from client_requisition_pickups where client_request_id = '25850000-0000-0000-0000-00000000c301'), 1, 'AC-CSR-010 one pickup row');
select is(pg_temp._q($q$select count(*)::text from stock_documents where kind = 'receive' and org_id = '25850000-0000-0000-0000-00000000030a'$q$), '4', 'AC-CSR-010 and no new receipt');

-- Wrong receiving locations: another project's site, a central location. Atomic: nothing written.
select throws_ok($$ select public.csr_record_pickup(pg_temp._ln('l3'), 1, '25850000-0000-0000-0000-000000003803') $$, '23514',
  'COST_WO_PROJECT: the work order belongs to another project', 'FR-CSR-014 a site of another project is refused');
select throws_ok($$ select public.csr_record_pickup(pg_temp._ln('l3'), 1, '25850000-0000-0000-0000-000000003801') $$, '23514',
  'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order', 'FR-CSR-014 a central location is refused');
select is(pg_temp._q($q$select count(*)::text from stock_documents where kind = 'receive' and org_id = '25850000-0000-0000-0000-00000000030a'$q$), '4', 'FR-CSR-014 neither left a receipt behind');

-- AC-CSR-011: a user who does not keep the location and is not Admin.
select pg_temp._as('25850000-0000-0000-0000-0000000003a5');
select throws_ok($$ select public.csr_record_pickup(pg_temp._ln('l3'), 1, '25850000-0000-0000-0000-000000003802') $$, 'P0001',
  'STK_NOT_KEEPER: you do not keep this warehouse', 'AC-CSR-011 a non-keeper who is not Admin is refused');

-- AC-CSR-018: stock per work order includes the pickups (50 + 20 = 70 of CEM at the site).
select pg_temp._as('25850000-0000-0000-0000-0000000003a1');
select is((select (r->>'received_qty') || '/' || (r->>'received_value') from jsonb_array_elements(public.get_work_order_stock_balance('25850000-0000-0000-0000-000000003401')) r
            where r->>'item_code' = 'CEM' and r->>'warehouse_code' = 'P-S1'),
  '70/0.00', 'AC-CSR-018 stock on hand per work order includes the 70 collected for CEM at value 0');

-- AC-CSR-013: a pickup blocks cancel; a cancelled requisition takes no pickup.
select pg_temp._as('25850000-0000-0000-0000-0000000003a2');
select throws_ok($$ select public.csr_cancel(pg_temp._ln('r1')) $$, 'P0001',
  'CSR_HAS_PICKUP: a pickup is already posted, so the requisition cannot be cancelled', 'AC-CSR-013 cancel is refused once a pickup is posted');
insert into t_ids values ('r2', public.csr_create('{"work_order_id":"25850000-0000-0000-0000-000000003401"}'::jsonb,
  '[{"stock_item_id":"25850000-0000-0000-0000-000000003311","takeoff_quantity":10}]'::jsonb));
select public.csr_send(pg_temp._ln('r2'));
insert into t_ids select 'l5', id from client_requisition_lines where requisition_id = pg_temp._ln('r2');
select pg_temp._as('25850000-0000-0000-0000-0000000003a3');
select public.csr_record_reservation(pg_temp._ln('l5'), 10, 'CL-20');
select pg_temp._as('25850000-0000-0000-0000-0000000003a2');
select public.csr_cancel(pg_temp._ln('r2'));
select pg_temp._as('25850000-0000-0000-0000-0000000003a4');
select throws_ok($$ select public.csr_record_pickup(pg_temp._ln('l5'), 1, '25850000-0000-0000-0000-000000003802') $$, 'P0001',
  'CSR_CANCELLED: the requisition is cancelled', 'AC-CSR-013 a cancelled requisition takes no pickup');

-- FR-CSR-017: a posted pickup row is never edited or deleted.
reset role;
select throws_ok($$ update client_requisition_pickups set quantity = 1 where id = (select v from t_ids where k = 'p1') $$, 'P0001',
  'CSR_IMMUTABLE: requisition history cannot be changed', 'FR-CSR-017 a pickup cannot be edited, against the table owner too');
select throws_ok($$ delete from client_requisition_pickups where id = (select v from t_ids where k = 'p1') $$, 'P0001',
  'CSR_IMMUTABLE: requisition history cannot be changed', 'FR-CSR-017 nor deleted');

-- AC-CSR-012: an ERP-owned inventory domain refuses before any row.
insert into external_domain_ownership (org_id, external_tier, domain) values ('25850000-0000-0000-0000-00000000030b', 'odoo', 'inventory');
insert into client_requisitions (id, org_id, number, work_order_id, project_id, status, created_by, sent_by, sent_at) values
  ('25850000-0000-0000-0000-000000003f01', '25850000-0000-0000-0000-00000000030b', 'CSR-ERP-1', '25850000-0000-0000-0000-000000003409', '25850000-0000-0000-0000-0000000003d9',
   'open', '25850000-0000-0000-0000-0000000003b1', '25850000-0000-0000-0000-0000000003b1', now());
insert into client_requisition_lines (id, org_id, requisition_id, line_no, stock_item_id, takeoff_quantity, requested_quantity, unit_code) values
  ('25850000-0000-0000-0000-000000003f11', '25850000-0000-0000-0000-00000000030b', '25850000-0000-0000-0000-000000003f01', 1, '25850000-0000-0000-0000-000000003319', 10, 10, 'BAG');
insert into client_requisition_events (org_id, requisition_id, line_id, kind, quantity, client_reference) values
  ('25850000-0000-0000-0000-00000000030b', '25850000-0000-0000-0000-000000003f01', '25850000-0000-0000-0000-000000003f11', 'reserved', 10, 'CL-E');
set local role authenticated;
select pg_temp._as('25850000-0000-0000-0000-0000000003b1');
select throws_ok($$ select public.csr_record_pickup('25850000-0000-0000-0000-000000003f11', 5, '25850000-0000-0000-0000-000000003809') $$, 'P0001',
  'STK_OWNED_BY_ERP: inventory is run in your connected ERP, so PMO does not post stock', 'AC-CSR-012 an ERP-owned inventory refuses the pickup');
select is((select count(*)::int from client_requisition_pickups where line_id = '25850000-0000-0000-0000-000000003f11')::text
          || pg_temp._q($q$select count(*)::text from stock_documents where org_id = '25850000-0000-0000-0000-00000000030b'$q$), '00', 'AC-CSR-012 and nothing is written');

select * from finish();
rollback;
