begin;
select no_plan();

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic settings org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000101','m365-settings@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000101','10200000-0000-0000-0000-000000000001','Synthetic admin','m365-settings@example.invalid','Admin','active');

select lives_ok($$insert into public.org_m365_document_settings
 (org_id,updated_by,updated_at) values
 ('10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000101',now())$$,
 'AC-M365DOC-055 an unset default library is represented by the all-null tuple');
select lives_ok($$update public.org_m365_document_settings set
 default_site_id='site-id',default_site_name='Synthetic site',default_drive_id='drive-id',
 default_drive_name='Synthetic library',updated_at=now()
 where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-055 a complete default library tuple is accepted');
select throws_ok($$insert into public.org_m365_document_settings
 (org_id,default_site_id,updated_by,updated_at) values
 ('10200000-0000-0000-0000-000000000001','site-id','10200000-0000-0000-0000-000000000101',now())$$,
 '23514',null,'AC-M365DOC-055 partial tuple with site id is rejected');
select throws_ok($$insert into public.org_m365_document_settings
 (org_id,default_site_name,updated_by,updated_at) values
 ('10200000-0000-0000-0000-000000000001','Synthetic site','10200000-0000-0000-0000-000000000101',now())$$,
 '23514',null,'AC-M365DOC-055 partial tuple with site name is rejected');
select throws_ok($$insert into public.org_m365_document_settings
 (org_id,default_drive_id,updated_by,updated_at) values
 ('10200000-0000-0000-0000-000000000001','drive-id','10200000-0000-0000-0000-000000000101',now())$$,
 '23514',null,'AC-M365DOC-055 partial tuple with drive id is rejected');
select throws_ok($$insert into public.org_m365_document_settings
 (org_id,default_drive_name,updated_by,updated_at) values
 ('10200000-0000-0000-0000-000000000001','Synthetic library','10200000-0000-0000-0000-000000000101',now())$$,
 '23514',null,'AC-M365DOC-055 partial tuple with drive name is rejected');
select throws_ok($$insert into public.org_m365_document_settings
 (org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by,updated_at) values
 ('10200000-0000-0000-0000-000000000001',' ','Synthetic site','drive-id','Synthetic library',
 '10200000-0000-0000-0000-000000000101',now())$$,
 '23514',null,'AC-M365DOC-055 whitespace-only default tuple fields are rejected');

select * from finish();
rollback;
