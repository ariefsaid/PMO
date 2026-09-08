-- 0210: service-only SECURITY DEFINER functions are executable by service_role and NOT by
-- anon/authenticated; client RPCs keep their authenticated grant (no over-revoke).
begin;
select plan(20);

select ok(not has_function_privilege('anon', 'public.read_vault_secret(text)', 'EXECUTE'), 'AC-GRANT-0210-1 anon cannot execute read_vault_secret');
select ok(not has_function_privilege('authenticated', 'public.read_vault_secret(text)', 'EXECUTE'), 'AC-GRANT-0210-2 authenticated cannot execute read_vault_secret');
select ok(has_function_privilege('service_role', 'public.read_vault_secret(text)', 'EXECUTE'), 'AC-GRANT-0210-3 service_role can execute read_vault_secret');

select ok(not has_function_privilege('anon', 'public.create_vault_secret_for_org(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-4 anon cannot execute create_vault_secret_for_org');
select ok(has_function_privilege('authenticated', 'public.create_vault_secret_for_org(uuid, text, text, text, uuid)', 'EXECUTE'), 'AC-GRANT-0210-5 authenticated keeps create_vault_secret_for_org (body-guarded, p_actor_id path)');
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

select * from finish();
rollback;
