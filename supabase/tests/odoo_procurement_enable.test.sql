-- #1505 O2 P2 (migration 0505): `procurement` becomes an employable domain for tier `odoo`.
-- AC-OPP-004 (who may employ it, and when), AC-OPP-060 (the outbox serializes tier-odoo rows exactly as it does ERPNext's).
-- The employ verb is service-role-only since 0210: the edge function calls it with the verified caller as p_actor_id, so the
-- role matrix below is exercised on that path; a user JWT is denied outright.
begin;
select plan(28);

insert into organizations (id, name) values
 ('a5050000-0000-0000-0000-000000000001','Enable A full'),
 ('a5050000-0000-0000-0000-000000000002','Enable B no payment model'),
 ('a5050000-0000-0000-0000-000000000003','Enable C not activated'),
 ('a5050000-0000-0000-0000-000000000004','Enable D has ERPNext'),
 ('a5050000-0000-0000-0000-000000000005','Enable E no binding'),
 ('a5050000-0000-0000-0000-000000000006','Enable F full, operator target'),
 ('a5050000-0000-0000-0000-000000000007','Enable G owned by ERPNext');
insert into auth.users (id, email) values
 ('a5050000-0000-0000-0000-0000000000a1','a505-admin@example.com'),
 ('a5050000-0000-0000-0000-0000000000f1','a505-finance@example.com'),
 ('a5050000-0000-0000-0000-0000000000e2','a505-exec@example.com'),
 ('a5050000-0000-0000-0000-0000000000a2','a505-pm@example.com'),
 ('a5050000-0000-0000-0000-0000000000e1','a505-eng@example.com'),
 ('a5050000-0000-0000-0000-0000000000b1','a505-b-admin@example.com'),
 ('a5050000-0000-0000-0000-0000000000c1','a505-c-admin@example.com'),
 ('a5050000-0000-0000-0000-0000000000d1','a505-d-admin@example.com'),
 ('a5050000-0000-0000-0000-0000000000e5','a505-e-admin@example.com'),
 ('a5050000-0000-0000-0000-0000000000d9','a505-operator@example.com'),
 ('a5050000-0000-0000-0000-0000000000a7','a505-g-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5050000-0000-0000-0000-0000000000a1','a5050000-0000-0000-0000-000000000001','Admin','a505-admin@example.com','Admin','active'),
 ('a5050000-0000-0000-0000-0000000000f1','a5050000-0000-0000-0000-000000000001','Finance','a505-finance@example.com','Finance','active'),
 ('a5050000-0000-0000-0000-0000000000e2','a5050000-0000-0000-0000-000000000001','Exec','a505-exec@example.com','Executive','active'),
 ('a5050000-0000-0000-0000-0000000000a2','a5050000-0000-0000-0000-000000000001','PM','a505-pm@example.com','Project Manager','active'),
 ('a5050000-0000-0000-0000-0000000000e1','a5050000-0000-0000-0000-000000000001','Eng','a505-eng@example.com','Engineer','active'),
 ('a5050000-0000-0000-0000-0000000000b1','a5050000-0000-0000-0000-000000000002','B Admin','a505-b-admin@example.com','Admin','active'),
 ('a5050000-0000-0000-0000-0000000000c1','a5050000-0000-0000-0000-000000000003','C Admin','a505-c-admin@example.com','Admin','active'),
 ('a5050000-0000-0000-0000-0000000000d1','a5050000-0000-0000-0000-000000000004','D Admin','a505-d-admin@example.com','Admin','active'),
 ('a5050000-0000-0000-0000-0000000000e5','a5050000-0000-0000-0000-000000000005','E Admin','a505-e-admin@example.com','Admin','active'),
 ('a5050000-0000-0000-0000-0000000000d9','a5050000-0000-0000-0000-000000000001','Operator','a505-operator@example.com','Engineer','active'),
 ('a5050000-0000-0000-0000-0000000000a7','a5050000-0000-0000-0000-000000000007','G Admin','a505-g-admin@example.com','Admin','active');
insert into platform_operators (user_id) values ('a5050000-0000-0000-0000-0000000000d9');

-- A snapshot as discovery stores it: `later` holds the models a later slice needs (present and readable); the journal is an O1 model.
create temp table snap as select jsonb_build_object('capabilities', jsonb_build_object(
  'later', jsonb_build_object('purchase.order', true, 'purchase.order.line', true, 'stock.picking', true, 'stock.move', true,
                              'account.move', true, 'account.payment', true),
  'models', jsonb_build_object('account.journal', jsonb_build_object('exists', true, 'read', true)))) as full_cfg;
grant select on snap to public;
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
select v.org, 'odoo', 'https://odoo.example.test', v.ref, 'active', v.cfg, v.act
  from snap, lateral (values
    ('a5050000-0000-0000-0000-000000000001'::uuid, 'a505_a', snap.full_cfg, now()),
    ('a5050000-0000-0000-0000-000000000006'::uuid, 'a505_f', snap.full_cfg, now()),
    ('a5050000-0000-0000-0000-000000000004'::uuid, 'a505_d', snap.full_cfg, now()),
    ('a5050000-0000-0000-0000-000000000002'::uuid, 'a505_b', snap.full_cfg #- '{capabilities,later,account.payment}', now()),
    ('a5050000-0000-0000-0000-000000000003'::uuid, 'a505_c', snap.full_cfg, null::timestamptz)) as v(org, ref, cfg, act);
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5050000-0000-0000-0000-000000000004','erpnext','https://erp.example.test','a505_d_erp','active','{}', now());

-- AC-OPP-004 the role matrix, under each user's own JWT (every refusal first, in the actor's own organisation, so a broken
-- role gate would leave a row)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','employ')$$, '42501', null, 'AC-OPP-004 Finance cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','employ')$$, '42501', null, 'AC-OPP-004 an Executive cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','employ')$$, '42501', null, 'AC-OPP-004 a Project Manager cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','employ')$$, '42501', null, 'AC-OPP-004 an Engineer cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','employ')$$, '42501', null, 'AC-OPP-004 another organisation''s Admin cannot employ');
reset role;
select is((select count(*)::int from external_domain_ownership where org_id='a5050000-0000-0000-0000-000000000001'), 0, 'no refused call left an ownership row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','employ')$$, 'AC-OPP-004 the Admin employs procurement under odoo');
reset role;
select is((select count(*)::int from external_domain_ownership where org_id='a5050000-0000-0000-0000-000000000001' and external_tier='odoo' and domain='procurement'), 1,
  'AC-OPP-004 the ownership row exists');
