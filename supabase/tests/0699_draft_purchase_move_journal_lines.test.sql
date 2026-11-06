-- 0699 (#1935): a purchase with attached ERP journal lines cannot change project; unattached and other cases unchanged.
-- Journal lines belong to their ERP project, so they cannot follow the purchase: the move is refused (23514).
begin;
select plan(8);

insert into organizations (id, name, default_currency) values ('06990000-0000-0000-0000-00000000000a','MV A','IDR');
insert into auth.users (id, email) values ('06990000-0000-0000-0000-0000000000a1','mv-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('06990000-0000-0000-0000-0000000000a1','06990000-0000-0000-0000-00000000000a','PM','mv-pm@example.com','Project Manager','active');
insert into projects (id, org_id, name, status) values
  ('06990000-0000-0000-0000-0000000000d1','06990000-0000-0000-0000-00000000000a','MV P1','Ongoing Project'),
  ('06990000-0000-0000-0000-0000000000d2','06990000-0000-0000-0000-00000000000a','MV P2','Ongoing Project');
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('06990000-0000-0000-0000-0000000000e1','06990000-0000-0000-0000-00000000000a','Attached','06990000-0000-0000-0000-0000000000a1','06990000-0000-0000-0000-0000000000d1','IDR',100,'Draft'),
  ('06990000-0000-0000-0000-0000000000e2','06990000-0000-0000-0000-00000000000a','Free','06990000-0000-0000-0000-0000000000a1','06990000-0000-0000-0000-0000000000d1','IDR',100,'Draft'),
  ('06990000-0000-0000-0000-0000000000e3','06990000-0000-0000-0000-00000000000a','Ordered','06990000-0000-0000-0000-0000000000a1','06990000-0000-0000-0000-0000000000d1','IDR',100,'Ordered');
insert into erp_journal_line_links (org_id, procurement_id, erp_doctype, voucher_no, project_id, account) values
  ('06990000-0000-0000-0000-00000000000a','06990000-0000-0000-0000-0000000000e1','Journal Entry','JV-M','06990000-0000-0000-0000-0000000000d1','Acct X'),
  ('06990000-0000-0000-0000-00000000000a','06990000-0000-0000-0000-0000000000e3','Journal Entry','JV-N','06990000-0000-0000-0000-0000000000d1','Acct X');

select throws_ok($$update procurements set project_id = '06990000-0000-0000-0000-0000000000d2' where id = '06990000-0000-0000-0000-0000000000e1'$$,
  '23514', 'A purchase with attached journal lines cannot move to another project. Detach the lines first.',
  'AC-JEC-020 Draft move with attached lines is refused');
select is((select project_id from procurements where id = '06990000-0000-0000-0000-0000000000e1'), '06990000-0000-0000-0000-0000000000d1'::uuid,
  'AC-JEC-020 the purchase stays on its project');
select is((select count(*)::int from erp_journal_line_links where procurement_id = '06990000-0000-0000-0000-0000000000e1' and project_id = '06990000-0000-0000-0000-0000000000d1'), 1,
  'AC-JEC-020 the line stays on the line''s project, so totals on both projects are unchanged');
select lives_ok($$update procurements set title = 'Renamed', total_value = 90 where id = '06990000-0000-0000-0000-0000000000e1'$$,
  'AC-JEC-020 other edits of an attached Draft still work');
select lives_ok($$update procurements set project_id = '06990000-0000-0000-0000-0000000000d2' where id = '06990000-0000-0000-0000-0000000000e2'$$,
  'AC-JEC-020 an unattached Draft moves');
select is((select project_id from procurements where id = '06990000-0000-0000-0000-0000000000e2'), '06990000-0000-0000-0000-0000000000d2'::uuid,
  'AC-JEC-020 the unattached move took effect');
select lives_ok($$delete from erp_journal_line_links where procurement_id = '06990000-0000-0000-0000-0000000000e1'$$, 'AC-JEC-020 detach');
select lives_ok($$update procurements set project_id = '06990000-0000-0000-0000-0000000000d2' where id = '06990000-0000-0000-0000-0000000000e1'$$,
  'AC-JEC-020 after detach the move succeeds');

select * from finish();
rollback;
