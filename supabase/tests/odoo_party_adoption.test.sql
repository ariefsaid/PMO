-- #1504 S6-T2/T4: Odoo partners become PMO companies exactly once, and the companies guard holds under tier 'odoo'.
-- No Odoo-specific writer exists: tier 'odoo' runs ECA-2's shared appliers (migration 0480). AC-ODC-031 (exactly-once adoption),
-- AC-ODC-033 (while Odoo owns companies only enhancement fields are editable), AC-ECA-004 for the second tier.
begin;
select plan(28);

insert into organizations (id, name) values
 ('a6040000-0000-0000-0000-000000000001','Odoo Parties A'),
 ('a6040000-0000-0000-0000-000000000002','Odoo Parties B'),
 ('a6040000-0000-0000-0000-000000000003','No Odoo');
insert into auth.users (id, email) values
 ('a6040000-0000-0000-0000-0000000000a1','a604-admin@example.com'),
 ('a6040000-0000-0000-0000-0000000000e1','a604-exec@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a6040000-0000-0000-0000-0000000000a1','a6040000-0000-0000-0000-000000000001','Admin','a604-admin@example.com','Admin','active'),
 ('a6040000-0000-0000-0000-0000000000e1','a6040000-0000-0000-0000-000000000001','Exec','a604-exec@example.com','Executive','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a6040000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','a604_a','active','{"database":"db1","odoo_company_id":1}', now()),
 ('a6040000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','a604_b','active','{"database":"db1","odoo_company_id":1}', now());
insert into companies (id, org_id, name, type, erp_tax_id) values
 ('a6040000-0000-0000-0000-0000000000d1','a6040000-0000-0000-0000-000000000001','Acme Steel','Vendor',null),
 ('a6040000-0000-0000-0000-0000000000d2','a6040000-0000-0000-0000-000000000001','Taken Co','Vendor',null),
 ('a6040000-0000-0000-0000-0000000000d3','a6040000-0000-0000-0000-000000000001','Own Internal','Internal',null),
 ('a6040000-0000-0000-0000-0000000000d9','a6040000-0000-0000-0000-000000000002','B Vendor','Vendor',null);
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a6040000-0000-0000-0000-000000000001','companies','a6040000-0000-0000-0000-0000000000d2','odoo','Vendor:99');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- AC-ODC-031 / AC-ECA-004: bring-in is exactly-once
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','bring-in',null,'Vendor:5',
  '{"name":"PT Sinar Baja","taxId":"01.234","role":"vendor"}'::jsonb), null, 'AC-ODC-031 a bring-in applies');
select is((select count(*)::int from companies where org_id='a6040000-0000-0000-0000-000000000001' and name='PT Sinar Baja'), 1, 'AC-ODC-031 one company');
select is((select count(*)::int from external_refs where org_id='a6040000-0000-0000-0000-000000000001' and external_record_id='Vendor:5' and external_tier='odoo'), 1, 'AC-ODC-031 one reference, tier odoo');
select is((select type::text from companies where name='PT Sinar Baja'), 'Vendor', 'the role in the snapshot is the company type');
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','bring-in',null,'Vendor:5',
  '{"name":"PT Sinar Baja","taxId":"01.234","role":"vendor"}'::jsonb), null, 'AC-ODC-031 the race loser (a second apply of the same partner) is reconciled, not an error');
select is((select count(*)::int from companies where org_id='a6040000-0000-0000-0000-000000000001' and name='PT Sinar Baja'), 1, 'AC-ODC-031 still one company after the second apply');
select is((select count(*)::int from external_refs where org_id='a6040000-0000-0000-0000-000000000001' and external_record_id='Vendor:5'), 1, 'AC-ODC-031 still one reference');

-- FR-ODC-052: one Odoo partner with both roles is two PMO companies
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','bring-in',null,'Client:5',
  '{"name":"PT Sinar Baja","taxId":"01.234","role":"client"}'::jsonb), null, 'the same partner as a client applies');
select is((select count(*)::int from companies where org_id='a6040000-0000-0000-0000-000000000001' and name='PT Sinar Baja'), 2, 'FR-ODC-052 a vendor row and a client row');
select is((select string_agg(type::text, ',' order by type::text) from companies where name='PT Sinar Baja'), 'Client,Vendor', 'one of each role');

select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','bring-in',null,'5',
  '{"name":"No Role Co"}'::jsonb), 'The ERP record is incomplete', 'a partner with no role is not brought in');
