-- 1631_absence_reports.test.sql — a light or full worker reports only their own absence;
-- the roster keeper can read it, and unrelated workers cannot. The writer takes no person argument.
-- Mutation checks: removing people.profile_id = auth.uid() lets the unlinked light actor write;
-- removing people.org_id = auth_org_id() lets the cross-org-linked actor upsert the foreign person's row.
-- Leave-enabled recipient proof: controller + active configured line manager + active configured leave role;
-- non-vacuous candidate-fanout actor self-exclusion; exclusions for disabled leave-role profiles and unconfigured roles;
-- deduplication when controller is also line manager; explicit leave-disabled fixture (controller only);
-- the default null leave_approver_role fallback to Admin (one leave-on org with no role configured).
begin;
create extension if not exists pgtap;
select plan(64);

insert into organizations (id, name, default_currency, built_in_roles_enabled, leave_requests_enabled, leave_approver_role) values
  ('16310000-0000-0000-0000-00000000000a', 'ABS Org', 'IDR', true, true, 'Finance'),
  ('16310000-0000-0000-0000-00000000000b', 'ABS Other Org', 'IDR', true, true, null),
  ('16310000-0000-0000-0000-00000000000c', 'ABS Leave-Off Org', 'IDR', true, false, 'Finance'),
  ('16310000-0000-0000-0000-00000000000d', 'ABS Default Role Org', 'IDR', true, true, null);
