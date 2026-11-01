-- imprest_acl.test.sql — #1515 site imprest: the ACL shape of every imprest function (AC-IMP-060; plan S1.11). Client
-- RPCs: authenticated only, never anon. Internals: neither.
begin; create extension if not exists pgtap; select plan(18);
select ok(not has_function_privilege('anon', p, 'EXECUTE'), 'AC-IMP-060 anon cannot execute ' || p)
  from unnest(array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
                    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
                    'public.transition_imprest_plan(uuid, text, text)', 'public.request_imprest_replenishment(uuid, text)',
                    'public.transition_imprest_replenishment(uuid, text, text, text)']) p;
select ok(has_function_privilege('authenticated', p, 'EXECUTE'), 'AC-IMP-060 authenticated may execute ' || p)
  from unnest(array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
                    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
                    'public.transition_imprest_plan(uuid, text, text)', 'public.request_imprest_replenishment(uuid, text)',
                    'public.transition_imprest_replenishment(uuid, text, text, text)']) p;
select ok(not has_function_privilege('anon', p, 'EXECUTE') and not has_function_privilege('authenticated', p, 'EXECUTE'),
          'AC-IMP-060 no client executes the internal ' || p)
  from unnest(array['public.imprest_custodian_eligible(uuid, uuid, uuid)', 'public.imprest_senior_route(uuid, uuid)',
                    'public.imprest_lock_float(uuid)', 'public.check_expense_claim_float()']) p;
select * from finish(); rollback;
