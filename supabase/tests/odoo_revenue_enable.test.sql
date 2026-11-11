-- #1506 O3 C2 (migration 0510): `revenue` becomes an employable domain for tier `odoo`.
-- AC-OCI-004 (who may employ it, and when), AC-OCI-001 (what the stored snapshot must show), AC-OCI-002 (P half: the shipped
-- take-over guard refuses for tier odoo too, with the count), AC-OCI-060 (the outbox serializes tier-odoo revenue rows as it does ERPNext's).
-- Every refusal in the role matrix runs first, in the actor's own organisation, so a broken role gate would leave an ownership row.
begin;
select plan(31);

insert into organizations (id, name) values
 ('a5100000-0000-0000-0000-000000000001','Rev A full'),
 ('a5100000-0000-0000-0000-000000000002','Rev B no payment model'),
 ('a5100000-0000-0000-0000-000000000003','Rev C not activated'),
 ('a5100000-0000-0000-0000-000000000004','Rev D has ERPNext'),
 ('a5100000-0000-0000-0000-000000000005','Rev E no binding'),
 ('a5100000-0000-0000-0000-000000000006','Rev F full, operator target'),
 ('a5100000-0000-0000-0000-000000000007','Rev G owned by ERPNext'),
 ('a5100000-0000-0000-0000-000000000008','Rev H no tax directory'),
 ('a5100000-0000-0000-0000-000000000009','Rev I no line model'),
 ('a5100000-0000-0000-0000-000000000010','Rev J drafts open');
insert into auth.users (id, email) values
 ('a5100000-0000-0000-0000-0000000000a1','a510-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000f1','a510-finance@example.com'),
 ('a5100000-0000-0000-0000-0000000000e2','a510-exec@example.com'),
 ('a5100000-0000-0000-0000-0000000000a2','a510-pm@example.com'),
 ('a5100000-0000-0000-0000-0000000000e1','a510-eng@example.com'),
 ('a5100000-0000-0000-0000-0000000000b1','a510-b-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000c1','a510-c-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000d1','a510-d-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000e5','a510-e-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000d9','a510-operator@example.com'),
 ('a5100000-0000-0000-0000-0000000000a7','a510-g-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000a8','a510-h-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000a9','a510-i-admin@example.com'),
 ('a5100000-0000-0000-0000-0000000000aa','a510-j-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5100000-0000-0000-0000-0000000000a1','a5100000-0000-0000-0000-000000000001','Admin','a510-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000f1','a5100000-0000-0000-0000-000000000001','Finance','a510-finance@example.com','Finance','active'),
 ('a5100000-0000-0000-0000-0000000000e2','a5100000-0000-0000-0000-000000000001','Exec','a510-exec@example.com','Executive','active'),
 ('a5100000-0000-0000-0000-0000000000a2','a5100000-0000-0000-0000-000000000001','PM','a510-pm@example.com','Project Manager','active'),
 ('a5100000-0000-0000-0000-0000000000e1','a5100000-0000-0000-0000-000000000001','Eng','a510-eng@example.com','Engineer','active'),
 ('a5100000-0000-0000-0000-0000000000b1','a5100000-0000-0000-0000-000000000002','B Admin','a510-b-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000c1','a5100000-0000-0000-0000-000000000003','C Admin','a510-c-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000d1','a5100000-0000-0000-0000-000000000004','D Admin','a510-d-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000e5','a5100000-0000-0000-0000-000000000005','E Admin','a510-e-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000d9','a5100000-0000-0000-0000-000000000001','Operator','a510-operator@example.com','Engineer','active'),
 ('a5100000-0000-0000-0000-0000000000a7','a5100000-0000-0000-0000-000000000007','G Admin','a510-g-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000a8','a5100000-0000-0000-0000-000000000008','H Admin','a510-h-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000a9','a5100000-0000-0000-0000-000000000009','I Admin','a510-i-admin@example.com','Admin','active'),
 ('a5100000-0000-0000-0000-0000000000aa','a5100000-0000-0000-0000-000000000010','J Admin','a510-j-admin@example.com','Admin','active');
insert into platform_operators (user_id) values ('a5100000-0000-0000-0000-0000000000d9');

-- A snapshot as discovery stores it: `later` holds the models a later slice needs (present and readable); journal, tax and account are O1 models.
create temp table snap as select jsonb_build_object('capabilities', jsonb_build_object(
  'later', jsonb_build_object('account.move', true, 'account.move.line', true, 'account.payment', true),
  'models', jsonb_build_object('account.journal', jsonb_build_object('exists', true, 'read', true),
                               'account.tax', jsonb_build_object('exists', true, 'read', true),
                               'account.account', jsonb_build_object('exists', true, 'read', true)))) as full_cfg;
grant select on snap to public;
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
select v.org, 'odoo', 'https://odoo.example.test', v.ref, 'active', v.cfg, v.act
  from snap, lateral (values
    ('a5100000-0000-0000-0000-000000000001'::uuid, 'a510_a', snap.full_cfg, now()),
    ('a5100000-0000-0000-0000-000000000006'::uuid, 'a510_f', snap.full_cfg, now()),
    ('a5100000-0000-0000-0000-000000000004'::uuid, 'a510_d', snap.full_cfg, now()),
    ('a5100000-0000-0000-0000-000000000010'::uuid, 'a510_j', snap.full_cfg, now()),
    ('a5100000-0000-0000-0000-000000000002'::uuid, 'a510_b', snap.full_cfg #- '{capabilities,later,account.payment}', now()),
    ('a5100000-0000-0000-0000-000000000009'::uuid, 'a510_i', snap.full_cfg #- '{capabilities,later,account.move.line}', now()),
    ('a5100000-0000-0000-0000-000000000008'::uuid, 'a510_h', snap.full_cfg #- '{capabilities,models,account.tax}', now()),
    ('a5100000-0000-0000-0000-000000000003'::uuid, 'a510_c', snap.full_cfg, null::timestamptz)) as v(org, ref, cfg, act);
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5100000-0000-0000-0000-000000000004','erpnext','https://erp.example.test','a510_d_erp','active','{}', now());

-- AC-OCI-004 the role matrix, under each user's own JWT
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','employ')$$, '42501', null, 'AC-OCI-004 Finance cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','employ')$$, '42501', null, 'AC-OCI-004 an Executive cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','employ')$$, '42501', null, 'AC-OCI-004 a Project Manager cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','employ')$$, '42501', null, 'AC-OCI-004 an Engineer cannot employ');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','employ')$$, '42501', null, 'AC-OCI-004 another organisation''s Admin cannot employ');
reset role;
select is((select count(*)::int from external_domain_ownership where org_id='a5100000-0000-0000-0000-000000000001'), 0, 'AC-OCI-004 no refused call left an ownership row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','employ')$$, 'AC-OCI-004 the Admin employs revenue under odoo');
reset role;
select is((select count(*)::int from external_domain_ownership where org_id='a5100000-0000-0000-0000-000000000001' and external_tier='odoo' and domain='revenue'), 1,
  'AC-OCI-004 the ownership row exists');
select is((select count(*)::int from audit_events where action='integration.domain_ownership.employ' and org_id='a5100000-0000-0000-0000-000000000001'), 1,
  'AC-OCI-004 the employ is audited');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','release')$$, '42501', null, 'AC-OCI-004 Finance cannot release either');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5100000-0000-0000-0000-0000000000d9","role":"authenticated"}';
select lives_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000006','odoo','revenue','employ')$$, 'AC-OCI-004 a platform Operator employs for any organisation');
reset role;
select is((select count(*)::int from external_domain_ownership where org_id='a5100000-0000-0000-0000-000000000006'), 1, 'AC-OCI-004 the Operator''s employ left its row');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- AC-OCI-004 / AC-OCI-001 when: an active ERPNext connection, no activation, a missing model (each named)
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000004','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000d1')$$, 'P0001',
  'an ERPNext connection is active for this organization', 'AC-OCI-004 an organisation with an active ERPNext connection is refused');
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000003','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000c1')$$, 'P0001',
  'Odoo connection is not activated', 'AC-OCI-001 an Odoo connection that is not activated is refused');
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000005','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000e5')$$, 'P0001',
  'Odoo connection is not activated', 'AC-OCI-001 an organisation with no Odoo connection is refused');
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000002','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000b1')$$, 'P0001',
  'Odoo is missing account.payment', 'AC-OCI-001 a snapshot without account.payment is refused, naming it');
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000009','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000a9')$$, 'P0001',
  'Odoo is missing account.move.line', 'AC-OCI-001 a snapshot without account.move.line is refused, naming it');
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000008','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000a8')$$, 'P0001',
  'Odoo is missing account.tax', 'AC-OCI-001 a snapshot without the tax directory is refused, naming it');
