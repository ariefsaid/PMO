-- 2040_material_coordinator_rights.test.sql — the Material Coordinator job role's stock rights (migration 2040).
-- Each right: the holder of material_coordinator is allowed; a person at the same access level holding another job role (storekeeper)
-- is refused; a person with no job role is judged by access level exactly as before; a field account is refused.
-- MUTATION NOTES (remove the condition tagged in 2040; the named assertion must go red; restore):
--   mut:rr_mc_writeoff (drop the Material Coordinator branch) .... 'RR-MC-01 the Material Coordinator posts a count difference someone else drafted'
--                                                                   'RR-MC-02 the Material Coordinator posts a loss someone else drafted'
--   mut:rr_mc_reserve ............................................ 'RR-MC-05 the Material Coordinator may record a client reservation or release'
--   mut:rr_mc_cover .............................................. 'RR-MC-07 the Material Coordinator sees which location holds stock with no guard cover'
--   mut:rr_closeout_owner ........................................ 'RR-MC-10 the item''s owner job role attaches its document'
--   mut:selfapprove (0416, kept) ................................. 'RR-MC-03 the Material Coordinator never posts a write-off they drafted'
begin;
create extension if not exists pgtap;
select plan(24);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20400000-0000-0000-0000-00000000000a', 'RR MC Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('20400000-0000-0000-0000-0000000000a1', 'rrmc-admin@example.com'),
  ('20400000-0000-0000-0000-0000000000a2', 'rrmc-mc@example.com'),
  ('20400000-0000-0000-0000-0000000000a3', 'rrmc-store@example.com'),
  ('20400000-0000-0000-0000-0000000000a4', 'rrmc-eng@example.com'),
  ('20400000-0000-0000-0000-0000000000a5', 'rrmc-field@example.com'),
  ('20400000-0000-0000-0000-0000000000a6', 'rrmc-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20400000-0000-0000-0000-0000000000a1', '20400000-0000-0000-0000-00000000000a', 'RRMC Admin', 'rrmc-admin@example.com', 'Admin', 'active', null),
  ('20400000-0000-0000-0000-0000000000a2', '20400000-0000-0000-0000-00000000000a', 'RRMC MC',    'rrmc-mc@example.com',    'Engineer', 'active', 'material_coordinator'),
  ('20400000-0000-0000-0000-0000000000a3', '20400000-0000-0000-0000-00000000000a', 'RRMC Store', 'rrmc-store@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20400000-0000-0000-0000-0000000000a4', '20400000-0000-0000-0000-00000000000a', 'RRMC Eng',   'rrmc-eng@example.com',   'Engineer', 'active', null),
  ('20400000-0000-0000-0000-0000000000a5', '20400000-0000-0000-0000-00000000000a', 'RRMC Field', 'rrmc-field@example.com', 'Engineer', 'active', 'field_user'),
  ('20400000-0000-0000-0000-0000000000a6', '20400000-0000-0000-0000-00000000000a', 'RRMC PM',    'rrmc-pm@example.com',    'Project Manager', 'active', null);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('20400000-0000-0000-0000-0000000000d1', '20400000-0000-0000-0000-00000000000a', 'bag', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('20400000-0000-0000-0000-000000001001', '20400000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '20400000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('20400000-0000-0000-0000-000000002001', '20400000-0000-0000-0000-00000000000a', 'SITE-A', 'Site A', 'site');

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20400000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate || ' ' || split_part(sqlerrm, ':', 1); end $$;
grant execute on function pg_temp.as_user(text), pg_temp.err(text) to authenticated;
create function pg_temp.count_doc(p_counted numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','count','warehouse_id','20400000-0000-0000-0000-000000002001'),
    jsonb_build_array(jsonb_build_object('item_id','20400000-0000-0000-0000-000000001001','counted_quantity',p_counted))) $$;
create function pg_temp.post(p_doc uuid) returns text language sql as $$
  select pg_temp.err(format('select public.post_stock_document(%L, %s)', p_doc, coalesce((select revision from public.stock_documents where id = p_doc)::text, 'null'))) $$;
grant execute on function pg_temp.post(uuid) to authenticated;
create temp table _ids (k text primary key, v uuid) on commit drop;
grant all on _ids to authenticated;

-- The Admin receives 100 bags at Site A and drafts the counts and the loss the others post.
select pg_temp.as_user('a1');
select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','20400000-0000-0000-0000-000000002001'),
  jsonb_build_array(jsonb_build_object('item_id','20400000-0000-0000-0000-000000001001','quantity',100,'unit_cost',60)), true);
insert into _ids values ('c1', pg_temp.count_doc(99)), ('c2', pg_temp.count_doc(98)), ('c3', pg_temp.count_doc(50));
insert into _ids values ('adj', public.create_stock_document(jsonb_build_object('kind','adjustment','warehouse_id','20400000-0000-0000-0000-000000002001','reason','damaged'),
  jsonb_build_array(jsonb_build_object('item_id','20400000-0000-0000-0000-000000001001','quantity',2,'direction','out'))));
reset role;
-- c3 is the Material Coordinator's own draft (the author column, as a draft they wrote would carry it)
update stock_documents set created_by = '20400000-0000-0000-0000-0000000000a2' where id = (select v from _ids where k = 'c3');

-- ── write-off: count difference and loss ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('a2');
select is(pg_temp.post((select v from _ids where k = 'c1')), 'ok', 'RR-MC-01 the Material Coordinator posts a count difference someone else drafted');
select is(pg_temp.post((select v from _ids where k = 'adj')), 'ok', 'RR-MC-02 the Material Coordinator posts a loss someone else drafted');
select is(pg_temp.post((select v from _ids where k = 'c3')), 'P0001 STK_SELF_APPROVE', 'RR-MC-03 the Material Coordinator never posts a write-off they drafted');
select pg_temp.as_user('a3');
select is(pg_temp.post((select v from _ids where k = 'c2')), 'P0001 STK_RANK', 'RR-MC-04 a Storekeeper at the same access level cannot post a write-off');
select pg_temp.as_user('a4');
select is(pg_temp.post((select v from _ids where k = 'c2')), 'P0001 STK_RANK', 'RR-MC-04 an Engineer with no job role still cannot post a write-off');
select pg_temp.as_user('a5');
select is(pg_temp.post((select v from _ids where k = 'c2')), '42501 LIGHT_ACCOUNT', 'RR-MC-04 a field account cannot post a write-off');
select pg_temp.as_user('a6');
select is(pg_temp.post((select v from _ids where k = 'c2')), 'ok', 'RR-MC-04 a Project Manager with no job role still posts a write-off');
reset role;
select is((select qty_on_hand::int from stock_balances where warehouse_id = '20400000-0000-0000-0000-000000002001'), 98,
  'RR-MC-02 the posted count and loss moved stock (100, counted 99, less 2 lost, counted 98)');

-- ── client reservation and release (the one recorder gate both functions call) ─────────────────────────────────────────────────
create function pg_temp.recorder_as(p_user text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20400000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  return pg_temp.err('select public.csr_assert_recorder()');
end $$;
select is(pg_temp.recorder_as('a2'), 'ok', 'RR-MC-05 the Material Coordinator may record a client reservation or release');
select is(pg_temp.recorder_as('a3'), '42501 CSR_FORBIDDEN', 'RR-MC-06 a Storekeeper at the same access level may not');
select is(pg_temp.recorder_as('a4'), '42501 CSR_FORBIDDEN', 'RR-MC-06 an Engineer with no job role still may not');
select is(pg_temp.recorder_as('a5'), '42501 CSR_FORBIDDEN', 'RR-MC-06 a field account may not');
select is(pg_temp.recorder_as('a6'), 'ok', 'RR-MC-06 a Project Manager with no job role still may');

-- ── stock at risk: the money-free cover flag ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('a2');
select is((select (e->>'uncovered') || '/' || (e ? 'stock_value')::text || '/' || (e ? 'cover_value')::text
             from jsonb_array_elements(public.get_stock_at_risk()) e where e->>'warehouse_code' = 'SITE-A'),
  'true/false/false', 'RR-MC-07 the Material Coordinator sees which location holds stock with no guard cover, and no value or cost');
select pg_temp.as_user('a3');
select ok((select bool_and(not (e ? 'uncovered') and not (e ? 'stock_value')) from jsonb_array_elements(public.get_stock_at_risk()) e),
  'RR-MC-08 a Storekeeper sees no cover flag and no value');
select pg_temp.as_user('a4');
select ok((select bool_and(not (e ? 'uncovered') and not (e ? 'stock_value')) from jsonb_array_elements(public.get_stock_at_risk()) e),
  'RR-MC-08 an Engineer with no job role sees no cover flag and no value, as before');
select pg_temp.as_user('a6');
select is((select (e->>'stock_value') from jsonb_array_elements(public.get_stock_at_risk()) e where e->>'warehouse_code' = 'SITE-A'),
  '5880.00', 'RR-MC-08 a Project Manager still reads the stock value');
reset role;

-- ── close-out items owned by a job role ──────────────────────────────────────────────────────────────────────────────────────────
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20400000-0000-0000-0000-0000000000c1', '20400000-0000-0000-0000-00000000000a', 'RRMC project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20400000-0000-0000-0000-0000000000a6');
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('20400000-0000-0000-0000-000000000f01', '20400000-0000-0000-0000-00000000000a', '20400000-0000-0000-0000-0000000000c1', 'Acceptance',
   'Material count', 'Approved', '20400000-0000-0000-0000-0000000000a1', '20400000-0000-0000-0000-00000000000a/20400000-0000-0000-0000-0000000000c1/20400000-0000-0000-0000-000000000f01/doc.pdf');
select pg_temp.as_user('a1');
select is(pg_temp.err($$select set_closeout_checklist('[{"name":"Material count","owner_job_role":"no_such_role"}]')$$), '23514 COT_OWNER_ROLE',
  'RR-MC-09 an owner that is not a job role is refused');
select set_closeout_checklist('[{"name":"Material count","owner_job_role":"material_coordinator"},{"name":"Final account"}]'::jsonb);
reset role;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20400000-0000-0000-0000-000000000031', '20400000-0000-0000-0000-00000000000a', '20400000-0000-0000-0000-0000000000c1', 'RRMC WO', 'Draft', 10000, 'exclusive', 0);
update work_orders set status = 'Issued', issued_at = now() where id = '20400000-0000-0000-0000-000000000031';
create function pg_temp.item(p_pos int) returns uuid language sql as $$
  select id from public.work_order_closeout_items where work_order_id = '20400000-0000-0000-0000-000000000031' and position = p_pos $$;
grant execute on function pg_temp.item(int) to authenticated;

select pg_temp.as_user('a3');
select is(pg_temp.err(format('select attach_closeout_item_document(%L, %L)', pg_temp.item(1), '20400000-0000-0000-0000-000000000f01')),
  '42501 only Finance, an Admin or the project''s manager can record close-out items', 'RR-MC-11 a Storekeeper cannot record the Material Coordinator''s item');
select pg_temp.as_user('a4');
select is(pg_temp.err(format('select attach_closeout_item_document(%L, %L)', pg_temp.item(1), '20400000-0000-0000-0000-000000000f01')),
  '42501 only Finance, an Admin or the project''s manager can record close-out items', 'RR-MC-11 an Engineer with no job role cannot record it, as before');
select pg_temp.as_user('a5');
select is(pg_temp.err(format('select attach_closeout_item_document(%L, %L)', pg_temp.item(1), '20400000-0000-0000-0000-000000000f01')),
  '42501 LIGHT_ACCOUNT', 'RR-MC-11 a field account cannot record it');
select pg_temp.as_user('a2');
select is(pg_temp.err(format('select attach_closeout_item_document(%L, %L)', pg_temp.item(1), '20400000-0000-0000-0000-000000000f01')),
  'ok', 'RR-MC-10 the item''s owner job role attaches its document');
select is(pg_temp.err(format('select complete_closeout_item(%L, current_date)', pg_temp.item(1))), 'ok', 'RR-MC-10 and marks it done');
select is(pg_temp.err(format('select attach_closeout_item_document(%L, %L)', pg_temp.item(2), '20400000-0000-0000-0000-000000000f01')),
  '42501 only Finance, an Admin or the project''s manager can record close-out items', 'RR-MC-12 the Material Coordinator cannot record an item it does not own');
reset role;

select * from finish();
rollback;
