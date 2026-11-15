-- api_client_operator_onboard.test.sql — proof for 0894 (#2280): a command-line sign-in may add an organisation as the platform
-- Operator and nothing else of an Operator's. The guard admits five calls (is_operator, is_active_member, operator_plan_catalogue,
-- operator_org_plan, operator_create_org_with_setup), POST only, when `is_operator() and is_active_member()` hold; the create
-- function sets plan, features and starting state in the same transaction. The three mutators (plan, feature, state) are NOT
-- admitted, so a command-line token cannot change an existing organisation. No suspend or close RPC exists; the unlisted-name
-- group below names the real operator RPCs instead.
--
-- AC ids owned here:
--   AC-OPR-CLI-001  an active Operator token (with client_id) passes the guard for each of the five calls.
--   AC-OPR-CLI-002  an organisation Admin, Finance, Engineer, Project Manager, Executive and a disabled Operator are refused, per call.
--   AC-OPR-CLI-003  a GET and an anonymous token are refused, per call.
--   AC-OPR-CLI-004  every other operator RPC, including plan, feature and state changes on an existing organisation, is refused.
--   AC-OPR-CLI-005  an app session (no client_id) is not decided by the guard; each RPC still refuses a non-Operator.
--   AC-OPR-CLI-006  the Operator creates an organisation with plan, features and state in one call; a bad plan or feature leaves nothing behind.
--
-- ⚑ pgTAP runs as the migration superuser; the authz assertions run under `set local role` + a JWT claim.
-- MUTATION-CHECKED: replace the block's `public.is_operator() and public.is_active_member()` with `true` and AC-OPR-CLI-002/003 go red;
-- add `operator_set_org_plan` to operator_onboard_rpcs and AC-OPR-CLI-004 goes red. Recorded in the evidence file.
begin;
select plan(113);

