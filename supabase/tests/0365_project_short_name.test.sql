-- AC-001 / AC-005: optional project identity and org isolation through the authenticated column-write seam.
begin;
select plan(26);

select has_column('public', 'projects', 'short_name', 'AC-001 optional short name is stored on projects');
select col_type_is('public', 'projects', 'short_name', 'text', 'AC-001 short name has text type');
select is((select is_nullable from information_schema.columns where table_schema='public' and table_name='projects' and column_name='short_name'), 'YES', 'AC-001 short name is nullable');
select ok(has_column_privilege('authenticated', 'public.projects', 'short_name', 'INSERT'), 'AC-001 authenticated clients may insert the optional column');
select ok(has_column_privilege('authenticated', 'public.projects', 'short_name', 'UPDATE'), 'AC-001 authenticated clients may update the optional column');
select is((select captured ->> 'short_name' from public.record_history_config where table_name='projects'), 'text', 'AC-001 project alias is classified for record history');

insert into organizations(id,name) values
 ('03650000-0000-0000-0000-000000000001','Short name test org'),
 ('03650000-0000-0000-0000-000000000002','Other short name test org');
insert into auth.users(id,email) values
 ('03650000-0000-0000-0000-000000000101','project-writer@example.invalid'),
 ('03650000-0000-0000-0000-000000000102','project-reader@example.invalid'),
 ('03650000-0000-0000-0000-000000000201','other-project-writer@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03650000-0000-0000-0000-000000000101','03650000-0000-0000-0000-000000000001','Project Writer','project-writer@example.invalid','Project Manager','active'),
 ('03650000-0000-0000-0000-000000000102','03650000-0000-0000-0000-000000000001','Project Reader','project-reader@example.invalid','Engineer','active'),
 ('03650000-0000-0000-0000-000000000201','03650000-0000-0000-0000-000000000002','Other Writer','other-project-writer@example.invalid','Project Manager','active');
insert into projects(id,org_id,name,status,contract_value) values
 ('03650000-0000-0000-0000-000000000301','03650000-0000-0000-0000-000000000001','Contractual pipeline name','Leads',0),
 ('03650000-0000-0000-0000-000000000302','03650000-0000-0000-0000-000000000001','Archived pipeline name','Leads',0),
 ('03650000-0000-0000-0000-000000000401','03650000-0000-0000-0000-000000000002','Foreign contractual name','Leads',0);
insert into projects(id,org_id,name,short_name,status,contract_value,project_manager_id) values
 ('03650000-0000-0000-0000-000000000305','03650000-0000-0000-0000-000000000001','PM contractual title','PM alias','Ongoing Project',0,'03650000-0000-0000-0000-000000000101');
update projects set archived_at=now() where id='03650000-0000-0000-0000-000000000302';
select is((select short_name from projects where id='03650000-0000-0000-0000-000000000301'), null::text, 'AC-001 omitted alias defaults to NULL');

set local role authenticated;
set local request.jwt.claims='{"sub":"03650000-0000-0000-0000-000000000101","role":"authenticated","client_id":"pmo-cli-test"}';
select lives_ok($$insert into projects(id,name,status,contract_value,short_name) values ('03650000-0000-0000-0000-000000000303','Created legal name','Leads',0,'Created alias')$$, 'AC-001 writer can create a project with an independent alias');
select is((select name || '|' || short_name from projects where id='03650000-0000-0000-0000-000000000303'), 'Created legal name|Created alias', 'AC-001 contractual and display names persist separately');
select throws_ok($$insert into projects(id,status,contract_value) values ('03650000-0000-0000-0000-000000000304','Leads',0)$$, '23502', null, 'AC-001 short name never replaces the required contractual name');
select lives_ok($$update projects set short_name='Pipeline alias' where id='03650000-0000-0000-0000-000000000301'$$, 'AC-001 existing pipeline project accepts alias-only update');
select is((select name from projects where id='03650000-0000-0000-0000-000000000301'), 'Contractual pipeline name', 'AC-001 alias-only edit leaves contractual name unchanged');
select is((select changes ? 'short_name' and not (changes ? 'name') from record_changes where entity_type='project' and entity_id='03650000-0000-0000-0000-000000000301' order by seq desc limit 1), true, 'AC-001 alias-only edit records short_name history without name history');
select ok(not exists (select 1 from json_array_elements(get_sales_pipeline()->'projects') item where item->>'id'='03650000-0000-0000-0000-000000000302'), 'AC-002 pipeline still excludes archived rows');
select is((select (item->>'name') || '|' || coalesce(item->>'short_name','NULL') from json_array_elements(get_sales_pipeline()->'projects') item where item->>'id'='03650000-0000-0000-0000-000000000301'), 'Contractual pipeline name|Pipeline alias', 'AC-002 pipeline returns contractual name and separate short name');
select is((select (item->>'name') || '|' || coalesce(item->>'short_name','NULL') from json_array_elements(get_pm_dashboard_projects()) item where item->>'id'='03650000-0000-0000-0000-000000000305'), 'PM contractual title|PM alias', 'AC-002 PM dashboard returns contractual name and separate short name');
select throws_ok($$insert into projects(id,name,status,contract_value,short_name) values ('03650000-0000-0000-0000-000000000306','Dup legal','Leads',0,'  pipeline ALIAS ')$$, '23505', null, 'AC-001 a short name already used in the organization is rejected, ignoring case and spacing');
select lives_ok($$insert into projects(id,name,status,contract_value,short_name) values ('03650000-0000-0000-0000-000000000307','Null alias one','Leads',0,null),('03650000-0000-0000-0000-000000000308','Null alias two','Leads',0,null)$$, 'AC-001 any number of projects may have no short name');
select throws_ok($$update projects set short_name='created ALIAS' where id='03650000-0000-0000-0000-000000000301'$$, '23505', null, 'AC-001 renaming onto another project''s short name is rejected');
select lives_ok($$update projects set short_name=null where id='03650000-0000-0000-0000-000000000301'$$, 'AC-001 writer can clear the optional alias');
select is((select short_name from projects where id='03650000-0000-0000-0000-000000000301'), null::text, 'AC-001 explicit NULL clears the alias');
select is((select count(*)::int from projects where id='03650000-0000-0000-0000-000000000401'), 0, 'AC-005 another organization cannot read the foreign project');
with changed as (update projects set short_name='forbidden' where id='03650000-0000-0000-0000-000000000401' returning id)
select is((select count(*)::int from changed), 0, 'AC-005 another organization cannot update the foreign alias');
reset role;
select is((select short_name from projects where id='03650000-0000-0000-0000-000000000401'), null::text, 'AC-005 foreign alias remains unchanged after attempted write');
select lives_ok($$update projects set short_name='Created alias' where id='03650000-0000-0000-0000-000000000401'$$, 'AC-001 another organization may use the same short name');
set local role authenticated;
set local request.jwt.claims='{"sub":"03650000-0000-0000-0000-000000000102","role":"authenticated","client_id":"pmo-cli-test"}';
with changed as (update projects set short_name='reader-forbidden' where id='03650000-0000-0000-0000-000000000301' returning id)
select is((select count(*)::int from changed), 0, 'AC-005 non-writer cannot edit a project alias');

select * from finish();
rollback;
