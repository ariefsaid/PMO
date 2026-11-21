-- 2707_cleared_for_site.test.sql — migrations 1235-1237 (#2707). Owns AC-CLR-001..006: item and state access, the cleared rule,
-- item states, the expiry check, second-org isolation, the setting default.
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27070000-0000-0000-0000-00000000000a', 'CLR Org',   'IDR', 'UTC'),
  ('27070000-0000-0000-0000-00000000000b', 'CLR Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27070000-0000-0000-0000-0000000000a1', 'clr-admin@example.com'),
  ('27070000-0000-0000-0000-0000000000a2', 'clr-pm@example.com'),
  ('27070000-0000-0000-0000-0000000000a3', 'clr-finance@example.com'),
  ('27070000-0000-0000-0000-0000000000a4', 'clr-eng@example.com'),
  ('27070000-0000-0000-0000-0000000000a5', 'clr-exec@example.com'),
  ('27070000-0000-0000-0000-0000000000b1', 'clr-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27070000-0000-0000-0000-0000000000a1', '27070000-0000-0000-0000-00000000000a', 'CLR Admin',   'clr-admin@example.com',   'Admin', 'active'),
  ('27070000-0000-0000-0000-0000000000a2', '27070000-0000-0000-0000-00000000000a', 'CLR PM',      'clr-pm@example.com',      'Project Manager', 'active'),
  ('27070000-0000-0000-0000-0000000000a3', '27070000-0000-0000-0000-00000000000a', 'CLR Finance', 'clr-finance@example.com', 'Finance', 'active'),
  ('27070000-0000-0000-0000-0000000000a4', '27070000-0000-0000-0000-00000000000a', 'CLR Eng',     'clr-eng@example.com',     'Engineer', 'active'),
  ('27070000-0000-0000-0000-0000000000a5', '27070000-0000-0000-0000-00000000000a', 'CLR Exec',    'clr-exec@example.com',    'Executive', 'active'),
  ('27070000-0000-0000-0000-0000000000b1', '27070000-0000-0000-0000-00000000000b', 'CLR XAdmin',  'clr-xadmin@example.com',  'Admin', 'active');
-- fixtures as owner: two people in A, one in B, and a foreign item
insert into people (id, org_id, code, name) values
  ('27070000-0000-0000-0000-0000000000c1', '27070000-0000-0000-0000-00000000000a', 'C-1', 'Person One'),
  ('27070000-0000-0000-0000-0000000000c2', '27070000-0000-0000-0000-00000000000a', 'C-2', 'Person Two'),
  ('27070000-0000-0000-0000-0000000000c9', '27070000-0000-0000-0000-00000000000b', 'C-9', 'Foreign Person');
insert into clearance_items (id, org_id, name) values
  ('27070000-0000-0000-0000-0000000000f9', '27070000-0000-0000-0000-00000000000b', 'Foreign item');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant insert (id) on public.clearance_items to authenticated;   -- fixture ids; rolled back with the test
grant insert (id) on public.person_clearances to authenticated;

-- setting default: off for an existing organisation
select is((select clearance_checklist_enabled from organizations where id = '27070000-0000-0000-0000-00000000000a'), false,
  'AC-CLR-013 the checklist setting defaults to off');

set local role authenticated;
select pg_temp.act_as('27070000-0000-0000-0000-0000000000a1');

-- AC-CLR-001 items: Admin defines; nobody else does
select is((select count(*)::int from person_clearance_summary() where cleared), 0, 'AC-CLR-003 no items defined: nobody is cleared');
insert into clearance_items (id, name, sort_order) values ('27070000-0000-0000-0000-0000000000d1', 'Item A', 1);
insert into clearance_items (id, name, sort_order) values ('27070000-0000-0000-0000-0000000000d2', 'Item B', 2);
insert into clearance_items (id, name, is_required, sort_order) values ('27070000-0000-0000-0000-0000000000d3', 'Item C', false, 3);
select is((select org_id from clearance_items where id = '27070000-0000-0000-0000-0000000000d1'), '27070000-0000-0000-0000-00000000000a'::uuid, 'AC-CLR-001 org_id is stamped from the caller');
select throws_ok($$insert into clearance_items (name) values ('  item a ')$$, '23505', null, 'AC-CLR-001 a live duplicate name is refused, case-insensitively');
select is((select count(*)::int from clearance_items), 3, 'AC-CLR-006 Admin sees only their own organisation''s items');
select is((select count(*)::int from person_clearance_summary() where cleared), 0, 'AC-CLR-003 items defined but nothing done: nobody is cleared');

-- AC-CLR-003 the cleared rule
insert into person_clearances (id, person_id, item_id, done_on) values ('27070000-0000-0000-0000-0000000000e1', '27070000-0000-0000-0000-0000000000c1', '27070000-0000-0000-0000-0000000000d1', current_date);
select is((select cleared from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c1'), false, 'AC-CLR-003 one of two required items done: not cleared');
select is((select satisfied_count from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c1'), 1, 'AC-CLR-003 satisfied count is 1');
insert into person_clearances (person_id, item_id, done_on, expires_on) values ('27070000-0000-0000-0000-0000000000c1', '27070000-0000-0000-0000-0000000000d2', current_date, current_date + 400);
select is((select cleared from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c1'), true, 'AC-CLR-003 every required item done and unexpired: cleared');
select is((select cleared from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c2'), false, 'AC-CLR-003 another person with nothing done is not cleared');
-- expired required item removes clearance (expiry validity: done_on must not exceed expires_on)
update person_clearances set done_on = current_date - 30, expires_on = current_date - 1 where person_id = '27070000-0000-0000-0000-0000000000c1' and item_id = '27070000-0000-0000-0000-0000000000d2';
select is((select cleared from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c1'), false, 'AC-CLR-003 an expired required item: not cleared');
select is((select state from person_clearance_items('27070000-0000-0000-0000-0000000000c1') where item_id = '27070000-0000-0000-0000-0000000000d2'), 'expired', 'AC-CLR-004 past expiry reads expired');
-- expiry today is still valid
update person_clearances set expires_on = current_date where person_id = '27070000-0000-0000-0000-0000000000c1' and item_id = '27070000-0000-0000-0000-0000000000d2';
select is((select cleared from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c1'), true, 'AC-CLR-003 expiring today is still cleared');
select is((select state from person_clearance_items('27070000-0000-0000-0000-0000000000c1') where item_id = '27070000-0000-0000-0000-0000000000d2'), 'expiring', 'AC-CLR-004 inside the warning window reads expiring');
select is((select state from person_clearance_items('27070000-0000-0000-0000-0000000000c1') where item_id = '27070000-0000-0000-0000-0000000000d1'), 'done', 'AC-CLR-004 a done item with no expiry reads done');
select is((select state from person_clearance_items('27070000-0000-0000-0000-0000000000c1') where item_id = '27070000-0000-0000-0000-0000000000d3'), 'missing', 'AC-CLR-004 an item with no row reads missing');
-- a non-required item never changes cleared
insert into person_clearances (person_id, item_id, done_on, expires_on) values ('27070000-0000-0000-0000-0000000000c1', '27070000-0000-0000-0000-0000000000d3', current_date - 10, current_date - 5);
select is((select cleared from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c1'), true, 'AC-CLR-003 an expired non-required item does not affect cleared');
-- an archived required item is ignored
update clearance_items set archived_at = now() where id = '27070000-0000-0000-0000-0000000000d2';
select is((select required_count from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c2'), 1, 'AC-CLR-003 an archived required item leaves the computation');
select is((select count(*)::int from person_clearance_items('27070000-0000-0000-0000-0000000000c1')), 2, 'AC-CLR-002 an archived item leaves the checklist');
update clearance_items set archived_at = null where id = '27070000-0000-0000-0000-0000000000d2';

-- AC-CLR-005 expiry before done is refused
select throws_ok($$update person_clearances set expires_on = done_on - 1 where person_id = '27070000-0000-0000-0000-0000000000c1' and item_id = '27070000-0000-0000-0000-0000000000d1'$$, '23514', null, 'AC-CLR-005 expiry before the done date is refused');

-- AC-CLR-006 second organisation
select throws_ok($$insert into person_clearances (person_id, item_id, done_on) values ('27070000-0000-0000-0000-0000000000c9', '27070000-0000-0000-0000-0000000000d1', current_date)$$, null, null, 'AC-CLR-006 a person from another organisation is refused');
select throws_ok($$insert into person_clearances (person_id, item_id, done_on) values ('27070000-0000-0000-0000-0000000000c1', '27070000-0000-0000-0000-0000000000f9', current_date)$$, null, null, 'AC-CLR-006 an item from another organisation is refused');
select is((select count(*)::int from person_clearance_items('27070000-0000-0000-0000-0000000000c9')), 0, 'AC-CLR-006 a foreign person has no checklist rows');
select is((select count(*)::int from person_clearance_summary() where person_id = '27070000-0000-0000-0000-0000000000c9'), 0, 'AC-CLR-006 a foreign person is not in the summary');

-- AC-CLR-002 Project Manager records state but does not define items
select pg_temp.act_as('27070000-0000-0000-0000-0000000000a2');
select lives_ok($$update person_clearances set note = 'checked' where person_id = '27070000-0000-0000-0000-0000000000c1' and item_id = '27070000-0000-0000-0000-0000000000d1'$$, 'AC-CLR-002 a Project Manager edits a person''s state');
select lives_ok($$insert into person_clearances (person_id, item_id, done_on) values ('27070000-0000-0000-0000-0000000000c2', '27070000-0000-0000-0000-0000000000d1', current_date)$$, 'AC-CLR-002 a Project Manager records a new state');
select throws_ok($$insert into clearance_items (name) values ('PM item')$$, '42501', null, 'AC-CLR-001 a Project Manager cannot define an item');
-- Finance and Executive read, never write
select pg_temp.act_as('27070000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from person_clearances), 4, 'AC-CLR-002 Finance reads the states');
select throws_ok($$insert into person_clearances (person_id, item_id, done_on) values ('27070000-0000-0000-0000-0000000000c2', '27070000-0000-0000-0000-0000000000d3', current_date)$$, '42501', null, 'AC-CLR-002 Finance cannot record state');
select pg_temp.act_as('27070000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from clearance_items), 3, 'AC-CLR-002 Executive reads the items');
-- Engineer reads nothing
select pg_temp.act_as('27070000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from person_clearances) + (select count(*)::int from clearance_items) + (select count(*)::int from person_clearance_summary()), 0, 'AC-CLR-002 an Engineer reads no checklist data');
select throws_ok($$insert into person_clearances (person_id, item_id, done_on) values ('27070000-0000-0000-0000-0000000000c2', '27070000-0000-0000-0000-0000000000d3', current_date)$$, '42501', null, 'AC-CLR-002 an Engineer cannot record state');
-- the setting: only an Admin writes it
update organizations set clearance_checklist_enabled = true where id = '27070000-0000-0000-0000-00000000000a';
select is((select clearance_checklist_enabled from organizations where id = '27070000-0000-0000-0000-00000000000a'), false, 'AC-CLR-013 a non-Admin cannot turn the setting on');
select pg_temp.act_as('27070000-0000-0000-0000-0000000000a1');
update organizations set clearance_checklist_enabled = true where id = '27070000-0000-0000-0000-00000000000a';
select is((select clearance_checklist_enabled from organizations where id = '27070000-0000-0000-0000-00000000000a'), true, 'AC-CLR-013 an Admin turns the setting on');

select * from finish();
rollback;
