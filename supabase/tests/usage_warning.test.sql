-- usage_warning.test.sql — usage warning on INSTALLED material, told to the work order's responsible person (else the project manager).
-- Spec docs/specs/usage-warning.spec.md. Migrations under test: 1860-1862 (the request-time warning, 1330-1333, stays proven by mrq_usage_thresholds.test.sql).
-- AC-UW-001..009, 017, 018; each assertion names its AC.
--
-- MUTATION CHECKS (break the marked line, the named assertion MUST go red, then restore):
--   mut:usage_installed_only (1862 usage_installed_qty, site_reports branch): drop the status/superseded/archived filter -> AC-UW-007 and AC-UW-004 red
--   mut:usage_source (1862, stock_issues branch): count the site-report sum instead                                    -> AC-UW-009 red
--   mut:usage_unset (1862 usage_check_work_order): replace the `v_pct is null` return with `v_pct := coalesce(v_pct, 0);`  -> AC-UW-005 red
--      (merely deleting the return is not enough: the not-null column on pct still stops the insert, a second line of defence)
--   mut:usage_share (1862): change `>=` to `<`                                                                        -> AC-UW-001 red
--   mut:usage_once (1862): drop the unique constraint and the `on conflict` clause                                     -> AC-UW-003 red (the file errors on the duplicate row)
--   mut:usage_never_blocks (1862 usage_check_safe): delete the exception block                                         -> AC-UW-017 red
--   the supersede clause of daily_site_reports_zz_usage_check: fire on a correction's own validation instead           -> AC-UW-004 red
--   usage_warning_recipient: return the project manager first                                                          -> AC-UW-001 red
--   mut:usage_source_admin (1861): replace the role test with `false`                                                  -> AC-UW-008 red
begin;
create extension if not exists pgtap;
select plan(44);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26860000-0000-0000-0000-00000000010a', 'UW Org', 'IDR', 'Asia/Jakarta'), ('26860000-0000-0000-0000-00000000010b', 'UW Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('26860000-0000-0000-0000-0000000001a1', 'uw-admin@example.com'), ('26860000-0000-0000-0000-0000000001a2', 'uw-eng@example.com'), ('26860000-0000-0000-0000-0000000001a3', 'uw-pm@example.com'),
  ('26860000-0000-0000-0000-0000000001a4', 'uw-eng3@example.com'), ('26860000-0000-0000-0000-0000000001a5', 'uw-eng2@example.com'), ('26860000-0000-0000-0000-0000000001a6', 'uw-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26860000-0000-0000-0000-0000000001a1', '26860000-0000-0000-0000-00000000010a', 'UW Admin', 'uw-admin@example.com', 'Admin', 'active'),
  ('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-00000000010a', 'UW Eng', 'uw-eng@example.com', 'Engineer', 'active'),
  ('26860000-0000-0000-0000-0000000001a3', '26860000-0000-0000-0000-00000000010a', 'UW PM', 'uw-pm@example.com', 'Project Manager', 'active'),
  ('26860000-0000-0000-0000-0000000001a4', '26860000-0000-0000-0000-00000000010a', 'UW Eng Three', 'uw-eng3@example.com', 'Engineer', 'active'),
  ('26860000-0000-0000-0000-0000000001a5', '26860000-0000-0000-0000-00000000010a', 'UW Eng Two', 'uw-eng2@example.com', 'Engineer', 'active'),
  ('26860000-0000-0000-0000-0000000001a6', '26860000-0000-0000-0000-00000000010b', 'UW Other', 'uw-other@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26860000-0000-0000-0000-0000000001d1', '26860000-0000-0000-0000-00000000010a', 'UW Site', 'Ongoing Project', '26860000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-0000000001d1', 'UW WO', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26860000-0000-0000-0000-000000001201', '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001201', 10);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26860000-0000-0000-0000-000000001301', '26860000-0000-0000-0000-00000000010a', 'BAG', 'Bag', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26860000-0000-0000-0000-000000001311', '26860000-0000-0000-0000-00000000010a', 'I1', 'Item 1', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001312', '26860000-0000-0000-0000-00000000010a', 'I2', 'Item 2', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001313', '26860000-0000-0000-0000-00000000010a', 'I3', 'Item 3', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001314', '26860000-0000-0000-0000-00000000010a', 'I4', 'Item 4', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001315', '26860000-0000-0000-0000-00000000010a', 'I5', 'Item 5', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001316', '26860000-0000-0000-0000-00000000010a', 'I6', 'Item 6', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001317', '26860000-0000-0000-0000-00000000010a', 'I7', 'Item 7', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001318', '26860000-0000-0000-0000-00000000010a', 'I8', 'Item 8', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001319', '26860000-0000-0000-0000-00000000010a', 'I9', 'Item 9', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-00000000131a', '26860000-0000-0000-0000-00000000010a', 'I10', 'Item ten (no allowance)', '26860000-0000-0000-0000-000000001301');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity)
  select '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-000000001201', i.id, 100 from stock_items i where i.org_id = '26860000-0000-0000-0000-00000000010a' and i.code <> 'I10';
