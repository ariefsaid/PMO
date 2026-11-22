-- usage_warning.test.sql — usage warning on INSTALLED material (validated site reports), told to the site engineer.
-- Spec docs/specs/usage-warning.spec.md. Migrations under test: 1860-1862. AC-UW-001..009; each assertion names its AC.
--
-- MUTATION CHECKS (run each, the named assertion MUST go red, then restore the line):
--   -- mut:usage_installed_only (1861 usage_installed_qty): drop the status/superseded/archived filter      -> AC-UW-002 (unvalidated report counted) and AC-UW-004 go red
--   -- mut:usage_unset (1861 usage_check_work_order): delete the `v_pct is null` return                      -> AC-UW-005 goes red
--   -- mut:usage_share (1861): change `>=` to `<`                                                           -> AC-UW-001 goes red
--   -- mut:usage_once (1861 unique + on conflict): drop the unique constraint                                -> AC-UW-003 goes red
--   -- mut:usage_admin (1860): replace the role test with `false`                                           -> AC-UW-008 non-Admin assertion goes red
--   -- the supersede clause of the trigger (1861): fire on validation of a correction instead                -> AC-UW-004 goes red (both versions counted)
--   -- 1862: restore the `perform public.mrq_usage_check(r.id)` line is impossible (function dropped); instead re-add a request-quantity
--      alert insert to mrq_submit                                                                            -> AC-UW-009 goes red
begin;
create extension if not exists pgtap;
select plan(39);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26860000-0000-0000-0000-00000000010a', 'UW Org', 'IDR', 'Asia/Jakarta'), ('26860000-0000-0000-0000-00000000010b', 'UW Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('26860000-0000-0000-0000-0000000001a1', 'uw-admin@example.com'), ('26860000-0000-0000-0000-0000000001a2', 'uw-eng@example.com'), ('26860000-0000-0000-0000-0000000001a3', 'uw-pm@example.com'),
  ('26860000-0000-0000-0000-0000000001a4', 'uw-off@example.com'), ('26860000-0000-0000-0000-0000000001a5', 'uw-eng2@example.com'), ('26860000-0000-0000-0000-0000000001a6', 'uw-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26860000-0000-0000-0000-0000000001a1', '26860000-0000-0000-0000-00000000010a', 'UW Admin', 'uw-admin@example.com', 'Admin', 'active'),
  ('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-00000000010a', 'UW Eng', 'uw-eng@example.com', 'Engineer', 'active'),
  ('26860000-0000-0000-0000-0000000001a3', '26860000-0000-0000-0000-00000000010a', 'UW PM', 'uw-pm@example.com', 'Project Manager', 'active'),
  ('26860000-0000-0000-0000-0000000001a4', '26860000-0000-0000-0000-00000000010a', 'UW Off', 'uw-off@example.com', 'Engineer', 'disabled'),
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
  ('26860000-0000-0000-0000-000000001311', '26860000-0000-0000-0000-00000000010a', 'I1', 'Item one',   '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001312', '26860000-0000-0000-0000-00000000010a', 'I2', 'Item two',   '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001313', '26860000-0000-0000-0000-00000000010a', 'I3', 'Item three', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001314', '26860000-0000-0000-0000-00000000010a', 'I4', 'Item four',  '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001315', '26860000-0000-0000-0000-00000000010a', 'I5', 'Item five',  '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001316', '26860000-0000-0000-0000-00000000010a', 'I6', 'Item six',   '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001317', '26860000-0000-0000-0000-00000000010a', 'I7', 'Item seven (no allowance)', '26860000-0000-0000-0000-000000001301');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity)
  select '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-000000001201', i.id, 100
    from stock_items i where i.org_id = '26860000-0000-0000-0000-00000000010a' and i.code <> 'I7';

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
create or replace function pg_temp._alerts(p_item uuid) returns integer language sql as $$
  select count(*)::int from public.material_request_usage_alerts where work_order_id = '26860000-0000-0000-0000-000000001401' and item_id = p_item $$;
create or replace function pg_temp._told(p_user uuid) returns integer language sql as $$
  select count(*)::int from public.notifications where owner_id = p_user and title = 'Installed material usage reached' $$;
create or replace function pg_temp._raise(p_by uuid, p_item uuid, p_qty numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp._as(p_by);
  v := public.mrq_save_draft(null, jsonb_build_object('work_order_id', '26860000-0000-0000-0000-000000001401', 'needed_by', '2026-12-30'),
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'over_plan_reason', 'site need')), null);
  perform public.mrq_submit(v);
  return v;
