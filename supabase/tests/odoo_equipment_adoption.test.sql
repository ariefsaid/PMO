-- Odoo fleet and maintenance adoption (#1511 F3, migration 0854): the match proposal an Admin reviews, the one-transaction
-- accept RPC, the recorder that a confirmed Odoo create calls, and the guard that keeps the PMO asset book out of reach
-- while Odoo owns the register (D8/D9, FR-OFM-020..022).
begin;
select plan(32);

insert into organizations (id, name) values
 ('15110000-0000-0000-0000-000000000001','Equipment Adoption A'),
 ('15110000-0000-0000-0000-000000000002','Equipment Adoption B');
insert into auth.users (id, email) values
 ('15110000-0000-0000-0000-0000000000a1','e1511-adopt-admin@example.com'),
 ('15110000-0000-0000-0000-0000000000a3','e1511-adopt-pm@example.com'),
 ('15110000-0000-0000-0000-0000000000a6','e1511-adopt-eng@example.com'),
 ('15110000-0000-0000-0000-0000000000b1','e1511-adopt-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('15110000-0000-0000-0000-0000000000a1','15110000-0000-0000-0000-000000000001','Admin','e1511-adopt-admin@example.com','Admin','active'),
 ('15110000-0000-0000-0000-0000000000a3','15110000-0000-0000-0000-000000000001','PM','e1511-adopt-pm@example.com','Project Manager','active'),
 ('15110000-0000-0000-0000-0000000000a6','15110000-0000-0000-0000-000000000001','Eng','e1511-adopt-eng@example.com','Engineer','active'),
 ('15110000-0000-0000-0000-0000000000b1','15110000-0000-0000-0000-000000000002','Admin B','e1511-adopt-xorg@example.com','Admin','active');
-- Both orgs employ `equipment` under Odoo (D9's precondition) and have an activated connection (the row writer asserts it).
insert into external_domain_ownership (org_id, external_tier, domain) values
 ('15110000-0000-0000-0000-000000000001','odoo','equipment'),
 ('15110000-0000-0000-0000-000000000002','odoo','equipment');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('15110000-0000-0000-0000-000000000001','odoo','https://o.example.test','e1511_adopt_a','active','{"odoo_company_id":1}', now()),
 ('15110000-0000-0000-0000-000000000002','odoo','https://o.example.test','e1511_adopt_b','active','{"odoo_company_id":1}', now());

-- The thin PMO asset book an Admin built by hand: EXC-001 and TIE-1 will match, GEN-01 will not.
insert into equipment_assets (id, org_id, code, name, default_unit) values
 ('15110000-0000-0000-0000-0000000000d1','15110000-0000-0000-0000-000000000001','EXC-001','Excavator twenty tonne','hours'),
 ('15110000-0000-0000-0000-0000000000d2','15110000-0000-0000-0000-000000000001','GEN-01','Generator 100 kVA','hours'),
 ('15110000-0000-0000-0000-0000000000d3','15110000-0000-0000-0000-000000000001','TIE-1','Compressor (ambiguous code)','days');
-- Another org's asset book: an Admin who is sent one of these ids must be refused (never link across orgs).
insert into equipment_assets (id, org_id, code, name, default_unit) values
 ('15110000-0000-0000-0000-0000000000e1','15110000-0000-0000-0000-000000000002','B-EXC','Org B excavator','hours');

-- The mirrored Odoo register, written the way the sweep writes it (service role).
set local role service_role;
select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','equipment',
  '[{"external_id":"42","code":"exc-001 ","name":"Excavator 20t","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"},
    {"external_id":"43","code":null,"name":"Generator 5kVA","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"},
    {"external_id":"44","code":"TIE-1","name":"Compressor two","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"}]');
select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000001','vehicle',
  '[{"external_id":"7","code":"B 1234 XY","name":"Hilux","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"},
    {"external_id":"8","code":"tie-1","name":"Truck A","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"}]');
-- Another org's register. equipment:42 exists there too; equipment:77 only there — the accept RPC must refuse it here.
select public.apply_odoo_master_rows('15110000-0000-0000-0000-000000000002','equipment',
  '[{"external_id":"42","code":"B-42","name":"Other org machine","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"},
    {"external_id":"77","code":"B-ONLY","name":"Org B rig","active":true,"attrs":{},"source_write_date":"2026-11-09 08:00:00"}]');
reset role;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.rows(p_sql text) returns int language plpgsql as $$
declare n int; begin execute p_sql; get diagnostics n = row_count; return n; end $$;

-- ── AC-OFM-020: the proposal read (Admin A1 reviews it; every member may read the two tables it joins) ─────────────
set local role authenticated;
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a1');
select is((select action from public.list_equipment_asset_matches() where ref = 'equipment:42'), 'link',
  'AC-OFM-020 a trimmed, case-insensitive code match is proposed as a link');
select ok((select asset_id = '15110000-0000-0000-0000-0000000000d1' and reason = 'same-code'
             from public.list_equipment_asset_matches() where ref = 'equipment:42'),
  'AC-OFM-020 the proposal names the one live PMO asset with that code');
select ok((select action = 'add' and reason = 'no-code' from public.list_equipment_asset_matches() where ref = 'equipment:43'),
  'AC-OFM-020 an Odoo equipment item with no serial is proposed as a new PMO asset');
select ok((select action = 'add' and reason = 'two-codes' from public.list_equipment_asset_matches() where ref = 'vehicle:8'),
  'AC-OFM-020 a code shared by two Odoo assets is proposed as new, never linked (one of the pair)');
select ok((select action = 'add' and reason = 'two-codes' from public.list_equipment_asset_matches() where ref = 'equipment:44'),
  'AC-OFM-020 a code shared by two Odoo assets is proposed as new, never linked (the other of the pair)');
select ok((select action = 'add' and reason = 'no-code' from public.list_equipment_asset_matches() where ref = 'vehicle:7'),
  'AC-OFM-020 a plate no PMO asset carries is proposed as a new asset');
select ok((select count(*) = 5 from public.list_equipment_asset_matches())
          and (select odoo_name = 'Excavator 20t' from public.list_equipment_asset_matches() where ref = 'equipment:42'),
  'AC-OFM-020 the proposal holds the caller''s org only');

-- ── AC-OFM-021: one transaction applies every accepted pair ──────────────────────────────────────────────────────
select is(public.accept_equipment_asset_matches(
    '[{"ref":"equipment:42","action":"link","asset_id":"15110000-0000-0000-0000-0000000000d1"},
      {"ref":"equipment:43","action":"add","default_unit":"hours"}]'),
  '{"linked":1,"added":1}'::jsonb, 'AC-OFM-021 the accepted batch reports one link and one new asset');
reset role;
select ok((select external_tier = 'odoo' and external_ref = 'equipment:42' from equipment_assets
            where id = '15110000-0000-0000-0000-0000000000d1'),
  'AC-OFM-021 the accepted pair links the existing PMO asset to its Odoo record');
select ok((select code = 'ODOO-E43' and name = 'Generator 5kVA' and external_tier = 'odoo' and external_ref = 'equipment:43'
             from equipment_assets where org_id = '15110000-0000-0000-0000-000000000001' and external_ref = 'equipment:43'),
  'AC-OFM-021 an accepted new asset takes a made-up code and Odoo''s name');
select ok((select count(*) = 1 and min((detail->>'linked')::int) = 1 and min((detail->>'added')::int) = 1
             from audit_events where org_id = '15110000-0000-0000-0000-000000000001' and action = 'equipment.register.matched'),
  'AC-OFM-021 one audit row records the batch and its counts');

set local role authenticated;
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.accept_equipment_asset_matches(
    '[{"ref":"equipment:42","action":"link","asset_id":"15110000-0000-0000-0000-0000000000d1"}]')$$, '23505', null,
  'AC-OFM-021 an already-linked PMO asset is refused');
