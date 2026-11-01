-- Concurrent case authoring and enqueue use the same serialization boundary.
begin;
set local statement_timeout='5s';
select plan(22);
create extension if not exists dblink;
select dblink_connect('draft_lane', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));
select dblink_connect('draft_edit', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));
create temporary table draft_edit_backend(pid integer);
insert into draft_edit_backend select pid from dblink('draft_edit', 'select pg_backend_pid()') as t(pid integer);
create function pg_temp.wait_for_draft_lock(p_pid integer) returns boolean language plpgsql as $$
begin
  for n in 1..30 loop
    if exists (select 1 from pg_stat_activity where pid=p_pid and state='active' and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end $$;
select dblink_exec('draft_lane', $sql$
  delete from external_command_outbox where org_id='e6040000-0000-0000-0000-000000000001';
  delete from external_domain_ownership where org_id='e6040000-0000-0000-0000-000000000001';
  delete from procurement_items where org_id='e6040000-0000-0000-0000-000000000001';
  delete from procurements where org_id='e6040000-0000-0000-0000-000000000001';
  delete from profiles where org_id='e6040000-0000-0000-0000-000000000001';
  delete from organizations where id='e6040000-0000-0000-0000-000000000001';
  delete from auth.users where id='e6040000-0000-0000-0000-000000000002';
  insert into organizations(id,name) values ('e6040000-0000-0000-0000-000000000001','Interleave org');
  insert into auth.users(id,email) values ('e6040000-0000-0000-0000-000000000002','interleave@example.test');
  insert into profiles(id,org_id,full_name,email,role,status) values ('e6040000-0000-0000-0000-000000000002','e6040000-0000-0000-0000-000000000001','Interleave author','interleave@example.test','Engineer','active');
  insert into procurements(id,org_id,title,status,requested_by_id) values ('e6040000-0000-0000-0000-000000000003','e6040000-0000-0000-0000-000000000001','Draft case','Draft','e6040000-0000-0000-0000-000000000002');
  insert into procurement_items(id,org_id,procurement_id,name,quantity,rate) values ('e6040000-0000-0000-0000-000000000004','e6040000-0000-0000-0000-000000000001','e6040000-0000-0000-0000-000000000003','Item',1,10);
  insert into external_domain_ownership(org_id,external_tier,domain) values ('e6040000-0000-0000-0000-000000000001','erpnext','procurement');
$sql$);
select lives_ok($$ select dblink_exec('draft_lane', $sql$ begin; set local role service_role; insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('e6040000-0000-0000-0000-000000000001','procurement','malformed-child','malformed-key','erpnext','create','pending','{"procurementId":"not-a-uuid"}'); delete from external_command_outbox where idempotency_key='malformed-key'; commit $sql$) $$, 'Malformed generic case identity retains its insert behavior');
-- Generic adapter insert, without a captured source snapshot: edit holds the parent first.
select dblink_exec('draft_lane', 'begin');
select dblink_exec('draft_lane', $$ set local request.jwt.claims = '{"sub":"e6040000-0000-0000-0000-000000000002","role":"authenticated"}' $$);
select dblink_exec('draft_lane', $$ update procurement_items set quantity=2 where id='e6040000-0000-0000-0000-000000000004' $$);
select dblink_send_query('draft_edit', $$ insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,payload_digest,actor_user_id) values ('e6040000-0000-0000-0000-000000000001','procurement','generic-child','generic-a','erpnext','create','pending','{"procurementId":"E6040000000000000000000000000003","erp_doc_kind":"purchase-request"}','digest','e6040000-0000-0000-0000-000000000002') returning id::text $$);
select ok(pg_temp.wait_for_draft_lock((select pid from draft_edit_backend)), 'Generic enqueue reaches parent lock after edit');
select is(dblink_is_busy('draft_edit'), 1, 'Generic enqueue waits for the in-flight edit');
select dblink_exec('draft_lane', 'commit');
select is((select count(*) from dblink_get_result('draft_edit') as t(id text)), 1::bigint, 'Generic enqueue completes after the edit commits');
select * from dblink_get_result('draft_edit') as t(id text);
select dblink_exec('draft_lane', $$ delete from external_command_outbox where idempotency_key='generic-a'; update procurement_items set quantity=1 where id='e6040000-0000-0000-0000-000000000004' $$);
-- Generic enqueue holds the parent first; the waiting edit must see the committed evidence.
select dblink_exec('draft_lane', 'begin');
select dblink_exec('draft_lane', $$ insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,payload_digest,actor_user_id) values ('e6040000-0000-0000-0000-000000000001','procurement','generic-child','generic-b','erpnext','create','pending','{"procurementId":"E6040000-0000-0000-0000-000000000003","erp_doc_kind":"rfq"}','digest','e6040000-0000-0000-0000-000000000002') $$);
select dblink_exec('draft_edit', $$ set request.jwt.claims = '{"sub":"e6040000-0000-0000-0000-000000000002","role":"authenticated"}' $$);
select dblink_exec('draft_edit', 'begin');
select dblink_send_query('draft_edit', $$ update procurement_items set quantity=3 where id='e6040000-0000-0000-0000-000000000004' returning id::text $$);
select ok(pg_temp.wait_for_draft_lock((select pid from draft_edit_backend)), 'Edit reaches parent lock after generic enqueue');
select is(dblink_is_busy('draft_edit'), 1, 'Edit waits for the in-flight generic enqueue');
select dblink_exec('draft_lane', 'commit');
select is((select count(*) from dblink_get_result('draft_edit', false) as t(id text)), 0::bigint, 'Edit is refused after generic enqueue commits');
select matches(dblink_error_message('draft_edit'), 'procurement item values are read-only', 'Edit reports the committed evidence rule');
select is((select quantity from procurement_items where id='e6040000-0000-0000-0000-000000000004'), 1::numeric, 'Generic enqueue preserves the line value');
select * from dblink_get_result('draft_edit', false) as t(id text);
select dblink_exec('draft_edit', 'rollback');
select dblink_exec('draft_lane', $$ delete from external_command_outbox where idempotency_key='generic-b' $$);
select dblink_exec('draft_lane', 'begin');
select dblink_exec('draft_lane', $$ set local request.jwt.claims = '{"sub":"e6040000-0000-0000-0000-000000000002","role":"authenticated"}' $$);
select dblink_exec('draft_lane', $$ update procurement_items set quantity=2 where id='e6040000-0000-0000-0000-000000000004' $$);
set local lock_timeout='300ms';
select throws_ok($$ select public.insert_procurement_outbox_pending('e6040000-0000-0000-0000-000000000001','case-child','interleave-a','erpnext','create','{"procurementId":"E6040000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}','digest','e6040000-0000-0000-0000-000000000002','e6040000-0000-0000-0000-000000000003','[{"name":"Item","description":null,"quantity":1,"rate":10}]') $$, '55P03', null, 'Enqueue waits for a concurrent line edit');
set local lock_timeout=0;
select dblink_exec('draft_lane', 'commit');
select throws_ok($$ select public.insert_procurement_outbox_pending('e6040000-0000-0000-0000-000000000001','case-child','interleave-a','erpnext','create','{"procurementId":"E6040000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}','digest','e6040000-0000-0000-0000-000000000002','e6040000-0000-0000-0000-000000000003','[{"name":"Item","description":null,"quantity":1,"rate":10}]') $$, '40001', null, 'An older snapshot is rejected after the edit commits');
select dblink_exec('draft_lane', 'begin');
select * from dblink('draft_lane', $$ select (public.insert_procurement_outbox_pending('e6040000-0000-0000-0000-000000000001','case-child','interleave-b','erpnext','create','{"procurementId":"E6040000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}','digest','e6040000-0000-0000-0000-000000000002','e6040000-0000-0000-0000-000000000003','[{"name":"Item","description":null,"quantity":2,"rate":10}]')).id::text $$) as t(id text);
select dblink_exec('draft_edit', $$ set request.jwt.claims = '{"sub":"e6040000-0000-0000-0000-000000000002","role":"authenticated"}' $$);
select dblink_exec('draft_edit', 'begin');
select dblink_send_query('draft_edit', $$ update procurement_items set quantity=3 where id='e6040000-0000-0000-0000-000000000004' returning id::text $$);
select ok(pg_temp.wait_for_draft_lock((select pid from draft_edit_backend)), 'The second writer reaches a database lock');
select is(dblink_is_busy('draft_edit'), 1, 'The in-flight edit waits for the enqueue');
set local request.jwt.claims = '{"sub":"e6040000-0000-0000-0000-000000000002","role":"authenticated"}';
set local lock_timeout='300ms';
select throws_ok($$ update procurement_items set quantity=3 where id='e6040000-0000-0000-0000-000000000004' $$, '55P03', null, 'Line edit waits for a concurrent enqueue');
select throws_ok($$ select public.insert_procurement_outbox_pending('e6040000-0000-0000-0000-000000000001','case-child','interleave-b','erpnext','create','{"procurementId":"e6040000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}','digest','e6040000-0000-0000-0000-000000000002','e6040000-0000-0000-0000-000000000003','[{"name":"Item","description":null,"quantity":2,"rate":10}]') $$, '55P03', null, 'A duplicate enqueue waits for its existing key');
set local lock_timeout=0;
select dblink_exec('draft_lane', 'commit');
select is((select count(*) from dblink_get_result('draft_edit', false) as t(id text)), 0::bigint, 'The in-flight edit is refused after enqueue commits');
select matches(dblink_error_message('draft_edit'), 'procurement item values are read-only', 'The in-flight edit reports the case ownership rule');
select * from dblink_get_result('draft_edit', false) as t(id text);
select dblink_exec('draft_edit', 'rollback');
create function pg_temp.try_committed_edit() returns void language plpgsql as $$
begin
  update procurement_items set quantity=3 where id='e6040000-0000-0000-0000-000000000004';
  raise exception using errcode='P0002';
