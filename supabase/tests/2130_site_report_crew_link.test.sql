-- 2130_site_report_crew_link.test.sql — a daily site report may be linked to a crew or to a named person (docs/specs/site-report-crew-link.spec.md).
-- AC-SRC-001 optional link on create/edit · 002 one link only · 003 same organisation · 004 old payloads keep the link · 005 a correction keeps it.
-- MUTATION NOTES: dsr_save_draft: delete the `v_crew is not null and v_person is not null` refusal -> 'AC-SRC-002 both' goes red (the table check
-- daily_site_reports_one_link then fires 23514 too, so also drop that constraint to see it); delete the org test on crews -> 'AC-SRC-003' red;
-- change `if p ? 'crew_id' or p ? 'person_id'` to `if true` -> 'AC-SRC-004' red.
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, default_timezone) values
  ('21300000-0000-0000-0000-0000000000a1', 'SRC Org', 'USD', 'UTC'), ('21300000-0000-0000-0000-0000000000a2', 'SRC Other', 'USD', 'UTC');
insert into auth.users (id, email) values ('21300000-0000-0000-0000-0000000000b1', 'src-eng@example.com'), ('21300000-0000-0000-0000-0000000000b3', 'src-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21300000-0000-0000-0000-0000000000b1', '21300000-0000-0000-0000-0000000000a1', 'SRC Engineer', 'src-eng@example.com', 'Engineer', 'active'),
  ('21300000-0000-0000-0000-0000000000b3', '21300000-0000-0000-0000-0000000000a1', 'SRC Finance', 'src-fin@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency) values ('21300000-0000-0000-0000-0000000000c1', '21300000-0000-0000-0000-0000000000a1', 'SRC Contract', 'Ongoing Project', 'USD');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('21300000-0000-0000-0000-0000000000e1', '21300000-0000-0000-0000-0000000000a1', '21300000-0000-0000-0000-0000000000c1', 'WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('21300000-0000-0000-0000-000000000c01', '21300000-0000-0000-0000-0000000000a1', 'SRC-A', 'Crew A'),
  ('21300000-0000-0000-0000-000000000c02', '21300000-0000-0000-0000-0000000000a2', 'SRC-X', 'Foreign crew');
insert into people (id, org_id, code, name) values
  ('21300000-0000-0000-0000-000000000d01', '21300000-0000-0000-0000-0000000000a1', 'SRC-P1', 'Person One'),
  ('21300000-0000-0000-0000-000000000d02', '21300000-0000-0000-0000-0000000000a2', 'SRC-P2', 'Foreign Person');

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21300000-0000-0000-0000-0000000000b1","role":"authenticated"}';

insert into ids select 'plain', public.dsr_save_draft(jsonb_build_object('work_order_id', '21300000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-01'));
select is((select crew_id from daily_site_reports where id = (select v from ids where k = 'plain')), null, 'AC-SRC-001 a report with no link stays valid');

insert into ids select 'crew', public.dsr_save_draft(jsonb_build_object('work_order_id', '21300000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-02',
  'crew_id', '21300000-0000-0000-0000-000000000c01'));
select is((select crew_id from daily_site_reports where id = (select v from ids where k = 'crew')), '21300000-0000-0000-0000-000000000c01'::uuid, 'AC-SRC-001 a report is linked to a crew on create');

select lives_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'plain'), 'work_order_id', '21300000-0000-0000-0000-0000000000e1',
  'work_date', '2026-03-01', 'person_id', '21300000-0000-0000-0000-000000000d01'))$$, 'AC-SRC-001 an edit adds a named person');
select is((select person_id from daily_site_reports where id = (select v from ids where k = 'plain')), '21300000-0000-0000-0000-000000000d01'::uuid, 'AC-SRC-001 the person is stored');

select throws_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'plain'), 'work_order_id', '21300000-0000-0000-0000-0000000000e1',
  'work_date', '2026-03-01', 'crew_id', '21300000-0000-0000-0000-000000000c01', 'person_id', '21300000-0000-0000-0000-000000000d01'))$$, '23514', null,
  'AC-SRC-002 both a crew and a person is refused');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('work_order_id', '21300000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-03',
  'crew_id', '21300000-0000-0000-0000-000000000c02'))$$, '23503', null, 'AC-SRC-003 another organisation''s crew is refused');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('work_order_id', '21300000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-03',
  'person_id', '21300000-0000-0000-0000-000000000d02'))$$, '23503', null, 'AC-SRC-003 another organisation''s person is refused');

-- an older payload with no link keys keeps the link
select lives_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'crew'), 'work_order_id', '21300000-0000-0000-0000-0000000000e1',
  'work_date', '2026-03-02', 'note', 'edited'))$$, 'AC-SRC-004 an edit without link keys saves');
select is((select crew_id from daily_site_reports where id = (select v from ids where k = 'crew')), '21300000-0000-0000-0000-000000000c01'::uuid, 'AC-SRC-004 and keeps the crew');
-- an explicit null clears it
select lives_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'crew'), 'work_order_id', '21300000-0000-0000-0000-0000000000e1',
  'work_date', '2026-03-02', 'crew_id', null))$$, 'AC-SRC-001 an explicit empty link clears it');
select is((select crew_id from daily_site_reports where id = (select v from ids where k = 'crew')), null, 'AC-SRC-001 the crew is gone');

-- a correction keeps the link
reset role;
update daily_site_reports set crew_id = '21300000-0000-0000-0000-000000000c01', status = 'submitted', submitted_at = now() where id = (select v from ids where k = 'crew');
update daily_site_reports set status = 'validated', validated_by = '21300000-0000-0000-0000-0000000000b3', validated_at = now() where id = (select v from ids where k = 'crew');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21300000-0000-0000-0000-0000000000b3","role":"authenticated"}';
insert into ids select 'fix', public.dsr_correct((select v from ids where k = 'crew'), 'wrong quantity');
select is((select crew_id from daily_site_reports where id = (select v from ids where k = 'fix')), '21300000-0000-0000-0000-000000000c01'::uuid, 'AC-SRC-005 the correction copies the crew');
select is((select count(*)::int from daily_site_reports where crew_id = '21300000-0000-0000-0000-000000000c01'), 2, 'AC-SRC-001 the list can filter by crew');
select * from finish();
rollback;
