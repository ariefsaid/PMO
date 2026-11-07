-- #1507 S3 AC-ODA-003: the ledger page carries the row's fiscal year into the mirror, so the actuals refresh can select it.
begin;
select plan(5);

insert into organizations (id, name) values ('a7510000-0000-0000-0000-000000000001','Fiscal A');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7510000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','fixture-fy','active','{}', now());

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(apply_odoo_ledger_page('a7510000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:101","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":"101","fiscal_year":"2027","debit":"60.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"},
 {"erp_name":"odoo:10:-","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":null,"fiscal_year":"2027","debit":"40.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-02 10:00:00","id":10}'), 2, 'AC-ODA-003 a page with a fiscal year applies');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7510000-0000-0000-0000-000000000001' and fiscal_year = '2027'), 2,
  'AC-ODA-003 both rows carry the fiscal year');

-- A repost in another year replaces it.
select apply_odoo_ledger_page('a7510000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:-","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":null,"fiscal_year":"2026","debit":"100.00","credit":"0.00","posting_date":"2026-02-01","is_cancelled":false,"source_write_date":"2026-11-03 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-03 10:00:00","id":10}');
select is((select fiscal_year from erp_gl_entry_mirror where org_id='a7510000-0000-0000-0000-000000000001' and erp_name='odoo:10:-'), '2026',
  'AC-ODA-003 a repost updates the fiscal year');

-- A row without one keeps null (the refresh reports it as undated); a malformed one aborts the page.
select apply_odoo_ledger_page('a7510000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:20:-","voucher_type":"account.move","voucher_no":"BILL/2","account":"5100","project":null,"debit":"5.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-04 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-04 10:00:00","id":20}');
select is((select fiscal_year from erp_gl_entry_mirror where org_id='a7510000-0000-0000-0000-000000000001' and erp_name='odoo:20:-'), null,
  'AC-ODA-003 a row without a fiscal year stays undated');
select throws_ok($$select apply_odoo_ledger_page('a7510000-0000-0000-0000-000000000001', '[{"erp_name":"odoo:30:-","voucher_type":"account.move","voucher_no":"B","account":"5100","project":null,"fiscal_year":"FY-26","debit":"1.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-05 10:00:00"}]', '{"w":"2026-11-05 10:00:00","id":30}')$$,
  '22023', 'malformed ledger row', 'AC-ODA-003 a malformed fiscal year aborts the page');

select * from finish();
rollback;
