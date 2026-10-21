begin;
select no_plan();
insert into public.organizations(id,name) values ('10200000-0000-0000-0000-000000000021','Synthetic candidates org');
insert into auth.users(id,email) values ('10200000-0000-0000-0000-000000000121','candidate@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000121','10200000-0000-0000-0000-000000000021','Synthetic admin','candidate@example.invalid','Admin','active');
insert into public.projects(id,org_id,name,status,archived_at) values
 ('10200000-0000-0000-0000-000000000221','10200000-0000-0000-0000-000000000021','Synthetic archived project','Ongoing Project',now()),
 ('10200000-0000-0000-0000-000000000223','10200000-0000-0000-0000-000000000021','Synthetic project 223','Ongoing Project',null),
 ('10200000-0000-0000-0000-000000000224','10200000-0000-0000-0000-000000000021','Synthetic project 224','Ongoing Project',null),
 ('10200000-0000-0000-0000-000000000225','10200000-0000-0000-0000-000000000021','Synthetic project 225','Ongoing Project',null),
 ('10200000-0000-0000-0000-000000000226','10200000-0000-0000-0000-000000000021','Synthetic project 226','Ongoing Project',null),
 ('10200000-0000-0000-0000-000000000227','10200000-0000-0000-0000-000000000021','Synthetic project 227','Ongoing Project',null),
 ('10200000-0000-0000-0000-000000000228','10200000-0000-0000-0000-000000000021','Synthetic project 228','Ongoing Project',null);
insert into public.procurements(id,org_id,title,status) values
 ('10200000-0000-0000-0000-000000000222','10200000-0000-0000-0000-000000000021','Synthetic overhead case','Draft');
set local role authenticated;
set local request.jwt.claims='{"sub":"10200000-0000-0000-0000-000000000121","role":"authenticated"}';
select is((select count(*)::integer from public.m365_record_folder_candidates('project',null)),6,
 'AC-M365DOC-072 candidate query is capped at six and includes archived records');
select is((select count(*)::integer from public.m365_record_folder_candidates('project','10200000-0000-0000-0000-000000000225')),
 3,'AC-M365DOC-072 candidate paging uses an exclusive id cursor');
select is((select count(*)::integer from public.m365_record_folder_candidates('procurement',null)),1,
 'AC-M365DOC-072 candidate page includes overhead case');
select throws_ok($$select * from public.m365_record_folder_candidates('invalid',null)$$,'22023',null,
 'AC-M365DOC-072 rejects arbitrary candidate kind');
reset role;
select * from finish();
rollback;
