-- AC-005/006 support: atomic per-org source lock, expiry reclaim, holder-specific release.
begin;
select plan(8);

insert into public.organizations(id, name) values
  ('a2940000-0000-0000-0000-000000000001', 'Synthetic Lock Org');

select ok(
  not has_function_privilege('anon', 'public.claim_erp_sweep_lock(uuid,uuid,interval)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_erp_sweep_lock(uuid,uuid,interval)', 'EXECUTE'),
  'claim is not executable by anon or authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.release_erp_sweep_lock(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_erp_sweep_lock(uuid,uuid)', 'EXECUTE'),
  'release is not executable by anon or authenticated'
);
select ok(has_function_privilege('service_role', 'public.claim_erp_sweep_lock(uuid,uuid,interval)', 'EXECUTE'), 'service role can claim');
select ok(has_function_privilege('service_role', 'public.release_erp_sweep_lock(uuid,uuid)', 'EXECUTE'), 'service role can release');

set local role service_role;
select is(public.claim_erp_sweep_lock('a2940000-0000-0000-0000-000000000001', 'b2940000-0000-0000-0000-000000000001', interval '15 minutes'), true, 'first claim succeeds');
select is(public.claim_erp_sweep_lock('a2940000-0000-0000-0000-000000000001', 'c2940000-0000-0000-0000-000000000001', interval '15 minutes'), false, 'second claim within TTL is rejected');
reset role;
update public.erp_sweep_lock set locked_until = now() - interval '1 second' where org_id = 'a2940000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.claim_erp_sweep_lock('a2940000-0000-0000-0000-000000000001', 'c2940000-0000-0000-0000-000000000001', interval '15 minutes'), true, 'expired lock is reclaimed');
select is(public.release_erp_sweep_lock('a2940000-0000-0000-0000-000000000001', 'b2940000-0000-0000-0000-000000000001'), false, 'wrong-holder release is a no-op');
reset role;

select * from finish();
rollback;
