-- 1220_email_notifications.test.sql — #2711. AC-EML-001..007, 013, 015.
begin;
create extension if not exists pgtap;
select plan(36);

insert into organizations (id, name) values
  ('27110000-0000-0000-0000-00000000000a', 'EML Org A'),
  ('27110000-0000-0000-0000-00000000000b', 'EML Org B');
insert into auth.users (id, email) values
  ('27110000-0000-0000-0000-0000000000a1', 'eml-admin@example.com'),
  ('27110000-0000-0000-0000-0000000000a2', 'eml-pm@example.com'),
  ('27110000-0000-0000-0000-0000000000a3', 'eml-eng@example.com'),
  ('27110000-0000-0000-0000-0000000000a4', 'eml-fin@example.com'),
  ('27110000-0000-0000-0000-0000000000a5', 'eml-off@example.com'),
  ('27110000-0000-0000-0000-0000000000b1', 'eml-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27110000-0000-0000-0000-0000000000a1', '27110000-0000-0000-0000-00000000000a', 'Admin', 'eml-admin@example.com', 'Admin', 'active'),
  ('27110000-0000-0000-0000-0000000000a2', '27110000-0000-0000-0000-00000000000a', 'PM', 'eml-pm@example.com', 'Project Manager', 'active'),
  ('27110000-0000-0000-0000-0000000000a3', '27110000-0000-0000-0000-00000000000a', 'Engineer', 'eml-eng@example.com', 'Engineer', 'active'),
  ('27110000-0000-0000-0000-0000000000a4', '27110000-0000-0000-0000-00000000000a', 'Finance', 'eml-fin@example.com', 'Finance', 'active'),
  ('27110000-0000-0000-0000-0000000000a5', '27110000-0000-0000-0000-00000000000a', 'Disabled PM', 'eml-off@example.com', 'Project Manager', 'disabled'),
  ('27110000-0000-0000-0000-0000000000b1', '27110000-0000-0000-0000-00000000000b', 'Org B PM', 'eml-b@example.com', 'Project Manager', 'active');

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
create function pg_temp.notify(p_to uuid, p_title text, p_type text default 'task', p_event text default null) returns void language sql as $$
  select public.notify_workflow_user('27110000-0000-0000-0000-00000000000a', p_to, p_title, 'body', 'info', p_type, gen_random_uuid(), 'label', p_event) $$;
create function pg_temp.rows(p_event text default null) returns int language sql as $$
  select count(*)::int from email_outbox where org_id = '27110000-0000-0000-0000-00000000000a' and (p_event is null or event_key = p_event) $$;

-- AC-EML-002 / AC-EML-015: no settings -> in-app notification delivered, no email queued
select pg_temp.notify('27110000-0000-0000-0000-0000000000a3', 'Procurement awaiting your approval', 'procurement_case');
select is((select count(*)::int from notifications where owner_id = '27110000-0000-0000-0000-0000000000a3'), 1, 'AC-EML-015 the in-app notification is delivered as before');
select is(pg_temp.rows(), 0, 'AC-EML-002 with no settings no email is queued');
select is((select metadata->>'email_event' from notifications where owner_id = '27110000-0000-0000-0000-0000000000a3'), 'approval_request',
  'AC-EML-006 an approval hand-off title is classified approval_request');

-- AC-EML-013: settings write is Admin-only, via the RPC
set local role authenticated;
select pg_temp.act_as('27110000-0000-0000-0000-0000000000a2');
select throws_ok($$select set_email_event_setting('approval_request', true, '{}')$$, '42501', 'admin only', 'AC-EML-013 a non-Admin cannot change event settings');
select throws_ok($$select set_email_locale('id')$$, '42501', 'admin only', 'AC-EML-013 a non-Admin cannot change the language');
select throws_ok($$insert into email_event_settings (org_id, event_key, enabled) values ('27110000-0000-0000-0000-00000000000a', 'approval_request', true)$$,
  '42501', null, 'AC-EML-013 a client cannot write the settings table directly');
