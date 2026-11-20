-- #1599 ECX-5: erp_fiscal_year_ensure pgTAP test suite
begin;
select plan(49);

-- 1. Table schema and RLS
select has_table('public', 'erp_fiscal_year_intents', 'erp_fiscal_year_intents table exists');
select has_pk('public', 'erp_fiscal_year_intents', 'erp_fiscal_year_intents has a primary key');
select has_check('public', 'erp_fiscal_year_intents', 'erp_fiscal_year_intents has check constraints');

-- Check forced RLS
select is(
  (select c.relrowsecurity and c.relforcerowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'erp_fiscal_year_intents'),
  true,
  'erp_fiscal_year_intents has FORCE ROW LEVEL SECURITY enabled'
);

-- Check role_table_grants: no grants to public, anon, or authenticated
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'erp_fiscal_year_intents'
      and grantee in ('PUBLIC', 'anon', 'authenticated')),
  0,
  'no direct table privileges granted to PUBLIC, anon, or authenticated'
);

-- Check pg_policies: no policies on erp_fiscal_year_intents
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public' and tablename = 'erp_fiscal_year_intents'),
  0,
  'erp_fiscal_year_intents has no client policies'
);

-- 2. Function presence and execution privileges
select has_function('public', 'prepare_fiscal_year_intent', array['uuid','uuid','text','text','timestamp with time zone','date','date','text'], 'prepare_fiscal_year_intent exists');
select has_function('public', 'begin_fiscal_year_post', array['uuid','uuid','uuid','bigint'], 'begin_fiscal_year_post exists');
select has_function('public', 'record_fiscal_year_status', array['uuid','uuid','text','text','timestamp with time zone','uuid','uuid','bigint','jsonb'], 'record_fiscal_year_status exists');
select has_function('public', 'record_fiscal_year_observation', array['uuid','uuid','text','text','timestamp with time zone','timestamp with time zone','jsonb'], 'record_fiscal_year_observation exists');

select is(has_function_privilege('service_role', 'public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text)', 'EXECUTE'), true, 'service_role can execute prepare_fiscal_year_intent');
select is(has_function_privilege('anon', 'public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text)', 'EXECUTE'), false, 'anon cannot execute prepare_fiscal_year_intent');
select is(has_function_privilege('authenticated', 'public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text)', 'EXECUTE'), false, 'authenticated cannot execute prepare_fiscal_year_intent');

select is(has_function_privilege('service_role', 'public.begin_fiscal_year_post(uuid,uuid,uuid,bigint)', 'EXECUTE'), true, 'service_role can execute begin_fiscal_year_post');
select is(has_function_privilege('anon', 'public.begin_fiscal_year_post(uuid,uuid,uuid,bigint)', 'EXECUTE'), false, 'anon cannot execute begin_fiscal_year_post');
select is(has_function_privilege('authenticated', 'public.begin_fiscal_year_post(uuid,uuid,uuid,bigint)', 'EXECUTE'), false, 'authenticated cannot execute begin_fiscal_year_post');

select is(has_function_privilege('service_role', 'public.record_fiscal_year_status(uuid,uuid,text,text,timestamptz,uuid,uuid,bigint,jsonb)', 'EXECUTE'), true, 'service_role can execute record_fiscal_year_status');
select is(has_function_privilege('anon', 'public.record_fiscal_year_status(uuid,uuid,text,text,timestamptz,uuid,uuid,bigint,jsonb)', 'EXECUTE'), false, 'anon cannot execute record_fiscal_year_status');
select is(has_function_privilege('authenticated', 'public.record_fiscal_year_status(uuid,uuid,text,text,timestamptz,uuid,uuid,bigint,jsonb)', 'EXECUTE'), false, 'authenticated cannot execute record_fiscal_year_status');