insert into auth.users (id, email) values
  ('16310000-0000-0000-0000-0000000000a1', 'abs-foreman@example.com'),
  ('16310000-0000-0000-0000-0000000000a2', 'abs-field@example.com'),
  ('16310000-0000-0000-0000-0000000000a3', 'abs-other-field@example.com'),
  ('16310000-0000-0000-0000-0000000000a4', 'abs-engineer@example.com'),
  ('16310000-0000-0000-0000-0000000000a5', 'abs-inactive@example.com'),
  ('16310000-0000-0000-0000-0000000000a6', 'abs-archived@example.com'),
  ('16310000-0000-0000-0000-0000000000a7', 'abs-unlinked@example.com'),
  ('16310000-0000-0000-0000-0000000000a8', 'abs-cross-org@example.com'),
  ('16310000-0000-0000-0000-0000000000a9', 'abs-manager@example.com'),
  ('16310000-0000-0000-0000-0000000000aa', 'abs-admin@example.com'),
  ('16310000-0000-0000-0000-0000000000af', 'abs-finance@example.com'),
  ('16310000-0000-0000-0000-0000000000fd', 'abs-disabled-finance@example.com'),
  ('16310000-0000-0000-0000-0000000000ae', 'abs-dedup-worker@example.com'),
  ('16310000-0000-0000-0000-0000000000b1', 'abs-xorg-admin@example.com'),
  ('16310000-0000-0000-0000-0000000000c1', 'abs-off-foreman@example.com'),
  ('16310000-0000-0000-0000-0000000000c2', 'abs-off-worker@example.com'),
  ('16310000-0000-0000-0000-0000000000c3', 'abs-off-manager@example.com'),
  ('16310000-0000-0000-0000-0000000000c4', 'abs-off-finance@example.com'),
  ('16310000-0000-0000-0000-0000000000ba', 'abs-default-worker@example.com'),
  ('16310000-0000-0000-0000-0000000000bb', 'abs-default-admin@example.com'),
  ('16310000-0000-0000-0000-0000000000bc', 'abs-default-finance@example.com'),
  ('16310000-0000-0000-0000-0000000000bd', 'abs-default-manager@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role, manager_id) values
  ('16310000-0000-0000-0000-0000000000a9', '16310000-0000-0000-0000-00000000000a', 'ABS Manager', 'abs-manager@example.com', 'Project Manager', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000aa', '16310000-0000-0000-0000-00000000000a', 'ABS Admin', 'abs-admin@example.com', 'Admin', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000af', '16310000-0000-0000-0000-00000000000a', 'ABS Finance', 'abs-finance@example.com', 'Finance', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000fd', '16310000-0000-0000-0000-00000000000a', 'ABS Disabled Finance', 'abs-disabled-finance@example.com', 'Finance', 'disabled', null, null),
  ('16310000-0000-0000-0000-0000000000a1', '16310000-0000-0000-0000-00000000000a', 'ABS Foreman', 'abs-foreman@example.com', 'Engineer', 'active', 'foreman', null),
  ('16310000-0000-0000-0000-0000000000a2', '16310000-0000-0000-0000-00000000000a', 'ABS Field', 'abs-field@example.com', 'Engineer', 'active', 'field_user', '16310000-0000-0000-0000-0000000000a9'),
  ('16310000-0000-0000-0000-0000000000a3', '16310000-0000-0000-0000-00000000000a', 'ABS Other Field', 'abs-other-field@example.com', 'Engineer', 'active', 'field_user', null),
  ('16310000-0000-0000-0000-0000000000a4', '16310000-0000-0000-0000-00000000000a', 'ABS Engineer', 'abs-engineer@example.com', 'Engineer', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000a5', '16310000-0000-0000-0000-00000000000a', 'ABS Disabled', 'abs-inactive@example.com', 'Engineer', 'disabled', 'field_user', null),
  ('16310000-0000-0000-0000-0000000000a6', '16310000-0000-0000-0000-00000000000a', 'ABS Archived', 'abs-archived@example.com', 'Engineer', 'active', 'field_user', null),
  ('16310000-0000-0000-0000-0000000000a7', '16310000-0000-0000-0000-00000000000a', 'ABS Unlinked', 'abs-unlinked@example.com', 'Engineer', 'active', 'field_user', null),
  ('16310000-0000-0000-0000-0000000000a8', '16310000-0000-0000-0000-00000000000a', 'ABS Cross Org', 'abs-cross-org@example.com', 'Engineer', 'active', 'field_user', null),
  ('16310000-0000-0000-0000-0000000000ae', '16310000-0000-0000-0000-00000000000a', 'ABS Dedup Worker', 'abs-dedup-worker@example.com', 'Engineer', 'active', 'field_user', '16310000-0000-0000-0000-0000000000a1'),
  ('16310000-0000-0000-0000-0000000000b1', '16310000-0000-0000-0000-00000000000b', 'ABS XOrg Admin', 'abs-xorg-admin@example.com', 'Admin', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000c3', '16310000-0000-0000-0000-00000000000c', 'ABS Off Manager', 'abs-off-manager@example.com', 'Project Manager', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000c4', '16310000-0000-0000-0000-00000000000c', 'ABS Off Finance', 'abs-off-finance@example.com', 'Finance', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000c1', '16310000-0000-0000-0000-00000000000c', 'ABS Off Controller', 'abs-off-foreman@example.com', 'Engineer', 'active', 'foreman', null),
  ('16310000-0000-0000-0000-0000000000c2', '16310000-0000-0000-0000-00000000000c', 'ABS Off Worker', 'abs-off-worker@example.com', 'Engineer', 'active', 'field_user', '16310000-0000-0000-0000-0000000000c3'),
  ('16310000-0000-0000-0000-0000000000bd', '16310000-0000-0000-0000-00000000000d', 'ABS Default Manager', 'abs-default-manager@example.com', 'Project Manager', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000ba', '16310000-0000-0000-0000-00000000000d', 'ABS Default Worker', 'abs-default-worker@example.com', 'Engineer', 'active', 'field_user', '16310000-0000-0000-0000-0000000000bd'),
  ('16310000-0000-0000-0000-0000000000bb', '16310000-0000-0000-0000-00000000000d', 'ABS Default Admin', 'abs-default-admin@example.com', 'Admin', 'active', null, null),
  ('16310000-0000-0000-0000-0000000000bc', '16310000-0000-0000-0000-00000000000d', 'ABS Default Finance', 'abs-default-finance@example.com', 'Finance', 'active', null, null);
create temp table abs_today as
  select public.equipment_org_today('16310000-0000-0000-0000-00000000000a') as d;
grant select on abs_today to authenticated;

insert into projects (id, org_id, name, status, project_manager_id) values
  ('16310000-0000-0000-0000-0000000000d1', '16310000-0000-0000-0000-00000000000a', 'ABS Site', 'Ongoing Project', '16310000-0000-0000-0000-0000000000a4');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16310000-0000-0000-0000-000000000401', '16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-0000000000d1', 'ABS WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('16310000-0000-0000-0000-000000000c01', '16310000-0000-0000-0000-00000000000a', 'AB-A', 'Crew', '16310000-0000-0000-0000-0000000000a1'),
  ('16310000-0000-0000-0000-000000000cc1', '16310000-0000-0000-0000-00000000000c', 'AB-C', 'Off Crew', '16310000-0000-0000-0000-0000000000c1');
insert into people (id, org_id, kind, name, profile_id, archived_at) values
  ('16310000-0000-0000-0000-000000000f01', '16310000-0000-0000-0000-00000000000a', 'own', 'Field Worker', '16310000-0000-0000-0000-0000000000a2', null),
  ('16310000-0000-0000-0000-000000000f02', '16310000-0000-0000-0000-00000000000a', 'vendor', 'Other Worker', null, null),
  ('16310000-0000-0000-0000-000000000f03', '16310000-0000-0000-0000-00000000000a', 'own', 'Foreman', '16310000-0000-0000-0000-0000000000a1', null),
  ('16310000-0000-0000-0000-000000000f04', '16310000-0000-0000-0000-00000000000a', 'own', 'Other Field Worker', '16310000-0000-0000-0000-0000000000a3', null),
  ('16310000-0000-0000-0000-000000000f05', '16310000-0000-0000-0000-00000000000a', 'own', 'Full Engineer', '16310000-0000-0000-0000-0000000000a4', null),
  ('16310000-0000-0000-0000-000000000f06', '16310000-0000-0000-0000-00000000000a', 'own', 'Inactive Field', '16310000-0000-0000-0000-0000000000a5', null),
  ('16310000-0000-0000-0000-000000000f07', '16310000-0000-0000-0000-00000000000a', 'own', 'Archived Field', '16310000-0000-0000-0000-0000000000a6', now()),
  ('16310000-0000-0000-0000-000000000f08', '16310000-0000-0000-0000-00000000000a', 'own', 'Dedup Worker', '16310000-0000-0000-0000-0000000000ae', null),
  ('16310000-0000-0000-0000-000000000f10', '16310000-0000-0000-0000-00000000000b', 'own', 'Other Org Admin', '16310000-0000-0000-0000-0000000000b1', null),
  ('16310000-0000-0000-0000-000000000fc1', '16310000-0000-0000-0000-00000000000c', 'own', 'Off Controller', '16310000-0000-0000-0000-0000000000c1', null),
  ('16310000-0000-0000-0000-000000000fc2', '16310000-0000-0000-0000-00000000000c', 'own', 'Off Worker', '16310000-0000-0000-0000-0000000000c2', null),
  ('16310000-0000-0000-0000-000000000fe1', '16310000-0000-0000-0000-00000000000d', 'own', 'Default Role Worker', '16310000-0000-0000-0000-0000000000ba', null);
-- The composite profile/org FK correctly prevents this adversarial link in normal writes. Bypass
-- triggers only for this transaction-local fixture so the test proves report_absence checks org_id
-- even if a corrupt/legacy link reaches the table; restore trigger behavior before any assertions.
set local session_replication_role = replica;
insert into people (id, org_id, code, kind, name, profile_id) values
  ('16310000-0000-0000-0000-000000000f09', '16310000-0000-0000-0000-00000000000b', 'ABS-XORG', 'own', 'Cross Org Linked Actor', '16310000-0000-0000-0000-0000000000a8');
set local session_replication_role = origin;
insert into crew_members (org_id, crew_id, worker_id, valid_from)
  select '16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-000000000c01', v.x, a.d - 30
    from (values ('16310000-0000-0000-0000-000000000f01'::uuid),
                 ('16310000-0000-0000-0000-000000000f02'::uuid),
                 ('16310000-0000-0000-0000-000000000f03'::uuid),
                 ('16310000-0000-0000-0000-000000000f08'::uuid)) v(x), abs_today a;
insert into crew_members (org_id, crew_id, worker_id, valid_from)
  values ('16310000-0000-0000-0000-00000000000c', '16310000-0000-0000-0000-000000000cc1', '16310000-0000-0000-0000-000000000fc2', public.equipment_org_today('16310000-0000-0000-0000-00000000000c') - 30);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from)
  select '16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-000000000401', '16310000-0000-0000-0000-000000000c01', d - 30 from abs_today;

-- Both pre-existing unrelated reports, in separate organisations, must remain unchanged after the caller's own upsert.
insert into absence_reports (id, org_id, person_id, work_date, reason, note, reported_by) values
  ('16310000-0000-0000-0000-000000000b01', '16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-000000000f04', (select d from abs_today), 'sick', 'same-org sentinel', '16310000-0000-0000-0000-0000000000a4'),
  ('16310000-0000-0000-0000-000000000b02', '16310000-0000-0000-0000-00000000000b', '16310000-0000-0000-0000-000000000f10', public.equipment_org_today('16310000-0000-0000-0000-00000000000b'), 'other', 'other-org sentinel', '16310000-0000-0000-0000-0000000000b1');
create temp table abs_unrelated_before as
  select id, org_id, person_id, work_date, reason, note, reported_by, created_at
    from absence_reports where id in ('16310000-0000-0000-0000-000000000b01', '16310000-0000-0000-0000-000000000b02');

select ok((select count(*) = 1 and bool_and(p.proargnames = array['p_reason', 'p_note'])
            from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'report_absence'),
  'the callable absence writer has only reason and note inputs, with no caller-selected person');
select ok(not has_function_privilege('anon', 'public.report_absence(text,text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.report_absence(text,text)', 'EXECUTE'),
  'only authenticated callers can execute the absence writer');
select ok(not has_table_privilege('authenticated', 'public.absence_reports', 'INSERT')
          and not has_table_privilege('authenticated', 'public.absence_reports', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.absence_reports', 'DELETE'),
  'authenticated callers have no direct absence-report DML grants');

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(public.actor_is_light(), true, 'the Field user fixture is an active light account');
select lives_ok($$ select public.report_absence('sick', 'fever') $$, 'a light Field user reports themself absent');
select is((select count(*)::int from public.absence_reports), 1, 'the worker reads their own report');
select set_config('test.absence_report_id', (select id::text from public.absence_reports), true);
select lives_ok($$ select public.report_absence('other', null) $$, 'reporting again the same day replaces, not duplicates');
select is((select id::text from public.absence_reports), current_setting('test.absence_report_id'), 'restating the same day keeps the report id');
select is((select reason from public.absence_reports), 'other', 'the latest report stands');
select ok((select person_id = '16310000-0000-0000-0000-000000000f01'::uuid
                  and reported_by = '16310000-0000-0000-0000-0000000000a2'::uuid
                  and org_id = '16310000-0000-0000-0000-00000000000a'::uuid
             from public.absence_reports), 'the light writer stamps only its own person and organisation');
-- 22023 invalid_parameter_value, the code every refusal in this schema raises (22022 is indicator_overflow).
select throws_ok($$ select public.report_absence('holiday', null) $$, '22023', null, 'an unknown reason is refused');
select throws_ok($$ select public.report_absence('sick', repeat('x', 301)) $$, '22023', null, 'an overlong note is refused');
select throws_ok($$ insert into public.absence_reports (org_id, person_id, work_date, reason, reported_by)
                    values ('16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-000000000f02', current_date, 'sick', auth.uid()) $$,
  '42501', null, 'a light user cannot insert absence rows directly');
select throws_ok($$ update public.absence_reports set reason = 'sick' $$, '42501', null, 'a light user cannot update absence rows directly');
select throws_ok($$ delete from public.absence_reports $$, '42501', null, 'a light user cannot delete absence rows directly');

-- Observe both sentinels as the privileged test owner after the successful own create/upsert.
reset role;
select is((select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb)
             from (select id, org_id, person_id, work_date, reason, note, reported_by, created_at
                     from public.absence_reports
                    where id in ('16310000-0000-0000-0000-000000000b01', '16310000-0000-0000-0000-000000000b02')) a),
          (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from abs_unrelated_before b),
  'the self create/upsert leaves existing same-org and other-org reports unchanged');

-- The roster shows the report as reported-absent for its controller; the person without a report has none.
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(public.actor_is_light(), true, 'the Foreman fixture is an active light account');
select is((select count(*)::int from public.absence_reports where person_id = '16310000-0000-0000-0000-000000000f01'), 1,
  'the legitimate crew controller reads the Field user report');
select is((select m->'reported_absent'->>'reason'
             from public.work_order_roster('16310000-0000-0000-0000-000000000401', (select d from abs_today)) r,
                  jsonb_array_elements(r.members) m where m->>'worker_id' = '16310000-0000-0000-0000-000000000f01'),
          'other', 'the roster shows the reported absence');
select is((select count(*)::int
             from public.work_order_roster('16310000-0000-0000-0000-000000000401', (select d from abs_today)) r,
                  jsonb_array_elements(r.members) m where m ? 'reported_absent'),
          1, 'only the reporting person is marked');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000a1' and title = 'A crew member reports absent today'),
          1, 'the crew''s field controller was told once, though the day was re-stated');

-- Leave-enabled absence notification recipients (controller + line manager + active configured leave approver role):
reset role;
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000a9'
              and metadata->'entity'->>'id' = current_setting('test.absence_report_id')),
          1, 'the configured active line manager was told once');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000af'
              and metadata->'entity'->>'id' = current_setting('test.absence_report_id')),
          1, 'the active configured leave approver role profile was told once');
