-- #1510 L2 (migration 0861): employing `timesheets` under Odoo is checked by the DATABASE, like procurement / revenue /
-- companies (0505/0510/0743). AC-OLH-001 (the employ names the first missing model, or `model:operation`, and the labour
-- journal + accounts must be chosen) and AC-OLH-002 (an ERPNext ownership refuses the Odoo employ with the words naming it).
-- Also proves `set_odoo_labour_config` (Admin/Finance, org re-asserted, ids validated against the org's own mirror) and the
-- read-only `org_employs_odoo_timesheets` the Odoo sweep's employee pass asks before it reads `hr.employee`.
begin;
select plan(26);

insert into organizations (id, name) values
 ('15110000-0000-0000-0000-000000000001','Labour Employ A full'),
 ('15110000-0000-0000-0000-000000000002','Labour Employ B no labour snapshot'),
 ('15110000-0000-0000-0000-000000000003','Labour Employ C ERPNext owns timesheets'),
 ('15110000-0000-0000-0000-000000000004','Labour Employ D not activated'),
 ('15110000-0000-0000-0000-000000000005','Labour Employ E unconfigured');
insert into auth.users (id, email) values
 ('15110000-0000-0000-0000-0000000000a1','1511-admin@example.com'),
 ('15110000-0000-0000-0000-0000000000f1','1511-finance@example.com'),
 ('15110000-0000-0000-0000-0000000000a2','1511-pm@example.com'),
 ('15110000-0000-0000-0000-0000000000b1','1511-b-admin@example.com'),
 ('15110000-0000-0000-0000-0000000000c1','1511-c-admin@example.com'),
 ('15110000-0000-0000-0000-0000000000d1','1511-d-admin@example.com'),
 ('15110000-0000-0000-0000-0000000000e1','1511-e-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('15110000-0000-0000-0000-0000000000a1','15110000-0000-0000-0000-000000000001','Admin','1511-admin@example.com','Admin','active'),
 ('15110000-0000-0000-0000-0000000000f1','15110000-0000-0000-0000-000000000001','Finance','1511-finance@example.com','Finance','active'),
 ('15110000-0000-0000-0000-0000000000a2','15110000-0000-0000-0000-000000000001','PM','1511-pm@example.com','Project Manager','active'),
 ('15110000-0000-0000-0000-0000000000b1','15110000-0000-0000-0000-000000000002','B Admin','1511-b-admin@example.com','Admin','active'),
 ('15110000-0000-0000-0000-0000000000c1','15110000-0000-0000-0000-000000000003','C Admin','1511-c-admin@example.com','Admin','active'),
 ('15110000-0000-0000-0000-0000000000d1','15110000-0000-0000-0000-000000000004','D Admin','1511-d-admin@example.com','Admin','active'),
 ('15110000-0000-0000-0000-0000000000e1','15110000-0000-0000-0000-000000000005','E Admin','1511-e-admin@example.com','Admin','active');

-- A capability snapshot as discovery stores it (L1's `labour` block), plus the mirror rows the config validates against.
create temp table snap as select jsonb_build_object('capabilities', jsonb_build_object('labour', jsonb_build_object(
  'hr.employee',          jsonb_build_object('exists', true, 'read', true, 'create', false, 'write', false, 'unlink', false, 'fields_missing', '[]'::jsonb),
  'account.analytic.line', jsonb_build_object('exists', true, 'read', true, 'create', true, 'write', true, 'unlink', false, 'fields_missing', '[]'::jsonb),
  'account.move',         jsonb_build_object('exists', true, 'read', true, 'create', true, 'write', true, 'unlink', false, 'fields_missing', '[]'::jsonb),
  'account.move.line',    jsonb_build_object('exists', true, 'read', true, 'create', true, 'write', true, 'unlink', false, 'fields_missing', '[]'::jsonb),
  'ir.model.data',        jsonb_build_object('exists', true, 'read', true, 'create', true, 'write', false, 'unlink', false, 'fields_missing', '[]'::jsonb)))) as full_cfg;
grant select on snap to public;
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
select v.org, 'odoo', 'https://odoo.example.test', v.ref, 'active', v.cfg, v.act
  from snap, lateral (values
    ('15110000-0000-0000-0000-000000000001'::uuid, '1511_a', snap.full_cfg, now()),
    ('15110000-0000-0000-0000-000000000002'::uuid, '1511_b', snap.full_cfg #- '{capabilities,labour}', now()),
    ('15110000-0000-0000-0000-000000000003'::uuid, '1511_c', snap.full_cfg, now()),
    ('15110000-0000-0000-0000-000000000004'::uuid, '1511_d', snap.full_cfg, null::timestamptz),
    ('15110000-0000-0000-0000-000000000005'::uuid, '1511_e', snap.full_cfg, now())) as v(org, ref, cfg, act);
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('15110000-0000-0000-0000-000000000003','erpnext','https://erp.example.test','1511_c_erp','active','{}', now());
-- The ownership row (not just the binding) is what makes AC-OLH-002's refusal fire: one ERP at a time.
insert into external_domain_ownership (org_id, external_tier, domain) values
 ('15110000-0000-0000-0000-000000000003','erpnext','timesheets');

-- The org's own Odoo mirror: one miscellaneous journal and two postable accounts.
insert into external_master_records (org_id, external_tier, kind, external_id, code, name, source_write_date, attrs) values
 ('15110000-0000-0000-0000-000000000001','odoo','journal','9','MISC','Miscellaneous Operations','2026-11-01 00:00:00','{"type":"general"}'),
 ('15110000-0000-0000-0000-000000000001','odoo','account','41','6100','Labour expense','2026-11-01 00:00:00','{}'),
 ('15110000-0000-0000-0000-000000000001','odoo','account','42','2110','Payroll payable','2026-11-01 00:00:00','{}'),
 ('15110000-0000-0000-0000-000000000005','odoo','journal','9','MISC','Miscellaneous Operations','2026-11-01 00:00:00','{"type":"general"}');

-- ── A) An unconfigured employ is refused before any model check (D8) ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000005','odoo','timesheets','employ')$$,
  'P0001', 'Choose the labour journal and accounts in the Odoo setup first.',
  'AC-OLH-001 an employ with no labour journal/accounts chosen is refused, naming what to choose');
reset role;

-- ── B) `set_odoo_labour_config`: Admin or Finance, org re-asserted, ids validated against the org's own mirror ──────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.set_odoo_labour_config('15110000-0000-0000-0000-000000000001','9','41','42','payroll')$$,
  '42501', null, 'NFR-OLH-004 a Project Manager cannot choose the labour journal/accounts');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_odoo_labour_config('15110000-0000-0000-0000-000000000001','9','41','42','hourly')$$,
  '22023', null, 'D3 an unknown cost basis is refused');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_odoo_labour_config('15110000-0000-0000-0000-000000000001','9','41','99','payroll')$$,
  '22023', null, 'D8 an account the org''s Odoo mirror does not hold is refused (no invented defaults)');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.set_odoo_labour_config('15110000-0000-0000-0000-000000000001','9','41','42','payroll')$$,
  '42501', null, 'NFR-OLH-004 another organisation''s Admin cannot configure this org');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$select public.set_odoo_labour_config('15110000-0000-0000-0000-000000000001','9','41','42','payroll')$$,
  'D8 Finance chooses the labour journal, expense account, payable account and basis');