select is(has_function_privilege('service_role', 'public.record_fiscal_year_observation(uuid,uuid,text,text,timestamptz,timestamptz,jsonb)', 'EXECUTE'), true, 'service_role can execute record_fiscal_year_observation');
select is(has_function_privilege('anon', 'public.record_fiscal_year_observation(uuid,uuid,text,text,timestamptz,timestamptz,jsonb)', 'EXECUTE'), false, 'anon cannot execute record_fiscal_year_observation');
select is(has_function_privilege('authenticated', 'public.record_fiscal_year_observation(uuid,uuid,text,text,timestamptz,timestamptz,jsonb)', 'EXECUTE'), false, 'authenticated cannot execute record_fiscal_year_observation');

-- Seed organizations and users
insert into organizations (id, name) values
 ('f5010000-0000-0000-0000-000000000001','Fiscal Org A'),
 ('f5010000-0000-0000-0000-000000000002','Fiscal Org B');

insert into auth.users (id, email) values
 ('f5010000-0000-0000-0000-0000000000a1','f501-admin@example.com'),
 ('f5010000-0000-0000-0000-0000000000f1','f501-finance@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
 ('f5010000-0000-0000-0000-0000000000a1','f5010000-0000-0000-0000-000000000001','Admin A','f501-admin@example.com','Admin','active'),
 ('f5010000-0000-0000-0000-0000000000f1','f5010000-0000-0000-0000-000000000001','Finance A','f501-finance@example.com','Finance','active');

-- Seed external bindings
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('f5010000-0000-0000-0000-0000000000b1','f5010000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','f501_sec','active','{"company":"Acme Co","sibling_setting":"preserved"}','2026-01-01 00:00:00+00'),
 ('f5010000-0000-0000-0000-0000000000b2','f5010000-0000-0000-0000-000000000002','erpnext','https://erp-b.example.test','f501_sec_b','active','{"company":"Acme Co"}','2026-01-01 00:00:00+00');

-- 3. Authenticated client access is denied
set local role authenticated;
set local request.jwt.claims = '{"sub":"f5010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select * from public.erp_fiscal_year_intents$$,
  '42501',
  null,
  'Admin cannot select from erp_fiscal_year_intents'
);
select throws_ok(
  $$select public.prepare_fiscal_year_intent('f5010000-0000-0000-0000-000000000001'::uuid, 'f5010000-0000-0000-0000-0000000000b1'::uuid, 'Acme Co', 'https://erp.example.test', '2026-01-01 00:00:00+00'::timestamptz, '2027-01-01'::date, '2027-12-31'::date, '2027')$$,
  '42501',
  null,
  'Admin cannot call prepare_fiscal_year_intent'
);

set local request.jwt.claims = '{"sub":"f5010000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok(
  $$select public.prepare_fiscal_year_intent('f5010000-0000-0000-0000-000000000001'::uuid, 'f5010000-0000-0000-0000-0000000000b1'::uuid, 'Acme Co', 'https://erp.example.test', '2026-01-01 00:00:00+00'::timestamptz, '2027-01-01'::date, '2027-12-31'::date, '2027')$$,
  '42501',
  null,
  'Finance cannot call prepare_fiscal_year_intent'
);

-- Back to service_role
reset role;
set local role service_role;

-- 4. Functional tests for prepare_fiscal_year_intent
select throws_ok(
  $$select public.prepare_fiscal_year_intent('f5010000-0000-0000-0000-000000000001'::uuid, 'f5010000-0000-0000-0000-0000000000b1'::uuid, 'Acme Co', 'https://erp.example.test', '2026-01-01 00:00:00+00'::timestamptz, '2027-12-31'::date, '2027-01-01'::date, '2027')$$,
  '22023',
  null,
  'reverse span fails'
);

select throws_ok(
  $$select public.prepare_fiscal_year_intent('f5010000-0000-0000-0000-000000000001'::uuid, 'f5010000-0000-0000-0000-0000000000b1'::uuid, 'Acme Co', 'https://wrong-site.test', '2026-01-01 00:00:00+00'::timestamptz, '2027-01-01'::date, '2027-12-31'::date, '2027')$$,
  'P0001',
  null,
  'mismatched site_url fails'
);

