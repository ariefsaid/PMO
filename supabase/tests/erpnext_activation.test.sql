-- erpnext_activation.test.sql — #650 / ADR-0073.
-- AC-EAC-103, AC-EAC-109, AC-EAC-110, AC-EAC-111, AC-EAC-112, AC-EAC-113, AC-EAC-114
begin;
select plan(31);

reset role;
insert into organizations (id, name) values
  ('e6500000-0000-0000-0000-000000000001', 'Act Org A');
insert into auth.users (id, email) values
  ('e65a0000-0000-0000-0000-00000000000a', 'act-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('e65a0000-0000-0000-0000-00000000000a', 'e6500000-0000-0000-0000-000000000001',
   'Act Admin', 'act-admin@example.com', 'Admin', 'active');

-- A connected-but-not-activated erpnext binding, exactly as external-connect leaves it today.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status)
values ('e6500000-0000-0000-0000-000000000001', 'erpnext', '', 'act-secret-ref', 'active');

-- AC-EAC-113 the ONLY client privilege on the binding table is SELECT. A future migration that
-- re-grants a write fails here — this, not a policy, is the live layer (ADR-0073 §6).
-- (Runs as the superuser session role so `information_schema.role_table_grants` is NOT filtered to
-- the caller's own grants — under `service_role` the anon/authenticated rows are invisible.)
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'external_org_bindings'
      and grantee in ('anon', 'authenticated')),
  'SELECT',
  'AC-EAC-113 authenticated/anon hold SELECT only on external_org_bindings'
);

-- AC-EAC-113 (review #650) the COLUMN-level superset: table-level grants expand into
-- information_schema.column_privileges per column, and a COLUMN-scoped grant (e.g.
-- `grant update(config) on external_org_bindings to authenticated`) appears ONLY there —
-- invisible to role_table_grants. The distinct privilege-type set must stay exactly {SELECT}.
-- MUTATION (temporary): prove the column-level oracle bites.
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'external_org_bindings'
      and grantee in ('anon', 'authenticated')),
  'SELECT',
  'AC-EAC-113 no column-level grant beyond SELECT on external_org_bindings (a future grant update(config) turns this red)'
);

-- The three RPCs are service-role-only (NFR-EAC-SEC-102); run the positive cases as service_role,
-- the 0210/0147 idiom used by external_config_atomic_merge.test.sql. The AC-EAC-112 denial below
-- switches to authenticated.
set local role service_role;

-- AC-EAC-112 service-role-only EXECUTE on the three activation RPCs.
select ok(
  to_regprocedure('public.set_external_binding_site_url(uuid,text,text,uuid)') is not null,
  'AC-EAC-112 set_external_binding_site_url exists');
select ok(
  to_regprocedure('public.activate_external_binding(uuid,text,int,text,jsonb,uuid)') is not null,
  'AC-EAC-112 activate_external_binding exists');
select ok(
  to_regprocedure('public.deactivate_external_binding(uuid,text,uuid)') is not null,
  'AC-EAC-112 deactivate_external_binding exists');
select ok(
  not has_function_privilege('anon', 'public.activate_external_binding(uuid,text,int,text,jsonb,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.activate_external_binding(uuid,text,int,text,jsonb,uuid)', 'EXECUTE'),
  'AC-EAC-112 activate_external_binding is not client-executable');
select ok(
  has_function_privilege('service_role', 'public.activate_external_binding(uuid,text,int,text,jsonb,uuid)', 'EXECUTE'),
  'AC-EAC-112 activate_external_binding is service_role-executable');

-- AC-EAC-110 an unusable binding is refused; nothing partial is written.
select throws_ok(
  $$ select public.activate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext',15,'ACME','{}'::jsonb,
       'e65a0000-0000-0000-0000-00000000000a') $$,
  'P0001', null,
  'AC-EAC-110 activation refuses a binding with an empty site_url');
