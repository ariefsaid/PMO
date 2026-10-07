-- 0272_vendor_tax_defaults.test.sql — 0272 §1–§3 (#876 slice 2; OD-VWH-1; DD-VWH-11, DD-VWH-16).
-- Owns AC-VWH-020 (shape + bounds), AC-VWH-021 (who may set the defaults; audited; outside the companies ERP mirror
-- guard) and AC-VWH-022 (no other client write path; function grants).
begin;
select plan(35);

-- Fixtures, written as the table owner with NO JWT (the §2 guard lets a no-JWT session through: migrations, seed).
insert into organizations (id, name, default_currency) values
  ('08760000-0000-0000-0000-000000000201','#876 S2 Org','IDR'),
  ('08760000-0000-0000-0000-000000000202','#876 S2 Other Org','IDR');
insert into auth.users (id, email) values
  ('08760000-0000-0000-0000-0000000002a1','s2-admin@example.com'),
  ('08760000-0000-0000-0000-0000000002a2','s2-fin@example.com'),
  ('08760000-0000-0000-0000-0000000002a3','s2-pm@example.com'),
  ('08760000-0000-0000-0000-0000000002a4','s2-exec@example.com'),
  ('08760000-0000-0000-0000-0000000002a5','s2-eng@example.com'),
  ('08760000-0000-0000-0000-0000000002a6','s2-gone@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08760000-0000-0000-0000-0000000002a1','08760000-0000-0000-0000-000000000201','S2 Admin','s2-admin@example.com','Admin','active'),
  ('08760000-0000-0000-0000-0000000002a2','08760000-0000-0000-0000-000000000201','S2 Finance','s2-fin@example.com','Finance','active'),
  ('08760000-0000-0000-0000-0000000002a3','08760000-0000-0000-0000-000000000201','S2 PM','s2-pm@example.com','Project Manager','active'),
  ('08760000-0000-0000-0000-0000000002a4','08760000-0000-0000-0000-000000000201','S2 Exec','s2-exec@example.com','Executive','active'),
  ('08760000-0000-0000-0000-0000000002a5','08760000-0000-0000-0000-000000000201','S2 Eng','s2-eng@example.com','Engineer','active'),
  ('08760000-0000-0000-0000-0000000002a6','08760000-0000-0000-0000-000000000201','S2 Gone','s2-gone@example.com','Finance','disabled');
insert into companies (id, org_id, name, type) values
  ('08760000-0000-0000-0000-0000000002c1','08760000-0000-0000-0000-000000000201','#876 S2 Vendor','Vendor'),
  ('08760000-0000-0000-0000-0000000002c2','08760000-0000-0000-0000-000000000201','#876 S2 Internal','Internal'),
  ('08760000-0000-0000-0000-0000000002c3','08760000-0000-0000-0000-000000000202','#876 S2 Foreign Vendor','Vendor');

-- §A shape and bounds (AC-VWH-020): owner, no JWT, so only the CHECKs decide.
select col_type_is('public','companies','default_vat_rate','numeric(6,3)','AC-VWH-020 default_vat_rate is numeric(6,3)');
select col_type_is('public','companies','default_pph_rate','numeric(6,3)','AC-VWH-020 default_pph_rate is numeric(6,3)');
select col_type_is('public','companies','default_pph_type','text','AC-VWH-020 default_pph_type is text');
select throws_ok($$ update companies set default_vat_rate = 100.001 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a VAT rate above 100% is refused');
select throws_ok($$ update companies set default_vat_rate = 'NaN' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a NaN VAT rate is refused (the upper bound is what rejects it)');
select throws_ok($$ update companies set default_vat_rate = -0.001 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a negative VAT rate is refused');
select throws_ok($$ update companies set default_pph_type = 'pph21', default_pph_rate = 2 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 an unknown withholding type is refused');
select throws_ok($$ update companies set default_pph_type = 'pph23' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a withholding type with no rate is refused');
select throws_ok($$ update companies set default_pph_rate = 2 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a withholding rate with no type is refused');
select throws_ok($$ update companies set default_pph_type = 'pph23', default_pph_rate = 100 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a 100% withholding rate is refused');
select throws_ok($$ update companies set default_pph_type = 'pph23', default_pph_rate = 0 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a 0% withholding rate is refused (no withholding is type none)');
select lives_ok($$ update companies set default_vat_rate = 0, default_pph_type = 'pph4_2', default_pph_rate = 1.75
                   where id = '08760000-0000-0000-0000-0000000002c1' $$,
  'AC-VWH-020 a non-VAT vendor (0%) withholding PPh 4(2) at 1.75% is accepted');

-- §B set_vendor_tax_defaults (AC-VWH-021)
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 11, 'pph23', 2) $$,
  'AC-VWH-021 Finance sets a vendor''s tax defaults');
reset role;
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c1'),
  '(11.000,pph23,2.000)', 'AC-VWH-021 the defaults are stored as given');
select is((select count(*)::int from audit_events where action = 'company.tax_defaults.change'
            and entity_id = '08760000-0000-0000-0000-0000000002c1' and actor_id = '08760000-0000-0000-0000-0000000002a2'),
  1, 'AC-VWH-021 the change is audited with its actor');
select is((select (detail->'from'->>'pph_type') || '>' || (detail->'to'->>'pph_type') from audit_events
            where action = 'company.tax_defaults.change' and entity_id = '08760000-0000-0000-0000-0000000002c1'),
  'pph4_2>pph23', 'AC-VWH-021 the audit states the previous and the new values');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a1","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 12, null, null) $$,
  'AC-VWH-021 Admin changes the VAT rate and clears the withholding');
reset role;
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c1'),
  '(12.000,,)', 'AC-VWH-021 clearing the withholding clears type and rate together');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a3","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', 'only Admin or Finance can set a vendor''s tax defaults', 'AC-VWH-021 a Project Manager is refused');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a4","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', 'only Admin or Finance can set a vendor''s tax defaults', 'AC-VWH-021 an Executive is refused');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a5","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', 'only Admin or Finance can set a vendor''s tax defaults', 'AC-VWH-021 an Engineer is refused');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a6","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', null, 'AC-VWH-021 a disabled Finance account is refused (active-member gate)');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a2","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c3', 11, null, null) $$,
  'P0002', 'company not found', 'AC-VWH-021 another organization''s vendor is not found (no cross-org write, no existence leak)');
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c2', 11, null, null) $$,
  'P0001', 'an internal company has no vendor tax defaults', 'AC-VWH-021 an Internal company has no vendor tax defaults');