select throws_ok(
  $$select public.prepare_fiscal_year_intent('f5010000-0000-0000-0000-000000000001'::uuid, 'f5010000-0000-0000-0000-0000000000b1'::uuid, 'Wrong Co', 'https://erp.example.test', '2026-01-01 00:00:00+00'::timestamptz, '2027-01-01'::date, '2027-12-31'::date, '2027')$$,
  'P0001',
  null,
  'mismatched company fails'
);

select throws_ok(
  $$select public.prepare_fiscal_year_intent('f5010000-0000-0000-0000-000000000002'::uuid, 'f5010000-0000-0000-0000-0000000000b1'::uuid, 'Acme Co', 'https://erp.example.test', '2026-01-01 00:00:00+00'::timestamptz, '2027-01-01'::date, '2027-12-31'::date, '2027')$$,
  'P0001',
  null,
  'mismatched org fails'
);

create temp table t_prep on commit drop as
select * from public.prepare_fiscal_year_intent(
  'f5010000-0000-0000-0000-000000000001'::uuid,
  'f5010000-0000-0000-0000-0000000000b1'::uuid,
  'Acme Co',
  'https://erp.example.test',
  '2026-01-01 00:00:00+00'::timestamptz,
  '2027-01-01'::date,
  '2027-12-31'::date,
  '2027'
);
select is((select year_name from t_prep), '2027', 'intent created with proposed year_name');

create temp table t_prep2 on commit drop as
select * from public.prepare_fiscal_year_intent(
  'f5010000-0000-0000-0000-000000000001'::uuid,
  'f5010000-0000-0000-0000-0000000000b1'::uuid,
  'Acme Co',
  'https://erp.example.test',
  '2026-01-01 00:00:00+00'::timestamptz,
  '2027-01-01'::date,
  '2027-12-31'::date,
  '2027'
);
select is((select id from t_prep2), (select id from t_prep), 'duplicate prepare returns same UUID');

create temp table t_prep3 on commit drop as
select * from public.prepare_fiscal_year_intent(
  'f5010000-0000-0000-0000-000000000001'::uuid,
  'f5010000-0000-0000-0000-0000000000b1'::uuid,
  'Acme Co',
  'https://erp.example.test',
  '2026-01-01 00:00:00+00'::timestamptz,
  '2027-01-01'::date,
  '2027-12-31'::date,
  '2027 - Acme Co'
);
select is((select year_name from t_prep3), '2027', 'winning year_name is preserved even if different name proposed');

-- 5. Functional tests for begin_fiscal_year_post
insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, claim_generation) values
 ('f5010000-0000-0000-0000-0000000000c1',
  'f5010000-0000-0000-0000-000000000001',
  'fiscal_year_setup',
  (select id from t_prep),
  'setup:fiscal-year:' || (select id from t_prep)::text,
  'erpnext',
  'create',
  'committing',
  '{"company":"Acme Co","span":{"start":"2027-01-01","end":"2027-12-31"},"year_name":"2027"}'::jsonb,
  1);

select is(
  public.begin_fiscal_year_post('f5010000-0000-0000-0000-000000000001'::uuid, (select id from t_prep), 'f5010000-0000-0000-0000-0000000000c1'::uuid, 999::bigint),
  false,
  'stale generation returns false'
);

select is(
  public.begin_fiscal_year_post('f5010000-0000-0000-0000-000000000002'::uuid, (select id from t_prep), 'f5010000-0000-0000-0000-0000000000c1'::uuid, 1::bigint),
  false,
  'wrong org returns false'
);

select is(
  public.begin_fiscal_year_post('f5010000-0000-0000-0000-000000000001'::uuid, (select id from t_prep), 'f5010000-0000-0000-0000-0000000000c1'::uuid, 1::bigint),
  true,
  'matching reservation succeeds'
);

