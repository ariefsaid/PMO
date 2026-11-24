-- 2049_document_category_access_in_one_save.test.sql — a category's role access and hidden job roles change in one Admin-only
-- save (migration 2049), and a hidden job role is refused at every gate of the register (2047): read, insert, update, delete,
-- the file in storage and the email copy.
-- The hidden job role here is the Construction Manager, at the Project Manager access level, so the category's role access alone
-- would let it in: only the hidden-from list keeps it out. A Project Manager with no job role is the control.
-- MUTATION NOTES:
--   mut:rr_access_hidden_first (2049; swallow the hidden-list refusal) -> 'RR-DA-01 a refused hidden-roles value leaves role access unchanged'
--   mut:rr_category_hidden (2047; drop the hidden test in the register policies) -> RR-DA-04, -05, -06 and -08 go red
--   (RR-DA-07 holds anyway: the delete policy refuses a Project Manager-level author on its own)
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20490000-0000-0000-0000-00000000000a', 'RR DA Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20490000-0000-0000-0000-0000000000' || k)::uuid, 'rrda-' || k || '@example.com' from unnest(array['a1','a2','a3','a4']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20490000-0000-0000-0000-0000000000a1', '20490000-0000-0000-0000-00000000000a', 'Admin',        'rrda-a1@example.com', 'Admin', 'active', null),
  ('20490000-0000-0000-0000-0000000000a2', '20490000-0000-0000-0000-00000000000a', 'Construction', 'rrda-a2@example.com', 'Project Manager', 'active', 'construction_manager'),
  ('20490000-0000-0000-0000-0000000000a3', '20490000-0000-0000-0000-00000000000a', 'PM',           'rrda-a3@example.com', 'Project Manager', 'active', null),
  ('20490000-0000-0000-0000-0000000000a4', '20490000-0000-0000-0000-00000000000a', 'Finance',      'rrda-a4@example.com', 'Finance', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('20490000-0000-0000-0000-0000000000c1', '20490000-0000-0000-0000-00000000000a', 'RRDA project', 'Ongoing Project', '20490000-0000-0000-0000-0000000000a3');
insert into document_categories (id, org_id, name, sort_order) values
  ('20490000-0000-0000-0000-000000000071', '20490000-0000-0000-0000-00000000000a', 'Commercial letters', 900);
insert into document_category_roles (category_id, org_id, role)
select '20490000-0000-0000-0000-000000000071', '20490000-0000-0000-0000-00000000000a', r::user_role from unnest(array['Admin','Project Manager','Finance']) r;
insert into project_documents (id, org_id, project_id, title, category_id, status, author_id) values
  ('20490000-0000-0000-0000-000000000081', '20490000-0000-0000-0000-00000000000a', '20490000-0000-0000-0000-0000000000c1', 'Letter by CM',
   '20490000-0000-0000-0000-000000000071', 'Draft', '20490000-0000-0000-0000-0000000000a2'),
  ('20490000-0000-0000-0000-000000000082', '20490000-0000-0000-0000-00000000000a', '20490000-0000-0000-0000-0000000000c1', 'Letter by PM',
   '20490000-0000-0000-0000-000000000071', 'Draft', '20490000-0000-0000-0000-0000000000a3');
insert into storage.objects (bucket_id, name) values
  ('project-documents', '20490000-0000-0000-0000-00000000000a/20490000-0000-0000-0000-0000000000c1/20490000-0000-0000-0000-000000000081/letter.pdf');
insert into email_event_settings (org_id, event_key, enabled, extra_roles) values
  ('20490000-0000-0000-0000-00000000000a', 'approval_request', true, array['Project Manager'])
  on conflict (org_id, event_key) do update set enabled = true, extra_roles = excluded.extra_roles;

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20490000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
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
  perform set_config('request.jwt.claims', '{"sub":"20490000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.roles() returns text language sql as $$
  select string_agg(role::text, ',' order by role::text) from document_category_roles where category_id = '20490000-0000-0000-0000-000000000071' $$;
create function pg_temp.save(p_roles text, p_hidden text) returns text language sql as $$
  select format('select set_document_category_access(%L, %L::user_role[], %L::text[])', '20490000-0000-0000-0000-000000000071', p_roles, p_hidden) $$;

-- ── one save: both lists or neither ──────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a1', pg_temp.save('{Admin,Engineer,"Project Manager",Finance}', '{administrator}')), '23514 DCV_ADMIN',
  'RR-DA-01 (an Admin''s save that widens access and names an invalid hidden role is refused)');
select is(pg_temp.roles(), 'Admin,Finance,Project Manager', 'RR-DA-01 a refused hidden-roles value leaves role access unchanged');
select is(pg_temp.err('a1', pg_temp.save('{Admin,Engineer,"Project Manager",Finance}', '{inspector}')), '23514 DCV_JOB_ROLE',
  'RR-DA-01 (a save naming a key that is no job role is refused)');
select is(pg_temp.roles(), 'Admin,Finance,Project Manager', 'RR-DA-01 and role access is still unchanged');
select is(pg_temp.err('a3', pg_temp.save('{Admin,"Project Manager",Finance}', '{construction_manager}')),
  '42501 only an Admin manages document categories', 'RR-DA-02 only an Admin saves a category''s access');
select is(pg_temp.err('a1', pg_temp.save('{Admin,"Project Manager",Finance}', '{construction_manager}')), 'ok',
  'RR-DA-03 an Admin saves role access and the hidden job roles together');
select is((select hidden_job_roles::text from document_categories where id = '20490000-0000-0000-0000-000000000071'), '{construction_manager}',
  'RR-DA-03 the hidden list is stored');
select is(pg_temp.roles(), 'Admin,Finance,Project Manager', 'RR-DA-03 with the role access');

-- ── the hidden job role at every gate ────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.val('a2', 'select count(*)::text from project_documents'), '0', 'RR-DA-04 the hidden Construction Manager reads no document of the category');
select is(pg_temp.val('a3', 'select count(*)::text from project_documents'), '2', 'RR-DA-04 a Project Manager with no job role reads both');
select is(pg_temp.err('a2', $$insert into project_documents (project_id, title, category_id, status, author_id) values
    ('20490000-0000-0000-0000-0000000000c1', 'Filed by CM', '20490000-0000-0000-0000-000000000071', 'Draft', '20490000-0000-0000-0000-0000000000a2')$$),
  '42501 new row violates row-level security policy "project_documents_category_visible_insert" for table "project_documents"', 'RR-DA-05 the hidden job role cannot file a document in the category');
