-- 1566_operational_waiting_route.test.sql — the three operational who-next routes (fix-waiting item 3, Waiting 3).
-- Migration under test: 1566_operational_waiting_route.sql.
-- Every route must name exactly the people 1560's own waiting list would offer that record to, read through the
-- caller's RLS: work_order_issue (Draft, priced, with the issue SoD), delivery_record (Ordered purchase receipt, NOT
-- a BAST) and transfer_receipt (Sent, addressed/keeper only, never the sender). Foreign, disabled, light and anon
-- callers must not learn the record exists.
begin;
create extension if not exists pgtap;
select plan(36);

insert into organizations (id, name, default_currency, default_timezone) values
  ('16660000-0000-0000-0000-00000000000a', 'Operational Wait Org', 'IDR', 'Asia/Jakarta'),
  ('16660000-0000-0000-0000-00000000000b', 'Operational Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('16660000-0000-0000-0000-0000000000a1', 'ow-admin@example.com'),
  ('16660000-0000-0000-0000-0000000000a2', 'ow-eng@example.com'),
  ('16660000-0000-0000-0000-0000000000a3', 'ow-pm@example.com'),
  ('16660000-0000-0000-0000-0000000000a4', 'ow-eng2@example.com'),
  ('16660000-0000-0000-0000-0000000000a5', 'ow-fin@example.com'),
  ('16660000-0000-0000-0000-0000000000a6', 'ow-pm2@example.com'),
  ('16660000-0000-0000-0000-0000000000a7', 'ow-exec@example.com'),
  ('16660000-0000-0000-0000-0000000000a8', 'ow-keeper@example.com'),
  ('16660000-0000-0000-0000-0000000000a9', 'ow-disabled@example.com'),
  ('16660000-0000-0000-0000-0000000000b1', 'ow-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16660000-0000-0000-0000-0000000000a1', '16660000-0000-0000-0000-00000000000a', 'OW Admin',    'ow-admin@example.com',    'Admin',           'active'),
  ('16660000-0000-0000-0000-0000000000a2', '16660000-0000-0000-0000-00000000000a', 'OW Engineer', 'ow-eng@example.com',      'Engineer',        'active'),
  ('16660000-0000-0000-0000-0000000000a3', '16660000-0000-0000-0000-00000000000a', 'OW PM',       'ow-pm@example.com',       'Project Manager', 'active'),
  ('16660000-0000-0000-0000-0000000000a4', '16660000-0000-0000-0000-00000000000a', 'OW Engineer2','ow-eng2@example.com',     'Engineer',        'active'),
  ('16660000-0000-0000-0000-0000000000a5', '16660000-0000-0000-0000-00000000000a', 'OW Finance',  'ow-fin@example.com',      'Finance',         'active'),
  ('16660000-0000-0000-0000-0000000000a6', '16660000-0000-0000-0000-00000000000a', 'OW PM2',      'ow-pm2@example.com',      'Project Manager', 'active'),
  ('16660000-0000-0000-0000-0000000000a7', '16660000-0000-0000-0000-00000000000a', 'OW Exec',     'ow-exec@example.com',     'Executive',       'active'),
  ('16660000-0000-0000-0000-0000000000a8', '16660000-0000-0000-0000-00000000000a', 'OW Keeper',   'ow-keeper@example.com',   'Engineer',        'active'),
  ('16660000-0000-0000-0000-0000000000a9', '16660000-0000-0000-0000-00000000000a', 'OW Disabled', 'ow-disabled@example.com', 'Admin',           'disabled'),
  ('16660000-0000-0000-0000-0000000000b1', '16660000-0000-0000-0000-00000000000b', 'OW X Org',    'ow-xorg@example.com',     'Admin',           'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('16660000-0000-0000-0000-0000000000d1', '16660000-0000-0000-0000-00000000000a', 'OW Site', 'Ongoing Project', '16660000-0000-0000-0000-0000000000a3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp._route(p_kind text, p_record uuid) returns jsonb language sql as $$
  select public.get_operational_waiting_route(p_kind, p_record);
$$;
create or replace function pg_temp._count(p_kind text, p_record uuid) returns int language sql as $$
  select jsonb_array_length(public.get_operational_waiting_route(p_kind, p_record) -> 'approvers');
$$;
create or replace function pg_temp._has(p_kind text, p_record uuid, p_uid uuid) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(public.get_operational_waiting_route(p_kind, p_record) -> 'approvers') a
     where (a ->> 'id')::uuid = p_uid);
$$;
-- The comparator the brief asks for: does THIS person's route name them iff 1560's waiting list offers them the record?
create or replace function pg_temp._agrees(p_kind text, p_record uuid, p_uid uuid) returns boolean language plpgsql as $$
declare v_route boolean; v_waiting boolean;
begin
  perform pg_temp._as(p_uid);
  v_route := exists (select 1 from jsonb_array_elements(public.get_operational_waiting_route(p_kind, p_record) -> 'approvers') a
                      where (a ->> 'id')::uuid = p_uid);
  v_waiting := exists (select 1 from public.my_waiting_decisions() w
                        where w.kind = p_kind and w.record_id = p_record);
  return v_route = v_waiting;
end $$;

-- Two Drafts, each priced by a different hand (the witness is stamped from the acting user, as in 1560's fixtures).
select pg_temp._as('16660000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'PM priced WO', 'Draft', 5000, 'exclusive', 0);
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-0000000000d1', 'Admin priced WO', 'Draft', 7000, 'exclusive', 0);

-- An Ordered purchase raised by the Engineer; a Requested one is not waiting at the receipt stage.
insert into procurements (id, org_id, title, project_id, status, requested_by_id) values
  ('16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-00000000000a', 'OW delivery', '16660000-0000-0000-0000-0000000000d1', 'Ordered', '16660000-0000-0000-0000-0000000000a2'),
  ('16660000-0000-0000-0000-000000000602', '16660000-0000-0000-0000-00000000000a', 'OW request only', '16660000-0000-0000-0000-0000000000d1', 'Requested', '16660000-0000-0000-0000-0000000000a2');

insert into stock_warehouses (id, org_id, code, name, kind) values
  ('16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-00000000000a', 'OWC', 'OW central', 'central'),
  ('16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-00000000000a', 'OWS', 'OW site', 'site'),
  ('16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-00000000000a', 'OWT', 'OW transit', 'site'),
  ('16660000-0000-0000-0000-000000000704', '16660000-0000-0000-0000-00000000000a', 'OWK', 'OW keeperless site', 'site');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('16660000-0000-0000-0000-00000000000a', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-0000000000a8');
insert into stock_transfers (id, org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, to_user_id, status, sent_by, received_at, received_by) values
  -- sent by the PM, addressed to Engineer2: Engineer2 is the named receiver, the Keeper keeps the destination.
  ('16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-00000000000a', 'OW-T1', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-0000000000a4', 'Sent', '16660000-0000-0000-0000-0000000000a3', null, null),
  -- sent by Engineer2, unaddressed: only the destination keeper is waiting.
  ('16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-00000000000a', 'OW-T2', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', null, 'Sent', '16660000-0000-0000-0000-0000000000a4', null, null),
  -- unaddressed into a warehouse with no keeper: nobody is assigned, so nothing may be advertised.
  ('16660000-0000-0000-0000-000000000803', '16660000-0000-0000-0000-00000000000a', 'OW-T3', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000704', '16660000-0000-0000-0000-000000000703', null, 'Sent', '16660000-0000-0000-0000-0000000000a4', null, null),
  ('16660000-0000-0000-0000-000000000804', '16660000-0000-0000-0000-00000000000a', 'OW-T4', '16660000-0000-0000-0000-000000000701', '16660000-0000-0000-0000-000000000702', '16660000-0000-0000-0000-000000000703', '16660000-0000-0000-0000-0000000000a4', 'Received', '16660000-0000-0000-0000-0000000000a3', now(), '16660000-0000-0000-0000-0000000000a4');

set local role authenticated;

-- ── work_order_issue: 401, priced by the PM (author 0a3) ─────────────────────────────────────────────────────────
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');
select is(pg_temp._count('work_order_issue', '16660000-0000-0000-0000-000000000401'), 3,
  'WO-01 the Admin-priced issue route names the Admin, Finance and Executive, not the author PM or another PM');
select ok(pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a1')
          and pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a5')
          and pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a3')
          and not pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a6')
          and not pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a2'),
  'WO-02 the author, the non-project PM and the Engineer are absent from the issue route');

-- ── work_order_issue: 402, priced by the Admin (author 0a1) ─────────────────────────────────────────────────────
select is(pg_temp._count('work_order_issue', '16660000-0000-0000-0000-000000000402'), 3,
  'WO-03 with an Admin-authored price the project PM, Finance and Executive are named, never the author Admin');
select ok(pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a3')
          and pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a5')
          and pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a1')
          and not pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a6'),
  'WO-04 the project membership guard admits only the project''s own PM, and never the price author');

-- ── disabled people: a disabled candidate is never named; a disabled author drops the non-authority branch ────────
reset role;
update work_orders set order_value_set_by = '16660000-0000-0000-0000-0000000000a9' where id = '16660000-0000-0000-0000-000000000402';
set local role authenticated;
select ok(not pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a9'),
  'WO-05 a disabled Admin is never advertised, even though the role would otherwise hold won-value authority');
select ok(pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a5')
          and pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._has('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a3'),
  'WO-06 a disabled price author invalidates the non-authority branch, so the project PM is no longer named');

-- ── delivery_record: Ordered 0601, raised by the Engineer; Requested 0602 is not waiting ───────────────────────
select is(pg_temp._count('delivery_record', '16660000-0000-0000-0000-000000000601'), 3,
  'DEL-01 the receipt route names the Admin, the actual requester and the project manager only');
select ok(pg_temp._has('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a1')
          and pg_temp._has('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a2')
          and pg_temp._has('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a3')
          and not pg_temp._has('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a5')
          and not pg_temp._has('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a7')
          and not pg_temp._has('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a6'),
  'DEL-02 a non-requester Finance/Executive and a different project''s PM are never advertised as receivers');
select is(pg_temp._count('delivery_record', '16660000-0000-0000-0000-000000000602'), 0,
  'DEL-03 a Requested purchase is not waiting at the receipt stage');

-- ── transfer_receipt: Sent 0801 (addressed + keeper), 0802 (keeper only), 0803 (nobody), 0804 (received) ─────────
select ok(pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a4')
          and pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a8')
          and not pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a3')
          and not pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a1'),
  'TRF-01 an addressed transfer waits on its receiver and the destination keeper, never its sender or an Admin');
select is(pg_temp._count('transfer_receipt', '16660000-0000-0000-0000-000000000801'), 2,
  'TRF-02 the addressed transfer names exactly those two people');
select ok(pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-0000000000a8')
          and not pg_temp._has('transfer_receipt', '16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-0000000000a4'),
  'TRF-03 an unaddressed transfer waits only on the destination keeper; its sender is excluded');
select is(pg_temp._count('transfer_receipt', '16660000-0000-0000-0000-000000000803'), 0,
  'TRF-04 no assigned receiver and no keeper means nobody is named');
select is(pg_temp._count('transfer_receipt', '16660000-0000-0000-0000-000000000804'), 0,
  'TRF-05 an already-received transfer is not waiting');

-- ── Visibility: foreign, disabled, light and anon ───────────────────────────────────────────────────────────────
select pg_temp._as('16660000-0000-0000-0000-0000000000b1');
select is(pg_temp._count('work_order_issue', '16660000-0000-0000-0000-000000000401'), 0,
  'VIS-01 another organisation''s record is unreadable, so its route is empty (no existence leak)');
select pg_temp._as('16660000-0000-0000-0000-0000000000a9');
select is(pg_temp._count('work_order_issue', '16660000-0000-0000-0000-000000000401'), 0,
  'VIS-02 a disabled caller reads no record and gets the same empty route');

-- ── Comparator: every route agrees with 1560's own per-person waiting list ─────────────────────────────────────
select is(pg_temp._agrees('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a1'), true, 'CMP-01 Admin agrees on WO401');
select is(pg_temp._agrees('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a3'), true, 'CMP-02 the author PM agrees on WO401');
select is(pg_temp._agrees('work_order_issue', '16660000-0000-0000-0000-000000000401', '16660000-0000-0000-0000-0000000000a6'), true, 'CMP-03 a different PM agrees on WO401');
select is(pg_temp._agrees('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a5'), true, 'CMP-04 Finance agrees on WO402');
select is(pg_temp._agrees('work_order_issue', '16660000-0000-0000-0000-000000000402', '16660000-0000-0000-0000-0000000000a3'), true, 'CMP-05 the project PM agrees after the author is disabled');
select is(pg_temp._agrees('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a2'), true, 'CMP-06 the requester agrees on the Ordered purchase');
select is(pg_temp._agrees('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a5'), true, 'CMP-07 Finance agrees on the Ordered purchase');
select is(pg_temp._agrees('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a3'), true, 'CMP-08 the project PM agrees on the Ordered purchase');
select is(pg_temp._agrees('delivery_record', '16660000-0000-0000-0000-000000000601', '16660000-0000-0000-0000-0000000000a6'), true, 'CMP-09 a different PM agrees on the Ordered purchase');
select is(pg_temp._agrees('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a4'), true, 'CMP-10 the addressed receiver agrees');
select is(pg_temp._agrees('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a8'), true, 'CMP-11 the destination keeper agrees');
select is(pg_temp._agrees('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a3'), true, 'CMP-12 the sender agrees');
select is(pg_temp._agrees('transfer_receipt', '16660000-0000-0000-0000-000000000801', '16660000-0000-0000-0000-0000000000a1'), true, 'CMP-13 an Admin agrees');
select is(pg_temp._agrees('transfer_receipt', '16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-0000000000a8'), true, 'CMP-14 the keeper agrees on the unaddressed transfer');
select is(pg_temp._agrees('transfer_receipt', '16660000-0000-0000-0000-000000000802', '16660000-0000-0000-0000-0000000000a4'), true, 'CMP-15 the sender agrees on the unaddressed transfer');

-- ── Access and shape ────────────────────────────────────────────────────────────────────────────────────────────
select is(has_function_privilege('anon', 'public.get_operational_waiting_route(text,uuid)', 'execute'), false,
  'ACC-01 anon cannot execute the route');
select is(has_function_privilege('authenticated', 'public.get_operational_waiting_route(text,uuid)', 'execute'), true,
  'ACC-02 an authenticated caller can execute the route');
select ok(strpos((select prosrc from pg_proc where proname = 'get_operational_waiting_route'), 'work_order_issue') > 0
          and strpos((select prosrc from pg_proc where proname = 'get_operational_waiting_route'), 'delivery_record') > 0
          and strpos((select prosrc from pg_proc where proname = 'get_operational_waiting_route'), 'transfer_receipt') > 0
          and strpos(lower((select prosrc from pg_proc where proname = 'get_operational_waiting_route')), 'execute ') = 0
          and strpos(lower((select prosrc from pg_proc where proname = 'get_operational_waiting_route')), 'format(') = 0,
  'ACC-03 the allowlist names the three kinds and the body builds no dynamic SQL');
select pg_temp._as('16660000-0000-0000-0000-0000000000a1');
select is(pg_temp._route('not_a_kind', '16660000-0000-0000-0000-000000000401'),
  jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', null),
  'ACC-04 an unknown kind has no route');

-- A light account decides nothing: the route is empty, never the management list.
reset role;
update organizations set built_in_roles_enabled = true where id = '16660000-0000-0000-0000-00000000000a';
update profiles set built_in_role = 'foreman' where id = '16660000-0000-0000-0000-0000000000a4';
set local role authenticated;
select pg_temp._as('16660000-0000-0000-0000-0000000000a4');
select is(pg_temp._count('transfer_receipt', '16660000-0000-0000-0000-000000000802'), 0,
  'ACC-05 a light account gets no route');

select * from finish();
rollback;