select is((select count(*)::int from public.notifications
            where org_id = '16310000-0000-0000-0000-00000000000a'
              and metadata->'entity'->>'id' = current_setting('test.absence_report_id')),
          3, 'exactly three notifications exist for the leave-enabled absence report');
select is((select array_agg(owner_id order by owner_id) from public.notifications
            where org_id = '16310000-0000-0000-0000-00000000000a'
              and metadata->'entity'->>'id' = current_setting('test.absence_report_id')),
          array['16310000-0000-0000-0000-0000000000a1'::uuid, '16310000-0000-0000-0000-0000000000a9'::uuid, '16310000-0000-0000-0000-0000000000af'::uuid],
          'recipient identities match controller, line manager, and active configured leave-role finance');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000fd'),
          0, 'disabled leave role profile is excluded from absence notifications');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000aa'),
          0, 'unconfigured admin role profile is excluded when leave_approver_role is configured');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000a2'),
          0, 'reporting person is never notified of their own absence');
select ok((select bool_and(severity = 'info'
                           and title = 'A crew member reports absent today'
                           and body = 'Field Worker reports not coming in today (sick).'
                           and metadata->'entity'->>'type' = 'absence_report'
                           and metadata->'entity'->>'id' = current_setting('test.absence_report_id')
                           and metadata->'entity'->>'label' = 'Absence')
             from public.notifications
            where org_id = '16310000-0000-0000-0000-00000000000a'
              and metadata->'entity'->>'id' = current_setting('test.absence_report_id')),
          'all absence notifications record correct title, severity, body, and entity metadata');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select is(public.actor_is_light(), true, 'the unrelated Field user fixture is an active light account');