select is(
  (select activated_at from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  null::timestamptz,
  'AC-EAC-110 the refused activation wrote no stamp');
select is(
  (select config ? 'company' from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  false,
  'AC-EAC-110 the refused activation wrote no company');

-- Give the binding a site_url the honest way, then re-test the version gate.
select is(
  public.set_external_binding_site_url(
    'e6500000-0000-0000-0000-000000000001','erpnext','https://erp.example.com',
    'e65a0000-0000-0000-0000-00000000000a'),
  'set',
  'AC-EAC-103 the first site_url write reports "set"');

-- AC-EAC-111 the DATABASE rejects an unsupported major, independently of the edge function.
select throws_ok(
  $$ select public.activate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext',14,'ACME','{}'::jsonb,
       'e65a0000-0000-0000-0000-00000000000a') $$,
  'P0001', null,
  'AC-EAC-111 activation refuses ERPNext major 14');
select is(
  (select version_major from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  null::int,
  'AC-EAC-111 the refused major wrote no version');

-- AC-EAC-109 activated_at is SET-ONCE for the lifetime of a connection.
-- First activation (from an unstamped binding) returns a stamp.
select isnt(
  public.activate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext',15,'Company A',
    '{"default_payable_account":"Creditors - A"}'::jsonb,
    'e65a0000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'AC-EAC-109 first activation returns a stamp');

-- Anchor a KNOWN prior stamp (the seed.sql / e2e / RIS-operator-SQL shape) that differs from the
-- transaction timestamp. `now()` is constant within a single Postgres transaction, so a re-activation
-- in the SAME test transaction cannot be told apart by time alone; the set-once rule must return this
-- exact anchor on a re-select, never the current transaction's `now()`. (Oracle hardened against the
-- `activated_at = now()` mutation per plan Task 1.13 #2.)
update external_org_bindings
   set activated_at = '2020-01-01T00:00:00+00:00'::timestamptz
 where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext';

select is(
  public.activate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext',16,'Company B','{}'::jsonb,
    'e65a0000-0000-0000-0000-00000000000a'),
  '2020-01-01T00:00:00+00:00'::timestamptz,
  'AC-EAC-109 re-selecting a Company preserves the ORIGINAL activated_at');
select is(
  (select config->>'company' from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'Company B',
  'AC-EAC-109 re-selection does update the company');
select is(
  (select config->>'default_payable_account' from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'Creditors - A',
  'AC-EAC-109 the config merge does not clobber sibling keys');
select is(
  (select version_major from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  16,
  'AC-EAC-109 re-selection updates version_major');

-- AC-EAC-103 a repoint un-activates.
select is(
  public.set_external_binding_site_url(
    'e6500000-0000-0000-0000-000000000001','erpnext','https://erp-new.example.com',
    'e65a0000-0000-0000-0000-00000000000a'),
  'repointed',
  'AC-EAC-103 changing the site_url reports "repointed"');
select ok(
  (select activated_at is null and version_major is null and not (config ? 'company')
     from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'AC-EAC-103 a repoint clears activated_at, version_major and config.company');
select throws_ok(
  $$ select public.set_external_binding_site_url(
       'e6500000-0000-0000-0000-000000000001','erpnext','http://erp.example.com',
       'e65a0000-0000-0000-0000-00000000000a') $$,
  '22023', null,
  'AC-EAC-103 a non-https site_url is refused by the database too');

-- AC-EAC-114 deactivation flips org_has_active_erpnext_binding (mig 0160) to false.
select is(
  public.set_external_binding_site_url(
    'e6500000-0000-0000-0000-000000000001','erpnext','https://erp-new.example.com',
    'e65a0000-0000-0000-0000-00000000000a'),
  'set',
  'AC-EAC-114 re-writing the SAME site_url is not a repoint');
select isnt(
  public.activate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext',16,'Company B','{}'::jsonb,
    'e65a0000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'AC-EAC-114 re-activated after the repoint');
select ok(
  public.org_has_active_erpnext_binding('e6500000-0000-0000-0000-000000000001'),
  'AC-EAC-114 the employ predicate is true while activated');
select is(
  public.deactivate_external_binding(
    'e6500000-0000-0000-0000-000000000001','erpnext','e65a0000-0000-0000-0000-00000000000a'),
  1,
  'AC-EAC-114 deactivation touched one row');
select ok(
  not public.org_has_active_erpnext_binding('e6500000-0000-0000-0000-000000000001'),
  'AC-EAC-114 the employ predicate is FALSE immediately after disconnect');
select ok(
  (select status = 'disconnected' and disconnected_at is not null
      and activated_at is null and version_major is null and not (config ? 'company')
     from external_org_bindings
    where org_id='e6500000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'AC-EAC-114 disconnect soft-archives AND clears the stamps in one statement');

-- AC-EAC-112 an authenticated Admin cannot call the activation path directly.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e65a0000-0000-0000-0000-00000000000a","role":"authenticated"}';
select throws_ok(
  $$ select public.deactivate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext','e65a0000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'AC-EAC-112 authenticated is denied deactivate_external_binding');
select throws_ok(
  $$ select public.set_external_binding_site_url(
       'e6500000-0000-0000-0000-000000000001','erpnext','https://erp.example.com',
       'e65a0000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'AC-EAC-112 authenticated is denied set_external_binding_site_url');
select throws_ok(
  $$ select public.activate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext',15,'ACME','{}'::jsonb,
       'e65a0000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'AC-EAC-112 authenticated is denied activate_external_binding');
reset role;

-- AC-EAC-112 the in-function role guard is a REAL second layer, not a dead twin of the EXECUTE grant.
-- The authenticated denial above cannot distinguish the grant layer from the guard (both raise 42501);
-- this session (superuser, current_setting('role') = 'none') BYPASSES the grant entirely, so a 42501
-- here can only come from the guard inside the function body. Mutation-tested (plan Task 1.13 #5):
-- neutering the guard must fail this assertion.
select throws_ok(
  $$ select public.deactivate_external_binding(
       'e6500000-0000-0000-0000-000000000001','erpnext','e65a0000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'AC-EAC-112 the in-function role guard denies a grant-bypassing (non-service_role) session');

select finish();
rollback;