select is((select count(*)::int from external_domain_ownership where org_id in ('a5100000-0000-0000-0000-000000000002','a5100000-0000-0000-0000-000000000003','a5100000-0000-0000-0000-000000000004','a5100000-0000-0000-0000-000000000005','a5100000-0000-0000-0000-000000000008','a5100000-0000-0000-0000-000000000009')), 0,
  'AC-OCI-001 no refused employ left an ownership row');

-- AC-OCI-002 (P half) PMO drafts that the flip would strand refuse the employ, with their count (the shipped guard, now proven for tier odoo)
reset role;
insert into sales_invoices (org_id, status, pmo_native, native_lines, amount, tax_treatment, tax_amount) values
 ('a5100000-0000-0000-0000-000000000010','Draft',true,'[]'::jsonb,100,'exclusive',0), ('a5100000-0000-0000-0000-000000000010','Draft',true,'[]'::jsonb,200,'exclusive',0), ('a5100000-0000-0000-0000-000000000010','Unpaid',true,'[]'::jsonb,300,'exclusive',0);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000010','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000aa')$$, 'P0001',
  'approve or cancel the 2 draft invoice(s) raised in PMO before the ERP takes over customer invoicing', 'AC-OCI-002 two PMO drafts refuse the employ with their count');
select is((select count(*)::int from external_domain_ownership where org_id='a5100000-0000-0000-0000-000000000010'), 0, 'AC-OCI-002 the refused employ left no ownership row');

