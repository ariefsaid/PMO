-- record_changes_procurement_parent.test.sql — #878: purchase requests, RFQs, POs and payments are
-- filed under their PROCUREMENT (not their project), so a procurement's History tab can show its
-- documents and a procurement with no project shows them too; the project History still reaches the
-- documents through the procurement (one extra hop on read, since the tab already rolls children up).
-- AC-CHG-022 the data rule: an event for a purchase document carries parent_type='procurement' and the
--             procurement's id — including a procurement with no project — and the document's own currency.
-- AC-CHG-023 the read rule: list_record_history('procurement', …, include_children => true) returns the
--             documents' events, and the project's children query still reaches them through the
--             procurement (kind filter included).
-- Migration under test: 0277_change_history_procurement_parent.sql.
-- Cast (org A): a1 Admin · a4 PM. Fixtures are written as the owner with no JWT (actor null);
-- every read runs under a JWT because list_record_history is SECURITY INVOKER.
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a1', 'chg-admin@example.com'),
  ('07190000-0000-0000-0000-0000000000a4', 'chg-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a1', '07190000-0000-0000-0000-000000000001', 'CHG Admin', 'chg-admin@example.com', 'Admin', 'active'),
  ('07190000-0000-0000-0000-0000000000a4', '07190000-0000-0000-0000-000000000001', 'CHG PM', 'chg-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, code, name, status) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Alpha', 'Ongoing Project');
-- f1 has a project; f2 deliberately has NONE (the #878 case that showed the edits nowhere).
insert into procurements (id, org_id, title, status, project_id) values
  ('07190000-0000-0000-0000-0000000000f1', '07190000-0000-0000-0000-000000000001', 'CHG Proc', 'Draft', '07190000-0000-0000-0000-0000000000c1'),
  ('07190000-0000-0000-0000-0000000000f2', '07190000-0000-0000-0000-000000000001', 'CHG Lone Proc', 'Draft', null);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, amount, currency) values
  ('07190000-0000-0000-0000-0000000000f3', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000f1', 'PO-878', 'Draft', 500, 'USD');
delete from record_changes where org_id = '07190000-0000-0000-0000-000000000001';

-- ── the registry files the four documents under their procurement ────────────────────────────────
select is(
  (select string_agg(entity_type || ':' || parent_type || ':' || coalesce(parent_col, '-') || ':'
                     || coalesce(parent_via, 'direct'), ',' order by entity_type)
     from public.record_history_config
    where entity_type in ('purchase_request', 'rfq', 'purchase_order', 'payment')),
  'payment:procurement:procurement_id:direct,purchase_order:procurement:procurement_id:direct,'
  || 'purchase_request:procurement:procurement_id:direct,rfq:procurement:procurement_id:direct',
  'AC-CHG-022 the registry files PR / RFQ / PO / payment with their procurement as parent');

-- ── AC-CHG-022: a PO amount change is filed under its procurement ────────────────────────────────
update purchase_orders set amount = 650
 where id = '07190000-0000-0000-0000-0000000000f3';

select is(
  (select parent_type || '|' || parent_id::text from record_changes
    where entity_type = 'purchase_order' and entity_id = '07190000-0000-0000-0000-0000000000f3' and op = 'update'),
  'procurement|07190000-0000-0000-0000-0000000000f1',
  'AC-CHG-022 a PO amount change carries its procurement as parent (the issue AC)');
select is(
  (select currency from record_changes
    where entity_type = 'purchase_order' and entity_id = '07190000-0000-0000-0000-0000000000f3' and op = 'update'),
  'USD', 'AC-CHG-022 the PO event carries the document''s own currency');

-- ── AC-CHG-022: a procurement with no project still files its documents ──────────────────────────
insert into purchase_requests (id, org_id, procurement_id, pr_number, status, amount, currency) values
  ('07190000-0000-0000-0000-0000000000f4', '07190000-0000-0000-0000-000000000001',
   '07190000-0000-0000-0000-0000000000f2', 'PR-878', 'Submitted', 120, 'USD');

select is(
  (select parent_type || '|' || parent_id::text from record_changes
    where entity_type = 'purchase_request' and entity_id = '07190000-0000-0000-0000-0000000000f4' and op = 'insert'),
  'procurement|07190000-0000-0000-0000-0000000000f2',
  'AC-CHG-022 a PR under a procurement with no project is still filed (never parentless)');

insert into payments (id, org_id, procurement_id, pay_number, status, amount, currency) values
  ('07190000-0000-0000-0000-0000000000f5', '07190000-0000-0000-0000-000000000001',
   '07190000-0000-0000-0000-0000000000f1', 'PAY-878', 'Paid', 650, 'USD');

select is(
  (select parent_type || '|' || parent_id::text from record_changes
    where entity_type = 'payment' and entity_id = '07190000-0000-0000-0000-0000000000f5' and op = 'insert'),
  'procurement|07190000-0000-0000-0000-0000000000f1',
  'AC-CHG-022 a payment insert is filed under its procurement too');

-- ── AC-CHG-023: the procurement's History query returns its documents' events ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from list_record_history('procurement', '07190000-0000-0000-0000-0000000000f1', true)
    where source = 'change' and entity_type = 'purchase_order' and op = 'update'),
  1, 'AC-CHG-023 the procurement''s children query shows the PO amount change');
select is(
  (select count(*)::int from list_record_history('procurement', '07190000-0000-0000-0000-0000000000f2', true)
    where source = 'change' and entity_type = 'purchase_request' and op = 'insert'),
  1, 'AC-CHG-023 the same holds for the no-project procurement''s PR');

-- ── AC-CHG-023: the project History still reaches the documents through the procurement ──────────
select is(
  (select count(*)::int from list_record_history('project', '07190000-0000-0000-0000-0000000000c1', true)
    where source = 'change' and entity_type = 'purchase_order' and op = 'update'),
  1, 'AC-CHG-023 the project''s children query still rolls the PO up through its procurement');
select is(
  (select count(*)::int from list_record_history('project', '07190000-0000-0000-0000-0000000000c1', true,
                                                 array['purchase_order'])
    where source = 'change'),
  1, 'AC-CHG-023 the kind filter reaches the rolled-up document too');
select is(
  (select count(*)::int from list_record_history('project', '07190000-0000-0000-0000-0000000000c1', true,
                                                 array['purchase_order'])
    where source = 'change' and entity_type <> 'purchase_order'),
  0, 'AC-CHG-023 the kind filter still narrows: no other document leaks into it');

-- ── a non-Admin reads the same child events (only audit lines are Admin-gated) ───────────────────
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(
  (select count(*)::int from list_record_history('procurement', '07190000-0000-0000-0000-0000000000f1', true)
    where source = 'change' and entity_type = 'purchase_order' and op = 'update'),
  1, 'AC-CHG-023 a PM sees the PO change on the procurement''s history as well');

reset role;
set local request.jwt.claims = '';

select * from finish();
rollback;
