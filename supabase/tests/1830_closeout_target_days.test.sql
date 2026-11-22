-- 1830_closeout_target_days.test.sql — a close-out template item carries a target in days; issuing a work order works out each
-- item's due day in the organisation's own zone (#2800). AC-CTD-001 (owning layer, pgTAP) + FR-CTD-001/002.
-- Ids: 28300000-… (synthetic). Org a1 UTC (the list under test), c1 Pacific/Kiritimati (+14), d1 Pacific/Pago_Pago (-11),
-- e1 UTC with no list at all, b1 a foreign organisation whose Admin must see none of it.
-- Names are client data; only the day counts and the rules are ours.
--
-- MUTATION NOTES (intended rules for the later VPS mutation job; NOT executed by this author — no mutation evidence is claimed):
--   1830 `native_org_today(new.org_id) + t.target_days` -> `+ t.target_days + 1`
--        reddens 'AC-CTD-001 the copy due day is the issue day + 5'
--   1830 drop `t.target_days` from the copy's select list
--        reddens 'FR-CTD-002 the copy keeps each target'
--   1830 `v_days::int not between 1 and 365` -> `false`
--        reddens 'FR-CTD-001 a target of 0 days is refused'
--   1830 `t.target_days` -> `null` in the due expression
--        reddens 'AC-CTD-001 no target gives no due day'
--   1830 `+ t.target_days` -> `+ 0` (issue day, no offset)
--        reddens 'AC-CTD-001 a 365-day target lands 365 days out'
begin;
create extension if not exists pgtap;
-- 37 assertions.
select plan(37);

insert into organizations (id, name, default_currency, default_timezone) values
  ('28300000-0000-0000-0000-0000000000a1', 'CTD Org A',       'IDR', 'UTC'),
  ('28300000-0000-0000-0000-0000000000c1', 'CTD Org East',    'IDR', 'Pacific/Kiritimati'),
  ('28300000-0000-0000-0000-0000000000d1', 'CTD Org West',    'IDR', 'Pacific/Pago_Pago'),
  ('28300000-0000-0000-0000-0000000000e1', 'CTD Org No List', 'IDR', 'UTC'),
  ('28300000-0000-0000-0000-0000000000b1', 'CTD Foreign',     'IDR', 'UTC');
insert into auth.users (id, email) values
  ('28300000-0000-0000-0000-000000000b01', 'ctd-admin@example.com'),
  ('28300000-0000-0000-0000-000000000b02', 'ctd-fin@example.com'),
  ('28300000-0000-0000-0000-000000000b03', 'ctd-pm@example.com'),
  ('28300000-0000-0000-0000-000000000b04', 'ctd-eng@example.com'),
  ('28300000-0000-0000-0000-000000000b31', 'ctd-east-admin@example.com'),
  ('28300000-0000-0000-0000-000000000b41', 'ctd-west-admin@example.com'),
  ('28300000-0000-0000-0000-000000000b51', 'ctd-nolist-admin@example.com'),
  ('28300000-0000-0000-0000-000000000b61', 'ctd-foreign-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('28300000-0000-0000-0000-000000000b01', '28300000-0000-0000-0000-0000000000a1', 'CTD Admin',   'ctd-admin@example.com',   'Admin', 'active'),
  ('28300000-0000-0000-0000-000000000b02', '28300000-0000-0000-0000-0000000000a1', 'CTD Finance', 'ctd-fin@example.com',     'Finance', 'active'),
  ('28300000-0000-0000-0000-000000000b03', '28300000-0000-0000-0000-0000000000a1', 'CTD PM',      'ctd-pm@example.com',      'Project Manager', 'active'),
  ('28300000-0000-0000-0000-000000000b04', '28300000-0000-0000-0000-0000000000a1', 'CTD Eng',     'ctd-eng@example.com',     'Engineer', 'active'),
  ('28300000-0000-0000-0000-000000000b31', '28300000-0000-0000-0000-0000000000c1', 'CTD East',    'ctd-east-admin@example.com', 'Admin', 'active'),
  ('28300000-0000-0000-0000-000000000b41', '28300000-0000-0000-0000-0000000000d1', 'CTD West',    'ctd-west-admin@example.com', 'Admin', 'active'),
  ('28300000-0000-0000-0000-000000000b51', '28300000-0000-0000-0000-0000000000e1', 'CTD No List', 'ctd-nolist-admin@example.com', 'Admin', 'active'),
  ('28300000-0000-0000-0000-000000000b61', '28300000-0000-0000-0000-0000000000b1', 'CTD Foreign', 'ctd-foreign-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('28300000-0000-0000-0000-0000000000cc', '28300000-0000-0000-0000-0000000000a1', 'CTD Client', 'Client'),
  ('28300000-0000-0000-0000-0000000000c2', '28300000-0000-0000-0000-0000000000c1', 'CTD East Client', 'Client'),
  ('28300000-0000-0000-0000-0000000000c3', '28300000-0000-0000-0000-0000000000d1', 'CTD West Client', 'Client'),
  ('28300000-0000-0000-0000-0000000000c4', '28300000-0000-0000-0000-0000000000e1', 'CTD No List Client', 'Client'),
  ('28300000-0000-0000-0000-0000000000c5', '28300000-0000-0000-0000-0000000000b1', 'CTD Foreign Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('28300000-0000-0000-0000-0000000000d1', '28300000-0000-0000-0000-0000000000a1', 'CTD project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28300000-0000-0000-0000-0000000000cc', '28300000-0000-0000-0000-000000000b03'),
  ('28300000-0000-0000-0000-0000000000d2', '28300000-0000-0000-0000-0000000000c1', 'CTD east project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28300000-0000-0000-0000-0000000000c2', '28300000-0000-0000-0000-000000000b31'),
  ('28300000-0000-0000-0000-0000000000d3', '28300000-0000-0000-0000-0000000000d1', 'CTD west project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28300000-0000-0000-0000-0000000000c3', '28300000-0000-0000-0000-000000000b41'),
  ('28300000-0000-0000-0000-0000000000d4', '28300000-0000-0000-0000-0000000000e1', 'CTD no-list project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28300000-0000-0000-0000-0000000000c4', '28300000-0000-0000-0000-000000000b51'),
  ('28300000-0000-0000-0000-0000000000d5', '28300000-0000-0000-0000-0000000000b1', 'CTD foreign project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '28300000-0000-0000-0000-0000000000c5', '28300000-0000-0000-0000-000000000b61');
insert into work_orders (id, org_id, project_id, title, status, order_value, currency, tax_treatment, tax_amount) values
  ('28300000-0000-0000-0000-0000000000e1', '28300000-0000-0000-0000-0000000000a1', '28300000-0000-0000-0000-0000000000d1', 'CTD one', 'Draft', 10000, 'IDR', 'exclusive', 0),
  ('28300000-0000-0000-0000-0000000000e2', '28300000-0000-0000-0000-0000000000c1', '28300000-0000-0000-0000-0000000000d2', 'CTD east', 'Draft', 10000, 'IDR', 'exclusive', 0),
  ('28300000-0000-0000-0000-0000000000e3', '28300000-0000-0000-0000-0000000000d1', '28300000-0000-0000-0000-0000000000d3', 'CTD west', 'Draft', 10000, 'IDR', 'exclusive', 0),
  ('28300000-0000-0000-0000-0000000000e4', '28300000-0000-0000-0000-0000000000e1', '28300000-0000-0000-0000-0000000000d4', 'CTD no list', 'Draft', 10000, 'IDR', 'exclusive', 0);

create function pg_temp.detail(p_sql text) returns text language plpgsql as $$
declare d text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics d = pg_exception_detail; return sqlstate || ' ' || coalesce(d, ''); end $$;
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"28300000-0000-0000-0000-000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.item(p_wo text, p_pos int) returns uuid language sql as $$
  select i.id from work_order_closeout_items i where i.work_order_id = p_wo::uuid and i.position = p_pos $$;

-- ── FR-CTD-001: only an Admin replaces the list, and a target is a whole number of days from 1 to 365 ─────────────────────
select pg_temp.as_user('b02');
select is(pg_temp.detail($q$select set_closeout_checklist('[{"name":"Item A","target_days":5}]'::jsonb)$q$),
  '42501 ', 'FR-CTD-001 Finance cannot replace the close-out list');
select pg_temp.as_user('b03');
select is(pg_temp.detail($q$select set_closeout_checklist('[{"name":"Item A","target_days":5}]'::jsonb)$q$),
  '42501 ', 'FR-CTD-001 a Project Manager cannot replace the close-out list');
select pg_temp.as_user('b04');
select is(pg_temp.detail($q$select set_closeout_checklist('[{"name":"Item A","target_days":5}]'::jsonb)$q$),
  '42501 ', 'FR-CTD-001 an Engineer cannot replace the close-out list');
select pg_temp.as_user('b01');
select is(pg_temp.detail($q$select set_closeout_checklist('[{"name":"Item A","target_days":0}]'::jsonb)$q$),
  '23514 item-target-invalid', 'FR-CTD-001 a target of 0 days is refused');
select is(pg_temp.detail($q$select set_closeout_checklist('[{"name":"Item A","target_days":366}]'::jsonb)$q$),
  '23514 item-target-invalid', 'FR-CTD-001 a target over 365 days is refused');
select is(pg_temp.detail($q$select set_closeout_checklist('[{"name":"Item A","target_days":"ten"}]'::jsonb)$q$),
  '23514 item-target-invalid', 'FR-CTD-001 a non-numeric target is refused');
select is(pg_temp.detail($q$select set_closeout_checklist('[{"name":"Item A","target_days":2.5}]'::jsonb)$q$),
  '23514 item-target-invalid', 'FR-CTD-001 a fractional target is refused');
select is((select set_closeout_checklist('[
    {"name":"Item A","target_days":5},
    {"name":"Item B"},
    {"name":"Item C","target_days":1},
    {"name":"Item D","target_days":365},
    {"name":"Item E","target_days":"  "}]'::jsonb)),
  5, 'FR-CTD-001 an Admin saves five items: targets 5, none, 1, 365 and blank');
select is((select string_agg(coalesce(target_days::text, '-'), ',' order by position)
             from closeout_checklist_templates where org_id = '28300000-0000-0000-0000-0000000000a1'),
  '5,-,1,365,-', 'FR-CTD-001 each target is stored, a missing or blank one as no target');
select is(pg_temp.detail($q$insert into closeout_checklist_templates (org_id, position, name, target_days)
  values ('28300000-0000-0000-0000-0000000000a1', 19, 'bad low', 0)$q$),
  '23514 ', 'FR-CTD-001 the column itself refuses a target of 0 days');
select is(pg_temp.detail($q$insert into closeout_checklist_templates (org_id, position, name, target_days)
  values ('28300000-0000-0000-0000-0000000000a1', 18, 'bad high', 366)$q$),
  '23514 ', 'FR-CTD-001 the column itself refuses a target over 365 days');
select is(pg_temp.detail($q$insert into work_order_closeout_items (org_id, work_order_id, project_id, position, name, required, due_on)
  values ('28300000-0000-0000-0000-0000000000a1', '28300000-0000-0000-0000-0000000000e1',
          '28300000-0000-0000-0000-0000000000d1', 19, 'orphan due', true, current_date)$q$),
  '23514 ', 'FR-CTD-002 a due day without a target is refused');
select ok(not has_table_privilege('authenticated', 'public.work_order_closeout_items', 'insert'),
  'FR-CTD-002 no client INSERT on a work order''s checklist items');
select ok(not has_table_privilege('authenticated', 'public.work_order_closeout_items', 'update'),
  'FR-CTD-002 no client UPDATE on due_on or overdue_notified_at (the runner alone stamps them)');
select ok(not has_table_privilege('authenticated', 'public.work_order_closeout_items', 'delete'),
  'FR-CTD-002 no client DELETE of a checklist item');
select ok(not has_table_privilege('authenticated', 'public.closeout_checklist_templates', 'insert'),
  'FR-CTD-001 the template list is written only through set_closeout_checklist');
select ok(not has_table_privilege('authenticated', 'public.closeout_checklist_templates', 'update'),
  'FR-CTD-001 the template list is replaced whole, never patched by a client');

-- ── AC-CTD-001: issuing copies the list and sets the due day from the organisation's issue day ────────────────────────────
select is((select count(*)::int from work_order_closeout_items), 0, 'AC-CTD-001 a Draft work order has no checklist yet');
update work_orders set status = 'Issued', issued_at = now() where id = '28300000-0000-0000-0000-0000000000e1';
select is((select count(*)::int from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e1'), 5,
  'AC-CTD-001 issuing copies all five items');
select is((select due_on from work_order_closeout_items
            where work_order_id = '28300000-0000-0000-0000-0000000000e1' and position = 1),
  public.native_org_today('28300000-0000-0000-0000-0000000000a1'::uuid) + 5,
  'AC-CTD-001 the copy due day is the issue day + 5');
select is((select due_on from work_order_closeout_items
            where work_order_id = '28300000-0000-0000-0000-0000000000e1' and position = 2), null,
  'AC-CTD-001 no target gives no due day');
select is((select due_on from work_order_closeout_items
            where work_order_id = '28300000-0000-0000-0000-0000000000e1' and position = 3),
  public.native_org_today('28300000-0000-0000-0000-0000000000a1'::uuid) + 1,
  'AC-CTD-001 the 1-day boundary lands on the next day');
select is((select due_on from work_order_closeout_items
            where work_order_id = '28300000-0000-0000-0000-0000000000e1' and position = 4),
  public.native_org_today('28300000-0000-0000-0000-0000000000a1'::uuid) + 365,
  'AC-CTD-001 a 365-day target lands 365 days out');
select is((select due_on from work_order_closeout_items
            where work_order_id = '28300000-0000-0000-0000-0000000000e1' and position = 5), null,
  'AC-CTD-001 a blank target gives no due day');
select is((select string_agg(coalesce(target_days::text, '-'), ':' order by position)
             from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e1'),
  '5:-:1:365:-', 'FR-CTD-002 the copy keeps each target exactly');
select is((select count(*)::int from work_order_closeout_items
            where work_order_id = '28300000-0000-0000-0000-0000000000e1'
              and started_on = public.native_org_today('28300000-0000-0000-0000-0000000000a1'::uuid)), 5,
  'AC-CTD-001 every item is current from the issue day');
select is((select count(*)::int from work_order_closeout_items
            where work_order_id = '28300000-0000-0000-0000-0000000000e1' and overdue_notified_at is not null), 0,
  'AC-CTD-001 a freshly issued item carries no overdue notice stamp');
select pg_temp.as_user('b01');
select is((select set_closeout_checklist('[{"name":"Replaced"}]'::jsonb)), 1, 'AC-CTD-001 the Admin later replaces the list');
reset role;
select is((select count(*)::int from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e1'), 5,
  'AC-CTD-001 the issued work order keeps its own copy');

-- ── AC-CTD-001 org zone: two organisations 25 hours apart cannot share an issue day ──────────────────────────────────────
insert into closeout_checklist_templates (org_id, position, name, target_days) values
  ('28300000-0000-0000-0000-0000000000c1', 1, 'East handover', 5),
  ('28300000-0000-0000-0000-0000000000d1', 1, 'West handover', 5);
update work_orders set status = 'Issued', issued_at = now()
 where id in ('28300000-0000-0000-0000-0000000000e2', '28300000-0000-0000-0000-0000000000e3');
select is((select due_on from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e2'),
  public.native_org_today('28300000-0000-0000-0000-0000000000c1'::uuid) + 5,
  'AC-CTD-001 the +14 organisation''s due day is its own today + 5');
select is((select due_on from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e2'),
  (now() at time zone 'Pacific/Kiritimati')::date + 5,
  'AC-CTD-001 the +14 due day is worked out in Pacific/Kiritimati');
select is((select due_on from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e3'),
  public.native_org_today('28300000-0000-0000-0000-0000000000d1'::uuid) + 5,
  'AC-CTD-001 the -11 organisation''s due day is its own today + 5');
select is((select due_on from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e3'),
  (now() at time zone 'Pacific/Pago_Pago')::date + 5,
  'AC-CTD-001 the -11 due day is worked out in Pacific/Pago_Pago');
select ok((select e.due_on from work_order_closeout_items e where e.work_order_id = '28300000-0000-0000-0000-0000000000e2')
        > (select w.due_on from work_order_closeout_items w where w.work_order_id = '28300000-0000-0000-0000-0000000000e3'),
  'AC-CTD-001 the same target at the same instant is a later day east of the line than west of it');

-- ── no list at all: issuing copies nothing and every read is "no target, no due day" ─────────────────────────────────────
update work_orders set status = 'Issued', issued_at = now() where id = '28300000-0000-0000-0000-0000000000e4';
select is((select count(*)::int from work_order_closeout_items where work_order_id = '28300000-0000-0000-0000-0000000000e4'), 0,
  'AC-CTD-001 an organisation with no targets issues a work order with no checklist items');

-- ── another organisation sees neither the list nor the issued copy ───────────────────────────────────────────────────────
select pg_temp.as_user('b61');
select is((select count(*)::int from closeout_checklist_templates), 0,
  'FR-CTD-001 another organisation''s Admin reads none of this list');
select is((select count(*)::int from work_order_closeout_items), 0,
  'AC-CTD-001 another organisation''s Admin reads none of the issued copy');

select * from finish();
rollback;
