-- #1507 S2 AC-ODA-006: a finished census removes rows of unseen lines only; an unfinished one removes nothing; org-scoped.
begin;
select plan(8);

insert into organizations (id, name) values
 ('a7450000-0000-0000-0000-000000000001','Census A'),
 ('a7450000-0000-0000-0000-000000000002','Census B');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a7450000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','fixture-a','active','{}', now()),
 ('a7450000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','fixture-b','active','{}', now());
insert into erp_gl_entry_mirror (org_id, erp_name, account, voucher_type, voucher_no, debit, credit, erp_modified) values
 ('a7450000-0000-0000-0000-000000000001','odoo:1:101','5100','account.move','M/1',60,0,'2026-11-01 00:00:00'),
 ('a7450000-0000-0000-0000-000000000001','odoo:1:-','5100','account.move','M/1',40,0,'2026-11-01 00:00:00'),
 ('a7450000-0000-0000-0000-000000000001','odoo:2:-','5100','account.move','M/2',10,0,'2026-11-01 00:00:00'),
 ('a7450000-0000-0000-0000-000000000001','odoo:3:-','5100','account.move','M/3',5,0,'2026-11-09 11:55:00'),
 ('a7450000-0000-0000-0000-000000000002','odoo:2:-','5100','account.move','M/2',99,0,'2026-11-01 00:00:00');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select mark_odoo_ledger_census_seen('a7450000-0000-0000-0000-000000000001','2026-11-09 12:00:00+00', array['1']);
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7450000-0000-0000-0000-000000000001'), 4,
  'AC-ODA-006 an unfinished census deletes nothing');

select is(finish_odoo_ledger_census('a7450000-0000-0000-0000-000000000001','2026-11-09 12:00:00+00'), 1,
  'AC-ODA-006 a finished census reports the rows of the unseen line it removed');
select is((select array_agg(erp_name order by erp_name) from erp_gl_entry_mirror where org_id='a7450000-0000-0000-0000-000000000001'),
  array['odoo:1:-','odoo:1:101','odoo:3:-'], 'AC-ODA-006 only the unseen line went; the seen line keeps both rows');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='a7450000-0000-0000-0000-000000000002'), 1,
  'AC-ODA-006 another org''s row of the same name stays');
reset role;
select is((select count(*)::int from odoo_ledger_census_seen), 0, 'AC-ODA-006 the run''s seen set is cleared');
set local role service_role;

-- A census that saw nothing while rows exist is refused, not treated as "everything is gone".
select throws_ok($$select finish_odoo_ledger_census('a7450000-0000-0000-0000-000000000001','2026-11-10 12:00:00+00')$$,
  'P0001', null, 'AC-ODA-006 an empty census is refused');
select throws_ok($$select mark_odoo_ledger_census_seen('a7450000-0000-0000-0000-000000000001', now(), array['x'])$$,
  '22023', null, 'AC-ODA-006 a malformed census id is refused');

reset role;
set local role authenticated;
select throws_ok($$select mark_odoo_ledger_census_seen('a7450000-0000-0000-0000-000000000001', now(), array['1'])$$,
  '42501', null, 'AC-ODA-006 a user cannot mark a census');

select * from finish();
rollback;
