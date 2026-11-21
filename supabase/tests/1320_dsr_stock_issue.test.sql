-- 1320_dsr_stock_issue.test.sql — #2676 (spec docs/specs/daily-report-stock-issue.spec.md). Migrations under test: 1320-1324.
-- AC-DRS-001 off · 002 posts · 003 short · 004 no location · 005 scope · 006 keeper waiver + marker cleared · 007 engine refusal · 008 idempotence ·
-- 009/010 correction reverses once · 011 nothing to reverse / setting off · 013 work item · 014 setting · 015 location · 016 isolation · 017 old work date.
-- Mutation checks (break the marked line, expect the named AC red, restore): mut:drs_on (001) · mut:drs_short (003) · mut:drs_scope (005) ·
-- mut:drs_keeper_marker (006: leave the marker on, or make stock_assert_keeper ignore it) · mut:drs_idem_posting / mut:drs_idem_line (008) ·
-- mut:drs_reverse_once (010) · mut:drs_reverse_before_post (009) · mut:drs_location_check (015) · mut:drs_org (016) · mut:drs_setting_admin (014).
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('26760000-0000-0000-0000-00000000000a', 'DRS Org', 'USD', 'UTC'), ('26760000-0000-0000-0000-00000000000b', 'DRS Other Org', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('26760000-0000-0000-0000-0000000000a1', 'drs-admin@example.com'), ('26760000-0000-0000-0000-0000000000a2', 'drs-eng@example.com'),
  ('26760000-0000-0000-0000-0000000000a3', 'drs-fin@example.com'), ('26760000-0000-0000-0000-0000000000a4', 'drs-keeper@example.com'),
  ('26760000-0000-0000-0000-0000000000b1', 'drs-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26760000-0000-0000-0000-0000000000a1', '26760000-0000-0000-0000-00000000000a', 'DRS Admin', 'drs-admin@example.com', 'Admin', 'active'),
  ('26760000-0000-0000-0000-0000000000a2', '26760000-0000-0000-0000-00000000000a', 'DRS Engineer', 'drs-eng@example.com', 'Engineer', 'active'),
  ('26760000-0000-0000-0000-0000000000a3', '26760000-0000-0000-0000-00000000000a', 'DRS Finance', 'drs-fin@example.com', 'Finance', 'active'),
  ('26760000-0000-0000-0000-0000000000a4', '26760000-0000-0000-0000-00000000000a', 'DRS Keeper', 'drs-keeper@example.com', 'Engineer', 'active'),
  ('26760000-0000-0000-0000-0000000000b1', '26760000-0000-0000-0000-00000000000b', 'DRS Other Admin', 'drs-other@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26760000-0000-0000-0000-0000000000c1', '26760000-0000-0000-0000-00000000000a', 'DRS Job One', 'Ongoing Project', 'USD'),
  ('26760000-0000-0000-0000-0000000000c2', '26760000-0000-0000-0000-00000000000a', 'DRS Job Two', 'Ongoing Project', 'USD'),
  ('26760000-0000-0000-0000-0000000000c3', '26760000-0000-0000-0000-00000000000a', 'DRS Job Closed', 'Ongoing Project', 'USD');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26760000-0000-0000-0000-0000000000f1', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'L1', 'Weld', 'm', 100, 5),
  ('26760000-0000-0000-0000-0000000000f2', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'L2', 'Paint', 'm2', 100, 3),
  ('26760000-0000-0000-0000-0000000000f3', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'L3', 'Pipe', 'm', 100, 3),
  ('26760000-0000-0000-0000-0000000000f4', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c3', 'L4', 'Closed job line', 'm', 100, 3);
-- e1 two lines (ambiguous), e2 one line (the only one), e3 two lines no site location, e4 on the job that closes later, e5 one line
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26760000-0000-0000-0000-0000000000e1', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'WO one', 'Issued', 10000, 'exclusive', 0),
  ('26760000-0000-0000-0000-0000000000e2', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'WO two', 'Issued', 10000, 'exclusive', 0),
  ('26760000-0000-0000-0000-0000000000e3', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'WO three', 'Issued', 10000, 'exclusive', 0),
  ('26760000-0000-0000-0000-0000000000e4', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c3', 'WO four', 'Issued', 10000, 'exclusive', 0),
  ('26760000-0000-0000-0000-0000000000e5', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'WO five', 'Issued', 10000, 'exclusive', 0),
  ('26760000-0000-0000-0000-0000000000e6', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000c1', 'WO six', 'Issued', 10000, 'exclusive', 0);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('26760000-0000-0000-0000-000000000011', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000e1', '26760000-0000-0000-0000-0000000000f1', 100),
  ('26760000-0000-0000-0000-000000000012', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000e1', '26760000-0000-0000-0000-0000000000f2', 100),
  ('26760000-0000-0000-0000-000000000013', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000e2', '26760000-0000-0000-0000-0000000000f3', 100),
  ('26760000-0000-0000-0000-000000000014', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000e3', '26760000-0000-0000-0000-0000000000f1', 100),
  ('26760000-0000-0000-0000-000000000015', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000e4', '26760000-0000-0000-0000-0000000000f4', 100),
  ('26760000-0000-0000-0000-000000000016', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000e5', '26760000-0000-0000-0000-0000000000f1', 100),
  ('26760000-0000-0000-0000-000000000017', '26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-0000000000e6', '26760000-0000-0000-0000-0000000000f2', 100);
insert into stock_units (id, org_id, code, name) values ('26760000-0000-0000-0000-000000000021', '26760000-0000-0000-0000-00000000000a', 'pc', 'Piece');
insert into stock_items (id, org_id, code, name, unit_id, consumable) values
  ('26760000-0000-0000-0000-000000000022', '26760000-0000-0000-0000-00000000000a', 'ROD', 'Welding rod', '26760000-0000-0000-0000-000000000021', true),
  ('26760000-0000-0000-0000-000000000023', '26760000-0000-0000-0000-00000000000a', 'FLG', 'Flange', '26760000-0000-0000-0000-000000000021', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26760000-0000-0000-0000-0000000000c1'),
  ('26760000-0000-0000-0000-000000000032', '26760000-0000-0000-0000-00000000000a', 'SITE2', 'Site two', 'site', '26760000-0000-0000-0000-0000000000c2'),
  ('26760000-0000-0000-0000-000000000033', '26760000-0000-0000-0000-00000000000a', 'CEN', 'Central', 'central', null),
  ('26760000-0000-0000-0000-000000000034', '26760000-0000-0000-0000-00000000000a', 'SITE3', 'Site closed job', 'site', '26760000-0000-0000-0000-0000000000c3'),
  ('26760000-0000-0000-0000-000000000039', '26760000-0000-0000-0000-00000000000b', 'XSITE', 'Other org site', 'site', null);
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-0000000000a4'),
  ('26760000-0000-0000-0000-00000000000a', '26760000-0000-0000-0000-000000000034', '26760000-0000-0000-0000-0000000000a4');
update projects set project_manager_id = '26760000-0000-0000-0000-0000000000a3' where id in ('26760000-0000-0000-0000-0000000000c1', '26760000-0000-0000-0000-0000000000c3');

create function public.drs_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.drs_rcv(p_wh uuid, p_item uuid, p_qty numeric) returns uuid language sql as $$
  select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id',p_wh),
    jsonb_build_array(jsonb_build_object('item_id',p_item,'quantity',p_qty,'unit_cost',10)), true) $$;
-- a submitted report with a stored paper-form photo (the engineer writes it)
create function public.drs_make(p_wo uuid, p_date date, p_cons jsonb, p_prog jsonb default '[]') returns uuid language plpgsql as $$
declare v_id uuid; v_path text;
begin
  perform public.drs_as('26760000-0000-0000-0000-0000000000a2');
  v_id := public.dsr_save_draft(jsonb_build_object('work_order_id', p_wo, 'work_date', p_date, 'progress', p_prog, 'consumables', p_cons));
  v_path := '26760000-0000-0000-0000-00000000000a/' || v_id || '/26760000-0000-0000-0000-000000000051/form.jpg';
  reset role;
  insert into storage.objects (bucket_id, name, owner) values ('site-report-photos', v_path, '26760000-0000-0000-0000-0000000000a2');
  perform public.drs_as('26760000-0000-0000-0000-0000000000a2');
  insert into public.dsr_photos (report_id, kind, file_path) values (v_id, 'paper_form', v_path);
  perform public.dsr_submit(v_id);
  return v_id;
end $$;
create function public.drs_cons(p_item uuid, p_qty numeric, p_line uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('stock_item_id', p_item, 'quantity', p_qty) || case when p_line is null then '{}'::jsonb else jsonb_build_object('work_order_line_id', p_line) end $$;
create function public.drs_oh(p_wh uuid, p_item uuid) returns numeric language sql security definer as $$
  select coalesce((select qty_on_hand from public.stock_balances where warehouse_id = p_wh and item_id = p_item), 0) $$;
create function public.drs_docs(p_kind text) returns integer language sql security definer as $$
  select count(*)::integer from public.stock_documents where org_id = '26760000-0000-0000-0000-00000000000a' and kind = p_kind and note like '%aily report%' $$;
create function public.drs_line_state(p_report uuid, p_pos int) returns text language sql security definer as $$
  select l.state from public.dsr_stock_posting_lines l join public.dsr_consumables c on c.id = l.consumable_id where c.report_id = p_report and c.position = p_pos $$;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

select drs_as('26760000-0000-0000-0000-0000000000a1');
select drs_rcv('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000022', 10);
select drs_rcv('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000023', 10);
select drs_rcv('26760000-0000-0000-0000-000000000032', '26760000-0000-0000-0000-000000000022', 10);
select drs_rcv('26760000-0000-0000-0000-000000000034', '26760000-0000-0000-0000-000000000022', 10);
reset role;
-- site locations (client data)
update work_orders set site_warehouse_id = '26760000-0000-0000-0000-000000000031' where id in ('26760000-0000-0000-0000-0000000000e1', '26760000-0000-0000-0000-0000000000e2', '26760000-0000-0000-0000-0000000000e5', '26760000-0000-0000-0000-0000000000e6');
update work_orders set site_warehouse_id = '26760000-0000-0000-0000-000000000034' where id = '26760000-0000-0000-0000-0000000000e4';

-- ── AC-DRS-015 site location rules ───────────────────────────────────────────────────────────────────────────
select throws_ok($$update work_orders set site_warehouse_id = '26760000-0000-0000-0000-000000000032' where id = '26760000-0000-0000-0000-0000000000e3'$$, '23514', null, 'AC-DRS-015 a location of another project is refused');
select throws_ok($$update work_orders set site_warehouse_id = '26760000-0000-0000-0000-000000000033' where id = '26760000-0000-0000-0000-0000000000e3'$$, '23514', null, 'AC-DRS-015 a central location is refused');
select throws_ok($$update work_orders set site_warehouse_id = '26760000-0000-0000-0000-000000000039' where id = '26760000-0000-0000-0000-0000000000e3'$$, '23514', null, 'AC-DRS-015 another organisation''s location is refused');

-- ── AC-DRS-001 default off: validation behaves as today, nothing is written ────────────────────────────────
insert into ids select 'off', drs_make('26760000-0000-0000-0000-0000000000e2', (now() at time zone 'UTC')::date - 1, jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 2)));
select drs_as('26760000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.dsr_validate((select v from ids where k = 'off'))$$, 'AC-DRS-001 a report validates with the setting off');
reset role;
select is((select count(*)::int from dsr_stock_postings), 0, 'AC-DRS-001 no posting row');
select is(drs_docs('issue'), 0, 'AC-DRS-001 no stock document');
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000022'), 10::numeric, 'AC-DRS-001 stock untouched');

-- ── AC-DRS-014 the setting ────────────────────────────────────────────────────────────────────────────────
select drs_as('26760000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.set_dsr_stock_issue(true, 'all')$$, '42501', null, 'AC-DRS-014 a non-Admin cannot change it');
select drs_as('26760000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_dsr_stock_issue(true, 'all')$$, 'AC-DRS-014 an Admin turns it on');
select throws_ok($$select public.set_dsr_stock_issue(true, 'bogus')$$, 'P0001', null, 'AC-DRS-014 a bad scope is refused');
reset role;
select is((select count(*)::int from audit_events where action = 'dsr.stock_issue'), 1, 'AC-DRS-014 one audit row');

-- ── AC-DRS-002 posts, AC-DRS-006 a non-keeper validator, marker cleared ───────────────────────────────────
insert into ids select 'ok', drs_make('26760000-0000-0000-0000-0000000000e2', (now() at time zone 'UTC')::date - 2, jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 4)));
select drs_as('26760000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.dsr_validate((select v from ids where k = 'ok'))$$, 'AC-DRS-006 a validator who keeps no location validates and posts');
select is(coalesce(nullif(current_setting('pmo.dsr_stock_post', true), ''), 'off'), 'off', 'AC-DRS-006 the marker is not left set after validation returns');
reset role;
select is((select status from daily_site_reports where id = (select v from ids where k = 'ok')), 'validated', 'AC-DRS-002 the report is validated');
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000022'), 6::numeric, 'AC-DRS-002 the ledger moved -4 at the site location');
select is((select d.work_order_id from stock_documents d join dsr_stock_postings p on p.issue_document_id = d.id where p.report_id = (select v from ids where k = 'ok')),
  '26760000-0000-0000-0000-0000000000e2'::uuid, 'AC-DRS-002 the issue names the work order');
select is((select state from dsr_stock_postings where report_id = (select v from ids where k = 'ok')), 'posted', 'AC-DRS-002 the report state is posted');
select is(drs_line_state((select v from ids where k = 'ok'), 1), 'posted', 'AC-DRS-002 the line is posted');
select is((select p.occurred_on from dsr_stock_postings p where p.report_id = (select v from ids where k = 'ok')), (now() at time zone 'UTC')::date - 2, 'AC-DRS-002 the issue is dated the work date');
select drs_as('26760000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.create_stock_document(jsonb_build_object('kind','issue','warehouse_id','26760000-0000-0000-0000-000000000031','project_id','26760000-0000-0000-0000-0000000000c1'),
  jsonb_build_array(jsonb_build_object('item_id','26760000-0000-0000-0000-000000000022','quantity',1,'boq_item_id','26760000-0000-0000-0000-0000000000f1')), true)$$,
  'P0001', 'STK_NOT_KEEPER: you do not keep this warehouse', 'AC-DRS-006 a direct client post by a non-keeper is still refused');
reset role;

-- ── AC-DRS-008 idempotence: the trigger function fired again, nothing doubles ─────────────────────────────
select lives_ok($$select public.dsr_post_stock((select v from ids where k = 'ok'))$$, 'AC-DRS-008 posting again is accepted');
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000022'), 6::numeric, 'AC-DRS-008 nothing posted twice');
select is((select count(*)::int from dsr_stock_postings where report_id = (select v from ids where k = 'ok')), 1, 'AC-DRS-008 one posting row');
select throws_ok($$insert into dsr_stock_postings (org_id, report_id, state) values ('26760000-0000-0000-0000-00000000000a', (select v from ids where k = 'ok'), 'posted')$$, '23505', null, 'AC-DRS-008 a second posting row per report is refused by the table');

-- ── AC-DRS-009 correction reverses once, then re-posts; AC-DRS-010 no second reversal ─────────────────────
select drs_as('26760000-0000-0000-0000-0000000000a3');
insert into ids select 'corr', public.dsr_correct((select v from ids where k = 'ok'), 'rods miscounted');
select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'corr'), 'work_order_id', '26760000-0000-0000-0000-0000000000e2',
  'work_date', (now() at time zone 'UTC')::date - 2, 'consumables', jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 3))));
select public.dsr_submit((select v from ids where k = 'corr'));
select drs_as('26760000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.dsr_validate((select v from ids where k = 'corr'))$$, 'AC-DRS-009 the correction validates');
reset role;
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000022'), 7::numeric, 'AC-DRS-009 start 10 less the corrected 3');
select is(drs_docs('return'), 1, 'AC-DRS-009 one return document');
select is((select count(*)::int from stock_ledger where kind = 'return' and item_id = '26760000-0000-0000-0000-000000000022' and warehouse_id = '26760000-0000-0000-0000-000000000031'), 1, 'AC-DRS-009 the return cites the issue line once');
select ok((select reversed_at is not null and reversal_document_id is not null from dsr_stock_postings where report_id = (select v from ids where k = 'ok')), 'AC-DRS-009 the older posting is marked reversed');
select is((select count(*)::int from stock_ledger where kind = 'return' and qty_delta = 4), 1, 'AC-DRS-009 the return restores exactly 4');
select is(public.dsr_reverse_stock((select v from ids where k = 'ok')), null, 'AC-DRS-010 a second reversal is a no-op');
select is(drs_docs('return'), 1, 'AC-DRS-010 still one return document');
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000022'), 7::numeric, 'AC-DRS-010 stock unchanged');

-- ── AC-DRS-003 short stock: whole line unposted and flagged, the sibling posts, validation not blocked ───────
insert into ids select 'short', drs_make('26760000-0000-0000-0000-0000000000e5', (now() at time zone 'UTC')::date - 3,
  jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 50), drs_cons('26760000-0000-0000-0000-000000000023', 2)));
select drs_as('26760000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.dsr_validate((select v from ids where k = 'short'))$$, 'AC-DRS-003 short stock does not block validation');
reset role;
select is((select status from daily_site_reports where id = (select v from ids where k = 'short')), 'validated', 'AC-DRS-003 the report is validated');
select is(drs_line_state((select v from ids where k = 'short'), 1), 'short', 'AC-DRS-003 the short line is flagged');
select is((select l.short_by from dsr_stock_posting_lines l join dsr_consumables c on c.id = l.consumable_id where c.report_id = (select v from ids where k = 'short') and c.position = 1), 43::numeric, 'AC-DRS-003 short by 50 - 7 on hand');
select is(drs_line_state((select v from ids where k = 'short'), 2), 'posted', 'AC-DRS-003 the sibling line posted');
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000022'), 7::numeric, 'AC-DRS-003 nothing posted for the short item');
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000023'), 8::numeric, 'AC-DRS-003 the sibling left stock');
select is((select state from dsr_stock_postings where report_id = (select v from ids where k = 'short')), 'partial', 'AC-DRS-003 the report state is partial');
select ok((select count(*) = 0 from stock_balances where qty_on_hand < 0), 'AC-DRS-003 the ledger is never negative');

-- ── AC-DRS-004 no site location ───────────────────────────────────────────────────────────────────────────
insert into ids select 'noloc', drs_make('26760000-0000-0000-0000-0000000000e3', (now() at time zone 'UTC')::date - 3, jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 1)));
select drs_as('26760000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.dsr_validate((select v from ids where k = 'noloc'))$$, 'AC-DRS-004 validates without a site location');
reset role;
select is(drs_line_state((select v from ids where k = 'noloc'), 1), 'no_location', 'AC-DRS-004 the line is flagged no_location');
select is((select issue_document_id from dsr_stock_postings where report_id = (select v from ids where k = 'noloc')), null, 'AC-DRS-004 no document');

-- ── AC-DRS-013 work item: ambiguous is flagged, a named contract item posts ───────────────────────────────
insert into ids select 'amb', drs_make('26760000-0000-0000-0000-0000000000e1', (now() at time zone 'UTC')::date - 4, jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 1)));
insert into ids select 'named', drs_make('26760000-0000-0000-0000-0000000000e6', (now() at time zone 'UTC')::date - 4, jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 1, '26760000-0000-0000-0000-000000000017')));
select drs_as('26760000-0000-0000-0000-0000000000a3');
select public.dsr_validate((select v from ids where k = 'amb'));
select public.dsr_validate((select v from ids where k = 'named'));
reset role;
select is(drs_line_state((select v from ids where k = 'amb'), 1), 'no_work_item', 'AC-DRS-013 several contract items and none named: flagged');
select is(drs_line_state((select v from ids where k = 'named'), 1), 'posted', 'AC-DRS-013 a named contract item posts');
select is((select sl.boq_item_id from stock_document_lines sl join dsr_stock_posting_lines l on l.issue_line_id = sl.id join dsr_consumables c on c.id = l.consumable_id where c.report_id = (select v from ids where k = 'named')),
  '26760000-0000-0000-0000-0000000000f2'::uuid, 'AC-DRS-013 the issue line carries that item''s work item');

