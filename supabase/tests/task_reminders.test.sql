-- task_reminders.test.sql — AC-RMD-001..012 (#1639). Each rule has a case that changes the outcome when the rule is
-- removed (mutation-check: comment out a rule in task_reminder_check and its case goes red).
begin;
create extension if not exists pgtap;
select plan(35);

insert into organizations (id, name) values
  ('16390000-0000-0000-0000-00000000000a', 'RMD Org A'),
  ('16390000-0000-0000-0000-00000000000b', 'RMD Org B');
insert into auth.users (id, email) values
  ('16390000-0000-0000-0000-0000000000a1', 'rmd-pm@example.com'),
  ('16390000-0000-0000-0000-0000000000a2', 'rmd-eng@example.com'),
  ('16390000-0000-0000-0000-0000000000a3', 'rmd-disabled@example.com'),
  ('16390000-0000-0000-0000-0000000000a4', 'rmd-banned@example.com'),
  ('16390000-0000-0000-0000-0000000000a5', 'rmd-pm2@example.com'),
  ('16390000-0000-0000-0000-0000000000b1', 'rmd-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status, timezone) values
  ('16390000-0000-0000-0000-0000000000a1', '16390000-0000-0000-0000-00000000000a', 'Project manager', 'rmd-pm@example.com', 'Project Manager', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a2', '16390000-0000-0000-0000-00000000000a', 'Site engineer', 'rmd-eng@example.com', 'Engineer', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a3', '16390000-0000-0000-0000-00000000000a', 'Disabled member', 'rmd-disabled@example.com', 'Engineer', 'disabled', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a4', '16390000-0000-0000-0000-00000000000a', 'Banned member', 'rmd-banned@example.com', 'Engineer', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000a5', '16390000-0000-0000-0000-00000000000a', 'Second manager', 'rmd-pm2@example.com', 'Project Manager', 'active', 'UTC'),
  ('16390000-0000-0000-0000-0000000000b1', '16390000-0000-0000-0000-00000000000b', 'Org B member', 'rmd-b@example.com', 'Engineer', 'active', 'UTC');
update auth.users set banned_until = now() + interval '1 day' where id = '16390000-0000-0000-0000-0000000000a4';

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('16390000-0000-0000-0000-0000000000c1', '16390000-0000-0000-0000-00000000000a', 'RMD Proj A', 'Ongoing Project', date '2026-01-01', date '2027-12-31'),
  ('16390000-0000-0000-0000-0000000000c2', '16390000-0000-0000-0000-00000000000b', 'RMD Proj B', 'Ongoing Project', date '2026-01-01', date '2027-12-31');

-- Inserted as the table owner (auth.uid() is null), so the 0237 assignment trigger writes no notification.
-- t1/t10/t11 overdue -> site engineer; t2 overdue -> PM (self); t3 org B; t4 disabled; t5 banned; t6 Done;
-- t7 due today; t9 unassigned; t12 org-A task assigned to the org-B member (no constraint ties assignee to org).
insert into tasks (id, org_id, project_id, name, status, end_date, assignee_id) values
  ('16390000-0000-0000-0000-0000000000d1', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD late pour', 'In Progress', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-0000000000d2', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD own task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a1'),
  ('16390000-0000-0000-0000-0000000000d3', '16390000-0000-0000-0000-00000000000b', '16390000-0000-0000-0000-0000000000c2', 'RMD org B task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000b1'),
  ('16390000-0000-0000-0000-0000000000d4', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD disabled task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a3'),
  ('16390000-0000-0000-0000-0000000000d5', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD banned task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a4'),
  ('16390000-0000-0000-0000-0000000000d6', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD done task', 'Done', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-0000000000d7', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD due today', 'To Do', (now() at time zone 'UTC')::date, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-0000000000d9', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD unassigned', 'Blocked', (now() at time zone 'UTC')::date - 3, null),
  ('16390000-0000-0000-0000-000000000d10', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD cap task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-000000000d11', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD preview task', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000a2'),
  ('16390000-0000-0000-0000-000000000d12', '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000c1', 'RMD cross-org assignee', 'To Do', (now() at time zone 'UTC')::date - 3, '16390000-0000-0000-0000-0000000000b1');

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
-- outcomes of a send/preview result, ordered by task id (the RPC processes ids in ascending order)
create function pg_temp.outcomes(r jsonb) returns text[] language sql immutable as $$
  select array_agg(i->>'outcome' order by i->>'task_id') from jsonb_array_elements(r->'items') i $$;
-- reminder notifications an owner holds (read as the table owner, outside RLS)
create function pg_temp.reminders_for(p uuid) returns int language sql stable as $$
  select count(*)::int from notifications where owner_id = p and title = 'Reminder: a task is overdue' $$;

-- AC-RMD-001
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d1'::uuid])), array['sent'],
  'AC-RMD-001 a reminder for an overdue task assigned to an active colleague is sent');
reset role;
select is((select count(*)::int from notifications where owner_id = '16390000-0000-0000-0000-0000000000a2'
            and title = 'Reminder: a task is overdue' and metadata->'entity'->>'type' = 'task'
            and metadata->'entity'->>'id' = '16390000-0000-0000-0000-0000000000d1'), 1,
  'AC-RMD-001 the assignee has one reminder notification that opens the task');
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from task_reminders where task_id = '16390000-0000-0000-0000-0000000000d1'
            and recipient_id = '16390000-0000-0000-0000-0000000000a2'), 1,
  'AC-RMD-001 the sender reads one ledger row naming recipient and task');

set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d2'::uuid])), array['self'],
  'AC-RMD-002 the sender is never reminded about their own task');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d3'::uuid])), array['not_found'],
  'AC-RMD-003 another org''s task is not found');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d4'::uuid,
                                                     '16390000-0000-0000-0000-0000000000d5'::uuid])),
  array['recipient_inactive', 'recipient_inactive'], 'AC-RMD-004 disabled and banned assignees are not reminded');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-000000000d12'::uuid])), array['recipient_inactive'],
  'AC-RMD-004 an assignee outside the sender''s org is not reminded');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d6'::uuid,
                                                     '16390000-0000-0000-0000-0000000000d7'::uuid,
                                                     '16390000-0000-0000-0000-0000000000d9'::uuid])),
  array['not_overdue', 'not_overdue', 'no_assignee'], 'AC-RMD-008 done or due-today tasks are not overdue; unassigned has no recipient');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a5');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-0000000000d1'::uuid])), array['already_reminded'],
  'AC-RMD-006 a second sender within 24 hours does not repeat the reminder');
