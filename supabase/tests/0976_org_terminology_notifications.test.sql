-- New notifications retain structured messages while older entries remain unchanged.
begin;
select plan(12);
select has_column('public', 'notifications', 'message_key', 'notifications store a message key');

insert into organizations (id, name) values ('09760000-0000-0000-0000-000000000001', 'Notification terminology test');
insert into auth.users (id, email) values ('09760000-0000-0000-0000-000000000001', 'notification-terms@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('09760000-0000-0000-0000-000000000001', '09760000-0000-0000-0000-000000000001', 'Test admin', 'notification-terms@example.test', 'Admin', 'active');

alter table public.notifications disable trigger notifications_message_template;
insert into notifications (id, org_id, owner_id, title, body) values
 ('09760000-0000-0000-0000-000000000001', '09760000-0000-0000-0000-000000000001', '09760000-0000-0000-0000-000000000001', 'Old notice', 'Project Phoenix');
alter table public.notifications enable trigger notifications_message_template;
select is((select message_key from notifications where id = '09760000-0000-0000-0000-000000000001'), null, 'AC-TERM-008 old notification remains unstructured');

insert into notifications (id, org_id, owner_id, title, body, metadata) values
 ('09760000-0000-0000-0000-000000000002', '09760000-0000-0000-0000-000000000001', '09760000-0000-0000-0000-000000000001', 'Action required', 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.', '{"action_required":"budget-archive-live-erp"}');
select is((select message_key from notifications where id = '09760000-0000-0000-0000-000000000002'), 'budgetArchiveWarning', 'known generated warning gets a template key');
select is((select message_params from notifications where id = '09760000-0000-0000-0000-000000000002'), '{}'::jsonb, 'generated warning stores parameters');

set local role service_role;
insert into notifications (id, org_id, owner_id, title, body, message_key, message_params) values
 ('09760000-0000-0000-0000-000000000004', '09760000-0000-0000-0000-000000000001', '09760000-0000-0000-0000-000000000001', 'Invoice needs a project', 'raw', 'unassignedInvoice', '{"invoice":"Project Phoenix","amount":" (42)"}');
select is((select message_key from notifications where id = '09760000-0000-0000-0000-000000000004'), 'unassignedInvoice', 'trusted producer can select an app template');
select is((select message_params->>'invoice' from notifications where id = '09760000-0000-0000-0000-000000000004'), 'Project Phoenix', 'trusted producer stores user text as an unchanged parameter');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"09760000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into notifications (id, org_id, owner_id, title, body, message_key, message_params) values
 ('09760000-0000-0000-0000-000000000003', '09760000-0000-0000-0000-000000000001', '09760000-0000-0000-0000-000000000001', 'My note', 'Project Phoenix', 'budgetArchiveWarning', '{}');
select is((select message_key from notifications where id = '09760000-0000-0000-0000-000000000003'), 'literal', 'AC-TERM-008 user cannot impersonate generated warning');
select is((select message_params->>'body' from notifications where id = '09760000-0000-0000-0000-000000000003'), 'Project Phoenix', 'user text remains an untouched parameter');
insert into notifications (id, org_id, owner_id, title, body, metadata, message_key, message_params) values
 ('09760000-0000-0000-0000-000000000005', '09760000-0000-0000-0000-000000000001', '09760000-0000-0000-0000-000000000001', 'Action required', 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.', '{"action_required":"budget-archive-live-erp"}', 'budgetArchiveWarning', '{}');
select is((select message_key from notifications where id = '09760000-0000-0000-0000-000000000005'), 'literal', 'AC-TERM-008 user text identical to an app warning remains literal');
select lives_ok($$update notifications set read_at = now() where id = '09760000-0000-0000-0000-000000000003'$$, 'AC-TERM-008 marking a notification read still works');
select throws_ok($$update notifications set message_key = 'budgetArchiveWarning' where id = '09760000-0000-0000-0000-000000000003'$$, '42501', null, 'AC-TERM-008 user cannot alter template key');
select throws_ok($$update notifications set message_params = '{}' where id = '09760000-0000-0000-0000-000000000003'$$, '42501', null, 'AC-TERM-008 user cannot alter template parameters');
select * from finish();
rollback;
