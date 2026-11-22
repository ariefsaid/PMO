-- 1381_done_not_claimed_job.test.sql — the daily done-not-claimed notice (#2675). AC-DNC-008..010 (docs/specs/done-not-claimed-age.spec.md). Ids 13810000-… (synthetic).
-- Org a1 (reminder on in the main flow): b1 and b7 finance, b2 admin. Org a2: b8 admin only (no Finance), reminder off until the end.
-- a1 lines: I-1 accepted 6 days ago (over a 5-day limit), I-2 accepted 4 days ago, I-3 accepted exactly 5 days ago (not over).
begin;
create extension if not exists pgtap;
select plan(18);
insert into organizations (id, name, default_currency, default_timezone) values
  ('13810000-0000-0000-0000-0000000000a1', 'DNC Job A', 'IDR', 'UTC'), ('13810000-0000-0000-0000-0000000000a2', 'DNC Job B', 'IDR', 'UTC');
insert into auth.users (id, email) select ids.id, 'dnc-job-' || ids.n || '@example.invalid' from (values
  ('13810000-0000-0000-0000-0000000000b1'::uuid, 'fin'), ('13810000-0000-0000-0000-0000000000b7', 'fin2'), ('13810000-0000-0000-0000-0000000000b2', 'adm'), ('13810000-0000-0000-0000-0000000000b8', 'adm2')) ids(id, n);
insert into profiles (id, org_id, full_name, email, role, status) values
  ('13810000-0000-0000-0000-0000000000b1', '13810000-0000-0000-0000-0000000000a1', 'Job Finance', 'dnc-job-fin@example.invalid', 'Finance', 'active'),
  ('13810000-0000-0000-0000-0000000000b7', '13810000-0000-0000-0000-0000000000a1', 'Job Finance Two', 'dnc-job-fin2@example.invalid', 'Finance', 'active'),
  ('13810000-0000-0000-0000-0000000000b2', '13810000-0000-0000-0000-0000000000a1', 'Job Admin', 'dnc-job-adm@example.invalid', 'Admin', 'active'),
  ('13810000-0000-0000-0000-0000000000b8', '13810000-0000-0000-0000-0000000000a2', 'Job Admin B', 'dnc-job-adm2@example.invalid', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('13810000-0000-0000-0000-0000000000cc', '13810000-0000-0000-0000-0000000000a1', 'DNC Client', 'Client'),
  ('13810000-0000-0000-0000-0000000000cd', '13810000-0000-0000-0000-0000000000a2', 'DNC Client B', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, client_id) values
  ('13810000-0000-0000-0000-0000000000c1', '13810000-0000-0000-0000-0000000000a1', 'DNC job one', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, '13810000-0000-0000-0000-0000000000cc'),
  ('13810000-0000-0000-0000-0000000000c2', '13810000-0000-0000-0000-0000000000a2', 'DNC job two', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, '13810000-0000-0000-0000-0000000000cd');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis, line_no) values
  ('13810000-0000-0000-0000-000000000041', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', 'I-1', 'Item one', 'm', 100, 1000, 'unit_rate', 1),
  ('13810000-0000-0000-0000-000000000042', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', 'I-2', 'Item two', 'm', 100, 500, 'unit_rate', 2),
  ('13810000-0000-0000-0000-000000000043', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', 'I-3', 'Item three', 'm', 100, 100, 'unit_rate', 3),
  ('13810000-0000-0000-0000-000000000044', '13810000-0000-0000-0000-0000000000a2', '13810000-0000-0000-0000-0000000000c2', 'B-1', 'Item B', 'm', 100, 100, 'unit_rate', 1);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('13810000-0000-0000-0000-0000000000d1', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', 'DNC order one', 'Issued', 100000, 'exclusive', 0, 'IDR'),
  ('13810000-0000-0000-0000-0000000000d2', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', 'DNC order two', 'Issued', 100000, 'exclusive', 0, 'IDR'),
  ('13810000-0000-0000-0000-0000000000d3', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', 'DNC order three', 'Issued', 100000, 'exclusive', 0, 'IDR'),
  ('13810000-0000-0000-0000-0000000000d4', '13810000-0000-0000-0000-0000000000a2', '13810000-0000-0000-0000-0000000000c2', 'DNC order B', 'Issued', 100000, 'exclusive', 0, 'IDR');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000d1', '13810000-0000-0000-0000-000000000041', 20),
  ('13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000d2', '13810000-0000-0000-0000-000000000042', 20),
  ('13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000d3', '13810000-0000-0000-0000-000000000043', 20),
  ('13810000-0000-0000-0000-0000000000a2', '13810000-0000-0000-0000-0000000000d4', '13810000-0000-0000-0000-000000000044', 20);
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('13810000-0000-0000-0000-000000000051', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', '13810000-0000-0000-0000-0000000000d1', current_date - 6, false, 'Confirmed', '13810000-0000-0000-0000-0000000000b1', '13810000-0000-0000-0000-0000000000b1', now() - interval '6 days', 'standard'),
  ('13810000-0000-0000-0000-000000000052', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', '13810000-0000-0000-0000-0000000000d2', current_date - 4, false, 'Confirmed', '13810000-0000-0000-0000-0000000000b1', '13810000-0000-0000-0000-0000000000b1', now() - interval '4 days', 'standard'),
  ('13810000-0000-0000-0000-000000000053', '13810000-0000-0000-0000-0000000000a1', '13810000-0000-0000-0000-0000000000c1', '13810000-0000-0000-0000-0000000000d3', current_date - 5, false, 'Confirmed', '13810000-0000-0000-0000-0000000000b1', '13810000-0000-0000-0000-0000000000b1', now() - interval '5 days', 'standard'),
  ('13810000-0000-0000-0000-000000000054', '13810000-0000-0000-0000-0000000000a2', '13810000-0000-0000-0000-0000000000c2', '13810000-0000-0000-0000-0000000000d4', current_date - 30, false, 'Confirmed', '13810000-0000-0000-0000-0000000000b8', '13810000-0000-0000-0000-0000000000b8', now() - interval '30 days', 'standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('13810000-0000-0000-0000-000000000051', '13810000-0000-0000-0000-000000000041', 10), ('13810000-0000-0000-0000-000000000052', '13810000-0000-0000-0000-000000000042', 10),
  ('13810000-0000-0000-0000-000000000053', '13810000-0000-0000-0000-000000000043', 10), ('13810000-0000-0000-0000-000000000054', '13810000-0000-0000-0000-000000000044', 10);

create function pg_temp.notices(p_user text) returns int language sql as $$
  select count(*)::int from notifications n where n.owner_id = ('13810000-0000-0000-0000-0000000000' || p_user)::uuid and n.title = 'Work is done but not yet claimed' $$;
create function pg_temp.claims_and_invoices() returns int language sql as $$
  select (select count(*) from progress_claims) + (select count(*) from sales_invoices) $$;

create temp table base as select pg_temp.claims_and_invoices() as n;
-- AC-DNC-008: reminder off (the default row), then reminder on with no limit: the job does nothing.
insert into org_billing_plan_settings (org_id, done_not_claimed_reminder_on, done_not_claimed_after_days, updated_by) values
  ('13810000-0000-0000-0000-0000000000a1', false, 5, '13810000-0000-0000-0000-0000000000b1'),
  ('13810000-0000-0000-0000-0000000000a2', false, 5, '13810000-0000-0000-0000-0000000000b8');
select is(notify_done_not_claimed(), 0, 'AC-DNC-008 reminder off: the job returns 0');
select is((select count(*)::int from done_not_claimed_notices) + (select count(*)::int from notifications where title = 'Work is done but not yet claimed'), 0, 'AC-DNC-008 reminder off: no stamp and no notice');
update org_billing_plan_settings set done_not_claimed_reminder_on = true, done_not_claimed_after_days = null where org_id = '13810000-0000-0000-0000-0000000000a1';
select is(notify_done_not_claimed(), 0, 'AC-DNC-008 reminder on but no limit: the job returns 0');
select is((select count(*)::int from done_not_claimed_notices), 0, 'AC-DNC-008 reminder on, no limit: no stamp');
-- AC-DNC-009: on with a 5-day limit: only the 6-day line, once.
update org_billing_plan_settings set done_not_claimed_after_days = 5 where org_id = '13810000-0000-0000-0000-0000000000a1';
select is(notify_done_not_claimed(), 1, 'AC-DNC-009 one line is over the limit (6 days; 5 and 4 are not)');
select is(pg_temp.notices('b1') + pg_temp.notices('b7'), 2, 'AC-DNC-009 each active Finance user is told once');
select is(pg_temp.notices('b2'), 0, 'AC-DNC-009 an Admin is not told while the organisation has active Finance users');
select results_eq($$ select work_order_id, boq_item_id from done_not_claimed_notices $$,
  $$ values ('13810000-0000-0000-0000-0000000000d1'::uuid, '13810000-0000-0000-0000-000000000041'::uuid) $$, 'AC-DNC-009 one stamp, for the 6-day line');
select is(notify_done_not_claimed(), 0, 'AC-DNC-009 a second run adds nothing');
select is(pg_temp.notices('b1') + pg_temp.notices('b7') + (select count(*)::int from done_not_claimed_notices), 3, 'AC-DNC-009 still two notices and one stamp after the second run');
select is((select count(*)::int from audit_events where action = 'done_not_claimed.notified'), 1, 'AC-DNC-009 one audit event');
-- AC-DNC-010: the other organisation (reminder off) is untouched; nothing billing is created.
select is((select count(*)::int from notifications where org_id = '13810000-0000-0000-0000-0000000000a2') + (select count(*)::int from done_not_claimed_notices where org_id = '13810000-0000-0000-0000-0000000000a2'), 0, 'AC-DNC-010 an organisation with the reminder off is untouched, though its line is 30 days old');
select is(pg_temp.claims_and_invoices(), (select n from pg_temp.base), 'AC-DNC-010 the job creates no claim and no invoice');
-- AC-DNC-010: switching the other organisation on notifies its Admin (no Finance user) and never repeats the first organisation.
update org_billing_plan_settings set done_not_claimed_reminder_on = true where org_id = '13810000-0000-0000-0000-0000000000a2';
select is(notify_done_not_claimed(), 1, 'AC-DNC-010 the other organisation is notified once it is switched on');
select is(pg_temp.notices('b8'), 1, 'AC-DNC-010 with no active Finance user the active Admin is told');
select is(pg_temp.notices('b1') + pg_temp.notices('b7'), 2, 'AC-DNC-010 the first organisation Finance users got nothing new');
select is((select count(*)::int from done_not_claimed_notices where org_id = '13810000-0000-0000-0000-0000000000a1'), 1, 'AC-DNC-010 the first organisation still has its one stamp');
select is(has_function_privilege('authenticated', 'public.notify_done_not_claimed()', 'execute'), false, 'the job is not callable by a client');
select * from finish();
rollback;
