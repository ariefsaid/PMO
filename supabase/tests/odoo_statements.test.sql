-- #1507 S5 AC-ODA-011..014, 015 (statements half): Odoo statements computed from the ledger mirror.
-- Calendar fiscal year unless the binding config carries fiscal_year_end; answers only after the Admin ledger-basis switch. Synthetic names and amounts only.
begin;
select plan(100);

insert into organizations (id, name) values
 ('a7460000-0000-0000-0000-000000000001','Stmt A'),
 ('a7460000-0000-0000-0000-000000000002','Stmt B');
insert into auth.users (id, email) values
 ('a7460000-0000-0000-0000-0000000000a1','a746-admin@example.test'),
 ('a7460000-0000-0000-0000-0000000000a2','a746-fin@example.test'),
 ('a7460000-0000-0000-0000-0000000000a3','a746-exec@example.test'),
 ('a7460000-0000-0000-0000-0000000000a4','a746-pm@example.test'),
 ('a7460000-0000-0000-0000-0000000000a5','a746-eng@example.test'),
 ('a7460000-0000-0000-0000-0000000000a6','a746-off@example.test'),
 ('a7460000-0000-0000-0000-0000000000b1','a746-bfin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a7460000-0000-0000-0000-0000000000a1','a7460000-0000-0000-0000-000000000001','Stmt Admin','a746-admin@example.test','Admin','active'),
 ('a7460000-0000-0000-0000-0000000000a2','a7460000-0000-0000-0000-000000000001','Stmt Finance','a746-fin@example.test','Finance','active'),
 ('a7460000-0000-0000-0000-0000000000a3','a7460000-0000-0000-0000-000000000001','Stmt Exec','a746-exec@example.test','Executive','active'),
 ('a7460000-0000-0000-0000-0000000000a4','a7460000-0000-0000-0000-000000000001','Stmt PM','a746-pm@example.test','Project Manager','active'),
 ('a7460000-0000-0000-0000-0000000000a5','a7460000-0000-0000-0000-000000000001','Stmt Eng','a746-eng@example.test','Engineer','active'),
 ('a7460000-0000-0000-0000-0000000000a6','a7460000-0000-0000-0000-000000000001','Stmt Off','a746-off@example.test','Finance','disabled'),
 ('a7460000-0000-0000-0000-0000000000b1','a7460000-0000-0000-0000-000000000002','Stmt B Finance','a746-bfin@example.test','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7460000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','fixture-a','active','{"ledger_basis_at":"2026-11-05T00:00:00Z"}', now());
insert into projects (id, org_id, code, name, status) values
 ('a7460000-0000-0000-0000-0000000000c1','a7460000-0000-0000-0000-000000000001','S5-1','Stmt P1','Ongoing Project'),
 ('a7460000-0000-0000-0000-0000000000c2','a7460000-0000-0000-0000-000000000001','S5-2','Stmt P2','Ongoing Project'),
 ('a7460000-0000-0000-0000-0000000000c3','a7460000-0000-0000-0000-000000000001','S5-3','Stmt P3 unlinked','Ongoing Project'),
 ('a7460000-0000-0000-0000-0000000000d1','a7460000-0000-0000-0000-000000000002','S5-B','Stmt PB','Ongoing Project');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
 ('a7460000-0000-0000-0000-000000000001','a7460000-0000-0000-0000-0000000000c1','odoo','101'),
 ('a7460000-0000-0000-0000-000000000001','a7460000-0000-0000-0000-0000000000c2','odoo','102');
insert into external_master_records (org_id, external_tier, kind, external_id, code, name, attrs, source_write_date) values
 ('a7460000-0000-0000-0000-000000000001','odoo','account','1','1000','Bank','{"account_type":"asset_cash"}','2026-01-01 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo','account','2','2000','Payables','{"account_type":"liability_payable"}','2026-01-01 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo','account','3','3000','Capital','{"account_type":"equity"}','2026-01-01 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo','account','4','4000','Sales','{"account_type":"income"}','2026-01-01 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo','account','5','5000','Costs','{"account_type":"expense"}','2026-01-01 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo','account','6','6000','Rent','{"account_type":"expense"}','2026-01-01 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo','account','7','6100','Rebates','{"account_type":"expense"}','2026-01-01 00:00:00');