insert into stock_warehouses (id, org_id, code, name, kind) values ('26860000-0000-0000-0000-000000001501', '26860000-0000-0000-0000-00000000010a', 'UWC', 'UW central', 'central');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- A submitted report with one material line.
create or replace function pg_temp._rep(p_id uuid, p_author uuid, p_day date, p_item uuid, p_qty numeric, p_sup uuid default null) returns void
  language plpgsql as $$
begin
  insert into public.daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, supersedes_id, correction_reason)
  values (p_id, '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-0000000001d1', '26860000-0000-0000-0000-000000001401', p_day, 'submitted', p_author, now(), p_sup, case when p_sup is null then null else 'fix' end);
  insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit) values ('26860000-0000-0000-0000-00000000010a', p_id, 1, p_item, p_qty, 'BAG');
end $$;
-- Validation as dsr_validate does it: the status update, then (for a correction) the version it replaces is superseded.
create or replace function pg_temp._val(p_id uuid) returns void language plpgsql as $$
declare v_sup uuid;
begin
  update public.daily_site_reports set status = 'validated', validated_by = '26860000-0000-0000-0000-0000000001a3', validated_at = clock_timestamp() where id = p_id returning supersedes_id into v_sup;
  if v_sup is not null then update public.daily_site_reports set superseded_at = now() where id = v_sup and superseded_at is null; end if;
end $$;
-- A report inserted already validated: no UPDATE, so no check runs for it.
create or replace function pg_temp._rep_validated(p_id uuid, p_author uuid, p_day date, p_item uuid, p_qty numeric) returns void
  language plpgsql as $$
begin
  insert into public.daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at, validated_by, validated_at)
  values (p_id, '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-0000000001d1', '26860000-0000-0000-0000-000000001401', p_day, 'validated', p_author, now(), '26860000-0000-0000-0000-0000000001a3', now());
  insert into public.dsr_consumables (org_id, report_id, position, stock_item_id, quantity, unit) values ('26860000-0000-0000-0000-00000000010a', p_id, 1, p_item, p_qty, 'BAG');
end $$;
-- A posted issue or return to the work order: the ledger row is written first, then the document turns Posted (as stock_post_core does).
create or replace function pg_temp._post(p_id uuid, p_kind text, p_num text, p_item uuid, p_qty numeric) returns void language plpgsql as $$
declare v_line uuid := gen_random_uuid();
begin
  insert into public.stock_documents (id, org_id, number, kind, status, warehouse_id, project_id, occurred_on, created_by, work_order_id)
  values (p_id, '26860000-0000-0000-0000-00000000010a', p_num, p_kind, 'Draft', '26860000-0000-0000-0000-000000001501', '26860000-0000-0000-0000-0000000001d1', current_date, '26860000-0000-0000-0000-0000000001a1', '26860000-0000-0000-0000-000000001401');
  insert into public.stock_document_lines (id, org_id, document_id, line_no, item_id, quantity) values (v_line, '26860000-0000-0000-0000-00000000010a', p_id, 1, p_item, p_qty);
  insert into public.stock_ledger (org_id, document_id, line_id, item_id, warehouse_id, project_id, kind, qty_delta, value_delta, qty_after, value_after, occurred_on, posted_by)
  values ('26860000-0000-0000-0000-00000000010a', p_id, v_line, p_item, '26860000-0000-0000-0000-000000001501', '26860000-0000-0000-0000-0000000001d1', p_kind, case p_kind when 'issue' then -p_qty else p_qty end, 0, 0, 0, current_date, '26860000-0000-0000-0000-0000000001a1');
  update public.stock_documents set status = 'Posted', posted_by = '26860000-0000-0000-0000-0000000001a1', posted_at = now() where id = p_id;
