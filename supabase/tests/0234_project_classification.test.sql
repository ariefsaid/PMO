-- #770 classification configuration, tenant boundaries and CLI-shaped writes.
begin;
select plan(28);
insert into organizations(id,name) values
 ('02320000-0000-0000-0000-000000000001','Classification A'),
 ('02320000-0000-0000-0000-000000000002','Classification B');
insert into auth.users(id,email) values
 ('02320000-0000-0000-0000-0000000000a1','classification-admin@example.test'),
 ('02320000-0000-0000-0000-0000000000b1','classification-pm@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('02320000-0000-0000-0000-0000000000a1','02320000-0000-0000-0000-000000000001','Classification Admin','classification-admin@example.test','Admin','active'),
 ('02320000-0000-0000-0000-0000000000b1','02320000-0000-0000-0000-000000000001','Classification PM','classification-pm@example.test','Project Manager','active');
select has_column('public','organizations','service_line_options','AC-TAG-001 organizations.service_line_options persists independently');
select has_column('public','organizations','sector_options','AC-TAG-001 organizations.sector_options persists independently');
select has_column('public','projects','service_line','AC-TAG-002 projects.service_line persists independently');
select has_column('public','projects','sector','AC-TAG-002 projects.sector persists independently');
select has_column('public','projects','location','AC-TAG-002 projects.location persists independently');
select has_column('public','projects','award_type','AC-TAG-002 projects.award_type persists independently');
select has_column('public','projects','bidding_entity','AC-TAG-002 projects.bidding_entity persists independently');
select is((select service_line_options from organizations where id='02320000-0000-0000-0000-000000000001'),array[]::text[],'AC-TAG-001 no service-line options are invented');
select throws_ok($$update organizations set service_line_options=array['Energy','Energy'] where id='02320000-0000-0000-0000-000000000001'$$,'23514',null,'AC-TAG-001 duplicate configured options are refused');
select throws_ok($$update organizations set sector_options=array[' '] where id='02320000-0000-0000-0000-000000000001'$$,'23514',null,'AC-TAG-001 blank configured options are refused');
select throws_ok($$update organizations set sector_options=array[null]::text[] where id='02320000-0000-0000-0000-000000000001'$$,'23514',null,'AC-TAG-001 null configured options are refused');
update organizations set service_line_options=array['Engineering'],sector_options=array['Energy'] where id='02320000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims='{"sub":"02320000-0000-0000-0000-0000000000a1","role":"authenticated"}';
with changed as(update organizations set service_line_options=array['Consulting','Engineering'],sector_options=array['Transport','Energy'] where id='02320000-0000-0000-0000-000000000001' returning id)
select is((select count(*)::int from changed),1,'AC-TAG-001 Admin configures the own-org option lists');
with changed as(update organizations set sector_options=array['Cross tenant'] where id='02320000-0000-0000-0000-000000000002' returning id)
select is((select count(*)::int from changed),0,'AC-TAG-001 Admin cannot configure another org');
select throws_ok($$update organizations set name='Changed' where id='02320000-0000-0000-0000-000000000001'$$,'42501',null,'AC-TAG-001 settings grant does not widen organization updates');
set local request.jwt.claims='{"sub":"02320000-0000-0000-0000-0000000000b1","role":"authenticated","client_id":"synthetic-cli"}';
with changed as(update organizations set sector_options=array['Changed'] where id='02320000-0000-0000-0000-000000000001' returning id)
select is((select count(*)::int from changed),0,'AC-TAG-001 PM cannot configure option lists');
select lives_ok($$insert into projects(id,name,status,service_line,sector,location,award_type,bidding_entity) values('02320000-0000-0000-0000-000000000011','Tagged project','Internal Project','Consulting','Transport','West Java','tender','consortium')$$,'AC-TAG-003 an authorized CLI identity writes all five classifications');
select is((select jsonb_build_array(service_line,sector,location,award_type,bidding_entity) from projects where id='02320000-0000-0000-0000-000000000011'),'["Consulting","Transport","West Java","tender","consortium"]'::jsonb,'AC-TAG-003 persisted CLI metadata round-trips exactly');
select throws_ok($$update projects set service_line='Other org value' where id='02320000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-001 project service line must be configured in its own org');
select throws_ok($$update projects set sector='Other org value' where id='02320000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-001 project sector must be configured in its own org');
select throws_ok($$update projects set award_type='negotiated' where id='02320000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-001 award choices are tender or direct only');
select throws_ok($$update projects set bidding_entity='joint venture' where id='02320000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-001 bidding choices are alone or consortium only');
select lives_ok($$update projects set location='North / remote site' where id='02320000-0000-0000-0000-000000000011'$$,'AC-TAG-001 location is free text rather than an inferred option');
reset role;
update organizations set service_line_options=array['Engineering'] where id='02320000-0000-0000-0000-000000000001';
select is((select service_line from projects where id='02320000-0000-0000-0000-000000000011'),'Consulting','AC-TAG-001 retiring an option preserves existing project classification');
set local role authenticated;
set local request.jwt.claims='{"sub":"02320000-0000-0000-0000-0000000000b1","role":"authenticated","client_id":"synthetic-cli"}';
select lives_ok($$update projects set name='Edited project',service_line='Consulting' where id='02320000-0000-0000-0000-000000000011'$$,'AC-TAG-002 unchanged retired labels do not block header editing');
select lives_ok($$update projects set service_line='Engineering',sector=null,award_type='direct',bidding_entity='alone' where id='02320000-0000-0000-0000-000000000011'$$,'AC-TAG-003 CLI updates and clears classification without a money RPC');
select throws_ok($$update projects set service_line='Consulting' where id='02320000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-001 a retired label cannot be newly selected');
select is((select contract_value from projects where id='02320000-0000-0000-0000-000000000011'),0::numeric,'AC-TAG-003 classification writes never change project money');
insert into projects(id,name,status,service_line,sector,location,award_type,bidding_entity) values
 ('02320000-0000-0000-0000-000000000012','Classified opportunity','Leads','Engineering','Energy','Harbor','direct','alone');
select is((select jsonb_build_array(p->>'service_line',p->>'sector',p->>'location',p->>'award_type',p->>'bidding_entity') from json_array_elements(public.get_sales_pipeline()->'projects') p where p->>'id'='02320000-0000-0000-0000-000000000012'), '["Engineering","Energy","Harbor","direct","alone"]'::jsonb,'AC-TAG-002 pipeline projection retains all authored classifications');
select * from finish();
rollback;
