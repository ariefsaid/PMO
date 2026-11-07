-- #1507 S2 AC-ODA-004/005: service-only ledger page application, idempotency, stale guard, cursor, line replacement, tenancy.
begin;
select plan(28);

insert into organizations (id, name) values
 ('a7440000-0000-0000-0000-000000000001','Ledger A'),
 ('a7440000-0000-0000-0000-000000000002','Ledger B');
insert into auth.users (id, email) values ('a7440000-0000-0000-0000-0000000000a1','a744-a@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a7440000-0000-0000-0000-0000000000a1','a7440000-0000-0000-0000-000000000001','Ledger Finance','a744-a@example.test','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7440000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','fixture-a','active','{}', now()),
 ('a7440000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','fixture-b','active','{}', now());

select has_index('public','erp_gl_entry_mirror','erp_gl_entry_mirror_org_voucher_date_account_idx',
  'AC-ODA-004 the statement index exists');
select has_index('public','erp_gl_entry_mirror','erp_gl_entry_mirror_odoo_line_idx',
  'AC-ODA-005 the per-line index bounds the sibling lookup');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7440000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001','[]','{"w":null,"id":0}')$$,
  '42501', null, 'AC-ODA-004 a user cannot apply a ledger page');
select throws_ok($$select finish_odoo_ledger_census('a7440000-0000-0000-0000-000000000001', now())$$,
  '42501', null, 'AC-ODA-006 a user cannot finish a ledger census');
reset role;
select ok(not has_function_privilege('authenticated','public.apply_odoo_ledger_page(uuid,jsonb,text)','execute')
      and not has_function_privilege('anon','public.apply_odoo_ledger_page(uuid,jsonb,text)','execute')
      and has_function_privilege('service_role','public.apply_odoo_ledger_page(uuid,jsonb,text)','execute'),
  'AC-ODA-004 only the service role may execute the page writer');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Page 1: line 10 split 60/40 over analytic account 101 and unattributed.
select is(apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:101","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":"101","partner":"Vendor","debit":"600.01","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"},
 {"erp_name":"odoo:10:-","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":null,"partner":"Vendor","debit":"400.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-02 10:00:00","id":10}'), 2, 'AC-ODA-004 a page applies its rows');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001'), 2, 'AC-ODA-004 two rows landed');
select is((select sum(debit) from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001'), 1000.01::numeric,
  'AC-ODA-004 the rows sum to the line');

-- Applied twice: identical.
select lives_ok($$select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:101","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":"101","partner":"Vendor","debit":"600.01","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"},
 {"erp_name":"odoo:10:-","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":null,"partner":"Vendor","debit":"400.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-02 10:00:00","id":10}')$$, 'AC-ODA-004 the same page again');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001'), 2, 'AC-ODA-004 idempotent: still two rows');

-- Older write_date does not overwrite, and the cursor does not rewind.
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:101","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":"101","partner":"Vendor","debit":"1.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-01 09:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-01 09:00:00","id":3}');
select is((select debit from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name='odoo:10:101'), 600.01::numeric,
  'AC-ODA-004 a stale re-delivery does not overwrite a newer row');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7440000-0000-0000-0000-000000000001' and domain='ledger:odoo' and external_tier='odoo'),
  '{"w":"2026-11-02 10:00:00","id":10}', 'AC-ODA-004 the cursor does not rewind');

-- A later page moves the cursor forward.
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', '[]', '{"w":"2026-11-03 08:00:00","id":11}');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7440000-0000-0000-0000-000000000001' and domain='ledger:odoo'),
  '{"w":"2026-11-03 08:00:00","id":11}', 'AC-ODA-004 the cursor advances');

-- A failing row aborts the page and its cursor.
select throws_ok($$select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:20:-","voucher_type":"account.move","voucher_no":"BILL/2","account":"5100","project":null,"debit":"5.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-04 10:00:00"},
 {"erp_name":"not-a-ledger-name","voucher_no":"BILL/3","account":"5100","debit":"1","credit":"0","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-04 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-04 10:00:00","id":99}')$$, '22023', null, 'AC-ODA-004 a malformed row fails the page');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name like 'odoo:20:%'), 0,
  'AC-ODA-004 the good row of a failed page is not kept');