end $$;
create or replace function pg_temp._alerts(p_item uuid) returns integer language sql as $$
  select count(*)::int from public.material_installed_usage_alerts where work_order_id = '26860000-0000-0000-0000-000000001401' and item_id = p_item $$;
create or replace function pg_temp._told(p_user uuid) returns integer language sql as $$
  select count(*)::int from public.notifications where owner_id = p_user and title = 'Installed material usage reached' $$;

-- ── AC-UW-005 default off ──────────────────────────────────────────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002001', '26860000-0000-0000-0000-0000000001a4', date '2026-12-01', '26860000-0000-0000-0000-000000001311', 95);
select pg_temp._val('26860000-0000-0000-0000-000000002001');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001311'), 0, 'AC-UW-005 with the threshold unset no warning is recorded');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a3') + pg_temp._told('26860000-0000-0000-0000-0000000001a2'), 0, 'AC-UW-005 with the threshold unset nobody is notified');

-- ── AC-UW-008 the source setting ───────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select throws_ok($$ select public.set_usage_installed_source('requests') $$, 'P0001', null, 'AC-UW-008 an unknown source is refused');
select lives_ok($$ select public.set_usage_installed_source('site_reports') $$, 'AC-UW-008 an Admin sets the source');
select lives_ok($$ select public.mrq_set_usage_thresholds(80, null) $$, 'an Admin sets the first threshold to 80');
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.set_usage_installed_source('stock_issues') $$, '42501', null, 'AC-UW-008 a non-Admin cannot change the source');
select pg_temp._as('26860000-0000-0000-0000-0000000001a6');
select lives_ok($$ select public.set_usage_installed_source('stock_issues') $$, 'AC-UW-008 an Admin of another organisation changes only their own source');
reset role;
select is((select usage_installed_source from public.material_request_settings where org_id = '26860000-0000-0000-0000-00000000010a'), 'site_reports', 'AC-UW-008 this organisation''s source is unchanged');

-- ── AC-UW-002 no responsible person: the project manager is told ───────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002002', '26860000-0000-0000-0000-0000000001a4', date '2026-12-02', '26860000-0000-0000-0000-000000001312', 85);
select pg_temp._val('26860000-0000-0000-0000-000000002002');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001312'), 1, 'AC-UW-002 installed 85 of plan 100 at 80 percent records one warning');
select is((select notified_user_id from public.material_installed_usage_alerts where item_id = '26860000-0000-0000-0000-000000001312'), '26860000-0000-0000-0000-0000000001a3'::uuid, 'AC-UW-002 with no responsible person the project manager is told');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001311'), 1, 'AC-UW-005 a standing crossing from before the threshold was set is raised at the next change');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a3'), 2, 'AC-UW-002 the project manager has two notifications (items one and two)');

