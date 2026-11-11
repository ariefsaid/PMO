-- Draft line authoring and external-document boundaries.
begin;
select plan(30);
create function pg_temp.item_values_editable(p_case uuid) returns boolean language plpgsql as $$
declare answer boolean;
begin
  if to_regprocedure('public.procurement_item_values_editable(uuid)') is null then return null; end if;
  execute 'select public.procurement_item_values_editable($1)' into answer using p_case;
  return answer;
end $$;
insert into organizations(id,name) values ('e6030000-0000-0000-0000-000000000001','Draft case org');
insert into auth.users(id,email) values ('e6030000-0000-0000-0000-000000000002','draft-case@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('e6030000-0000-0000-0000-000000000002','e6030000-0000-0000-0000-000000000001','Draft author','draft-case@example.test','Engineer','active');
insert into procurements(id,org_id,title,status,requested_by_id) values ('e6030000-0000-0000-0000-000000000003','e6030000-0000-0000-0000-000000000001','Draft case','Draft','e6030000-0000-0000-0000-000000000002');
insert into procurements(id,org_id,title,status,requested_by_id) values ('e6030000-0000-0000-0000-000000000014','e6030000-0000-0000-0000-000000000001','Second Draft','Draft','e6030000-0000-0000-0000-000000000002');
insert into procurement_items(id,org_id,procurement_id,name,quantity,rate) values ('e6030000-0000-0000-0000-000000000004','e6030000-0000-0000-0000-000000000001','e6030000-0000-0000-0000-000000000003','Item',1,10);
insert into organizations(id,name) values ('e6030000-0000-0000-0000-000000000011','Other org');
insert into auth.users(id,email) values ('e6030000-0000-0000-0000-000000000012','other-actor@example.test'), ('e6030000-0000-0000-0000-000000000013','other-org@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
  ('e6030000-0000-0000-0000-000000000012','e6030000-0000-0000-0000-000000000001','Other actor','other-actor@example.test','Engineer','active'),
  ('e6030000-0000-0000-0000-000000000013','e6030000-0000-0000-0000-000000000011','Other org actor','other-org@example.test','Admin','active');
insert into procurements(id,org_id,title,status,requested_by_id) values
  ('e6030000-0000-0000-0000-000000000015','e6030000-0000-0000-0000-000000000011','Native Draft','Draft','e6030000-0000-0000-0000-000000000013'),
  ('e6030000-0000-0000-0000-000000000016','e6030000-0000-0000-0000-000000000011','Native destination','Draft','e6030000-0000-0000-0000-000000000013');
insert into procurement_items(id,org_id,procurement_id,name,quantity,rate) values
  ('e6030000-0000-0000-0000-000000000017','e6030000-0000-0000-0000-000000000011','e6030000-0000-0000-0000-000000000015','Native item',1,10);
insert into external_domain_ownership(org_id,external_tier,domain) values ('e6030000-0000-0000-0000-000000000001','erpnext','procurement');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6030000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.item_values_editable('e6030000-0000-0000-0000-000000000003'), true, 'Draft requester can edit line values');
select lives_ok($$ update procurement_items set quantity=2, rate=20 where id='e6030000-0000-0000-0000-000000000004' $$, 'Draft requester edits quantity and rate');
select is((select quantity from procurement_items where id='e6030000-0000-0000-0000-000000000004'), 2::numeric, 'Draft edit is persisted');
select is((select amount from procurement_items where id='e6030000-0000-0000-0000-000000000004'), 40::numeric, 'Draft amount follows quantity and rate');
reset role;
update profiles set status='disabled' where id='e6030000-0000-0000-0000-000000000002';
set local role authenticated;
select is(pg_temp.item_values_editable('e6030000-0000-0000-0000-000000000003'), false, 'Inactive members cannot edit line values');
select results_eq($$ update procurement_items set quantity=8 where id='e6030000-0000-0000-0000-000000000004' returning id $$, $$ select null::uuid where false $$, 'Inactive members cannot update the line');
reset role;
update profiles set status='active' where id='e6030000-0000-0000-0000-000000000002';
insert into org_features(org_id,feature_key,enabled) values ('e6030000-0000-0000-0000-000000000001','procurement',false);
set local role authenticated;
select is(pg_temp.item_values_editable('e6030000-0000-0000-0000-000000000003'), false, 'Disabled procurement hides line value editing');
select results_eq($$ update procurement_items set quantity=8 where id='e6030000-0000-0000-0000-000000000004' returning id $$, $$ select null::uuid where false $$, 'Disabled procurement prevents line updates');
reset role;
delete from org_features where org_id='e6030000-0000-0000-0000-000000000001' and feature_key='procurement';
set local role authenticated;
select throws_ok($$ update procurement_items set erp_line_amount=2 where id='e6030000-0000-0000-0000-000000000004' $$, '42501', null, 'Machine values remain protected');
select throws_ok($$ update procurement_items set procurement_id='e6030000-0000-0000-0000-000000000014' where id='e6030000-0000-0000-0000-000000000004' $$, '42501', null, 'External line stays with its original case');
set local request.jwt.claims = '{"sub":"e6030000-0000-0000-0000-000000000012","role":"authenticated"}';
select results_eq($$ update procurement_items set quantity=5 where id='e6030000-0000-0000-0000-000000000004' returning id $$, $$ select null::uuid where false $$, 'Other Engineer cannot edit the case');
select is(pg_temp.item_values_editable('e6030000-0000-0000-0000-000000000003'), false, 'Other Engineer cannot edit line values');
set local request.jwt.claims = '{"sub":"e6030000-0000-0000-0000-000000000013","role":"authenticated"}';
select results_eq($$ update procurement_items set quantity=5 where id='e6030000-0000-0000-0000-000000000004' returning id $$, $$ select null::uuid where false $$, 'Other organization cannot edit the case');
select lives_ok($$ update procurement_items set quantity=2 where id='e6030000-0000-0000-0000-000000000017' $$, 'Native case values remain editable');
select lives_ok($$ update procurement_items set procurement_id='e6030000-0000-0000-0000-000000000016' where id='e6030000-0000-0000-0000-000000000017' $$, 'Native case retains its parent update contract');
reset role;
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('e6030000-0000-0000-0000-000000000001','procurement','e6030000-0000-0000-0000-000000000005','draft-test','erpnext','create','pending',jsonb_build_object('procurementId','e6030000-0000-0000-0000-000000000003','erp_doc_kind','purchase-order'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6030000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ update procurement_items set quantity=3 where id='e6030000-0000-0000-0000-000000000004' $$, '42501', null, 'Pending case command preserves its submitted lines');
select is(pg_temp.item_values_editable('e6030000-0000-0000-0000-000000000003'), false, 'Pending command makes line values read-only');
select throws_ok($attempt$ do $body$
  begin
    update procurement_items set procurement_id='e6030000-0000-0000-0000-000000000014' where id='e6030000-0000-0000-0000-000000000004';
    update procurement_items set quantity=99 where id='e6030000-0000-0000-0000-000000000004';
    update procurement_items set procurement_id='e6030000-0000-0000-0000-000000000003' where id='e6030000-0000-0000-0000-000000000004';
  end $body$ $attempt$, '42501', null, 'An external line remains bound to its original case throughout editing');
select is((select quantity from procurement_items where id='e6030000-0000-0000-0000-000000000004'), 2::numeric, 'The original case keeps its submitted value');
reset role;
select throws_ok($$ select public.insert_procurement_outbox_pending(
  'e6030000-0000-0000-0000-000000000001', 'e6030000-0000-0000-0000-000000000006', 'snapshot-test',
  'erpnext', 'create', '{"procurementId":"e6030000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}',
  'digest', 'e6030000-0000-0000-0000-000000000002', 'e6030000-0000-0000-0000-000000000003',
  '[{"name":"Item","description":null,"quantity":99,"rate":10}]'::jsonb) $$,
  '40001', null, 'Stale line snapshot refuses a pending command');
select lives_ok($$ select public.insert_procurement_outbox_pending(
  'e6030000-0000-0000-0000-000000000001', 'e6030000-0000-0000-0000-000000000007', 'matching-snapshot',
  'erpnext', 'create', '{"procurementId":"e6030000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}',
  'digest', 'e6030000-0000-0000-0000-000000000002', 'e6030000-0000-0000-0000-000000000003',
  '[{"name":"Item","description":null,"quantity":2,"rate":20}]'::jsonb) $$,
  'Matching line snapshot creates the pending command');
select is((select count(*) from external_command_outbox where idempotency_key='snapshot-test'), 0::bigint, 'Stale snapshot leaves no pending command');
select throws_ok($$ select public.insert_procurement_outbox_pending(
  'e6030000-0000-0000-0000-000000000001', 'e6030000-0000-0000-0000-000000000009', 'receipt-without-witness',
  'erpnext', 'create', '{"procurementId":"e6030000-0000-0000-0000-000000000003","erp_doc_kind":"goods-receipt"}',
  'digest', 'e6030000-0000-0000-0000-000000000002', 'e6030000-0000-0000-0000-000000000003',
  '[{"name":"Item","description":null,"quantity":2,"rate":20}]'::jsonb) $$,
  '22023', null, 'A new receipt snapshot requires its server-held caller witness');
select is((select to_jsonb(v)->>'procurement_input_digest' from public.insert_procurement_outbox_pending(
  'e6030000-0000-0000-0000-000000000001', 'e6030000-0000-0000-0000-000000000008', 'receipt-witness',
  'erpnext', 'create', jsonb_build_object('procurementId','e6030000-0000-0000-0000-000000000003',
    'erp_doc_kind','goods-receipt','pmo_gr_snapshot',jsonb_build_object('raw_digest',repeat('a',64))),
  'digest', 'e6030000-0000-0000-0000-000000000002', 'e6030000-0000-0000-0000-000000000003',
  '[{"name":"Item","description":null,"quantity":2,"rate":20}]'::jsonb) v), repeat('a',64), 'Receipt snapshots receive a server-held caller witness');
select ok(exists (select 1 from information_schema.columns where table_schema='public' and table_name='external_command_outbox' and column_name='procurement_input_digest'), 'Receipt caller witness column exists');
select ok(not coalesce((select has_column_privilege('authenticated', 'public.external_command_outbox', column_name, 'SELECT')
  from information_schema.columns where table_schema='public' and table_name='external_command_outbox' and column_name='procurement_input_digest'), false), 'Receipt caller witness is private to the server');
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ update procurement_items set procurement_id='e6030000-0000-0000-0000-000000000014' where id='e6030000-0000-0000-0000-000000000004' $$, 'Service mirror can move a line');
select lives_ok($$ update procurement_items set procurement_id='e6030000-0000-0000-0000-000000000003' where id='e6030000-0000-0000-0000-000000000004' $$, 'Service mirror can restore a line');
select ok(to_regprocedure('public.insert_procurement_outbox_pending(uuid,text,text,text,text,jsonb,text,uuid,uuid,jsonb)') is not null, 'Snapshot enqueue function exists');
select ok(not coalesce(has_function_privilege('authenticated', to_regprocedure('public.insert_procurement_outbox_pending(uuid,text,text,text,text,jsonb,text,uuid,uuid,jsonb)'), 'EXECUTE'), false), 'Snapshot enqueue is not a client operation');
select * from finish();
rollback;
