-- 1620_dsr_empty_submit_withdraw.test.sql -- walk fix: an empty daily report is refused at the database, a sent one can be withdrawn.
-- Mutation check (do before merging): remove the `if not exists ...` block from dsr_submit -> 'an empty report is refused' goes red;
-- remove the author check from dsr_withdraw -> 'only the author can withdraw' goes red.
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, default_timezone) values
  ('16200000-0000-0000-0000-0000000000a1', 'DSW Org', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('16200000-0000-0000-0000-0000000000b1', 'dsw-eng@example.com'),
  ('16200000-0000-0000-0000-0000000000b2', 'dsw-eng2@example.com'),
  ('16200000-0000-0000-0000-0000000000b3', 'dsw-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16200000-0000-0000-0000-0000000000b1', '16200000-0000-0000-0000-0000000000a1', 'DSW Engineer', 'dsw-eng@example.com', 'Engineer', 'active'),
  ('16200000-0000-0000-0000-0000000000b2', '16200000-0000-0000-0000-0000000000a1', 'DSW Engineer Two', 'dsw-eng2@example.com', 'Engineer', 'active'),
  ('16200000-0000-0000-0000-0000000000b3', '16200000-0000-0000-0000-0000000000a1', 'DSW Finance', 'dsw-fin@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('16200000-0000-0000-0000-0000000000c1', '16200000-0000-0000-0000-0000000000a1', 'DSW Contract', 'Ongoing Project', 'USD');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16200000-0000-0000-0000-0000000000e1', '16200000-0000-0000-0000-0000000000a1', '16200000-0000-0000-0000-0000000000c1', 'WO one', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('16200000-0000-0000-0000-0000000000f1', '16200000-0000-0000-0000-0000000000a1', '16200000-0000-0000-0000-0000000000c1', 'L1', 'Weld line', 'm', 100, 5);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('16200000-0000-0000-0000-000000000011', '16200000-0000-0000-0000-0000000000a1', '16200000-0000-0000-0000-0000000000e1', '16200000-0000-0000-0000-0000000000f1', 100);

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"16200000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- an empty report
insert into ids select 'empty', public.dsr_save_draft(jsonb_build_object('work_order_id', '16200000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-10'));
select throws_ok($$select public.dsr_submit((select v from ids where k = 'empty'))$$, 'DS001', 'dsr_empty: progress,hours,photo',
  'an empty report is refused and says what is missing');
select is((select status from daily_site_reports where id = (select v from ids where k = 'empty')), 'draft', 'the refused report stays a draft');

-- hours alone make it a report
select lives_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'empty'),
  'work_order_id', '16200000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-10', 'start_time', '07:00', 'end_time', '16:00'))$$,
  'the author adds hours');
select lives_ok($$select public.dsr_submit((select v from ids where k = 'empty'))$$, 'a report with hours is sent');
select is((select status from daily_site_reports where id = (select v from ids where k = 'empty')), 'submitted', 'it is submitted');

-- progress alone also makes it a report
insert into ids select 'prog', public.dsr_save_draft(jsonb_build_object('work_order_id', '16200000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-11',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '16200000-0000-0000-0000-000000000011', 'quantity', 5))));
select lives_ok($$select public.dsr_submit((select v from ids where k = 'prog'))$$, 'a report with progress is sent');

-- withdraw: only the author, only while sent
set local request.jwt.claims = '{"sub":"16200000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$select public.dsr_withdraw((select v from ids where k = 'prog'))$$, '42501', 'only the author can withdraw this report',
  'only the author can withdraw');
set local request.jwt.claims = '{"sub":"16200000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select public.dsr_withdraw((select v from ids where k = 'prog'))$$, 'the author withdraws a sent report');
select is((select status from daily_site_reports where id = (select v from ids where k = 'prog')), 'draft', 'it is a draft again');
select is((select submitted_at from daily_site_reports where id = (select v from ids where k = 'prog')), null, 'with no sent time');
select is((select action from dsr_events where report_id = (select v from ids where k = 'prog') order by at desc, id desc limit 1), 'withdrawn',
  'the withdrawal is in the history');

-- once validated, it cannot be withdrawn (a return or a correction is the way)
reset role;
update daily_site_reports set status = 'submitted', submitted_at = now() where id = (select v from ids where k = 'prog');
update daily_site_reports set status = 'validated', validated_by = '16200000-0000-0000-0000-0000000000b3', validated_at = now() where id = (select v from ids where k = 'prog');
set local role authenticated;
set local request.jwt.claims = '{"sub":"16200000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.dsr_withdraw((select v from ids where k = 'prog'))$$, '42501', 'only a sent report can be withdrawn',
  'a validated report cannot be withdrawn');
select ok(has_function_privilege('authenticated', 'public.dsr_withdraw(uuid)', 'execute'), 'signed-in members can call dsr_withdraw');

select * from finish();
rollback;
