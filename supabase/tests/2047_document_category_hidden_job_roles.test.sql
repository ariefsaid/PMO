-- 2047_document_category_hidden_job_roles.test.sql — a document category hidden from a named job role (migration 2047).
-- The Quality Inspector loses the category; a Planner and an Engineer with no job role at the same access level keep it; a Project
-- Manager keeps it; an Admin always sees it; the hidden job role is told of none of its documents; only an Admin sets the list.
-- MUTATION NOTE: drop the hidden-from test in the register policies (mut:rr_category_hidden: "and not exists (...)" removed)
--   -> 'RR-DC-03 the Quality Inspector no longer reads the hidden category''s documents' goes red.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20470000-0000-0000-0000-00000000000a', 'RR DC Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20470000-0000-0000-0000-0000000000' || k)::uuid, 'rrdc-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20470000-0000-0000-0000-0000000000a1', '20470000-0000-0000-0000-00000000000a', 'Admin',     'rrdc-a1@example.com', 'Admin', 'active', null),
  ('20470000-0000-0000-0000-0000000000a2', '20470000-0000-0000-0000-00000000000a', 'Inspector', 'rrdc-a2@example.com', 'Engineer', 'active', 'quality_inspector'),
  ('20470000-0000-0000-0000-0000000000a3', '20470000-0000-0000-0000-00000000000a', 'Planner',   'rrdc-a3@example.com', 'Engineer', 'active', 'planner'),
  ('20470000-0000-0000-0000-0000000000a4', '20470000-0000-0000-0000-00000000000a', 'Engineer',  'rrdc-a4@example.com', 'Engineer', 'active', null),
  ('20470000-0000-0000-0000-0000000000a5', '20470000-0000-0000-0000-00000000000a', 'PM',        'rrdc-a5@example.com', 'Project Manager', 'active', null);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20470000-0000-0000-0000-0000000000c1', '20470000-0000-0000-0000-00000000000a', 'RRDC project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20470000-0000-0000-0000-0000000000a5');
insert into document_categories (id, org_id, name, sort_order) values
  ('20470000-0000-0000-0000-000000000071', '20470000-0000-0000-0000-00000000000a', 'Commercial letters', 900);
insert into document_category_roles (category_id, org_id, role)
select '20470000-0000-0000-0000-000000000071', '20470000-0000-0000-0000-00000000000a', r::user_role
  from unnest(array['Admin','Engineer','Project Manager']) r;
insert into project_documents (id, org_id, project_id, title, category_id, status, author_id) values
  ('20470000-0000-0000-0000-000000000081', '20470000-0000-0000-0000-00000000000a', '20470000-0000-0000-0000-0000000000c1', 'Letter to client',
   '20470000-0000-0000-0000-000000000071', 'Draft', '20470000-0000-0000-0000-0000000000a5');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20470000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"20470000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.docs(p_user text) returns text language sql as $$
  select pg_temp.val(p_user, $q$select count(*)::text from project_documents where category_id = '20470000-0000-0000-0000-000000000071'$q$) $$;

select is(pg_temp.docs('a2'), '1', 'RR-DC-01 before any list, the Quality Inspector reads the category as an Engineer');
select is(pg_temp.err('a5', $$select set_document_category_hidden_job_roles('20470000-0000-0000-0000-000000000071', array['quality_inspector'])$$),
  '42501 only an Admin manages document categories', 'RR-DC-02 only an Admin sets the hidden-from list');
select is(pg_temp.err('a1', $$select set_document_category_hidden_job_roles('20470000-0000-0000-0000-000000000071', array['inspector'])$$),
  '23514 DCV_JOB_ROLE', 'RR-DC-02 every entry is a job role');
select is(pg_temp.err('a1', $$select set_document_category_hidden_job_roles('20470000-0000-0000-0000-000000000071', array['administrator'])$$),
  '23514 DCV_ADMIN', 'RR-DC-02 the Administrator is never hidden');
select is(pg_temp.err('a1', $$select set_document_category_hidden_job_roles('20470000-0000-0000-0000-000000000071', array['quality_inspector'])$$),
  'ok', 'RR-DC-02 an Admin hides the category from the Quality Inspector');

select is(pg_temp.docs('a2'), '0', 'RR-DC-03 the Quality Inspector no longer reads the hidden category''s documents');
select is(pg_temp.val('a2', $$select document_category_visible('20470000-0000-0000-0000-000000000071', '20470000-0000-0000-0000-00000000000a')::text$$),
  'false', 'RR-DC-03 and the helper for definers says the same');
select is(pg_temp.docs('a3'), '1', 'RR-DC-04 a Planner at the same access level keeps the category');
select is(pg_temp.docs('a4'), '1', 'RR-DC-04 an Engineer with no job role keeps it');
select is(pg_temp.docs('a5'), '1', 'RR-DC-04 a Project Manager keeps it');
select is(pg_temp.docs('a1'), '1', 'RR-DC-04 an Admin always sees it');

-- the hidden job role is told of none of its documents; a viewer still is
select notify_workflow_user('20470000-0000-0000-0000-00000000000a', '20470000-0000-0000-0000-0000000000a2', 'Document issued', 'x', 'info',
  'project_document', '20470000-0000-0000-0000-000000000081', 'Letter to client');
select notify_workflow_user('20470000-0000-0000-0000-00000000000a', '20470000-0000-0000-0000-0000000000a3', 'Document issued', 'x', 'info',
  'project_document', '20470000-0000-0000-0000-000000000081', 'Letter to client');
select is((select count(*)::int from notifications where owner_id = '20470000-0000-0000-0000-0000000000a2'), 0,
  'RR-DC-05 the Quality Inspector is told of no document in the hidden category');
select is((select count(*)::int from notifications where owner_id = '20470000-0000-0000-0000-0000000000a3'), 1,
  'RR-DC-05 a Planner still is');
select is((select hidden_job_roles::text from document_categories where id = '20470000-0000-0000-0000-000000000071'), '{quality_inspector}',
  'RR-DC-02 the list is stored');

select * from finish();
rollback;
