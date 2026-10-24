-- m365_documents_batch_serialization.test.sql — link_m365_documents_batch (0375): a dry run predicts exactly what the
-- real call does (inside-the-batch conflicts and constraint refusals included) and changes nothing; a missing kind
-- is refused; a folder linked to another record is refused; and the per-folder lock is the same one the canonical
-- folder RPC (m365_link_record_folder, 0338) takes, held by a genuinely concurrent second session (dblink idiom).
-- password=postgres is the Supabase LOCAL default; this file only runs under `supabase test db`.
begin;
select plan(13);
create extension if not exists dblink;
insert into organizations(id,name,default_currency) values ('03750000-0000-0000-0000-0000000000c0','Batch serialization','IDR');
insert into auth.users(id,email) values ('03750000-0000-0000-0000-0000000000c1','bs-fin@example.com'),('03750000-0000-0000-0000-0000000000c6','bs-admin@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
('03750000-0000-0000-0000-0000000000c1','03750000-0000-0000-0000-0000000000c0','Finance','bs-fin@example.com','Finance','active'),
('03750000-0000-0000-0000-0000000000c6','03750000-0000-0000-0000-0000000000c0','Admin','bs-admin@example.com','Admin','active');
insert into projects(id,org_id,name,code) values
('03750000-0000-0000-0000-0000000000d1','03750000-0000-0000-0000-0000000000c0','Project one','BS-1'),
('03750000-0000-0000-0000-0000000000d2','03750000-0000-0000-0000-0000000000c0','Project two','BS-2');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values
('03750000-0000-0000-0000-0000000000e1','03750000-0000-0000-0000-0000000000c0','Purchase one','03750000-0000-0000-0000-0000000000c1','IDR',1,'Draft'),
('03750000-0000-0000-0000-0000000000e2','03750000-0000-0000-0000-0000000000c0','Purchase two','03750000-0000-0000-0000-0000000000c1','IDR',1,'Draft');
insert into org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by) values
('03750000-0000-0000-0000-0000000000c0','x.sharepoint.com,site-a,web-a','Site','drive-a','Library','03750000-0000-0000-0000-0000000000c6');
create function pg_temp.docs() returns int language sql as $$
  select ((select count(*) from public.project_documents where project_id in ('03750000-0000-0000-0000-0000000000d1','03750000-0000-0000-0000-0000000000d2'))
    + (select count(*) from public.procurement_documents where procurement_id in ('03750000-0000-0000-0000-0000000000e1','03750000-0000-0000-0000-0000000000e2')))::int $$;
grant execute on function pg_temp.docs() to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03750000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- Two rows linking one folder to two different projects: the real call refuses the second row.
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03750000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"f1","web_url":"https://x.sharepoint.com/f1","name":"F1","kind":"folder"},{"project_id":"03750000-0000-0000-0000-0000000000d2","drive_id":"d1","item_id":"f1","web_url":"https://x.sharepoint.com/f1","name":"F1","kind":"folder"}]'::jsonb,true)$q$,
  '23514','folder already linked to another project','a dry run of one folder for two projects predicts the real refusal');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03750000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"f1","web_url":"https://x.sharepoint.com/f1","name":"F1","kind":"folder"},{"project_id":"03750000-0000-0000-0000-0000000000d2","drive_id":"d1","item_id":"f1","web_url":"https://x.sharepoint.com/f1","name":"F1","kind":"folder"}]'::jsonb,false)$q$,
  '23514','folder already linked to another project','the real call refuses one folder for two projects');
select throws_ok($q$select public.link_m365_documents_batch('[{"procurement_id":"03750000-0000-0000-0000-0000000000e1","drive_id":"d1","item_id":"f2","web_url":"https://x.sharepoint.com/f2","name":"F2","kind":"folder"},{"procurement_id":"03750000-0000-0000-0000-0000000000e2","drive_id":"d1","item_id":"f2","web_url":"https://x.sharepoint.com/f2","name":"F2","kind":"folder"}]'::jsonb,true)$q$,
  '23514','folder already linked to another purchase','a dry run of one folder for two purchases predicts the real refusal');
select is(pg_temp.docs(),0,'refused batches and dry runs leave no rows');

-- A successful dry run reports the plan, the second row sees the first, and nothing is written.
select is((public.link_m365_documents_batch('[{"project_id":"03750000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"a1","web_url":"https://x.sharepoint.com/a1","name":"A1","kind":"file"},{"project_id":"03750000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"a1","web_url":"https://x.sharepoint.com/a1","name":"A1","kind":"file"}]'::jsonb,true)),
  '{"dry_run":true,"results":[{"row":1,"state":"linked","document_id":null},{"row":2,"state":"already_linked","document_id":null}]}'::jsonb,
  'a dry run reports the same per-row states the real call returns, without document ids');
select is(pg_temp.docs(),0,'a successful dry run writes nothing');

-- A missing kind is refused, dry run and real alike.
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03750000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"k1","web_url":"https://x.sharepoint.com/k1","name":"K1"}]'::jsonb,true)$q$,
  '22023','invalid document link row 1','a dry run refuses a row with no kind');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03750000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"k1","web_url":"https://x.sharepoint.com/k1","name":"K1","kind":null}]'::jsonb,false)$q$,
  '22023','invalid document link row 1','the real call refuses a null kind');

-- A folder already linked to another record is refused.
select lives_ok($q$select public.link_m365_documents_batch('[{"project_id":"03750000-0000-0000-0000-0000000000d1","drive_id":"d1","item_id":"f3","web_url":"https://x.sharepoint.com/f3","name":"F3","kind":"folder"}]'::jsonb,false)$q$,
  'a folder links to its first project');
select throws_ok($q$select public.link_m365_documents_batch('[{"project_id":"03750000-0000-0000-0000-0000000000d2","drive_id":"d1","item_id":"f3","web_url":"https://x.sharepoint.com/f3","name":"F3","kind":"folder"}]'::jsonb,true)$q$,
  '23514','folder already linked to another project','a folder already linked to another project is refused');
reset role;

-- Concurrency: a second session holds the canonical per-folder lock (0338 key); the batch waits on that same lock.
select dblink_connect('bs_folder', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));
select dblink_exec('bs_folder', 'begin');
select ok((select count(*)::int from dblink('bs_folder', format($q$select pg_advisory_xact_lock(%s)$q$,
  hashtextextended('m365-folder-item:03750000-0000-0000-0000-0000000000c0:d1:f4', 0))) as t(a text)) = 1,
  'a second session holds the per-folder lock the canonical folder RPC takes');
set local lock_timeout = '200ms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03750000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($q$select public.link_m365_documents_batch('[{"procurement_id":"03750000-0000-0000-0000-0000000000e1","drive_id":"d1","item_id":"f4","web_url":"https://x.sharepoint.com/f4","name":"F4","kind":"folder"}]'::jsonb,false)$q$,
  '55P03','canceling statement due to lock timeout','a batch folder link waits for the per-folder lock held by another writer');
reset role;
select dblink_exec('bs_folder', 'commit');
select dblink_disconnect('bs_folder');
set local lock_timeout = 0;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03750000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((public.link_m365_documents_batch('[{"procurement_id":"03750000-0000-0000-0000-0000000000e1","drive_id":"d1","item_id":"f4","web_url":"https://x.sharepoint.com/f4","name":"F4","kind":"folder"}]'::jsonb,false))->'results'->0->>'state',
  'linked','once the other writer ends the same batch link proceeds');
reset role;
select * from finish();
rollback;
