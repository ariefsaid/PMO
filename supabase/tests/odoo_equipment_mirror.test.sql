-- Odoo fleet and maintenance mirror (#1511 F2, migration 0851): the row writer, the asset name/archive propagation, the census.
begin;
select plan(20);

insert into organizations (id, name) values
 ('15110000-0000-0000-0000-000000000001','Equipment Mirror A'),
 ('15110000-0000-0000-0000-000000000002','Equipment Mirror B');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('15110000-0000-0000-0000-000000000001','odoo','https://o.example.test','e1511_a','active','{"odoo_company_id":1}', now()),
 ('15110000-0000-0000-0000-000000000002','odoo','https://o.example.test','e1511_b','active','{"odoo_company_id":1}', now());
insert into equipment_assets (id, org_id, code, name, external_tier, external_ref) values
 ('15110000-0000-0000-0000-0000000000d1','15110000-0000-0000-0000-000000000001','EXC-001','Old name','odoo','equipment:42'),
 ('15110000-0000-0000-0000-0000000000d2','15110000-0000-0000-0000-000000000001','EXC-002','Second','odoo','equipment:43'),
 ('15110000-0000-0000-0000-0000000000d3','15110000-0000-0000-0000-000000000002','EXC-001','Other org','odoo','equipment:42');

set local role service_role;
select is(public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','equipment',
  '[{"external_id":"42","code":"EXC-001","name":"Excavator 20t","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"},
    {"external_id":"43","code":"EXC-002","name":"Second","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"}]'), 2,
  'AC-OFM-012 the row writer applies a page');
select is((select name from equipment_assets where id = '15110000-0000-0000-0000-0000000000d1'), 'Excavator 20t', 'AC-OFM-012 the linked PMO asset takes Odoo''s name');
select is((select code from equipment_assets where id = '15110000-0000-0000-0000-0000000000d1'), 'EXC-001', 'AC-OFM-012 the PMO code never changes');
select is((select name from equipment_assets where id = '15110000-0000-0000-0000-0000000000d3'), 'Other org', 'AC-OFM-012 another org''s asset with the same reference is untouched');

select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','equipment',
  '[{"external_id":"42","code":"EXC-001","name":"Stale","active":true,"attrs":{},"source_write_date":"2026-11-08 08:00:00"}]');
select is((select name from equipment_assets where id = '15110000-0000-0000-0000-0000000000d1'), 'Excavator 20t', 'AC-OFM-012 an older page changes nothing');

select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','equipment',
  '[{"external_id":"42","code":"EXC-001","name":"Excavator 20t","active":false,"attrs":{},"source_write_date":"2026-11-10 08:00:00"}]');
select isnt((select archived_at from equipment_assets where id = '15110000-0000-0000-0000-0000000000d1'), null, 'AC-OFM-012 archived in Odoo archives the PMO asset');
select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','equipment',
  '[{"external_id":"42","code":"EXC-001","name":"Excavator 20t","active":true,"attrs":{},"source_write_date":"2026-11-11 08:00:00"}]');
select isnt((select archived_at from equipment_assets where id = '15110000-0000-0000-0000-0000000000d1'), null, 'AC-OFM-012 a restore in Odoo does not unarchive (one way)');

select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','maintenance_request',
  '[{"external_id":"7","name":"Hydraulic leak","parent_external_id":"42","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00","pmo_id":"15110000-0000-0000-0000-0000000000e1"}]');
select is((select id from external_master_records where kind = 'maintenance_request' and external_id = '7'), '15110000-0000-0000-0000-0000000000e1'::uuid, 'AC-OFM-030 a row carrying the PMO id inserts with it');
select throws_ok($$select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','maintenance_request',
  '[{"external_id":"8","name":"x","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00","pmo_id":"not-a-uuid"}]')$$, '22023', null, 'AC-OFM-030 a malformed PMO id is refused');

-- A blank Odoo name keeps the PMO name; the page still applies (it must not abort the sweep tick).
select lives_ok($$select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','equipment',
  '[{"external_id":"43","code":"EXC-002","name":"   ","active":true,"attrs":{},"source_write_date":"2026-11-09 09:00:00"}]')$$, 'AC-OFM-012 a blank Odoo name does not abort the page');
select is((select name from equipment_assets where id = '15110000-0000-0000-0000-0000000000d2'), 'Second', 'AC-OFM-012 a blank Odoo name keeps the PMO asset name');

-- A PMO id that collides (another row, or twice in one page) or is null falls back to a fresh id instead of aborting.
select lives_ok($$select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','maintenance_request',
  '[{"external_id":"9","name":"c1","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00","pmo_id":"15110000-0000-0000-0000-0000000000e1"},
    {"external_id":"10","name":"c2","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00","pmo_id":"15110000-0000-0000-0000-0000000000e2"},
    {"external_id":"11","name":"c3","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00","pmo_id":"15110000-0000-0000-0000-0000000000e2"},
    {"external_id":"12","name":"n","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00","pmo_id":null}]')$$, 'AC-OFM-030 a colliding or null PMO id does not abort the page');
select is((select count(*)::int from external_master_records where kind = 'maintenance_request' and external_id in ('9','10','11','12')), 4, 'AC-OFM-030 every row of the page lands');
select is((select id from external_master_records where kind = 'maintenance_request' and external_id = '10'), '15110000-0000-0000-0000-0000000000e2'::uuid, 'AC-OFM-030 the first claimant of a PMO id keeps it');
select is((select id from external_master_records where kind = 'maintenance_request' and external_id = '7'), '15110000-0000-0000-0000-0000000000e1'::uuid, 'AC-OFM-030 an existing row keeps its id');

select public.apply_odoo_master_page('15110000-0000-0000-0000-000000000001','equipment','[]','cur-1');
select is((select watermark_cursor from external_sync_watermarks where org_id = '15110000-0000-0000-0000-000000000001' and domain = 'master:equipment'), 'cur-1', 'AC-OFM-010 the page writer still moves the cursor');

select public.mark_odoo_census_seen('15110000-0000-0000-0000-000000000001','equipment','2026-11-12 00:00:00+00', array['42']);
select public.finish_odoo_census('15110000-0000-0000-0000-000000000001','equipment','2026-11-12 00:00:00+00','cur-2');
select isnt((select tombstoned_at from external_master_records where kind = 'equipment' and external_id = '43'), null, 'AC-OFM-010 what the census no longer sees is tombstoned');
select isnt((select archived_at from equipment_assets where id = '15110000-0000-0000-0000-0000000000d2'), null, 'AC-OFM-012 a record removed from Odoo archives its PMO asset');

select throws_ok($$select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','bogus','[]')$$, '22023', null, 'AC-OFM-010 an unknown kind is refused');
reset role;
set local role authenticated;
select throws_ok($$select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','equipment','[]')$$, '42501', null, 'AC-OFM-010 a user JWT cannot call the row writer');

select * from finish();
rollback;