insert into external_master_records (org_id, external_tier, kind, external_id, code, name, attrs, source_write_date) values
 ('a7460000-0000-0000-0000-000000000001','odoo','company','1',null,'Stmt Co','{"currency":"IDR"}','2026-01-01 00:00:00');

-- The mirror (account.move rows). 9999 has no account record: unclassified.
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
 ('a7460000-0000-0000-0000-000000000001','odoo:1:-','1000',null,'account.move','CAP/1','2025-06-10',500,0,false,1,'2025-06-10 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:2:-','3000',null,'account.move','CAP/1','2025-06-10',0,500,false,1,'2025-06-10 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:3:-','5000',null,'account.move','BILL/0','2025-12-20',100,0,false,1,'2025-12-20 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:4:-','2000',null,'account.move','BILL/0','2025-12-20',0,100,false,1,'2025-12-20 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:5:101','1000','101','account.move','INV/1','2026-02-05',300,0,false,1,'2026-02-05 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:6:101','4000','101','account.move','INV/1','2026-02-05',0,300,false,1,'2026-02-05 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:7:101','5000','101','account.move','BILL/1','2026-03-10',80,0,false,1,'2026-03-10 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:8:-','2000',null,'account.move','BILL/1','2026-03-10',0,80,false,1,'2026-03-10 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:9:-','5000',null,'account.move','BILL/2','2026-03-15',20,0,false,1,'2026-03-15 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:10:-','2000',null,'account.move','BILL/2','2026-03-15',0,20,false,1,'2026-03-15 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:11:-','5000',null,'account.move','BILL/3','2026-03-20',999,0,true,0,'2026-03-20 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:12:-','2000',null,'account.move','BILL/3','2026-03-20',0,999,true,0,'2026-03-20 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:13:102','5000','102','account.move','BILL/4','2026-03-05',5,0,false,1,'2026-03-05 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:14:102','2000','102','account.move','BILL/4','2026-03-05',0,5,false,1,'2026-03-05 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:15:-','6000',null,'account.move','RENT/1','2026-02-12',50,0,false,1,'2026-02-12 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:16:-','6100',null,'account.move','RENT/1','2026-02-12',0,50,false,1,'2026-02-12 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:17:-','6000',null,'account.move','RENT/2','2026-02-13',0,20,false,1,'2026-02-13 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:18:-','6100',null,'account.move','RENT/2','2026-02-13',20,0,false,1,'2026-02-13 00:00:00');
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at) values
 ('a7460000-0000-0000-0000-000000000001','odoo','ledger:odoo','{"w":"2026-03-20 00:00:00","id":14}','2026-03-21 08:00:00+00');

create temp table r (k text primary key, v jsonb);
grant all on r to authenticated, service_role, anon;

