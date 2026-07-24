-- 0158_platform_operators_grant_lockdown.test.sql
-- AC-SEC-B3 [pgTAP]: platform_operators — the M365/Operator authorization authority — grants no
-- write to client roles at the GRANT layer (migration 0152, audit LOW-B3). Belt to the RLS braces:
-- even a future permissive write policy could not mint an Operator row without also re-granting.
begin;
select plan(3);

-- authenticated / anon are left with EXACTLY SELECT (RLS then scopes SELECT to the own row).
select table_privs_are('public', 'platform_operators', 'authenticated', ARRAY['SELECT'],
  'AC-SEC-B3: authenticated has SELECT only — no INSERT/UPDATE/DELETE (grant-layer lockdown)');
select table_privs_are('public', 'platform_operators', 'anon', ARRAY['SELECT'],
  'AC-SEC-B3: anon has SELECT only');

-- service_role remains the sole writer (spot-check INSERT via the Postgres built-in).
select ok(has_table_privilege('service_role', 'public.platform_operators', 'INSERT'),
  'AC-SEC-B3: service_role remains able to provision operators');

select * from finish();
rollback;
