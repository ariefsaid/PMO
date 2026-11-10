-- #1507 S4 AC-ODA-007: Odoo-fed project actuals. Category figures are the mapped sums; the unmapped amount is shown apart and is in no category.
-- The snapshot rows are what the shared refresh writes from the Odoo-fed mirror (project, account code, year, net).
begin;
select plan(10);

insert into organizations (id, name) values ('a7450000-0000-0000-0000-000000000021','Actuals A');
insert into auth.users (id, email) values ('a7450000-0000-0000-0000-0000000000a2','a745a-fin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a7450000-0000-0000-0000-0000000000a2','a7450000-0000-0000-0000-000000000021','Actuals Fin','a745a-fin@example.test','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7450000-0000-0000-0000-000000000021','odoo','https://odoo.example.test','fixture-a','active','{"ledger_basis_at":"2026-11-05T00:00:00Z","connection":{"state":"healthy"}}', now());
insert into projects (id, org_id, code, name, status) values
 ('a7450000-0000-0000-0000-0000000000d1','a7450000-0000-0000-0000-000000000021','A-1','Actuals P1','Ongoing Project');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values
 ('a7450000-0000-0000-0000-000000000021','a7450000-0000-0000-0000-0000000000d1','odoo','301');
-- The Odoo company's currency (IDR) differs from the org's default (USD).
insert into external_master_records (org_id, external_tier, kind, external_id, code, name, attrs, source_write_date) values
 ('a7450000-0000-0000-0000-000000000021','odoo','company','1','1','Actuals Co','{"currency":"IDR"}','2026-01-01 00:00:00');
-- Labor -> 5100; Equipment -> nothing. 5110 and 5900 are on no category.
insert into budget_category_account_map (org_id, category, erp_account) values
 ('a7450000-0000-0000-0000-000000000021','Labor','5100');
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, fiscal_year, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified) values
 ('a7450000-0000-0000-0000-000000000021','odoo:1:301','5100','301','2026','account.move','A/1','2026-03-10',100,0,false,1,'2026-03-10 00:00:00'),
 ('a7450000-0000-0000-0000-000000000021','odoo:2:301','5110','301','2026','account.move','A/2','2026-03-11',50,10,false,1,'2026-03-11 00:00:00'),
 ('a7450000-0000-0000-0000-000000000021','odoo:3:301','5900','301','2026','account.move','A/3','2026-03-12',33,0,false,1,'2026-03-12 00:00:00'),
 ('a7450000-0000-0000-0000-000000000021','odoo:4:301','5100','301','2026','account.move','A/4','2026-03-13',999,0,true,0,'2026-03-13 00:00:00');
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
 ('a7450000-0000-0000-0000-000000000021','a7450000-0000-0000-0000-0000000000d1','5100','2026',100,0,100,'a7450000-0000-0000-0000-0000000000f0'),
 ('a7450000-0000-0000-0000-000000000021','a7450000-0000-0000-0000-0000000000d1','5110','2026',50,10,40,'a7450000-0000-0000-0000-0000000000f0'),
 ('a7450000-0000-0000-0000-000000000021','a7450000-0000-0000-0000-0000000000d1','5900','2026',33,0,33,'a7450000-0000-0000-0000-0000000000f0');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7450000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select actuals_to_date from project_mapped_actuals('a7450000-0000-0000-0000-0000000000d1','2026') where category = 'Labor'), 100::numeric,
  'AC-ODA-007 Labor equals its mapped account (100), cancelled line excluded');
select is((select actuals_to_date from project_mapped_actuals('a7450000-0000-0000-0000-0000000000d1','2026') where category = 'Equipment'), null,
  'AC-ODA-007 an unmapped category has no figure, not zero');
select is((select sum(actuals_to_date) from project_mapped_actuals('a7450000-0000-0000-0000-0000000000d1','2026')), 100::numeric,
  'AC-ODA-007 the unmapped accounts (5110, 5900) are in no category');
select is((select count(*)::int from project_mapped_actuals('a7450000-0000-0000-0000-0000000000d1','2026') where mapped), 1, 'AC-ODA-007 exactly one category is mapped');
select is(get_odoo_ledger_health('a7450000-0000-0000-0000-0000000000d1')#>>'{unmapped,debit}', '83.00', 'AC-ODA-007 the unmapped amount appears separately for the project');
select is(get_odoo_ledger_health('a7450000-0000-0000-0000-0000000000d1')#>>'{unmapped,count}', '2', 'AC-ODA-007 ... as two lines');
select is(get_odoo_ledger_health('a7450000-0000-0000-0000-0000000000d1')#>>'{unmapped,accounts}', '["5110", "5900"]', 'AC-ODA-007 ... naming its accounts');
select is(jsonb_typeof(get_project_finances('a7450000-0000-0000-0000-0000000000d1')), 'object', 'AC-ODA-007 get_project_finances answers on Odoo-fed rows');
select is(get_project_finances('a7450000-0000-0000-0000-0000000000d1')#>>'{actuals,currency}', 'IDR', '#2066 on the Odoo ledger the actuals carry the Odoo company currency, not the org default');
-- With no company currency recorded (tombstoned), the read falls back to the org's currency as before.
reset role;
update external_master_records set tombstoned_at = now() where org_id = 'a7450000-0000-0000-0000-000000000021' and kind = 'company';
set local role authenticated;
select is(get_project_finances('a7450000-0000-0000-0000-0000000000d1')#>>'{actuals,currency}', 'USD', '#2066 ... and falls back to the org currency when no company currency is recorded');

select finish();
rollback;
