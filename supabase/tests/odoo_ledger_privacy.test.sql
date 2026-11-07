-- #1507 S5 AC-ODA-015 (statements half): who may reach the Odoo statement reads. S4 extends this file for line detail and health.
begin;
select plan(20);

insert into organizations (id, name) values
 ('a7460000-0000-0000-0000-000000000011','Priv A'),
 ('a7460000-0000-0000-0000-000000000012','Priv B');
insert into auth.users (id, email) values
 ('a7460000-0000-0000-0000-0000000000e4','a746p-pm@example.test'),
 ('a7460000-0000-0000-0000-0000000000e2','a746p-fin@example.test'),
 ('a7460000-0000-0000-0000-0000000000f4','a746p-bpm@example.test'),
 ('a7460000-0000-0000-0000-0000000000e5','a746p-off@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a7460000-0000-0000-0000-0000000000e4','a7460000-0000-0000-0000-000000000011','Priv PM','a746p-pm@example.test','Project Manager','active'),
 ('a7460000-0000-0000-0000-0000000000e2','a7460000-0000-0000-0000-000000000011','Priv Fin','a746p-fin@example.test','Finance','active'),
 ('a7460000-0000-0000-0000-0000000000f4','a7460000-0000-0000-0000-000000000012','Priv B PM','a746p-bpm@example.test','Project Manager','active'),
 ('a7460000-0000-0000-0000-0000000000e5','a7460000-0000-0000-0000-000000000011','Priv Off PM','a746p-off@example.test','Project Manager','disabled');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7460000-0000-0000-0000-000000000011','odoo','https://odoo.example.test','fixture-p','active','{"ledger_basis_at":"2026-11-05T00:00:00Z"}', now()),
 ('a7460000-0000-0000-0000-000000000012','odoo','https://odoo.example.test','fixture-q','active','{"ledger_basis_at":"2026-11-05T00:00:00Z"}', now());
insert into projects (id, org_id, code, name, status) values
 ('a7460000-0000-0000-0000-0000000000c9','a7460000-0000-0000-0000-000000000011','P5-1','Priv P1','Ongoing Project'),
 ('a7460000-0000-0000-0000-0000000000ca','a7460000-0000-0000-0000-000000000012','P5-B','Priv PB','Ongoing Project');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
 ('a7460000-0000-0000-0000-000000000011','a7460000-0000-0000-0000-0000000000c9','odoo','301'),
 ('a7460000-0000-0000-0000-000000000012','a7460000-0000-0000-0000-0000000000ca','odoo','301');
insert into external_master_records (org_id, external_tier, kind, external_id, code, name, attrs, source_write_date) values
 ('a7460000-0000-0000-0000-000000000011','odoo','account','1','5000','Costs','{"account_type":"expense"}','2026-01-01 00:00:00'),
 ('a7460000-0000-0000-0000-000000000012','odoo','account','1','5000','Costs','{"account_type":"expense"}','2026-01-01 00:00:00');
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
 ('a7460000-0000-0000-0000-000000000011','odoo:1:301','5000','301','account.move','A/1','2026-03-10',40,0,false,1,'2026-03-10 00:00:00'),
 ('a7460000-0000-0000-0000-000000000012','odoo:1:301','5000','301','account.move','B/1','2026-03-10',9000,0,false,1,'2026-03-10 00:00:00');

-- The functions: the reads are invoker, the narrow project reader is definer with a pinned search path, none reachable by anon.
select ok(not (select prosecdef from pg_proc where oid = 'public.get_odoo_statement(text,jsonb,uuid)'::regprocedure), 'AC-ODA-015 the statement read is security invoker');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_odoo_statement_catalogue(uuid)'::regprocedure), 'AC-ODA-015 the catalogue read is security invoker');
select ok(not has_function_privilege('anon','public.get_odoo_statement(text,jsonb,uuid)','execute')
      and not has_function_privilege('anon','public.get_odoo_statement_catalogue(uuid)','execute')
      and not has_function_privilege('anon','public.odoo_project_ledger(uuid,text,date)','execute'),
  'AC-ODA-015 anonymous cannot execute the statement reads');
select is((select proconfig::text from pg_proc where oid = 'public.odoo_project_ledger(uuid,text,date)'::regprocedure), '{"search_path=public, pg_temp"}', 'AC-ODA-015 the project reader pins its search path');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000e4","role":"authenticated"}';
select is((select count(*)::int from erp_gl_entry_mirror), 0, 'AC-ODA-015 a Project Manager cannot read the ledger rows directly');
select is((get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c9')#>>'{result,payload,current,expense}')::numeric, 40::numeric,
  'AC-ODA-015 a Project Manager gets the project total through the narrow reader');
select throws_ok($$select odoo_project_ledger('a7460000-0000-0000-0000-0000000000ca')$$, '42501', null, 'AC-ODA-015 the project reader refuses another org''s project');
-- The reader takes a catalogue period, never a range: nothing finer than a month, no list of ranges (I-2).
select is((select array(select jsonb_object_keys(odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9','month','2026-03-01')) order by 1)), array['current','ledgerAsOf','linked','prior'], 'I-2 the reader answers one period and its prior, nothing else');
select is((odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9','month','2026-03-01')#>>'{current,expense}')::numeric, 40::numeric, 'I-2 the month total is the project''s');
select throws_ok($$select odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9','month','2026-03-02')$$, '22023', null, 'I-2 a one-day slice is refused: a period starts on its first day');
select throws_ok($$select odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9','week','2026-03-01')$$, '22023', null, 'I-2 only month, quarter and fiscal year are offered');
select throws_ok($$select odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9','quarter','2026-02-01')$$, '22023', null, 'I-2 a quarter must start where the catalogue says');
-- A disabled member is refused at the reader itself, not only through the statement read (I-4).
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000e5","role":"authenticated"}';
select throws_ok($$select odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9','month','2026-03-01')$$, '42501', null, 'I-4 a disabled Project Manager is refused by the project reader');
select throws_ok($$select odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9')$$, '42501', null, 'I-4 a disabled Project Manager is refused the project bounds too');
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000e4","role":"authenticated"}';
select throws_ok($$select get_odoo_statement_catalogue()$$, '42501', null, 'AC-ODA-015 a Project Manager has no company catalogue');
select is((get_odoo_statement_catalogue('a7460000-0000-0000-0000-0000000000c9')->>'state'), 'complete', 'AC-ODA-015 a Project Manager reads a project catalogue');

-- Same analytic id in two orgs: each org reads only its own rows.
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000f4","role":"authenticated"}';
select is((get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000ca')#>>'{result,payload,current,expense}')::numeric, 9000::numeric,
  'AC-ODA-015 the other org reads its own project total only');
select throws_ok($$select get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c9')$$, '42501', null, 'AC-ODA-015 a foreign project behaves as not found');

set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}')#>>'{result,payload,current,summary,0,total_debit}')::numeric, 40::numeric,
  'AC-ODA-015 Finance reads only its org''s company totals');
reset role;
set local role anon;
select throws_ok($$select odoo_project_ledger('a7460000-0000-0000-0000-0000000000c9')$$, '42501', null, 'AC-ODA-015 anonymous cannot call the project reader');
reset role;

select finish();
rollback;
