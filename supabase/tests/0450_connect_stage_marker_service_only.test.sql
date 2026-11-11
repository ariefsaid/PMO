-- #1614 (migration 0450): the connect attempt's rotation marker is service-only. Stage records the prior
-- binding in its own column (no signed-in grant), never in the member-readable `config`; finalize, cleanup
-- and disconnect read and clear it there, for both the ClickUp and the Odoo connect paths.
begin;
select plan(25);

insert into organizations (id, name) values
 ('a4500000-0000-0000-0000-000000000001','Marker Odoo Org'),
 ('a4500000-0000-0000-0000-000000000002','Marker ClickUp Org');
insert into auth.users (id, email) values
 ('a4500000-0000-0000-0000-0000000000a1','a450-admin@example.com'),
 ('a4500000-0000-0000-0000-0000000000e1','a450-eng@example.com'),
 ('a4500000-0000-0000-0000-0000000000a2','a450-admin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a4500000-0000-0000-0000-0000000000a1','a4500000-0000-0000-0000-000000000001','Admin','a450-admin@example.com','Admin','active'),
 ('a4500000-0000-0000-0000-0000000000e1','a4500000-0000-0000-0000-000000000001','Engineer','a450-eng@example.com','Engineer','active'),
 ('a4500000-0000-0000-0000-0000000000a2','a4500000-0000-0000-0000-000000000002','Admin 2','a450-admin2@example.com','Admin','active');

-- The column exists and no client role can read it.
select has_column('public', 'external_org_bindings', 'prev_binding', 'FR-ODC-005 the rotation marker has its own column');
select is(has_column_privilege('authenticated', 'public.external_org_bindings', 'prev_binding', 'SELECT'), false,
  'FR-ODC-005 the rotation marker column is not readable by authenticated');
select is(has_column_privilege('anon', 'public.external_org_bindings', 'prev_binding', 'SELECT'), false,
  'FR-ODC-005 the rotation marker column is not readable by anon');

-- ── Odoo: a staged reconnect over an active binding ──────────────────────────────────────────────
set local role service_role;
select public.stage_vault_secret_for_org('a4500000-0000-0000-0000-000000000001','odoo','k1','a450_o1','a4500000-0000-0000-0000-0000000000a1');
select public.finalize_odoo_connect('a4500000-0000-0000-0000-000000000001','a450_o1','https://o.example.test','db1',null,false,true,'a4500000-0000-0000-0000-0000000000a1');
select public.stage_vault_secret_for_org('a4500000-0000-0000-0000-000000000001','odoo','k2','a450_o2','a4500000-0000-0000-0000-0000000000a1');
reset role;
select is((select prev_binding->>'secret_ref' || ':' || (prev_binding->>'status') from external_org_bindings
            where org_id='a4500000-0000-0000-0000-000000000001' and external_tier='odoo'), 'a450_o1:active',
  'FR-ODC-005 stage records the prior Odoo binding in the service-only column');
select is((select config ? 'prev_binding' from external_org_bindings
            where org_id='a4500000-0000-0000-0000-000000000001' and external_tier='odoo'), false,
  'FR-ODC-005 stage writes no rotation marker into config');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a4500000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select prev_binding from public.external_org_bindings$$, '42501', null,
  'AC-ODC-009 an Admin JWT cannot read the rotation marker during a staged attempt');
select is((select count(*)::int from public.external_org_bindings where external_tier='odoo' and config ? 'prev_binding'), 0,
  'AC-ODC-009 an Admin JWT reading config sees no rotation marker during a staged attempt');
set local request.jwt.claims = '{"sub":"a4500000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select prev_binding from public.external_org_bindings$$, '42501', null,
  'AC-ODC-009 an Engineer JWT cannot read the rotation marker');
select is((select count(*)::int from public.external_org_bindings where external_tier='odoo'), 1,
  'AC-ODC-009 the Engineer JWT still sees the org''s Odoo binding row');
reset role;

set local role service_role;
select is(public.finalize_odoo_connect('a4500000-0000-0000-0000-000000000001','a450_o2','https://o.example.test','db1',null,false,true,'a4500000-0000-0000-0000-0000000000a1'), 'active',
  'AC-ODC-006 the Odoo reconnect commits');
reset role;
select is((select count(*)::int from vault.secrets where name='a450_o1'), 0, 'AC-ODC-006 the commit revokes the key the marker named');
select is((select count(*)::int from vault.secrets where name='a450_o2'), 1, 'AC-ODC-006 the commit keeps the new key');
select ok((select prev_binding is null from external_org_bindings where org_id='a4500000-0000-0000-0000-000000000001' and external_tier='odoo'),
  'AC-ODC-006 the commit clears the rotation marker');