select is((select count(*)::int from public.absence_reports where person_id = '16310000-0000-0000-0000-000000000f01'), 0,
  'an unrelated light user cannot read the Field user report');

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.absence_reports where org_id = '16310000-0000-0000-0000-00000000000a'), 0,
  'another organisation sees no report from the first organisation');
select is((select count(*)::int from public.absence_reports where id = '16310000-0000-0000-0000-000000000b02'), 1,
  'another organisation retains read access to its own existing report');

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a4', 'role', 'authenticated')::text, true);
select is(public.actor_is_light(), false, 'a full Engineer remains a full account');
select lives_ok($$ select public.report_absence('sick', 'full account regression') $$, 'a full Engineer may report their own absence');

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a5', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ilike($$ select public.report_absence('sick', null) $$,
  'your account is not an active member%', 'a disabled actor cannot report an absence');
reset role;
select is((select count(*)::int from public.absence_reports where reported_by = '16310000-0000-0000-0000-0000000000a5'), 0,
  'a disabled actor writes no report');

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a6', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ilike($$ select public.report_absence('sick', null) $$,
  'ABS_PERSON%', 'an actor linked only to an archived person cannot report');
reset role;
select is((select count(*)::int from public.absence_reports where reported_by = '16310000-0000-0000-0000-0000000000a6'), 0,
  'an archived-person actor writes no report');

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a7', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ilike($$ select public.report_absence('sick', null) $$,
  'ABS_PERSON%', 'an unlinked light actor cannot report for another same-org person');
