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

insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000002','Synthetic other settings org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000102','m365-settings-other@example.invalid'),
 ('10200000-0000-0000-0000-000000000103','m365-settings-reader@example.invalid'),
 ('10200000-0000-0000-0000-000000000104','m365-settings-inactive@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000002','Other admin','m365-settings-other@example.invalid','Admin','active'),
 ('10200000-0000-0000-0000-000000000103','10200000-0000-0000-0000-000000000001','Read-only member','m365-settings-reader@example.invalid','Engineer','active'),
 ('10200000-0000-0000-0000-000000000104','10200000-0000-0000-0000-000000000001','Inactive admin','m365-settings-inactive@example.invalid','Admin','disabled');
insert into public.org_m365_document_settings (org_id,updated_by,updated_at)
 values ('10200000-0000-0000-0000-000000000002','10200000-0000-0000-0000-000000000102',now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000101","role":"authenticated"}';
select is((select count(*)::integer from public.org_m365_document_settings),1,
 'AC-M365DOC-055 active member reads only its organization setting');
select lives_ok($$update public.org_m365_document_settings set default_site_id='site-from-user',
 default_site_name='Synthetic site',default_drive_id='drive-from-user',default_drive_name='Synthetic library'
 where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-055 Admin can set the organization default');
select lives_ok($$update public.org_m365_document_settings set default_site_id=null,
 default_site_name=null,default_drive_id=null,default_drive_name=null
 where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-055 Admin clears the default by nulling the complete tuple');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000103","role":"authenticated"}';
select lives_ok($$update public.org_m365_document_settings set default_site_id='forbidden'
 where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-055 non-Admin update is filtered by RLS');
reset role;
select ok((select default_site_id is null from public.org_m365_document_settings
 where org_id='10200000-0000-0000-0000-000000000001'),
 'AC-M365DOC-055 denied non-Admin update preserves the default');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000103","role":"authenticated"}';
select throws_ok($$insert into public.org_m365_document_settings
 (default_site_id,default_site_name,default_drive_id,default_drive_name)
 values ('site','Synthetic site','drive','Synthetic library')$$,'42501',null,
 'AC-M365DOC-055 non-Admin member cannot insert a default');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000104","role":"authenticated"}';
select lives_ok($$update public.org_m365_document_settings set default_site_id='inactive'
 where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-055 inactive Admin update is filtered by RLS');
reset role;
select ok((select default_site_id is null from public.org_m365_document_settings
 where org_id='10200000-0000-0000-0000-000000000001'),
 'AC-M365DOC-055 denied inactive update preserves the default');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10200000-0000-0000-0000-000000000102","role":"authenticated"}';
select is((select count(*)::integer from public.org_m365_document_settings),1,
 'AC-M365DOC-055 other-org Admin cannot read this organization setting');
select lives_ok($$update public.org_m365_document_settings set default_site_id='cross-org'
 where org_id='10200000-0000-0000-0000-000000000001'$$,
 'AC-M365DOC-055 other-org update is filtered by RLS');
reset role;
select ok((select default_site_id is null from public.org_m365_document_settings
 where org_id='10200000-0000-0000-0000-000000000001'),
 'AC-M365DOC-055 denied cross-org update preserves the default');
select throws_ok($$update public.org_m365_document_settings set org_id='10200000-0000-0000-0000-000000000002'
 where org_id='10200000-0000-0000-0000-000000000001'$$,
 '23514',null,'AC-M365DOC-055 settings singleton organization key is immutable');
select is((select updated_by from public.org_m365_document_settings
 where org_id='10200000-0000-0000-0000-000000000001'),
 '10200000-0000-0000-0000-000000000101'::uuid,'AC-M365DOC-055 settings updater is server stamped');
select ok((select updated_at>'2000-01-01'::timestamptz from public.org_m365_document_settings
 where org_id='10200000-0000-0000-0000-000000000001'),'AC-M365DOC-055 settings timestamp is server stamped');

select * from finish();
rollback;