select is(
  public.begin_fiscal_year_post('f5010000-0000-0000-0000-000000000001'::uuid, (select id from t_prep), 'f5010000-0000-0000-0000-0000000000c1'::uuid, 1::bigint),
  false,
  'second reservation returns false'
);

-- 6. Functional tests for record_fiscal_year_status
update external_command_outbox set state = 'committed' where id = 'f5010000-0000-0000-0000-0000000000c1';

select is(
  public.record_fiscal_year_status(
    'f5010000-0000-0000-0000-000000000001'::uuid,
    'f5010000-0000-0000-0000-0000000000b1'::uuid,
    'Acme Co',
    'https://erp.example.test',
    '2026-01-01 00:00:00+00'::timestamptz,
    (select id from t_prep),
    'f5010000-0000-0000-0000-0000000000c1'::uuid,
    2::bigint,
    '{"state":"ready","company":"Acme Co","checked_at":"2026-11-20T00:00:00Z","current":"2026","next":"2027"}'::jsonb
  ),
  false,
  'stale generation for status returns false'
);

select is(
  public.record_fiscal_year_status(
    'f5010000-0000-0000-0000-000000000001'::uuid,
    'f5010000-0000-0000-0000-0000000000b1'::uuid,
    'Wrong Co',
    'https://erp.example.test',
    '2026-01-01 00:00:00+00'::timestamptz,
    (select id from t_prep),
    'f5010000-0000-0000-0000-0000000000c1'::uuid,
    1::bigint,
    '{"state":"ready","company":"Wrong Co","checked_at":"2026-11-20T00:00:00Z","current":"2026","next":"2027"}'::jsonb
  ),
  false,
  'wrong company for status returns false'
);

select is(
  public.record_fiscal_year_status(
    'f5010000-0000-0000-0000-000000000001'::uuid,
    'f5010000-0000-0000-0000-0000000000b1'::uuid,
    'Acme Co',
    'https://erp.example.test',
    '2026-01-01 00:00:00+00'::timestamptz,
    (select id from t_prep),
    'f5010000-0000-0000-0000-0000000000c1'::uuid,
    1::bigint,
    '{"state":"ready","company":"Acme Co","checked_at":"2026-11-20T00:00:00Z","current":"2026","next":"2027"}'::jsonb
  ),
  true,
  'valid status recording succeeds'
);

select is(
  (select config->>'sibling_setting' from external_org_bindings where id = 'f5010000-0000-0000-0000-0000000000b1'),
  'preserved',
  'sibling config setting is preserved after status update'
);
select is(
  (select config->'fiscal_year'->>'state' from external_org_bindings where id = 'f5010000-0000-0000-0000-0000000000b1'),
  'ready',
  'config.fiscal_year.state is ready'
);

-- A confirmed outbox is settled before a later independent observation.
update external_command_outbox set state = 'confirmed' where id = 'f5010000-0000-0000-0000-0000000000c1';

-- 7. Functional tests for record_fiscal_year_observation
select is(
  public.record_fiscal_year_observation(
    'f5010000-0000-0000-0000-000000000001'::uuid,
    'f5010000-0000-0000-0000-0000000000b1'::uuid,
    'Acme Co',
    'https://erp.example.test',
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-11-19 00:00:00+00'::timestamptz,
    '{"state":"not-due","company":"Acme Co","checked_at":"2026-11-19T00:00:00Z"}'::jsonb
  ),
  false,
  'stale checked_at observation returns false'
);

select is(
  public.record_fiscal_year_observation(
    'f5010000-0000-0000-0000-000000000001'::uuid,
    'f5010000-0000-0000-0000-0000000000b1'::uuid,
    'Acme Co',
    'https://erp.example.test',
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-11-21 00:00:00+00'::timestamptz,
    '{"state":"ready","company":"Acme Co","checked_at":"2026-11-21T00:00:00Z"}'::jsonb
  ),
  true,
  'newer observation returns true'
);