reset role;
select is((select config->>'labour_journal_id' || '/' || (config->>'labour_expense_account_id') || '/' || (config->>'labour_payable_account_id') || '/' || (config->>'labour_cost_basis')
             from external_org_bindings where org_id = '15110000-0000-0000-0000-000000000001' and external_tier = 'odoo'),
  '9/41/42/payroll', 'D8 the four keys land on the binding config');
select is((select count(*)::int from audit_events where action = 'integration.odoo.labour_config'
            and org_id = '15110000-0000-0000-0000-000000000001' and actor_id = '15110000-0000-0000-0000-0000000000f1'),
  1, 'D8 choosing the labour accounts is audited with its actor');

-- ── C) AC-OLH-001: with a full snapshot and the accounts chosen, the employ succeeds and is audited ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000001','odoo','timesheets','employ')$$,
  'AC-OLH-001 an Admin employs timesheets under Odoo');
reset role;
select is((select count(*)::int from external_domain_ownership
            where org_id = '15110000-0000-0000-0000-000000000001' and external_tier = 'odoo' and domain = 'timesheets'),
  1, 'AC-OLH-001 the ownership row exists');
select is((select count(*)::int from audit_events
            where org_id = '15110000-0000-0000-0000-000000000001' and action = 'integration.domain_ownership.employ'
              and detail->>'domain' = 'timesheets'),
  1, 'AC-OLH-001 the employ writes one audit row');

