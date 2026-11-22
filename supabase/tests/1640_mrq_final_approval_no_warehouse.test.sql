-- 1640_mrq_final_approval_no_warehouse.test.sql — the last approver of a material request approves without keeping a warehouse.
-- Migration under test: 1640_mrq_final_approval_no_warehouse.sql (mrq_decide_step restated). Spec docs/specs/material-requests.spec.md.
-- AC-MRQ-030 a final approver who keeps no warehouse approves; the request then waits on a keeper, no transfer yet ·
-- AC-MRQ-031 only a keeper of the location (or Admin) sends stock from it, an approver included ·
-- AC-MRQ-032 the requester decides and sends nothing on their own request ·
-- AC-MRQ-033 an approver who does keep a warehouse may still name it at approval.
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone) values
  ('16400000-0000-0000-0000-00000000010a', 'MRQ Final Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('16400000-0000-0000-0000-0000000001a1', 'mrqf-admin@example.com'),
  ('16400000-0000-0000-0000-0000000001a2', 'mrqf-req@example.com'),
  ('16400000-0000-0000-0000-0000000001a3', 'mrqf-pm@example.com'),
  ('16400000-0000-0000-0000-0000000001a5', 'mrqf-fin@example.com'),
  ('16400000-0000-0000-0000-0000000001a6', 'mrqf-keeper@example.com'),
  ('16400000-0000-0000-0000-0000000001a7', 'mrqf-fin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16400000-0000-0000-0000-0000000001a1', '16400000-0000-0000-0000-00000000010a', 'MRQF Admin',  'mrqf-admin@example.com',  'Admin', 'active'),
  ('16400000-0000-0000-0000-0000000001a2', '16400000-0000-0000-0000-00000000010a', 'MRQF Req',    'mrqf-req@example.com',    'Engineer', 'active'),
  ('16400000-0000-0000-0000-0000000001a3', '16400000-0000-0000-0000-00000000010a', 'MRQF PM',     'mrqf-pm@example.com',     'Project Manager', 'active'),
  ('16400000-0000-0000-0000-0000000001a5', '16400000-0000-0000-0000-00000000010a', 'MRQF Fin',    'mrqf-fin@example.com',    'Finance', 'active'),
  ('16400000-0000-0000-0000-0000000001a6', '16400000-0000-0000-0000-00000000010a', 'MRQF Keeper', 'mrqf-keeper@example.com', 'Engineer', 'active'),
  ('16400000-0000-0000-0000-0000000001a7', '16400000-0000-0000-0000-00000000010a', 'MRQF Fin2',   'mrqf-fin2@example.com',   'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('16400000-0000-0000-0000-0000000001d1', '16400000-0000-0000-0000-00000000010a', 'MRQF Site', 'Ongoing Project', '16400000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16400000-0000-0000-0000-000000001401', '16400000-0000-0000-0000-00000000010a', '16400000-0000-0000-0000-0000000001d1', 'MRQF WO', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('16400000-0000-0000-0000-000000001201', '16400000-0000-0000-0000-00000000010a', '16400000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('16400000-0000-0000-0000-00000000010a', '16400000-0000-0000-0000-000000001401', '16400000-0000-0000-0000-000000001201', 10);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('16400000-0000-0000-0000-000000001301', '16400000-0000-0000-0000-00000000010a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('16400000-0000-0000-0000-000000001311', '16400000-0000-0000-0000-00000000010a', 'CEM', 'Cement', '16400000-0000-0000-0000-000000001301');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('16400000-0000-0000-0000-00000000010a', '16400000-0000-0000-0000-000000001201', '16400000-0000-0000-0000-000000001311', 100);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('16400000-0000-0000-0000-000000001801', '16400000-0000-0000-0000-00000000010a', 'MRQF-C', 'Central', 'central', null),
  ('16400000-0000-0000-0000-000000001802', '16400000-0000-0000-0000-00000000010a', 'MRQF-S', 'Site',    'site',    '16400000-0000-0000-0000-0000000001d1');
-- The keeper and the second Finance member keep Central; the first Finance member keeps nothing.
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('16400000-0000-0000-0000-00000000010a', '16400000-0000-0000-0000-000000001801', '16400000-0000-0000-0000-0000000001a6'),
  ('16400000-0000-0000-0000-00000000010a', '16400000-0000-0000-0000-000000001801', '16400000-0000-0000-0000-0000000001a7');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._draft(p_qty numeric) returns uuid language sql as $$
  select public.mrq_save_draft(null,
    jsonb_build_object('work_order_id', '16400000-0000-0000-0000-000000001401', 'needed_by', current_date + 5),
    jsonb_build_array(jsonb_build_object('item_id', '16400000-0000-0000-0000-000000001311', 'quantity', p_qty))) $$;
grant execute on function pg_temp._draft(numeric) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select pg_temp._as('16400000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Project Manager","label":"Billable change"},
                                                  {"role":"Finance","label":"Stock"}]'::jsonb) $$, 'the chain: project manager, then finance');
select pg_temp._as('16400000-0000-0000-0000-0000000001a2');
insert into t_ids values ('one', pg_temp._draft(10)), ('two', pg_temp._draft(10)), ('three', pg_temp._draft(10));
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'one')) $$, 'request one is sent');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'two')) $$, 'request two is sent');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'three')) $$, 'request three is sent');

