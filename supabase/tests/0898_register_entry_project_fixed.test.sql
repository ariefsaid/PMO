-- AC-DOC-PRJ-001: a register entry's project is fixed once it leaves Draft. An Issued or an Approved entry keeps its
-- project for the author, an Admin and a command-line token alike; a Draft entry can still be moved; every other
-- edit the table already allows on an Issued entry is unchanged; server-side writers are unchanged.
begin;
select plan(16);

insert into organizations (id, name, default_currency) values ('08980000-0000-0000-0000-00000000000a','PRJ A','IDR');
insert into auth.users (id, email) values
  ('08980000-0000-0000-0000-0000000000a1','prj-admin@example.com'), ('08980000-0000-0000-0000-0000000000a3','prj-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08980000-0000-0000-0000-0000000000a1','08980000-0000-0000-0000-00000000000a','Admin','prj-admin@example.com','Admin','active'),
  ('08980000-0000-0000-0000-0000000000a3','08980000-0000-0000-0000-00000000000a','PM','prj-pm@example.com','Project Manager','active');
insert into projects (id, org_id, name, code) values
  ('08980000-0000-0000-0000-0000000000d1','08980000-0000-0000-0000-00000000000a','PRJ one','PRJ-0898-1'),
  ('08980000-0000-0000-0000-0000000000d2','08980000-0000-0000-0000-00000000000a','PRJ two','PRJ-0898-2');
-- e1 Issued, e2 Approved, e3 + e4 Draft; all authored by the Project Manager, all in project one
insert into public.project_documents (id, org_id, project_id, category, title, author_id, status) values
  ('08980000-0000-0000-0000-0000000000e1','08980000-0000-0000-0000-00000000000a','08980000-0000-0000-0000-0000000000d1','Reference','Issued entry','08980000-0000-0000-0000-0000000000a3','Issued'),
  ('08980000-0000-0000-0000-0000000000e2','08980000-0000-0000-0000-00000000000a','08980000-0000-0000-0000-0000000000d1','Reference','Approved entry','08980000-0000-0000-0000-0000000000a3','Approved'),
  ('08980000-0000-0000-0000-0000000000e3','08980000-0000-0000-0000-00000000000a','08980000-0000-0000-0000-0000000000d1','Reference','Draft entry by author','08980000-0000-0000-0000-0000000000a3','Draft'),
  ('08980000-0000-0000-0000-0000000000e4','08980000-0000-0000-0000-00000000000a','08980000-0000-0000-0000-0000000000d1','Reference','Draft entry by admin','08980000-0000-0000-0000-0000000000a3','Draft');

create function pg_temp.as_app(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_cli(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
         set_config('request.method', 'PATCH', true), set_config('request.path', '/project_documents', true), set_config('request.headers', '{}', true);
$$;

set local role authenticated;

-- the author, in the app
select pg_temp.as_app('08980000-0000-0000-0000-0000000000a3');
select throws_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  '42501', 'project_documents."Issued entry" is Issued and its project cannot be changed: a register entry stays in the project it was issued under',
  'AC-DOC-PRJ-001 the author cannot move an Issued entry to another project');
select throws_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e2'$$,
  '42501', 'project_documents."Approved entry" is Approved and its project cannot be changed: a register entry stays in the project it was issued under',
  'AC-DOC-PRJ-001 the author cannot move an Approved entry to another project');
select lives_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e3'$$,
  'AC-DOC-PRJ-001 the author can still move a Draft entry to another project');
select lives_ok($$update public.project_documents set title = 'Issued entry, retitled', revision = 'B' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  'AC-DOC-PRJ-001 the author can still edit the other metadata of an Issued entry');
select lives_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d1' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  'AC-DOC-PRJ-001 an update that leaves the project as it is passes on an Issued entry');

-- an Admin, in the app
select pg_temp.as_app('08980000-0000-0000-0000-0000000000a1');
select throws_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  '42501', 'project_documents."Issued entry, retitled" is Issued and its project cannot be changed: a register entry stays in the project it was issued under',
  'AC-DOC-PRJ-001 an Admin cannot move an Issued entry to another project');
select throws_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e2'$$,
  '42501', 'project_documents."Approved entry" is Approved and its project cannot be changed: a register entry stays in the project it was issued under',
  'AC-DOC-PRJ-001 an Admin cannot move an Approved entry to another project');
select lives_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e4'$$,
  'AC-DOC-PRJ-001 an Admin can still move a Draft entry to another project');
select lives_ok($$update public.project_documents set title = 'Issued entry, retitled by Admin' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  'AC-DOC-PRJ-001 an Admin can still edit the other metadata of an Issued entry');

-- a command-line token (client_id claim), as the author and as an Admin
select pg_temp.as_cli('08980000-0000-0000-0000-0000000000a3');
select throws_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  '42501', 'project_documents."Issued entry, retitled by Admin" is Issued and its project cannot be changed: a register entry stays in the project it was issued under',
  'AC-DOC-PRJ-001 a command-line token of the author cannot move an Issued entry to another project');
select throws_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e2'$$,
  '42501', 'project_documents."Approved entry" is Approved and its project cannot be changed: a register entry stays in the project it was issued under',
  'AC-DOC-PRJ-001 a command-line token of the author cannot move an Approved entry to another project');
select lives_ok($$update public.project_documents set title = 'Issued entry, retitled by token' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  'AC-DOC-PRJ-001 a command-line token can still edit the other metadata of an Issued entry');
select lives_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d1' where id = '08980000-0000-0000-0000-0000000000e3'$$,
  'AC-DOC-PRJ-001 a command-line token can still move a Draft entry');
select pg_temp.as_cli('08980000-0000-0000-0000-0000000000a1');
select throws_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e1'$$,
  '42501', 'project_documents."Issued entry, retitled by token" is Issued and its project cannot be changed: a register entry stays in the project it was issued under',
  'AC-DOC-PRJ-001 a command-line token of an Admin cannot move an Issued entry to another project');

reset role;
select is((select project_id::text from public.project_documents where id = '08980000-0000-0000-0000-0000000000e1'),
  '08980000-0000-0000-0000-0000000000d1', 'AC-DOC-PRJ-001 the Issued entry is still in its project');
-- a server-side writer (a role that bypasses RLS) is not a client and is unchanged
select lives_ok($$update public.project_documents set project_id = '08980000-0000-0000-0000-0000000000d2' where id = '08980000-0000-0000-0000-0000000000e2'$$,
  'AC-DOC-PRJ-001 a server-side writer is unchanged');

select * from finish();
rollback;