-- ── D) AC-OLH-001: the refusal names the first missing model or model:operation ────────────────────────────────────
update external_org_bindings
   set config = jsonb_set(config, '{capabilities,labour,account.analytic.line,create}', 'false')
 where org_id = '15110000-0000-0000-0000-000000000001' and external_tier = 'odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000001','odoo','timesheets','employ')$$,
  'P0001', 'Odoo is missing account.analytic.line:create',
  'AC-OLH-001 a snapshot without account.analytic.line:create refuses the employ, naming it');
reset role;
update external_org_bindings
   set config = jsonb_set(config, '{capabilities,labour,account.analytic.line,create}', 'true')
 where org_id = '15110000-0000-0000-0000-000000000001' and external_tier = 'odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000001','odoo','timesheets','employ')$$,
  'AC-OLH-001 with the gap closed the same employ succeeds');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000002','odoo','timesheets','employ')$$,
  'P0001', 'Odoo is missing hr.employee',
  'AC-OLH-001 an old snapshot with no labour block fails closed on the first model');
reset role;

-- ── E) AC-OLH-002: one ERP at a time, with the words naming the tier that already holds it ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000003','odoo','timesheets','employ')$$,
  'P0001', 'timesheets is already employed on another ERP',
  'AC-OLH-002 an ERPNext ownership refuses the Odoo employ');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000001','erpnext','timesheets','employ')$$,
  'P0001', 'timesheets is already employed on another ERP',
  'AC-OLH-002 the reverse direction refuses too (Odoo already owns it)');
reset role;

-- ── F) AC-OLH-002 / FR-OLH-001: a not-activated connection is the blocker's first refusal ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000004','odoo','timesheets','employ')$$,
  'P0001', 'Odoo connection is not activated',
  'FR-OLH-001 an unactivated Odoo connection cannot employ timesheets');
reset role;

-- ── G) The role matrix and the read-only ownership predicate ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000001','odoo','timesheets','employ')$$,
  '42501', null, 'FR-OLH-001 a Project Manager cannot employ a domain');
reset role;
select is(public.org_employs_odoo_timesheets('15110000-0000-0000-0000-000000000001'), true,
  'FR-OLH-003 the org employs timesheets under Odoo');
select is(public.org_employs_odoo_timesheets('15110000-0000-0000-0000-000000000002'), false,
  'FR-OLH-003 an org that does not employ it answers false');
select is(public.org_employs_odoo_timesheets('15110000-0000-0000-0000-000000000003'), false,
  'FR-OLH-003 an ERPNext-owned org does not employ timesheets under Odoo');

-- ── H) Privileges: the writers are service-role only, the config is client-callable (0178's retained set) ───────────
select is(has_function_privilege('authenticated', 'public.odoo_labour_employ_blocker(uuid)', 'execute'), false,
  'NFR-OLH-004 the employ blocker is not executable by a user JWT');
select is(has_function_privilege('service_role', 'public.odoo_labour_employ_blocker(uuid)', 'execute'), true,
  'NFR-OLH-004 the employ blocker is executable by the edge functions');
select is(has_function_privilege('anon', 'public.set_odoo_labour_config(uuid,text,text,text,text)', 'execute'), false,
  'NFR-OLH-004 anon cannot choose the labour accounts');
select is(has_function_privilege('authenticated', 'public.set_odoo_labour_config(uuid,text,text,text,text)', 'execute'), true,
  'NFR-OLH-004 authenticated may call the config writer (it re-asserts org + Admin/Finance in its body)');
select is(has_function_privilege('authenticated', 'public.org_employs_odoo_timesheets(uuid)', 'execute'), true,
  'NFR-OLH-004 the read-only ownership predicate is callable by the client and the sweep');

select * from finish();
rollback;
