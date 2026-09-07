-- 0210 — pin EXECUTE on service-only SECURITY DEFINER functions to service_role / postgres.
--
-- Hosted Supabase grants EXECUTE to anon + authenticated on every function in `public` by
-- default; local Docker does not. 0185 added a default-privilege guard, but it covers only
-- functions created AFTER it. The functions below predate it and are called only by edge
-- functions (service_role) or pg_cron (postgres) — never by the frontend — so their EXECUTE is
-- narrowed here and asserted at the end of this migration, on whatever database applies it.
--
-- Two tiers:
--   §1 service-only: revoke from public, anon, authenticated; grant to service_role.
--   §2 body-guarded RPCs that run as authenticated (frontend post-login, or edge functions
--      forwarding the caller's JWT — the pgTAP suites exercise them as authenticated): revoke
--      from anon only; authenticated grants untouched.
-- Deliberately untouched: RLS-policy helpers (auth_org_id, auth_role, is_active_member,
-- org_feature_enabled) — a policy evaluated for anon must be able to call them.

-- §1 service-only ------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.read_vault_secret(text)',
    'public.outbox_reconcile_candidates(uuid)',
    'public.agent_dispatch_tick()',
    'public.clickup_sweep_tick()',
    'public.clickup_webhook_worker_tick()',
    'public.erpnext_sweep_tick()',
    'public.telegram_notify_tick()'
  ] loop
    if to_regprocedure(fn) is null then
      raise notice '0210: % not present, skipped', fn;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  -- Present on hosted projects only (created outside the migration chain); pin it when it exists.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- §2 anon never calls these ---------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_vault_secret_for_org(uuid, text, text, text, uuid)',
    'public.audit_m365_event(text, uuid, uuid, uuid, jsonb)',
    'public.m365_disconnect_cascade(uuid, uuid, text)',
    'public.audit_agent_denial(text, jsonb)',
    'public.actor_authorization_state(uuid, uuid)',
    'public.get_process_gates(uuid)',
    'public.claim_sales_invoice_author(uuid)',
    'public.reserve_credits(uuid, numeric, uuid)',
    'public.release_credits(uuid)',
    'public.admin_change_domain_ownership(uuid, text, text, text, uuid)',
    'public.admin_set_user_status(uuid, profile_status, uuid)',
    'public.may_approve_work_of(uuid, uuid)',
    'public.operator_agent_run_stats(uuid)',
    'public.operator_grant_credits(uuid, numeric, text)',
    'public.operator_list_orgs()',
    'public.operator_org_exists(uuid)',
    'public.operator_set_domain_ownership(uuid, text, text, text)',
    'public.operator_toggle_feature(uuid, text, boolean)',
    'public.operator_usage_summary(uuid)',
    'public.org_agent_run_stats()',
    'public.org_credit_balance(uuid)',
    'public.org_has_feature(uuid, text)',
    'public.org_has_member_email(uuid, text)',
    'public.org_usage_summary()',
    'public.submit_sales_invoice(uuid)'
  ] loop
    if to_regprocedure(fn) is null then
      raise notice '0210: % not present, skipped', fn;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', fn);
  end loop;
end $$;

-- §3 assert on THIS database — the proof runs where the grants actually live -------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.read_vault_secret(text)',
    'public.outbox_reconcile_candidates(uuid)',
    'public.agent_dispatch_tick()',
    'public.clickup_sweep_tick()',
    'public.clickup_webhook_worker_tick()',
    'public.erpnext_sweep_tick()',
    'public.telegram_notify_tick()'
  ] loop
    if to_regprocedure(fn) is null then continue; end if;
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception '0210: % is still executable by anon/authenticated', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '0210: % lost service_role EXECUTE', fn;
    end if;
  end loop;
  -- no over-revoke: a client RPC keeps its authenticated grant
  if not has_function_privilege('authenticated', 'public.transition_timesheet(uuid, timesheet_status, text)', 'EXECUTE')
     and to_regprocedure('public.transition_timesheet(uuid, timesheet_status, text)') is not null then
    raise exception '0210: transition_timesheet lost authenticated EXECUTE (over-revoke)';
  end if;
end $$;
