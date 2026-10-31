begin;
create extension if not exists pgtap;
-- #1512 S2b: Issue and Return posting (AC-STK-007, 008, 009). Plan docs/plans/2026-10-31-inventory-project-consumption.md (S2b.1).

insert into organizations (id, name, default_currency, default_timezone) values
  ('15120000-0000-0000-0000-000000000001', 'STK Org',       'IDR', 'Asia/Jakarta'),
  ('15120000-0000-0000-0000-000000000002', 'STK Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15120000-0000-0000-0000-0000000000a1', 'stk-admin@example.com'),
  ('15120000-0000-0000-0000-0000000000a2', 'stk-fin@example.com'),
  ('15120000-0000-0000-0000-0000000000a3', 'stk-pm@example.com'),
  ('15120000-0000-0000-0000-0000000000a4', 'stk-keep1@example.com'),   -- Engineer, keeps site A
  ('15120000-0000-0000-0000-0000000000a5', 'stk-keep2@example.com'),   -- Engineer, keeps site B
  ('15120000-0000-0000-0000-0000000000a6', 'stk-eng@example.com'),     -- Engineer, keeps nothing
  ('15120000-0000-0000-0000-0000000000b1', 'stk-xorg@example.com');    -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15120000-0000-0000-0000-0000000000a1', '15120000-0000-0000-0000-000000000001', 'STK Admin', 'stk-admin@example.com', 'Admin', 'active'),
  ('15120000-0000-0000-0000-0000000000a2', '15120000-0000-0000-0000-000000000001', 'STK Fin',   'stk-fin@example.com',   'Finance', 'active'),
  ('15120000-0000-0000-0000-0000000000a3', '15120000-0000-0000-0000-000000000001', 'STK PM',    'stk-pm@example.com',    'Project Manager', 'active'),
  ('15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-000000000001', 'STK Keep1', 'stk-keep1@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a5', '15120000-0000-0000-0000-000000000001', 'STK Keep2', 'stk-keep2@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a6', '15120000-0000-0000-0000-000000000001', 'STK Eng',   'stk-eng@example.com',   'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000b1', '15120000-0000-0000-0000-000000000002', 'STK XOrg',  'stk-xorg@example.com',  'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000000001', 'STK Ongoing',  'Ongoing Project', 1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000000001', 'STK On Hold',  'On Hold',         1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-1', 'Slab pour',   'm3', 50, 1000),
  ('15120000-0000-0000-0000-0000000000e2', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c2', 'W-2', 'Other pour',  'm3', 50, 1000);

-- S1 adds below (master data, as superuser so the fixture does not depend on the RLS under test):
insert into stock_units (id, org_id, code, name, whole_only) values
  ('15120000-0000-0000-0000-0000000000d1', '15120000-0000-0000-0000-000000000001', 'bag', 'Bag',   true),
  ('15120000-0000-0000-0000-0000000000d2', '15120000-0000-0000-0000-000000000001', 'm',   'Metre', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15120000-0000-0000-0000-000000001001', '15120000-0000-0000-0000-000000000001', 'CEM', 'Cement 50kg', '15120000-0000-0000-0000-0000000000d1'),
  ('15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000000001', 'CAB', 'Cable 4mm',   '15120000-0000-0000-0000-0000000000d2');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000000001', 'CEN',    'Central',  'central'),
  ('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000000001', 'SITE-A', 'Site A',   'site'),
  ('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000000001', 'SITE-B', 'Site B',   'site'),
  ('15120000-0000-0000-0000-000000002009', '15120000-0000-0000-0000-000000000002', 'XCEN',   'X Central','central');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000a4'),
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-0000000000a5');

create function public.stk_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- usage: select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4'); ... reset role;

-- Org B: a client, a project and a work item, so AC-STK-007 can cite a foreign work item.
insert into companies (id, org_id, name, type) values ('15120000-0000-0000-0000-0000000000f9', '15120000-0000-0000-0000-000000000002', 'X Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('15120000-0000-0000-0000-0000000000c9', '15120000-0000-0000-0000-000000000002', 'X Ongoing', 'Ongoing Project', 1, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f9');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e9', '15120000-0000-0000-0000-000000000002', '15120000-0000-0000-0000-0000000000c9', 'X-1', 'x', 'm3', 1, 1);

select plan(18);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_issue(p_wh uuid, p_project uuid, p_item uuid, p_qty numeric, p_boq uuid, p_post boolean default true) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id',p_wh,'project_id',p_project),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'boq_item_id',p_boq)), p_post) $$;
create function public.stk_t_line(p_doc uuid) returns uuid language sql as $$
  select id from public.stock_document_lines where document_id = p_doc order by line_no limit 1 $$;
create function public.stk_t_return(p_wh uuid, p_src uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','return','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'source_line_id',p_src)), true) $$;

-- opening: Admin puts 100 cable @ 60 and 3 bags @ 33.3367 (= 100.01) at SITE-A; U_K1 keeps SITE-A.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 100, 60);
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001001', 3, 33.3367);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                   -- U_K1
-- AC-STK-007: every issue line names a work item OF THE ISSUE'S PROJECT
select throws_like($$ select public.create_stock_document(
    jsonb_build_object('kind','issue','warehouse_id','15120000-0000-0000-0000-000000002002','project_id','15120000-0000-0000-0000-0000000000c1'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',5)), true) $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-007 a line with no work item is refused');
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e2') $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-007 a work item of another project is refused');
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e9') $$,
  'STK_BOQ_MISMATCH%', 'AC-STK-007 a work item of another organisation is refused');
