-- 0218: may_approve_work_of is internal-only (callable by the definer RPCs and service_role, not by
-- members) — #612 item 4. The transition RPCs that depend on it must still work (they run as owner).
begin;
select plan(5);

select ok(not has_function_privilege('anon', 'public.may_approve_work_of(uuid, uuid)', 'EXECUTE'),
  'AC-GRANT-0218-1 anon cannot execute may_approve_work_of');
select ok(not has_function_privilege('authenticated', 'public.may_approve_work_of(uuid, uuid)', 'EXECUTE'),
  'AC-GRANT-0218-2 authenticated cannot execute may_approve_work_of');
select ok(has_function_privilege('service_role', 'public.may_approve_work_of(uuid, uuid)', 'EXECUTE'),
  'AC-GRANT-0218-3 service_role can execute may_approve_work_of');

-- A signed-in member asking about two arbitrary ids is refused at the grant, before the body runs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.may_approve_work_of('02180000-0000-0000-0000-0000000000a1','02180000-0000-0000-0000-0000000000a2') $$,
  '42501', null, 'AC-GRANT-0218-4 a member cannot probe may_approve_work_of');
reset role;

-- The callers are still granted to members (the SoD lives inside them, not in the client grant).
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('transition_project','transition_work_order')),
  'AC-GRANT-0218-5 authenticated keeps transition_project / transition_work_order (the callers of the predicate)');

select * from finish();
rollback;
