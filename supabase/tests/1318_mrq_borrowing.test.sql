-- 1318_mrq_borrowing.test.sql — #2693 (spec docs/specs/stock-reservations.spec.md). Migrations under test: 1315-1318 with the shipped material-request RPCs (1001, 1045, 1101).
-- AC-RSV-008 own reservation first, no borrowing · 009 borrowing split · 010 the borrowing step is appended, last, as an ordinary step · 011 warn mode ·
-- 012 shipped order and SoD rules apply to the borrowing step · 013 consume own and lend at final approval, nothing on reject · 014 recheck and overdraw ·
-- 016 a request submitted while reservations were off is untouched.
-- Mutation checks (break the marked line, the named cases must go red, restore): mut:rsv_borrow_step (1318: P2 steps and P3 no-approver cases) ·
-- mut:rsv_consume (1318: P2 and P6 lender cases) · mut:rsv_borrow_recheck (1318: P4 case) · mut:rsv_overdraw (1315 check and 1318 raise: overdraw cases).
begin;
create extension if not exists pgtap;
select * from no_plan();
insert into organizations (id, name, default_currency, default_timezone) values ('26931000-0000-0000-0000-00000000000a', 'RSV Borrow Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('26931000-0000-0000-0000-0000000000a1', 'rsb-admin@example.com'), ('26931000-0000-0000-0000-0000000000a2', 'rsb-author@example.com'), ('26931000-0000-0000-0000-0000000000a3', 'rsb-pm@example.com'), ('26931000-0000-0000-0000-0000000000a7', 'rsb-exec@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26931000-0000-0000-0000-0000000000a1', '26931000-0000-0000-0000-00000000000a', 'RSB Admin', 'rsb-admin@example.com', 'Admin', 'active'), ('26931000-0000-0000-0000-0000000000a2', '26931000-0000-0000-0000-00000000000a', 'RSB Author', 'rsb-author@example.com', 'Engineer', 'active'),
  ('26931000-0000-0000-0000-0000000000a3', '26931000-0000-0000-0000-00000000000a', 'RSB PM', 'rsb-pm@example.com', 'Project Manager', 'active'), ('26931000-0000-0000-0000-0000000000a7', '26931000-0000-0000-0000-00000000000a', 'RSB Exec', 'rsb-exec@example.com', 'Executive', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values ('26931000-0000-0000-0000-0000000000c1', '26931000-0000-0000-0000-00000000000a', 'RSB Job', 'Ongoing Project', '26931000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-00000000000a', '26931000-0000-0000-0000-0000000000c1', 'RSB WO A', 'Issued', 10000, 'exclusive', 0), ('26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-00000000000a', '26931000-0000-0000-0000-0000000000c1', 'RSB WO B', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values ('26931000-0000-0000-0000-0000000000d1', '26931000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26931000-0000-0000-0000-000000001000', '26931000-0000-0000-0000-00000000000a', 'P0', 'Item 0', '26931000-0000-0000-0000-0000000000d1'), ('26931000-0000-0000-0000-000000001001', '26931000-0000-0000-0000-00000000000a', 'P1', 'Item 1', '26931000-0000-0000-0000-0000000000d1'), ('26931000-0000-0000-0000-000000001002', '26931000-0000-0000-0000-00000000000a', 'P2', 'Item 2', '26931000-0000-0000-0000-0000000000d1'),
  ('26931000-0000-0000-0000-000000001003', '26931000-0000-0000-0000-00000000000a', 'P3', 'Item 3', '26931000-0000-0000-0000-0000000000d1'), ('26931000-0000-0000-0000-000000001004', '26931000-0000-0000-0000-00000000000a', 'P4', 'Item 4', '26931000-0000-0000-0000-0000000000d1'), ('26931000-0000-0000-0000-000000001006', '26931000-0000-0000-0000-00000000000a', 'P6', 'Item 6', '26931000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26931000-0000-0000-0000-000000002001', '26931000-0000-0000-0000-00000000000a', 'CEN', 'Central', 'central', null), ('26931000-0000-0000-0000-000000002002', '26931000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26931000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values ('26931000-0000-0000-0000-00000000000a', '26931000-0000-0000-0000-000000002001', '26931000-0000-0000-0000-0000000000a3'), ('26931000-0000-0000-0000-00000000000a', '26931000-0000-0000-0000-000000002001', '26931000-0000-0000-0000-0000000000a7');
create table public.rsvt_ids (k text primary key, id uuid);
grant all on public.rsvt_ids to authenticated;
create function public.rsb_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.rsb_n(p_sql text) returns text language plpgsql security definer as $$ declare n text; begin execute p_sql into n; return n; end $$;
-- Raise a draft as the author, keep its id under a key. Not submitted.
create function public.rsb_draft(p_key text, p_wo uuid, p_item uuid, p_qty numeric) returns void language plpgsql as $$
begin
  perform public.rsb_as('26931000-0000-0000-0000-0000000000a2');
  insert into public.rsvt_ids values (p_key, public.mrq_save_draft(null, jsonb_build_object('work_order_id', p_wo, 'needed_by', current_date + 5),
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'over_plan_reason', 'no plan yet'))));
end $$;
create function public.rsb_id(p_key text) returns uuid language sql security definer as $$ select id from public.rsvt_ids where k = p_key $$;
create function public.rsb_steps(p_key text) returns text language sql security definer as $$
  select coalesce(string_agg(position || ':' || role || ':' || label || ':' || status, ',' order by position), 'none') from public.material_request_steps where request_id = public.rsb_id(p_key) and round = 1 $$;
create function public.rsb_res(p_wo uuid, p_item uuid) returns text language sql security definer as $$
  select string_agg(quantity::text || '/' || consumed_qty::text || '/' || released_qty::text || '/' || status, ',' order by quantity) from public.stock_reservations where work_order_id = p_wo and item_id = p_item $$;
create function public.rsb_line(p_key text) returns text language sql security definer as $$
  select reserved_use_qty::text || '/' || borrowed_qty::text from public.material_request_lines where request_id = public.rsb_id(p_key) $$;
create function public.rsb_req(p_key text) returns text language sql security definer as $$
  select status || '/' || borrowing::text || '/' || reservation_checked::text from public.material_requests where id = public.rsb_id(p_key) $$;

select rsb_as('26931000-0000-0000-0000-0000000000a1');
select mrq_set_chain('[{"role":"Project Manager","label":"Stock check"}]'::jsonb);
select create_stock_document(jsonb_build_object('kind','receive','warehouse_id','26931000-0000-0000-0000-000000002001'), jsonb_build_array(
  jsonb_build_object('item_id','26931000-0000-0000-0000-000000001000','quantity',10,'unit_cost',1), jsonb_build_object('item_id','26931000-0000-0000-0000-000000001001','quantity',10,'unit_cost',1),
  jsonb_build_object('item_id','26931000-0000-0000-0000-000000001002','quantity',10,'unit_cost',1), jsonb_build_object('item_id','26931000-0000-0000-0000-000000001003','quantity',10,'unit_cost',1),
  jsonb_build_object('item_id','26931000-0000-0000-0000-000000001004','quantity',10,'unit_cost',1), jsonb_build_object('item_id','26931000-0000-0000-0000-000000001006','quantity',10,'unit_cost',1)), true);

-- AC-RSV-016: submitted while reservations are off
select rsb_draft('r0', '26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001000', 5);
select mrq_submit(rsb_id('r0'));
select is(rsb_req('r0'), 'pending/false/false', 'AC-RSV-016 a request submitted while off is not marked or checked');
select is(rsb_steps('r0'), '1:Project Manager:Stock check:open', 'AC-RSV-016 and carries the shipped chain only');
select is(rsb_line('r0'), '0.000/0.000', 'AC-RSV-016 and its lines are untouched');
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select set_stock_reservations(true, 'approve', 'Executive', 'Borrowing');
select reserve_stock('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001000', '26931000-0000-0000-0000-000000002001', 5);
select rsb_as('26931000-0000-0000-0000-0000000000a3');
select mrq_decide_step(rsb_id('r0'), 1, 'approve', null, '26931000-0000-0000-0000-000000002001');
select is(rsb_req('r0'), 'approved/false/false', 'AC-RSV-016 it is approved as before');
select is(rsb_res('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001000'), '5.000/0.000/0.000/active', 'AC-RSV-016 and consumes nothing: it was never held to reservations');

-- P1 AC-008: own reservation first
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select reserve_stock('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001001', '26931000-0000-0000-0000-000000002001', 5);
select rsb_draft('r1', '26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001001', 5);
select mrq_submit(rsb_id('r1'));
select is(rsb_line('r1'), '5.000/0.000', 'AC-RSV-008 the work order''s own reservation covers the line');
select is(rsb_req('r1'), 'pending/false/true', 'AC-RSV-008 not borrowing');
select is(rsb_steps('r1'), '1:Project Manager:Stock check:open', 'AC-RSV-008 the shipped chain applies, no extra step');
select rsb_as('26931000-0000-0000-0000-0000000000a3');
select mrq_decide_step(rsb_id('r1'), 1, 'approve', null, '26931000-0000-0000-0000-000000002001');
select is(rsb_res('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001001'), '5.000/5.000/0.000/consumed', 'AC-RSV-013 final approval consumes the own reservation');
select is(rsb_n($$ select count(*) from stock_reservation_events where action = 'consume' and request_id = public.rsb_id('r1') $$), '1', 'AC-RSV-013 with a consume event naming the request');

-- P2 AC-009/010/012/013: borrowing
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select reserve_stock('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001002', '26931000-0000-0000-0000-000000002001', 8);
select rsb_draft('r2s', '26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-000000001002', 2);
select mrq_submit(rsb_id('r2s'));
select is(rsb_req('r2s'), 'pending/false/true', 'AC-RSV-009 2 asked, 2 free: not borrowing');
select rsb_as('26931000-0000-0000-0000-0000000000a2');
select mrq_cancel(rsb_id('r2s'), 'not needed');
select rsb_draft('r2', '26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-000000001002', 5);
select mrq_submit(rsb_id('r2'));
select is(rsb_line('r2'), '0.000/3.000', 'AC-RSV-009 5 asked, 2 free: 3 borrowed from the other work order');
select is(rsb_req('r2'), 'pending/true/true', 'AC-RSV-009 the request is marked borrowing');
select is(rsb_steps('r2'), '1:Project Manager:Stock check:open,2:Executive:Borrowing:waiting', 'AC-RSV-010 the borrowing step is appended last, waiting, as an ordinary step row');
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select mrq_set_chain('[{"role":"Project Manager","label":"Stock check"},{"role":"Finance","label":"Late step"}]'::jsonb);
select is(rsb_steps('r2'), '1:Project Manager:Stock check:open,2:Executive:Borrowing:waiting', 'AC-RSV-010 a later chain edit leaves the in-flight snapshot');
select mrq_set_chain('[{"role":"Project Manager","label":"Stock check"}]'::jsonb);
select rsb_as('26931000-0000-0000-0000-0000000000a7');
select throws_ok($$ select mrq_decide_step(rsb_id('r2'), 2, 'approve', null, '26931000-0000-0000-0000-000000002001') $$, 'P0001', 'MRQ_OUT_OF_ORDER: step 2 is not the open step; steps are decided in order', 'AC-RSV-012 the borrowing step cannot be decided before step 1');
select rsb_as('26931000-0000-0000-0000-0000000000a2');
select throws_ok($$ select mrq_decide_step(rsb_id('r2'), 1, 'approve') $$, '42501', 'MRQ_SOD_AUTHOR: you cannot decide a request you raised', 'AC-RSV-012 the author never decides');
select rsb_as('26931000-0000-0000-0000-0000000000a3');
select lives_ok($$ select mrq_decide_step(rsb_id('r2'), 1, 'approve') $$, 'AC-RSV-012 step 1 is approved');
select is(rsb_steps('r2'), '1:Project Manager:Stock check:approved,2:Executive:Borrowing:open', 'AC-RSV-010 the borrowing step opens next');
select throws_ok($$ select mrq_decide_step(rsb_id('r2'), 2, 'approve', null, '26931000-0000-0000-0000-000000002001') $$, '42501', 'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today', 'AC-RSV-012 only the borrowing role decides it');
select is(rsb_res('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001002'), '8.000/0.000/0.000/active', 'AC-RSV-013 nothing is consumed before the last approval');
select rsb_as('26931000-0000-0000-0000-0000000000a7');
select lives_ok($$ select mrq_decide_step(rsb_id('r2'), 2, 'approve', null, '26931000-0000-0000-0000-000000002001') $$, 'AC-RSV-012 the borrowing approver decides it');
select is(rsb_req('r2'), 'approved/true/true', 'AC-RSV-013 the request is approved');
select is(rsb_res('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001002'), '8.000/3.000/0.000/active', 'AC-RSV-013 the lender''s reservation drops by the 3 borrowed');
select is(rsb_n($$ select qty::text from stock_reservation_events where action = 'lend' and request_id = public.rsb_id('r2') $$), '3.000', 'AC-RSV-013 with a lend event naming the request');
select is(rsb_n($$ select (transfer_document_id is not null)::text from material_requests where id = public.rsb_id('r2') $$), 'true', 'AC-RSV-013 and the transfer draft exists');

-- P3 AC-010/011: no approver, then warn
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select reserve_stock('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001003', '26931000-0000-0000-0000-000000002001', 8);
select set_stock_reservations(true, 'approve', null, null);
select rsb_draft('r3', '26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-000000001003', 5);
select throws_ok($$ select mrq_submit(rsb_id('r3')) $$, 'P0001', 'RSV_NO_BORROW_APPROVER: this request takes another work order''s reserved stock and no borrowing approver is set; ask an Admin', 'AC-RSV-010 a borrowing request with no borrowing approver is refused');
select is(rsb_req('r3'), 'draft/false/false', 'AC-RSV-010 and stays a draft');
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select set_stock_reservations(true, 'warn', 'Executive', 'Borrowing');
select rsb_as('26931000-0000-0000-0000-0000000000a2');
select lives_ok($$ select mrq_submit(rsb_id('r3')) $$, 'AC-RSV-011 in warn mode the borrowing request is submitted');
select is(rsb_req('r3'), 'pending/true/true', 'AC-RSV-011 and marked borrowing');
select is(rsb_line('r3'), '0.000/3.000', 'AC-RSV-011 with the borrowed quantity recorded');
select is(rsb_steps('r3'), '1:Project Manager:Stock check:open', 'AC-RSV-011 and no extra step');
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select set_stock_reservations(true, 'approve', 'Executive', 'Borrowing');

-- P4 AC-013/014: recheck, then reject
select reserve_stock('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001004', '26931000-0000-0000-0000-000000002001', 8);
select rsb_draft('r4', '26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-000000001004', 5);
select mrq_submit(rsb_id('r4'));
select is(rsb_line('r4'), '0.000/3.000', 'setup: borrowing 3');
select rsb_as('26931000-0000-0000-0000-0000000000a3');
select mrq_decide_step(rsb_id('r4'), 1, 'approve');
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select reserve_stock('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001004', '26931000-0000-0000-0000-000000002001', 2);
select rsb_as('26931000-0000-0000-0000-0000000000a7');
select throws_ok($$ select mrq_decide_step(rsb_id('r4'), 2, 'approve', null, '26931000-0000-0000-0000-000000002001') $$, 'P0001', 'RSV_BORROW_CHANGED: more reserved stock would be borrowed than was approved; return the request and submit it again', 'AC-RSV-014 approval is refused when more would be borrowed than was approved');
select is(rsb_req('r4'), 'pending/true/true', 'AC-RSV-014 the request stays pending');
select is(rsb_steps('r4'), '1:Project Manager:Stock check:approved,2:Executive:Borrowing:open', 'AC-RSV-014 and the step stays open');
select is(rsb_res('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001004'), '10.000/0.000/0.000/active', 'AC-RSV-014 and nothing is consumed');
select lives_ok($$ select mrq_decide_step(rsb_id('r4'), 2, 'reject', 'not now') $$, 'AC-RSV-013 the borrowing approver rejects');
select is(rsb_req('r4'), 'rejected/true/true', 'AC-RSV-013 the request is rejected');
select is(rsb_res('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001004'), '10.000/0.000/0.000/active', 'AC-RSV-013 a rejected request consumes nothing');

-- P6 AC-013: own 2, free 2, borrowed 2
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select reserve_stock('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001006', '26931000-0000-0000-0000-000000002001', 6);
select reserve_stock('26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-000000001006', '26931000-0000-0000-0000-000000002001', 2);
select rsb_draft('r6', '26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-000000001006', 6);
select mrq_submit(rsb_id('r6'));
select is(rsb_line('r6'), '2.000/2.000', 'AC-RSV-013 own 2 + free 2 + borrowed 2 for a line of 6');
select rsb_as('26931000-0000-0000-0000-0000000000a3');
select mrq_decide_step(rsb_id('r6'), 1, 'approve');
select rsb_as('26931000-0000-0000-0000-0000000000a7');
select mrq_decide_step(rsb_id('r6'), 2, 'approve', null, '26931000-0000-0000-0000-000000002001');
select is(rsb_res('26931000-0000-0000-0000-000000000402', '26931000-0000-0000-0000-000000001006'), '2.000/2.000/0.000/consumed', 'AC-RSV-013 the requester''s own reservation is consumed first');
select is(rsb_res('26931000-0000-0000-0000-000000000401', '26931000-0000-0000-0000-000000001006'), '6.000/2.000/0.000/active', 'AC-RSV-013 the lender gives 2');
select is(rsb_n($$ select string_agg(action || ':' || qty, ',' order by action) from stock_reservation_events where request_id = public.rsb_id('r6') $$), 'consume:2.000,lend:2.000', 'AC-RSV-013 both are in the history');
select rsb_as('26931000-0000-0000-0000-0000000000a1');
select throws_ok($$ select release_reservation((select id from stock_reservations where work_order_id = '26931000-0000-0000-0000-000000000401' and item_id = '26931000-0000-0000-0000-000000001006'), 5, 'too much') $$, 'P0001', 'RSV_EXCEEDS_REMAINING: only 4 remains on this reservation', 'AC-RSV-014 consumed quantity cannot be released');

-- AC-RSV-014 overdraw is also a table rule
reset role;
select throws_ok($$ update stock_reservations set consumed_qty = quantity + 1 where work_order_id = '26931000-0000-0000-0000-000000000401' and item_id = '26931000-0000-0000-0000-000000001006' $$, '23514', null, 'AC-RSV-014 a reservation can never be over-consumed (table check)');
select * from finish();
rollback;