select set_config('stk.d1', public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e1', false)::text, false);   -- a valid Draft
reset role;
update public.stock_document_lines set boq_item_id = '15120000-0000-0000-0000-0000000000e2' where document_id = current_setting('stk.d1')::uuid;   -- re-pointed behind the RPC's back
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.post_stock_document(current_setting('stk.d1')::uuid) $$, 'STK_BOQ_MISMATCH%', 'AC-STK-007 the same refusal holds when the draft is posted');
-- AC-STK-008: only an Ongoing, un-archived project takes an issue (create-and-post, archived, and post-time paths)
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e2') $$,
  'STK_PROJECT_NOT_ACTIVE%', 'AC-STK-008 a project that is not Ongoing is refused');
reset role; update public.projects set archived_at = now() where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e1') $$,
  'STK_PROJECT_NOT_ACTIVE%', 'AC-STK-008 an archived project is refused');
reset role; update public.projects set archived_at = null where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.d2', public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 5, '15120000-0000-0000-0000-0000000000e1', false)::text, false);
reset role; update public.projects set status = 'On Hold' where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.post_stock_document(current_setting('stk.d2')::uuid) $$, 'STK_PROJECT_NOT_ACTIVE%', 'AC-STK-008 a draft is refused at post once its project goes On Hold');
reset role; update public.projects set status = 'Ongoing Project' where id = '15120000-0000-0000-0000-0000000000c1'; select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
-- AC-STK-009: the cap, the cost left at, net consumption
select set_config('stk.iss', public.stk_t_line(public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 10, '15120000-0000-0000-0000-0000000000e1'))::text, false);   -- 10 @ 60 = 600
select lives_ok($$ select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss')::uuid, '15120000-0000-0000-0000-000000001002', 7) $$, 'AC-STK-009 a first return of 7 posts');
select throws_like($$ select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss')::uuid, '15120000-0000-0000-0000-000000001002', 4) $$, 'STK_RETURN_EXCEEDS%', 'AC-STK-009 returning 4 more (cumulative 11 of 10) is refused');
select lives_ok($$ select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss')::uuid, '15120000-0000-0000-0000-000000001002', 3) $$, 'AC-STK-009 returning the last 3 posts');
reset role;
select is((select value_delta::text from public.stock_ledger where kind = 'return' and source_line_id = current_setting('stk.iss')::uuid and qty_delta = 7), '420.00',
  'AC-STK-009 a partial return re-enters at the cost the issue left at (7 x 60)');
select is((select sum(value_delta)::text from public.stock_ledger where kind = 'return' and source_line_id = current_setting('stk.iss')::uuid), '600.00',
  'AC-STK-009 the returns restore exactly the issued value (420 + 180)');
select is((select (-sum(qty_delta))::text from public.stock_ledger
            where project_id = '15120000-0000-0000-0000-0000000000c1' and boq_item_id = '15120000-0000-0000-0000-0000000000e1'
              and (line_id = current_setting('stk.iss')::uuid or source_line_id = current_setting('stk.iss')::uuid)), '0.000',
  'AC-STK-009 net consumption of that issue is 10 - 7 - 3 = 0');
-- the remainder rule: 3 bags worth 100.01 issued, then returned one at a time: 33.34 + 33.34 + 33.33, never 100.02
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.iss2', public.stk_t_line(public.stk_t_issue('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001001', 3, '15120000-0000-0000-0000-0000000000e1'))::text, false);
select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss2')::uuid, '15120000-0000-0000-0000-000000001001', 1);
select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss2')::uuid, '15120000-0000-0000-0000-000000001001', 1);
select public.stk_t_return('15120000-0000-0000-0000-000000002002', current_setting('stk.iss2')::uuid, '15120000-0000-0000-0000-000000001001', 1);
reset role;
select is((select sum(value_delta)::text from public.stock_ledger where kind = 'return' and source_line_id = current_setting('stk.iss2')::uuid), '100.01',
  'AC-STK-009 returns of 1 + 1 + 1 restore exactly 100.01 (the last takes the remainder)');
select is((select qty_on_hand::text || '/' || value_on_hand::text from public.stock_balances where warehouse_id = '15120000-0000-0000-0000-000000002002' and item_id = '15120000-0000-0000-0000-000000001001'), '3.000/100.01',
  'AC-STK-009 stock re-enters at the cost the issue left at');
select is((select count(*)::int from public.stock_documents d where d.kind = 'return' and d.project_id is distinct from '15120000-0000-0000-0000-0000000000c1'), 0,
  'AC-STK-009 every return took its project from the cited issue, not from the client');
-- the clamp: 1 m worth 0.05 issued, returned as ten lines of 0.1 that each round up to 0.01; cumulative value stops at 0.05, never a negative remainder
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.stk_t_rcv('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 1, 0.05);
select set_config('stk.iss3', public.stk_t_line(public.stk_t_issue('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000001002', 1, '15120000-0000-0000-0000-0000000000e1'))::text, false);
select lives_ok($$ select public.create_stock_document(jsonb_build_object('kind','return','warehouse_id','15120000-0000-0000-0000-000000002003'),
    (select jsonb_agg(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',0.1,'source_line_id',current_setting('stk.iss3'))) from generate_series(1, 10)), true) $$,
  'AC-STK-009 ten partial returns that each round up still post');
reset role;
select is((select sum(value_delta)::text from public.stock_ledger where kind = 'return' and source_line_id = current_setting('stk.iss3')::uuid), '0.05',
  'AC-STK-009 cumulative returned value never exceeds the issued value');
select * from finish();
rollback;