reset role;
select is((select count(*)::int from equipment_assets where org_id = '15110000-0000-0000-0000-000000000001'), 4,
  'AC-OFM-021 a refused batch applies nothing (one transaction)');
set local role authenticated;
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.accept_equipment_asset_matches('[{"ref":"equipment:77","action":"add"}]')$$, 'P0002', null,
  'AC-OFM-021 an Odoo asset from another org is refused');
select throws_ok($$select public.accept_equipment_asset_matches(
    '[{"ref":"vehicle:8","action":"link","asset_id":"15110000-0000-0000-0000-0000000000e1"}]')$$, 'P0002', null,
  'AC-OFM-021 a PMO asset from another org is refused');
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.accept_equipment_asset_matches('[]')$$, '42501', null,
  'AC-OFM-021 a Project Manager cannot accept matches');
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.accept_equipment_asset_matches('[{"ref":"vehicle:7","action":"add","default_unit":"hours"}]')$$,
  'AC-OFM-021 a vehicle is added from the register');
select ok((select code = 'B 1234 XY' and name = 'Hilux' and external_ref = 'vehicle:7' from equipment_assets
            where external_ref = 'vehicle:7'),
  'AC-OFM-021 the vehicle''s plate becomes its PMO code');
select throws_ok($$select public.accept_equipment_asset_matches('[{"ref":"partner:9","action":"add"}]')$$, '22023', null,
  'AC-OFM-021 a reference that is not a vehicle or equipment id is refused');

