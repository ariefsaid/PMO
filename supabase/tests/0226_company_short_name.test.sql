begin;
select plan(21);
select has_column('public', 'companies', 'short_name', 'AC-NICK-002: companies have a separate optional PMO short name');
insert into organizations(id, name) values
 ('02260000-0000-0000-0000-000000000001','Example Nickname Org'),
 ('02260000-0000-0000-0000-000000000002','Other Nickname Org');
insert into auth.users(id,email) values ('02260000-0000-0000-0000-0000000000a1','nickname-test@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('02260000-0000-0000-0000-0000000000a1','02260000-0000-0000-0000-000000000001','Test Manager','nickname-test@example.test','Project Manager','active');
insert into companies(id,org_id,name,type) values
 ('02260000-0000-0000-0000-000000000101','02260000-0000-0000-0000-000000000001','Example Legal Company','Client'),
 ('02260000-0000-0000-0000-000000000102','02260000-0000-0000-0000-000000000001','Example End Legal Company','Client'),
 ('02260000-0000-0000-0000-000000000201','02260000-0000-0000-0000-000000000002','Other Legal Company','Client');
select is((select short_name from companies where id='02260000-0000-0000-0000-000000000101'),null::text,'short name is optional for existing and new rows');
insert into projects(id,org_id,name,status,client_id,end_client_id,budget) values
 ('02260000-0000-0000-0000-000000000301','02260000-0000-0000-0000-000000000001','Example Pipeline','Leads','02260000-0000-0000-0000-000000000101','02260000-0000-0000-0000-000000000102',100);
insert into external_domain_ownership(org_id,external_tier,domain) values
 ('02260000-0000-0000-0000-000000000001','erpnext','companies');
set local role authenticated;
set local request.jwt.claims='{"sub":"02260000-0000-0000-0000-0000000000a1","role":"authenticated","client_id":"nickname-cli-test"}';
select lives_ok($$update companies set short_name='Example' where id='02260000-0000-0000-0000-000000000101'$$,'CLI user can edit the PMO enhancement on an externally-owned company');
select is((select short_name from companies where id='02260000-0000-0000-0000-000000000101'),'Example','short name persists through the authenticated write seam');
select is((select name from companies where id='02260000-0000-0000-0000-000000000101'),'Example Legal Company','legal identity remains separate');
select throws_ok($$update companies set name='Changed Legal Company' where id='02260000-0000-0000-0000-000000000101'$$,'42501','company native fields are read-only while companies are externally-owned','legal name stays protected');
select throws_ok($$update companies set type='Vendor' where id='02260000-0000-0000-0000-000000000101'$$,'42501','company native fields are read-only while companies are externally-owned','native type stays protected');
select throws_ok($$update companies set erp_modified='2099-01-01' where id='02260000-0000-0000-0000-000000000101'$$,'42501','company native fields are read-only while companies are externally-owned','native feed metadata stays protected');
select lives_ok($$update companies set short_name='Example End' where id='02260000-0000-0000-0000-000000000102'$$,'end customer can have its own PMO short name');
select is((get_sales_pipeline()->'projects'->0->>'client_name'),'Example','pipeline client displays the short name');
select is((get_sales_pipeline()->'projects'->0->>'client_legal_name'),'Example Legal Company','pipeline keeps the legal client name searchable');
select is((get_sales_pipeline()->'projects'->0->>'end_client_name'),'Example End','pipeline end customer displays the short name');
select is((get_sales_pipeline()->'projects'->0->>'end_client_legal_name'),'Example End Legal Company','pipeline keeps the legal end customer searchable');
select is((get_executive_dashboard()->'top_projects'->0->>'client_name'),'Example','executive project display prefers the short client name');
select is((get_finance_budget_review()->0->>'client_name'),'Example','finance project display prefers the short client name');
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$update companies set name='Updated Legal Company' where id='02260000-0000-0000-0000-000000000101'$$,'external mirror can still update the legal name');
select is((select short_name from companies where id='02260000-0000-0000-0000-000000000101'),'Example','inbound native writes preserve the PMO enhancement');
set local role authenticated;
set local request.jwt.claims='{"sub":"02260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$update companies set short_name=null where id='02260000-0000-0000-0000-000000000101'$$,'short name can be cleared');
select is((get_sales_pipeline()->'projects'->0->>'client_name'),'Updated Legal Company','clearing the short name restores legal-name display');
update companies set short_name='Forbidden' where id='02260000-0000-0000-0000-000000000201';
select is((select count(*)::int from companies where id='02260000-0000-0000-0000-000000000201'),0,'enhancements respect the org read boundary');
reset role;
select is((select short_name from companies where id='02260000-0000-0000-0000-000000000201'),null::text,'cross-org enhancement write changes no row');
select * from finish();
rollback;
