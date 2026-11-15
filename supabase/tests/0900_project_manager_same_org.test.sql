-- 0900_project_manager_same_org.test.sql — a project's manager belongs to the project's organisation.
-- Owning layer for AC-PMO-001: insert and update refuse another organisation's profile as manager
-- (42501); a same-organisation manager and NULL are accepted; changing org_id while keeping a
-- now-foreign manager is refused.
begin;
select plan(11);

insert into organizations (id, name) values
  ('09000000-0000-0000-0000-000000000001','PM Org A (0900)'),
  ('09000000-0000-0000-0000-000000000002','PM Org B (0900)');

insert into auth.users (id, email) values
  ('09000000-0000-0000-0000-0000000000a1','pm-a-0900@example.com'),
  ('09000000-0000-0000-0000-0000000000b1','pm-b-0900@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('09000000-0000-0000-0000-0000000000a1','09000000-0000-0000-0000-000000000001',
   'PM A','pm-a-0900@example.com','Project Manager','active'),
  ('09000000-0000-0000-0000-0000000000b1','09000000-0000-0000-0000-000000000002',
   'PM B','pm-b-0900@example.com','Project Manager','active');

-- Insert with another organisation's profile as manager → refused.
select throws_ok(
  $$ insert into public.projects (org_id, name, status, project_manager_id)
       values ('09000000-0000-0000-0000-000000000001','PM Foreign Insert','Leads',
               '09000000-0000-0000-0000-0000000000b1') $$,
  '42501',
  'project manager not in this organization',
  'AC-PMO-001 a project cannot be inserted with another organisation''s profile as manager');

-- Same-organisation manager at insert → accepted.
select lives_ok(
  $$ insert into public.projects (id, org_id, name, status, project_manager_id)
       values ('09000000-0000-0000-0000-0000000000f1','09000000-0000-0000-0000-000000000001',
               'PM Same-Org Project','Leads','09000000-0000-0000-0000-0000000000a1') $$,
  'AC-PMO-001 a project can be inserted with a same-organisation manager');

-- NULL manager at insert → accepted.
select lives_ok(
  $$ insert into public.projects (id, org_id, name, status)
       values ('09000000-0000-0000-0000-0000000000f2','09000000-0000-0000-0000-000000000001',
               'PM Null Project','Leads') $$,
  'AC-PMO-001 a project can be inserted with no manager');

-- Update to another organisation's profile → refused.
select throws_ok(
  $$ update public.projects set project_manager_id = '09000000-0000-0000-0000-0000000000b1'
       where id = '09000000-0000-0000-0000-0000000000f2' $$,
  '42501',
  'project manager not in this organization',
  'AC-PMO-001 a project''s manager cannot be set to another organisation''s profile');

-- Update to a same-organisation profile → accepted.
select lives_ok(
  $$ update public.projects set project_manager_id = '09000000-0000-0000-0000-0000000000a1'
       where id = '09000000-0000-0000-0000-0000000000f2' $$,
  'AC-PMO-001 a project''s manager can be set to a same-organisation profile');

-- Clearing the manager → accepted.
select lives_ok(
  $$ update public.projects set project_manager_id = null
       where id = '09000000-0000-0000-0000-0000000000f2' $$,
  'AC-PMO-001 a project''s manager can be cleared');

-- Moving the project to another organisation while keeping its manager → refused.
select throws_ok(
  $$ update public.projects set org_id = '09000000-0000-0000-0000-000000000002'
       where id = '09000000-0000-0000-0000-0000000000f1' $$,
  '42501',
  'project manager not in this organization',
  'AC-PMO-001 changing a project''s organisation while keeping a manager from the old one is refused');

-- Unrelated updates stay unaffected.
select lives_ok(
  $$ update public.projects set name = 'PM Same-Org Project renamed'
       where id = '09000000-0000-0000-0000-0000000000f1' $$,
  'AC-PMO-001 other project updates are unaffected');

-- ── The APP path: a signed-in user never sends org_id (projects_stamp_org_id stamps it from the JWT).
-- The guard must judge the STAMPED org, so it has to fire after the stamp; an insert that omits
-- org_id is the only shape that proves the ordering (an explicit org_id hides it).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"09000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into public.projects (name, status, project_manager_id)
       values ('PM App-Path Foreign','Leads','09000000-0000-0000-0000-0000000000b1') $$,
  '42501',
  'project manager not in this organization',
  'AC-PMO-001 the app path (org_id omitted) refuses another organisation''s profile as manager');

select lives_ok(
  $$ insert into public.projects (id, name, status, project_manager_id)
       values ('09000000-0000-0000-0000-0000000000f3','PM App-Path Same-Org','Leads',
               '09000000-0000-0000-0000-0000000000a1') $$,
  'AC-PMO-001 the app path (org_id omitted, stamped from the JWT) accepts a same-organisation manager');

reset role;
select is(
  (select org_id from public.projects where id = '09000000-0000-0000-0000-0000000000f3'),
  '09000000-0000-0000-0000-000000000001'::uuid,
  'AC-PMO-001 the app-path project was stamped into the signed-in user''s own organisation');

select * from finish();
rollback;
