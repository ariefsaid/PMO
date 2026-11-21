-- 1340_work_order_issue_threshold.test.sql — #2674 (spec docs/specs/material-issued-vs-progress.spec.md). Migration under test: 1340.
-- AC-MIP-001 default off · 002 Admin saves, clears, audit, range · 003 every other role refused.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26740000-0000-0000-0000-00000000010a', 'MIP Org', 'IDR', 'UTC'), ('26740000-0000-0000-0000-00000000010b', 'MIP Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26740000-0000-0000-0000-0000000001a1', 'mip-admin@example.com'), ('26740000-0000-0000-0000-0000000001a2', 'mip-fin@example.com'),
  ('26740000-0000-0000-0000-0000000001a3', 'mip-pm@example.com'), ('26740000-0000-0000-0000-0000000001a4', 'mip-eng@example.com'), ('26740000-0000-0000-0000-0000000001b1', 'mip-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26740000-0000-0000-0000-0000000001a1', '26740000-0000-0000-0000-00000000010a', 'MIP Admin', 'mip-admin@example.com', 'Admin', 'active'),
  ('26740000-0000-0000-0000-0000000001a2', '26740000-0000-0000-0000-00000000010a', 'MIP Fin',   'mip-fin@example.com',   'Finance', 'active'),
  ('26740000-0000-0000-0000-0000000001a3', '26740000-0000-0000-0000-00000000010a', 'MIP PM',    'mip-pm@example.com',    'Project Manager', 'active'),
  ('26740000-0000-0000-0000-0000000001a4', '26740000-0000-0000-0000-00000000010a', 'MIP Eng',   'mip-eng@example.com',   'Engineer', 'active'),
  ('26740000-0000-0000-0000-0000000001b1', '26740000-0000-0000-0000-00000000010b', 'MIP XAdmin','mip-xadmin@example.com','Admin', 'active');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._thr(p_org uuid) returns text language sql security definer as $$
  select coalesce((select issue_progress_threshold_pct::text from public.work_order_stock_settings where org_id = p_org), 'none') $$;
grant execute on function pg_temp._thr(uuid) to authenticated;

create or replace function pg_temp._audits(p_org uuid) returns int language sql security definer as $$
  select count(*)::int from public.audit_events where action = 'work_order_issue_threshold.set' and org_id = p_org $$;
grant execute on function pg_temp._audits(uuid) to authenticated;

set local role authenticated;
select pg_temp._as('26740000-0000-0000-0000-0000000001a1');
select is(pg_temp._thr('26740000-0000-0000-0000-00000000010a'), 'none', 'AC-MIP-001 a new organisation has no settings row (off)');
select is((select count(*)::int from work_order_stock_settings), 0, 'AC-MIP-001 an Admin sees no row for it either');

select is(public.set_work_order_issue_threshold(20), 20.00::numeric, 'AC-MIP-002 an Admin saves 20');
select is(pg_temp._thr('26740000-0000-0000-0000-00000000010a'), '20.00', 'AC-MIP-002 the row holds 20.00');
select is((select updated_by::text from work_order_stock_settings), '26740000-0000-0000-0000-0000000001a1', 'AC-MIP-002 the row is stamped with who saved it');
select is(pg_temp._audits('26740000-0000-0000-0000-00000000010a'), 1, 'AC-MIP-002 one audit row');
select throws_ok('select public.set_work_order_issue_threshold(-1)', '22023', null, 'AC-MIP-002 -1 is refused');
select throws_ok('select public.set_work_order_issue_threshold(101)', '22023', null, 'AC-MIP-002 101 is refused');
select is(public.set_work_order_issue_threshold(null), null::numeric, 'AC-MIP-002 an Admin clears it');
select is(pg_temp._thr('26740000-0000-0000-0000-00000000010a'), null, 'AC-MIP-002 the figure is null again (off)');

select pg_temp._as('26740000-0000-0000-0000-0000000001a2');
select throws_ok('select public.set_work_order_issue_threshold(30)', '42501', 'only an Admin sets the issued-versus-progress threshold', 'AC-MIP-003 Finance is refused');
select pg_temp._as('26740000-0000-0000-0000-0000000001a3');
select throws_ok('select public.set_work_order_issue_threshold(30)', '42501', 'only an Admin sets the issued-versus-progress threshold', 'AC-MIP-003 a Project Manager is refused');
select pg_temp._as('26740000-0000-0000-0000-0000000001a4');
select throws_ok('select public.set_work_order_issue_threshold(30)', '42501', 'only an Admin sets the issued-versus-progress threshold', 'AC-MIP-003 an Engineer is refused');
select throws_ok('insert into work_order_stock_settings (org_id, issue_progress_threshold_pct) values (''26740000-0000-0000-0000-00000000010a'', 5)', '42501', null, 'AC-MIP-003 no direct client write');

select * from finish();
rollback;
