-- 1822_closing_report_types.test.sql — issue-closing-measure. Migration under test: 1822 (on 1820, 1821, 1424).
-- AC-ICM-006 the closing-time report groups by the type's current list label; a rename follows; old unmatched text is marked unlisted.
-- Mutation check (orchestrator): in 1822 replace `t.label` by `i.type` in the type-mode dept_name -> the "one group after a rename" assertion goes red.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, default_currency) values ('18220000-0000-0000-0000-00000000000a', 'ICM Report Org', 'USD');
insert into auth.users (id, email) values ('18220000-0000-0000-0000-0000000000a1', 'icm-rep-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18220000-0000-0000-0000-0000000000a1', '18220000-0000-0000-0000-00000000000a', 'Rep Admin', 'icm-rep-admin@example.com', 'Admin', 'active');
insert into issue_closing_report_settings (org_id, enabled, grouping_mode) values ('18220000-0000-0000-0000-00000000000a', true, 'type');
insert into incident_types (id, org_id, label) values ('18220000-0000-0000-0000-0000000000f1', '18220000-0000-0000-0000-00000000000a', 'Civil');

-- two closed Civil issues (24 h and 60 h) written through the list; one old row that matched no entry (trigger off, no link)
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, reported_by) values
  ('18220000-0000-0000-0000-000000000001', '18220000-0000-0000-0000-00000000000a', current_date, 'Civil', 'Low', 'Closed', now() - interval '24 hours', '18220000-0000-0000-0000-0000000000a1'),
  ('18220000-0000-0000-0000-000000000002', '18220000-0000-0000-0000-00000000000a', current_date, 'civil', 'Low', 'Closed', now() - interval '60 hours', '18220000-0000-0000-0000-0000000000a1');
alter table incident_reports disable trigger incident_reports_zz_type_list;
insert into incident_reports (id, org_id, incident_date, type, severity, status, created_at, reported_by) values
  ('18220000-0000-0000-0000-000000000003', '18220000-0000-0000-0000-00000000000a', current_date, 'Legacy text', 'Low', 'Open', now() - interval '5 hours', '18220000-0000-0000-0000-0000000000a1');
alter table incident_reports enable trigger incident_reports_zz_type_list;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('18220000-0000-0000-0000-0000000000a1');

select is((select count(*)::int from get_issue_closing_time_report(null, null, 'type') where department = 'Civil'), 1,
  'AC-ICM-006 spelling variants of one listed type are one group');
select is((select avg_closing_hours from get_issue_closing_time_report(null, null, 'type') where department = 'Civil'), 42.00,
  'AC-ICM-006 average closing hours of 24 h and 60 h is exact');
select is((select median_closing_hours from get_issue_closing_time_report(null, null, 'type') where department = 'Civil'), 42.00,
  'AC-ICM-006 median closing hours is exact');
select is((select total_issues from get_issue_closing_time_report(null, null, 'type') where department = 'Legacy text (unlisted)'), 1::bigint,
  'AC-ICM-006 old free text that matched no list entry groups under its own text, marked unlisted');

update incident_types set label = 'Civil works' where id = '18220000-0000-0000-0000-0000000000f1';
select is((select count(*)::int from get_issue_closing_time_report(null, null, 'type') where department in ('Civil', 'Civil works')), 1,
  'AC-ICM-006 after a rename there is still one group, under the new label');
select is((select closed_issues from get_issue_closing_time_report(null, null, 'type') where department = 'Civil works'), 2::bigint,
  'AC-ICM-006 the renamed group keeps both closed issues');

reset role;
select * from finish();
rollback;
