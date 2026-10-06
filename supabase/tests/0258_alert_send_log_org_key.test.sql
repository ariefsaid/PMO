-- AC-629-002: alert_send_log has an independent write-ahead/cooldown key per organization scope.
begin;
select plan(20);

insert into public.organizations (id, name) values
  ('62900000-0000-0000-0000-000000000001', 'AC-629 Org A'),
  ('62900000-0000-0000-0000-000000000002', 'AC-629 Org B');
insert into auth.users (id, email) values
  ('62900000-0000-0000-0000-0000000000a1', 'ac629-lockdown@example.com');
insert into public.profiles (id, org_id, full_name, email, role) values
  ('62900000-0000-0000-0000-0000000000a1', '62900000-0000-0000-0000-000000000001',
   'AC-629 Lockdown', 'ac629-lockdown@example.com', 'Admin');

select has_column('public', 'alert_send_log', 'id',
  'AC-629-002 alert_send_log has a surrogate id');
select has_column('public', 'alert_send_log', 'org_id',
  'AC-629-002 alert_send_log has an organization scope');
select is((select a.attnotnull from pg_attribute a
            where a.attrelid = 'public.alert_send_log'::regclass and a.attname = 'org_id' and a.attnum > 0),
          false, 'AC-629-002 org_id is nullable for the global scope');
select is((select a.attname::text
             from pg_index i
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
            where i.indrelid = 'public.alert_send_log'::regclass and i.indisprimary
            limit 1),
          'id', 'AC-629-002 id is the primary key');
select is((select i.indnatts::int from pg_index i
            where i.indrelid = 'public.alert_send_log'::regclass and i.indisprimary),
          1, 'AC-629-002 primary key is exactly the id column');
select ok(exists (
  select 1 from pg_constraint c
   where c.conrelid = 'public.alert_send_log'::regclass
     and c.contype = 'f'
     and c.conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.alert_send_log'::regclass and attname = 'org_id')]::smallint[]
     and c.confrelid = 'public.organizations'::regclass
), 'AC-629-002 org_id references organizations');

select lives_ok($$ insert into public.alert_send_log (org_id, error_code, last_sent_at)
                  values ('62900000-0000-0000-0000-000000000001', 'AC629_SHARED', now()) $$,
  'AC-629-002 same error code is accepted for organization A');
select lives_ok($$ insert into public.alert_send_log (org_id, error_code, last_sent_at)
                  values ('62900000-0000-0000-0000-000000000002', 'AC629_SHARED', now()) $$,
  'AC-629-002 same error code is accepted for organization B');
select throws_ok($$ insert into public.alert_send_log (org_id, error_code, last_sent_at)
                  values ('62900000-0000-0000-0000-000000000001', 'AC629_SHARED', now()) $$,
  '23505', null, 'AC-629-002 duplicate organization/code pair is rejected');
select lives_ok($$ insert into public.alert_send_log (org_id, error_code, last_sent_at)
                  values (null, 'AC629_GLOBAL', now()) $$,
  'AC-629-002 one global-scope record is accepted');
select throws_ok($$ insert into public.alert_send_log (org_id, error_code, last_sent_at)
                  values (null, 'AC629_GLOBAL', now()) $$,
  '23505', null, 'AC-629-002 duplicate global-scope/code pair is rejected');

select is((select relrowsecurity from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-629-002 alert_send_log RLS remains enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-629-002 alert_send_log RLS remains forced');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename = 'alert_send_log'),
          0, 'AC-629-002 alert_send_log remains policy-free');
select ok(has_table_privilege('service_role', 'public.alert_send_log', 'SELECT'),
  'AC-629-002 service_role retains SELECT');
select ok(has_table_privilege('service_role', 'public.alert_send_log', 'INSERT'),
  'AC-629-002 service_role retains INSERT');
select ok(has_table_privilege('service_role', 'public.alert_send_log', 'UPDATE'),
  'AC-629-002 service_role retains UPDATE');
select has_index('public', 'alert_send_log', 'alert_send_log_error_code_idx',
  'AC-629-002 batch error-code lookup index exists');

set local role authenticated;
set local request.jwt.claims = '{"sub":"62900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select * from public.alert_send_log $$, '42501', null,
  'AC-629-002 authenticated SELECT remains denied');
select throws_ok($$ insert into public.alert_send_log (org_id, error_code, last_sent_at)
                    values (null, 'AC629_AUTH', now()) $$, '42501', null,
  'AC-629-002 authenticated INSERT remains denied');

reset role;
select * from finish();
rollback;