select is((select count(*)::int from companies where name='No Role Co'), 0, 'nothing was written for it');

-- link
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','link','a6040000-0000-0000-0000-0000000000d1','Vendor:7',
  '{"name":"Acme Steel","taxId":"7.7","matchKey":"name"}'::jsonb), null, 'a link to an existing PMO company applies');
select is((select count(*)::int from companies where org_id='a6040000-0000-0000-0000-000000000001'), 5, 'AC-ODC-031 a link inserts no company (3 seeded + 2 brought in)');
select is((select erp_tax_id from companies where id='a6040000-0000-0000-0000-0000000000d1'), '7.7', 'the tax id is filled when the company had none');
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','link','a6040000-0000-0000-0000-0000000000d1','Vendor:7',
  '{"name":"Acme Steel","taxId":"7.7","matchKey":"name"}'::jsonb), null, 'the same link again is reconciled');
select is((select count(*)::int from external_refs where pmo_record_id='a6040000-0000-0000-0000-0000000000d1'), 1, 'one reference for the company');

-- a PMO company already linked to another partner is refused with a reason (the caller turns it into a review row)
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','link','a6040000-0000-0000-0000-0000000000d2','Vendor:100',
  '{"name":"Taken Co","matchKey":"name"}'::jsonb), 'This record is already linked to another ERP record', 'AC-ODC-031 a company that already has a partner is not re-pointed');
select is((select external_record_id from external_refs where pmo_record_id='a6040000-0000-0000-0000-0000000000d2'), 'Vendor:99', 'its reference is unchanged');

-- tenancy: another org's company is not reachable, and an org with no Odoo connection takes nothing
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000001','odoo','party','link','a6040000-0000-0000-0000-0000000000d9','Vendor:8',
  '{"name":"B Vendor","matchKey":"name"}'::jsonb), 'This company is no longer in PMO', 'a link to another organisation''s company is refused');
select is((select count(*)::int from external_refs where external_record_id='Vendor:8'), 0, 'no reference was written');
select is(public.apply_connect_outcome('a6040000-0000-0000-0000-000000000003','odoo','party','bring-in',null,'Vendor:1',
  '{"name":"X","role":"vendor"}'::jsonb), 'No active connection for this ERP', 'an org with no Odoo connection takes no partner');

-- two accepts of one open bring-in proposal (the Admin double-clicks): one company
select set_config('a604.run', public.start_connect_run('a6040000-0000-0000-0000-000000000001','odoo','a6040000-0000-0000-0000-0000000000a1')::text, true);
select public.replace_connect_proposals('a6040000-0000-0000-0000-000000000001','odoo',current_setting('a604.run')::uuid,'party','[
  {"outcome":"bring-in","pmoIds":[],"externalIds":["Vendor:31"],"snapshot":{"name":"Brought By Accept","role":"vendor"}}]'::jsonb, true);
reset role;
set local request.jwt.claims = '{"sub":"a6040000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select public.accept_connect_proposals('odoo','party');
select public.accept_connect_proposals('odoo','party');
select is((select count(*)::int from companies where name='Brought By Accept'), 1, 'AC-ECA-004 two accepts of one proposal leave one company');
select is((select count(*)::int from external_refs where external_record_id='Vendor:31' and external_tier='odoo'), 1, 'and one reference');

-- AC-ODC-033: the guard under tier odoo
reset role;
insert into external_domain_ownership (org_id, external_tier, domain) values ('a6040000-0000-0000-0000-000000000001','odoo','companies');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6040000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update companies set name = 'Renamed' where id = 'a6040000-0000-0000-0000-0000000000d1'$$, '42501', null,
  'AC-ODC-033 a native field (name) of a mirrored company is refused while Odoo owns companies');
select throws_ok($$update companies set type = 'Client' where id = 'a6040000-0000-0000-0000-0000000000d1'$$, '42501', null,
  'AC-ODC-033 the role (type) is locked too (PQ-5)');
select lives_ok($$update companies set archived_at = now() where id = 'a6040000-0000-0000-0000-0000000000d1'$$,
  'AC-ODC-033 an enhancement field (archived_at) stays editable');
reset role;
delete from external_domain_ownership where org_id='a6040000-0000-0000-0000-000000000001' and external_tier='odoo' and domain='companies';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6040000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$update companies set name = 'Renamed' where id = 'a6040000-0000-0000-0000-0000000000d1'$$,
  'AC-ODC-033 releasing ownership reopens native edits');

select * from finish();
rollback;
