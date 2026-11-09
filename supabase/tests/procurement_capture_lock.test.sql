-- procurement_capture_lock.test.sql — #2039. Capturing a purchase request takes the same row lock on the purchase that
-- transition_procurement (0766) takes before adopting a captured request, so a capture racing Draft -> Requested waits
-- instead of creating a second request. A second session (dblink, committed fixtures, deleted at the end) holds the lock.
-- password=postgres is the Supabase LOCAL default; this file only runs under `supabase test db`.
begin;
select plan(4);
create extension if not exists dblink;
select dblink_connect('cap_lock', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));
select dblink_exec('cap_lock', $sql$
  delete from purchase_requests where procurement_id='20390000-0000-0000-0000-000000000003';
  delete from procurement_doc_counters where org_id='20390000-0000-0000-0000-000000000001';
  delete from procurements where org_id='20390000-0000-0000-0000-000000000001';
  delete from profiles where org_id='20390000-0000-0000-0000-000000000001';
  delete from organizations where id='20390000-0000-0000-0000-000000000001';
  delete from auth.users where id='20390000-0000-0000-0000-000000000002';
  insert into organizations(id,name) values ('20390000-0000-0000-0000-000000000001','Capture lock org');
  insert into auth.users(id,email) values ('20390000-0000-0000-0000-000000000002','capture-lock@example.test');
  insert into profiles(id,org_id,full_name,email,role,status) values ('20390000-0000-0000-0000-000000000002','20390000-0000-0000-0000-000000000001','PM','capture-lock@example.test','Project Manager','active');
  insert into procurements(id,org_id,title,status,requested_by_id) values ('20390000-0000-0000-0000-000000000003','20390000-0000-0000-0000-000000000001','Capture lock','Draft','20390000-0000-0000-0000-000000000002');
$sql$);

-- the other session holds the purchase row lock as an in-flight transition does. FOR NO KEY UPDATE, not FOR UPDATE: the latter
-- also blocks the insert's foreign-key check, so the capture would wait with or without the function's own lock.
select dblink_exec('cap_lock', 'begin');
select ok((select count(*)::int from dblink('cap_lock', $q$select id::text from procurements where id='20390000-0000-0000-0000-000000000003' for no key update$q$) as t(id text)) = 1,
  '#2039 a second session holds the purchase lock');

set local role authenticated;
set local request.jwt.claims = '{"sub":"20390000-0000-0000-0000-000000000002","role":"authenticated"}';
set local lock_timeout = '300ms';
select throws_ok($$ select create_purchase_request('20390000-0000-0000-0000-000000000003','REF-LOCK','Draft',current_date,100) $$,
  '55P03', null, '#2039 a capture waits for the purchase lock');
set local lock_timeout = 0;
reset role;

select dblink_exec('cap_lock', 'commit');
-- once released, a capture (run in the second session so this transaction never holds the row the cleanup deletes)
select dblink_exec('cap_lock', $$ begin; set local request.jwt.claims = '{"sub":"20390000-0000-0000-0000-000000000002","role":"authenticated"}'; set local role authenticated; set local lock_timeout = '3s' $$);
select lives_ok($$ select * from dblink('cap_lock', $q$select (create_purchase_request('20390000-0000-0000-0000-000000000003','REF-LOCK','Draft',current_date,100)).id::text$q$) as t(id text) $$, '#2039 once released, the capture succeeds');
select dblink_exec('cap_lock', 'commit');
select is((select count(*) from purchase_requests where procurement_id='20390000-0000-0000-0000-000000000003'), 1::bigint, '#2039 exactly one request captured');

select dblink_exec('cap_lock', $sql$
  delete from purchase_requests where procurement_id='20390000-0000-0000-0000-000000000003';
  delete from procurement_doc_counters where org_id='20390000-0000-0000-0000-000000000001';
  delete from procurements where org_id='20390000-0000-0000-0000-000000000001';
  delete from profiles where org_id='20390000-0000-0000-0000-000000000001';
  delete from organizations where id='20390000-0000-0000-0000-000000000001';
  delete from auth.users where id='20390000-0000-0000-0000-000000000002';
$sql$);
select dblink_disconnect('cap_lock');
select * from finish();
rollback;
