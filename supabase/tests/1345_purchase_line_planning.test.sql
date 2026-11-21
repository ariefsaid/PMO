-- 1345_purchase_line_planning.test.sql — category and needed-by date on purchase request lines (#2696).
-- Proves migrations 1345 and 1346 (docs/specs/purchase-line-category-needed-by.spec.md):
--   AC-PLP-001 the category list is readable only inside the organisation, with no direct client write.
--   AC-PLP-002 only an Admin adds, renames or retires a category.
--   AC-PLP-003 turning the setting on seeds two starter rows once; a non-Admin cannot turn it on.
--   AC-PLP-004 with the setting OFF every path refuses a category or a date.
--   AC-PLP-005 on the requester's Draft the RPC sets and clears both fields; a retired or foreign category is refused.
--   AC-PLP-006 a non-Draft case, or a caller who may not edit the lines, is refused and the line is unchanged.
--   AC-PLP-007 another organisation can neither read nor change these rows.
-- Mutation checks (run by the orchestrator): drop the Admin check in set_purchase_line_category (AC-PLP-002 red); drop the OFF guard
-- in procurement_items_planning_guard (AC-PLP-004 red); drop the editable check in set_procurement_line_planning (AC-PLP-006 red);
-- drop the org filter on the category lookup (AC-PLP-005/007 red).
begin;
select plan(29);

insert into organizations (id, name) values
  ('26960000-0000-0000-0000-000000000001', 'PLP Org A'),
  ('26960000-0000-0000-0000-000000000002', 'PLP Org B');
insert into auth.users (id, email) values
  ('26960000-0000-0000-0000-0000000000a1', 'plp-admin-a@example.com'),
  ('26960000-0000-0000-0000-0000000000a2', 'plp-req@example.com'),
  ('26960000-0000-0000-0000-0000000000a3', 'plp-eng-other@example.com'),
  ('26960000-0000-0000-0000-0000000000a4', 'plp-fin@example.com'),
  ('26960000-0000-0000-0000-0000000000b1', 'plp-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('26960000-0000-0000-0000-0000000000a1', '26960000-0000-0000-0000-000000000001', 'PLP Admin A', 'plp-admin-a@example.com', 'Admin'),
  ('26960000-0000-0000-0000-0000000000a2', '26960000-0000-0000-0000-000000000001', 'PLP Requester', 'plp-req@example.com', 'Engineer'),
  ('26960000-0000-0000-0000-0000000000a3', '26960000-0000-0000-0000-000000000001', 'PLP Other', 'plp-eng-other@example.com', 'Engineer'),
  ('26960000-0000-0000-0000-0000000000a4', '26960000-0000-0000-0000-000000000001', 'PLP Finance', 'plp-fin@example.com', 'Finance'),
  ('26960000-0000-0000-0000-0000000000b1', '26960000-0000-0000-0000-000000000002', 'PLP Admin B', 'plp-admin-b@example.com', 'Admin');

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('26960000-0000-0000-0000-000000000010', '26960000-0000-0000-0000-000000000001', 'PLP Draft', 'Draft', '26960000-0000-0000-0000-0000000000a2'),
  ('26960000-0000-0000-0000-000000000011', '26960000-0000-0000-0000-000000000001', 'PLP Ordered', 'Ordered', '26960000-0000-0000-0000-0000000000a2');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('26960000-0000-0000-0000-000000000020', '26960000-0000-0000-0000-000000000001', '26960000-0000-0000-0000-000000000010', 'Draft line', 1, 10),
  ('26960000-0000-0000-0000-000000000021', '26960000-0000-0000-0000-000000000001', '26960000-0000-0000-0000-000000000011', 'Ordered line', 1, 10);

-- AC-PLP-004: OFF is the default; every path refuses a value.
select is((select purchase_line_planning from organizations where id = '26960000-0000-0000-0000-000000000001'), false,
  'AC-PLP-004 the setting is OFF by default');
select throws_ok($$insert into procurement_items (org_id, procurement_id, name, needed_by) values
  ('26960000-0000-0000-0000-000000000001', '26960000-0000-0000-0000-000000000010', 'x', current_date)$$, '42501', null,
  'AC-PLP-004 a direct insert with a date is refused while OFF');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000020', null, current_date)$$, '42501', null,
  'AC-PLP-004 the RPC refuses while OFF');
select is(public.get_purchase_line_planning(), false, 'AC-PLP-004 members read the setting (OFF)');

-- AC-PLP-003 / 002: only an Admin turns it on.
select throws_ok($$select set_purchase_line_planning(true)$$, '42501', null, 'AC-PLP-003 a requester cannot turn it on');
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select set_purchase_line_planning(true)$$, '42501', null, 'AC-PLP-003 Finance cannot turn it on');
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select set_purchase_line_planning(true)$$, 'AC-PLP-003 an Admin turns it on');
select lives_ok($$select set_purchase_line_planning(true)$$, 'AC-PLP-003 turning it on again is harmless');
reset role;
select is((select string_agg(name, ',' order by position) from purchase_line_categories where org_id = '26960000-0000-0000-0000-000000000001'),
  'Project,Overhead', 'AC-PLP-003 two starter rows, seeded once');