reset role;
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c1'),
  '(12.000,,)', 'AC-VWH-021 every refusal left the defaults unchanged');
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c3'),
  '(,,)', 'AC-VWH-021 the other organization''s vendor is untouched');

-- Companies owned by ERPNext: the defaults are outside the mirror guard; the guard itself is unchanged.
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('08760000-0000-0000-0000-000000000201','erpnext','companies');
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 11, 'pph4_2', 1.75) $$,
  'AC-VWH-021 the defaults can be set while companies are owned by ERPNext');
select throws_ok($$ update companies set name = 'Renamed' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '42501', 'company native fields are read-only while companies are externally-owned',
  'AC-VWH-021 CONTROL the ERP mirror guard still pins the vendor''s name');
reset role;
delete from external_domain_ownership where org_id = '08760000-0000-0000-0000-000000000201' and domain = 'companies';

-- §C no other client write path (AC-VWH-022)
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a1","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ update companies set default_vat_rate = 5 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '42501', 'vendor tax defaults are changed only through set_vendor_tax_defaults',
  'AC-VWH-022 an Admin''s direct UPDATE is refused — even after set_vendor_tax_defaults ran in this transaction (the flag is cleared)');
select throws_ok($$ insert into companies (org_id, name, type, default_pph_type, default_pph_rate)
                    values ('08760000-0000-0000-0000-000000000201','#876 S2 Sneaky','Vendor','pph23',2) $$,
  '42501', 'vendor tax defaults are changed only through set_vendor_tax_defaults',
  'AC-VWH-022 a direct INSERT carrying a default is refused');
select lives_ok($$ update companies set short_name = 'S2V' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  'AC-VWH-022 CONTROL other company edits are unaffected');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ update companies set default_vat_rate = 10 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  'AC-VWH-022 CONTROL the service role (ERP mirror, importers) is not refused');
select ok(not has_function_privilege('anon', 'public.set_vendor_tax_defaults(uuid,numeric,text,numeric)', 'execute'),
  'AC-VWH-022 anon cannot execute set_vendor_tax_defaults');
select ok(has_function_privilege('authenticated', 'public.set_vendor_tax_defaults(uuid,numeric,text,numeric)', 'execute'),
  'AC-VWH-022 authenticated can execute it (its body gates the role)');
select ok(not has_function_privilege('authenticated', 'public.companies_tax_defaults_guard()', 'execute')
          and not has_function_privilege('anon', 'public.companies_tax_defaults_guard()', 'execute'),
  'AC-VWH-022 the guard trigger function is not client-callable');

select * from finish();
rollback;