select is(pg_temp.err('a3', $$insert into project_documents (project_id, title, category_id, status, author_id) values
    ('20490000-0000-0000-0000-0000000000c1', 'Filed by PM', '20490000-0000-0000-0000-000000000071', 'Draft', '20490000-0000-0000-0000-0000000000a3')$$),
  'ok', 'RR-DA-05 a Project Manager with no job role still files one');
select is(pg_temp.err('a2', $$update project_documents set title = 'Changed by CM' where id = '20490000-0000-0000-0000-000000000081'$$), 'ok',
  'RR-DA-06 (the hidden job role''s update of its own document touches no row)');
select is((select title from project_documents where id = '20490000-0000-0000-0000-000000000081'), 'Letter by CM',
  'RR-DA-06 the hidden job role cannot change even a document it wrote');
select is(pg_temp.err('a2', $$delete from project_documents where id = '20490000-0000-0000-0000-000000000081'$$), 'ok', 'RR-DA-07 (its delete touches no row)');
select is((select count(*)::int from project_documents where id = '20490000-0000-0000-0000-000000000081'), 1, 'RR-DA-07 the hidden job role cannot delete it');
select is(pg_temp.val('a2', $$select count(*)::text from storage.objects where bucket_id = 'project-documents' and name like '20490000-0000-0000-0000-00000000000a/%'$$)
          || '/' || pg_temp.val('a3', $$select count(*)::text from storage.objects where bucket_id = 'project-documents' and name like '20490000-0000-0000-0000-00000000000a/%'$$),
  '0/1', 'RR-DA-08 the hidden job role cannot read the document''s file; a Project Manager with no job role can');

-- the email copy of a notice naming a document in the category, raised by no signed-in actor (the actor is never emailed)
select set_config('request.jwt.claims', '', true);
insert into notifications (org_id, owner_id, severity, title, body, metadata) values
  ('20490000-0000-0000-0000-00000000000a', '20490000-0000-0000-0000-0000000000a4', 'info', 'Letter awaiting your approval', null,
   jsonb_build_object('email_event', 'approval_request',
                      'entity', jsonb_build_object('type', 'project_document', 'id', '20490000-0000-0000-0000-000000000082'::uuid, 'label', 'Letter by PM')));
select is((select string_agg(right(o.recipient_id::text, 2), ',' order by o.recipient_id) from email_outbox o join notifications n on n.id = o.notification_id
            where n.metadata->'entity'->>'id' = '20490000-0000-0000-0000-000000000082'), 'a3,a4',
  'RR-DA-09 the email copy reaches the addressee and the Project Manager with no job role, never the hidden Construction Manager');

select * from finish();
rollback;
