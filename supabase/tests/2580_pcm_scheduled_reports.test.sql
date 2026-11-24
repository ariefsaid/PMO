-- 2580_pcm_scheduled_reports.test.sql — TC-PC-19 (AC-SCH-013..017).
-- Project Control Manager creates/manages only schedules that role created for readable kinds, picking active non-banned non-light org recipients;
-- Admin schedules stay read-only to PCM; send path (tick + content + delivery claim) and re-enable re-check recipient eligibility;
-- Admin keeps full control and toggles organizations.pcm_scheduled_reports_enabled.
-- MUTATION NOTES (each edit must turn the named assertion red, then restore):
--   1. Drop the pcm_scheduled_reports_enabled check in save_scheduled_report -> 'AC-SCH-013 PCM refused when setting is off'
--   2. Drop the is_light_role_key check in scheduled_report_may_read        -> 'AC-SCH-014 PCM cannot pick field account recipient' & tick light skip
--   3. Drop the is_active_member check in scheduled_report_may_read         -> 'AC-SCH-014 PCM cannot pick banned recipient' & tick ban skip
--   4. Remove the creator role check in save/set_enabled/archive RPCs       -> 'AC-SCH-017 PCM cannot edit/toggle/archive Admin schedule'
--   5. Remove p_enabled re-check in set_scheduled_report_enabled            -> 'AC-SCH-016 PCM cannot re-enable schedule with reclassified/banned recipient'
--   6. Remove scheduled_report_may_read check in claim_email_outbox         -> 'AC-SCH-016 claim skips banned queued recipient'
--   7. Move the non-admin p_kind guard below unknown kind in save_scheduled_report -> 'PCM refused with admin only on non-readable kind'
--   8. Remove the project_control_manager branch in scheduled_report_content -> 'AC-SCH-015 PCM receives validated revenue across projects'
begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('25800000-0000-0000-0000-00000000000a', 'PCM Sch Org A', 'IDR', 'UTC', true),
  ('25800000-0000-0000-0000-00000000000b', 'PCM Sch Org B', 'IDR', 'UTC', true);

insert into auth.users (id, email, banned_until) values
  ('25800000-0000-0000-0000-0000000000a1', 'pcm-sch-admin@example.com',    null),
  ('25800000-0000-0000-0000-0000000000a2', 'pcm-sch-pcm@example.com',      null),
  ('25800000-0000-0000-0000-0000000000a3', 'pcm-sch-pm@example.com',       null),
  ('25800000-0000-0000-0000-0000000000a4', 'pcm-sch-eng@example.com',      null),
  ('25800000-0000-0000-0000-0000000000a5', 'pcm-sch-foreman@example.com',  null),
  ('25800000-0000-0000-0000-0000000000a6', 'pcm-sch-disabled@example.com', null),
  ('25800000-0000-0000-0000-0000000000a7', 'pcm-sch-plain-pm@example.com', null),
  ('25800000-0000-0000-0000-0000000000a8', 'pcm-sch-banned@example.com',   now() + interval '1 day'),
  ('25800000-0000-0000-0000-0000000000a9', 'pcm-sch-reclass@example.com',  null),
  ('25800000-0000-0000-0000-0000000000aa', 'pcm-sch-lateban@example.com',  null),
  ('25800000-0000-0000-0000-0000000000ab', 'pcm-sch-claimban@example.com', null),
  ('25800000-0000-0000-0000-0000000000ac', 'pcm-sch-admpcm@example.com',   null),
  ('25800000-0000-0000-0000-0000000000b1', 'pcm-sch-b-pcm@example.com',    null);

insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('25800000-0000-0000-0000-0000000000a1', '25800000-0000-0000-0000-00000000000a', 'Admin',       'pcm-sch-admin@example.com',    'Admin',           'active',   null),
  ('25800000-0000-0000-0000-0000000000a2', '25800000-0000-0000-0000-00000000000a', 'PCM',         'pcm-sch-pcm@example.com',      'Project Manager', 'active',   'project_control_manager'),
  ('25800000-0000-0000-0000-0000000000a3', '25800000-0000-0000-0000-00000000000a', 'PM',          'pcm-sch-pm@example.com',       'Project Manager', 'active',   'project_manager'),
  ('25800000-0000-0000-0000-0000000000a4', '25800000-0000-0000-0000-00000000000a', 'Engineer',    'pcm-sch-eng@example.com',      'Engineer',        'active',   'engineer'),
  ('25800000-0000-0000-0000-0000000000a5', '25800000-0000-0000-0000-00000000000a', 'Foreman',     'pcm-sch-foreman@example.com',  'Engineer',        'active',   'foreman'),
  ('25800000-0000-0000-0000-0000000000a6', '25800000-0000-0000-0000-00000000000a', 'Disabled',    'pcm-sch-disabled@example.com', 'Engineer',        'disabled', 'engineer'),
  ('25800000-0000-0000-0000-0000000000a7', '25800000-0000-0000-0000-00000000000a', 'Plain PM',    'pcm-sch-plain-pm@example.com', 'Project Manager', 'active',   null),
  ('25800000-0000-0000-0000-0000000000a8', '25800000-0000-0000-0000-00000000000a', 'Banned',      'pcm-sch-banned@example.com',   'Engineer',        'active',   'engineer'),
  ('25800000-0000-0000-0000-0000000000a9', '25800000-0000-0000-0000-00000000000a', 'Reclass',     'pcm-sch-reclass@example.com',  'Engineer',        'active',   'engineer'),
  ('25800000-0000-0000-0000-0000000000aa', '25800000-0000-0000-0000-00000000000a', 'LateBan',     'pcm-sch-lateban@example.com',  'Engineer',        'active',   'engineer'),
  ('25800000-0000-0000-0000-0000000000ab', '25800000-0000-0000-0000-00000000000a', 'ClaimBan',    'pcm-sch-claimban@example.com', 'Engineer',        'active',   'engineer'),
  ('25800000-0000-0000-0000-0000000000ac', '25800000-0000-0000-0000-00000000000a', 'AdminBuiltIn','pcm-sch-admbi@example.com',    'Admin',           'active',   'administrator'),
  ('25800000-0000-0000-0000-0000000000b1', '25800000-0000-0000-0000-00000000000b', 'OrgB PCM',    'pcm-sch-b-pcm@example.com',    'Project Manager', 'active',   'project_control_manager');