-- ── AC-OFM-022: while Odoo owns the register, nobody hand-edits the PMO asset book ───────────────────────────────
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a3');
select throws_ok($$insert into equipment_assets (code, name) values ('X','X')$$, '42501', null,
  'AC-OFM-022 a Project Manager cannot insert an asset while Odoo owns the register');
select is(pg_temp.rows($$update equipment_assets set name = 'Renamed by hand'
                        where id = '15110000-0000-0000-0000-0000000000d1'$$), 0,
  'AC-OFM-022 a Project Manager''s rename touches no row');
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a1');
select is(pg_temp.rows($$delete from equipment_assets where id = '15110000-0000-0000-0000-0000000000d2'$$), 0,
  'AC-OFM-022 even an Admin cannot delete an asset while Odoo owns the register');
reset role;
select ok((select count(*) = 1 and min(name) = 'Generator 100 kVA' from equipment_assets
            where id = '15110000-0000-0000-0000-0000000000d2'),
  'AC-OFM-022 the refused delete leaves the asset exactly as it was');

-- ── record_odoo_asset_created: the service writer a confirmed Odoo create calls ─────────────────────────────────
set local role service_role;
select lives_ok($$select public.record_odoo_asset_created('15110000-0000-0000-0000-000000000001','vehicle',
    '{"external_id":"900","code":"B 9000 ZZ","name":"Dump truck","active":true,"attrs":{},"source_write_date":"2026-11-09 09:00:00"}',
    '15110000-0000-0000-0000-0000000000f1','hours')$$, 'AC-OFM-030 the recorder writes the created Odoo record');
reset role;
select ok((select a.code = 'B 9000 ZZ' and a.name = 'Dump truck' and a.external_tier = 'odoo' and a.external_ref = 'vehicle:900'
             from equipment_assets a where a.id = '15110000-0000-0000-0000-0000000000f1'),
  'AC-OFM-030 the recorder links a PMO asset under the id the command reserved, code = plate');
select ok((select count(*) = 1 from external_master_records
            where org_id = '15110000-0000-0000-0000-000000000001' and kind = 'vehicle' and external_id = '900' and tombstoned_at is null),
  'AC-OFM-030 the recorder puts the Odoo record in the mirror');
set local role service_role;
select lives_ok($$select public.record_odoo_asset_created('15110000-0000-0000-0000-000000000001','vehicle',
    '{"external_id":"900","code":"B 9000 ZZ","name":"Dump truck","active":true,"attrs":{},"source_write_date":"2026-11-09 09:00:00"}',
    '15110000-0000-0000-0000-0000000000f1','hours')$$, 'AC-OFM-030 a replayed finalize does not fail');
reset role;
select is((select count(*)::int from equipment_assets where external_ref = 'vehicle:900'), 1,
  'AC-OFM-030 a replayed finalize creates no second asset');
set local role authenticated;
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.record_odoo_asset_created('15110000-0000-0000-0000-000000000001','vehicle',
    '{"external_id":"901","code":"B 1","name":"x","active":true,"attrs":{},"source_write_date":"2026-11-09 09:00:00"}',
    '15110000-0000-0000-0000-0000000000f2','hours')$$, '42501', null,
  'AC-OFM-030 a user JWT cannot call the created-asset recorder');

-- ── Releasing `equipment` hands the asset book back: the guard is the ownership row, not a role rule ─────────────
reset role;
delete from external_domain_ownership where org_id = '15110000-0000-0000-0000-000000000001' and domain = 'equipment';
set local role authenticated;
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a3');
select lives_ok($$insert into equipment_assets (code, name) values ('X','X')$$,
  'AC-OFM-022 before employ — and after release — a Project Manager keeps the thin asset book by hand');
select pg_temp.act_as('15110000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.accept_equipment_asset_matches('[]')$$, 'P0001', null,
  'AC-OFM-021 accepting matches needs Odoo to own the equipment register');
reset role;
select ok(not has_function_privilege('anon', 'public.accept_equipment_asset_matches(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.record_odoo_asset_created(uuid,text,jsonb,uuid,text)', 'execute'),
  'AC-OFM-021/030 the accept RPC is not anon-callable and the recorder is not client-callable');

select * from finish();
rollback;