-- AC-MRQ-032: the requester decides nothing on their own request.
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'one'), 1, 'approve') $$, '42501',
  'MRQ_SOD_AUTHOR: you cannot decide a request you raised', 'AC-MRQ-032 the requester cannot approve their own request');

select pg_temp._as('16400000-0000-0000-0000-0000000001a3');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'one'), 1, 'approve') $$, 'step 1 (project manager)');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'two'), 1, 'approve') $$, 'step 1 of request two');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'three'), 1, 'approve') $$, 'step 1 of request three');

-- AC-MRQ-030: the final approver keeps no warehouse and names none: the decision is recorded, no transfer yet.
select pg_temp._as('16400000-0000-0000-0000-0000000001a5');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'one'), 2, 'approve') $$,
  'AC-MRQ-030 a final approver who keeps no warehouse approves');
select is((select r.status || '/' || coalesce(r.transfer_document_id::text, 'none') || '/' || r.transfer_cancelled::text from material_requests r
            where r.id = (select v from t_ids where k = 'one')),
  'approved/none/false', 'AC-MRQ-030 the request is approved and waits on a keeper: no transfer exists yet');
select is((select count(*)::int from stock_documents where work_order_id = '16400000-0000-0000-0000-000000001401'), 0,
  'AC-MRQ-030 no stock document was made by the approval');

-- AC-MRQ-031: only a keeper of the location sends stock from it. The approver who keeps nothing is refused.
select throws_ok($$ select public.mrq_retry_transfer((select v from t_ids where k = 'one'), '16400000-0000-0000-0000-000000001801') $$,
  'P0001', 'STK_NOT_KEEPER: you do not keep this warehouse', 'AC-MRQ-031 an approver who keeps no warehouse cannot send from it');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'two'), 2, 'approve', null, '16400000-0000-0000-0000-000000001801') $$,
  'P0001', 'STK_NOT_KEEPER: you do not keep this warehouse', 'AC-MRQ-031 naming a warehouse at approval still needs keeping it');
select is((select r.status || '/' || s.status from material_requests r
             join material_request_steps s on s.request_id = r.id and s.round = r.round and s.position = 2
            where r.id = (select v from t_ids where k = 'two')),
  'pending/open', 'AC-MRQ-031 the refused approval leaves the request waiting at its last step');

select pg_temp._as('16400000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.mrq_retry_transfer((select v from t_ids where k = 'one'), '16400000-0000-0000-0000-000000001801') $$,
  '42501', 'MRQ_SOD_AUTHOR: you cannot move stock for a request you raised', 'AC-MRQ-032 the requester cannot send stock either');

-- The keeper chooses the warehouse and makes the transfer; posting it fulfils the request.
select pg_temp._as('16400000-0000-0000-0000-0000000001a6');
select lives_ok($$ select public.mrq_retry_transfer((select v from t_ids where k = 'one'), '16400000-0000-0000-0000-000000001801') $$,
  'AC-MRQ-031 the keeper of the location makes the transfer');
select is((select d.kind || '/' || d.status || '/' || d.warehouse_id::text || '/' || d.to_warehouse_id::text
             from material_requests r join stock_documents d on d.id = r.transfer_document_id
            where r.id = (select v from t_ids where k = 'one')),
  'transfer/Draft/16400000-0000-0000-0000-000000001801/16400000-0000-0000-0000-000000001802',
  'AC-MRQ-031 the draft goes from the keeper''s warehouse to the site');
select throws_ok($$ select public.mrq_retry_transfer((select v from t_ids where k = 'one'), '16400000-0000-0000-0000-000000001801') $$,
  'P0001', 'MRQ_NOT_PENDING: this request already has a live transfer', 'a second transfer is not made while one is live');

-- AC-MRQ-033: an approver who keeps the warehouse may still name it at approval.
select pg_temp._as('16400000-0000-0000-0000-0000000001a7');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'three'), 2, 'approve', null, '16400000-0000-0000-0000-000000001801') $$,
  'AC-MRQ-033 a keeping approver approves and names the warehouse');
select is((select r.status || '/' || d.status || '/' || d.warehouse_id::text from material_requests r
             join stock_documents d on d.id = r.transfer_document_id where r.id = (select v from t_ids where k = 'three')),
  'approved/Draft/16400000-0000-0000-0000-000000001801', 'AC-MRQ-033 the transfer draft is made at once');
select is((select count(*)::int from stock_documents where work_order_id = '16400000-0000-0000-0000-000000001401'), 2,
  'one draft per approved request, none for the one still waiting');

select * from finish();
rollback;
