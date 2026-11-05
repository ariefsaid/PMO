-- #1802 — ERP sales-item mapping is line-level metadata written through the rate-card RPC.
begin;
create extension if not exists pgtap;
select plan(32);

insert into organizations (id, name, default_currency, default_timezone) values
  ('18020000-0000-0000-0000-0000000000a1', 'TM Sales Item Org A', 'IDR', 'UTC'),
  ('18020000-0000-0000-0000-0000000000a2', 'TM Sales Item Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('18020000-0000-0000-0000-0000000000b1', 'tm-sales-finance@example.test'),
  ('18020000-0000-0000-0000-0000000000b2', 'tm-sales-pm@example.test'),
  ('18020000-0000-0000-0000-0000000000b3', 'tm-sales-foreign@example.test'),
  ('18020000-0000-0000-0000-0000000000b4', 'tm-sales-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18020000-0000-0000-0000-0000000000b1', '18020000-0000-0000-0000-0000000000a1', 'TM Sales Finance', 'tm-sales-finance@example.test', 'Finance', 'active'),
  ('18020000-0000-0000-0000-0000000000b2', '18020000-0000-0000-0000-0000000000a1', 'TM Sales PM', 'tm-sales-pm@example.test', 'Project Manager', 'active'),
  ('18020000-0000-0000-0000-0000000000b3', '18020000-0000-0000-0000-0000000000a2', 'TM Sales Foreign Finance', 'tm-sales-foreign@example.test', 'Finance', 'active'),
  ('18020000-0000-0000-0000-0000000000b4', '18020000-0000-0000-0000-0000000000a1', 'TM Sales Admin', 'tm-sales-admin@example.test', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('18020000-0000-0000-0000-0000000000c1', '18020000-0000-0000-0000-0000000000a1', 'TM Sales Project A', 'Ongoing Project', 'IDR'),
  ('18020000-0000-0000-0000-0000000000c2', '18020000-0000-0000-0000-0000000000a2', 'TM Sales Project B', 'Ongoing Project', 'IDR'),
  ('18020000-0000-0000-0000-0000000000c3', '18020000-0000-0000-0000-0000000000a1', 'TM Sales Project A Other', 'Ongoing Project', 'IDR');

create temp table _sales_item_state (id text primary key, result jsonb not null) on commit drop;
grant all on _sales_item_state to authenticated;

select has_column('public', 'contract_rate_lines', 'sales_item_code', 'AC-TM-018 rate lines store a nullable ERP sales-item code');

set local role authenticated;
set local request.jwt.claims = '{"sub":"18020000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$insert into _sales_item_state select 'first', save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e1","project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"LABOUR-ERP"}')$q$,
  'AC-TM-018 Finance saves the ERP item mapping through the rate-card RPC');
select is((select sales_item_code from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  'LABOUR-ERP', 'AC-TM-018 the current rate line exposes its saved sales item');

select lives_ok($q$update _sales_item_state set result = save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"LABOUR-ERP-2"}') where id='first'$q$,
  'AC-TM-018 Finance changes a mapping without changing the commercial rate');
select is((select (result->>'changed')::boolean from _sales_item_state where id='first'), true,
  'AC-TM-018 a mapping-only change reports changed');
select is((select count(*)::int from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1'), 1,
  'AC-TM-018 a mapping-only change does not create a rate version');
select is((select sales_item_code from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  'LABOUR-ERP-2', 'AC-TM-018 the mapping-only change is applied to the current rate line');

select lives_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"ITEM-NOT-IN-CATALOG"}')$q$,
  'AC-TM-018 the setter stores an item code without claiming it exists in ERP');
select is((select sales_item_code from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  'ITEM-NOT-IN-CATALOG', 'AC-TM-018 ERP item existence remains the invoice preflight authority');
select lives_ok($q$select save_contract_rate_line(
  '{"org_id":"18020000-0000-0000-0000-0000000000a2","line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"ITEM-WITH-FOREIGN-PAYLOAD-ORG"}')$q$,
  'AC-TM-018 a payload org_id cannot move the rate line mapping to another org');
select ok((select org_id = '18020000-0000-0000-0000-0000000000a1' and sales_item_code = 'ITEM-WITH-FOREIGN-PAYLOAD-ORG'
  from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  'AC-TM-018 the rate-line row org remains the mapping org');
select throws_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":1,"expected_sales_item_code":"ITEM-NOT-IN-CATALOG","project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"STALE-ITEM"}')$q$,
  '40001', null, 'AC-TM-018 a stale item mapping cannot overwrite a concurrent mapping change');

select lives_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e2","project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Survey crew","unit":"hour","rate":40000,"currency":"IDR","effective_from":"2026-11-01"}')$q$,
  'AC-TM-018 Finance creates a second line for an atomic proposed-map save');
select lives_ok($q$insert into _sales_item_state select 'bulk', save_contract_rate_line(
  '[{"line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"LABOUR-BULK"},{"line_key":"18020000-0000-0000-0000-0000000000e2","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Survey crew","unit":"hour","rate":40000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"SURVEY-BULK"}]')$q$,
  'AC-TM-018 one RPC saves multiple proposed mappings');
select is(jsonb_array_length((select result from _sales_item_state where id='bulk')), 2,
  'AC-TM-018 the bulk RPC returns each saved line result');
select ok((select count(*) = 2 from public.contract_rate_lines where is_current and line_key in (
  '18020000-0000-0000-0000-0000000000e1', '18020000-0000-0000-0000-0000000000e2') and sales_item_code in ('LABOUR-BULK','SURVEY-BULK')),
  'AC-TM-018 both proposed mappings are applied by the single bulk call');

