-- budget_cli_ops_writes.test.sql — 0370 link_budget_version_sharepoint_item (#1270 B, `pmo budgets activate --source`).
-- Proves role, active-member and org scoping of the new RPC, and that activation separation of duties is unchanged
-- by attaching a source file.
begin;
create extension if not exists pgtap;
select plan(26);

insert into organizations (id, name) values
  ('a3700000-0000-0000-0000-000000000001','CLI Ops Org'),
  ('a3700000-0000-0000-0000-000000000002','CLI Ops Other Org');
insert into auth.users (id, email) values
  ('a3700000-0000-0000-0000-0000000000a1','pm1-co@example.com'),
  ('a3700000-0000-0000-0000-0000000000a2','pm2-co@example.com'),
  ('a3700000-0000-0000-0000-0000000000a3','fin-co@example.com'),
  ('a3700000-0000-0000-0000-0000000000a4','admin-co@example.com'),
  ('a3700000-0000-0000-0000-0000000000a5','exec-co@example.com'),
  ('a3700000-0000-0000-0000-0000000000a6','eng-co@example.com'),
  ('a3700000-0000-0000-0000-0000000000a7','off-co@example.com'),
  ('a3700000-0000-0000-0000-0000000000b1','other-co@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a3700000-0000-0000-0000-0000000000a1','a3700000-0000-0000-0000-000000000001','PM One','pm1-co@example.com','Project Manager','active'),
  ('a3700000-0000-0000-0000-0000000000a2','a3700000-0000-0000-0000-000000000001','PM Two','pm2-co@example.com','Project Manager','active'),
  ('a3700000-0000-0000-0000-0000000000a3','a3700000-0000-0000-0000-000000000001','Fin','fin-co@example.com','Finance','active'),
  ('a3700000-0000-0000-0000-0000000000a4','a3700000-0000-0000-0000-000000000001','Admin','admin-co@example.com','Admin','active'),
  ('a3700000-0000-0000-0000-0000000000a5','a3700000-0000-0000-0000-000000000001','Exec','exec-co@example.com','Executive','active'),
  ('a3700000-0000-0000-0000-0000000000a6','a3700000-0000-0000-0000-000000000001','Eng','eng-co@example.com','Engineer','active'),
  ('a3700000-0000-0000-0000-0000000000a7','a3700000-0000-0000-0000-000000000001','Offboarded','off-co@example.com','Finance','disabled'),
  ('a3700000-0000-0000-0000-0000000000b1','a3700000-0000-0000-0000-000000000002','Other Fin','other-co@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('a3701111-0000-0000-0000-000000000001','a3700000-0000-0000-0000-000000000001','CLI Ops Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('a3702222-0000-0000-0000-000000000001','a3700000-0000-0000-0000-000000000001','a3701111-0000-0000-0000-000000000001',1,'Draft one','Draft'),
  ('a3702222-0000-0000-0000-000000000002','a3700000-0000-0000-0000-000000000001','a3701111-0000-0000-0000-000000000001',2,'Active two','Active'),
  ('a3702222-0000-0000-0000-000000000003','a3700000-0000-0000-0000-000000000001','a3701111-0000-0000-0000-000000000001',3,'Archived three','Archived');

select ok(not has_function_privilege('anon', 'public.link_budget_version_sharepoint_item(uuid,jsonb)', 'EXECUTE'),
  'AC-CLI-B1 anon cannot execute the budget source link RPC');
select ok(has_function_privilege('authenticated', 'public.link_budget_version_sharepoint_item(uuid,jsonb)', 'EXECUTE'),
  'AC-CLI-B1 authenticated can execute the budget source link RPC');

set local role authenticated;

-- ── PM One drafts v4, then links a source file ───────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status)
  values ('a3702222-0000-0000-0000-000000000004','a3700000-0000-0000-0000-000000000001','a3701111-0000-0000-0000-000000000001',4,'PM One draft','Draft');

create temp table _link (id uuid) on commit drop;
grant all on _link to authenticated;
select lives_ok(
  $$ insert into _link select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000004',
       '{"drive_id":"d1","item_id":"i1","web_url":"https://example.invalid/sbp.xlsx","name":"SBP.xlsx","kind":"file"}') $$,
  'AC-CLI-B1 a Project Manager links a source file to a Draft version');
