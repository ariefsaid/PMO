-- 0490_ops_job_lease.test.sql — expiring single-drainer lease (telegram-notify).
begin;
select plan(9);

select ok(public.claim_ops_job_lease('lease-test', '90000000-0000-0000-0000-000000000001', interval '5 minutes'),
  'AC-T09-004 first claim wins');
select ok(not public.claim_ops_job_lease('lease-test', '90000000-0000-0000-0000-000000000002', interval '5 minutes'),
  'AC-T09-004 a second concurrent claim loses while the lease is live');
select ok(not public.release_ops_job_lease('lease-test', '90000000-0000-0000-0000-000000000002'),
  'AC-T09-004 a non-holder cannot release');
update public.ops_job_heartbeats set lease_until = now() - interval '1 second' where job_name = 'lease-test';
select ok(public.claim_ops_job_lease('lease-test', '90000000-0000-0000-0000-000000000002', interval '5 minutes'),
  'AC-T09-004 an expired lease can be claimed');
select ok(public.release_ops_job_lease('lease-test', '90000000-0000-0000-0000-000000000002'),
  'AC-T09-004 the holder releases');
select ok(public.claim_ops_job_lease('lease-test', '90000000-0000-0000-0000-000000000001', interval '5 minutes'),
  'AC-T09-004 a released lease is claimable again');
select throws_ok($$select public.claim_ops_job_lease('lease-test', gen_random_uuid(), interval '1 day')$$, '22023',
  null, 'AC-T09-004 an oversized ttl is rejected');
select ok(
  not has_function_privilege('anon', 'public.claim_ops_job_lease(text,uuid,interval)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_ops_job_lease(text,uuid,interval)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_ops_job_lease(text,uuid,interval)', 'EXECUTE'),
  'AC-T09-004 claim is service_role only');

select ok(
  not has_function_privilege('anon', 'public.release_ops_job_lease(text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_ops_job_lease(text,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.release_ops_job_lease(text,uuid)', 'EXECUTE'),
  'AC-T09-004 release is service_role only');

select * from finish();
rollback;