-- one ERP per domain: neither tier is employed over the other
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','erpnext','revenue','employ','a5100000-0000-0000-0000-0000000000a1')$$, 'P0001',
  'revenue is already employed on another ERP', 'AC-OCI-001 one ERP per domain: ERPNext cannot be employed over Odoo');
reset role;
insert into external_domain_ownership (org_id, external_tier, domain, created_by) values ('a5100000-0000-0000-0000-000000000007','erpnext','revenue','a5100000-0000-0000-0000-0000000000a7');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
select 'a5100000-0000-0000-0000-000000000007'::uuid,'odoo','https://odoo.example.test','a510_g','active', full_cfg, now() from snap;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000007','odoo','revenue','employ','a5100000-0000-0000-0000-0000000000a7')$$, 'P0001',
  'revenue is already employed on another ERP', 'AC-OCI-001 one ERP per domain: Odoo cannot be employed over ERPNext');

-- ERPNext and other tiers and domains keep the shipped behaviour
select lives_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000005','erpnext','revenue','employ','a5100000-0000-0000-0000-0000000000e5')$$,
  'ERPNext revenue employ is unchanged (no extra precondition)');
select lives_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000005','odoo','timesheets','employ','a5100000-0000-0000-0000-0000000000e5')$$,
  'an Odoo domain other than procurement and revenue is unchanged');
select lives_ok($$select public.admin_change_domain_ownership('a5100000-0000-0000-0000-000000000001','odoo','revenue','release','a5100000-0000-0000-0000-0000000000a1')$$,
  'releasing revenue is unchanged');
select is((select count(*)::int from external_domain_ownership where org_id='a5100000-0000-0000-0000-000000000001'), 0, 'the release removed the ownership row');

-- AC-OCI-060 the outbox takes a tier-odoo row for both revenue kinds and serializes it
select lives_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload)
  values ('a5100000-0000-0000-0000-000000000001','revenue','si-1','a5100000-0000-4000-8000-000000000001','odoo','create','pending','{"erp_doc_kind":"sales-invoice"}'),
         ('a5100000-0000-0000-0000-000000000001','revenue','ip-1','a5100000-0000-4000-8000-000000000002','odoo','create','pending','{"erp_doc_kind":"incoming-payment"}')$$,
  'AC-OCI-060 the outbox accepts tier odoo rows for the invoice and the receipt');
select throws_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('a5100000-0000-0000-0000-000000000001','revenue','si-1','a5100000-0000-4000-8000-000000000009','odoo','create','pending')$$, '23505', null,
  'AC-OCI-060 a second command for the same record under another key is refused');
update external_command_outbox set payload = null where org_id='a5100000-0000-0000-0000-000000000001' and pmo_record_id='si-1';
select is((select (public.claim_outbox_for_commit(id)).claim_generation from external_command_outbox where org_id='a5100000-0000-0000-0000-000000000001' and pmo_record_id='si-1'), 1,
  'AC-OCI-060 the first claim of a tier odoo revenue row wins');
select is((select (public.claim_outbox_for_commit(id)).claim_generation from external_command_outbox where org_id='a5100000-0000-0000-0000-000000000001' and pmo_record_id='si-1'), null,
  'AC-OCI-060 the second claim of the same row gets nothing');

select * from finish();
rollback;