-- ── Finance: Trial Balance, March 2026 (AC-ODA-011)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into r values ('tb', get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}'));
insert into r values ('pl', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}'));
insert into r values ('plq', get_odoo_statement('profit_and_loss','{"kind":"quarter","start":"2026-01-01"}'));
insert into r values ('plfy', get_odoo_statement('profit_and_loss','{"kind":"fiscal_year","start":"2026-01-01"}'));
insert into r values ('tbf', get_odoo_statement('trial_balance','{"kind":"month","start":"2026-02-01"}'));
insert into r values ('bs', get_odoo_statement('balance_sheet','{"kind":"month","start":"2026-03-01"}'));
insert into r values ('p1', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c1'));
insert into r values ('p1f', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-02-01"}','a7460000-0000-0000-0000-0000000000c1'));
insert into r values ('p2', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c2'));
reset role;

select is((select v->>'state' from r where k='tb'), 'complete', 'AC-ODA-011 the Trial Balance reads complete');
select is((select v#>>'{result,period,currentStart}' from r where k='tb'), '2026-03-01', 'AC-ODA-011 current period start');
select is((select v#>>'{result,period,currentEnd}' from r where k='tb'), '2026-03-31', 'AC-ODA-011 current period end');
select is((select v#>>'{result,period,priorStart}' from r where k='tb'), '2026-02-01', 'AC-ODA-011 prior period is the preceding month');
select is((select v#>>'{result,period,priorEnd}' from r where k='tb'), '2026-02-28', 'AC-ODA-011 prior period end');

-- Opening, period, closing for the payables account (credit nature) and costs (debit nature).
select is((select (x->>'opening_credit')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb' and x->>'account'='2000'),
  100::numeric, 'AC-ODA-011 payables opening credit 100');
select is((select (x->>'credit')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb' and x->>'account'='2000'),
  105::numeric, 'AC-ODA-011 payables period credit 105 (cancelled lines excluded)');
select is((select (x->>'closing_credit')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb' and x->>'account'='2000'),
  205::numeric, 'AC-ODA-011 payables closing credit 205');
select is((select (x->>'closing_debit')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb' and x->>'account'='5000'),
  205::numeric, 'AC-ODA-011 costs closing debit 205 (100 opening + 105 period)');
select is((select (x->>'closing_debit')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb' and x->>'account'='1000'),
  800::numeric, 'AC-ODA-011 bank closing debit 800 from earlier years and months');
select is((select x->>'account_name' from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb' and x->>'account'='4000'),
  'Sales', 'AC-ODA-011 the account name is Odoo''s');
select is((select (v#>>'{result,payload,current,summary,0,total_debit}')::numeric from r where k='tb'),
  (select (v#>>'{result,payload,current,summary,0,total_credit}')::numeric from r where k='tb'),
  'AC-ODA-011 period total debit equals total credit');
select is((select (v#>>'{result,payload,current,summary,0,closing_debit}')::numeric from r where k='tb'),
  (select (v#>>'{result,payload,current,summary,0,closing_credit}')::numeric from r where k='tb'),
  'AC-ODA-011 closing total debit equals total credit');
select is((select count(*)::int from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb'), 7,
  'AC-ODA-011 seven accounts with a balance (no cancelled-only account)');
-- An account with both sides in the period: closing = opening + debit - credit (S5-T7).
select is((select (x->>'closing_debit')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tbf' and x->>'account'='6000'),
  30::numeric, 'S5-T7 closing debit of an account with debit 50 and credit 20 is 30');
select is((select (x->>'closing_credit')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tbf' and x->>'account'='6100'),
  30::numeric, 'S5-T7 closing credit of an account with credit 50 and debit 20 is 30');
select is((select (v#>>'{result,payload,current,summary,0,closing_debit}')::numeric from r where k='tbf'),
  (select sum((x->>'closing_debit')::numeric) from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tbf'),
  'S5-T7 the summary closing debit is the sum of the row closings');
select is((select (x->>'debit')::numeric from r, jsonb_array_elements(v#>'{result,payload,prior,rows}') x where k='tb' and x->>'account'='1000'),
  300::numeric, 'AC-ODA-011 the prior month is read independently (bank debit in February)');

-- ── P&L (AC-ODA-012)
select is((select (v#>>'{result,payload,current,summary,0,income}')::numeric from r where k='pl'), 0::numeric, 'AC-ODA-012 March income');
select is((select (v#>>'{result,payload,current,summary,0,expense}')::numeric from r where k='pl'), 105::numeric, 'AC-ODA-012 March expense');
select is((select (v#>>'{result,payload,current,summary,0,net}')::numeric from r where k='pl'), -105::numeric, 'AC-ODA-012 March net');
select is((select (v#>>'{result,payload,prior,summary,0,income}')::numeric from r where k='pl'), 300::numeric, 'AC-ODA-012 the preceding month is February income');
select is((select (v#>>'{result,payload,current,summary,0,net}')::numeric from r where k='plq'), 195::numeric, 'AC-ODA-012 quarter net (300 income, 105 expense)');
select is((select (v#>>'{result,payload,prior,summary,0,expense}')::numeric from r where k='plq'), 100::numeric, 'AC-ODA-012 preceding quarter expense');
select is((select (v#>>'{result,period,priorStart}' ) from r where k='plfy'), '2025-01-01', 'AC-ODA-012 fiscal year prior start');
select is((select (v#>>'{result,payload,current,summary,0,net}')::numeric from r where k='plfy'), 195::numeric, 'AC-ODA-012 fiscal-year net');
select is((select x->>'account_type' from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='plq' and x->>'account'='4000'),
  'income', 'AC-ODA-012 income accounts are grouped by Odoo account type');

-- ── Balance Sheet (AC-ODA-013)
select is((select (v#>>'{result,payload,current,summary,0,total_assets}')::numeric from r where k='bs'), 800::numeric, 'AC-ODA-013 total assets');
select is((select (v#>>'{result,payload,current,summary,0,total_liabilities_equity}')::numeric from r where k='bs'), 800::numeric,
  'AC-ODA-013 liabilities + equity + earnings equals assets');
select is((select (v#>>'{result,payload,current,summary,0,balanced}')::boolean from r where k='bs'), true, 'AC-ODA-013 balanced');
select is((select (x->>'balance')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='bs' and x->>'row_kind'='current_year_earnings'),
  195::numeric, 'AC-ODA-013 current-year earnings derived within the fiscal year');
select is((select (x->>'derived')::boolean from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='bs' and x->>'row_kind'='current_year_earnings'),
  true, 'AC-ODA-013 the derived row says so');
select is((select (x->>'balance')::numeric from r, jsonb_array_elements(v#>'{result,payload,prior,rows}') x where k='bs' and x->>'account'='1000'),
  800::numeric, 'AC-ODA-013 the preceding month is cumulative to its own end');

-- ── Project P&L (AC-ODA-014)
select is((select v#>>'{result,viewKind}' from r where k='p1'), 'account_breakdown', 'AC-ODA-014 Finance reads the project breakdown');
select is((select (v#>>'{result,payload,current,summary,0,expense}')::numeric from r where k='p1'), 80::numeric, 'AC-ODA-014 only project 101 rows (80), not the 20 unattributed');
select is((select (v#>>'{result,payload,prior,summary,0,income}')::numeric from r where k='p1'), 300::numeric, 'AC-ODA-014 prior month of project 101');
select is((select (v#>>'{result,payload,current,summary,0,expense}')::numeric from r where k='p2'), 5::numeric, 'AC-ODA-014 project 102 reads only its own account');
select is((select (v#>>'{result,provenance,unattributed,debit}')::numeric from r where k='pl'), 20::numeric, 'AC-ODA-014 the unattributed amount is reported, not distributed');
select is((select v#>>'{result,provenance,ledgerAsOf}' from r where k='pl') is not null, true, 'AC-ODA-014 provenance carries the ledger as-of time');
select is((select (v#>>'{result,provenance,unclassified,count}')::int from r where k='pl'), 0, 'AC-ODA-014 no unclassified account yet');

-- ── Envelope shape the shipped statements parser reads (I-5)
select is((select jsonb_typeof(v#>'{result,payload,current,summary,0,total_debit}') from r where k='tb'), 'string', 'S5-T3 amounts are decimal strings, not JSON numbers');
select is((select jsonb_typeof(x->'closing_debit') from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='tb' limit 1), 'string', 'S5-T3 row amounts are strings');
select is((select v#>>'{generation,currency}' from r where k='tb'), 'IDR', 'S5-T3 generation carries the company currency');
select is((select v#>>'{generation,presentation,precision}' from r where k='tb'), '2', 'S5-T3 generation carries the presentation precision');
select is((select array(select jsonb_object_keys(v) order by 1) from r where k='tb'), array['companyLabel','generation','result','selection','state'], 'S5-T3 the read has the shipped envelope keys');
select is((select array(select jsonb_object_keys(v->'selection') order by 1) from r where k='tb'), array['periodKind','periodStart','projectId','scopeKind','statement','viewKind'], 'S5-T3 the selection has the shipped keys');
select is((select jsonb_typeof(v#>'{result,payload,current,summary,0,balanced}') from r where k='bs'), 'boolean', 'S5-T3 balanced stays a boolean');
-- A project's provenance is not the company's.
select is((select v#>>'{result,provenance,unattributed}' from r where k='p1'), null, 'FR-ODA-023 a project read does not report the company''s unattributed amount');
select is((select v#>>'{result,provenance,unlinked}' from r where k='p1'), null, 'FR-ODA-023 a project read does not report the company''s unlinked amount');

-- ── Roles and scope (AC-ODA-015, statements half)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}')$$, 'AC-ODA-015 Executive reads the company');
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}')$$, 'AC-ODA-015 Admin reads the company');
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}')$$, '42501', null, 'AC-ODA-015 a Project Manager cannot read company statements');
select throws_ok($$select get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}')$$, '42501', null, 'AC-ODA-015 a Project Manager cannot read the company P&L');
insert into r values ('pm', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c1'));
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a5","role":"authenticated"}';
insert into r values ('eng', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c2'));
select throws_ok($$select get_odoo_statement('balance_sheet','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c1')$$, '22023', null, 'AC-ODA-015 a project scope is only for the P&L');
reset role;
select is((select v#>>'{result,viewKind}' from r where k='pm'), 'project_totals', 'AC-ODA-015 a Project Manager gets project totals');
select is((select (v#>>'{result,payload,current,expense}')::numeric from r where k='pm'), 80::numeric, 'AC-ODA-015 the totals are the project''s own');
select is((select v#>'{result,payload,current,rows}' from r where k='pm'), null, 'AC-ODA-015 no account detail for a Project Manager');
select is((select array(select jsonb_object_keys(v->'result') order by 1) from r where k='pm'), array['hasActivity','payload','period','viewKind'], 'S5-T3 project totals carry exactly the shipped result keys');
select is((select jsonb_typeof(v#>'{result,payload,current,net}') from r where k='pm'), 'string', 'S5-T3 project total amounts are strings');
select is((select (v#>>'{result,payload,current,expense}')::numeric from r where k='eng'), 5::numeric, 'AC-ODA-015 an Engineer gets project totals');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}')$$, '42501', null, 'AC-ODA-015 a disabled member is refused');
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c1')$$, '42501', null, 'AC-ODA-015 a foreign org''s project is not found');
insert into r values ('b', get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}'));
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01","org_id":"a7460000-0000-0000-0000-000000000002"}')$$, '22023', null, 'AC-ODA-015 a client cannot pass an org or company');
select throws_ok($$select get_odoo_statement('trial_balance','{"kind":"day","start":"2026-03-01"}')$$, '22023', null, 'AC-ODA-015 no custom period kinds');
select throws_ok($$select get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-02"}')$$, '22023', null, 'AC-ODA-015 a period starts on its first day');
reset role;
select is((select v->>'state' from r where k='b'), 'not_in_use', 'AC-ODA-015 an org with no Odoo ledger is told it is not in use');
set local role anon;
select throws_ok($$select get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}')$$, '42501', null, 'AC-ODA-015 anonymous is refused');
reset role;

-- ── Catalogue (S5-T5)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into r values ('cat', get_odoo_statement_catalogue());
insert into r values ('catp', get_odoo_statement_catalogue('a7460000-0000-0000-0000-0000000000c1'));
reset role;
select is((select count(*)::int from r, jsonb_array_elements(v->'periods') x where k='cat' and x->>'kind'='month'), 10, 'S5-T5 months from the earliest to the latest posting');
select is((select count(*)::int from r, jsonb_array_elements(v->'periods') x where k='cat' and x->>'kind'='quarter'), 4, 'S5-T5 quarters');
select is((select count(*)::int from r, jsonb_array_elements(v->'periods') x where k='cat' and x->>'kind'='fiscal_year'), 2, 'S5-T5 fiscal years');
select is((select count(*)::int from r, jsonb_array_elements(v->'periods') x where k='catp' and x->>'kind'='month'), 2, 'S5-T5 a project catalogue spans its own postings');

select is((select array(select jsonb_object_keys(v) order by 1) from r where k='cat'), array['companyLabel','generation','periods','scopes','state'], 'S5-T5 the catalogue has the shipped envelope keys');
select is((select v#>>'{scopes,0,scopeKind}' from r where k='cat'), 'company', 'S5-T5 the company catalogue offers the company scope');
select is((select v#>>'{scopes,0,viewKinds}' from r where k='catp'), '["account_breakdown"]', 'S5-T5 Finance on a project gets the account breakdown');

-- ── Ledger basis: nothing answers before the Admin switch (I-6)
update external_org_bindings set config = '{}' where org_id = 'a7460000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into r values ('nb', get_odoo_statement('trial_balance','{"kind":"month","start":"2026-03-01"}'));
insert into r values ('nbc', get_odoo_statement_catalogue());
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into r values ('nbpm', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}','a7460000-0000-0000-0000-0000000000c1'));
insert into r values ('nbdirect', odoo_project_ledger('a7460000-0000-0000-0000-0000000000c1','month','2026-03-01'));
reset role;
select is((select v from r where k='nb'), '{"state":"not_in_use"}'::jsonb, 'I-6 before the Admin switch a statement is plainly not in use');
select is((select v from r where k='nbc'), '{"state":"not_in_use"}'::jsonb, 'I-6 before the Admin switch the catalogue is not in use');
select is((select v from r where k='nbpm'), '{"state":"not_in_use"}'::jsonb, 'I-6 before the switch a Project Manager reads no project totals');
select is((select v->>'linked' from r where k='nbdirect'), 'false', 'I-6 the project reader gives no numbers before the switch');
select is((select v#>'{current}' from r where k='nbdirect'), null, 'I-6 the project reader returns no figures before the switch');
update external_org_bindings set config = '{"ledger_basis_at":"2026-11-05T00:00:00Z"}' where org_id = 'a7460000-0000-0000-0000-000000000001';

-- ── One fiscal-year source: the year end the feed stores on the binding (I-1)
select throws_ok($$select set_odoo_fiscal_year_end('a7460000-0000-0000-0000-000000000001', 13, 31)$$, '22023', null, 'I-1 a month outside 1..12 is refused');
set local role authenticated;
select throws_ok($$select set_odoo_fiscal_year_end('a7460000-0000-0000-0000-000000000001', 3, 31)$$, '42501', null, 'I-1 a signed-in member cannot write the year end');
reset role;
set local role service_role;
select lives_ok($$select set_odoo_fiscal_year_end('a7460000-0000-0000-0000-000000000001', 3, 31)$$, 'I-1 the feed stores the company year end');
reset role;
select is((select config#>>'{fiscal_year_end,month}' from external_org_bindings where org_id = 'a7460000-0000-0000-0000-000000000001'), '3', 'I-1 the month is on the binding');
select is((select config->>'ledger_basis_at' from external_org_bindings where org_id = 'a7460000-0000-0000-0000-000000000001'), '2026-11-05T00:00:00Z', 'I-1 the switch is untouched by the year-end write');
create temp table xm as select xmin::text as x from external_org_bindings where org_id = 'a7460000-0000-0000-0000-000000000001';
set local role service_role;
select set_odoo_fiscal_year_end('a7460000-0000-0000-0000-000000000001', 3, 31);
reset role;
select is((select xmin::text from external_org_bindings where org_id = 'a7460000-0000-0000-0000-000000000001'), (select x from xm), 'I-1 an unchanged year end rewrites no row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into r values ('fy', get_odoo_statement('profit_and_loss','{"kind":"fiscal_year","start":"2025-04-01"}'));
insert into r values ('fybs', get_odoo_statement('balance_sheet','{"kind":"month","start":"2026-03-01"}'));
insert into r values ('fycat', get_odoo_statement_catalogue());
select throws_ok($$select get_odoo_statement('profit_and_loss','{"kind":"fiscal_year","start":"2026-01-01"}')$$, '22023', null, 'I-1 a calendar-year start is refused once the year ends in March');
select throws_ok($$select get_odoo_statement('profit_and_loss','{"kind":"quarter","start":"2026-02-01"}')$$, '22023', null, 'I-1 quarters follow the fiscal year');
reset role;
select is((select v#>>'{result,period,currentEnd}' from r where k='fy'), '2026-03-31', 'I-1 the fiscal year runs April to March');
select is((select (v#>>'{result,payload,current,summary,0,net}')::numeric from r where k='fy'), 95::numeric, 'I-1 fiscal-year net over April 2025 to March 2026 (300 income, 205 expense)');
select is((select (x->>'balance')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='fybs' and x->>'row_kind'='current_year_earnings'),
  95::numeric, 'I-1 the balance sheet splits current-year earnings at 1 April');
select is((select (x->>'balance')::numeric from r, jsonb_array_elements(v#>'{result,payload,current,rows}') x where k='fybs' and x->>'row_kind'='previous_years_earnings'),
  0::numeric, 'I-1 nothing falls in previous years');
select is((select count(*)::int from r, jsonb_array_elements(v->'periods') x where k='fycat' and x->>'kind'='fiscal_year'), 1, 'I-1 the catalogue offers the one April to March year');
-- A year end on or before the 15th counts as the previous month's end.
select set_odoo_fiscal_year_end('a7460000-0000-0000-0000-000000000001', 4, 15);
set local role authenticated;
select lives_ok($$select get_odoo_statement('profit_and_loss','{"kind":"fiscal_year","start":"2025-04-01"}')$$, 'I-1 a year end of 15 April aligns to March');
reset role;
update external_org_bindings set config = '{"ledger_basis_at":"2026-11-05T00:00:00Z"}' where org_id = 'a7460000-0000-0000-0000-000000000001';

-- ── An imbalance is stated with its difference (AC-ODA-013)
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
 ('a7460000-0000-0000-0000-000000000001','odoo:20:-','1000',null,'account.move','ODD/1','2026-03-25',7,0,false,1,'2026-03-25 00:00:00'),
 ('a7460000-0000-0000-0000-000000000001','odoo:21:-','9999',null,'account.move','ODD/2','2026-03-26',3,0,false,1,'2026-03-26 00:00:00');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into r values ('bs2', get_odoo_statement('balance_sheet','{"kind":"month","start":"2026-03-01"}'));
insert into r values ('pl2', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}'));
reset role;
select is((select (v#>>'{result,payload,current,summary,0,balanced}')::boolean from r where k='bs2'), false, 'AC-ODA-013 a seeded imbalance says it does not balance');
select is((select (v#>>'{result,payload,current,summary,0,difference}')::numeric from r where k='bs2'), 10::numeric, 'AC-ODA-013 with the whole ledger difference, unclassified accounts included');
select is((select (v#>>'{result,payload,current,summary,0,unclassified_balance}')::numeric from r where k='bs2'), 3::numeric, 'AC-ODA-013 the unclassified balance is reported');
select is((select (v#>>'{result,provenance,unclassified,count}')::int from r where k='pl2'), 1, 'AC-ODA-014 an account with no Odoo record is reported unclassified');
-- An imbalance confined to an unclassified account from an earlier period still says so.
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
 ('a7460000-0000-0000-0000-000000000001','odoo:22:-','9998',null,'account.move','ODD/3','2025-07-01',4,0,false,1,'2025-07-01 00:00:00');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7460000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into r values ('bs3', get_odoo_statement('balance_sheet','{"kind":"month","start":"2026-03-01"}'));
insert into r values ('pl3', get_odoo_statement('profit_and_loss','{"kind":"month","start":"2026-03-01"}'));
reset role;
select is((select (v#>>'{result,payload,current,summary,0,difference}')::numeric from r where k='bs3'), 14::numeric, 'AC-ODA-013 an earlier-period unclassified balance is inside the difference');
select is((select (v#>>'{result,provenance,unclassified,count}')::int from r where k='pl3'), 2, 'AC-ODA-014 provenance counts an unclassified account with only a carried balance');
select is((select (v#>>'{result,provenance,unclassified,balance}')::numeric from r where k='pl3'), 7::numeric, 'AC-ODA-014 and reports its balance');

select finish();
rollback;
