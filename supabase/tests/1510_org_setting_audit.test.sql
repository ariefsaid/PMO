-- 1510_org_setting_audit.test.sql — #2746. Migration under test: 1510. AC-OSM-020/021: every organisation setting change writes one
-- org.setting.change event, whichever path wrote it; an unchanged write writes none.
-- Mutation check: drop 'crew_loans_enabled' from the organizations trigger arguments: the crew loans case goes red.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values ('27460000-0000-0000-0000-00000000000a', 'OSA Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('27460000-0000-0000-0000-0000000000a1', 'osa-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27460000-0000-0000-0000-0000000000a1', '27460000-0000-0000-0000-00000000000a', 'OSA Admin', 'osa-admin@example.com', 'Admin', 'active');
create function public.osa_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.osa_events(p_setting text) returns int language sql security definer as $$
  select count(*)::int from public.audit_events
   where action = 'org.setting.change' and org_id = '27460000-0000-0000-0000-00000000000a' and detail ->> 'setting' = p_setting $$;
create function public.osa_last(p_setting text) returns jsonb language sql security definer as $$
  select detail || jsonb_build_object('actor', actor_id) from public.audit_events
   where action = 'org.setting.change' and detail ->> 'setting' = p_setting order by created_at desc, id desc limit 1 $$;

select osa_as('27460000-0000-0000-0000-0000000000a1');

-- an RPC path
select set_org_crew_loans_enabled(true);
select is(osa_events('organizations.crew_loans_enabled'), 1, 'AC-OSM-020 a setter RPC change writes one event');
select is(osa_last('organizations.crew_loans_enabled'),
  jsonb_build_object('setting', 'organizations.crew_loans_enabled', 'from', false, 'to', true, 'actor', '27460000-0000-0000-0000-0000000000a1'),
  'AC-OSM-020 the event carries setting, from, to and the actor');
select set_org_crew_loans_enabled(true);
select is(osa_events('organizations.crew_loans_enabled'), 1, 'AC-OSM-021 an unchanged write writes no event');

-- the column-grant path
update organizations set clearance_checklist_enabled = true where id = '27460000-0000-0000-0000-00000000000a';
select is(osa_events('organizations.clearance_checklist_enabled'), 1, 'AC-OSM-020 a direct column write writes one event');
update organizations set attendance_target_rate = 92.5 where id = '27460000-0000-0000-0000-00000000000a';
select is((osa_last('organizations.attendance_target_rate') ->> 'to')::numeric, 92.5, 'AC-OSM-020 a numeric setting records its new value');

-- a grouped setting writes one event per changed column
select set_leave_settings(true, 'Project Manager');
select is(osa_events('organizations.leave_requests_enabled') + osa_events('organizations.leave_approver_role'), 2,
  'AC-OSM-020 a two-column save writes one event per changed column');

-- a settings table (first save inserts the row)
select set_safety_records_enabled(true);
select is(osa_events('organizations.safety_records_enabled'), 1, 'AC-OSM-020 safety records');
select set_email_locale('id');
select is(osa_events('email_org_settings.locale'), 1, 'AC-OSM-020 a settings-table insert writes one event');
select set_email_locale('id');
select is(osa_events('email_org_settings.locale'), 1, 'AC-OSM-021 and an unchanged save writes none');

select set_email_event_setting('approval_request', true);
select is(osa_events('email_event_settings.enabled'), 1, 'AC-OSM-020 a per-key settings row writes one event for the changed column');

-- every column the trigger names exists (a renamed column fails here, not silently)
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where t.tgname = 'zz_audit_org_setting_change' and c.relnamespace = 'public'::regnamespace), 9,
  'AC-OSM-020 the audit trigger sits on organizations and the eight non-money settings tables');
select is((select count(*)::int
             from pg_trigger t, regexp_split_to_table(encode(t.tgargs, 'escape'), '\\000') a
            where t.tgname = 'zz_audit_org_setting_change' and a <> ''
              and not exists (select 1 from pg_attribute at where at.attrelid = t.tgrelid and at.attname = a and not at.attisdropped)), 0,
  'AC-OSM-020 every column a trigger names exists on its table');
select * from finish();
rollback;