insert into projects (id, org_id, name, status, project_manager_id) values
  ('25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-00000000000a', 'Site Alpha', 'Ongoing Project', '25800000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25800000-0000-0000-0000-0000000000e1', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'WO A', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25800000-0000-0000-0000-0000000000f1', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', 'L1', 'Pipe', 'm', 100, 10);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('25800000-0000-0000-0000-000000000011', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000e1', '25800000-0000-0000-0000-0000000000f1', 100);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at) values
  ('25800000-0000-0000-0000-000000000a01', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000d1', '25800000-0000-0000-0000-0000000000e1', current_date, 'validated', '25800000-0000-0000-0000-0000000000a4', now(), '25800000-0000-0000-0000-0000000000a1', now());
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit, frozen_amount, frozen_at) values
  ('25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-000000000a01', 1, '25800000-0000-0000-0000-000000000011', 25, 'm', 2500.00, now());

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;

-- Default setting is on for new/existing orgs.
select is((select pcm_scheduled_reports_enabled from organizations where id = '25800000-0000-0000-0000-00000000000a'), true, 'default setting is on');
select ok(has_column_privilege('authenticated', 'organizations', 'pcm_scheduled_reports_enabled', 'UPDATE'), 'authenticated has update grant on switch column');
select ok(not has_column_privilege('anon', 'organizations', 'pcm_scheduled_reports_enabled', 'UPDATE'), 'anon has no update grant on switch column');

-- AC-SCH-015: PCM receives validated revenue for another PM's project in scheduled_report_content.
select ok((select body from public.scheduled_report_content('daily_progress', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000a2', current_date, current_date, 'en', 'Daily'))
  like '%Site Alpha%validated revenue 2500.00%', 'AC-SCH-015 PCM receives validated revenue across projects');
select ok((select body from public.scheduled_report_content('daily_progress', '25800000-0000-0000-0000-00000000000a', '25800000-0000-0000-0000-0000000000a4', current_date, current_date, 'en', 'Daily'))
  not like '%2500.00%', 'AC-SCH-015 Engineer receives no revenue figure');

-- Admin creates schedules first (one with a foreman recipient, one created by Admin carrying administrator built-in role).
set local role authenticated;
select pg_temp.act_as('25800000-0000-0000-0000-0000000000a1');
insert into ids select 'adm_daily', save_scheduled_report(null, 'Admin Daily', 'daily_progress', 'daily', null, '23:59:59',
  array['25800000-0000-0000-0000-0000000000a5']::uuid[], '{}', false);
select pg_temp.act_as('25800000-0000-0000-0000-0000000000ac');
insert into ids select 'adm_builtin', save_scheduled_report(null, 'Admin BuiltIn Role', 'daily_progress', 'daily', null, '23:59:59',
  '{}', array['Finance'], false);

-- AC-SCH-013 / AC-SCH-014 / AC-SCH-017 as PCM.
select pg_temp.act_as('25800000-0000-0000-0000-0000000000a2');

-- Recipient and kind restrictions: PCM cannot pick field account, disabled user, banned user, foreign user, invalid/light role, or non-readable kind.
select throws_ok($$select save_scheduled_report(null, 'Bad kind', 'other_kind', 'daily', null, '08:00',
  '{}', array['Finance'], true)$$,
  '42501', 'admin only', 'PCM refused with admin only on non-readable kind');
select throws_ok($$select save_scheduled_report(null, 'Bad light', 'daily_progress', 'daily', null, '08:00',
  array['25800000-0000-0000-0000-0000000000a4','25800000-0000-0000-0000-0000000000a5']::uuid[], '{}', true)$$,
  '42501', null, 'AC-SCH-014 PCM cannot pick field account recipient');
select throws_ok($$select save_scheduled_report(null, 'Bad disabled', 'daily_progress', 'daily', null, '08:00',
  array['25800000-0000-0000-0000-0000000000a6']::uuid[], '{}', true)$$,
  '42501', null, 'AC-SCH-014 PCM cannot pick inactive recipient');
select throws_ok($$select save_scheduled_report(null, 'Bad banned', 'daily_progress', 'daily', null, '08:00',
  array['25800000-0000-0000-0000-0000000000a8']::uuid[], '{}', true)$$,
  '42501', null, 'AC-SCH-014 PCM cannot pick banned recipient');
select throws_ok($$select save_scheduled_report(null, 'Bad foreign', 'daily_progress', 'daily', null, '08:00',
  array['25800000-0000-0000-0000-0000000000b1']::uuid[], '{}', true)$$,
  '42501', null, 'AC-SCH-014 PCM cannot pick another organisation user');
select throws_ok($$select save_scheduled_report(null, 'Bad role', 'daily_progress', 'daily', null, '08:00',
  '{}', array['foreman'], true)$$,
  '42501', null, 'AC-SCH-014 PCM cannot pick a light role key');

-- AC-SCH-017: Admin-created schedules are visible read-only to PCM; every write RPC refuses PCM.
select is((select count(*)::int from scheduled_reports where archived_at is null), 2, 'AC-SCH-017 PCM still reads Admin schedules');
select throws_ok($$select save_scheduled_report((select v from ids where k = 'adm_daily'), 'Hijack', 'daily_progress', 'daily', null, '08:00',
  array['25800000-0000-0000-0000-0000000000a3']::uuid[], '{}', true)$$,
  '42501', 'admin only', 'AC-SCH-017 PCM cannot edit Admin schedule');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'adm_daily'), true)$$,
  '42501', 'admin only', 'AC-SCH-017 PCM cannot enable Admin schedule');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'adm_daily'), false)$$,
  '42501', 'admin only', 'AC-SCH-017 PCM cannot disable Admin schedule');
select throws_ok($$select archive_scheduled_report((select v from ids where k = 'adm_daily'))$$,
  '42501', 'admin only', 'AC-SCH-017 PCM cannot archive Admin schedule');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'adm_builtin'), true)$$,
  '42501', 'admin only', 'AC-SCH-017 PCM cannot manage schedule created by built-in administrator');

-- Valid PCM create, read, edit, toggle, archive for both readable kinds.
insert into ids select 'pcm_daily', save_scheduled_report(null, 'PCM Daily', 'daily_progress', 'daily', null, '23:59:59',
  array['25800000-0000-0000-0000-0000000000a3','25800000-0000-0000-0000-0000000000a4']::uuid[], array['Finance'], true);
insert into ids select 'pcm_tasks', save_scheduled_report(null, 'PCM Tasks', 'overdue_tasks', 'weekly', 1, '09:00',
  '{}', array['Project Manager'], true);
insert into ids select 'pcm_re_enable_light', save_scheduled_report(null, 'PCM Off Light', 'daily_progress', 'daily', null, '23:59:59',
  array['25800000-0000-0000-0000-0000000000a9']::uuid[], '{}', false);
