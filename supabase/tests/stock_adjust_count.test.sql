begin;
create extension if not exists pgtap;
-- #1512 S4: adjustment and count, the two-person write-off (AC-STK-014, 015; FR-STK-024, 025, 062). Plan S4.1.

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

select plan(32);
create function public.stk_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;
create function public.stk_t_count(p_wh uuid, p_item uuid, p_counted numeric, p_cost numeric default null, p_post boolean default false) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','count','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'counted_quantity',p_counted,'unit_cost',p_cost)), p_post) $$;
create function public.stk_t_adj(p_wh uuid, p_item uuid, p_qty numeric, p_dir text, p_cost numeric default null) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','adjustment','warehouse_id',p_wh,'reason','damaged'),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'direction',p_dir,'unit_cost',p_cost))) $$;
-- the approver posts the revision they read (FR-STK-062 fix round)
create function public.stk_t_post(p_doc uuid) returns uuid language sql as $$
  select public.post_stock_document(p_doc, (select revision from public.stock_documents where id = p_doc)) $$;
create function public.stk_t_entry(p_doc uuid) returns text language sql as $$
  select qty_delta::text || '/' || value_delta::text from public.stock_ledger where document_id = p_doc $$;

select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');                                   -- Admin
select public.stk_t_rcv('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 100, 60);   -- SITE-A: 100 cable, 6,000
-- a Draft count of 92 against 100 on hand (variance -8), authored by the Admin
select set_config('stk.cnt', public.stk_t_count('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 92)::text, false);
select throws_like($$ select public.stk_t_post(current_setting('stk.cnt')::uuid) $$, 'STK_SELF_APPROVE%',
  'AC-STK-014 the author - even an Admin - cannot post a count with a variance');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                   -- U_K1: Engineer, rank 10, keeps SITE-A, not the author
select throws_like($$ select public.stk_t_post(current_setting('stk.cnt')::uuid) $$, 'STK_RANK%',
  'AC-STK-014 a different user below Project Manager is refused');
reset role;
select is((select count(*)::int from public.stock_ledger where kind = 'count'), 0, 'AC-STK-014 the two refusals wrote nothing');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                   -- U_PM, not the author, keeps nothing
select lives_ok($$ select public.stk_t_post(current_setting('stk.cnt')::uuid) $$, 'AC-STK-014 a different Project Manager posts it');
reset role;
select is(public.stk_t_entry(current_setting('stk.cnt')::uuid), '-8.000/-480.00',
  'AC-STK-014 one adjustment entry equals the variance, out at the moving average (8 x 60)');
select is((select expected_quantity::text from public.stock_document_lines where document_id = current_setting('stk.cnt')::uuid), '100.000',
  'AC-STK-014 the system quantity at post time is stamped on the line');
-- AC-STK-015: a count with no variance may be posted by its author and writes nothing (92 counted, 92 now on hand)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_config('stk.cnt0', public.stk_t_count('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 92, null, true)::text, false) $$,
  'AC-STK-015 the author posts a zero-variance count');
reset role;
select is((select count(*)::int from public.stock_ledger where kind = 'count'), 1, 'AC-STK-015 it wrote no ledger entry (only the earlier 8-unit write-off exists)');
select is((select status || '/' || expected_quantity::text from public.stock_documents d join public.stock_document_lines l on l.document_id = d.id
            where d.id = current_setting('stk.cnt0')::uuid), 'Posted/92.000', 'AC-STK-015 and the document is Posted, its system quantity stamped');
-- a count that finds stock where the system holds none needs a unit cost (SITE-B holds no cable)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select set_config('stk.cnt2', public.stk_t_count('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5)::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_like($$ select public.stk_t_post(current_setting('stk.cnt2')::uuid) $$, 'STK_INVALID%unit cost%',
  'FR-STK-025 finding stock where the system has none needs a unit cost');
reset role;
-- FR-STK-024: an adjustment needs a reason; adjust-in defaults to the moving average; its author cannot post it
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','adjustment','warehouse_id','15120000-0000-0000-0000-000000002002'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',2,'direction','out'))) $$, 'STK_INVALID%reason%',
  'FR-STK-024 an adjustment without a reason is refused');
select set_config('stk.adj', public.create_stock_document(jsonb_build_object('kind','adjustment','warehouse_id','15120000-0000-0000-0000-000000002002','reason','found in the yard'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',3,'direction','in')))::text, false);
select throws_like($$ select public.stk_t_post(current_setting('stk.adj')::uuid) $$, 'STK_SELF_APPROVE%', 'FR-STK-062 the author cannot post their own adjustment either');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.stk_t_post(current_setting('stk.adj')::uuid) $$, 'FR-STK-024 a Project Manager posts it');
reset role;
select is(public.stk_t_entry(current_setting('stk.adj')::uuid), '3.000/180.00',
  'FR-STK-024 adjust-in without a cost enters at the moving average (3 x 60)');                       -- SITE-A now 95 / 5,700
-- adjust-out: a non-author below Project Manager is refused; a non-author Admin posts it at the moving average
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                   -- U_K1 authors (keeps SITE-A)
select set_config('stk.adjout', public.stk_t_adj('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 5, 'out')::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a5');                                   -- U_K2: Engineer, not the author
select throws_like($$ select public.stk_t_post(current_setting('stk.adjout')::uuid) $$, 'STK_RANK%', 'FR-STK-062 an adjustment posted below Project Manager is refused');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.stk_t_post(current_setting('stk.adjout')::uuid) $$, 'FR-STK-062 an Admin who did not author it posts it');
reset role;
select is(public.stk_t_entry(current_setting('stk.adjout')::uuid), '-5.000/-300.00', 'FR-STK-024 adjust-out leaves at the moving average (5 x 5,700 / 95)');   -- 90 / 5,400
-- adjust-in with a stated cost uses that cost
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.adjin', public.stk_t_adj('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 10, 'in', 70)::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select public.stk_t_post(current_setting('stk.adjin')::uuid);
reset role;
select is(public.stk_t_entry(current_setting('stk.adjin')::uuid), '10.000/700.00', 'FR-STK-024 adjust-in with a unit cost enters at that cost (10 x 70)');   -- 100 / 6,100
-- adjust-in where none is on hand needs a cost
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a5');                                   -- U_K2 keeps SITE-B (no cable)
select set_config('stk.adjnone', public.stk_t_adj('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 1, 'in')::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_like($$ select public.stk_t_post(current_setting('stk.adjnone')::uuid) $$, 'STK_INVALID%unit cost%', 'FR-STK-024 adjust-in where none is on hand needs a unit cost');
reset role;
-- count surplus: at the moving average when stock is on hand; at the line's cost when none is
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.cntup', public.stk_t_count('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 110)::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a5');
select set_config('stk.cntb', public.stk_t_count('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000001002', 5, 40)::text, false);
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select public.stk_t_post(current_setting('stk.cntup')::uuid);
select public.stk_t_post(current_setting('stk.cntb')::uuid);
reset role;
select is(public.stk_t_entry(current_setting('stk.cntup')::uuid), '10.000/610.00', 'FR-STK-025 a count surplus enters at the moving average (10 x 6,100 / 100)');
select is(public.stk_t_entry(current_setting('stk.cntb')::uuid), '5.000/200.00', 'FR-STK-025 a surplus where none was on hand enters at the line''s unit cost (5 x 40)');
-- shape: an item appears once per count; an author cannot create-and-post a count that has a variance
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$ select public.create_stock_document(jsonb_build_object('kind','count','warehouse_id','15120000-0000-0000-0000-000000002002'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','counted_quantity',1),
                      jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','counted_quantity',2))) $$, 'STK_INVALID%once%',
  'FR-STK-025 an item appears once per count');
select throws_like($$ select public.stk_t_count('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 50, null, true) $$, 'STK_SELF_APPROVE%',
  'FR-STK-062 create-and-post of a count with a variance is refused for its author');
reset role;
-- Approve what you saw: the approver pins the revision they reviewed; a re-save by the author since is refused.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                   -- U_K1 authors 2 cable in at 70 (SITE-A holds stock)
select set_config('stk.pin', public.stk_t_adj('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000001002', 2, 'in', 70)::text, false);
reset role;
select is((select revision from public.stock_documents where id = current_setting('stk.pin')::uuid), 1, 'FR-STK-062 a new draft is at revision 1');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');                                   -- the author re-saves: 2000 in, no cost sent
select public.save_stock_draft(current_setting('stk.pin')::uuid, jsonb_build_object('kind','adjustment','warehouse_id','15120000-0000-0000-0000-000000002002','reason','damaged'),
    jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001002','quantity',2000,'direction','in')));
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_like($$ select public.post_stock_document(current_setting('stk.pin')::uuid, 1) $$, 'STK_STALE%',
  'FR-STK-062 the approver who reviewed revision 1 cannot post the re-saved draft');
select throws_like($$ select public.post_stock_document(current_setting('stk.pin')::uuid) $$, 'STK_STALE%',
  'FR-STK-062 a write-off post that names no revision is refused');
reset role;
select is((select status from public.stock_documents where id = current_setting('stk.pin')::uuid), 'Draft', 'FR-STK-062 the stale posts wrote nothing');
-- the line cost: hidden below rank 20, shown to the approver; kept when the re-save omitted it
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select is(public.get_stock_document_costs(current_setting('stk.pin')::uuid)->0, jsonb_build_object('line_id', (select id from public.stock_document_lines where document_id = current_setting('stk.pin')::uuid), 'has_cost', true),
  'FR-STK-063 below rank 20 a line shows that a cost is on file, not the cost');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select is(public.get_stock_document_costs(current_setting('stk.pin')::uuid)->0->>'unit_cost', '70.0000', 'FR-STK-063 the approver (rank >= 20) reads the stored unit cost');
select lives_ok($$ select public.post_stock_document(current_setting('stk.pin')::uuid, 2) $$, 'FR-STK-062 the approver posts the revision now on screen');
reset role;
select is(public.stk_t_entry(current_setting('stk.pin')::uuid), '2000.000/140000.00',
  'FR-STK-024 a re-saved line that omits the cost keeps the stored cost (2000 x 70), not the moving average');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select is(public.get_stock_document_costs(current_setting('stk.pin')::uuid), '[]'::jsonb, 'AC-STK-019 another org reads no line cost');
reset role;
select * from finish();
rollback;