-- ── AC-DRS-005 scope: consumables only ───────────────────────────────────────────────────────────────────
select drs_as('26760000-0000-0000-0000-0000000000a1');
select public.set_dsr_stock_issue(true, 'consumables');
reset role;
insert into ids select 'scope', drs_make('26760000-0000-0000-0000-0000000000e2', (now() at time zone 'UTC')::date - 5,
  jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 1), drs_cons('26760000-0000-0000-0000-000000000023', 1)));
select drs_as('26760000-0000-0000-0000-0000000000a3');
select public.dsr_validate((select v from ids where k = 'scope'));
reset role;
select is(drs_line_state((select v from ids where k = 'scope'), 1), 'posted', 'AC-DRS-005 a flagged consumable posts');
select is(drs_line_state((select v from ids where k = 'scope'), 2), 'not_stocked', 'AC-DRS-005 an unflagged item is not stocked');
select is(drs_oh('26760000-0000-0000-0000-000000000031', '26760000-0000-0000-0000-000000000023'), 8::numeric, 'AC-DRS-005 the unflagged item stayed');
select drs_as('26760000-0000-0000-0000-0000000000a1');
select public.set_dsr_stock_issue(true, 'all');
reset role;

-- ── AC-DRS-017 a work date older than 31 days is dated the validation day ────────────────────────────────
insert into ids select 'old', drs_make('26760000-0000-0000-0000-0000000000e2', (now() at time zone 'UTC')::date - 40, jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 1)));
select drs_as('26760000-0000-0000-0000-0000000000a3');
select public.dsr_validate((select v from ids where k = 'old'));
reset role;
select is((select occurred_on from dsr_stock_postings where report_id = (select v from ids where k = 'old')), (now() at time zone 'UTC')::date, 'AC-DRS-017 dated the validation day');
select is(drs_line_state((select v from ids where k = 'old'), 1), 'posted', 'AC-DRS-017 and it still posts');