insert into ids select 'pcm_re_enable_ban', save_scheduled_report(null, 'PCM Off Ban', 'daily_progress', 'daily', null, '23:59:59',
  array['25800000-0000-0000-0000-0000000000aa']::uuid[], '{}', false);
insert into ids select 'pcm_tick', save_scheduled_report(null, 'PCM Tick', 'daily_progress', 'daily', null, '00:00',
  array['25800000-0000-0000-0000-0000000000a3','25800000-0000-0000-0000-0000000000a9','25800000-0000-0000-0000-0000000000aa','25800000-0000-0000-0000-0000000000ab']::uuid[],
  '{}', true);
select is((select count(*)::int from scheduled_reports where archived_at is null), 7, 'AC-SCH-013 PCM reads created and Admin scheduled reports');

select lives_ok($$select save_scheduled_report((select v from ids where k = 'pcm_daily'), 'PCM Daily Renamed', 'daily_progress', 'daily', null, '23:59:59',
  array['25800000-0000-0000-0000-0000000000a3']::uuid[], array['Project Manager'], true)$$, 'AC-SCH-013 PCM edits own role report');
select lives_ok($$select set_scheduled_report_enabled((select v from ids where k = 'pcm_daily'), false)$$, 'AC-SCH-013 PCM disables own role report');
select lives_ok($$select archive_scheduled_report((select v from ids where k = 'pcm_tasks'))$$, 'AC-SCH-013 PCM archives own role report');
select is((select enabled from scheduled_reports where id = (select v from ids where k = 'pcm_daily')), false, 'AC-SCH-013 toggle persisted');

-- PCM cannot read outbox, runs, email_event_settings, email_org_settings, nor toggle the org switch.
select throws_ok($$select * from scheduled_report_runs$$, '42501', null, 'PCM cannot read runs');
select throws_ok($$select * from email_outbox$$, '42501', null, 'PCM cannot read outbox');
select is((select count(*)::int from email_event_settings), 0, 'PCM reads no email_event_settings');
select is((select count(*)::int from email_org_settings), 0, 'PCM reads no email_org_settings');
update organizations set pcm_scheduled_reports_enabled = false;
select is((select pcm_scheduled_reports_enabled from organizations where id = '25800000-0000-0000-0000-00000000000a'), true, 'AC-SCH-014 PCM cannot change org setting');

-- AC-SCH-016: Post-save recipient reclassification to light role + post-save ban block re-enable and send path.
reset role;
update profiles set built_in_role = 'foreman' where id = '25800000-0000-0000-0000-0000000000a9';
update auth.users set banned_until = now() + interval '1 day' where id = '25800000-0000-0000-0000-0000000000aa';
update scheduled_reports set created_at = now() - interval '2 days' where id = (select v from ids where k = 'pcm_tick');

set local role authenticated;
select pg_temp.act_as('25800000-0000-0000-0000-0000000000a2');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'pcm_re_enable_light'), true)$$,
  '42501', null, 'AC-SCH-016 PCM cannot re-enable schedule with reclassified/banned recipient (light)');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'pcm_re_enable_ban'), true)$$,
  '42501', null, 'AC-SCH-016 PCM cannot re-enable schedule with reclassified/banned recipient (banned)');
select lives_ok($$select set_scheduled_report_enabled((select v from ids where k = 'pcm_re_enable_light'), false)$$,
  'AC-SCH-016 PCM may still keep/set ineligible schedule disabled');

reset role;
-- Tick queues only eligible recipients (a3 PM and ab ClaimBan), skipping reclassified light (a9) and banned (aa).
select is(scheduled_report_tick(), 2, 'AC-SCH-016 tick queues only eligible recipients after post-save role/ban changes');
select is((select count(*)::int from email_outbox where report_id = (select v from ids where k = 'pcm_tick')
            and recipient_id = '25800000-0000-0000-0000-0000000000a9'), 0,
  'AC-SCH-016 tick skips explicit recipient reclassified to light role');
select is((select count(*)::int from email_outbox where report_id = (select v from ids where k = 'pcm_tick')
            and recipient_id = '25800000-0000-0000-0000-0000000000aa'), 0,
  'AC-SCH-016 tick skips explicit recipient banned after save');
select is((select count(*)::int from scheduled_report_content('daily_progress', '25800000-0000-0000-0000-00000000000a',
            '25800000-0000-0000-0000-0000000000a9', current_date, current_date, 'en', 'Daily')), 0,
  'AC-SCH-016 content returns nothing for light role recipient');