select is((select count(*)::int from audit_events where action='integration.domain_ownership.employ' and org_id='a5050000-0000-0000-0000-000000000001'), 1,
  'AC-OPP-004 the employ is audited');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','release')$$, '42501', null, 'AC-OPP-004 Finance cannot release either');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5050000-0000-0000-0000-0000000000d9","role":"authenticated"}';
select lives_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000006','odoo','procurement','employ')$$, 'AC-OPP-004 a platform Operator employs for any organisation');
reset role;
select is((select count(*)::int from external_domain_ownership where org_id='a5050000-0000-0000-0000-000000000006'), 1, 'the Operator''s employ left its row');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- AC-OPP-004 when: an active ERPNext connection, no activation, a missing model
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000004','odoo','procurement','employ','a5050000-0000-0000-0000-0000000000d1')$$, 'P0001',
  'an ERPNext connection is active for this organization', 'AC-OPP-004 an organisation with an active ERPNext connection is refused');
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000003','odoo','procurement','employ','a5050000-0000-0000-0000-0000000000c1')$$, 'P0001',
  'Odoo connection is not activated', 'AC-OPP-004 an Odoo connection that is not activated is refused');
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000005','odoo','procurement','employ','a5050000-0000-0000-0000-0000000000e5')$$, 'P0001',
  'Odoo connection is not activated', 'AC-OPP-004 an organisation with no Odoo connection is refused');
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000002','odoo','procurement','employ','a5050000-0000-0000-0000-0000000000b1')$$, 'P0001',
  'Odoo is missing account.payment', 'AC-OPP-004 a snapshot without a required model is refused, naming it');