reset role;
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a2'), 1,
  'AC-RMD-006 the assignee still holds exactly one reminder');
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000b1'), 0,
  'AC-RMD-003 the other org''s assignee received nothing');
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a3') + pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a4'), 0,
  'AC-RMD-004 inactive assignees received nothing');

-- AC-RMD-005: 20 sends by the second manager in the last hour (as owner; the Done task keeps them off the target task)
insert into task_reminders (org_id, sender_id, recipient_id, task_id, created_at)
select '16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000a5',
       '16390000-0000-0000-0000-0000000000a2', '16390000-0000-0000-0000-0000000000d6', now() - interval '1 hour'
  from generate_series(1, 20);
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a5');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-000000000d10'::uuid])), array['daily_limit'],
  'AC-RMD-005 the 21st reminder in 24 hours is refused');
reset role;
update task_reminders set created_at = now() - interval '25 hours'
 where sender_id = '16390000-0000-0000-0000-0000000000a5';
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a5');
select is(pg_temp.outcomes(send_task_reminders(array['16390000-0000-0000-0000-000000000d10'::uuid])), array['sent'],
  'AC-RMD-005 reminders older than 24 hours do not count');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a3');
select throws_ok($$ select send_task_reminders(array['16390000-0000-0000-0000-0000000000d1'::uuid]) $$, '42501', null,
  'AC-RMD-007 a disabled sender is refused');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select throws_ok($$ select send_task_reminders((select array_agg(gen_random_uuid()) from generate_series(1, 11))) $$, '22023', null,
  'AC-RMD-011 more than 10 tasks is refused');
