-- 1400_work_order_closeout.test.sql — the work-order close-out checklist (#2593): the organisation's list, the copy onto an issued
-- work order, the document and order rules, and the close guard on both routes. AC-WCO-001..007, 009, 010.
-- Ids: 14000000-… (synthetic). Org a1 has the list; a2 is foreign with no list. Users: b1 admin, b2 finance, b3 PM of project c1,
-- b4 another PM, b5 engineer, b8 foreign admin. Item names are generic on purpose: the list is client data.
begin;
create extension if not exists pgtap;
select plan(55);

insert into organizations (id, name, default_currency, default_timezone) values
  ('14000000-0000-0000-0000-0000000000a1', 'WCO Org A', 'IDR', 'UTC'),
  ('14000000-0000-0000-0000-0000000000a2', 'WCO Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('14000000-0000-0000-0000-0000000000b1', 'wco-admin@example.com'),
  ('14000000-0000-0000-0000-0000000000b2', 'wco-fin@example.com'),
  ('14000000-0000-0000-0000-0000000000b3', 'wco-pm@example.com'),
  ('14000000-0000-0000-0000-0000000000b4', 'wco-pm2@example.com'),
  ('14000000-0000-0000-0000-0000000000b5', 'wco-eng@example.com'),
  ('14000000-0000-0000-0000-0000000000b8', 'wco-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('14000000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-0000000000a1', 'WCO Admin', 'wco-admin@example.com', 'Admin', 'active'),
  ('14000000-0000-0000-0000-0000000000b2', '14000000-0000-0000-0000-0000000000a1', 'WCO Finance', 'wco-fin@example.com', 'Finance', 'active'),
  ('14000000-0000-0000-0000-0000000000b3', '14000000-0000-0000-0000-0000000000a1', 'WCO PM', 'wco-pm@example.com', 'Project Manager', 'active'),
  ('14000000-0000-0000-0000-0000000000b4', '14000000-0000-0000-0000-0000000000a1', 'WCO PM Two', 'wco-pm2@example.com', 'Project Manager', 'active'),
  ('14000000-0000-0000-0000-0000000000b5', '14000000-0000-0000-0000-0000000000a1', 'WCO Engineer', 'wco-eng@example.com', 'Engineer', 'active'),
  ('14000000-0000-0000-0000-0000000000b8', '14000000-0000-0000-0000-0000000000a2', 'WCO Foreign Admin', 'wco-foreign@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('14000000-0000-0000-0000-0000000000c1', '14000000-0000-0000-0000-0000000000a1', 'WCO project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, '14000000-0000-0000-0000-0000000000b3'),
  ('14000000-0000-0000-0000-0000000000c2', '14000000-0000-0000-0000-0000000000a1', 'WCO other', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, '14000000-0000-0000-0000-0000000000b3'),
  ('14000000-0000-0000-0000-0000000000c3', '14000000-0000-0000-0000-0000000000a2', 'WCO foreign', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('14000000-0000-0000-0000-000000000e01', '14000000-0000-0000-0000-0000000000a1', '14000000-0000-0000-0000-0000000000c1', 'L1', 'Line', 'm', 100, 10);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path)
select d.id::uuid, '14000000-0000-0000-0000-0000000000a1'::uuid, d.project::uuid, 'Acceptance', d.title, d.status::doc_status,
       '14000000-0000-0000-0000-0000000000b2'::uuid,
       case when d.has_file then '14000000-0000-0000-0000-0000000000a1/' || d.project || '/' || d.id || '/doc.pdf' end
  from (values
    ('14000000-0000-0000-0000-000000000f01', '14000000-0000-0000-0000-0000000000c1', 'WCO doc approved', 'Approved', true),
    ('14000000-0000-0000-0000-000000000f02', '14000000-0000-0000-0000-0000000000c1', 'WCO doc issued', 'Issued', true),
    ('14000000-0000-0000-0000-000000000f03', '14000000-0000-0000-0000-0000000000c1', 'WCO doc draft', 'Draft', true),
    ('14000000-0000-0000-0000-000000000f04', '14000000-0000-0000-0000-0000000000c1', 'WCO doc no file', 'Approved', false),
    ('14000000-0000-0000-0000-000000000f05', '14000000-0000-0000-0000-0000000000c2', 'WCO doc other project', 'Approved', true)
  ) as d(id, project, title, status, has_file);

create temp table _state (k text primary key, v text not null) on commit drop;
grant all on _state to authenticated;
create function pg_temp.detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics d = pg_exception_detail; return sqlstate || ' ' || coalesce(d, ''); end $$;
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"14000000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.item(p_wo text, p_pos int) returns uuid language sql as $$
  select i.id from work_order_closeout_items i where i.work_order_id = p_wo::uuid and i.position = p_pos $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;

-- ── AC-WCO-002: only Admin replaces the organisation's list ────────────────────────────────────────────────────────────
select pg_temp.as_user('b2');
select is(pg_temp.detail($$select set_closeout_checklist('[{"name":"Item one"}]')$$), '42501 ', 'AC-WCO-002 Finance cannot replace the list');
select pg_temp.as_user('b3');
select is(pg_temp.detail($$select set_closeout_checklist('[{"name":"Item one"}]')$$), '42501 ', 'AC-WCO-002 a Project Manager cannot replace the list');
select pg_temp.as_user('b5');
select is(pg_temp.detail($$select set_closeout_checklist('[{"name":"Item one"}]')$$), '42501 ', 'AC-WCO-002 an Engineer cannot replace the list');
select pg_temp.as_user('b1');
select is(pg_temp.detail($$select set_closeout_checklist('[{"name":"  "}]')$$), '23514 item-name-invalid', 'AC-WCO-002 an item needs a name');
select is((select set_closeout_checklist('[{"name":"Item one"},{"name":"Item two","required":true},{"name":"Item three","required":false}]'::jsonb)),
          3, 'AC-WCO-002 Admin saves a list of three items, one optional');
reset role;
select is((select count(*)::int from closeout_checklist_templates where org_id = '14000000-0000-0000-0000-0000000000a1'), 3, 'AC-WCO-001 the list is stored in order');
select is((select string_agg(position || ':' || name || ':' || required, ',' order by position) from closeout_checklist_templates
            where org_id = '14000000-0000-0000-0000-0000000000a1'), '1:Item one:true,2:Item two:true,3:Item three:false',
          'AC-WCO-001 each item keeps its order and required flag');

-- ── AC-WCO-001: issuing copies the list; a later edit leaves the issued work order alone ──────────────────────────────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('14000000-0000-0000-0000-000000000031', '14000000-0000-0000-0000-0000000000a1', '14000000-0000-0000-0000-0000000000c1', 'WCO one', 'Draft', 10000, 'exclusive', 0),
  ('14000000-0000-0000-0000-000000000032', '14000000-0000-0000-0000-0000000000a1', '14000000-0000-0000-0000-0000000000c1', 'WCO lines', 'Draft', 10000, 'exclusive', 0),
  ('14000000-0000-0000-0000-000000000033', '14000000-0000-0000-0000-0000000000a1', '14000000-0000-0000-0000-0000000000c1', 'WCO optional', 'Draft', 10000, 'exclusive', 0);
select is((select count(*)::int from work_order_closeout_items), 0, 'AC-WCO-001 a Draft work order has no checklist yet');
update work_orders set status = 'Issued', issued_at = now()
 where id in ('14000000-0000-0000-0000-000000000031', '14000000-0000-0000-0000-000000000033');
select is((select string_agg(position || ':' || name || ':' || required || ':' || (done_on is null), ',' order by position)
             from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000031'),
          '1:Item one:true:true,2:Item two:true:true,3:Item three:false:true', 'AC-WCO-001 an issued work order has the three items in order, none done');
select is((select started_on from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000031' and position = 1),
          pg_temp.today(), 'AC-WCO-001 only the first item has started, today');
select is((select count(*)::int from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000031' and started_on is not null),
          1, 'AC-WCO-001 later items start when the one before is done');
select pg_temp.as_user('b1');
select is((select set_closeout_checklist('[{"name":"Replaced"}]'::jsonb)), 1, 'AC-WCO-001 Admin later edits the organisation list');
reset role;
select is((select count(*)::int from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000031'), 3,
          'AC-WCO-001 the already-issued work order keeps its three items');
select pg_temp.as_user('b1');
select set_closeout_checklist('[{"name":"Item one"},{"name":"Item two","required":true},{"name":"Item three","required":false}]'::jsonb);
reset role;
update work_orders set status = 'Issued', issued_at = now() where id = '14000000-0000-0000-0000-000000000032';

-- ── AC-WCO-003: a document is needed to mark done; only an Issued/Approved same-project document with a file attaches ──
select pg_temp.as_user('b2');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today())$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '55000 item-document-missing', 'AC-WCO-003 an item with no document cannot be marked done');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f03')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '23514 item-document-invalid', 'AC-WCO-003 a Draft document is refused');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f04')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '23514 item-document-invalid', 'AC-WCO-003 a document without a file is refused');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f05')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '23514 item-document-invalid', 'AC-WCO-003 another project''s document is refused');
select pg_temp.as_user('b5');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f01')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '42501 ', 'AC-WCO-003 an Engineer cannot attach');
select pg_temp.as_user('b4');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f01')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '42501 ', 'AC-WCO-003 a Project Manager who does not manage the project cannot attach');
select pg_temp.as_user('b2');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f01')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          'ok', 'AC-WCO-003 Finance attaches an Approved document with a file');

-- ── AC-WCO-004: order and dates ────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f02')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 2))),
          'ok', 'AC-WCO-004 an Issued document attaches to the second item');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today())$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 2))),
          '55000 item-out-of-order', 'AC-WCO-004 the second item cannot be done while the first is open');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today() + 1)$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '22023 item-date-invalid', 'AC-WCO-004 a future done date is refused');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today() - 1)$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '22023 item-date-invalid', 'AC-WCO-004 a done date before the item started is refused');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today())$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          'ok', 'AC-WCO-004 the first item is marked done');
