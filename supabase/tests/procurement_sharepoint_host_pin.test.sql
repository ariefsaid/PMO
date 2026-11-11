-- procurement_sharepoint_host_pin.test.sql — 0370 pins link_procurement_sharepoint_item (0361) to the organisation's own
-- SharePoint host, the same block and refusal as link_m365_documents_batch (0367). #1270 B.
begin;
create extension if not exists pgtap;
select plan(9);
insert into organizations (id,name,default_currency) values ('03710000-0000-0000-0000-00000000000a','HP A','IDR'),('03710000-0000-0000-0000-00000000000b','HP B (no library)','IDR');
insert into auth.users(id,email) values ('03710000-0000-0000-0000-0000000000a1','hp-fin@example.com'),('03710000-0000-0000-0000-0000000000b1','hp-b@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03710000-0000-0000-0000-0000000000a1','03710000-0000-0000-0000-00000000000a','Fin','hp-fin@example.com','Finance','active'),
 ('03710000-0000-0000-0000-0000000000b1','03710000-0000-0000-0000-00000000000b','B Fin','hp-b@example.com','Finance','active');
insert into org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by) values
 ('03710000-0000-0000-0000-00000000000a','Corp.SharePoint.com,site-a,web-a','Site','drive-a','Library','03710000-0000-0000-0000-0000000000a1');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values
 ('03710000-0000-0000-0000-0000000000e1','03710000-0000-0000-0000-00000000000a','HP purchase A','03710000-0000-0000-0000-0000000000a1','IDR',1,'Draft'),
 ('03710000-0000-0000-0000-0000000000e2','03710000-0000-0000-0000-00000000000b','HP purchase B','03710000-0000-0000-0000-0000000000b1','IDR',1,'Draft');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e1',null,null,
  '{"drive_id":"d","item_id":"i1","web_url":"https://corp.sharepoint.com/sites/s/a.pdf","name":"a.pdf","kind":"file"}') $$,
  'AC-CLI-B3 the organisation''s own SharePoint host is accepted');
select lives_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e1',null,null,
  '{"drive_id":"d","item_id":"i2","web_url":"https://CORP.SharePoint.COM/sites/s/b.pdf","name":"b.pdf","kind":"file"}') $$,
  'AC-CLI-B3 the host compare is case-insensitive (both directions)');
select throws_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e1',null,null,
  '{"drive_id":"d","item_id":"i3","web_url":"https://evil.example.com/a.pdf","name":"a.pdf","kind":"file"}') $$,
  '22023', 'web_url host is not the organisation SharePoint host', 'AC-CLI-B3 a foreign host is refused');
select throws_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e1',null,null,
  '{"drive_id":"d","item_id":"i4","web_url":"https://corp.sharepoint.com.evil.example/a.pdf","name":"a.pdf","kind":"file"}') $$,
  '22023', null, 'AC-CLI-B3 a look-alike host (own host as a prefix) is refused: the compare is exact');
select throws_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e1',null,null,
  '{"drive_id":"d","item_id":"i5","web_url":"http://corp.sharepoint.com/a.pdf","name":"a.pdf","kind":"file"}') $$,
  '22023', null, 'AC-CLI-B3 a non-https link is refused');
select throws_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e1',null,null,
  '{"drive_id":"d","item_id":"i6","name":"a.pdf","kind":"file"}') $$,
  '22023', null, 'AC-CLI-B3 an item with no web_url is refused');
select is((select count(*)::int from procurement_documents where procurement_id='03710000-0000-0000-0000-0000000000e1' and ms_item_id in ('i1','i2','i3','i4','i5','i6')),
  2, 'AC-CLI-B3 only the two own-host links were written');
set local request.jwt.claims = '{"sub":"03710000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e2',null,null,
  '{"drive_id":"d","item_id":"i7","web_url":"https://corp.sharepoint.com/a.pdf","name":"a.pdf","kind":"file"}') $$,
  '22023', 'm365_not_configured', 'AC-CLI-B3 an organisation with no default library is refused m365_not_configured');
select throws_ok($$ select link_procurement_sharepoint_item('03710000-0000-0000-0000-0000000000e1',null,null,
  '{"drive_id":"d","item_id":"i8","web_url":"https://corp.sharepoint.com/a.pdf","name":"a.pdf","kind":"file"}') $$,
  'P0002', null, 'AC-CLI-B3 foreign org: another organisation''s purchase is not found');
reset role;
select * from finish();
rollback;