select throws_ok($$ select send_task_reminders(array[]::uuid[]) $$, '22023', null, 'AC-RMD-011 an empty batch is refused');
select throws_ok($$ select preview_task_reminders((select array_agg(gen_random_uuid()) from generate_series(1, 51))) $$, '22023', null,
  'AC-RMD-011 a preview of more than 50 tasks is refused');

reset role;
-- a ledger row the disabled member sent before being disabled (as the table owner)
insert into task_reminders (org_id, sender_id, recipient_id, task_id) values
  ('16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000a3', '16390000-0000-0000-0000-0000000000a2',
   '16390000-0000-0000-0000-0000000000d6');
set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from task_reminders), 0, 'AC-RMD-009 a disabled sender reads none of their own ledger rows');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from task_reminders), 0, 'AC-RMD-009 the recipient does not read the sender''s ledger');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from task_reminders), 0, 'AC-RMD-009 another org reads no ledger rows');
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into task_reminders (org_id, sender_id, recipient_id, task_id) values
  ('16390000-0000-0000-0000-00000000000a', '16390000-0000-0000-0000-0000000000a1', '16390000-0000-0000-0000-0000000000a2',
   '16390000-0000-0000-0000-0000000000d1') $$, '42501', null, 'AC-RMD-009 no client inserts a ledger row');
select throws_ok($$ update task_reminders set created_at = now() - interval '2 days' $$, '42501', null,
  'AC-RMD-009 no client rewrites a ledger row');
select throws_ok($$ delete from task_reminders $$, '42501', null, 'AC-RMD-009 no client deletes a ledger row');
reset role;
select ok(not has_function_privilege('anon', p, 'EXECUTE'), 'AC-RMD-010 anon cannot execute ' || p)
  from unnest(array['public.send_task_reminders(uuid[])', 'public.preview_task_reminders(uuid[])']) p;
select ok(has_function_privilege('authenticated', p, 'EXECUTE'), 'AC-RMD-010 authenticated may execute ' || p)
  from unnest(array['public.send_task_reminders(uuid[])', 'public.preview_task_reminders(uuid[])']) p;
select ok(not has_function_privilege('authenticated', p, 'EXECUTE'), 'AC-RMD-010 authenticated cannot execute internal ' || p)
  from unnest(array['public.task_reminder_check(uuid, uuid, uuid)', 'public.task_reminder_daily_cap()']) p;

set local role authenticated;
select pg_temp.act_as('16390000-0000-0000-0000-0000000000a1');
select is(pg_temp.outcomes(preview_task_reminders(array['16390000-0000-0000-0000-000000000d11'::uuid, '16390000-0000-0000-0000-0000000000d2'::uuid])),
  array['self', 'eligible'], 'AC-RMD-012 preview reports the same outcomes as send');
select is((select i->>'recipient_name'
             from jsonb_array_elements(preview_task_reminders(array['16390000-0000-0000-0000-000000000d11'::uuid])->'items') i),
  'Site engineer', 'AC-RMD-012 preview names the eligible recipient');
select is((preview_task_reminders(array['16390000-0000-0000-0000-000000000d11'::uuid])->>'remaining')::int, 19,
  'AC-RMD-012 preview reports the remaining allowance');
select is((select count(*)::int from task_reminders where task_id = '16390000-0000-0000-0000-000000000d11'), 0,
  'AC-RMD-012 preview writes no ledger row');
reset role;
select is(pg_temp.reminders_for('16390000-0000-0000-0000-0000000000a2'), 2,
  'AC-RMD-012 preview writes no notification (only the two real sends exist)');

select * from finish();
rollback;
