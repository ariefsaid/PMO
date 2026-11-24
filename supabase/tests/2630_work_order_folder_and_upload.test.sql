-- 2630_work_order_folder_and_upload.test.sql — Migration 2630 (work-order folders + scoped PA document rights).
-- Denominator at head: public.project_documents grants SELECT/INSERT/UPDATE/DELETE to authenticated (none to anon/PUBLIC).
-- MUTATION NOTES (remove or weaken the tagged condition in 2630; named assertion goes red; restore):
--   mut:pa_wo_role ........... 'WOF-03 plain Engineer cannot insert work-order doc' / 'WOF-04 planner cannot insert'
--   mut:pa_wo_required ....... 'WOF-05 PA cannot insert project-level doc (work_order_id null)'
--   mut:pa_wo_org ............ 'WOF-06 PA cannot insert cross-org work-order doc'
--   mut:pa_wo_project_read ... 'WOF-07 PA cannot insert when project is unreadable to caller'
--   mut:pa_wo_belongs ........ 'WOF-08 PA cannot bind doc to work order of another project'
--   mut:pa_trigger_source .... 'WOF-12 PA links m365_link_record_folder for own work order' & refusal on project doc
--   mut:pa_storage_role .......... 'WOF-15 plain Engineer cannot insert into storage project-documents'
--   mut:pa_storage_wo_only ....... 'WOF-16 PA cannot upload storage object for project-level doc (work_order_id null)'
--   mut:pa_storage_author_insert .. 'WOF-17 PA cannot insert storage object on another user Draft WO doc'
--   mut:pa_storage_author_update .. 'WOF-17 PA cannot update storage object on another user Draft WO doc'
--   mut:pa_storage_author_wcheck .. 'WOF-17 PA cannot move own storage object onto another user Draft WO doc'
--   mut:pa_link_wo_only .......... 'WOF-13 PA cannot call m365_link_record_folder for project or procurement'
begin;
create extension if not exists pgtap;
select plan(42);

-- Fixtures: two orgs, projects, work orders, users (Admin, PA, Planner, plain Engineer, Field/Light, CrossOrg PA)
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('26300000-0000-0000-0000-00000000000a', 'WOF Org A', 'IDR', 'UTC', true),
  ('26300000-0000-0000-0000-00000000000b', 'WOF Org B', 'IDR', 'UTC', true);
insert into org_features (org_id, feature_key, enabled) values
  ('26300000-0000-0000-0000-00000000000a', 'm365_integration', true)
on conflict (org_id, feature_key) do update set enabled = true;

insert into auth.users (id, email)
select ('26300000-0000-0000-0000-0000000000' || k)::uuid, 'wof-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','b1','b2']) k;

insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26300000-0000-0000-0000-0000000000a1', '26300000-0000-0000-0000-00000000000a', 'Admin A',    'wof-a1@example.com', 'Admin',    'active', null),
  ('26300000-0000-0000-0000-0000000000a2', '26300000-0000-0000-0000-00000000000a', 'PA A',       'wof-a2@example.com', 'Engineer', 'active', 'project_administrator'),
  ('26300000-0000-0000-0000-0000000000a3', '26300000-0000-0000-0000-00000000000a', 'Planner A',  'wof-a3@example.com', 'Engineer', 'active', 'planner'),
  ('26300000-0000-0000-0000-0000000000a4', '26300000-0000-0000-0000-00000000000a', 'Engineer A', 'wof-a4@example.com', 'Engineer', 'active', null),
  ('26300000-0000-0000-0000-0000000000a5', '26300000-0000-0000-0000-00000000000a', 'Field A',    'wof-a5@example.com', 'Engineer', 'active', 'field_user'),
  ('26300000-0000-0000-0000-0000000000b1', '26300000-0000-0000-0000-00000000000b', 'Admin B',    'wof-b1@example.com', 'Admin',    'active', null),
  ('26300000-0000-0000-0000-0000000000b2', '26300000-0000-0000-0000-00000000000b', 'PA B',       'wof-b2@example.com', 'Engineer', 'active', 'project_administrator');