-- ── AC-DRS-007 an engine refusal never blocks validation (project no longer Ongoing) ─────────────────────
insert into ids select 'closed', drs_make('26760000-0000-0000-0000-0000000000e4', (now() at time zone 'UTC')::date - 3, jsonb_build_array(drs_cons('26760000-0000-0000-0000-000000000022', 1)));
reset role;
update projects set status = 'On Hold' where id = '26760000-0000-0000-0000-0000000000c3';
select drs_as('26760000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.dsr_validate((select v from ids where k = 'closed'))$$, 'AC-DRS-007 validates though the engine refuses the issue');
reset role;
select is(drs_line_state((select v from ids where k = 'closed'), 1), 'failed', 'AC-DRS-007 the line is failed');
select like((select l.reason from dsr_stock_posting_lines l join dsr_consumables c on c.id = l.consumable_id where c.report_id = (select v from ids where k = 'closed')), 'STK_PROJECT_NOT_ACTIVE%', 'AC-DRS-007 with the engine code');
select is(drs_oh('26760000-0000-0000-0000-000000000034', '26760000-0000-0000-0000-000000000022'), 10::numeric, 'AC-DRS-007 nothing posted');

-- ── AC-DRS-011 nothing posted earlier: no return; setting off later: still reverses, posts nothing new ─────
select drs_as('26760000-0000-0000-0000-0000000000a3');
insert into ids select 'corr_noloc', public.dsr_correct((select v from ids where k = 'noloc'), 'late fix');
select public.dsr_submit((select v from ids where k = 'corr_noloc'));
select drs_as('26760000-0000-0000-0000-0000000000a1');
select public.dsr_validate((select v from ids where k = 'corr_noloc'));
reset role;
select is(drs_docs('return'), 1, 'AC-DRS-011 no return document when the older version posted nothing');
select drs_as('26760000-0000-0000-0000-0000000000a1');
select public.set_dsr_stock_issue(false, null);
reset role;
select drs_as('26760000-0000-0000-0000-0000000000a3');
insert into ids select 'corr_off', public.dsr_correct((select v from ids where k = 'named'), 'quantity wrong');
select public.dsr_submit((select v from ids where k = 'corr_off'));
select drs_as('26760000-0000-0000-0000-0000000000a1');
select public.dsr_validate((select v from ids where k = 'corr_off'));
reset role;
select is(drs_docs('return'), 2, 'AC-DRS-011 with the setting off the earlier issue is still returned');
select is((select count(*)::int from dsr_stock_postings where report_id = (select v from ids where k = 'corr_off')), 0, 'AC-DRS-011 and nothing new is posted');

-- ── AC-DRS-016 isolation ─────────────────────────────────────────────────────────────────────────────────
select drs_as('26760000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from dsr_stock_postings), 0, 'AC-DRS-016 another organisation sees no posting rows');
select is((select count(*)::int from dsr_stock_posting_lines), 0, 'AC-DRS-016 nor lines');
select throws_ok($$select public.dsr_stock_status((select v from ids where k = 'ok'))$$, 'P0002', null, 'AC-DRS-016 nor the status of a foreign report');
select drs_as('26760000-0000-0000-0000-0000000000a2');
select is((public.dsr_stock_status((select v from ids where k = 'short'))->>'state'), 'partial', 'the status read returns the state');
select is(jsonb_array_length(public.dsr_stock_status((select v from ids where k = 'short'))->'lines'), 2, 'the status read returns each line');
select throws_ok($$insert into dsr_stock_postings (org_id, report_id, state) values ('26760000-0000-0000-0000-00000000000a', (select v from ids where k = 'short'), 'posted')$$, '42501', null, 'a client cannot write a posting row');
reset role;
select * from finish();
rollback;