end $$;
grant execute on function pg_temp._raise(uuid, uuid, numeric) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

-- ── AC-UW-005 default off ──────────────────────────────────────────────────────────────────────────
select is((select usage_warn_pct from public.material_request_settings where org_id = '26860000-0000-0000-0000-00000000010a'), null::numeric, 'AC-UW-005 the default is unset');
select pg_temp._rep('26860000-0000-0000-0000-000000002001', '26860000-0000-0000-0000-0000000001a2', date '2026-12-01', '26860000-0000-0000-0000-000000001311', 95);
select pg_temp._val('26860000-0000-0000-0000-000000002001');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001311'), 0, 'AC-UW-005 with the threshold unset no warning is recorded');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a2'), 0, 'AC-UW-005 with the threshold unset nobody is notified');

-- ── AC-UW-008 the setting ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select throws_ok($$ select public.set_material_usage_threshold(0) $$, 'P0001', null, 'AC-UW-008 zero is refused');
select throws_ok($$ select public.set_material_usage_threshold(1001) $$, 'P0001', null, 'AC-UW-008 above 1000 is refused');
select lives_ok($$ select public.set_material_usage_threshold(80) $$, 'AC-UW-008 an Admin sets 80');
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.set_material_usage_threshold(50) $$, '42501', null, 'AC-UW-008 a non-Admin cannot set the threshold');
select pg_temp._as('26860000-0000-0000-0000-0000000001a6');
select lives_ok($$ select public.set_material_usage_threshold(null) $$, 'AC-UW-008 an Admin of another organisation changes only their own setting');
reset role;
select is((select usage_warn_pct from public.material_request_settings where org_id = '26860000-0000-0000-0000-00000000010a'), 80::numeric, 'AC-UW-008 the other organisation left this setting at 80');

-- ── AC-UW-001 the share is reached by a validated report ───────────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002002', '26860000-0000-0000-0000-0000000001a2', date '2026-12-02', '26860000-0000-0000-0000-000000001312', 85);
select pg_temp._val('26860000-0000-0000-0000-000000002002');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001312'), 1, 'AC-UW-001 installed 85 of plan 100 at an 80 percent threshold records one warning');
select is((select notified_user_id from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001312'), '26860000-0000-0000-0000-0000000001a2'::uuid, 'AC-UW-001 the warning names the report author as told');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a2'), 1, 'AC-UW-001 the report author gets one notification');
select ok((select body like '%80%%' and body like '%Go and check%' from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a2' and title = 'Installed material usage reached'),
  'AC-UW-001 the notification names the share and says to go and check');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a3'), 0, 'AC-UW-001 the project manager is not notified (engineer only)');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001311'), 0, 'AC-UW-005 a report validated before the threshold was set raised nothing');

-- ── AC-UW-002 only installed counts; AC-UW-009 a request over the share writes nothing ───────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Project Manager","label":"Billable change"}]'::jsonb) $$, 'a one-step chain');
insert into t_ids select 'req', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001313', 90);
reset role;
select is((select status from public.material_requests where id = (select v from t_ids where k = 'req')), 'pending', 'AC-UW-009 a request of 90 against plan 100 is submitted and not blocked');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001313'), 0, 'AC-UW-009 submitting a request over the share records no warning');
select pg_temp._rep('26860000-0000-0000-0000-000000002003', '26860000-0000-0000-0000-0000000001a2', date '2026-12-03', '26860000-0000-0000-0000-000000001313', 50);
select pg_temp._val('26860000-0000-0000-0000-000000002003');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001313'), 0, 'AC-UW-002 installed 50 with 90 requested stays below 80: requested quantity is not counted');
select pg_temp._rep('26860000-0000-0000-0000-000000002004', '26860000-0000-0000-0000-0000000001a2', date '2026-12-04', '26860000-0000-0000-0000-000000001313', 500);
select is(public.usage_installed_qty('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001313'), 50::numeric, 'AC-UW-002 a submitted, unvalidated report is not installed');

