-- DD-BUDGET-7: every human who drafts or changes a budget line is excluded from activation.
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name) values ('f2790000-0000-0000-0000-000000000001','Budget Editors Org');
insert into auth.users (id, email) values
 ('f2790000-0000-0000-0000-0000000000a1','editor-y@example.com'),
 ('f2790000-0000-0000-0000-0000000000a2','editor-x@example.com'),
 ('f2790000-0000-0000-0000-0000000000a3','editor-z@example.com');
insert into profiles (id, org_id, full_name, email, role) values
 ('f2790000-0000-0000-0000-0000000000a1','f2790000-0000-0000-0000-000000000001','Y','editor-y@example.com','Project Manager'),
 ('f2790000-0000-0000-0000-0000000000a2','f2790000-0000-0000-0000-000000000001','X','editor-x@example.com','Project Manager'),
 ('f2790000-0000-0000-0000-0000000000a3','f2790000-0000-0000-0000-000000000001','Z','editor-z@example.com','Finance');
insert into projects (id, org_id, name, status) values
 ('f2791111-0000-0000-0000-000000000001','f2790000-0000-0000-0000-000000000001','Editors Project','Ongoing Project');

-- Version created by Y; a separate untouched version is reserved for Z's activation test.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2790000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status) values
 ('f2792222-0000-0000-0000-000000000001','f2790000-0000-0000-0000-000000000001','f2791111-0000-0000-0000-000000000001',1,'Y Draft','Draft'),
 ('f2792222-0000-0000-0000-000000000002','f2790000-0000-0000-0000-000000000001','f2791111-0000-0000-0000-000000000001',2,'Untouched Draft','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
 ('f2793333-0000-0000-0000-000000000001','f2790000-0000-0000-0000-000000000001','f2792222-0000-0000-0000-000000000001','Labor','seed line',10,0),
 ('f2793333-0000-0000-0000-000000000002','f2790000-0000-0000-0000-000000000001','f2792222-0000-0000-0000-000000000001','Labor','delete line',10,0),
 ('f2793333-0000-0000-0000-000000000003','f2790000-0000-0000-0000-000000000001','f2792222-0000-0000-0000-000000000002','Labor','Z delete line',10,0);
reset role;

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.budget_version_editors'::regclass),
 'editor ledger has enabled and forced RLS');
select ok(not has_table_privilege('authenticated','public.budget_version_editors','INSERT,UPDATE,DELETE')
          and not has_table_privilege('anon','public.budget_version_editors','SELECT,INSERT,UPDATE,DELETE'),
 'clients cannot write the editor ledger');
select is((select count(*)::int from public.budget_version_editors where budget_version_id='f2792222-0000-0000-0000-000000000001'),1,
 'version creation records Y as the original editor');

-- X edits a line: X is captured and cannot activate, even though Y remains the creator.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2790000-0000-0000-0000-0000000000a2","role":"authenticated"}';
update budget_line_items set budgeted_amount=25 where id='f2793333-0000-0000-0000-000000000001';
select is((select count(*)::int from public.budget_version_editors where budget_version_id='f2792222-0000-0000-0000-000000000001'),2,
 'line update adds its editor without replacing Y');
select throws_ok($$select activate_budget_version('f2792222-0000-0000-0000-000000000001')$$,
 '42501','separation of duties: You edited this version, so someone else must activate it.',
 'X cannot activate after editing the line');
reset role;

-- Z did not edit the version and can activate it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2790000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select activate_budget_version('f2792222-0000-0000-0000-000000000001')$$,
 'an eligible untouched person Z may activate');
reset role;

-- X clones the untouched draft. Clone trigger records X on the new copy, not the source.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2790000-0000-0000-0000-0000000000a2","role":"authenticated"}';
create temp table _clone (id uuid) on commit drop;
grant all on _clone to authenticated;
insert into _clone select clone_budget_version('f2792222-0000-0000-0000-000000000002');
select is((select count(*)::int from public.budget_version_editors e join _clone c on c.id=e.budget_version_id where e.user_id=auth.uid()),1,
 'clone creator is an editor of the clone');
select is((select count(*)::int from public.budget_version_editors where budget_version_id='f2792222-0000-0000-0000-000000000002' and user_id='f2790000-0000-0000-0000-0000000000a2'),0,
 'cloning does not add the cloner to the source');
select throws_ok(format('select activate_budget_version(%L)',(select id from _clone)),
 '42501','separation of duties: You edited this version, so someone else must activate it.',
 'cloner X cannot activate the clone');
reset role;

-- DELETE is an editing act and is recorded just like INSERT/UPDATE.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2790000-0000-0000-0000-0000000000a3","role":"authenticated"}';
delete from budget_line_items where id='f2793333-0000-0000-0000-000000000003';
select ok(exists(select 1 from public.budget_version_editors where budget_version_id='f2792222-0000-0000-0000-000000000002' and user_id=auth.uid()),
 'line delete editor remains recorded');
reset role;

-- A server-side seed write has no JWT, hence cannot attribute a human.
set local request.jwt.claims = '{}';
insert into budget_versions (id, org_id, project_id, version, name, status, created_by) values
 ('f2792222-0000-0000-0000-000000000003','f2790000-0000-0000-0000-000000000001','f2791111-0000-0000-0000-000000000001',4,'Server seed','Draft',null);
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
 values ('f2790000-0000-0000-0000-000000000001','f2792222-0000-0000-0000-000000000003','Labor','service seed',1,0);
select is((select count(*)::int from public.budget_version_editors where budget_version_id='f2792222-0000-0000-0000-000000000003'),0,
 'server-role seed writes do not create editor identities');

select * from finish();
rollback;
