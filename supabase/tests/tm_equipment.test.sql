-- tm_equipment.test.sql — #1514 T5: client rates for approved equipment usage.
-- The fixture is synthetic; internal equipment costing and customer billing stay separate.
begin;
create extension if not exists pgtap;
select plan(30);

insert into organizations (id, name, default_currency, default_timezone) values
  ('06800000-0000-0000-0000-0000000000a1', 'TM Equipment Org A', 'IDR', 'UTC'),
  ('06800000-0000-0000-0000-0000000000a2', 'TM Equipment Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('06800000-0000-0000-0000-0000000000b1', 'tm-equip-finance@example.com'),
  ('06800000-0000-0000-0000-0000000000b2', 'tm-equip-pm@example.com'),
  ('06800000-0000-0000-0000-0000000000b3', 'tm-equip-admin@example.com'),
  ('06800000-0000-0000-0000-0000000000b4', 'tm-equip-author@example.com'),
  ('06800000-0000-0000-0000-0000000000b5', 'tm-equip-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06800000-0000-0000-0000-0000000000b1', '06800000-0000-0000-0000-0000000000a1', 'TM Equipment Finance', 'tm-equip-finance@example.com', 'Finance', 'active'),
  ('06800000-0000-0000-0000-0000000000b2', '06800000-0000-0000-0000-0000000000a1', 'TM Equipment PM', 'tm-equip-pm@example.com', 'Project Manager', 'active'),
  ('06800000-0000-0000-0000-0000000000b3', '06800000-0000-0000-0000-0000000000a1', 'TM Equipment Admin', 'tm-equip-admin@example.com', 'Admin', 'active'),
  ('06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000a1', 'TM Equipment Author', 'tm-equip-author@example.com', 'Engineer', 'active'),
  ('06800000-0000-0000-0000-0000000000b5', '06800000-0000-0000-0000-0000000000a2', 'TM Equipment Foreign Admin', 'tm-equip-foreign@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('06800000-0000-0000-0000-0000000000c1', '06800000-0000-0000-0000-0000000000a1', 'TM Equipment Project', 'Ongoing Project', '06800000-0000-0000-0000-0000000000b2', 'IDR'),
  ('06800000-0000-0000-0000-0000000000c2', '06800000-0000-0000-0000-0000000000a2', 'TM Equipment Foreign Project', 'Ongoing Project', null, 'IDR');
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('06800000-0000-0000-0000-0000000000d1', '06800000-0000-0000-0000-0000000000a1', 'TM-EQ-1', 'TM Excavator', 'hours'),
  ('06800000-0000-0000-0000-0000000000d2', '06800000-0000-0000-0000-0000000000a1', 'TM-EQ-2', 'TM Loader', 'hours'),
  ('06800000-0000-0000-0000-0000000000d9', '06800000-0000-0000-0000-0000000000a2', 'TM-EQ-X', 'Foreign Asset', 'hours');
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('06800000-0000-0000-0000-0000000000f1', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000c1', 'Contract', 'TM equipment sign-off', 'Approved', '06800000-0000-0000-0000-0000000000b1', '06800000-0000-0000-0000-0000000000a1/06800000-0000-0000-0000-0000000000c1/06800000-0000-0000-0000-0000000000f1/tm-equipment.pdf');

create temp table _state (k text primary key, v text) on commit drop;
grant all on _state to authenticated;
create function pg_temp.st(p_key text) returns text language sql as $$ select v from _state where k = p_key $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return v;
exception when undefined_column or undefined_function or undefined_table then
  return 'missing';
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;
create function pg_temp.capture_claim(p_key text, p_project uuid, p_from date, p_to date) returns text language plpgsql as $$
declare v_claim uuid;
begin
  v_claim := public.assemble_tm_claim(p_project, p_from, p_to, null, null);
  insert into _state(k, v) values (p_key, v_claim::text);
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line('{"line_key":"06800000-0000-0000-0000-0000000000e1","project_id":"06800000-0000-0000-0000-0000000000c1","kind":"equipment","asset_id":"06800000-0000-0000-0000-0000000000d1","label":"TM Excavator","unit":"hour","rate":800000,"currency":"IDR","effective_from":"2026-01-01"}')$q$,
  'AC-TM-015 a customer equipment work rate can be saved for an org asset');
select lives_ok($q$select save_contract_rate_line('{"line_key":"06800000-0000-0000-0000-0000000000e2","project_id":"06800000-0000-0000-0000-0000000000c1","kind":"equipment","asset_id":"06800000-0000-0000-0000-0000000000d2","label":"TM Loader","unit":"hour","rate":800000,"standby_rate":200000,"sales_item_code":"TM-EQ-ERP","currency":"IDR","effective_from":"2026-01-01"}')$q$,
  'AC-TM-015 a customer standby rate can be saved separately');
select lives_ok($q$select end_contract_rate_line('06800000-0000-0000-0000-0000000000c1', '06800000-0000-0000-0000-0000000000e2', '2026-12-31', 1)$q$,
  'AC-TM-015 ending an equipment rate creates its final version');
select is((select asset_id::text || ':' || standby_rate::text || ':' || sales_item_code
            from contract_rate_lines where line_key = '06800000-0000-0000-0000-0000000000e2' and is_current),
  '06800000-0000-0000-0000-0000000000d2:200000.00:TM-EQ-ERP',
  'AC-TM-015 ending an equipment rate preserves its asset, standby price, and ERP mapping');
select ok(pg_temp.err('select save_contract_rate_line(''{"line_key":"06800000-0000-0000-0000-0000000000e3","project_id":"06800000-0000-0000-0000-0000000000c1","kind":"equipment","asset_id":"06800000-0000-0000-0000-0000000000d1","label":"Duplicate asset rate","unit":"hour","rate":900000,"currency":"IDR","effective_from":"2026-01-01"}'')') like '23505:%',
  'AC-TM-015 one current customer rate card line per equipment asset avoids ambiguous pricing');
select throws_ok($q$select save_contract_rate_line('{"line_key":"06800000-0000-0000-0000-0000000000e9","project_id":"06800000-0000-0000-0000-0000000000c1","kind":"equipment","asset_id":"06800000-0000-0000-0000-0000000000d9","label":"Foreign Asset","unit":"hour","rate":800000,"currency":"IDR","effective_from":"2026-01-01"}')$q$,
  'P0002', null, 'AC-TM-015 a rate cannot target another org asset');
reset role;

insert into equipment_costing_settings (org_id, asset_id, setting_key, version, is_current, basis, work_rate, rate_unit,
                                        charge_category, effective_from, created_by)
values ('06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d1',
        '06800000-0000-0000-0000-0000000000e8', 1, true, 'hire_rate', 50000, 'hours', 'Equipment', '2026-01-01',
        '06800000-0000-0000-0000-0000000000b1');
update equipment_costing_settings set work_rate = 60000 where setting_key = '06800000-0000-0000-0000-0000000000e8';

insert into equipment_usage_entries (id, org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at) values
  ('06800000-0000-0000-0000-000000000101', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d1', '06800000-0000-0000-0000-0000000000c1', '2026-11-02', 24, 'hours', 'work', 'Approved', '06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000b1', now()),
  ('06800000-0000-0000-0000-000000000102', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d1', '06800000-0000-0000-0000-0000000000c1', '2026-11-03', 16, 'hours', 'work', 'Approved', '06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000b1', now()),
  ('06800000-0000-0000-0000-000000000103', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d1', '06800000-0000-0000-0000-0000000000c1', '2026-11-02', 6, 'hours', 'standby', 'Approved', '06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000b1', now()),
  ('06800000-0000-0000-0000-000000000104', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d1', '06800000-0000-0000-0000-0000000000c1', '2026-11-04', 2, 'hours', 'work', 'Draft', '06800000-0000-0000-0000-0000000000b4', null, null),
  ('06800000-0000-0000-0000-000000000105', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d1', '06800000-0000-0000-0000-0000000000c1', '2026-11-05', 3, 'hours', 'work', 'Rejected', '06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000b1', null),
  ('06800000-0000-0000-0000-000000000111', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d2', '06800000-0000-0000-0000-0000000000c1', '2026-11-07', 24, 'hours', 'work', 'Approved', '06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000b1', now()),
  ('06800000-0000-0000-0000-000000000112', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d2', '06800000-0000-0000-0000-0000000000c1', '2026-11-08', 16, 'hours', 'work', 'Approved', '06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000b1', now()),
  ('06800000-0000-0000-0000-000000000113', '06800000-0000-0000-0000-0000000000a1', '06800000-0000-0000-0000-0000000000d2', '06800000-0000-0000-0000-0000000000c1', '2026-11-07', 6, 'hours', 'standby', 'Approved', '06800000-0000-0000-0000-0000000000b4', '06800000-0000-0000-0000-0000000000b1', now());

select has_column('public', 'tm_claim_lines', 'basis', 'T5 gives frozen claim lines an explicit work/standby basis');
set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(pg_temp.sc('select basis || '':'' || units || '':'' || unrated_reason || '':'' || coalesce(amount::text, '''')
             from preview_tm_claim(''06800000-0000-0000-0000-0000000000c1'', ''2026-11-01'', ''2026-11-05'')
            where line_key = ''06800000-0000-0000-0000-0000000000e1'' and basis = ''standby'''),
  'standby:6.00:no_standby_rate:', 'AC-TM-015 the 6 standby hours remain visible and unbilled');
select is(pg_temp.capture_claim('no_standby_rate', '06800000-0000-0000-0000-0000000000c1', '2026-11-01', '2026-11-05'), 'ok',
  'AC-TM-015 assembly succeeds for approved usage with no standby rate');
select is((select gross_amount from tm_claims where id = pg_temp.st('no_standby_rate')::uuid), 32000000.00::numeric,
  'AC-TM-015 40 work hours at 800,000.00 bill 32,000,000.00');
select is(pg_temp.sc(format('select basis || '':'' || units || ''x'' || rate || ''='' || amount from tm_claim_lines
            where claim_id = %L::uuid and basis = ''work''', pg_temp.st('no_standby_rate'))),
  'work:40.00x800000.00=32000000.00', 'AC-TM-015 the frozen work line keeps the customer rate');
select is((select count(*)::int from tm_claim_sources where claim_id = pg_temp.st('no_standby_rate')::uuid), 2,
  'AC-TM-015 only the two approved work entries are selected when standby is unrated');
reset role;
select is((select count(*)::int from tm_assignable_sources('06800000-0000-0000-0000-0000000000c1', '2026-11-01', '2026-11-10')
            where source_id in ('06800000-0000-0000-0000-000000000104', '06800000-0000-0000-0000-000000000105')),
  0, 'AC-TM-015 Draft and Rejected usage are not assignable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(pg_temp.sc(format('select rate::text from tm_claim_lines where claim_id = %L::uuid and basis = ''work''', pg_temp.st('no_standby_rate'))),
  '800000.00', 'AC-TM-015 changing the internal hire rate does not change the frozen customer rate');
select is(pg_temp.sc(format('select basis || '':'' || entry_date::text from list_tm_claim_source_details(%L::uuid) limit 1', pg_temp.st('no_standby_rate'))),
  'work:2026-11-02', 'D1 source details preserve the work basis and equipment usage date');

set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select ok(pg_temp.err('select archive_equipment_usage(''06800000-0000-0000-0000-000000000101'')')
            like '55000:%' || pg_temp.st('no_standby_rate') || '%',
  'AC-TM-008 a live equipment source cannot be archived and names its claim');
select ok(pg_temp.err('select transition_equipment_usage(''06800000-0000-0000-0000-000000000101'', ''Draft'')')
            like '55000:%' || pg_temp.st('no_standby_rate') || '%',
  'AC-TM-008 a live equipment source cannot be reopened and names its claim');
reset role;
update equipment_usage_entries set status = 'Approved', approved_at = now()
 where id = '06800000-0000-0000-0000-000000000101';
set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($q$select withdraw_tm_signoff(pg_temp.st('no_standby_rate')::uuid)$q$,
  'AC-TM-008 withdrawing the claim releases equipment sources');
set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select transition_equipment_usage('06800000-0000-0000-0000-000000000101', 'Draft')$q$,
  'AC-TM-008 an Admin can reopen the usage after claim withdrawal');
select lives_ok($q$select archive_equipment_usage('06800000-0000-0000-0000-000000000101')$q$,
  'AC-TM-008 an Admin can archive the reopened usage after claim withdrawal');
select is((select archived_at is not null from equipment_usage_entries where id = '06800000-0000-0000-0000-000000000101'), true,
  'AC-TM-008 the released source is archived');

set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(pg_temp.sc('select string_agg(basis, '','' order by basis) from preview_tm_claim(''06800000-0000-0000-0000-0000000000c1'', ''2026-11-07'', ''2026-11-08'')
            where line_key = ''06800000-0000-0000-0000-0000000000e2'' and unrated_reason is null'),
  'standby,work', 'AC-TM-015 preview keeps the two billable bases distinct');
select is(pg_temp.capture_claim('with_standby_rate', '06800000-0000-0000-0000-0000000000c1', '2026-11-07', '2026-11-08'), 'ok',
  'AC-TM-015 assembly succeeds for an asset with a standby rate');
select is((select gross_amount from tm_claims where id = pg_temp.st('with_standby_rate')::uuid), 33200000.00::numeric,
  'AC-TM-015 the 40 work and 6 standby hours use their separate rates');
select is(pg_temp.sc(format('select string_agg(basis || '':'' || units || ''x'' || rate || ''='' || amount, '','' order by basis) from tm_claim_lines
            where claim_id = %L::uuid', pg_temp.st('with_standby_rate'))),
  'standby:6.00x200000.00=1200000.00,work:40.00x800000.00=32000000.00',
  'AC-TM-015 the claim freezes distinct work and standby lines');
select is(pg_temp.sc(format('select count(*)::text from list_tm_claim_source_details(%L::uuid) where basis in (''work'',''standby'')',
                            pg_temp.st('with_standby_rate'))),
  '3', 'D1 equipment source details identify each selected basis');
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('with_standby_rate')::uuid, '06800000-0000-0000-0000-0000000000f1', 'Equipment acceptance')$q$,
  'equipment claim sign-off can be prepared');
set local role authenticated;
set local request.jwt.claims = '{"sub":"06800000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('with_standby_rate')::uuid)$q$,
  'equipment claim sign-off validates approved sources and frozen bases');
select is((select status from tm_claims where id = pg_temp.st('with_standby_rate')::uuid), 'SignedOff',
  'equipment claim reaches SignedOff after source validation');
select ok(pg_temp.sc(format('select (position(''"basis": "standby"'' in lines::text) > 0 and position(''"basis": "work"'' in lines::text) > 0)::text
            from list_tm_claims(''06800000-0000-0000-0000-0000000000c1'') where id = %L::uuid',
                     pg_temp.st('with_standby_rate'))) = 'true',
  'claim-list JSON retains both frozen line bases');

reset role;
select * from finish();
rollback;