-- Held intent blocks a later non-held observation
update external_command_outbox set state = 'held' where id = 'f5010000-0000-0000-0000-0000000000c1';
update external_org_bindings set config = jsonb_set(config, '{fiscal_year}', '{"state":"needs-operator","reason":"unconfirmed","company":"Acme Co"}'::jsonb) where id = 'f5010000-0000-0000-0000-0000000000b1';

select is(
  public.record_fiscal_year_observation(
    'f5010000-0000-0000-0000-000000000001'::uuid,
    'f5010000-0000-0000-0000-0000000000b1'::uuid,
    'Acme Co',
    'https://erp.example.test',
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-11-22 00:00:00+00'::timestamptz,
    '{"state":"not-due","company":"Acme Co","checked_at":"2026-11-22T00:00:00Z"}'::jsonb
  ),
  false,
  'unresolved held intent blocks overwriting with not-due observation'
);


-- A confirmed transport record does not resolve an intent-backed operator outcome.
update external_command_outbox set state = 'confirmed' where id = 'f5010000-0000-0000-0000-0000000000c1';
update external_org_bindings set config = jsonb_set(config, '{fiscal_year}', jsonb_build_object('state','needs-operator','reason','held','intentId',(select id::text from t_prep),'company','Acme Co')) where id = 'f5010000-0000-0000-0000-0000000000b1';
select is(public.record_fiscal_year_observation(
  'f5010000-0000-0000-0000-000000000001', 'f5010000-0000-0000-0000-0000000000b1',
  'Acme Co', 'https://erp.example.test', '2026-01-01 00:00:00+00', '2026-11-23 00:00:00+00',
  '{"state":"ready","company":"Acme Co","current":"2026","next":"2027"}'::jsonb), false,
  'intent-backed operator status remains unresolved even if outbox is confirmed');

-- The outbox also retains the unresolved result if the binding observation was not published.
update external_command_outbox set canonical = '{"status":{"state":"needs-operator","reason":"held"}}'::jsonb where id = 'f5010000-0000-0000-0000-0000000000c1';
update external_org_bindings set config = jsonb_set(config, '{fiscal_year}', '{"state":"needs-operator","reason":"missing-role","company":"Acme Co"}'::jsonb) where id = 'f5010000-0000-0000-0000-0000000000b1';
select is(public.record_fiscal_year_observation(
  'f5010000-0000-0000-0000-000000000001', 'f5010000-0000-0000-0000-0000000000b1',
  'Acme Co', 'https://erp.example.test', '2026-01-01 00:00:00+00', '2026-11-23 00:00:00+00',
  '{"state":"ready","company":"Acme Co","current":"2026","next":"2027"}'::jsonb), false,
  'confirmed outbox with held canonical status remains unresolved');

-- A discovery-only setting can recover without an intent.
update external_org_bindings set config = jsonb_set(config, '{fiscal_year}', '{"state":"needs-operator","reason":"missing-role","company":"Acme Co"}'::jsonb) where id = 'f5010000-0000-0000-0000-0000000000b2';
select is(public.record_fiscal_year_observation(
  'f5010000-0000-0000-0000-000000000002', 'f5010000-0000-0000-0000-0000000000b2',
  'Acme Co', 'https://erp-b.example.test', '2026-01-01 00:00:00+00', '2026-11-22 00:00:00+00',
  '{"state":"ready","company":"Acme Co","current":"2026","next":"2027"}'::jsonb), true,
  'pre-intent operator status can be replaced by ready');
select is((select config->'fiscal_year'->>'state' from external_org_bindings where id = 'f5010000-0000-0000-0000-0000000000b2'), 'ready', 'recovered state persists');
select ok((select post_started_at is not null and post_outbox_id = 'f5010000-0000-0000-0000-0000000000c1'::uuid and post_generation = 1 from erp_fiscal_year_intents where id = (select id from t_prep)), 'held reservation remains unchanged');

select * from finish();
rollback;