select is((select count(*)::int from external_domain_ownership where org_id in ('a5050000-0000-0000-0000-000000000002','a5050000-0000-0000-0000-000000000003','a5050000-0000-0000-0000-000000000004','a5050000-0000-0000-0000-000000000005')), 0,
  'no refused employ left an ownership row');

-- one ERP per domain: neither tier is employed over the other
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','erpnext','procurement','employ','a5050000-0000-0000-0000-0000000000a1')$$, 'P0001',
  'procurement is already employed on another ERP', 'one ERP per domain: ERPNext cannot be employed over Odoo');
reset role;
insert into external_domain_ownership (org_id, external_tier, domain, created_by) values ('a5050000-0000-0000-0000-000000000007','erpnext','procurement','a5050000-0000-0000-0000-0000000000a7');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
select 'a5050000-0000-0000-0000-000000000007'::uuid,'odoo','https://odoo.example.test','a505_g','active', full_cfg, now() from snap;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000007','odoo','procurement','employ','a5050000-0000-0000-0000-0000000000a7')$$, 'P0001',
  'procurement is already employed on another ERP', 'one ERP per domain: Odoo cannot be employed over ERPNext');

-- ERPNext and other tiers keep the shipped behaviour
select lives_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000005','erpnext','procurement','employ','a5050000-0000-0000-0000-0000000000e5')$$,
  'ERPNext procurement employ is unchanged (no extra precondition)');
select lives_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000005','odoo','timesheets','employ','a5050000-0000-0000-0000-0000000000e5')$$,
  'an Odoo domain with no guard of its own (timesheets) is unchanged');
select lives_ok($$select public.admin_change_domain_ownership('a5050000-0000-0000-0000-000000000001','odoo','procurement','release','a5050000-0000-0000-0000-0000000000a1')$$,
  'releasing procurement is unchanged');
select is((select count(*)::int from external_domain_ownership where org_id='a5050000-0000-0000-0000-000000000001'), 0, 'the release removed the ownership row');

-- AC-OPP-060 the outbox takes a tier-odoo row for every purchase kind and serializes it
select lives_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('a5050000-0000-0000-0000-000000000001','procurement','po-1','a5050000-0000-4000-8000-000000000001','odoo','create','pending','{"erp_doc_kind":"purchase-order"}'),
         ('a5050000-0000-0000-0000-000000000001','procurement','gr-1','a5050000-0000-4000-8000-000000000002','odoo','create','pending','{"erp_doc_kind":"goods-receipt"}'),
         ('a5050000-0000-0000-0000-000000000001','procurement','bill-1','a5050000-0000-4000-8000-000000000003','odoo','create','pending','{"erp_doc_kind":"purchase-invoice"}'),
         ('a5050000-0000-0000-0000-000000000001','procurement','pay-1','a5050000-0000-4000-8000-000000000004','odoo','create','pending','{"erp_doc_kind":"payment"}')$$,
  'AC-OPP-060 the outbox accepts tier odoo rows for order, receipt, bill and payment');
select throws_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('a5050000-0000-0000-0000-000000000001','procurement','pay-1','a5050000-0000-4000-8000-000000000009','odoo','create','pending')$$, '23505', null,
  'AC-OPP-060 a second command for the same record under another key is refused');
select throws_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('a5050000-0000-0000-0000-000000000001','procurement','pay-2','a5050000-0000-4000-8000-000000000004','odoo','create','pending')$$, '23505', null,
  'AC-OPP-060 an idempotency key is single-use');
-- two claims of one row: one wins
update external_command_outbox set payload = null where org_id='a5050000-0000-0000-0000-000000000001' and pmo_record_id='bill-1';
select is((select (public.claim_outbox_for_commit(id)).claim_generation from external_command_outbox where org_id='a5050000-0000-0000-0000-000000000001' and pmo_record_id='bill-1'), 1,
  'AC-OPP-060 the first claim of a tier odoo row wins');
select is((select (public.claim_outbox_for_commit(id)).claim_generation from external_command_outbox where org_id='a5050000-0000-0000-0000-000000000001' and pmo_record_id='bill-1'), null,
  'AC-OPP-060 the second claim of the same row gets nothing');

select * from finish();
rollback;
