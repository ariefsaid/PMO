begin;
select no_plan();
insert into public.organizations(id,name,default_currency) values
 ('03970000-0000-0000-0000-000000000001','Import protocol org','IDR'),
 ('03970000-0000-0000-0000-000000000002','Import protocol other','USD');
insert into auth.users(id,email) values
 ('03970000-0000-0000-0000-0000000000a1','t397admin@example.test'),
 ('03970000-0000-0000-0000-0000000000a2','t397pm@example.test'),
 ('03970000-0000-0000-0000-0000000000a3','t397disabled@example.test'),
 ('03970000-0000-0000-0000-0000000000a4','t397other@example.test'),
 ('03970000-0000-0000-0000-0000000000a5','t397finance@example.test'),
 ('03970000-0000-0000-0000-0000000000a6','t397executive@example.test'),
 ('03970000-0000-0000-0000-0000000000a7','t397viewer@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('03970000-0000-0000-0000-0000000000a1','03970000-0000-0000-0000-000000000001','Admin','t397admin@example.test','Admin','active'),
 ('03970000-0000-0000-0000-0000000000a2','03970000-0000-0000-0000-000000000001','PM','t397pm@example.test','Project Manager','active'),
 ('03970000-0000-0000-0000-0000000000a3','03970000-0000-0000-0000-000000000001','Disabled','t397disabled@example.test','Admin','disabled'),
 ('03970000-0000-0000-0000-0000000000a4','03970000-0000-0000-0000-000000000002','Other','t397other@example.test','Admin','active'),
 ('03970000-0000-0000-0000-0000000000a5','03970000-0000-0000-0000-000000000001','Finance','t397finance@example.test','Finance','active'),
 ('03970000-0000-0000-0000-0000000000a6','03970000-0000-0000-0000-000000000001','Executive','t397executive@example.test','Executive','active'),
 ('03970000-0000-0000-0000-0000000000a7','03970000-0000-0000-0000-000000000001','Engineer','t397viewer@example.test','Engineer','active');
insert into public.projects(id,org_id,code,name,status) values
 ('03970000-0000-0000-0000-000000000010','03970000-0000-0000-0000-000000000001','IMP397','Import','Ongoing Project'),
 ('03970000-0000-0000-0000-000000000011','03970000-0000-0000-0000-000000000002','IMP398','Other','Ongoing Project');
insert into public.budget_versions(id,org_id,project_id,version,name,status) values
 ('03970000-0000-0000-0000-000000000100','03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000010',1,'Draft','Draft'),
 ('03970000-0000-0000-0000-000000000101','03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000010',2,'Other Draft','Draft'),
 ('03970000-0000-0000-0000-000000000102','03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000010',3,'Archived','Archived'),
 ('03970000-0000-0000-0000-000000000103','03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000011',1,'Grafted','Draft'),
 ('03970000-0000-0000-0000-000000000104','03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000010',4,'Active','Active');
insert into public.budget_line_items(org_id,budget_version_id,category,description,budgeted_amount,import_key) values
 ('03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000100','Labor','old',10,'old-reference'),
 ('03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000100','Labor','old',10,'fp:ambiguous'),
 ('03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000100','Labor','old',10,'bimp2:historical');
create function pg_temp.claim(p_user text, p_client boolean default false) returns void language sql as $$
 select set_config('request.jwt.claims', (jsonb_build_object('sub',p_user,'role','authenticated') || case when p_client then '{"client_id":"client"}'::jsonb else '{}'::jsonb end)::text,true);
$$;
create function pg_temp.imp(p_key text,p_old text,p_ref boolean,p_version uuid default '03970000-0000-0000-0000-000000000100') returns text language sql as $$
 select outcome from public.import_budget_line_v2(p_version,'Labor','new',10,'2026','03970000-0000-0000-0000-0000000000b1',now(),p_key,p_old,p_ref);
$$;
select ok(has_function_privilege('authenticated','public.import_budget_line_v2(uuid,public.budget_category,text,numeric,text,uuid,timestamptz,text,text,boolean)','EXECUTE'),'authenticated can execute');
select ok(not has_function_privilege('anon','public.import_budget_line_v2(uuid,public.budget_category,text,numeric,text,uuid,timestamptz,text,text,boolean)','EXECUTE'),'anon cannot execute');
select ok(not pg_has_role('authenticated','postgres','MEMBER'),'authenticated is not trusted owner');
select ok(not pg_has_role('service_role','postgres','MEMBER'),'service is not trusted owner');
select ok(not has_function_privilege('service_role','public.import_budget_line_v2(uuid,public.budget_category,text,numeric,text,uuid,timestamptz,text,text,boolean)','EXECUTE'),'service cannot execute');
set local role authenticated;
select pg_temp.claim('03970000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.import_budget_line_v2('03970000-0000-0000-0000-000000000100','Labor','x',1.001,null,'03970000-0000-0000-0000-0000000000b1',now(),'a','a',true)$$,'22023',null,'fractional cents rejected');
select throws_ok($$select public.import_budget_line_v2('03970000-0000-0000-0000-000000000100','Labor','x',1,null,'03970000-0000-0000-0000-0000000000b1',now(),'','a',true)$$,'22023',null,'empty key rejected');
select lives_ok($$select pg_temp.imp('v2:' || repeat('a',5000),repeat('a',5000),true)$$,'long compressible reference fits existing index');
select is((select count(*)::int from public.budget_line_items where import_key='v2:' || repeat('a',5000)),1,'long reference creates a line');
select throws_ok($$select pg_temp.imp('v2:' || (select string_agg(md5(i::text),'') from generate_series(1,512) i),'large',true)$$,'54000',null,'reference exceeding index capacity is rejected');
select is(pg_temp.imp(' ',' ',true),'created','nonempty whitespace remains an opaque key');
select is(pg_temp.imp(' ',' ',true),'skipped','opaque whitespace key matches exactly');
select throws_ok($$select public.import_budget_line_v2('03970000-0000-0000-0000-000000000100','Labor','x',1,null,'03970000-0000-0000-0000-0000000000b1',now(),null,'a',true)$$,'22023',null,'null key rejected');
select is(pg_temp.imp('bimp2:new','new',true),'created','first import created');
select is(pg_temp.imp('bimp2:new','new',true),'skipped','repeat skips');
select is((select line_id from public.import_budget_line_v2('03970000-0000-0000-0000-000000000100','Labor','new',10,'2026','03970000-0000-0000-0000-0000000000b1',now(),'bimp2:new','new',true)),(select id from public.budget_line_items where import_key='bimp2:new'),'skip returns existing line');
select is(pg_temp.imp('bimp2:distinct','distinct',true),'created','distinct reference creates');
select is(pg_temp.imp('bimp2:new','fp:ambiguous',false),'conflict','historical conflict takes priority over matching v2');
select is(pg_temp.imp('bimp2:unicode-é','unicode-é',true),'created','Unicode key accepted');
select is(pg_temp.imp('bimp2:unicode-é','unicode-é',true),'created','distinct Unicode bytes create');
select is((select actual_amount from public.budget_line_items where import_key='bimp2:new'),0::numeric,'actual amount retains default');
select is((select import_origin::int from public.budget_line_items where import_key='bimp2:new'),2,'origin marked');
select is((select import_batch_id from public.budget_line_items where import_key='bimp2:new'),'03970000-0000-0000-0000-0000000000b1'::uuid,'batch retained');
select is((select imported_at from public.budget_line_items where import_key='bimp2:new'),now(),'import timestamp retained');
select is(pg_temp.imp('bimp2:other','old-reference',true),'skipped','established legacy reference skips');
select is(pg_temp.imp('bimp2:fp','fp:ambiguous',true),'conflict','ambiguous reference conflicts');
select is((select line_id from public.import_budget_line_v2('03970000-0000-0000-0000-000000000100','Labor','new',10,'2026','03970000-0000-0000-0000-0000000000b1',now(),'bimp2:fp','fp:ambiguous',true)),(select id from public.budget_line_items where import_key='fp:ambiguous'),'conflict returns the existing line');
select is(pg_temp.imp('bimp2:fp','fp:ambiguous',false),'conflict','ambiguous fingerprint conflicts');
select is(pg_temp.imp('bimp2:historical','another',true),'conflict','historical v2-shaped key conflicts');
select is(pg_temp.imp('bimp2:different','bimp2:new',true),'created','v2 legacy candidate alone does not block');
select is(pg_temp.imp('bimp2:new','new',true,'03970000-0000-0000-0000-000000000101'),'created','different version independent');
select throws_ok($$select pg_temp.imp('grafted','grafted',true,'03970000-0000-0000-0000-000000000103')$$,'P0002',null,'grafted parent unavailable');
select throws_ok($$select pg_temp.imp('active','active',true,'03970000-0000-0000-0000-000000000104')$$,'P0001',null,'active version rejected');
select throws_ok($$select pg_temp.imp('archived','archived',true,'03970000-0000-0000-0000-000000000102')$$,'P0001',null,'archived version rejected');
select throws_ok($$insert into public.budget_line_items(org_id,budget_version_id,category,import_key) values ('03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000100','Labor','direct')$$,'42501',null,'keyed direct insert rejected');
select throws_ok($$update public.budget_line_items set import_origin=2 where import_key='old-reference'$$,'42501',null,'marker update rejected');
select throws_ok($$update public.budget_line_items set import_key='changed' where import_key='bimp2:new'$$,'42501',null,'key update rejected');
select throws_ok($$update public.budget_line_items set budget_version_id='03970000-0000-0000-0000-000000000101' where import_key='bimp2:new'$$,'42501',null,'imported version update rejected');
select throws_ok($$update public.budget_line_items set org_id='03970000-0000-0000-0000-000000000002' where import_key='bimp2:new'$$,'42501',null,'cross-org edit rejected');
select throws_ok($$insert into public.budget_line_items(org_id,budget_version_id,category,import_origin) values ('03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000100','Labor',2)$$,'42501',null,'marker insert rejected');
select lives_ok($$update public.budget_line_items set description='edited',budgeted_amount=11 where import_key='bimp2:new'$$,'content edit succeeds');
select is(pg_temp.imp('bimp2:new','new',true),'skipped','edited content still skips');
select lives_ok($$insert into public.budget_line_items(org_id,budget_version_id,category,description) values ('03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000100','Labor','manual')$$,'manual insert succeeds');
select lives_ok($$delete from public.budget_line_items where description='manual'$$,'manual delete succeeds');
select lives_ok($$select public.clone_budget_version('03970000-0000-0000-0000-000000000100')$$,'clone succeeds');
select is((select count(*)::int from public.budget_line_items li join public.budget_versions v on v.id=li.budget_version_id where v.project_id='03970000-0000-0000-0000-000000000010' and v.version=5 and (li.import_key is not null or li.import_origin is not null)),0,'cloned lines are keyless');
select ok(exists(select 1 from public.budget_version_editors where budget_version_id='03970000-0000-0000-0000-000000000100' and user_id='03970000-0000-0000-0000-0000000000a1'),'editor captured');
select is((select currency from public.budget_versions where id='03970000-0000-0000-0000-000000000100'),'IDR','version currency preserved');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a2');
select is(pg_temp.imp('bimp2:pm','pm',true),'created','project manager allowed');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a5');
select is(pg_temp.imp('bimp2:finance','finance',true),'created','finance allowed');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a6');
select is(pg_temp.imp('bimp2:executive','executive',true),'created','executive allowed');
select pg_temp.claim('00000000-0000-0000-0000-000000000000');
select throws_ok($$select pg_temp.imp('unknown','unknown',true)$$,'42501',null,'unknown member denied');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a3');
select throws_ok($$select pg_temp.imp('disabled','disabled',true)$$,'42501',null,'inactive denied');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a7');
select throws_ok($$select pg_temp.imp('viewer','viewer',true)$$,'42501',null,'viewer denied');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a4');
select throws_ok($$select pg_temp.imp('other','other',true)$$,'P0002',null,'cross-org version unavailable');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a1',true);
select set_config('request.method','POST',true),set_config('request.path','/rpc/import_budget_line_v2',true),set_config('request.headers','{}',true);
select lives_ok('select public.api_client_request_guard()','admin client allowed');
select pg_temp.claim('03970000-0000-0000-0000-0000000000a2',true);
select throws_ok('select public.api_client_request_guard()','42501',null,'non-admin client denied');
reset role;
set local role service_role;
select throws_ok($$insert into public.budget_line_items(org_id,budget_version_id,category,import_key) values ('03970000-0000-0000-0000-000000000001','03970000-0000-0000-0000-000000000100','Labor','service-key')$$,'42501',null,'service direct identity rejected');
reset role;
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='budget_line_items_import_lookup_c_idx'
  and indexdef like '%COLLATE "C"%' and indexdef not like '%UNIQUE%'), 'binary-collated lookup index supports classification');
select * from finish();
rollback;
