-- imprest_acl.test.sql — #1515 site imprest: the ACL shape of every imprest function (AC-IMP-060; plan S1.11). Client
-- RPCs: authenticated only, never anon. Internals: neither.
begin; create extension if not exists pgtap; select plan(37);
select ok(not has_function_privilege('anon', p, 'EXECUTE'), 'AC-IMP-060 anon cannot execute ' || p)
  from unnest(array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
                    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
                    'public.transition_imprest_plan(uuid, text, text)', 'public.request_imprest_replenishment(uuid, text)',
                    'public.transition_imprest_replenishment(uuid, text, text, text)', 'public.record_imprest_count(uuid, numeric, text)',
                    'public.get_imprest_position(uuid)', 'public.get_imprest_plan_usage(uuid, date)',
                    'public.imprest_float_choices(uuid, public.budget_category)']) p;
select ok(has_function_privilege('authenticated', p, 'EXECUTE'), 'AC-IMP-060 authenticated may execute ' || p)
  from unnest(array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
                    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
                    'public.transition_imprest_plan(uuid, text, text)', 'public.request_imprest_replenishment(uuid, text)',
                    'public.transition_imprest_replenishment(uuid, text, text, text)', 'public.record_imprest_count(uuid, numeric, text)',
                    'public.get_imprest_position(uuid)', 'public.get_imprest_plan_usage(uuid, date)',
                    'public.imprest_float_choices(uuid, public.budget_category)']) p;
select ok(not has_function_privilege('anon', p, 'EXECUTE') and not has_function_privilege('authenticated', p, 'EXECUTE'),
          'AC-IMP-060 no client executes the internal ' || p)
  from unnest(array['public.imprest_custodian_eligible(uuid, uuid, uuid)', 'public.imprest_senior_route(uuid, uuid)',
                    'public.imprest_lock_float(uuid)', 'public.check_expense_claim_float()',
                    'public.refuse_imprest_count_change()', 'public.notify_imprest_plan_transition()',
                    'public.notify_imprest_replenishment()', 'public.notify_expense_claim_transition()',
                    'public.imprest_exception_recipients(uuid, uuid, date, uuid)',
                    'public.imprest_posting_for_push(uuid, uuid)', 'public.org_employs_imprest_postings(uuid)',
                    'public.enqueue_imprest_replenishment_posting()']) p;
-- 0425 (S6): the posting gate and the sweep's helpers belong to service_role alone.
select ok(has_function_privilege('service_role', 'public.imprest_posting_for_push(uuid, uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.org_employs_imprest_postings(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.imprest_custodian_eligible(uuid, uuid, uuid)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public.enqueue_imprest_replenishment_posting()', 'EXECUTE'),
          'AC-IMP-060 the sweep (service_role) may run the posting gate and the eligibility check; nobody runs the trigger function');
select ok(has_table_privilege('authenticated', 'public.imprest_posting_erp_mirror', 'SELECT')
          and not has_table_privilege('authenticated', 'public.imprest_posting_erp_mirror', 'INSERT')
          and not has_table_privilege('authenticated', 'public.imprest_posting_erp_mirror', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.imprest_posting_erp_mirror', 'DELETE')
          and not has_table_privilege('anon', 'public.imprest_posting_erp_mirror', 'SELECT'),
          'AC-IMP-060 the replenishment posting mirror is read-only for members and invisible to anon');
select ok(not has_column_privilege('authenticated', 'public.imprest_floats', 'erp_cash_account_ref', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.imprest_floats', 'erp_cash_account_ref', 'INSERT')
          and has_column_privilege('service_role', 'public.imprest_floats', 'erp_cash_account_ref', 'UPDATE'),
          'AC-IMP-060 only the validating edge function (service_role) can set a float''s ERP cash account');
select * from finish(); rollback;
