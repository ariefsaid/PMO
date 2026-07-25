begin;
select plan(3);

select has_column('public', 'clickup_webhook_inbox', 'raw_body_sha256',
  'replay guard stores the SHA-256 digest of the raw body');

set local role service_role;
insert into public.clickup_webhook_inbox (id, event, task_id, raw_body_sha256)
values ('01380000-0000-0000-0000-000000000001', 'taskUpdated', 'replay-task', repeat('a', 64));

select throws_ok(
  $$ insert into public.clickup_webhook_inbox (event, task_id, raw_body_sha256)
     values ('taskUpdated', 'replay-task-again', repeat('a', 64)) $$,
  '23505', null,
  'the same verified raw body cannot be enqueued twice');

select ok(
  (select i.indisunique from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   join pg_index i on i.indexrelid = c.oid
   where n.nspname = 'public'
     and c.relname = 'clickup_webhook_inbox_raw_body_sha256_uidx'),
  'replay digest index is unique');

select * from finish();
rollback;
