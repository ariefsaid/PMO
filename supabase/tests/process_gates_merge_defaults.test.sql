-- process_gates_merge_defaults.test.sql (0108 — Luna re-audit BLOCK 5)
--
-- 0107's get_process_gates returns the STORED process_gates jsonb UNCHANGED; the defaults apply only
-- when the whole value is NULL. So a PARTIAL object (e.g. an Admin flipping only require_so_before_si,
-- or a `{}` written by a config UI) silently drops every unstated gate: adapter-dispatch reads
-- `require_project_on_si` as `undefined` -> falsy -> a gate the org believes is ON is OFF.
--
-- 0108 redefines it to MERGE the stored object OVER the per-key defaults, preserving 0107's org guard
-- + the (load-bearing) service_role bypass exactly.
-- Uses namespaced UUIDs, begin/rollback, finish().

begin;
select plan(9);

-- Fixtures: two orgs (A = the caller's, B = a different tenant), one user each.
insert into organizations (id, name) values
  ('11080000-0000-0000-0000-000000000001','B5 Org A'),
  ('11080000-0000-0000-0000-000000000002','B5 Org B');

insert into auth.users (id, email) values
  ('11080000-0000-0000-0000-0000000000a1','admin-a-b5@example.com'),
  ('11080000-0000-0000-0000-0000000000b1','admin-b-b5@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('11080000-0000-0000-0000-0000000000a1','11080000-0000-0000-0000-000000000001','Admin A','admin-a-b5@example.com','Admin','active'),
  ('11080000-0000-0000-0000-0000000000b1','11080000-0000-0000-0000-000000000002','Admin B','admin-b-b5@example.com','Admin','active');

insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('11080000-0000-0000-0000-000000000001','erpnext','https://erp-a.example.com','secret-ref-a','{}'::jsonb),
  ('11080000-0000-0000-0000-000000000002','erpnext','https://erp-b.example.com','secret-ref-b','{}'::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11080000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 1) No process_gates key at all -> full defaults (0107 behaviour, preserved).
select is(
  get_process_gates('11080000-0000-0000-0000-000000000001'::uuid),
  '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb,
  'B5: absent process_gates -> full defaults (unchanged)');

-- 2) An EMPTY stored object must still yield the defaults — NOT `{}` (the silent-gate-off bug).
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update external_org_bindings set config = '{"process_gates":{}}'::jsonb
  where org_id = '11080000-0000-0000-0000-000000000001' and external_tier = 'erpnext';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  get_process_gates('11080000-0000-0000-0000-000000000001'::uuid),
  '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb,
  'B5: process_gates {} merges over defaults -> require_project_on_si stays TRUE (not silently off)');

-- 3) A PARTIAL object merges per-key: the stated key wins, the unstated keep their defaults.
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update external_org_bindings set config = '{"process_gates":{"require_so_before_si":true}}'::jsonb
  where org_id = '11080000-0000-0000-0000-000000000001' and external_tier = 'erpnext';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  get_process_gates('11080000-0000-0000-0000-000000000001'::uuid) ->> 'require_so_before_si',
  'true',
  'B5: a partial object''s stated key wins (require_so_before_si=true)');
select is(
  get_process_gates('11080000-0000-0000-0000-000000000001'::uuid) ->> 'require_project_on_si',
  'true',
  'B5: the UNSTATED require_project_on_si keeps its TRUE default (the money gate cannot be dropped by omission)');
select is(
  get_process_gates('11080000-0000-0000-0000-000000000001'::uuid) ->> 'require_bast_before_si',
  'false',
  'B5: the unstated require_bast_before_si keeps its false default');

-- 4) An explicit false still wins (a merge must not pin the default on — an Admin CAN turn it off).
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update external_org_bindings set config = '{"process_gates":{"require_project_on_si":false}}'::jsonb
  where org_id = '11080000-0000-0000-0000-000000000001' and external_tier = 'erpnext';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  get_process_gates('11080000-0000-0000-0000-000000000001'::uuid) ->> 'require_project_on_si',
  'false',
  'B5: an explicit require_project_on_si=false still wins (the Admin flip works)');

-- 5) A NON-BOOLEAN value cannot silently disable a gate — it falls back to the default (fail closed).
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
update external_org_bindings set config = '{"process_gates":{"require_project_on_si":null}}'::jsonb
  where org_id = '11080000-0000-0000-0000-000000000001' and external_tier = 'erpnext';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  get_process_gates('11080000-0000-0000-0000-000000000001'::uuid) ->> 'require_project_on_si',
  'true',
  'B5: a non-boolean (null) require_project_on_si falls back to the TRUE default — never read as falsy-off');

-- 6) 0107's org guard is PRESERVED: a user reading ANOTHER org's gates is still denied 42501.
select throws_ok(
  $$ select get_process_gates('11080000-0000-0000-0000-000000000002'::uuid) $$,
  '42501', null,
  'B5: 0107 org guard preserved — a cross-org user read is still denied 42501');

-- 7) The service_role bypass is PRESERVED (load-bearing: the dispatch calls this with the service
--    client, whose auth_org_id() is null — breaking it breaks every SI create).
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select get_process_gates('11080000-0000-0000-0000-000000000002'::uuid) $$,
  'B5: 0107 service_role bypass preserved — the dispatch machine call reads any org''s gates');

reset role;
select * from finish();
rollback;