select is((select count(*)::int from scheduled_report_content('daily_progress', '25800000-0000-0000-0000-00000000000a',
            '25800000-0000-0000-0000-0000000000aa', current_date, current_date, 'en', 'Daily')), 0,
  'AC-SCH-016 content returns nothing for banned recipient');

-- Delivery claim re-check: ban ClaimBan (ab) between queue and claim -> not claimed, marked failed/ineligible; eligible a3 claimed.
update auth.users set banned_until = now() + interval '1 day' where id = '25800000-0000-0000-0000-0000000000ab';
select is((select count(*)::int from claim_email_outbox(100) c
            where c.id in (select id from email_outbox where report_id = (select v from ids where k = 'pcm_tick')
                            and recipient_id = '25800000-0000-0000-0000-0000000000ab')), 0,
  'AC-SCH-016 claim skips banned queued recipient');
select is((select status || '/' || last_error from email_outbox
            where report_id = (select v from ids where k = 'pcm_tick')
              and recipient_id = '25800000-0000-0000-0000-0000000000ab'), 'failed/ineligible',
  'AC-SCH-016 banned queued row is marked failed/ineligible');
select is((select count(*)::int from email_outbox
            where report_id = (select v from ids where k = 'pcm_tick')
              and recipient_id = '25800000-0000-0000-0000-0000000000a3'
              and status = 'sending'), 1,
  'AC-SCH-016 eligible recipient row is still claimed for delivery');

-- Non-PCM roles (plain PM, Engineer, field account) are still refused; Org B PCM cannot see or touch Org A reports.
set local role authenticated;
select pg_temp.act_as('25800000-0000-0000-0000-0000000000a7');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'daily', null, '08:00', '{}', '{Finance}', true)$$, '42501', 'admin only', 'plain PM refused');
select is((select count(*)::int from scheduled_reports), 0, 'plain PM reads nothing');
select pg_temp.act_as('25800000-0000-0000-0000-0000000000a5');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'daily', null, '08:00', '{}', '{Finance}', true)$$, '42501', null, 'field account refused');
select pg_temp.act_as('25800000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from scheduled_reports), 0, 'Org B PCM sees no Org A report');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'pcm_daily'), true)$$, 'P0002', null, 'Org B PCM cannot toggle Org A report');

-- Admin switches pcm_scheduled_reports_enabled OFF -> PCM is refused, Admin retains full control.
select pg_temp.act_as('25800000-0000-0000-0000-0000000000a1');
update organizations set pcm_scheduled_reports_enabled = false where id = '25800000-0000-0000-0000-00000000000a';
select is((select pcm_scheduled_reports_enabled from organizations where id = '25800000-0000-0000-0000-00000000000a'), false, 'AC-SCH-014 Admin disables PCM setting');

select pg_temp.act_as('25800000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from scheduled_reports), 0, 'AC-SCH-013 PCM reads nothing when setting is off');
select throws_ok($$select save_scheduled_report(null, 'X', 'daily_progress', 'daily', null, '08:00', '{}', '{Finance}', true)$$, '42501', 'admin only', 'AC-SCH-013 PCM refused when setting is off');
select throws_ok($$select set_scheduled_report_enabled((select v from ids where k = 'pcm_daily'), true)$$, '42501', 'admin only', 'AC-SCH-013 PCM toggle refused when setting is off');
select throws_ok($$select archive_scheduled_report((select v from ids where k = 'pcm_daily'))$$, '42501', 'admin only', 'AC-SCH-013 PCM archive refused when setting is off');

-- Admin still manages all reports (both Admin and PCM created) and gets unknown report kind (22023) for bogus kinds.
select pg_temp.act_as('25800000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from scheduled_reports where archived_at is null), 6, 'AC-SCH-014 Admin still reads reports');
select throws_ok($$select save_scheduled_report(null, 'X', 'other_kind', 'daily', null, '08:00', '{}', '{Finance}', true)$$, '22023', 'unknown report kind', 'Admin unknown kind still raises 22023');
select lives_ok($$select set_scheduled_report_enabled((select v from ids where k = 'pcm_daily'), true)$$, 'AC-SCH-014 Admin can manage PCM-created schedule');
select lives_ok($$select save_scheduled_report(null, 'Admin Full', 'daily_progress', 'daily', null, '08:00',
  array['25800000-0000-0000-0000-0000000000a3']::uuid[], '{}', true)$$, 'AC-SCH-014 Admin keeps full control');

reset role;
select * from finish();
rollback;
