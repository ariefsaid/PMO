-- #830 location CHECK, cross-org option isolation and anon lockout on the classification columns.
begin;
select plan(14);
insert into organizations(id,name) values
 ('02480000-0000-0000-0000-000000000001','Tidy A'),
 ('02480000-0000-0000-0000-000000000002','Tidy B');
insert into auth.users(id,email) values ('02480000-0000-0000-0000-0000000000a1','tidy-pm@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('02480000-0000-0000-0000-0000000000a1','02480000-0000-0000-0000-000000000001','Tidy PM','tidy-pm@example.test','Project Manager','active');
-- 'Marine' / 'Offshore' exist ONLY in org B; org A has its own distinct options.
update organizations set service_line_options=array['Consulting'],sector_options=array['Transport'] where id='02480000-0000-0000-0000-000000000001';
update organizations set service_line_options=array['Offshore'],sector_options=array['Marine'] where id='02480000-0000-0000-0000-000000000002';
insert into projects(id,org_id,name,status,location) values
 ('02480000-0000-0000-0000-000000000011','02480000-0000-0000-0000-000000000001','Tidy project','Internal Project','Jakarta');

select throws_ok($$update projects set location=' padded ' where id='02480000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-002 location with surrounding whitespace is refused');
select throws_ok($$update projects set location='   ' where id='02480000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-002 blank location is refused');
select throws_ok(format($$update projects set location=%L where id='02480000-0000-0000-0000-000000000011'$$,repeat('x',141)),'23514',null,'AC-TAG-002 location over 140 characters is refused');
select lives_ok(format($$update projects set location=%L where id='02480000-0000-0000-0000-000000000011'$$,repeat('x',140)),'AC-TAG-002 location of exactly 140 characters is accepted');
select lives_ok($$update projects set location=null where id='02480000-0000-0000-0000-000000000011'$$,'AC-TAG-002 location can be cleared');

set local role authenticated;
set local request.jwt.claims='{"sub":"02480000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update projects set sector='Marine' where id='02480000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-001 a sector configured only in the other org is refused');
select throws_ok($$update projects set service_line='Offshore' where id='02480000-0000-0000-0000-000000000011'$$,'23514',null,'AC-TAG-001 a service line configured only in the other org is refused');
select lives_ok($$update projects set sector='Transport',service_line='Consulting' where id='02480000-0000-0000-0000-000000000011'$$,'AC-TAG-001 values configured in the own org are accepted');
reset role;

select is(has_column_privilege('anon','public.projects','location','INSERT') or has_column_privilege('anon','public.projects','service_line','INSERT')
  or has_column_privilege('anon','public.projects','sector','INSERT') or has_column_privilege('anon','public.projects','award_type','INSERT')
  or has_column_privilege('anon','public.projects','bidding_entity','INSERT'),false,'AC-TAG-002 anon cannot insert the classification columns');
select is(has_column_privilege('anon','public.projects','location','UPDATE') or has_column_privilege('anon','public.projects','service_line','UPDATE')
  or has_column_privilege('anon','public.projects','sector','UPDATE') or has_column_privilege('anon','public.projects','award_type','UPDATE')
  or has_column_privilege('anon','public.projects','bidding_entity','UPDATE'),false,'AC-TAG-002 anon cannot update the classification columns');
select is(has_column_privilege('anon','public.organizations','service_line_options','UPDATE') or has_column_privilege('anon','public.organizations','sector_options','UPDATE'),false,'AC-TAG-001 anon cannot update the option lists');
-- Drop the PM's claims too: `set local request.jwt.claims` outlives `reset role`, so anon would otherwise resolve auth.uid() to the PM.
set local request.jwt.claims='{"role":"anon"}';
set local role anon;
select is((select count(*)::int from projects where location is not null or service_line is not null or sector is not null),0,'AC-TAG-002 anon reads no classification values (RLS)');
select is((select count(*)::int from organizations where cardinality(service_line_options)>0 or cardinality(sector_options)>0),0,'AC-TAG-001 anon reads no configured options (RLS)');
select throws_ok($$update projects set location='Anon site'$$,'42501',null,'AC-TAG-002 anon write to a classification column is denied');
reset role;
select * from finish();
rollback;