select is((select count(*)::int from budget_version_document_links where id = (select id from _link)
             and org_id = 'a3700000-0000-0000-0000-000000000001'
             and ms_linked_by = 'a3700000-0000-0000-0000-0000000000a1'
             and ms_drive_id = 'd1' and ms_item_id = 'i1' and ms_item_name = 'SBP.xlsx' and ms_item_kind = 'file'),
  1, 'AC-CLI-B1 the link carries the item and is stamped with the caller org and the caller as linker');
select is(
  (select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000004',
     '{"drive_id":"d1","item_id":"i1","web_url":"https://example.invalid/sbp.xlsx","name":"SBP.xlsx","kind":"file"}')),
  (select id from _link), 'AC-CLI-B1 linking the same item again returns the same link');
select is((select count(*)::int from budget_version_document_links where budget_version_id = 'a3702222-0000-0000-0000-000000000004'),
  1, 'AC-CLI-B1 a repeated link does not stack a duplicate');

-- ── bad items ────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000004',
  '{"drive_id":"d1","item_id":"i2","web_url":"http://example.invalid/x","name":"x","kind":"file"}') $$,
  '22023', null, 'AC-CLI-B1 a non-https link is refused');
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000004',
  '{"drive_id":"d1","item_id":"i2","web_url":"https://example.invalid/x","name":"x","kind":"sheet"}') $$,
  '22023', null, 'AC-CLI-B1 an unknown item kind is refused');
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000004',
  '{"drive_id":"","item_id":"i2","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  '22023', null, 'AC-CLI-B1 an empty drive id is refused');
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000004', null) $$,
  '22023', null, 'AC-CLI-B1 a missing item is refused');

-- ── version state ────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000002',
  '{"drive_id":"d1","item_id":"i3","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  'P0001', null, 'AC-CLI-B1 an Active version takes no new source file');
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000003',
  '{"drive_id":"d1","item_id":"i3","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  'P0001', null, 'AC-CLI-B1 an Archived version takes no new source file');
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-0000000000ff',
  '{"drive_id":"d1","item_id":"i3","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  'P0002', null, 'AC-CLI-B1 an unknown version is not found');

-- ── roles ────────────────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000001',
  '{"drive_id":"d1","item_id":"fin","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  'AC-CLI-B1 Finance links a source file');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000001',
  '{"drive_id":"d1","item_id":"adm","web_url":"https://example.invalid/x","name":"x","kind":"folder"}') $$,
  'AC-CLI-B1 Admin links a source folder');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000001',
  '{"drive_id":"d1","item_id":"exe","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  'AC-CLI-B1 Executive links a source file');
select is((select count(*)::int from budget_version_document_links where budget_version_id = 'a3702222-0000-0000-0000-000000000001'),
  3, 'AC-CLI-B1 Finance, Admin and Executive each left exactly one link on the Draft');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000001',
  '{"drive_id":"d1","item_id":"eng","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  '42501', null, 'AC-CLI-B1 an Engineer is refused');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000001',
  '{"drive_id":"d1","item_id":"off","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  '42501', null, 'AC-CLI-B1 an offboarded member is refused');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000001',
  '{"drive_id":"d1","item_id":"oth","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  'P0002', null, 'AC-CLI-B1 another organisation cannot see or link this version');
select is((select count(*)::int from budget_version_document_links where budget_version_id = 'a3702222-0000-0000-0000-000000000001'),
  0, 'AC-CLI-B1 another organisation sees none of the links and the refused calls left none');

-- ── activation separation of duties is unchanged ─────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select activate_budget_version('a3702222-0000-0000-0000-000000000004') $$,
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'AC-CLI-B1 attaching a source file does not let the drafter activate their own version');
select is(budget_activation_mode('a3702222-0000-0000-0000-000000000004'), 'blocked_editor',
  'AC-CLI-B1 the drafter still reads as blocked from activating');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(budget_activation_mode('a3702222-0000-0000-0000-000000000004'), 'allowed',
  'AC-CLI-B1 a second person is allowed to activate the version that has a source file');
select lives_ok($$ select activate_budget_version('a3702222-0000-0000-0000-000000000004') $$,
  'AC-CLI-B1 the second person activates it');
select throws_ok($$ select link_budget_version_sharepoint_item('a3702222-0000-0000-0000-000000000004',
  '{"drive_id":"d1","item_id":"late","web_url":"https://example.invalid/x","name":"x","kind":"file"}') $$,
  'P0001', null, 'AC-CLI-B1 once Active, no further source file can be attached');

select * from finish();
rollback;