insert into projects (id, org_id, name, code, status, currency, contract_value, tax_treatment, tax_amount) values
  ('26300000-0000-0000-0000-000000000101', '26300000-0000-0000-0000-00000000000a', 'Proj A1', 'PA-1', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0),
  ('26300000-0000-0000-0000-000000000102', '26300000-0000-0000-0000-00000000000a', 'Proj A2', 'PA-2', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0),
  ('26300000-0000-0000-0000-000000000201', '26300000-0000-0000-0000-00000000000b', 'Proj B1', 'PB-1', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0);

insert into work_orders (id, org_id, project_id, title, wo_number, status, order_value, tax_treatment, tax_amount) values
  ('26300000-0000-0000-0000-000000000301', '26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101', 'WO A1', 'WO-001', 'Issued', 100, 'exclusive', 0),
  ('26300000-0000-0000-0000-000000000302', '26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000102', 'WO A2', 'WO-002', 'Issued', 100, 'exclusive', 0),
  ('26300000-0000-0000-0000-000000000401', '26300000-0000-0000-0000-00000000000b', '26300000-0000-0000-0000-000000000201', 'WO B1', 'WO-B01', 'Issued', 100, 'exclusive', 0);

insert into procurements (id, org_id, project_id, title, requested_by_id, status, total_value) values
  ('26300000-0000-0000-0000-000000000501', '26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101', 'Proc A1', '26300000-0000-0000-0000-0000000000a1', 'Draft', 0);

insert into org_m365_document_settings (org_id, default_site_id, default_site_name, default_drive_id, default_drive_name, updated_by, updated_at)
values ('26300000-0000-0000-0000-00000000000a', 'site-a', 'Docs Site', 'drive-a', 'Docs', '26300000-0000-0000-0000-0000000000a1', '2026-10-01T00:00:00Z')
on conflict (org_id) do update set default_site_id='site-a', default_site_name='Docs Site', default_drive_id='drive-a', default_drive_name='Docs', updated_at='2026-10-01T00:00:00Z';

-- Existing project-level document + existing issued WO document authored by Admin + hidden category
insert into document_categories (id, org_id, name, sort_order, hidden_job_roles) values
  ('26300000-0000-0000-0000-000000000601', '26300000-0000-0000-0000-00000000000a', 'SecretPA', 901, array['project_administrator']);
insert into document_category_roles (category_id, org_id, role)
select '26300000-0000-0000-0000-000000000601', '26300000-0000-0000-0000-00000000000a', r::user_role
  from unnest(array['Admin','Engineer','Project Manager']) r;

insert into project_documents (id, org_id, project_id, work_order_id, category, title, status, author_id) values
  ('26300000-0000-0000-0000-000000000701', '26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101', null, 'Drawing', 'Proj doc by PA', 'Draft', '26300000-0000-0000-0000-0000000000a2'),
  ('26300000-0000-0000-0000-000000000702', '26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101', '26300000-0000-0000-0000-000000000301', 'Drawing', 'WO doc by Admin', 'Draft', '26300000-0000-0000-0000-0000000000a1');

insert into storage.objects (bucket_id, name, metadata) values
  ('project-documents', '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000702/orig.pdf', '{"orig":true}'::jsonb);

-- ── §1 Role table grants denominator check ───────────────────────────────────────────────────────────────────────────────────────
select ok(
  has_column_privilege('authenticated', 'public.project_documents', 'work_order_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.project_documents', 'work_order_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.project_documents', 'status', 'UPDATE')
  and not has_table_privilege('anon', 'public.project_documents', 'INSERT'),
  'WOF-01 column grants expose work_order_id on INSERT only and keep status immutable and anon denied'
);