insert into organizations (id,name,default_currency) values ('08940000-0000-0000-0000-0000000000a0','Onboard guard org','IDR');
insert into auth.users(id,email) values
('08940000-0000-0000-0000-0000000000b1','ob-operator@example.com'),
('08940000-0000-0000-0000-0000000000b2','ob-disabled-operator@example.com'),
('08940000-0000-0000-0000-0000000000b3','ob-admin@example.com'),
('08940000-0000-0000-0000-0000000000b4','ob-finance@example.com'),
('08940000-0000-0000-0000-0000000000b5','ob-engineer@example.com'),
('08940000-0000-0000-0000-0000000000b6','ob-pm@example.com'),
('08940000-0000-0000-0000-0000000000b7','ob-exec@example.com'),
('08940000-0000-0000-0000-0000000000b8','ob-new-admin@example.com'),
('08940000-0000-0000-0000-0000000000b9','ob-bad-plan-admin@example.com'),
('08940000-0000-0000-0000-0000000000ba','ob-bad-feature-admin@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
('08940000-0000-0000-0000-0000000000b1','08940000-0000-0000-0000-0000000000a0','Operator','ob-operator@example.com','Admin','active'),
('08940000-0000-0000-0000-0000000000b2','08940000-0000-0000-0000-0000000000a0','Disabled operator','ob-disabled-operator@example.com','Admin','disabled'),
('08940000-0000-0000-0000-0000000000b3','08940000-0000-0000-0000-0000000000a0','Admin','ob-admin@example.com','Admin','active'),
('08940000-0000-0000-0000-0000000000b4','08940000-0000-0000-0000-0000000000a0','Finance','ob-finance@example.com','Finance','active'),
('08940000-0000-0000-0000-0000000000b5','08940000-0000-0000-0000-0000000000a0','Engineer','ob-engineer@example.com','Engineer','active'),
('08940000-0000-0000-0000-0000000000b6','08940000-0000-0000-0000-0000000000a0','PM','ob-pm@example.com','Project Manager','active'),
('08940000-0000-0000-0000-0000000000b7','08940000-0000-0000-0000-0000000000a0','Executive','ob-exec@example.com','Executive','active');
insert into platform_operators(user_id) values
('08940000-0000-0000-0000-0000000000b1'),('08940000-0000-0000-0000-0000000000b2');

-- A token for `p_sub` ('' = anonymous); `p_client` false = an app session (no client_id).
create or replace function pg_temp.req(p_sub text, p_method text, p_path text, p_client boolean default true) returns void language sql as $$
select set_config('request.jwt.claims',
  (case when p_sub = '' then jsonb_build_object('role','anon') else jsonb_build_object('sub',p_sub,'role','authenticated') end
   || case when p_client then jsonb_build_object('client_id','pmo-cli') else '{}'::jsonb end)::text, true),
  set_config('request.method',p_method,true), set_config('request.path',p_path,true), set_config('request.headers','{}',true);$$;
grant all on function pg_temp.req(text,text,text,boolean) to public;
create temp table names(name text) on commit drop;
insert into names values ('is_operator'),('is_active_member'),('operator_plan_catalogue'),('operator_org_plan'),('operator_create_org_with_setup');
create temp table subjects(label text, sub text) on commit drop;
insert into subjects values
 ('organisation Admin','08940000-0000-0000-0000-0000000000b3'),('Finance','08940000-0000-0000-0000-0000000000b4'),
 ('Engineer','08940000-0000-0000-0000-0000000000b5'),('Project Manager','08940000-0000-0000-0000-0000000000b6'),
 ('Executive','08940000-0000-0000-0000-0000000000b7'),('disabled Operator','08940000-0000-0000-0000-0000000000b2');
grant select on names, subjects to public;
set local role authenticated;

-- AC-OPR-CLI-001: Operator, command-line token, POST → passes (5).
select lives_ok(
  format($f$select pg_temp.req('08940000-0000-0000-0000-0000000000b1','POST',%L); select public.api_client_request_guard()$f$, '/rpc/' || name),
  'AC-OPR-CLI-001 active Operator passes the guard for ' || name) from names order by name;

-- AC-OPR-CLI-002/003: every non-Operator subject, per name (6 subjects x 5 names = 30).
select throws_ok(
  format($f$select pg_temp.req(%L,'POST',%L); select public.api_client_request_guard()$f$, s.sub, '/rpc/' || n.name),
  '42501', null, 'AC-OPR-CLI-002 ' || s.label || ' refused for ' || n.name)
from subjects s cross join names n order by s.label, n.name;

-- AC-OPR-CLI-003: the Operator on GET, per name (5); an anonymous token, per name (5, as role anon).
select throws_ok(
  format($f$select pg_temp.req('08940000-0000-0000-0000-0000000000b1','GET',%L); select public.api_client_request_guard()$f$, '/rpc/' || name),
  '42501', null, 'AC-OPR-CLI-003 Operator GET refused for ' || name) from names order by name;
reset role;
set local role anon;
select throws_ok(
  format($f$select pg_temp.req('','POST',%L); select public.api_client_request_guard()$f$, '/rpc/' || name),
  '42501', null, 'AC-OPR-CLI-003 anonymous refused for ' || name) from names order by name;
reset role;
set local role authenticated;

-- AC-OPR-CLI-004: every other operator RPC stays refused for the Operator's command-line token (12).
select throws_ok(
  format($f$select pg_temp.req('08940000-0000-0000-0000-0000000000b1','POST',%L); select public.api_client_request_guard()$f$, '/rpc/' || x),
  '42501', null, 'AC-OPR-CLI-004 ' || x || ' stays app-only')
from unnest(array['operator_set_org_plan','operator_toggle_feature','operator_set_org_lifecycle_state','operator_create_org',
  'operator_clear_feature_override','operator_set_plan_feature','operator_set_plan_limits','operator_set_domain_ownership',
  'operator_grant_credits','operator_set_global_feature','operator_list_orgs','operator_org_exists']) as x;

-- AC-OPR-CLI-005: an app session is not the guard's business (5, organisation Admin) and each RPC still refuses a non-Operator (7 RPCs x 5 roles + 7 anon).
select lives_ok(
  format($f$select pg_temp.req('08940000-0000-0000-0000-0000000000b3','POST',%L,false); select public.api_client_request_guard()$f$, '/rpc/' || name),
  'AC-OPR-CLI-005 app session (no client_id) is not decided by the guard: ' || name) from names order by name;
select throws_ok(format($f$select pg_temp.req(%L,'POST','/rpc/x',false); %s$f$, s.sub, c.call), '42501', null,
  'AC-OPR-CLI-005 ' || s.label || ' refused by ' || c.label)
from (select * from subjects where label <> 'disabled Operator') s cross join (values
  ('operator_plan_catalogue', 'select public.operator_plan_catalogue()'),
  ('operator_create_org', $c$select public.operator_create_org('X','08940000-0000-0000-0000-0000000000b8','N','IDR','id',null,'Asia/Jakarta')$c$),
  ('operator_create_org_with_setup', $c$select public.operator_create_org_with_setup('X','08940000-0000-0000-0000-0000000000b8','N','IDR','id',null,'Asia/Jakarta','starter','[]'::jsonb,'test')$c$),
  ('operator_org_plan', $c$select public.operator_org_plan('08940000-0000-0000-0000-0000000000a0')$c$),
  ('operator_set_org_plan', $c$select public.operator_set_org_plan('08940000-0000-0000-0000-0000000000a0','starter')$c$),
  ('operator_toggle_feature', $c$select public.operator_toggle_feature('08940000-0000-0000-0000-0000000000a0','crm',true)$c$),
  ('operator_set_org_lifecycle_state', $c$select public.operator_set_org_lifecycle_state('08940000-0000-0000-0000-0000000000a0','test')$c$)
) as c(label, call) order by s.label, c.label;
reset role;
set local role anon;
select throws_ok('select public.operator_plan_catalogue()', '42501', null, 'AC-OPR-CLI-005 anonymous refused by operator_plan_catalogue');
select throws_ok($c$select public.operator_create_org('X','08940000-0000-0000-0000-0000000000b8','N','IDR','id',null,'Asia/Jakarta')$c$, '42501', null, 'AC-OPR-CLI-005 anonymous refused by operator_create_org');
select throws_ok($c$select public.operator_create_org_with_setup('X','08940000-0000-0000-0000-0000000000b8','N','IDR','id',null,'Asia/Jakarta','starter','[]'::jsonb,'test')$c$, '42501', null, 'AC-OPR-CLI-005 anonymous refused by operator_create_org_with_setup');
select throws_ok($c$select public.operator_org_plan('08940000-0000-0000-0000-0000000000a0')$c$, '42501', null, 'AC-OPR-CLI-005 anonymous refused by operator_org_plan');
select throws_ok($c$select public.operator_set_org_plan('08940000-0000-0000-0000-0000000000a0','starter')$c$, '42501', null, 'AC-OPR-CLI-005 anonymous refused by operator_set_org_plan');
select throws_ok($c$select public.operator_toggle_feature('08940000-0000-0000-0000-0000000000a0','crm',true)$c$, '42501', null, 'AC-OPR-CLI-005 anonymous refused by operator_toggle_feature');
select throws_ok($c$select public.operator_set_org_lifecycle_state('08940000-0000-0000-0000-0000000000a0','test')$c$, '42501', null, 'AC-OPR-CLI-005 anonymous refused by operator_set_org_lifecycle_state');
reset role;
set local role authenticated;

-- AC-OPR-CLI-006: one call creates the organisation with plan, features and state (5); a bad plan or feature leaves nothing (4).
select pg_temp.req('08940000-0000-0000-0000-0000000000b1','POST','/rpc/operator_create_org_with_setup');
select lives_ok('select public.api_client_request_guard()', 'AC-OPR-CLI-006 guard admits operator_create_org_with_setup');
select lives_ok($c$select public.operator_create_org_with_setup('Onboard guard new org','08940000-0000-0000-0000-0000000000b8','New Admin','IDR','id',null,'Asia/Jakarta','starter','[{"key":"crm","enabled":true}]'::jsonb,'test')$c$, 'AC-OPR-CLI-006 Operator creates the organisation with its setup');
reset role;
select is((select lifecycle_state from public.organizations where name='Onboard guard new org'), 'test', 'AC-OPR-CLI-006 starting state is set');
select is((select plan_id from public.org_plans where org_id=(select id from public.organizations where name='Onboard guard new org')), 'starter', 'AC-OPR-CLI-006 plan is set');
select is((select enabled from public.org_features where org_id=(select id from public.organizations where name='Onboard guard new org') and feature_key='crm'), true, 'AC-OPR-CLI-006 feature is set');
set local role authenticated;
select pg_temp.req('08940000-0000-0000-0000-0000000000b1','POST','/rpc/operator_create_org_with_setup');
select throws_ok($c$select public.operator_create_org_with_setup('Onboard bad plan','08940000-0000-0000-0000-0000000000b9','New Admin','IDR','id',null,'Asia/Jakarta','no-such-plan','[]'::jsonb,'test')$c$, '23503', null, 'AC-OPR-CLI-006 an unknown plan is refused');
select throws_ok($c$select public.operator_create_org_with_setup('Onboard bad feature','08940000-0000-0000-0000-0000000000ba','New Admin','IDR','id',null,'Asia/Jakarta','starter','[{"key":"projects","enabled":false}]'::jsonb,'test')$c$, 'P0001', null, 'AC-OPR-CLI-006 a core feature switch is refused');
reset role;
select is((select count(*)::int from public.organizations where name in ('Onboard bad plan','Onboard bad feature')), 0, 'AC-OPR-CLI-006 a refused setup leaves no organisation behind');
select is((select count(*)::int from public.profiles where id in ('08940000-0000-0000-0000-0000000000b9','08940000-0000-0000-0000-0000000000ba')), 0, 'AC-OPR-CLI-006 a refused setup leaves no Admin profile behind');
select * from finish();
rollback;