-- ── AC-UW-004 a correction replaces the version it supersedes ─────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002005', '26860000-0000-0000-0000-0000000001a2', date '2026-12-05', '26860000-0000-0000-0000-000000001315', 50);
select pg_temp._val('26860000-0000-0000-0000-000000002005');
select pg_temp._rep('26860000-0000-0000-0000-000000002006', '26860000-0000-0000-0000-0000000001a2', date '2026-12-05', '26860000-0000-0000-0000-000000001315', 60, '26860000-0000-0000-0000-000000002005');
select pg_temp._val('26860000-0000-0000-0000-000000002006');
select is(public.usage_installed_qty('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001315'), 60::numeric, 'AC-UW-004 installed is the correction (60), not both versions (110)');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001315'), 0, 'AC-UW-004 a correction from 50 to 60 does not reach 80 by counting both versions');
select pg_temp._rep('26860000-0000-0000-0000-000000002007', '26860000-0000-0000-0000-0000000001a5', date '2026-12-05', '26860000-0000-0000-0000-000000001315', 85, '26860000-0000-0000-0000-000000002006');
select pg_temp._val('26860000-0000-0000-0000-000000002007');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001315'), 1, 'AC-UW-004 a correction to 85 reaches 80 and records one warning');
select is((select use_qty from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001315'), 85::numeric, 'AC-UW-004 the warning holds installed 85');
select is((select notified_user_id from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001315'), '26860000-0000-0000-0000-0000000001a5'::uuid, 'AC-UW-001 the author of the report that took it over is told');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a5'), 1, 'AC-UW-001 that author has one notification');

-- ── AC-UW-003 once per work order and item ────────────────────────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002008', '26860000-0000-0000-0000-0000000001a2', date '2026-12-06', '26860000-0000-0000-0000-000000001312', 10);
select pg_temp._val('26860000-0000-0000-0000-000000002008');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001312'), 1, 'AC-UW-003 another report for the item raises no second warning');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a2'), 1, 'AC-UW-003 and no second notification');
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.set_material_usage_threshold(50) $$, 'an Admin lowers the threshold to 50');
reset role;
select pg_temp._rep('26860000-0000-0000-0000-000000002009', '26860000-0000-0000-0000-0000000001a2', date '2026-12-07', '26860000-0000-0000-0000-000000001312', 1);
select pg_temp._val('26860000-0000-0000-0000-000000002009');
select is(pg_temp._alerts('26860000-0000-0000-0000-000000001312'), 1, 'AC-UW-003 a lowered threshold does not raise the item again');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a2'), 1, 'AC-UW-003 and sends nothing more');

-- ── AC-UW-006 plan 0 ────────────────────────────────────────────────────────────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002010', '26860000-0000-0000-0000-0000000001a2', date '2026-12-08', '26860000-0000-0000-0000-000000001317', 1);
select pg_temp._val('26860000-0000-0000-0000-000000002010');
select is((select plan_qty from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001317'), 0::numeric, 'AC-UW-006 an item with no plan and any installed quantity is past the share');

-- ── AC-UW-007 an inactive author is not notified and validation still succeeds ──────────────────────
select pg_temp._rep('26860000-0000-0000-0000-000000002011', '26860000-0000-0000-0000-0000000001a4', date '2026-12-09', '26860000-0000-0000-0000-000000001316', 90);
select lives_ok($$ select pg_temp._val('26860000-0000-0000-0000-000000002011') $$, 'AC-UW-007 validation of the report succeeds');
select is((select notified_user_id from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001316'), null::uuid, 'AC-UW-007 the warning is recorded with nobody told');
select is(pg_temp._told('26860000-0000-0000-0000-0000000001a4'), 0, 'AC-UW-007 the inactive author has no notification');

-- ── AC-UW-008 reads are the organisation''s own ──────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a6');
select is((select count(*)::int from public.material_request_usage_alerts), 0, 'AC-UW-008 another organisation reads no warnings');
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select ok((select count(*) from public.material_request_usage_alerts) >= 4, 'AC-UW-008 a member reads their organisation''s warnings');
select is((select installed_qty from public.mrq_installed_for('26860000-0000-0000-0000-000000001401', array['26860000-0000-0000-0000-000000001315']::uuid[])), 85::numeric, 'AC-UW-010 the form read returns installed per item');
select pg_temp._as('26860000-0000-0000-0000-0000000001a6');
select is((select count(*)::int from public.mrq_installed_for('26860000-0000-0000-0000-000000001401', array['26860000-0000-0000-0000-000000001315']::uuid[])), 0, 'AC-UW-008 another organisation reads no installed quantity');

select * from finish();
rollback;