-- Helpers
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"26300000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
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
  perform set_config('request.jwt.claims', '{"sub":"26300000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;

-- ── §2 Path 1: project_documents direct RLS & triggers ───────────────────────────────────────────────────────────────────────────
select is(
  pg_temp.err('a2', $$
    insert into public.project_documents (id, org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-000000000801', '26300000-0000-0000-0000-00000000000a',
            '26300000-0000-0000-0000-000000000101', '26300000-0000-0000-0000-000000000301',
            'Drawing', 'PA WO doc', '26300000-0000-0000-0000-0000000000a2')
  $$),
  'ok',
  'WOF-02 PA creates a Draft self-authored work-order document in readable project & visible category'
);

select isnt(
  pg_temp.err('a4', $$
    insert into public.project_documents (org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101',
            '26300000-0000-0000-0000-000000000301', 'Drawing', 'Eng WO doc', '26300000-0000-0000-0000-0000000000a4')
  $$),
  'ok',
  'WOF-03 plain Engineer cannot insert work-order doc'
);

select isnt(
  pg_temp.err('a3', $$
    insert into public.project_documents (org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101',
            '26300000-0000-0000-0000-000000000301', 'Drawing', 'Planner WO doc', '26300000-0000-0000-0000-0000000000a3')
  $$),
  'ok',
  'WOF-04 planner cannot insert work-order doc'
);

select isnt(
  pg_temp.err('a2', $$
    insert into public.project_documents (org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101',
            null, 'Drawing', 'PA Project doc', '26300000-0000-0000-0000-0000000000a2')
  $$),
  'ok',
  'WOF-05 PA cannot insert project-level doc (work_order_id null)'
);

select isnt(
  pg_temp.err('b2', $$
    insert into public.project_documents (org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101',
            '26300000-0000-0000-0000-000000000301', 'Drawing', 'Cross org doc', '26300000-0000-0000-0000-0000000000b2')
  $$),
  'ok',
  'WOF-06 PA cannot insert cross-org work-order doc'
);

-- Unreadable project refusal: a restrictive policy on projects hides Proj A2 -> actor_may_write_work_order_document denies
create policy test_hide_proj_a2 on public.projects as restrictive for select to authenticated
  using (id <> '26300000-0000-0000-0000-000000000102'::uuid);

select isnt(
  pg_temp.err('a2', $$
    insert into public.project_documents (org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000102',
            '26300000-0000-0000-0000-000000000302', 'Drawing', 'Hidden proj WO doc', '26300000-0000-0000-0000-0000000000a2')
  $$),
  'ok',
  'WOF-07 PA cannot insert when project is unreadable to caller'
);

drop policy test_hide_proj_a2 on public.projects;

select isnt(
  pg_temp.err('a2', $$
    insert into public.project_documents (org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101',
            '26300000-0000-0000-0000-000000000302', 'Drawing', 'Mismatched WO', '26300000-0000-0000-0000-0000000000a2')
  $$),
  'ok',
  'WOF-08 PA cannot bind doc to work order of another project'
);

select isnt(
  pg_temp.err('a2', $$
    insert into public.project_documents (org_id, project_id, work_order_id, category, title, author_id)
    values ('26300000-0000-0000-0000-00000000000a', '26300000-0000-0000-0000-000000000101',
            '26300000-0000-0000-0000-000000000301', 'SecretPA', 'Hidden cat', '26300000-0000-0000-0000-0000000000a2')
  $$),
  'ok',
  'WOF-09 PA respects hidden_job_roles document category visibility on insert'
);

-- PA can update own Draft WO doc metadata/onedrive, CANNOT update project doc, CANNOT update Admin's WO doc, CANNOT delete, CANNOT transition
select is(
  pg_temp.err('a2', $$
    update public.project_documents set title = 'PA WO doc edited' where id = '26300000-0000-0000-0000-000000000801'
  $$),
  'ok',
  'WOF-10 PA updates own Draft work-order document'
);

select is(
  pg_temp.val('a2', $$
    with changed as (
      update public.project_documents set title = 'Hijacked Admin WO doc' where id = '26300000-0000-0000-0000-000000000702'
      returning 1
    ) select count(*)::text from changed
  $$),
  '0',
  'WOF-10 PA cannot update another user Draft work-order document'
);

select is(
  pg_temp.val('a2', $$
    with changed as (
      update public.project_documents set title = 'Hijacked Proj doc' where id = '26300000-0000-0000-0000-000000000701'
      returning 1
    ) select count(*)::text from changed
  $$),
  '0',
  'WOF-10 PA cannot update project-level document even when self-authored'
);

select isnt(
  pg_temp.err('a2', $$
    select public.transition_document_status('26300000-0000-0000-0000-000000000801', 'Issued'::public.doc_status)
  $$),
  'ok',
  'WOF-11 PA cannot transition/approve work-order document status'
);

select is(
  pg_temp.err('a2', $$
    delete from public.project_documents where id = '26300000-0000-0000-0000-000000000801'
  $$),
  'ok', -- Wait: delete with no matching permissive policy deletes 0 rows in Postgres RLS; verify row still exists!
  'WOF-11 delete statement under RLS reaches zero rows for PA'
);
select is(
  (select count(*)::int from public.project_documents where id = '26300000-0000-0000-0000-000000000801'),
  1,
  'WOF-11 PA cannot delete work-order document'
);

select isnt(
  pg_temp.err('a2', $$
    update public.project_documents set work_order_id = null where id = '26300000-0000-0000-0000-000000000801'
  $$),
  'ok',
  'WOF-11 work_order_id is immutable via authenticated UPDATE'
);

-- ── §3 Path 2: m365_link_record_folder & m365_record_folder_created & folder isolation ────────────────────────────────────────────
select is(
  pg_temp.val('a2', $$
    select (public.m365_link_record_folder(
      'work_order', '26300000-0000-0000-0000-000000000301',
      jsonb_build_object('drive_id','drive-a','item_id','wo-folder-item-1','item_kind','folder','name','WO-001 WO A1','web_url','https://contoso.sharepoint.com/sites/a/wo1'),
      'site-a', 'drive-a', '2026-10-01T00:00:00Z'
    ))->>'state'
  $$),
  'linked',
  'WOF-12 PA links m365_link_record_folder for own work order'
);

-- Linking a work order folder MUST NOT make project folder candidates treat Proj A1 as already linked!
select is(
  pg_temp.val('a1', $$
    select count(*)::text from public.m365_record_folder_candidates('project') where id = '26300000-0000-0000-0000-000000000101'
  $$),
  '1',
  'WOF-12 project folder candidates ignore work_order folders'
);

-- PA CANNOT call m365_link_record_folder for project or procurement
select isnt(
  pg_temp.err('a2', $$
    select public.m365_link_record_folder(
      'project', '26300000-0000-0000-0000-000000000101',
      jsonb_build_object('drive_id','drive-a','item_id','proj-folder-item-1','item_kind','folder','name','PA-1 Proj A1','web_url','https://contoso.sharepoint.com/sites/a/p1'),
      'site-a', 'drive-a', '2026-10-01T00:00:00Z'
    )
  $$),
  'ok',
  'WOF-13 PA cannot call m365_link_record_folder for project'
);

select isnt(
  pg_temp.err('a2', $$
    select public.m365_link_record_folder(
      'procurement', '26300000-0000-0000-0000-000000000501',
      jsonb_build_object('drive_id','drive-a','item_id','proc-folder-item-1','item_kind','folder','name','PR-1','web_url','https://contoso.sharepoint.com/sites/a/pr1'),
      'site-a', 'drive-a', '2026-10-01T00:00:00Z'
    )
  $$),
  'ok',
  'WOF-13 PA cannot call m365_link_record_folder for procurement'
);

select isnt(
  pg_temp.err('b2', $$
    select public.m365_link_record_folder(
      'work_order', '26300000-0000-0000-0000-000000000301',
      jsonb_build_object('drive_id','drive-a','item_id','xorg-folder','item_kind','folder','name','X','web_url','https://contoso.sharepoint.com/sites/a/x'),
      'site-a', 'drive-a', '2026-10-01T00:00:00Z'
    )
  $$),
  'ok',
  'WOF-13 cross-org PA cannot link work_order folder'
);

-- Service-only receipt: allows PA on work_order, refuses PA on project
select is(
  (select count(*)::int from audit_events where org_id = '26300000-0000-0000-0000-00000000000a' and action = 'm365.folder_created'),
  0,
  'WOF-14 no folder_created receipt before call'
);
select lives_ok(
  $$ select public.m365_record_folder_created('26300000-0000-0000-0000-0000000000a2', 'work_order', '26300000-0000-0000-0000-000000000301', 'drive-a', 'wo-folder-item-1') $$,
  'WOF-14 service receipt succeeds for PA on work_order'
);
select throws_ok(
  $$ select public.m365_record_folder_created('26300000-0000-0000-0000-0000000000a2', 'project', '26300000-0000-0000-0000-000000000101', 'drive-a', 'proj-folder-item-1') $$,
  '42501', null,
  'WOF-14 service receipt refuses PA on project'
);

-- Receipt RPC EXECUTE privilege and caller refusal checks
select ok(
  has_function_privilege('service_role', 'public.m365_record_folder_created(uuid,text,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.m365_record_folder_created(uuid,text,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.m365_record_folder_created(uuid,text,uuid,text,text)', 'EXECUTE'),
  'WOF-14 receipt RPC EXECUTE granted to service_role only'
);

select isnt(
  pg_temp.err('a2', $$
    select public.m365_record_folder_created('26300000-0000-0000-0000-0000000000a2', 'work_order', '26300000-0000-0000-0000-000000000301', 'drive-a', 'wo-folder-item-2')
  $$),
  'ok',
  'WOF-14 authenticated caller cannot invoke service-only receipt RPC'
);

-- Folder category visibility helper and hidden Reference link refusal
select is(
  pg_temp.val('a2', $$ select public.m365_folder_category_visible('26300000-0000-0000-0000-00000000000a')::text $$),
  'true',
  'WOF-14b PA sees unhidden Reference folder category'
);

update public.document_categories
   set hidden_job_roles = array['project_administrator']
 where org_id = '26300000-0000-0000-0000-00000000000a'
   and lower(name) = 'reference'
   and archived_at is null;

select is(
  pg_temp.val('a2', $$ select public.m365_folder_category_visible('26300000-0000-0000-0000-00000000000a')::text $$),
  'false',
  'WOF-14b PA is refused folder category visibility when Reference is hidden'
);

select is(
  pg_temp.val('a1', $$ select public.m365_folder_category_visible('26300000-0000-0000-0000-00000000000a')::text $$),
  'true',
  'WOF-14b Admin retains folder category visibility when Reference is hidden from PA'
);

select isnt(
  pg_temp.err('a2', $$
    select public.m365_link_record_folder(
      'work_order', '26300000-0000-0000-0000-000000000302',
      jsonb_build_object('drive_id','drive-a','item_id','wo-folder-item-hidden','item_kind','folder','name','WO-002 WO A2','web_url','https://contoso.sharepoint.com/sites/a/wo2'),
      'site-a', 'drive-a', '2026-10-01T00:00:00Z'
    )
  $$),
  'ok',
  'WOF-14b PA cannot link work_order folder when Reference category is hidden'
);

update public.document_categories
   set hidden_job_roles = '{}'
 where org_id = '26300000-0000-0000-0000-00000000000a'
   and lower(name) = 'reference'
   and archived_at is null;

-- ── §4 Path 4: storage.objects ('project-documents' bucket) ────────────────────────────────────────────────────────────────────
select is(
  pg_temp.err('a2', $$
    insert into storage.objects (bucket_id, name)
    values ('project-documents', '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000801/spec.pdf')
  $$),
  'ok',
  'WOF-15 PA uploads storage object for own Draft work-order document'
);

select isnt(
  pg_temp.err('a4', $$
    insert into storage.objects (bucket_id, name)
    values ('project-documents', '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000801/eng.pdf')
  $$),
  'ok',
  'WOF-15 plain Engineer cannot insert into storage project-documents'
);

select isnt(
  pg_temp.err('a2', $$
    insert into storage.objects (bucket_id, name)
    values ('project-documents', '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000701/proj.pdf')
  $$),
  'ok',
  'WOF-16 PA cannot upload storage object for project-level doc (work_order_id null)'
);

-- Storage author ownership checks on Draft work-order documents
select isnt(
  pg_temp.err('a2', $$
    insert into storage.objects (bucket_id, name)
    values ('project-documents', '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000702/extra.pdf')
  $$),
  'ok',
  'WOF-17 PA cannot insert storage object on another user Draft WO doc'
);

select is(
  pg_temp.val('a2', $$
    with changed as (
      update storage.objects set metadata = '{"hijacked":true}'::jsonb
       where bucket_id = 'project-documents'
         and name = '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000702/orig.pdf'
      returning 1
    ) select count(*)::text from changed
  $$),
  '0',
  'WOF-17 PA cannot update storage object on another user Draft WO doc'
);

select is(
  (select metadata->>'orig' from storage.objects
    where bucket_id = 'project-documents'
      and name = '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000702/orig.pdf'),
  'true',
  'WOF-17 original storage object metadata retained'
);

select isnt(
  pg_temp.err('a2', $$
    update storage.objects
       set name = '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000702/moved.pdf'
     where bucket_id = 'project-documents'
       and name = '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000801/spec.pdf'
  $$),
  'ok',
  'WOF-17 PA cannot move own storage object onto another user Draft WO doc'
);

select is(
  pg_temp.val('a2', $$
    with changed as (
      update storage.objects set metadata = '{"pa_edit":true}'::jsonb
       where bucket_id = 'project-documents'
         and name = '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000801/spec.pdf'
      returning 1
    ) select count(*)::text from changed
  $$),
  '1',
  'WOF-17 PA can update storage object metadata on own Draft WO doc'
);

-- Mark WO doc 801 Issued as Admin -> PA can no longer update row or storage object
select is(
  pg_temp.err('a1', $$
    select public.transition_document_status('26300000-0000-0000-0000-000000000801', 'Issued'::public.doc_status)
  $$),
  'ok',
  'WOF-18 Admin transitions PA WO document to Issued (SoD satisfied)'
);

select is(
  pg_temp.val('a2', $$
    with changed as (
      update public.project_documents set title = 'Edit after Issued'
       where id = '26300000-0000-0000-0000-000000000801'
      returning 1
    ) select count(*)::text from changed
  $$),
  '0',
  'WOF-19 PA cannot update Issued work-order document'
);

select isnt(
  pg_temp.err('a2', $$
    insert into storage.objects (bucket_id, name)
    values ('project-documents', '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000801/after-issued.pdf')
  $$),
  'ok',
  'WOF-20 PA cannot insert storage object on Issued work-order document'
);

select is(
  pg_temp.val('a2', $$
    with changed as (
      update storage.objects set metadata = '{"after_issued":true}'::jsonb
       where bucket_id = 'project-documents'
         and name = '26300000-0000-0000-0000-00000000000a/26300000-0000-0000-0000-000000000101/26300000-0000-0000-0000-000000000801/spec.pdf'
      returning 1
    ) select count(*)::text from changed
  $$),
  '0',
  'WOF-21 PA cannot update storage object on Issued work-order document'
);

select * from finish();
rollback;