select is((select count(*)::int from email_event_settings), 0, 'AC-EML-013 a non-Admin reads no settings');
select pg_temp.act_as('27110000-0000-0000-0000-0000000000a1');
select lives_ok($$select set_email_event_setting('approval_request', true, '{}')$$, 'AC-EML-013 an Admin changes event settings');
select throws_ok($$select set_email_event_setting('nonsense', true, '{}')$$, '22023', 'unknown email event', 'an unknown event is refused');
select lives_ok($$select set_email_locale('id')$$, 'an Admin sets the email language');
select is((select count(*)::int from email_event_settings), 1, 'AC-EML-013 an Admin reads their org settings');
select throws_ok($$select * from email_outbox$$, '42501', null, 'AC-EML-013 no client role can read the outbox');
reset role;
select is((select locale from email_org_settings where org_id = '27110000-0000-0000-0000-00000000000a'), 'id', 'the language is stored');

-- AC-EML-001: ON -> one row for the addressee; unique per notification+recipient
select pg_temp.notify('27110000-0000-0000-0000-0000000000a3', 'Timesheet awaiting your approval');
select is(pg_temp.rows('approval_request'), 1, 'AC-EML-001 an enabled event queues one email for the addressee');
select is((select enqueue_notification_email(id) from notifications where title = 'Timesheet awaiting your approval'), 0,
  'AC-EML-001 queuing the same notification again adds nothing');
select is(pg_temp.rows(), 1, 'AC-EML-001 still one row');
-- a different event stays OFF
select pg_temp.notify('27110000-0000-0000-0000-0000000000a3', 'Reminder: a task is overdue');
select is(pg_temp.rows('overdue_item'), 0, 'AC-EML-002 an event that is not switched on queues nothing');

-- AC-EML-003: extra roles, deduplicated, same org only, active only
select set_config('request.jwt.claims', null, true);
update email_event_settings set extra_roles = array['Project Manager','Finance','Engineer']
 where org_id = '27110000-0000-0000-0000-00000000000a' and event_key = 'approval_request';
select pg_temp.notify('27110000-0000-0000-0000-0000000000a3', 'Expense claim awaiting your approval');
select is((select array_agg(recipient_id order by recipient_id) from email_outbox o join notifications n on n.id = o.notification_id
            where n.title = 'Expense claim awaiting your approval'),
  array['27110000-0000-0000-0000-0000000000a2','27110000-0000-0000-0000-0000000000a3','27110000-0000-0000-0000-0000000000a4']::uuid[],
  'AC-EML-003 addressee plus extra-role holders, once each (addressee holds a listed role too), no disabled or other-org member');

