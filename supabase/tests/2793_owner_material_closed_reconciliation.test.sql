-- 2793_owner_material_closed_reconciliation.test.sql — a Closed work order records its owner-supplied
-- material reconciliation step; Cancelled and every other material write stay refused (#3024).
-- Ids 30120000-… (synthetic).
-- MUTATION: remove 'Closed' from the status list in 2793's om_material_set_reconciliation
-- (`-- mut:material_reconciliation_closed`) and the closed-order acceptance assertions go red.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('30120000-0000-0000-0000-00000000010a', 'OMC Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('30120000-0000-0000-0000-0000000001a1', 'omc-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('30120000-0000-0000-0000-0000000001a1', '30120000-0000-0000-0000-00000000010a', 'OMC Admin', 'omc-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('30120000-0000-0000-0000-0000000001c1', '30120000-0000-0000-0000-00000000010a', 'OMC Site', 'Ongoing Project', 'IDR', 100000, 'exclusive', 0);
-- 401 stays Issued (the unchanged baseline), 402 is Closed (reconciliation still records), 403 is Cancelled (frozen).
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, client_po_number) values
  ('30120000-0000-0000-0000-000000001401', '30120000-0000-0000-0000-00000000010a', '30120000-0000-0000-0000-0000000001c1', 'OMC issued',    'Issued',    10000, 'exclusive', 0, null),
  ('30120000-0000-0000-0000-000000001402', '30120000-0000-0000-0000-00000000010a', '30120000-0000-0000-0000-0000000001c1', 'OMC closed',    'Closed',    10000, 'exclusive', 0, 'OM-2793'),
  ('30120000-0000-0000-0000-000000001403', '30120000-0000-0000-0000-00000000010a', '30120000-0000-0000-0000-0000000001c1', 'OMC cancelled', 'Cancelled', 10000, 'exclusive', 0, null);
insert into stock_units (id, org_id, code, name) values
  ('30120000-0000-0000-0000-000000001301', '30120000-0000-0000-0000-00000000010a', 'M', 'Metre');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('30120000-0000-0000-0000-000000001311', '30120000-0000-0000-0000-00000000010a', 'CBL', 'Cable', '30120000-0000-0000-0000-000000001301');
-- One live location per work order; the 2791 seed trigger gave the organisation its five-stage scale.
insert into work_order_sections (id, org_id, project_id, work_order_id, code, name) values
  ('30120000-0000-0000-0000-000000002001', '30120000-0000-0000-0000-00000000010a', '30120000-0000-0000-0000-0000000001c1', '30120000-0000-0000-0000-000000001401', 'N', 'North'),
  ('30120000-0000-0000-0000-000000002002', '30120000-0000-0000-0000-00000000010a', '30120000-0000-0000-0000-0000000001c1', '30120000-0000-0000-0000-000000001402', 'S', 'South'),
  ('30120000-0000-0000-0000-000000002003', '30120000-0000-0000-0000-00000000010a', '30120000-0000-0000-0000-0000000001c1', '30120000-0000-0000-0000-000000001403', 'X', 'Cancelled');

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.closed_payload() returns jsonb language sql as $$
  select jsonb_build_object('kind','section','project_id','30120000-0000-0000-0000-0000000001c1','source_digest','omc',
    'entities', jsonb_build_array(jsonb_build_object('entity_key','section-closed','hash','v1','sheet','South','row',2,
      'owner_order_number','OM-2793','location_name','South','section_code','S','owner_cost_code','SYN','as_of','2026-11-01',
      'lines', jsonb_build_array(jsonb_build_object('entity_key','line-cable','hash','v1','row',3,'item_code','CBL','unit','M','planned','100',
        'opening', jsonb_build_object('requested','0','set_aside','0','received','10','issued','0','returned','0','transfer_in','0','transfer_out','0','owner_return','0'),
        'evidence', jsonb_build_object('dates','2026-11-01','reference','SYN'),
        'expected', jsonb_build_object('closing','10'))))));
$$;
create temp table results(k text primary key, v jsonb);
grant all on results to authenticated;

set local role authenticated;
select pg_temp.act_as('30120000-0000-0000-0000-0000000001a1');

-- 1. Baseline on the Issued order is unchanged: forward one step, no reason needed.
select lives_ok($$select om_material_set_reconciliation('30120000-0000-0000-0000-000000002001',
  (select id from owner_material_reconciliation_steps where org_id='30120000-0000-0000-0000-00000000010a' and archived_at is null and position=2))$$,
  'AC-WOR-002 Issued work order keeps recording its reconciliation step');

-- 2. THE RULE (#3024): the Closed order still records its reconciliation step.
select lives_ok($$select om_material_set_reconciliation('30120000-0000-0000-0000-000000002002',
  (select id from owner_material_reconciliation_steps where org_id='30120000-0000-0000-0000-00000000010a' and archived_at is null and position=2))$$,
  'AC-WOR-002 Closed work order records its material reconciliation step');
select is((select (select name from owner_material_reconciliation_steps where id=r.step_id)
             from owner_material_reconciliation r where r.section_id='30120000-0000-0000-0000-000000002002'),
  'Checked', 'AC-WOR-002 the closed order''s reconciliation step persists');

-- 3. The unchanged backwards rule rides along while Closed: a reason is required and recorded.
select throws_ok($$select om_material_set_reconciliation('30120000-0000-0000-0000-000000002002',
  (select id from owner_material_reconciliation_steps where org_id='30120000-0000-0000-0000-00000000010a' and archived_at is null and position=1))$$,
  'P0001', 'Moving backwards requires a reason', 'AC-WOR-002 moving a closed order''s step back still demands a reason');
select lives_ok($$select om_material_set_reconciliation('30120000-0000-0000-0000-000000002002',
  (select id from owner_material_reconciliation_steps where org_id='30120000-0000-0000-0000-00000000010a' and archived_at is null and position=1), 'Recount at site')$$,
  'AC-WOR-002 a closed order''s step moves back with a reason');
select is((select count(*) from owner_material_reconciliation_events where section_id='30120000-0000-0000-0000-000000002002'),
  2::bigint, 'AC-WOR-002 every change on the closed order is audited as an event');

-- 4. Cancelled stays frozen.
select throws_ok($$select om_material_set_reconciliation('30120000-0000-0000-0000-000000002003',
  (select id from owner_material_reconciliation_steps where org_id='30120000-0000-0000-0000-00000000010a' and archived_at is null and position=2))$$,
  'P0001', 'Section is frozen', 'AC-WOR-002 a cancelled work order takes no reconciliation');

-- 5. Every other material write stays refused while Closed.
select throws_ok($$insert into work_order_section_material_plan(org_id, work_order_id, section_id, item_id, quantity)
  values ('30120000-0000-0000-0000-00000000010a', '30120000-0000-0000-0000-000000001402',
          '30120000-0000-0000-0000-000000002002', '30120000-0000-0000-0000-000000001311', 1)$$,
  '23514', null, 'AC-WOR-002 a closed work order takes no material allocation');

insert into results values('closed-import', om_material_import('omc-closed', 2, pg_temp.closed_payload(), true));
select is((select v->'results'->0->>'reason_code' from results where k='closed-import'),
  'material-conflict', 'AC-WOR-002 the owner-material import still refuses a closed work order');
select is((select v->>'complete' from results where k='closed-import'),
  'false', 'AC-WOR-002 the refused import completes nothing');

select * from finish();
rollback;
