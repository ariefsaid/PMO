-- 0565_log_table_retention_purges.test.sql (#1755)
-- AC-RET-001: each purge job is scheduled and its stored command deletes old rows, keeps recent ones.
-- Runs the command text stored in cron.job, so the shipped SQL is what is tested.
begin;
select plan(9);

insert into public.clickup_webhook_inbox (event, task_id, status, processed_at) values
  ('taskUpdated','RET_OLD_DONE','done', now() - interval '31 days'),
  ('taskUpdated','RET_NEW_DONE','done', now() - interval '29 days'),
  ('taskUpdated','RET_OLD_FAILED','failed', now() - interval '60 days'),
  ('taskUpdated','RET_PENDING','pending', null);

insert into public.alert_send_log (error_code, last_sent_at) values
  ('RET_OLD', now() - interval '91 days'),
  ('RET_NEW', now() - interval '89 days');

insert into public.notifications (owner_id, title, read_at) values
  ((select id from public.profiles limit 1), 'RET_OLD_READ',   now() - interval '181 days'),
  ((select id from public.profiles limit 1), 'RET_NEW_READ',   now() - interval '179 days'),
  ((select id from public.profiles limit 1), 'RET_OLD_UNREAD', null);

create function pg_temp.run_job(p text) returns void language plpgsql as $$
declare c text;
begin
  select command into strict c from cron.job where jobname = p and active;
  execute c;
end $$;

select pg_temp.run_job('clickup-webhook-inbox-purge');
select is((select array_agg(task_id order by task_id) from public.clickup_webhook_inbox where task_id like 'RET_%'),
  array['RET_NEW_DONE','RET_OLD_FAILED','RET_PENDING'],
  'AC-RET-001 inbox: done rows older than 30 days gone; recent done, failed and pending kept');

select pg_temp.run_job('alert-send-log-purge');
select is((select array_agg(error_code) from public.alert_send_log where error_code like 'RET_%'),
  array['RET_NEW'], 'AC-RET-001 alert_send_log: row older than 90 days gone, recent kept');

select pg_temp.run_job('notifications-purge');
select is((select array_agg(title order by title) from public.notifications where title like 'RET_%'),
  array['RET_NEW_READ','RET_OLD_UNREAD'],
  'AC-RET-001 notifications: read >180 days gone; recent read and old unread kept');

select is((select count(*)::int from cron.job where jobname in
  ('clickup-webhook-inbox-purge','alert-send-log-purge','notifications-purge') and active), 3,
  'AC-RET-001 all three purge jobs are scheduled and active');

select is((select schedule from cron.job where jobname = 'notifications-purge'), '33 3 * * *', 'AC-RET-001 notifications-purge daily 03:33');
select is((select schedule from cron.job where jobname = 'alert-send-log-purge'), '31 3 * * *', 'AC-RET-001 alert-send-log-purge daily 03:31');
select is((select schedule from cron.job where jobname = 'clickup-webhook-inbox-purge'), '29 3 * * *', 'AC-RET-001 inbox purge daily 03:29');
select ok((select command from cron.job where jobname = 'clickup-webhook-inbox-purge') like '%30 days%', 'AC-RET-001 inbox keep period is 30 days');
select ok((select command from cron.job where jobname = 'alert-send-log-purge') like '%90 days%', 'AC-RET-001 alert log keep period is 90 days');

select * from finish();
rollback;