reset role;
select is((select done_by::text || ' ' || (done_at is not null)::text from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000031' and position = 1),
          '14000000-0000-0000-0000-0000000000b2 true', 'AC-WCO-004 who marked it and when are recorded');
select is((select started_on from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000031' and position = 2),
          pg_temp.today(), 'AC-WCO-004 the next item starts on the previous done date');
select pg_temp.as_user('b2');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today())$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '55000 item-already-done', 'AC-WCO-004 a done item cannot be marked again');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f02')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 1))),
          '55000 item-already-done', 'AC-WCO-004 a done item''s document cannot change');

-- ── AC-WCO-005: the transition route is gated ──────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('b3');
select is(pg_temp.detail($$select transition_work_order('14000000-0000-0000-0000-000000000031', 'Closed')$$),
          '55000 closeout-incomplete', 'AC-WCO-005 a Project Manager cannot close with required items open');
select is((select status::text from work_orders where id = '14000000-0000-0000-0000-000000000031'), 'Issued', 'AC-WCO-005 the work order stays Issued');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f01')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 2))),
          'ok', 'AC-WCO-003 the project''s own manager may attach');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today())$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 2))),
          'ok', 'AC-WCO-004 the project''s manager marks the second item done');
select is(pg_temp.detail($$select transition_work_order('14000000-0000-0000-0000-000000000031', 'Closed')$$),
          'ok', 'AC-WCO-007 with every required item done and the optional one open, it closes');