exception when sqlstate 'P0002' then
  return;
end $$;
select throws_ok($$ select pg_temp.try_committed_edit() $$, '42501', null, 'The committed command preserves its submitted values');
select throws_ok($$ select public.insert_procurement_outbox_pending('e6040000-0000-0000-0000-000000000001','case-child','interleave-b','erpnext','create','{"procurementId":"e6040000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}','digest','e6040000-0000-0000-0000-000000000002','e6040000-0000-0000-0000-000000000003','[{"name":"Item","description":null,"quantity":2,"rate":10}]') $$, '23505', null, 'Only one pending command owns the key');
select is((select quantity from procurement_items where id='e6040000-0000-0000-0000-000000000004'), 2::numeric, 'The recorded line stays intact');
select dblink_exec('draft_lane', 'begin');
select * from dblink('draft_lane', $$ select (public.insert_procurement_outbox_pending('e6040000-0000-0000-0000-000000000001','other-child','interleave-c','erpnext','create','{"procurementId":"e6040000-0000-0000-0000-000000000003","erp_doc_kind":"purchase-order"}','digest','e6040000-0000-0000-0000-000000000002','e6040000-0000-0000-0000-000000000003','[{"name":"Item","description":null,"quantity":2,"rate":10}]')).id::text $$) as t(id text);
set local lock_timeout='300ms';
select throws_ok($$ select public.claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='interleave-b')) $$, '55P03', null, 'Claim waits for a concurrent enqueue on the same case');
set local lock_timeout=0;
select dblink_exec('draft_lane', 'rollback');
create function pg_temp.claim_finishes(p_id uuid) returns boolean language plpgsql as $$
begin
  perform public.claim_outbox_for_commit(p_id);
  raise exception 'claim completed';
exception when raise_exception then
  return true;
end $$;
set local statement_timeout='2s';
select ok(pg_temp.claim_finishes((select id from external_command_outbox where idempotency_key='interleave-b')), 'Claim completes after the enqueue releases the case');
set local statement_timeout='5s';
select dblink_exec('draft_lane', $sql$
  delete from external_command_outbox where org_id='e6040000-0000-0000-0000-000000000001';
  delete from external_domain_ownership where org_id='e6040000-0000-0000-0000-000000000001';
  delete from procurement_items where org_id='e6040000-0000-0000-0000-000000000001';
  delete from procurements where org_id='e6040000-0000-0000-0000-000000000001';
  delete from profiles where org_id='e6040000-0000-0000-0000-000000000001';
  delete from organizations where id='e6040000-0000-0000-0000-000000000001';
  delete from auth.users where id='e6040000-0000-0000-0000-000000000002';
$sql$);
select dblink_disconnect('draft_lane');
select dblink_disconnect('draft_edit');
select * from finish();
rollback;