reset role;
select is((select count(*)::int from public.absence_reports where reported_by = '16310000-0000-0000-0000-0000000000a7'), 0,
  'an unlinked actor writes no report despite other eligible people in the organisation');

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a8', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ilike($$ select public.report_absence('sick', 'cross-org attempt') $$,
  'ABS_PERSON%', 'a cross-org-linked actor cannot report against a foreign-org person');
reset role;
select is((select count(*)::int from public.absence_reports
            where person_id = '16310000-0000-0000-0000-000000000f09'
              and reported_by = '16310000-0000-0000-0000-0000000000a8'), 0,
  'a refused cross-org attempt creates no report for the foreign person');

-- Acting crew controller in candidate fan-out self-exclusion (non-vacuous actor exclusion proof):
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select public.report_absence('sick', null) $$,
  'acting crew controller in candidate fan-out reports own absence');
select set_config('test.controller_self_report_id', (select id::text from public.absence_reports where person_id = '16310000-0000-0000-0000-000000000f03'), true);
reset role;
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000a1'
              and metadata->'entity'->>'id' = current_setting('test.controller_self_report_id')),
          0, 'acting crew controller in candidate fan-out receives no notification for their own absence report');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000af'
              and metadata->'entity'->>'id' = current_setting('test.controller_self_report_id')),
          1, 'configured leave approver role receives notification when crew controller reports absent');