-- A stranded Odoo attempt: disconnect removes both keys and the marker.
set local role service_role;
select public.stage_vault_secret_for_org('a4500000-0000-0000-0000-000000000001','odoo','k3','a450_o3','a4500000-0000-0000-0000-0000000000a1');
select is(public.disconnect_external_integration('a4500000-0000-0000-0000-000000000001','odoo','a4500000-0000-0000-0000-0000000000a1'), 1,
  'AC-ODC-007 disconnect over a stranded Odoo attempt touches the binding');
reset role;
select is((select count(*)::int from vault.secrets where name in ('a450_o2','a450_o3')), 0,
  'AC-ODC-007 disconnect deletes the stranded attempt''s key and the key its marker named');
select ok((select prev_binding is null from external_org_bindings where org_id='a4500000-0000-0000-0000-000000000001' and external_tier='odoo'),
  'AC-ODC-007 disconnect clears the rotation marker');

-- ── ClickUp: the same marker on the ClickUp connect path ─────────────────────────────────────────
set local role service_role;
select public.stage_vault_secret_for_org('a4500000-0000-0000-0000-000000000002','clickup','c1','a450_c1','a4500000-0000-0000-0000-0000000000a2');
select public.finalize_external_connect('a4500000-0000-0000-0000-000000000002','clickup','a450_c1',true,true,'a4500000-0000-0000-0000-0000000000a2');
select public.stage_vault_secret_for_org('a4500000-0000-0000-0000-000000000002','clickup','c2','a450_c2','a4500000-0000-0000-0000-0000000000a2');
reset role;
select is((select prev_binding->>'secret_ref' || ':' || (config ? 'prev_binding')::text from external_org_bindings
            where org_id='a4500000-0000-0000-0000-000000000002' and external_tier='clickup'), 'a450_c1:false',
  'AC-653-1 a ClickUp stage records the prior binding in the service-only column, not config');
set local role service_role;
select public.cleanup_external_connect_attempt('a4500000-0000-0000-0000-000000000002','clickup','a450_c2','a4500000-0000-0000-0000-0000000000a2');
reset role;
select is((select secret_ref || ':' || status || ':' || (prev_binding is null)::text from external_org_bindings
            where org_id='a4500000-0000-0000-0000-000000000002' and external_tier='clickup'), 'a450_c1:active:true',
  'AC-653-2 cleanup restores the prior ClickUp binding from the marker and clears it');
select is((select count(*)::int from vault.secrets where name='a450_c2'), 0, 'AC-653-2 cleanup deletes the failed attempt''s key');
select is((select count(*)::int from vault.secrets where name='a450_c1'), 1, 'AC-653-2 cleanup keeps the prior key');

set local role service_role;
select public.stage_vault_secret_for_org('a4500000-0000-0000-0000-000000000002','clickup','c3','a450_c3','a4500000-0000-0000-0000-0000000000a2');
select is(public.finalize_external_connect('a4500000-0000-0000-0000-000000000002','clickup','a450_c3',true,true,'a4500000-0000-0000-0000-0000000000a2'), 'active',
  'AC-653-3 a ClickUp rotation commits');
reset role;
select is((select count(*)::int from vault.secrets where name='a450_c1'), 0, 'AC-653-3 the ClickUp commit revokes the key the marker named');
select ok((select prev_binding is null and secret_ref = 'a450_c3' from external_org_bindings
            where org_id='a4500000-0000-0000-0000-000000000002' and external_tier='clickup'),
  'AC-653-3 the ClickUp commit clears the marker and keeps the new key');

-- A stranded ClickUp attempt: disconnect removes both keys and the marker.
set local role service_role;
select public.stage_vault_secret_for_org('a4500000-0000-0000-0000-000000000002','clickup','c4','a450_c4','a4500000-0000-0000-0000-0000000000a2');
select public.disconnect_external_integration('a4500000-0000-0000-0000-000000000002','clickup','a4500000-0000-0000-0000-0000000000a2');
reset role;
select is((select count(*)::int from vault.secrets where name in ('a450_c3','a450_c4')), 0,
  'AC-653-7 disconnect over a stranded ClickUp attempt deletes both keys');
select ok((select prev_binding is null and status = 'disconnected' from external_org_bindings
            where org_id='a4500000-0000-0000-0000-000000000002' and external_tier='clickup'),
  'AC-653-7 disconnect clears the ClickUp marker');

select * from finish();
rollback;
