-- 2290_daily_report_validate_roles.test.sql — Admin assigns the daily_report_validate capability to job roles per organisation.
-- Spec: docs/specs/daily-report-validate-roles.spec.md (AC-DRVR-001..003, AC-DRVR-007, AC-DRVR-008).
-- MUTATION NOTES (break the rule in 2290; the named assertion must go red; restore):
--   mut:dsr_validate_roles_admin .... 'AC-DRVR-002 a non-Admin cannot assign daily_report_validate roles'
--   mut:dsr_validate_roles_light .... 'AC-DRVR-002 a field account is refused before the Admin check'
--   mut:dsr_validate_roles_valid .... 'AC-DRVR-002 a field role is refused'
--   mut:dsr_validate_roles_on ....... 'AC-DRVR-002 naming roles while built-in roles are off is refused'
--   mut:dsr_validate_org_role ....... 'AC-DRVR-003 a holder of an assigned job role validates another person''s report end-to-end'
--   mut:dsr_queue_revenue_mask ...... 'AC-DRVR-007 dsr_validation_queue masks total_revenue for a validator without revenue permission'
--   mut:dsr_route_validate_roles .... 'AC-DRVR-008 sole-Admin author with an assigned supervisor resolves as job_roles instead of nobody'
begin;
create extension if not exists pgtap;
select plan(29);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('22900000-0000-0000-0000-00000000000a', 'DRVR Org A', 'IDR', 'UTC', true),
  ('22900000-0000-0000-0000-00000000000b', 'DRVR Org B', 'IDR', 'UTC', true),
  ('22900000-0000-0000-0000-00000000000c', 'DRVR Org Off', 'IDR', 'UTC', false),
  ('22900000-0000-0000-0000-00000000000d', 'DRVR Org Sole Admin', 'IDR', 'UTC', true);

insert into auth.users (id, email)
select ('22900000-0000-0000-0000-0000000000' || k)::uuid, 'drvr-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','b1','b2','c1','d1','d2']) k;

insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('22900000-0000-0000-0000-0000000000a1', '22900000-0000-0000-0000-00000000000a', 'Admin A',      'drvr-a1@example.com', 'Admin',           'active', null),
  ('22900000-0000-0000-0000-0000000000a2', '22900000-0000-0000-0000-00000000000a', 'Supervisor A', 'drvr-a2@example.com', 'Engineer',        'active', 'site_supervisor'),
  ('22900000-0000-0000-0000-0000000000a3', '22900000-0000-0000-0000-00000000000a', 'PCM A',        'drvr-a3@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('22900000-0000-0000-0000-0000000000a4', '22900000-0000-0000-0000-00000000000a', 'QS A',         'drvr-a4@example.com', 'Engineer',        'active', 'quantity_surveyor'),
  ('22900000-0000-0000-0000-0000000000a5', '22900000-0000-0000-0000-00000000000a', 'PM A',         'drvr-a5@example.com', 'Project Manager', 'active', null),
  ('22900000-0000-0000-0000-0000000000a6', '22900000-0000-0000-0000-00000000000a', 'Field A',      'drvr-a6@example.com', 'Engineer',        'active', 'field_user'),
  ('22900000-0000-0000-0000-0000000000b1', '22900000-0000-0000-0000-00000000000b', 'Admin B',      'drvr-b1@example.com', 'Admin',           'active', null),
  ('22900000-0000-0000-0000-0000000000b2', '22900000-0000-0000-0000-00000000000b', 'Supervisor B', 'drvr-b2@example.com', 'Engineer',        'active', 'site_supervisor'),
  ('22900000-0000-0000-0000-0000000000c1', '22900000-0000-0000-0000-00000000000c', 'Admin C',      'drvr-c1@example.com', 'Admin',           'active', null),
  ('22900000-0000-0000-0000-0000000000d1', '22900000-0000-0000-0000-00000000000d', 'Sole Admin D', 'drvr-d1@example.com', 'Admin',           'active', 'administrator'),
  ('22900000-0000-0000-0000-0000000000d2', '22900000-0000-0000-0000-00000000000d', 'Supervisor D', 'drvr-d2@example.com', 'Engineer',        'active', 'site_supervisor');

insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('22900000-0000-0000-0000-0000000000ca', '22900000-0000-0000-0000-00000000000a', 'DRVR Proj A', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '22900000-0000-0000-0000-0000000000a5'),
  ('22900000-0000-0000-0000-0000000000cb', '22900000-0000-0000-0000-00000000000b', 'DRVR Proj B', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, null),
  ('22900000-0000-0000-0000-0000000000cd', '22900000-0000-0000-0000-00000000000d', 'DRVR Proj D', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, null);

insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('22900000-0000-0000-0000-00000000003a', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-0000000000ca', 'DRVR WO A', 'Issued', 10000, 'exclusive', 0),
  ('22900000-0000-0000-0000-00000000003b', '22900000-0000-0000-0000-00000000000b', '22900000-0000-0000-0000-0000000000cb', 'DRVR WO B', 'Issued', 10000, 'exclusive', 0),
  ('22900000-0000-0000-0000-00000000003d', '22900000-0000-0000-0000-00000000000d', '22900000-0000-0000-0000-0000000000cd', 'DRVR WO D', 'Issued', 10000, 'exclusive', 0);

insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('22900000-0000-0000-0000-00000000007a', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-0000000000ca', 'L-1', 'Priced pipe lay', 'm', 100, 100),
  ('22900000-0000-0000-0000-00000000007d', '22900000-0000-0000-0000-00000000000d', '22900000-0000-0000-0000-0000000000cd', 'L-D', 'Priced trench',   'm', 100, 80);

insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('22900000-0000-0000-0000-00000000008a', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-00000000003a', '22900000-0000-0000-0000-00000000007a', 100),
  ('22900000-0000-0000-0000-00000000008d', '22900000-0000-0000-0000-00000000000d', '22900000-0000-0000-0000-00000000003d', '22900000-0000-0000-0000-00000000007d', 100);

insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, author_id, status, submitted_at) values
  ('22900000-0000-0000-0000-000000000051', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-0000000000ca',
   '22900000-0000-0000-0000-00000000003a', current_date - 1, '22900000-0000-0000-0000-0000000000a4', 'submitted', now()),
  ('22900000-0000-0000-0000-000000000052', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-0000000000ca',
   '22900000-0000-0000-0000-00000000003a', current_date - 2, '22900000-0000-0000-0000-0000000000a2', 'submitted', now()),
  ('22900000-0000-0000-0000-000000000053', '22900000-0000-0000-0000-00000000000b', '22900000-0000-0000-0000-0000000000cb',
   '22900000-0000-0000-0000-00000000003b', current_date - 1, '22900000-0000-0000-0000-0000000000b1', 'submitted', now()),
  ('22900000-0000-0000-0000-000000000054', '22900000-0000-0000-0000-00000000000d', '22900000-0000-0000-0000-0000000000cd',
   '22900000-0000-0000-0000-00000000003d', current_date - 1, '22900000-0000-0000-0000-0000000000d1', 'submitted', now()),
  ('22900000-0000-0000-0000-000000000055', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-0000000000ca',
   '22900000-0000-0000-0000-00000000003a', current_date - 3, '22900000-0000-0000-0000-0000000000a4', 'submitted', now());

insert into dsr_progress_lines (id, org_id, report_id, position, work_order_line_id, quantity, unit) values
  ('22900000-0000-0000-0000-000000000091', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-000000000051', 1, '22900000-0000-0000-0000-00000000008a', 5, 'm'),
  ('22900000-0000-0000-0000-000000000094', '22900000-0000-0000-0000-00000000000d', '22900000-0000-0000-0000-000000000054', 1, '22900000-0000-0000-0000-00000000008d', 3, 'm'),
  ('22900000-0000-0000-0000-000000000095', '22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-000000000055', 1, '22900000-0000-0000-0000-00000000008a', 2, 'm');

insert into storage.objects (bucket_id, name, owner) values
  ('site-report-photos', '22900000-0000-0000-0000-00000000000a/22900000-0000-0000-0000-000000000051/22900000-0000-0000-0000-0000000000f1/form.jpg', '22900000-0000-0000-0000-0000000000a4'),
  ('site-report-photos', '22900000-0000-0000-0000-00000000000a/22900000-0000-0000-0000-000000000055/22900000-0000-0000-0000-0000000000f5/form.jpg', '22900000-0000-0000-0000-0000000000a4');

insert into dsr_photos (org_id, report_id, kind, file_path) values
  ('22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-000000000051', 'paper_form', '22900000-0000-0000-0000-00000000000a/22900000-0000-0000-0000-000000000051/22900000-0000-0000-0000-0000000000f1/form.jpg'),
  ('22900000-0000-0000-0000-00000000000a', '22900000-0000-0000-0000-000000000055', 'paper_form', '22900000-0000-0000-0000-00000000000a/22900000-0000-0000-0000-000000000055/22900000-0000-0000-0000-0000000000f5/form.jpg');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"22900000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.validate(p_user text, p_report text) returns text language sql as $$
  select pg_temp.err(p_user, format('select dsr_validate(%L)', '22900000-0000-0000-0000-0000000000' || p_report)) $$;

create function pg_temp.queue_revenue(p_user text, p_report text) returns numeric language plpgsql as $$
declare v_rev numeric;
begin
  perform set_config('request.jwt.claims', '{"sub":"22900000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select q.total_revenue into v_rev
    from public.dsr_validation_queue() q
   where q.report_id = ('22900000-0000-0000-0000-0000000000' || p_report)::uuid;
  execute 'reset role';
  return v_rev;
end $$;

create function pg_temp.queue_has(p_user text, p_report text) returns boolean language plpgsql as $$
declare v_has boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"22900000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select exists (
    select 1 from public.dsr_validation_queue() q
     where q.report_id = ('22900000-0000-0000-0000-0000000000' || p_report)::uuid
  ) into v_has;
  execute 'reset role';
  return v_has;
end $$;

create function pg_temp.queue_waiting(p_user text, p_report text) returns boolean language plpgsql as $$
declare v_wait boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"22900000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select q.waiting_for_validator into v_wait
    from public.dsr_validation_queue() q
   where q.report_id = ('22900000-0000-0000-0000-0000000000' || p_report)::uuid;
  execute 'reset role';
  return v_wait;
end $$;

create function pg_temp.route(p_user text, p_report text) returns jsonb language plpgsql as $$
declare v_route jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"22900000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select public.get_dsr_validation_route(('22900000-0000-0000-0000-0000000000' || p_report)::uuid) into v_route;
  execute 'reset role';
  return v_route;
end $$;

-- ── AC-DRVR-001: defaults unchanged ───────────────────────────────────────────────────────────────────────────────────────────────
select is((select daily_report_validate_roles from organizations where id = '22900000-0000-0000-0000-00000000000a'), '{}'::text[],
  'AC-DRVR-001 daily_report_validate_roles defaults to empty');
select is(pg_temp.validate('a2', '51'), '42501 you cannot validate site reports on this project',
  'AC-DRVR-001 a Site Supervisor does not validate by default');
select is(pg_temp.validate('a5', '55'), 'ok',
  'AC-DRVR-001 the project''s own manager still validates a complete report by default');

-- ── AC-DRVR-002: Admin-only setter, input validation, tenant isolation ────────────────────────────────────────────────────────────
select ok(pg_temp.err('a3', $$select set_daily_report_validate_roles(array['site_supervisor'])$$) like '42501 DSR_VALIDATE_ROLE_ADMIN:%',
  'AC-DRVR-002 a non-Admin cannot assign daily_report_validate roles');
select ok(pg_temp.err('a6', $$select set_daily_report_validate_roles(array['site_supervisor'])$$) like '42501 LIGHT_ACCOUNT:%',
  'AC-DRVR-002 a field account is refused before the Admin check');
select ok(pg_temp.err('a1', $$update organizations set daily_report_validate_roles = array['site_supervisor'] where id = '22900000-0000-0000-0000-00000000000a'$$) like '42501 %',
  'AC-DRVR-002 direct table update on daily_report_validate_roles is not granted to authenticated');
select ok(pg_temp.err('a1', $$select set_daily_report_validate_roles(array['field_user'])$$) like '22023 DSR_VALIDATE_ROLE_INVALID:%',
  'AC-DRVR-002 a field role is refused');
select ok(pg_temp.err('a1', $$select set_daily_report_validate_roles(array['not_a_role'])$$) like '22023 DSR_VALIDATE_ROLE_INVALID:%',
  'AC-DRVR-002 an unknown role key is refused');
select ok(pg_temp.err('c1', $$select set_daily_report_validate_roles(array['site_supervisor'])$$) like 'P0001 DSR_VALIDATE_ROLE_OFF:%',
  'AC-DRVR-002 naming roles while built-in roles are off is refused');

select is(pg_temp.err('a1', $$select set_daily_report_validate_roles(array['site_supervisor', 'site_supervisor'])$$), 'ok',
  'AC-DRVR-002 an Admin saves deduplicated sorted validate roles for their organisation');
select is((select daily_report_validate_roles from organizations where id = '22900000-0000-0000-0000-00000000000a'), array['site_supervisor']::text[],
  'AC-DRVR-002 the organisation stores the assigned role');
select is((select daily_report_validate_roles from organizations where id = '22900000-0000-0000-0000-00000000000b'), '{}'::text[],
  'AC-DRVR-002 another organisation''s roles are untouched');

-- ── AC-DRVR-007: queue revenue boundary (before validating report 51) ─────────────────────────────────────────────────────────────
select is(pg_temp.queue_revenue('a1', '51'), 500.00::numeric,
  'AC-DRVR-007 an Admin still receives the numeric total_revenue in dsr_validation_queue');
select ok(pg_temp.queue_has('a2', '51'),
  'AC-DRVR-007 an assigned Site Supervisor sees the submitted report in dsr_validation_queue');
select is(pg_temp.queue_revenue('a2', '51'), null::numeric,
  'AC-DRVR-007 dsr_validation_queue masks total_revenue for a validator without revenue permission');
select is(pg_temp.err('a2', $$select * from dsr_report_revenue('22900000-0000-0000-0000-000000000051')$$),
  '42501 you cannot see revenue on this project',
  'AC-DRVR-007 dsr_report_revenue still refuses a validator without revenue permission');

-- ── AC-DRVR-003: end-to-end validation, author SoD, unassigned & cross-tenant refusals ───────────────────────────────────────────
select is(pg_temp.validate('a3', '51'), '42501 you cannot validate site reports on this project',
  'AC-DRVR-003 an unassigned job role in the same organisation still cannot validate');
select is(pg_temp.validate('a2', '51'), 'ok',
  'AC-DRVR-003 a holder of an assigned job role validates another person''s report end-to-end');
select is((select status from daily_site_reports where id = '22900000-0000-0000-0000-000000000051'), 'validated',
  'AC-DRVR-003 dsr_validate transitions the report status to validated');
select is((select validated_by from daily_site_reports where id = '22900000-0000-0000-0000-000000000051'),
  '22900000-0000-0000-0000-0000000000a2'::uuid,
  'AC-DRVR-003 dsr_validate records the assigned job-role validator');
select ok(exists (
    select 1 from dsr_events
     where report_id = '22900000-0000-0000-0000-000000000051'
       and action = 'validated'
       and actor_id = '22900000-0000-0000-0000-0000000000a2'),
  'AC-DRVR-003 dsr_validate logs the validated event');
select is((select frozen_amount from dsr_progress_lines where id = '22900000-0000-0000-0000-000000000091'), 500.00::numeric,
  'AC-DRVR-003 dsr_validate freezes the progress line amount');
select is(pg_temp.validate('a2', '52'), '42501 the author of a report cannot validate it',
  'AC-DRVR-003 the author still never validates their own report');
select is(pg_temp.err('a2', $$select dsr_return('22900000-0000-0000-0000-000000000052', 'redo')$$), '42501 you cannot return this report',
  'AC-DRVR-003 the author still never returns their own report');
select is(pg_temp.validate('b2', '53'), '42501 you cannot validate site reports on this project',
  'AC-DRVR-003 the same job role in another organisation still cannot validate');

-- ── AC-DRVR-008: validation route projection for assigned validator job roles ─────────────────────────────────────────────────────
select is(pg_temp.route('d1', '54'), '{"approvers":[],"route_kind":"nobody"}'::jsonb,
  'AC-DRVR-008 before assigning a role, sole-Admin author with no PM or Finance reads as nobody');
select is(pg_temp.err('d1', $$select set_daily_report_validate_roles(array['site_supervisor'])$$), 'ok',
  'AC-DRVR-008 sole Admin in Org D assigns site_supervisor');
select is(pg_temp.route('d1', '54'),
  '{"approvers":[],"route_kind":"job_roles","validate_roles":["site_supervisor"]}'::jsonb,
  'AC-DRVR-008 sole-Admin author with an assigned supervisor resolves as job_roles instead of nobody');
select is(pg_temp.queue_waiting('d2', '54'), false,
  'AC-DRVR-008 dsr_validation_queue marks waiting_for_validator false when an assigned supervisor is active');

select * from finish();
rollback;