-- ── AC-UW-001 the responsible person is told ───────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a3');
select lives_ok($$ select public.set_work_order_responsible_person('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-0000000001a2') $$, 'the project manager names the site engineer');
reset role;
select pg_temp._rep('26860000-0000-0000-0000-000000002003', '26860000-0000-0000-0000-0000000001a4', date '2026-12-03', '26860000-0000-0000-0000-000000001313', 85);
select pg_temp._val('26860000-0000-0000-0000-000000002003');
select is((select notified_user_id from public.material_installed_usage_alerts where item_id = '26860000-0000-0000-0000-000000001313'), '26860000-0000-0000-0000-0000000001a2'::uuid, 'AC-UW-001 the responsible person is told, not the project manager');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a2'), 1, 'AC-UW-001 the responsible person has one notification');
select ok((select body like '%80%%' and body like '%Go and check%' from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a2' and title = 'Installed material usage reached'),
  'AC-UW-001 the notification names the share and says to go and check');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a3'), 2, 'AC-UW-001 the project manager is not told about this one');

-- ── AC-UW-007 only installed counts ────────────────────────────────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002004', '26860000-0000-0000-0000-0000000001a4', date '2026-12-04', '26860000-0000-0000-0000-000000001314', 500);
select is(public.usage_installed_qty('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001314'), 0::numeric, 'AC-UW-007 a submitted, unvalidated report is not installed');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001314'), 0, 'AC-UW-007 and raises nothing');

-- ── AC-UW-004 a correction replaces the version it supersedes ─────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002005', '26860000-0000-0000-0000-0000000001a4', date '2026-12-05', '26860000-0000-0000-0000-000000001315', 50);
select pg_temp._val('26860000-0000-0000-0000-000000002005');
select pg_temp._rep('26860000-0000-0000-0000-000000002006', '26860000-0000-0000-0000-0000000001a4', date '2026-12-05', '26860000-0000-0000-0000-000000001315', 60, '26860000-0000-0000-0000-000000002005');
select pg_temp._val('26860000-0000-0000-0000-000000002006');
select is(public.usage_installed_qty('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001315'), 60::numeric, 'AC-UW-004 installed is the correction (60), not both versions (110)');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001315'), 0, 'AC-UW-004 a correction from 50 to 60 does not reach 80 by counting both versions');
select pg_temp._rep('26860000-0000-0000-0000-000000002007', '26860000-0000-0000-0000-0000000001a4', date '2026-12-05', '26860000-0000-0000-0000-000000001315', 85, '26860000-0000-0000-0000-000000002006');
select pg_temp._val('26860000-0000-0000-0000-000000002007');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001315'), 1, 'AC-UW-004 a correction to 85 reaches 80 and records one warning');
select is((select installed_qty from public.material_installed_usage_alerts where item_id = '26860000-0000-0000-0000-000000001315'), 85::numeric, 'AC-UW-004 the warning holds installed 85');

-- ── AC-UW-003 once per work order and item ────────────────────────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002008', '26860000-0000-0000-0000-0000000001a4', date '2026-12-06', '26860000-0000-0000-0000-000000001312', 10);
select pg_temp._val('26860000-0000-0000-0000-000000002008');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001312'), 1, 'AC-UW-003 another report for the item raises no second warning');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a3'), 2, 'AC-UW-003 and no second notification');
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_usage_thresholds(50, null) $$, 'an Admin lowers the first threshold to 50');
reset role;
select pg_temp._rep('26860000-0000-0000-0000-000000002009', '26860000-0000-0000-0000-0000000001a4', date '2026-12-07', '26860000-0000-0000-0000-000000001312', 1);
select pg_temp._val('26860000-0000-0000-0000-000000002009');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001312'), 1, 'AC-UW-003 a lowered threshold does not raise an item again');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a3'), 2, 'AC-UW-003 and sends nothing more to the project manager');

-- ── AC-UW-006 plan 0 ──────────────────────────────────────────────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002010', '26860000-0000-0000-0000-0000000001a4', date '2026-12-08', '26860000-0000-0000-0000-00000000131a', 1);
select pg_temp._val('26860000-0000-0000-0000-000000002010');
select is((select plan_qty from public.material_installed_usage_alerts where item_id = '26860000-0000-0000-0000-00000000131a'), 0::numeric, 'AC-UW-006 an item with no plan and any installed quantity is past the share');

