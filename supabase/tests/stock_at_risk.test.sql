-- #2694: stock at risk against site cover — the read RPC get_stock_at_risk() and the warehouse cover column.
-- Spec docs/specs/stock-at-risk.spec.md · plan docs/plans/2026-11-21-stock-at-risk.md · migrations 1440/1441.
-- Fixture style follows stock_valuation.test.sql: master data as superuser, postings, cover edits and reads
-- under RLS as `authenticated` with per-user JWT claims.

begin;
create extension if not exists pgtap;

insert into organizations (id, name, default_currency, default_timezone) values
  ('26940000-0000-0000-0000-000000000001', 'SAR Org',      'IDR', 'Asia/Jakarta'),
  ('26940000-0000-0000-0000-000000000002', 'SAR Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26940000-0000-0000-0000-0000000000a1', 'sar-admin@example.com'),
  ('26940000-0000-0000-0000-0000000000a3', 'sar-pm@example.com'),
  ('26940000-0000-0000-0000-0000000000a4', 'sar-eng@example.com'),
  ('26940000-0000-0000-0000-0000000000b1', 'sar-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26940000-0000-0000-0000-0000000000a1', '26940000-0000-0000-0000-000000000001', 'SAR Admin', 'sar-admin@example.com', 'Admin', 'active'),
  ('26940000-0000-0000-0000-0000000000a3', '26940000-0000-0000-0000-000000000001', 'SAR PM',    'sar-pm@example.com',    'Project Manager', 'active'),
  ('26940000-0000-0000-0000-0000000000a4', '26940000-0000-0000-0000-000000000001', 'SAR Eng',   'sar-eng@example.com',   'Engineer', 'active'),
  ('26940000-0000-0000-0000-0000000000b1', '26940000-0000-0000-0000-000000000002', 'SAR XOrg',  'sar-xorg@example.com',  'Admin', 'active');
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26940000-0000-0000-0000-0000000000d1', '26940000-0000-0000-0000-000000000001', 'bag', 'Bag', true),
  ('26940000-0000-0000-0000-0000000000d2', '26940000-0000-0000-0000-000000000001', 'm',   'Metre', false),
  ('26940000-0000-0000-0000-0000000000d3', '26940000-0000-0000-0000-000000000002', 'box', 'Box', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26940000-0000-0000-0000-000000001001', '26940000-0000-0000-0000-000000000001', 'CEM', 'Cement 50kg', '26940000-0000-0000-0000-0000000000d1'),
  ('26940000-0000-0000-0000-000000001002', '26940000-0000-0000-0000-000000000001', 'CAB', 'Cable 4mm',   '26940000-0000-0000-0000-0000000000d2'),
  ('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000000002', 'XIT', 'X Item',      '26940000-0000-0000-0000-0000000000d3');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000000001', 'CEN',    'Central', 'central'),
  ('26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000000001', 'SITE-A', 'Site A',  'site'),
  ('26940000-0000-0000-0000-000000002003', '26940000-0000-0000-0000-000000000001', 'SITE-B', 'Site B',  'site'),
  ('26940000-0000-0000-0000-000000002004', '26940000-0000-0000-0000-000000000001', 'SITE-C', 'Site C',  'site'),
  ('26940000-0000-0000-0000-000000002005', '26940000-0000-0000-0000-000000000001', 'SITE-D', 'Site D',  'site'),
  ('26940000-0000-0000-0000-000000003001', '26940000-0000-0000-0000-000000000002', 'X-SITE', 'X Site',  'site');

-- Claim-free shape helpers: called on a report payload already read as the right user.
create function public.sar_t_find(p_rows jsonb, p_code text) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(p_rows) e where e->>'warehouse_code' = p_code $$;
create function public.sar_t_codes(p_rows jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(e->>'warehouse_code' || '=' || coalesce(e->>'stock_value', 'no-money-keys'), ',' order by ord), '')
    from jsonb_array_elements(p_rows) with ordinality t(e, ord) $$;
create function public.sar_t_lacks_key(p_rows jsonb, p_key text) returns boolean language sql immutable as $$
  select not exists (select 1 from jsonb_array_elements(p_rows) e where e ? p_key) $$;
create function public.sar_t_rcv(p_wh uuid, p_item uuid, p_qty numeric, p_cost numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',p_cost)), true) $$;

create function public.sar_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Postings by the org Admin: SITE-A holds two items (the report asserts the per-location sum), SITE-D a zero-cost receipt.
select public.sar_t_as_user('26940000-0000-0000-0000-0000000000a1');
select public.sar_t_rcv('26940000-0000-0000-0000-000000002001', '26940000-0000-0000-0000-000000001001', 150, 60);  -- CEN 9,000
select public.sar_t_rcv('26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001001', 40, 60);  -- SITE-A 2,400
select public.sar_t_rcv('26940000-0000-0000-0000-000000002002', '26940000-0000-0000-0000-000000001002', 10, 60);  -- SITE-A +600 -> 3,000
select public.sar_t_rcv('26940000-0000-0000-0000-000000002003', '26940000-0000-0000-0000-000000001001', 100, 10); -- SITE-B 1,000
select public.sar_t_rcv('26940000-0000-0000-0000-000000002004', '26940000-0000-0000-0000-000000001001', 75, 10);  -- SITE-C 750 (no cover)
select public.sar_t_rcv('26940000-0000-0000-0000-000000002005', '26940000-0000-0000-0000-000000001001', 5, 0);    -- SITE-D 0.00
select public.sar_t_as_user('26940000-0000-0000-0000-0000000000b1');                                               -- the other org posts on its own site
select public.sar_t_rcv('26940000-0000-0000-0000-000000003001', '26940000-0000-0000-0000-000000002001', 4, 100);  -- other org 400

-- Covers recorded by an org Admin through RLS (FR-SAR-006): SITE-A 2,500, SITE-B 1,000, SITE-C/SITE-D none.
select public.sar_t_as_user('26940000-0000-0000-0000-0000000000a1');
update public.stock_warehouses set cover_value = 2500 where id = '26940000-0000-0000-0000-000000002002';
update public.stock_warehouses set cover_value = 1000 where id = '26940000-0000-0000-0000-000000002003';

select plan(18);

-- AC-SAR-101: one row per location holding stock; the value held is the sum over the location's items.
select is(public.sar_t_codes(public.get_stock_at_risk()),
  'CEN=9000.00,SITE-C=750.00,SITE-A=3000.00,SITE-B=1000.00,SITE-D=0.00',
  'AC-SAR-101 one row per location holding stock, value held summed over its items');
select is((select count(*)::text from jsonb_array_elements(public.get_stock_at_risk())), '5',
  'AC-SAR-101 exactly five org locations hold stock (the other org''s site is not among them)');

-- AC-SAR-102: at risk is the held value above the cover; at or below the cover it is zero.
select is(public.sar_t_find(public.get_stock_at_risk(), 'SITE-A')->>'at_risk', '500.00',
  'AC-SAR-102 SITE-A holds 3,000 against a 2,500 cover, so 500 is at risk');
select is(public.sar_t_find(public.get_stock_at_risk(), 'SITE-B')->>'at_risk', '0.00',
  'AC-SAR-102 SITE-B holds 1,000 against a 1,000 cover, so nothing is at risk');

-- AC-SAR-103: no cover recorded exposes the whole held value.
select is(public.sar_t_find(public.get_stock_at_risk(), 'SITE-C')->>'cover_value', null,
  'AC-SAR-103 SITE-C has no cover recorded (null, never a fabricated 0)');
select is(public.sar_t_find(public.get_stock_at_risk(), 'SITE-C')->>'at_risk', '750.00',
  'AC-SAR-103 SITE-C''s whole 750 is at risk while no cover is recorded');

-- FR-SAR-005: rows lead with the highest at-risk figure (CEN 9,000 uncovered first; SITE-B last at zero).
select is((public.get_stock_at_risk())->0->>'warehouse_code', 'CEN',
  'FR-SAR-005 the most exposed location leads the report');

-- AC-SAR-104: money keys follow the cost permission (rank >= 20), never the caller's word for it.
select public.sar_t_as_user('26940000-0000-0000-0000-0000000000a4');
select is(public.sar_t_lacks_key(public.get_stock_at_risk(), 'stock_value'), true,
  'AC-SAR-104 an Engineer (rank < 20) is sent no stock_value key');
select is(public.sar_t_lacks_key(public.get_stock_at_risk(), 'cover_value'), true,
  'AC-SAR-104 an Engineer (rank < 20) is sent no cover_value key');
select is(public.sar_t_lacks_key(public.get_stock_at_risk(), 'at_risk'), true,
  'AC-SAR-104 an Engineer (rank < 20) is sent no at_risk key');
select public.sar_t_as_user('26940000-0000-0000-0000-0000000000a3');
select is((public.sar_t_find(public.get_stock_at_risk(), 'SITE-A') ? 'stock_value'), true,
  'AC-SAR-104 a Project Manager (rank 20) is sent the money keys');

-- AC-SAR-105: tenancy — each organisation sees only its own locations and values.
select public.sar_t_as_user('26940000-0000-0000-0000-0000000000b1');
select is(public.sar_t_codes(public.get_stock_at_risk()), 'X-SITE=400.00',
  'AC-SAR-105 the other organisation sees only its own site and value');
select public.sar_t_as_user('26940000-0000-0000-0000-0000000000a1');
select is(not exists (select 1 from jsonb_array_elements(public.get_stock_at_risk()) e where e->>'warehouse_code' = 'X-SITE'),
  true, 'AC-SAR-105 the org never sees the other organisation''s site');

-- Zero-value rows are shown, not flagged (FR-SAR-001, spec §2).
select is(public.sar_t_find(public.get_stock_at_risk(), 'SITE-D')->>'stock_value', '0.00',
  'FR-SAR-001 a zero-value location holding stock is shown with 0.00');

-- AC-SAR-106: the cover is a plain recorded figure — stored, clearable, never negative.
select is((select cover_value::text from public.stock_warehouses where id = '26940000-0000-0000-0000-000000002002'), '2500.00',
  'AC-SAR-106 the recorded cover is stored as given');
update public.stock_warehouses set cover_value = null where id = '26940000-0000-0000-0000-000000002003';
select is((select cover_value from public.stock_warehouses where id = '26940000-0000-0000-0000-000000002003'), null,
  'AC-SAR-106 clearing the cover leaves it null (not recorded)');
select throws_like(
  $$ update public.stock_warehouses set cover_value = -1 where id = '26940000-0000-0000-0000-000000002002' $$,
  '%stock_warehouses_cover_value_check%', 'AC-SAR-106 a negative cover is refused');
select lives_ok(
  $$ insert into public.stock_warehouses (code, name, kind, cover_value) values ('SITE-E', 'Site E', 'site', null) $$,
  'AC-SAR-106 a location is created with the cover field in the insert, as the form sends it');
select * from finish();
rollback;
