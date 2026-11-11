begin;
select plan(8);
create extension if not exists dblink;
select dblink_connect('atomic_a', format('dbname=%s user=%s password=postgres host=%s port=%s',current_database(),current_user,coalesce(host(inet_server_addr()),'supabase_db_pmo-portal'),coalesce(inet_server_port(),5432)));
select dblink_connect('atomic_b', format('dbname=%s user=%s password=postgres host=%s port=%s',current_database(),current_user,coalesce(host(inet_server_addr()),'supabase_db_pmo-portal'),coalesce(inet_server_port(),5432)));
select dblink_exec('atomic_a', $$
  insert into organizations (id,name) values ('f5010000-0000-0000-0000-000000000001','Atomic concurrent');
  insert into auth.users (id,email) values ('f5010000-0000-0000-0000-000000000002','atomic-concurrent@example.test');
  insert into profiles (id,org_id,full_name,email,role) values ('f5010000-0000-0000-0000-000000000002','f5010000-0000-0000-0000-000000000001','Atomic','atomic-concurrent@example.test','Engineer');
$$);
select dblink_exec('atomic_a', $$set request.jwt.claims = '{"sub":"f5010000-0000-0000-0000-000000000002","role":"authenticated"}'$$);
select dblink_exec('atomic_b', $$set request.jwt.claims = '{"sub":"f5010000-0000-0000-0000-000000000002","role":"authenticated"}'$$);
select dblink_exec('atomic_a','begin');
select * from dblink('atomic_a', $$select (public.create_procurement_with_items('f5010000-0000-0000-0000-000000000010','{"title":"Concurrent","project_id":null,"vendor_id":null}','[{"id":"f5010000-0000-0000-0000-000000000011","name":"Line","quantity":1,"rate":2}]')).id::text$$) as t(id text);
select dblink_send_query('atomic_b', $$select (public.create_procurement_with_items('f5010000-0000-0000-0000-000000000010','{"title":"Concurrent","project_id":null,"vendor_id":null}','[{"id":"f5010000-0000-0000-0000-000000000011","name":"Line","quantity":1,"rate":2}]')).id::text$$);
create function pg_temp.wait_atomic() returns boolean language plpgsql as $$
begin
  for n in 1..30 loop
    if exists (select 1 from pg_stat_activity where query like '%create_procurement_with_items%' and wait_event_type='Lock' and pid<>pg_backend_pid()) then return true; end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end $$;
select ok(pg_temp.wait_atomic(),'second session waits for first');
select is(dblink_is_busy('atomic_b'),1,'retry remains pending while first is uncommitted');
select dblink_exec('atomic_a','commit');
select is((select id from dblink_get_result('atomic_b') as t(id text)),'f5010000-0000-0000-0000-000000000010','retry returns original ID');
select * from dblink_get_result('atomic_b') as t(id text);
select is((select count(*) from public.procurements where id='f5010000-0000-0000-0000-000000000010'),1::bigint,'one header committed');
select is((select count(*) from public.procurement_items where procurement_id='f5010000-0000-0000-0000-000000000010'),1::bigint,'one line committed');
select dblink_exec('atomic_a','begin');
select * from dblink('atomic_a', $$select (public.create_procurement_with_items('f5010000-0000-0000-0000-000000000020','{"title":"Rollback","project_id":null,"vendor_id":null}','[{"id":"f5010000-0000-0000-0000-000000000021","name":"Line","quantity":1,"rate":2}]')).id::text$$) as t(id text);
select dblink_send_query('atomic_b', $$select (public.create_procurement_with_items('f5010000-0000-0000-0000-000000000020','{"title":"Rollback","project_id":null,"vendor_id":null}','[{"id":"f5010000-0000-0000-0000-000000000021","name":"Line","quantity":1,"rate":2}]')).id::text$$);
select ok(pg_temp.wait_atomic(),'retry waits for first transaction that rolls back');
select dblink_exec('atomic_a','rollback');
select is((select id from dblink_get_result('atomic_b') as t(id text)),'f5010000-0000-0000-0000-000000000020','retry creates after rollback');
select * from dblink_get_result('atomic_b') as t(id text);
select is((select count(*) from public.procurement_items where procurement_id='f5010000-0000-0000-0000-000000000020'),1::bigint,'rollback and retry commit only one line');
select dblink_exec('atomic_a', $$delete from procurements where id in ('f5010000-0000-0000-0000-000000000010','f5010000-0000-0000-0000-000000000020'); delete from profiles where id='f5010000-0000-0000-0000-000000000002'; delete from auth.users where id='f5010000-0000-0000-0000-000000000002'; delete from organizations where id='f5010000-0000-0000-0000-000000000001'$$);
select dblink_disconnect('atomic_a');
select dblink_disconnect('atomic_b');
select * from finish();
rollback;