select is((select count(*)::int from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.controller_self_report_id')),
          1, 'exactly one notification written when reporter is the crew controller');

-- Controller = line manager deduplication:
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000ae', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select public.report_absence('sick', null) $$,
  'a worker whose line manager is the crew controller reports absence');
select set_config('test.dedup_report_id', (select id::text from public.absence_reports where person_id = '16310000-0000-0000-0000-000000000f08'), true);
reset role;
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000a1'
              and metadata->'entity'->>'id' = current_setting('test.dedup_report_id')),
          1, 'controller who is also line manager receives exactly one deduplicated notification');
select is((select count(*)::int from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.dedup_report_id')),
          2, 'controller/manager dedup limits total notification count to two (controller and finance)');
select is((select array_agg(owner_id order by owner_id) from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.dedup_report_id')),
          array['16310000-0000-0000-0000-0000000000a1'::uuid, '16310000-0000-0000-0000-0000000000af'::uuid],
          'dedup recipient set contains controller/manager once and configured leave role once');

-- Default leave approver role: leave on, `leave_approver_role` null, so the shipped
-- coalesce(o.leave_approver_role, 'Admin') fallback must notify the active Admin and not Finance.
-- The Admin, Finance and manager here are all distinct from the reporting worker and from each other,
-- and the worker is in no crew, so every recipient below is exactly and only the fallback path.
reset role;
select ok((select leave_approver_role is null and leave_requests_enabled
             from public.organizations where id = '16310000-0000-0000-0000-00000000000d'),
  'the default-role organisation leaves leave requests on with no configured approver role');
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000ba', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select public.report_absence('sick', 'default role report') $$,
  'a worker in the default leave-approver-role organisation reports absence');
select set_config('test.default_role_report_id', (select id::text from public.absence_reports where person_id = '16310000-0000-0000-0000-000000000fe1'), true);
reset role;
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000bb'
              and metadata->'entity'->>'id' = current_setting('test.default_role_report_id')),
          1, 'AC-SD-007 the fallback Admin approver is told once for the exact absence report');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000bc'
              and metadata->'entity'->>'id' = current_setting('test.default_role_report_id')),
          0, 'the Finance profile is excluded while the approver role falls back to Admin');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000bd'
              and metadata->'entity'->>'id' = current_setting('test.default_role_report_id')),
          1, 'the line manager is still told under the fallback role');
select is((select count(*)::int from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.default_role_report_id')),
          2, 'exactly two notifications exist: line manager and fallback Admin approver');
select is((select array_agg(owner_id order by owner_id) from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.default_role_report_id')),
          array['16310000-0000-0000-0000-0000000000bb'::uuid, '16310000-0000-0000-0000-0000000000bd'::uuid],
          'fallback recipient set is the Admin approver and the line manager only');

-- Explicit leave-disabled organisation fixture (controller only):
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select public.report_absence('sick', 'leave off report') $$,
  'a worker in an organisation with leave requests disabled reports absence');
select set_config('test.leave_off_report_id', (select id::text from public.absence_reports where org_id = '16310000-0000-0000-0000-00000000000c'), true);
reset role;
select is((select count(*)::int from public.absence_reports where id = current_setting('test.leave_off_report_id')),
          1, 'absence report row is saved in the leave-disabled organisation');
select is((select count(*)::int from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.leave_off_report_id')
              and owner_id = '16310000-0000-0000-0000-0000000000c1'),
          1, 'crew controller receives notification when leave requests are disabled');
select is((select count(*)::int from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.leave_off_report_id')
              and owner_id = '16310000-0000-0000-0000-0000000000c3'),
          0, 'line manager receives no notification when leave requests are disabled');
select is((select count(*)::int from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.leave_off_report_id')
              and owner_id = '16310000-0000-0000-0000-0000000000c4'),
          0, 'leave approver role receives no notification when leave requests are disabled');
select is((select count(*)::int from public.notifications
            where metadata->'entity'->>'id' = current_setting('test.leave_off_report_id')),
          1, 'only the field controller receives notification when leave requests are disabled');

select * from finish();
rollback;