-- AC-PLP-002: Admin manages the list; others cannot.
set local role authenticated;
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select set_purchase_line_category(null, 'Site works', null)$$, 'AC-PLP-002 an Admin adds a category');
select lives_ok($$select set_purchase_line_category((select id from purchase_line_categories where name = 'Site works'), 'Site works 2', 5)$$,
  'AC-PLP-002 an Admin renames a category');
select lives_ok($$select archive_purchase_line_category((select id from purchase_line_categories where name = 'Overhead'))$$,
  'AC-PLP-002 an Admin retires a category');
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select set_purchase_line_category(null, 'Nope', null)$$, '42501', null, 'AC-PLP-002 Finance cannot add a category');
select throws_ok($$select archive_purchase_line_category((select id from purchase_line_categories where name = 'Project'))$$, '42501', null,
  'AC-PLP-002 Finance cannot retire a category');

-- AC-PLP-001: members read their own list; no direct client write.
select is((select count(*)::int from purchase_line_categories), 3, 'AC-PLP-001 a member reads the organisation list');
select throws_ok($$insert into purchase_line_categories (org_id, name) values ('26960000-0000-0000-0000-000000000001', 'Direct')$$, '42501', null,
  'AC-PLP-001 no direct insert');

-- AC-PLP-005: the requester sets and clears on their Draft.
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000020',
  (select id from purchase_line_categories where name = 'Project'), date '2026-12-31')$$, 'AC-PLP-005 the requester sets category and date');
reset role;
select is((select needed_by from procurement_items where id = '26960000-0000-0000-0000-000000000020'), date '2026-12-31',
  'AC-PLP-005 the date is stored');
select is((select c.name from procurement_items i join purchase_line_categories c on c.id = i.category_id
            where i.id = '26960000-0000-0000-0000-000000000020'), 'Project', 'AC-PLP-005 the category is stored');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000020',
  (select id from purchase_line_categories where name = 'Overhead'), null)$$, '42501', null, 'AC-PLP-005 a retired category is refused');
select lives_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000020', null, null)$$, 'AC-PLP-005 null clears both');
reset role;
select is((select category_id from procurement_items where id = '26960000-0000-0000-0000-000000000020'), null, 'AC-PLP-005 the category is cleared');

-- AC-PLP-005 / 007: a category of another organisation is refused.
insert into purchase_line_categories (id, org_id, name) values
  ('26960000-0000-0000-0000-000000000090', '26960000-0000-0000-0000-000000000002', 'Foreign');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000020',
  '26960000-0000-0000-0000-000000000090', null)$$, '42501', null, 'AC-PLP-005 another organisation''s category is refused');

-- AC-PLP-006: a caller who may not edit the lines, and a non-Draft case.
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000020', null, date '2027-01-01')$$, '42501', null,
  'AC-PLP-006 a non-requester Engineer is refused');
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000021', null, date '2027-01-01')$$, '42501', null,
  'AC-PLP-006 a case past Draft is refused');
reset role;
select is((select needed_by from procurement_items where id in ('26960000-0000-0000-0000-000000000020', '26960000-0000-0000-0000-000000000021') and needed_by is not null), null,
  'AC-PLP-006 no line changed');
select throws_ok($$update procurement_items set needed_by = current_date where id = '26960000-0000-0000-0000-000000000021'$$, '42501', null,
  'AC-PLP-006 the guard also refuses a direct update past Draft');

-- AC-PLP-007: another organisation's Admin sees nothing of A and changes nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"26960000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from purchase_line_categories where org_id = '26960000-0000-0000-0000-000000000001'), 0,
  'AC-PLP-007 org B cannot read org A categories');
select throws_ok($$select set_procurement_line_planning('26960000-0000-0000-0000-000000000020', null, date '2027-01-01')$$, '42501', null,
  'AC-PLP-007 org B cannot change an org A line');

select * from finish();
rollback;