set local request.jwt.claims = '{"sub":"18020000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e2","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Survey crew","unit":"hour","rate":40000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"SURVEY-ADMIN"}')$q$,
  'AC-TM-018 Admin can save the same ERP item mapping as Finance');

set local request.jwt.claims = '{"sub":"18020000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e3","project_id":"18020000-0000-0000-0000-0000000000c2","kind":"labour","label":"Foreign project","unit":"hour","rate":1,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"FOREIGN-ITEM"}')$q$,
  'P0002', null, 'AC-TM-018 Finance cannot assign a mapping through a foreign-org project');
select throws_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e3","project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Bad code","unit":"hour","rate":1,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"bad\ncode"}')$q$,
  '22023', null, 'AC-TM-018 item codes with control characters are refused');

set local request.jwt.claims = '{"sub":"18020000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-11-01","sales_item_code":"PM-ITEM"}')$q$,
  '42501', null, 'AC-TM-018 a Project Manager cannot change an ERP item mapping');

set local request.jwt.claims = '{"sub":"18020000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":1,"project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":55000,"currency":"IDR","effective_from":"2026-12-01"}')$q$,
  'AC-TM-018 saving a future rate version may omit its item mapping');
select is((select sales_item_code from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  'LABOUR-BULK', 'AC-TM-018 a normal rate version carries the mapping forward');
select is((select version from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current), 2,
  'AC-TM-018 only the commercial rate change creates a new version');
select lives_ok($q$select end_contract_rate_line(
  '18020000-0000-0000-0000-0000000000c1', '18020000-0000-0000-0000-0000000000e1', '2026-12-31', 2)$q$,
  'AC-TM-018 ending a mapped rate line creates its final version');
select is((select sales_item_code from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  'LABOUR-BULK', 'AC-TM-018 ending a mapped rate line keeps its sales item on the new current version');

reset role;
insert into public.contract_rate_lines (id, org_id, project_id, line_key, version, is_current, kind, label, unit, rate, effective_from, created_by) values
  ('18020000-0000-0000-0000-0000000000f1', '18020000-0000-0000-0000-0000000000a1', '18020000-0000-0000-0000-0000000000c3', '18020000-0000-0000-0000-0000000000e1', 1, true, 'labour', 'Other Site engineer', 'hour', 50000, '2026-12-01', '18020000-0000-0000-0000-0000000000b1');
set local request.jwt.claims = '{"sub":"18020000-0000-0000-0000-0000000000b3","role":"authenticated"}';
insert into public.contract_rate_lines (id, org_id, project_id, line_key, version, is_current, kind, label, unit, rate, effective_from, created_by) values
  ('18020000-0000-0000-0000-0000000000f2', '18020000-0000-0000-0000-0000000000a2', '18020000-0000-0000-0000-0000000000c2', '18020000-0000-0000-0000-0000000000e1', 1, true, 'labour', 'Foreign Site engineer', 'hour', 50000, '2026-12-01', '18020000-0000-0000-0000-0000000000b3');
reset role;
select is((select count(*)::int from public.contract_rate_lines where id='18020000-0000-0000-0000-0000000000f1'), 1,
  'AC-TM-018 prepares another project rate with the same line key');
select is((select count(*)::int from public.contract_rate_lines where id='18020000-0000-0000-0000-0000000000f2'), 1,
  'AC-TM-018 prepares an equivalent rate line in another organization');
set local request.jwt.claims = '{"sub":"18020000-0000-0000-0000-0000000000b1","role":"authenticated"}';
set local role authenticated;
select lives_ok($q$select save_contract_rate_line(
  '{"line_key":"18020000-0000-0000-0000-0000000000e1","expected_version":3,"expected_sales_item_code":"LABOUR-BULK","project_id":"18020000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":55000,"currency":"IDR","effective_from":"2026-12-01","effective_to":"2026-12-31","sales_item_code":"TARGET-MAP"}')$q$,
  'AC-TM-018 updates a mapping on its selected rate line');
select is((select sales_item_code from public.contract_rate_lines where org_id='18020000-0000-0000-0000-0000000000a1' and project_id='18020000-0000-0000-0000-0000000000c1' and line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  'TARGET-MAP', 'AC-TM-018 an in-place mapping update changes the selected rate line');
select is((select count(*)::int from public.contract_rate_lines where line_key='18020000-0000-0000-0000-0000000000e1' and is_current and sales_item_code is null
       and org_id='18020000-0000-0000-0000-0000000000a1' and project_id='18020000-0000-0000-0000-0000000000c3'),
  1, 'AC-TM-018 an in-place mapping update leaves another project rate line unchanged');

reset role;
select is((select sales_item_code from public.contract_rate_lines where org_id='18020000-0000-0000-0000-0000000000a2' and project_id='18020000-0000-0000-0000-0000000000c2' and line_key='18020000-0000-0000-0000-0000000000e1' and is_current),
  null::text, 'AC-TM-018 an in-place mapping update leaves another organization rate line unchanged');
select ok(exists(select 1 from public.audit_events where action='contract_rate_line.item_map'
  and entity_id = (select id from public.contract_rate_lines where org_id='18020000-0000-0000-0000-0000000000a1' and project_id='18020000-0000-0000-0000-0000000000c1' and line_key='18020000-0000-0000-0000-0000000000e1' and is_current)
  and detail ? 'before' and detail ? 'after'), 'AC-TM-018 mapping changes are audited');

select * from finish();
rollback;