-- AC-EML-004: opt-out
set local role authenticated;
select pg_temp.act_as('27110000-0000-0000-0000-0000000000a2');
select lives_ok($$select set_my_email_opt_out(true)$$, 'AC-EML-004 a user opts out');
select is((select count(*)::int from email_user_prefs), 1, 'AC-EML-004 a user reads their own preference');
select pg_temp.act_as('27110000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from email_user_prefs), 0, 'AC-EML-004 a user cannot read another user''s preference');
reset role;
select set_config('request.jwt.claims', null, true);
select pg_temp.notify('27110000-0000-0000-0000-0000000000a3', 'Invoice awaiting your approval');
select is((select array_agg(recipient_id order by recipient_id) from email_outbox o join notifications n on n.id = o.notification_id
            where n.title = 'Invoice awaiting your approval'),
  array['27110000-0000-0000-0000-0000000000a3','27110000-0000-0000-0000-0000000000a4']::uuid[], 'AC-EML-004 the opted-out extra recipient gets no email');
select pg_temp.notify('27110000-0000-0000-0000-0000000000a2', 'Purchase awaiting your approval');
select is((select count(*)::int from email_outbox o join notifications n on n.id = o.notification_id
            where n.title = 'Purchase awaiting your approval' and o.recipient_id = '27110000-0000-0000-0000-0000000000a2'), 0,
  'AC-EML-004 an opted-out addressee gets no email');
select is((select count(*)::int from notifications where title = 'Purchase awaiting your approval' and owner_id = '27110000-0000-0000-0000-0000000000a2'), 1,
  'AC-EML-004 the in-app notification is still delivered');

-- AC-EML-005: a notification for another org's user never queues for them / org B has no settings
select is((select count(*)::int from email_outbox where recipient_id = '27110000-0000-0000-0000-0000000000b1'), 0, 'AC-EML-005 no email for another org''s member');
select is((select count(*)::int from email_outbox where recipient_id = '27110000-0000-0000-0000-0000000000a5'), 0, 'AC-EML-005 no email for a disabled member');

-- AC-EML-006: a client cannot mark an event itself
set local role authenticated;
select pg_temp.act_as('27110000-0000-0000-0000-0000000000a3');
insert into notifications (owner_id, title, metadata) values ('27110000-0000-0000-0000-0000000000a3', 'forged', '{"email_event":"approval_request"}');
reset role;
select set_config('request.jwt.claims', null, true);
select is((select count(*)::int from email_outbox o join notifications n on n.id = o.notification_id where n.title = 'forged'), 0,
  'AC-EML-006 a client-written event mark queues no email');
-- the explicit hook (billing steps pass it) and the classifier for expiry
insert into email_event_settings (org_id, event_key, enabled) values
  ('27110000-0000-0000-0000-00000000000a', 'billing_step', true),
  ('27110000-0000-0000-0000-00000000000a', 'document_expiry', true);
select public.notify_workflow_user('27110000-0000-0000-0000-00000000000a', '27110000-0000-0000-0000-0000000000a3', 'Next billing step', 'b', 'info', 'claim', gen_random_uuid(), 'l', 'billing_step');
select is(pg_temp.rows('billing_step'), 1, 'AC-EML-006 the generic hook: a producer passing billing_step is queued');
select pg_temp.notify('27110000-0000-0000-0000-0000000000a3', 'Work permit expires in 7 days', 'expiry_document');
select is(pg_temp.rows('document_expiry'), 1, 'AC-EML-006 the expiry run notification is queued as document_expiry');

insert into email_event_settings (org_id, event_key, enabled) values ('27110000-0000-0000-0000-00000000000a', 'overdue_item', false);
select pg_temp.notify('27110000-0000-0000-0000-0000000000a3', 'Reminder: a task is overdue');
select is(pg_temp.rows('overdue_item'), 0, 'AC-EML-002 an event switched off explicitly queues nothing');

-- AC-EML-007: claim is single-holder; a claimed row is not claimed again; completion
select is((select count(*)::int from claim_email_outbox(2, interval '5 minutes')), 2, 'AC-EML-007 a claim takes at most the limit');
select is((select count(*)::int from email_outbox where status = 'sending' and attempts = 1), 2, 'AC-EML-007 claimed rows are leased with one attempt');
select is((select count(*)::int from email_outbox where attempts > 1), 0, 'AC-EML-007 a leased row is not claimed twice');
select complete_email_outbox((select id from email_outbox where status = 'sending' limit 1), true);
select is((select count(*)::int from email_outbox where status = 'sent' and sent_at is not null), 1, 'AC-EML-007 a sent row is marked sent');
select is((select count(*)::int from claim_email_outbox(100, interval '5 minutes') c where c.id = (select id from email_outbox where status = 'sent' limit 1)), 0, 'AC-EML-007 a sent row is never claimed again');
update email_outbox set attempts = 5 where status = 'sending';
select complete_email_outbox((select id from email_outbox where status = 'sending' limit 1), false, 'boom');
select is((select count(*)::int from email_outbox where status = 'failed'), 1, 'AC-EML-007 a failure on the last attempt is final');

select * from finish();
rollback;