select is((select watermark_cursor from external_sync_watermarks where org_id='a7440000-0000-0000-0000-000000000001' and domain='ledger:odoo'),
  '{"w":"2026-11-03 08:00:00","id":11}', 'AC-ODA-004 a failed page leaves the cursor');
select throws_ok($$select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', '[]', 'not json')$$, '22023', null,
  'AC-ODA-004 a malformed cursor is refused');
select throws_ok($$select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', '[]', '{"w":"zzzz","id":1}')$$, '22023', null,
  'AC-ODA-004 a cursor with a malformed write date is refused, so it cannot pin the cursor forward');

-- Tenancy: org B's page never touches org A, and an unbound org is refused.
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000002', $j$[
 {"erp_name":"odoo:10:101","voucher_type":"account.move","voucher_no":"BILL/B","account":"5100","project":"101","debit":"7.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-05 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-05 10:00:00","id":10}');
select is((select debit from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name='odoo:10:101'), 600.01::numeric,
  'AC-ODA-004 org B''s row with the same name does not touch org A');
select is((select debit from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000002' and erp_name='odoo:10:101'), 7.00::numeric,
  'AC-ODA-004 org B has its own row');
select is((select sum(debit) from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name='odoo:10:-'), 400.00::numeric,
  'AC-ODA-004 org B''s page of line 10 does not delete org A''s sibling row of line 10');
select throws_ok($$select apply_odoo_ledger_page('a7440000-0000-0000-0000-0000000000ff','[]','{"w":null,"id":0}')$$, null, null,
  'AC-ODA-004 an org without an active Odoo binding is refused');

-- AC-ODA-005: reset to draft, redistribute 100% to unattributed, repost.
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:-","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":null,"debit":"1000.01","credit":"0.00","posting_date":"2026-11-01","is_cancelled":true,"source_write_date":"2026-11-06 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-06 10:00:00","id":10}');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name like 'odoo:10:%'), 1,
  'AC-ODA-005 the old split row is gone');
select is((select is_cancelled from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name='odoo:10:-'), true,
  'AC-ODA-005 the draft stage counts nothing');
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:101","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":"101","debit":"250.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-07 10:00:00"},
 {"erp_name":"odoo:10:-","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":null,"debit":"750.01","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-07 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-07 10:00:00","id":10}');
select is((select sum(debit) from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name like 'odoo:10:%' and not is_cancelled), 1000.01::numeric,
  'AC-ODA-005 the reposted split sums to the line');
-- A stale page of the same line (older write) deletes nothing of the newer distribution.
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:10:-","voucher_type":"account.move","voucher_no":"BILL/1","account":"5100","project":null,"debit":"1000.01","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-02 10:00:00","id":10}');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name like 'odoo:10:%'), 2,
  'AC-ODA-005 a stale page of the line does not delete the newer split');

-- A stale page read before a repost must not bring back a sibling the repost removed (per line, not per row).
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:30:-","voucher_type":"account.move","voucher_no":"BILL/30","account":"5100","project":null,"debit":"1000.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-09 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-09 10:00:00","id":30}');
select apply_odoo_ledger_page('a7440000-0000-0000-0000-000000000001', $j$[
 {"erp_name":"odoo:30:101","voucher_type":"account.move","voucher_no":"BILL/30","account":"5100","project":"101","debit":"600.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"},
 {"erp_name":"odoo:30:-","voucher_type":"account.move","voucher_no":"BILL/30","account":"5100","project":null,"debit":"400.00","credit":"0.00","posting_date":"2026-11-01","is_cancelled":false,"source_write_date":"2026-11-02 10:00:00"}
 ]$j$::jsonb, '{"w":"2026-11-02 10:00:00","id":30}');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name like 'odoo:30:%'), 1,
  'AC-ODA-005 a stale page does not bring back a sibling a newer repost removed');
select is((select sum(debit) from erp_gl_entry_mirror where org_id='a7440000-0000-0000-0000-000000000001' and erp_name like 'odoo:30:%'), 1000.00::numeric,
  'AC-ODA-005 the line still sums to the newer state');

select * from finish();
rollback;
