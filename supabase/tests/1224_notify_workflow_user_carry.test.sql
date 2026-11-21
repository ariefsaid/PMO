-- 1224_notify_workflow_user_carry.test.sql — migration 1224 carries the #2579 category-visibility rule (1168) onto the
-- #2711 nine-argument notify_workflow_user (1221, which had re-created it from the pre-1168 body).
-- Mutation note: delete the "p_entity_type = 'project_document'" block from 1224 and the structural assertion (3) and the
-- behavioural assertion (5) go red; delete the email_event handling and (4) and (7) go red; recreate the 8-argument
-- overload and (2) goes red.
begin;
select plan(7);

insert into organizations (id, name) values ('01224000-0000-0000-0000-00000000000a', 'NWC Org A');
insert into auth.users (id, email) values
  ('01224000-0000-0000-0000-0000000000a4', 'nwc-fin@example.com'),
  ('01224000-0000-0000-0000-0000000000a5', 'nwc-eng@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01224000-0000-0000-0000-0000000000a4', '01224000-0000-0000-0000-00000000000a', 'Fin A', 'nwc-fin@example.com', 'Finance'),
  ('01224000-0000-0000-0000-0000000000a5', '01224000-0000-0000-0000-00000000000a', 'Eng A', 'nwc-eng@example.com', 'Engineer');
insert into projects (id, org_id, code, name, status) values
  ('01224000-0000-0000-0000-000000000020', '01224000-0000-0000-0000-00000000000a', 'NWC-PRJ', 'NWC Project', 'Ongoing Project');
-- the system category "Report" starts visible to all five roles; narrow it so Engineer cannot view it
delete from document_category_roles
 where org_id = '01224000-0000-0000-0000-00000000000a' and role = 'Engineer'
   and category_id = (select id from document_categories where org_id = '01224000-0000-0000-0000-00000000000a' and name = 'Report');
insert into project_documents (id, org_id, project_id, category, title, status, author_id) values
  ('01224000-0000-0000-0000-000000000031', '01224000-0000-0000-0000-00000000000a', '01224000-0000-0000-0000-000000000020', 'Report', 'Narrowed doc', 'Draft', '01224000-0000-0000-0000-0000000000a4');

select ok(exists (select 1 from pg_proc where oid = 'public.notify_workflow_user(uuid,uuid,text,text,text,text,uuid,text,text)'::regprocedure),
  'AC-DCV-015 the nine-argument notify_workflow_user exists');
select is((select count(*)::int from pg_proc where proname = 'notify_workflow_user' and pronamespace = 'public'::regnamespace and pronargs = 8), 0,
  'AC-DCV-015 no eight-argument overload exists');
select ok((select prosrc from pg_proc where oid = 'public.notify_workflow_user(uuid,uuid,text,text,text,text,uuid,text,text)'::regprocedure)
            like '%document_category_roles%',
  'AC-DCV-015 the function body carries the category-visibility rule');
select ok((select prosrc from pg_proc where oid = 'public.notify_workflow_user(uuid,uuid,text,text,text,text,uuid,text,text)'::regprocedure)
            like '%email_event%',
  'AC-DCV-015 the function body keeps the email-event handling');

select notify_workflow_user('01224000-0000-0000-0000-00000000000a', '01224000-0000-0000-0000-0000000000a5', 't', 'b', 'info',
  'project_document', '01224000-0000-0000-0000-000000000031', 'Narrowed doc', 'approval_request');
select notify_workflow_user('01224000-0000-0000-0000-00000000000a', '01224000-0000-0000-0000-0000000000a4', 't', 'b', 'info',
  'project_document', '01224000-0000-0000-0000-000000000031', 'Narrowed doc', 'approval_request');
select is((select count(*)::int from notifications where owner_id = '01224000-0000-0000-0000-0000000000a5'), 0,
  'AC-DCV-015 a recipient who cannot view the category gets no notification, with an email event set');
select is((select count(*)::int from notifications where owner_id = '01224000-0000-0000-0000-0000000000a4'), 1,
  'AC-DCV-015 a viewer gets one');
select is((select metadata ->> 'email_event' from notifications where owner_id = '01224000-0000-0000-0000-0000000000a4'), 'approval_request',
  'the viewer''s notification carries the email event');

select * from finish();
rollback;
