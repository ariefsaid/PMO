-- 1341_work_order_material_vs_progress.test.sql — #2674 (spec docs/specs/material-issued-vs-progress.spec.md). Migrations under test: 1340, 1341.
-- AC-MIP-001 off returns nothing · 004 warn · 005 equal does not warn · 006 returns net out · 007 unplanned · 008 progress basis ·
-- 009 no lines · 010 tenancy · 011 the read writes nothing.
-- Fixture: WO one has lines L1 (rate 10, qty 100) and L2 (rate 30, qty 100). L1: Confirmed accepted 40 and validated daily 10 (the greater, 40, counts).
-- L2: validated daily 20 (counts), plus a draft report of 100 and a superseded validated report of 100 (neither counts).
-- Done value = 40x10 + 20x30 = 1000 of 4000 = progress 25.0. Rod allowance 100 (line holds the full BoQ quantity), 60 issued.
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26741000-0000-0000-0000-00000000010a', 'MIP Org', 'IDR', 'UTC'), ('26741000-0000-0000-0000-00000000010b', 'MIP Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26741000-0000-0000-0000-0000000001a1', 'mipv-admin@example.com'), ('26741000-0000-0000-0000-0000000001a2', 'mipv-eng@example.com'), ('26741000-0000-0000-0000-0000000001b1', 'mipv-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26741000-0000-0000-0000-0000000001a1', '26741000-0000-0000-0000-00000000010a', 'MIPV Admin', 'mipv-admin@example.com', 'Admin', 'active'),
  ('26741000-0000-0000-0000-0000000001a2', '26741000-0000-0000-0000-00000000010a', 'MIPV Eng',   'mipv-eng@example.com',   'Engineer', 'active'),
  ('26741000-0000-0000-0000-0000000001b1', '26741000-0000-0000-0000-00000000010b', 'MIPV XAdmin','mipv-xadmin@example.com','Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('26741000-0000-0000-0000-0000000001d1', '26741000-0000-0000-0000-00000000010a', 'MIPV P1', 'Ongoing Project'), ('26741000-0000-0000-0000-0000000001d2', '26741000-0000-0000-0000-00000000010b', 'MIPV Other P', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26741000-0000-0000-0000-000000001401', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', 'MIPV WO one', 'Issued', 10000, 'exclusive', 0),
  ('26741000-0000-0000-0000-000000001402', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', 'MIPV WO empty', 'Issued', 10000, 'exclusive', 0),
  ('26741000-0000-0000-0000-000000001403', '26741000-0000-0000-0000-00000000010b', '26741000-0000-0000-0000-0000000001d2', 'MIPV WO other org', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26741000-0000-0000-0000-000000001201', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', 'L1', 'Line one', 'm3', 100, 10),
  ('26741000-0000-0000-0000-000000001202', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', 'L2', 'Line two', 'm2', 100, 30);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('26741000-0000-0000-0000-000000001211', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-000000001401', '26741000-0000-0000-0000-000000001201', 100),
  ('26741000-0000-0000-0000-000000001212', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-000000001401', '26741000-0000-0000-0000-000000001202', 100);
insert into stock_units (id, org_id, code, name, whole_only) values ('26741000-0000-0000-0000-000000001301', '26741000-0000-0000-0000-00000000010a', 'KG', 'Kilogram', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26741000-0000-0000-0000-000000001311', '26741000-0000-0000-0000-00000000010a', 'ROD',  'Welding rod', '26741000-0000-0000-0000-000000001301'),
  ('26741000-0000-0000-0000-000000001312', '26741000-0000-0000-0000-00000000010a', 'PIPE', 'Pipe',        '26741000-0000-0000-0000-000000001301');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-000000001201', '26741000-0000-0000-0000-000000001311', 100);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26741000-0000-0000-0000-000000001801', '26741000-0000-0000-0000-00000000010a', 'CEN', 'Central', 'central', null);

-- Confirmed acceptance of 40 on L1 (written directly: the fixture, not the path under test).
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis)
values ('26741000-0000-0000-0000-000000001501', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', '26741000-0000-0000-0000-000000001401', current_date, false, 'Confirmed', '26741000-0000-0000-0000-0000000001a1', '26741000-0000-0000-0000-0000000001a1', now(), 'sole_operator');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values ('26741000-0000-0000-0000-000000001501', '26741000-0000-0000-0000-000000001201', 40);
-- Daily reports: validated (author a2, validator a1), a draft, and a superseded validated one.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at, superseded_at) values
  ('26741000-0000-0000-0000-000000001601', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', '26741000-0000-0000-0000-000000001401', '2026-03-10', 'validated', '26741000-0000-0000-0000-0000000001a2', now(), '26741000-0000-0000-0000-0000000001a1', now(), null),
  ('26741000-0000-0000-0000-000000001602', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', '26741000-0000-0000-0000-000000001401', '2026-03-11', 'draft',     '26741000-0000-0000-0000-0000000001a2', null, null, null, null),
  ('26741000-0000-0000-0000-000000001603', '26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-0000000001d1', '26741000-0000-0000-0000-000000001401', '2026-03-12', 'validated', '26741000-0000-0000-0000-0000000001a2', now(), '26741000-0000-0000-0000-0000000001a1', now(), now());
insert into dsr_progress_lines (org_id, report_id, position, work_order_line_id, quantity, unit) values
  ('26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-000000001601', 1, '26741000-0000-0000-0000-000000001211', 10, 'm3'),
  ('26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-000000001601', 2, '26741000-0000-0000-0000-000000001212', 20, 'm2'),
  ('26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-000000001602', 1, '26741000-0000-0000-0000-000000001212', 100, 'm2'),
  ('26741000-0000-0000-0000-00000000010a', '26741000-0000-0000-0000-000000001603', 1, '26741000-0000-0000-0000-000000001212', 100, 'm2');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._item(p_item text, p_key text) returns text language sql as $$
  select e->>p_key from jsonb_array_elements(public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001401')->'items') e where e->>'item_code' = p_item $$;
grant execute on function pg_temp._item(text, text) to authenticated;
create or replace function pg_temp._footprint() returns text language sql security definer as $$
  select (select count(*) from public.stock_ledger)::text || '/' || (select count(*) from public.stock_documents)::text || '/' ||
         (select count(*) from public.daily_site_reports)::text || '/' || (select count(*) from public.work_order_acceptances)::text || '/' ||
         (select count(*) from public.dsr_progress_lines)::text $$;
grant execute on function pg_temp._footprint() to authenticated;

set local role authenticated;
select pg_temp._as('26741000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.create_stock_document('{"kind":"receive","warehouse_id":"26741000-0000-0000-0000-000000001801"}'::jsonb,
  '[{"item_id":"26741000-0000-0000-0000-000000001311","quantity":200,"unit_cost":3},{"item_id":"26741000-0000-0000-0000-000000001312","quantity":50,"unit_cost":2}]'::jsonb, true) $$, 'stock is received centrally');
select set_config('mipv.iss1', public.create_stock_document('{"kind":"issue","warehouse_id":"26741000-0000-0000-0000-000000001801","project_id":"26741000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"26741000-0000-0000-0000-000000001311","quantity":60,"boq_item_id":"26741000-0000-0000-0000-000000001201"},{"item_id":"26741000-0000-0000-0000-000000001312","quantity":5,"boq_item_id":"26741000-0000-0000-0000-000000001201"}]'::jsonb, true)::text, true);
select public.set_cost_attribution('stock_document', array[current_setting('mipv.iss1')::uuid], '26741000-0000-0000-0000-000000001401', null);

-- ── AC-MIP-001 off ─────────────────────────────────────────────────────────────────────────────────────────────────
select is(public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001401'), '{"threshold_pct":null,"progress_pct":null,"items":[]}'::jsonb,
  'AC-MIP-001 with no threshold the read returns no comparison');
select pg_temp._as('26741000-0000-0000-0000-0000000001a2');
select is(public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001401')->'items', '[]'::jsonb, 'AC-MIP-001 an Engineer reads the same empty comparison');

-- ── AC-MIP-004 warn ────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp._as('26741000-0000-0000-0000-0000000001a1');
select public.set_work_order_issue_threshold(30);
select is(public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001401')->>'progress_pct', '25.0', 'AC-MIP-008 progress is 25.0 (accepted 40 beats daily 10; daily 20; draft and superseded add nothing)');
select is(pg_temp._item('ROD', 'planned_qty'), '100', 'AC-MIP-004 planned 100 from the allowance');
select is(pg_temp._item('ROD', 'issued_qty'), '60', 'AC-MIP-004 issued 60');
select is(pg_temp._item('ROD', 'issued_pct'), '60.0', 'AC-MIP-004 issued share 60.0');
select is(pg_temp._item('ROD', 'gap_pp'), '35.0', 'AC-MIP-004 gap 35.0 points');
select is(pg_temp._item('ROD', 'warn'), 'true', 'AC-MIP-004 gap 35.0 over threshold 30 warns');
select pg_temp._as('26741000-0000-0000-0000-0000000001a2');
select is(pg_temp._item('ROD', 'warn'), 'true', 'AC-MIP-004 any active member reads the same warning');

-- ── AC-MIP-005 strict ──────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp._as('26741000-0000-0000-0000-0000000001a1');
select public.set_work_order_issue_threshold(35);
select is(pg_temp._item('ROD', 'warn'), 'false', 'AC-MIP-005 a gap equal to the threshold does not warn');
select public.set_work_order_issue_threshold(34.9);
select is(pg_temp._item('ROD', 'warn'), 'true', 'AC-MIP-005 a gap just over the threshold warns');

-- ── AC-MIP-007 unplanned ───────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp._item('PIPE', 'unplanned'), 'true', 'AC-MIP-007 an issued item with no allowance is listed as unplanned');
select is(pg_temp._item('PIPE', 'warn'), 'false', 'AC-MIP-007 it never warns');
select is(pg_temp._item('PIPE', 'issued_pct'), null, 'AC-MIP-007 it has no issued share');

-- ── AC-MIP-006 returns net out ─────────────────────────────────────────────────────────────────────────────────────
select public.create_stock_document('{"kind":"return","warehouse_id":"26741000-0000-0000-0000-000000001801","project_id":"26741000-0000-0000-0000-0000000001d1"}'::jsonb,
  jsonb_build_array(jsonb_build_object('item_id', '26741000-0000-0000-0000-000000001311', 'quantity', 20,
    'source_line_id', (select id from stock_document_lines where document_id = current_setting('mipv.iss1')::uuid and item_id = '26741000-0000-0000-0000-000000001311'))), true);
select is(pg_temp._item('ROD', 'issued_qty'), '40', 'AC-MIP-006 net issued is 60 less the 20 returned');
select is(pg_temp._item('ROD', 'issued_pct'), '40.0', 'AC-MIP-006 issued share 40.0');
select is(pg_temp._item('ROD', 'warn'), 'false', 'AC-MIP-006 gap 15.0 under threshold 34.9 does not warn');

-- ── AC-MIP-009 no lines ────────────────────────────────────────────────────────────────────────────────────────────
select is(public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001402')->'progress_pct', 'null'::jsonb, 'AC-MIP-009 a work order with no lines has no progress share');
select is(public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001402')->'items', '[]'::jsonb, 'AC-MIP-009 and nothing warns');

-- ── AC-MIP-011 the read writes nothing ─────────────────────────────────────────────────────────────────────────────
select set_config('mipv.fp', pg_temp._footprint(), true);
select public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001401');
select is(pg_temp._footprint(), current_setting('mipv.fp'), 'AC-MIP-011 the read changed no ledger, document, report, acceptance or progress row');

-- ── AC-MIP-010 tenancy ─────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001403') $$, 'P0001',
  'STK_NOT_FOUND: the work order is not in your organisation', 'AC-MIP-010 a work order of another organisation reads as not found');
select pg_temp._as('26741000-0000-0000-0000-0000000001b1');
select throws_ok($$ select public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001401') $$, 'P0001',
  'STK_NOT_FOUND: the work order is not in your organisation', 'AC-MIP-010 the other organisation cannot read this one either');
select is((select count(*)::int from work_order_stock_settings), 0, 'AC-MIP-010 the other organisation cannot read this organisation''s setting');
reset role;
set local role anon;
select throws_ok($$ select public.get_work_order_material_vs_progress('26741000-0000-0000-0000-000000001401') $$, '42501', null, 'AC-MIP-010 anon is refused');

select * from finish();
rollback;