-- ── AC-UW-002 a responsible person who is no longer active: the project manager is told ─────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a3');
select lives_ok($$ select public.set_work_order_responsible_person('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-0000000001a5') $$, 'the project manager names another site engineer');
reset role;
update public.profiles set status = 'disabled' where id = '26860000-0000-0000-0000-0000000001a5';
select pg_temp._rep('26860000-0000-0000-0000-000000002011', '26860000-0000-0000-0000-0000000001a4', date '2026-12-09', '26860000-0000-0000-0000-000000001316', 90);
select pg_temp._val('26860000-0000-0000-0000-000000002011');
select is((select notified_user_id from public.material_installed_usage_alerts where item_id = '26860000-0000-0000-0000-000000001316'), '26860000-0000-0000-0000-0000000001a3'::uuid, 'AC-UW-002 a disabled responsible person falls back to the project manager');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a5'), 0, 'AC-UW-002 the disabled person has no notification');

-- ── AC-UW-018 archiving a report runs the check ───────────────────────────────────────────────────
select pg_temp._rep_validated('26860000-0000-0000-0000-000000002012', '26860000-0000-0000-0000-0000000001a4', date '2026-12-10', '26860000-0000-0000-0000-000000001318', 90);
select pg_temp._rep_validated('26860000-0000-0000-0000-000000002013', '26860000-0000-0000-0000-0000000001a4', date '2026-12-11', '26860000-0000-0000-0000-000000001318', 1);
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001318'), 0, 'AC-UW-018 reports inserted already validated raise nothing by themselves');
update public.daily_site_reports set archived_at = now() where id = '26860000-0000-0000-0000-000000002013';
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001318'), 1, 'AC-UW-018 archiving a report checks the work order');

-- ── AC-UW-009 stock issues as the source ──────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.set_usage_installed_source('stock_issues') $$, 'AC-UW-009 an Admin switches the source to stock issues');
reset role;
select pg_temp._rep_validated('26860000-0000-0000-0000-000000002014', '26860000-0000-0000-0000-0000000001a4', date '2026-12-12', '26860000-0000-0000-0000-000000001319', 500);
select pg_temp._post('26860000-0000-0000-0000-000000003001', 'issue', 'UW-ISS-1', '26860000-0000-0000-0000-000000001319', 85);
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001319'), 1, 'AC-UW-009 a posted issue to the work order records the warning (site reports are not counted)');
select is((select source from public.material_installed_usage_alerts where item_id = '26860000-0000-0000-0000-000000001319'), 'stock_issues', 'AC-UW-009 the warning names its source');
select pg_temp._post('26860000-0000-0000-0000-000000003002', 'return', 'UW-RET-1', '26860000-0000-0000-0000-000000001319', 20);
select is(public.usage_installed_qty('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001319'), 65::numeric, 'AC-UW-009 installed is issues less returns (85 - 20), ignoring the 500 on a site report');

-- ── AC-UW-017 a failing check never blocks validating or posting ─────────────────────────────────────
create or replace function public.usage_check_work_order(p_work_order uuid) returns void language plpgsql as $$
begin raise exception 'forced check failure'; end $$;
select pg_temp._rep('26860000-0000-0000-0000-000000002015', '26860000-0000-0000-0000-0000000001a4', date '2026-12-13', '26860000-0000-0000-0000-000000001311', 1);
select lives_ok($$ select pg_temp._val('26860000-0000-0000-0000-000000002015') $$, 'AC-UW-017 a report validates although the check fails');
select is((select status from public.daily_site_reports where id = '26860000-0000-0000-0000-000000002015'), 'validated', 'AC-UW-017 and is validated');
select lives_ok($$ select pg_temp._post('26860000-0000-0000-0000-000000003003', 'issue', 'UW-ISS-2', '26860000-0000-0000-0000-000000001311', 1) $$, 'AC-UW-017 an issue posts although the check fails');
select is((select status from public.stock_documents where id = '26860000-0000-0000-0000-000000003003'), 'Posted', 'AC-UW-017 and is posted');

-- ── AC-UW-008 reads are the organisation's own ──────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a6');
select is((select count(*)::int from public.material_installed_usage_alerts), 0, 'AC-UW-008 another organisation reads no warnings');
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select ok((select count(*) from public.material_installed_usage_alerts) >= 5, 'AC-UW-008 a member reads their organisation''s warnings');

select * from finish();
rollback;
