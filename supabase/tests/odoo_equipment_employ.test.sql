-- Employing `equipment` under Odoo (#1511 F2, migration 0852): the database refuses unless the stored capability snapshot
-- shows every fleet and maintenance model present, readable and (for the four writable ones + the anchor) writable.
begin;
select plan(11);

insert into organizations (id, name) values ('15110000-0000-0000-0000-000000000011','Equipment Employ');
insert into auth.users (id, email) values
 ('15110000-0000-0000-0000-0000000000a1','e1511-admin@example.com'),
 ('15110000-0000-0000-0000-0000000000a2','e1511-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('15110000-0000-0000-0000-0000000000a1','15110000-0000-0000-0000-000000000011','Admin','e1511-admin@example.com','Admin','active'),
 ('15110000-0000-0000-0000-0000000000a2','15110000-0000-0000-0000-000000000011','PM','e1511-pm@example.com','Project Manager','active');

-- The snapshot as discovery stores it: every model present and readable, the writable ones creatable and writable.
create temp table snap as select jsonb_build_object('capabilities', jsonb_build_object('assets', (
  select jsonb_object_agg(m, jsonb_build_object('exists', true, 'read', true, 'create', true, 'write', true, 'unlink', false, 'fields_missing', '[]'::jsonb))
    from unnest(array['fleet.vehicle','fleet.vehicle.model','maintenance.equipment','maintenance.request','maintenance.stage',
                      'fleet.vehicle.log.services','fleet.service.type','ir.model.data']) m))) as full_cfg;
grant select on snap to public;
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
select '15110000-0000-0000-0000-000000000011', 'odoo', 'https://odoo.example.test', 'e1511_emp', 'active', snap.full_cfg, now() from snap;

set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000011','odoo','equipment','employ')$$, '42501', null, 'AC-OFM-001 a Project Manager cannot employ');

set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000011','erpnext','equipment','employ')$$, 'P0001',
  'The equipment register is available with Odoo only', 'AC-OFM-002 employing equipment under ERPNext is refused');
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000011','other','equipment','employ')$$, 'P0001',
  'The equipment register is available with Odoo only', 'AC-OFM-002 employing equipment under any other tier is refused');
select lives_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000011','odoo','equipment','employ')$$, 'AC-OFM-001 the Admin employs equipment with a full snapshot');
reset role;
select is((select count(*)::int from external_domain_ownership where org_id = '15110000-0000-0000-0000-000000000011' and domain = 'equipment' and external_tier = 'odoo'), 1, 'AC-OFM-001 the ownership row exists');
select is((select count(*)::int from audit_events where org_id = '15110000-0000-0000-0000-000000000011' and action = 'integration.domain_ownership.employ'), 1, 'AC-OFM-001 one employ audit row');
select is(public.org_employs_odoo_equipment('15110000-0000-0000-0000-000000000011'), true, 'the sweep gate reads true once employed');

delete from external_domain_ownership where org_id = '15110000-0000-0000-0000-000000000011';
update external_org_bindings set config = config #- '{capabilities,assets,maintenance.request,create}' where org_id = '15110000-0000-0000-0000-000000000011' and external_tier = 'odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000011','odoo','equipment','employ')$$, 'P0001',
  'Odoo is missing maintenance.request:create', 'AC-OFM-001 the refusal names the model and the missing permission');
reset role;
update external_org_bindings set config = '{}'::jsonb where org_id = '15110000-0000-0000-0000-000000000011' and external_tier = 'odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000011','odoo','equipment','employ')$$, 'P0001',
  'Odoo is missing fleet.vehicle', 'AC-OFM-001 an old snapshot with no asset block fails closed');
reset role;
update external_org_bindings set config = (select full_cfg from snap) where org_id = '15110000-0000-0000-0000-000000000011' and external_tier = 'odoo';
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at)
 values ('15110000-0000-0000-0000-000000000011','erpnext','https://erp.example.test','e1511_erp','active','{}', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"15110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.admin_change_domain_ownership('15110000-0000-0000-0000-000000000011','odoo','equipment','employ')$$, 'P0001',
  'an ERPNext connection is active for this organization', 'AC-OFM-001 an active ERPNext connection blocks the employ');
reset role;
select is(public.org_employs_odoo_equipment('15110000-0000-0000-0000-000000000011'), false, 'the sweep gate reads false when nothing is employed');

select * from finish();
rollback;