reset role;
select is((select closed_by::text from work_orders where id = '14000000-0000-0000-0000-000000000031'), '14000000-0000-0000-0000-0000000000b3',
          'AC-WCO-005 closed_by is the caller');
select is((select count(*)::int from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000031' and done_on is null), 1,
          'AC-WCO-007 the optional item is left not done');
select pg_temp.as_user('b2');
select is(pg_temp.detail(format($$select attach_closeout_item_document(%L, '14000000-0000-0000-0000-000000000f01')$$, pg_temp.item('14000000-0000-0000-0000-000000000031', 3))),
          '55000 work-order-not-issued', 'AC-WCO-003 a closed work order''s items no longer change');

-- ── AC-WCO-006: the final-acceptance route is gated, atomically ───────────────────────────────────────────────────────
reset role;
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('14000000-0000-0000-0000-0000000000a1', '14000000-0000-0000-0000-000000000032', '14000000-0000-0000-0000-000000000e01', 10);
select pg_temp.as_user('b3');
select set_config('wco.acc', public.prepare_work_order_acceptance('14000000-0000-0000-0000-000000000032', current_date, true,
  '[{"boq_item_id":"14000000-0000-0000-0000-000000000e01","quantity":10}]'::jsonb, '14000000-0000-0000-0000-000000000f02')::text, true);
select pg_temp.as_user('b2');
select is(pg_temp.detail($$select confirm_work_order_acceptance(current_setting('wco.acc')::uuid)$$),
          '55000 closeout-incomplete', 'AC-WCO-006 the final acceptance is refused while a required item is open');
reset role;
select is((select status from work_order_acceptances where id = current_setting('wco.acc')::uuid), 'Draft', 'AC-WCO-006 the acceptance stays unconfirmed');
select is((select closing_value from work_orders where id = '14000000-0000-0000-0000-000000000032'), null::numeric, 'AC-WCO-006 no closing value is stamped');
select is((select status::text from work_orders where id = '14000000-0000-0000-0000-000000000032'), 'Issued', 'AC-WCO-006 the work order stays Issued');
select pg_temp.as_user('b2');
select attach_closeout_item_document(pg_temp.item('14000000-0000-0000-0000-000000000032', 1), '14000000-0000-0000-0000-000000000f01');
select complete_closeout_item(pg_temp.item('14000000-0000-0000-0000-000000000032', 1), pg_temp.today());
select attach_closeout_item_document(pg_temp.item('14000000-0000-0000-0000-000000000032', 2), '14000000-0000-0000-0000-000000000f02');
select complete_closeout_item(pg_temp.item('14000000-0000-0000-0000-000000000032', 2), pg_temp.today());
select is(pg_temp.detail($$select confirm_work_order_acceptance(current_setting('wco.acc')::uuid)$$),
          'ok', 'AC-WCO-006 with the checklist complete the final acceptance confirms');
reset role;
select is((select status::text || ' ' || closing_value::text || ' ' || closed_by::text from work_orders where id = '14000000-0000-0000-0000-000000000032'),
          'Closed 100.00 14000000-0000-0000-0000-0000000000b2', 'AC-WCO-006 the work order closes with its closing value and closed_by');
select is((select count(*)::int from audit_events where action in ('closeout_item.complete','closeout_item.document.attach','closeout_checklist.set')), 12,
          'AC-WCO-006 every write left an audit event');

-- ── AC-WCO-010: a work order already Issued when this shipped has no checklist ────────────────────────────────────────
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('14000000-0000-0000-0000-000000000034', '14000000-0000-0000-0000-0000000000a1', '14000000-0000-0000-0000-0000000000c1', 'WCO legacy', 'Issued', 10000, 'exclusive', 0);
select is((select count(*)::int from work_order_closeout_items where work_order_id = '14000000-0000-0000-0000-000000000034'), 0,
          'AC-WCO-010 a work order inserted already Issued has no items');
select pg_temp.as_user('b3');
select is(pg_temp.detail($$select transition_work_order('14000000-0000-0000-0000-000000000034', 'Closed')$$), 'ok', 'AC-WCO-010 it closes under the old rules');

-- ── AC-WCO-007 / AC-WCO-009: an organisation with no list, and the tenancy wall ───────────────────────────────────────
reset role;
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('14000000-0000-0000-0000-000000000041', '14000000-0000-0000-0000-0000000000a2', '14000000-0000-0000-0000-0000000000c3', 'WCO foreign', 'Draft', 10000, 'exclusive', 0);
update work_orders set status = 'Issued', issued_at = now() where id = '14000000-0000-0000-0000-000000000041';
select is((select count(*)::int from work_order_closeout_items where org_id = '14000000-0000-0000-0000-0000000000a2'), 0,
          'AC-WCO-007 an organisation with an empty list gets no items');
select pg_temp.as_user('b8');
select is(pg_temp.detail($$select transition_work_order('14000000-0000-0000-0000-000000000041', 'Closed')$$), 'ok', 'AC-WCO-007 it closes as before');
select is((select count(*)::int from closeout_checklist_templates), 0, 'AC-WCO-009 another organisation sees none of the list');
select is((select count(*)::int from work_order_closeout_items), 0, 'AC-WCO-009 another organisation sees none of the items');
select is(pg_temp.detail(format($$select complete_closeout_item(%L, pg_temp.today())$$, '14000000-0000-0000-0000-000000000099')), 'P0002 ',
          'AC-WCO-009 another organisation''s item is not found');
select is(pg_temp.detail($$update work_order_closeout_items set done_on = current_date$$), '42501 ', 'AC-WCO-009 there is no client write grant on the items');
select is(pg_temp.detail($$update work_orders set closed_by = null where id = '14000000-0000-0000-0000-000000000041'$$), '42501 ', 'AC-WCO-009 closed_by cannot be written by a client');
select is((select set_closeout_checklist('[{"name":"Foreign item"}]'::jsonb)), 1, 'AC-WCO-009 the foreign Admin sets only its own list');
reset role;
select is((select count(*)::int from closeout_checklist_templates where org_id = '14000000-0000-0000-0000-0000000000a1'), 3, 'AC-WCO-009 the first organisation''s list is untouched');

select * from finish();
rollback;
