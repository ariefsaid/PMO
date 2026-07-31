-- 0185_revoke_anon_authenticated_definer_writers.sql — close the hosted-Supabase function ACL gap.
--
-- HOSTED-ONLY EXPOSURE: hosted Supabase has historically created public-schema functions with
-- explicit EXECUTE grants to anon and authenticated in pg_proc.proacl. Local Docker does not reproduce
-- that platform default, so this migration is expected to be nearly a NO-OP locally. That is correct;
-- do not delete it as dead code. The production proof must be run against the hosted project.
--
-- This is catalog-driven rather than an eighteen-function snapshot. It finds every SECURITY DEFINER
-- public function whose definition contains a write, whose ACL explicitly grants EXECUTE to anon or
-- authenticated, and whose name is not one of the client-callable RPCs below. Every matching overload
-- is revoked from both client roles. The allow-list is deliberately conservative: leaving a questionable
-- grant in place is safer than revoking a live PostgREST RPC and causing an outage.
--
-- ALLOW-LIST DERIVATION (2026-08-01): searched pmo-portal/src and pmo-portal/pages for literal
-- `.rpc('name'` / `.rpc("name"` calls, excluding tests, __tests__, and __mocks__, then sorted and
-- de-duplicated the names. That produced 42 names in this checkout (the issue brief says 41; the
-- additional live call is transition_procurement in src/lib/db/procurementLifecycle.ts). Six more
-- RPCs are explicitly retained because their existing migrations grant them to authenticated and the
-- shipped pgTAP contracts invoke them through the authenticated PostgREST surface: reserve_credits,
-- claim_sales_invoice_author, confirm_erp_employee_link, operator_set_domain_ownership,
-- admin_change_domain_ownership, create_vault_secret_for_org, and release_credits. Dynamic
-- service-client seams were
-- not treated as client-callable RPCs. The list below is intentionally by proname, so an overload of
-- a known client RPC is preserved rather than riskily revoked. The eighteen functions named in the
-- incident report are not in either retained set.
--
-- DEFAULT-PRIVILEGES GUARD: implemented. The hosted default is the root cause, and the application
-- already grants authenticated EXECUTE explicitly for each client RPC. From this migration onward a
-- newly-created public function will not silently become a client endpoint. The companion pgTAP proof
-- asserts both that the default is revoked and that every allow-listed RPC remains callable by
-- authenticated; a forgotten future explicit grant therefore fails the suite as permission denied.
--
-- REVERSIBILITY (ADR-0006) — this is an operation on the CURRENT file, not `supabase db reset` and not
-- a list of migration numbers (v0.9.0 is already in production). To reverse this migration manually,
-- first restore the prior default and then restore only the grants that a production audit confirms were
-- present before 0185:
--
--   alter default privileges for role postgres in schema public
--     grant execute on functions to anon, authenticated;
--   -- For each function that this file revoked, using its CURRENT identity arguments:
--   grant execute on function public.<current_function_name>(<current_identity_arguments>)
--     to anon, authenticated;
--
-- Do not blindly re-grant every function or use a historical migration number: later migrations may
-- have changed a function's signature or its intended caller surface.

-- The hosted platform's implicit function surface must not recur for future postgres-owned functions.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

do $$
declare
  r record;
  client_callable constant text[] := array[
    -- 42 literal frontend RPC names (plus the six existing authenticated RPC contracts documented above).
    'activate_budget_version',
    'admin_set_user_status',
    'approved_timesheet_for_push',
    'attest_timesheet_no_erp_document',
    'capture_vendor_invoice',
    'claim_sales_invoice_author',
    'clone_budget_version',
    'confirm_erp_employee_link',
    'create_payment',
    'create_procurement_invoice',
    'create_procurement_quotation',
    'create_procurement_receipt',
    'create_purchase_order',
    'create_purchase_request',
    'create_rfq',
    'create_vault_secret_for_org',
    'get_budget_projection',
    'get_budget_push_status',
    'get_executive_dashboard',
    'get_finance_budget_review',
    'get_project_budget',
    'get_project_milestones',
    'get_projects_delivery',
    'get_projects_milestone_dates',
    'get_sales_pipeline',
    'get_win_rate',
    'is_operator',
    'admin_change_domain_ownership',
    'list_budget_fiscal_years',
    'operator_agent_run_stats',
    'operator_grant_credits',
    'operator_set_domain_ownership',
    'operator_list_orgs',
    'operator_toggle_feature',
    'operator_usage_summary',
    'org_agent_run_stats',
    'org_credit_balance',
    'org_usage_summary',
    'release_credits',
    'release_outbox_hold',
    'reserve_credits',
    'save_timesheet_week',
    'select_procurement_quote',
    'set_project_contract_value',
    'submit_sales_invoice',
    'transition_document_status',
    'transition_procurement',
    'transition_project',
    'transition_timesheet'
  ];
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       -- Prefer the direct ACL in pg_proc. The acldefault fallback only applies to the unusual
       -- proacl IS NULL case, and preserves visibility of a role grant supplied by default ACLs.
       and exists (
         select 1
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           left join pg_roles grantee on grantee.oid = a.grantee
          where (a.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))
            and a.privilege_type = 'EXECUTE'
       )
       and pg_get_functiondef(p.oid) ~* '(insert\s+into|update\s+(public\.)?[a-z_]|delete\s+from|merge\s+into)'
       and p.proname <> all (client_callable)
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.oid::regprocedure);
  end loop;
end
$$;
