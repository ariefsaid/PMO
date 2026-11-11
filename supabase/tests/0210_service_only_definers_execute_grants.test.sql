-- 0210: service-only SECURITY DEFINER functions are executable by service_role and NOT by
-- anon/authenticated; client RPCs keep their authenticated grant (no over-revoke).
begin;
select plan(38);

select ok(not has_function_privilege('anon', 'public.read_vault_secret(text)', 'EXECUTE'), 'AC-GRANT-0210-1 anon cannot execute read_vault_secret');
select ok(not has_function_privilege('authenticated', 'public.read_vault_secret(text)', 'EXECUTE'), 'AC-GRANT-0210-2 authenticated cannot execute read_vault_secret');
select ok(has_function_privilege('service_role', 'public.read_vault_secret(text)', 'EXECUTE'), 'AC-GRANT-0210-3 service_role can execute read_vault_secret');

select ok(not has_function_privilege('anon', 'public.create_vault_secret_for_org(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-4 anon cannot execute create_vault_secret_for_org');
select ok(not has_function_privilege('authenticated', 'public.create_vault_secret_for_org(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-5 authenticated cannot execute create_vault_secret_for_org (service-role only since 0450; external-connect calls it with p_actor_id)');
select ok(has_function_privilege('service_role', 'public.create_vault_secret_for_org(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-6 service_role can execute create_vault_secret_for_org');

select ok(not has_function_privilege('anon', 'public.outbox_reconcile_candidates(uuid)', 'EXECUTE'), 'AC-GRANT-0210-7 anon cannot execute outbox_reconcile_candidates');
select ok(not has_function_privilege('authenticated', 'public.outbox_reconcile_candidates(uuid)', 'EXECUTE'), 'AC-GRANT-0210-8 authenticated cannot execute outbox_reconcile_candidates');
select ok(has_function_privilege('service_role', 'public.outbox_reconcile_candidates(uuid)', 'EXECUTE'), 'AC-GRANT-0210-9 service_role can execute outbox_reconcile_candidates');

select ok(not has_function_privilege('anon', 'public.agent_dispatch_tick()', 'EXECUTE'), 'AC-GRANT-0210-10 anon cannot execute agent_dispatch_tick');
select ok(not has_function_privilege('authenticated', 'public.agent_dispatch_tick()', 'EXECUTE'), 'AC-GRANT-0210-11 authenticated cannot execute agent_dispatch_tick');
select ok(not has_function_privilege('authenticated', 'public.clickup_sweep_tick()', 'EXECUTE'), 'AC-GRANT-0210-12 authenticated cannot execute clickup_sweep_tick');
select ok(not has_function_privilege('authenticated', 'public.clickup_webhook_worker_tick()', 'EXECUTE'), 'AC-GRANT-0210-13 authenticated cannot execute clickup_webhook_worker_tick');
select ok(not has_function_privilege('authenticated', 'public.erpnext_sweep_tick()', 'EXECUTE'), 'AC-GRANT-0210-14 authenticated cannot execute erpnext_sweep_tick');
select ok(not has_function_privilege('authenticated', 'public.telegram_notify_tick()', 'EXECUTE'), 'AC-GRANT-0210-15 authenticated cannot execute telegram_notify_tick');

select ok(not has_function_privilege('anon', 'public.operator_grant_credits(uuid, numeric, text)', 'EXECUTE'), 'AC-GRANT-0210-16 anon cannot execute operator_grant_credits');
select ok(has_function_privilege('authenticated', 'public.operator_grant_credits(uuid, numeric, text)', 'EXECUTE'), 'AC-GRANT-0210-17 authenticated keeps operator_grant_credits (client RPC, no over-revoke)');
select ok(has_function_privilege('authenticated', 'public.org_credit_balance(uuid)', 'EXECUTE'), 'AC-GRANT-0210-18 authenticated keeps org_credit_balance (client RPC)');
select ok(has_function_privilege('authenticated', 'public.transition_timesheet(uuid, timesheet_status, text)', 'EXECUTE'), 'AC-GRANT-0210-19 authenticated keeps transition_timesheet (client RPC)');
select ok(has_function_privilege('authenticated', 'public.org_feature_enabled(uuid, text)', 'EXECUTE') or to_regprocedure('public.org_feature_enabled(uuid, text)') is null, 'AC-GRANT-0210-20 RLS helper org_feature_enabled untouched');

-- 0644 dormant nightly surfaces: service-only entry points, owner-only scheduling helper.
select ok(not has_function_privilege('anon', 'public.record_erp_statement_nightly_due(uuid, uuid, uuid, timestamptz)', 'EXECUTE'), 'AC-GRANT-0210-21 anon cannot execute record_erp_statement_nightly_due');
select ok(not has_function_privilege('authenticated', 'public.record_erp_statement_nightly_due(uuid, uuid, uuid, timestamptz)', 'EXECUTE'), 'AC-GRANT-0210-22 authenticated cannot execute record_erp_statement_nightly_due');
select ok(has_function_privilege('service_role', 'public.record_erp_statement_nightly_due(uuid, uuid, uuid, timestamptz)', 'EXECUTE'), 'AC-GRANT-0210-23 service_role can execute record_erp_statement_nightly_due');
select ok(not has_function_privilege('anon', 'public.request_erp_statement_manual_intent(uuid, uuid, uuid, timestamptz)', 'EXECUTE'), 'AC-GRANT-0210-24 anon cannot execute request_erp_statement_manual_intent');
select ok(not has_function_privilege('authenticated', 'public.request_erp_statement_manual_intent(uuid, uuid, uuid, timestamptz)', 'EXECUTE'), 'AC-GRANT-0210-25 authenticated cannot execute request_erp_statement_manual_intent');
select ok(has_function_privilege('service_role', 'public.request_erp_statement_manual_intent(uuid, uuid, uuid, timestamptz)', 'EXECUTE'), 'AC-GRANT-0210-26 service_role can execute request_erp_statement_manual_intent');
select ok(not has_function_privilege('anon', 'public._erp_statement_nightly_due_at(date, text)', 'EXECUTE'), 'AC-GRANT-0210-27 anon cannot execute the nightly scheduling helper');
select ok(not has_function_privilege('authenticated', 'public._erp_statement_nightly_due_at(date, text)', 'EXECUTE'), 'AC-GRANT-0210-28 authenticated cannot execute the nightly scheduling helper');
select ok(not has_function_privilege('service_role', 'public._erp_statement_nightly_due_at(date, text)', 'EXECUTE'), 'AC-GRANT-0210-29 the nightly scheduling helper stays owner-only');

-- 0817 (#1017) per-org Microsoft 365 app custody: service-only definers.
select ok(not has_function_privilege('anon', 'public.m365_set_org_app(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-30 anon cannot execute m365_set_org_app');
select ok(not has_function_privilege('authenticated', 'public.m365_set_org_app(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-31 authenticated cannot execute m365_set_org_app');
select ok(has_function_privilege('service_role', 'public.m365_set_org_app(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-32 service_role can execute m365_set_org_app');
select ok(not has_function_privilege('anon', 'public.m365_org_app_resolve(uuid)', 'EXECUTE'), 'AC-GRANT-0210-33 anon cannot execute m365_org_app_resolve');
select ok(not has_function_privilege('authenticated', 'public.m365_org_app_resolve(uuid)', 'EXECUTE'), 'AC-GRANT-0210-34 authenticated cannot execute m365_org_app_resolve');
select ok(has_function_privilege('service_role', 'public.m365_org_app_resolve(uuid)', 'EXECUTE'), 'AC-GRANT-0210-35 service_role can execute m365_org_app_resolve');
select ok(not has_function_privilege('anon', 'public.m365_clear_org_app(uuid, uuid)', 'EXECUTE'), 'AC-GRANT-0210-36 anon cannot execute m365_clear_org_app');
select ok(not has_function_privilege('authenticated', 'public.m365_clear_org_app(uuid, uuid)', 'EXECUTE'), 'AC-GRANT-0210-37 authenticated cannot execute m365_clear_org_app');
select ok(has_function_privilege('service_role', 'public.m365_clear_org_app(uuid, uuid)', 'EXECUTE'), 'AC-GRANT-0210-38 service_role can execute m365_clear_org_app');

select * from finish();
rollback;
