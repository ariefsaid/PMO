-- 2685_closeout_owner_notice.test.sql — a close-out item tells its owner job role it is their turn (#2907).
-- AC-2907-001..004 (owning layer, pgTAP). Ids: 29070000-… (synthetic). Org a1 (UTC), org a2 (UTC, foreign).
-- The daily runner's close-out scan (1832) now tells, besides the issuer (else the active Admins): every active holder
-- of the item's owner job role, inside the item's organisation, never a light (field) account (2661's skip), told once
-- even when they are the issuer too. Items without an owner role are told exactly as before (1832 unchanged: b02/b01
-- counts below are that regression guard). The issuer b02 holds an Engineer access level with no job role, so the
-- issuer and the owner-role holder are always distinct people here (b06's own-org item is the told-once case).
--
-- MUTATION NOTES (checked live in this round's mutation run; the header records the intended rules):
--   recipients: drop the owner-role union branch        → reddens 'AC-2907-001 the holder of the owner job role is told'
--                                                         and 'AC-2907-002 the organisation's overdue items are notified'
--   recipients: drop `not is_light_role_key`            → reddens 'AC-2907-003 a light (field) account is never told'
--   recipients: drop `m.org_id = (r.i).org_id`          → reddens 'AC-2907-002' (the foreign holder's item reaches over)
--                                                         and 'AC-2907-004' (the holder count climbs)
--   recipients: drop `public.holds_job_role(...)`       → reddens 'AC-2907-003' (every active member is told)
--   scan: drop `and i.done_on is null`                  → reddens 'AC-2907-005 a done close-out item is never notified'
begin;
create extension if not exists pgtap;
-- 17 assertions.
select plan(17);

insert into organizations (id, name, default_currency, default_timezone) values
  ('29070000-0000-0000-0000-000000000a01', 'COT Org A', 'IDR', 'UTC'),
  ('29070000-0000-0000-0000-000000000a02', 'COT Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('29070000-0000-0000-0000-000000000b01', 'cot-admin@example.com'),
  ('29070000-0000-0000-0000-000000000b02', 'cot-pm@example.com'),
  ('29070000-0000-0000-0000-000000000b04', 'cot-disabled@example.com'),
  ('29070000-0000-0000-0000-000000000b05', 'cot-holder@example.com'),
  ('29070000-0000-0000-0000-000000000b06', 'cot-foreign-holder@example.com'),
  ('29070000-0000-0000-0000-000000000b07', 'cot-foreman@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('29070000-0000-0000-0000-000000000b01', '29070000-0000-0000-0000-000000000a01', 'COT Admin',    'cot-admin@example.com',    'Admin', 'active', null),
  ('29070000-0000-0000-0000-000000000b02', '29070000-0000-0000-0000-000000000a01', 'COT PM',       'cot-pm@example.com',       'Engineer', 'active', null),
  ('29070000-0000-0000-0000-000000000b04', '29070000-0000-0000-0000-000000000a01', 'COT Disabled', 'cot-disabled@example.com', 'Admin', 'disabled', null),
  ('29070000-0000-0000-0000-000000000b05', '29070000-0000-0000-0000-000000000a01', 'COT Holder',   'cot-holder@example.com',   'Project Manager', 'active', 'project_control_manager'),
  ('29070000-0000-0000-0000-000000000b06', '29070000-0000-0000-0000-000000000a02', 'COT B Holder', 'cot-foreign-holder@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('29070000-0000-0000-0000-000000000b07', '29070000-0000-0000-0000-000000000a01', 'COT Foreman',  'cot-foreman@example.com',  'Engineer', 'active', 'foreman');
insert into companies (id, org_id, name, type) values
  ('29070000-0000-0000-0000-000000000ca1', '29070000-0000-0000-0000-000000000a01', 'COT Client A', 'Client'),
  ('29070000-0000-0000-0000-000000000ca2', '29070000-0000-0000-0000-000000000a02', 'COT Client B', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id, project_manager_id) values
  ('29070000-0000-0000-0000-000000000c01', '29070000-0000-0000-0000-000000000a01', 'COT project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '29070000-0000-0000-0000-000000000ca1', '29070000-0000-0000-0000-000000000b02'),
  ('29070000-0000-0000-0000-000000000c02', '29070000-0000-0000-0000-000000000a02', 'COT foreign project', 'Ongoing Project', 'IDR',
   90000000, 'exclusive', 0, null, 1, 1, false, '29070000-0000-0000-0000-000000000ca2', '29070000-0000-0000-0000-000000000b06');
insert into work_orders (id, org_id, project_id, wo_number, title, status, issued_by, issued_at, order_value, currency, tax_treatment, tax_amount) values
  ('29070000-0000-0000-0000-000000000e01', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000c01', 'COT-1', 'COT one',   'Issued', '29070000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('29070000-0000-0000-0000-000000000e02', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000c01', 'COT-2', 'COT two',   'Issued', '29070000-0000-0000-0000-000000000b04', now(), 10000, 'IDR', 'exclusive', 0),
  ('29070000-0000-0000-0000-000000000e03', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000c01', 'COT-3', 'COT three', 'Issued', '29070000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('29070000-0000-0000-0000-000000000e04', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000c01', 'COT-4', 'COT four',  'Issued', '29070000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('29070000-0000-0000-0000-000000000e05', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000c01', 'COT-5', 'COT five',  'Issued', '29070000-0000-0000-0000-000000000b02', now(), 10000, 'IDR', 'exclusive', 0),
  ('29070000-0000-0000-0000-000000000e08', '29070000-0000-0000-0000-000000000a02', '29070000-0000-0000-0000-000000000c02', 'COT-B', 'COT foreign', 'Issued', '29070000-0000-0000-0000-000000000b06', now(), 10000, 'IDR', 'exclusive', 0);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('29070000-0000-0000-0000-000000000d01', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000c01',
   'Acceptance', 'COT acceptance', 'Approved', '29070000-0000-0000-0000-000000000b02',
   -- 0342 guard: <org_id>/<project_id>/<document_id>/<filename>, exactly four segments, segment 3 = this row's id.
   '29070000-0000-0000-0000-000000000a01/29070000-0000-0000-0000-000000000c01/29070000-0000-0000-0000-000000000d01/doc.pdf');
-- Overdue close-out items (due two days ago): f01/f02 name the project control manager, f03 the foreman (a light job
-- role), f04 no owner at all, f05 is already done (its own document, done by the issuer), f08 the foreign organisation's.
insert into work_order_closeout_items
  (id, org_id, work_order_id, project_id, position, name, required, started_on, target_days, due_on, done_on, document_id, attached_by, done_by, owner_job_role) values
  ('29070000-0000-0000-0000-000000000f01', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000e01', '29070000-0000-0000-0000-000000000c01', 1, 'COT punch list', true,
   public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 10, 5, public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 2,
   null, null, null, null, 'project_control_manager'),
  ('29070000-0000-0000-0000-000000000f02', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000e02', '29070000-0000-0000-0000-000000000c01', 1, 'COT disabled issuer', true,
   public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 10, 5, public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 2,
   null, null, null, null, 'project_control_manager'),
  ('29070000-0000-0000-0000-000000000f03', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000e03', '29070000-0000-0000-0000-000000000c01', 1, 'COT foreman item', true,
   public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 10, 5, public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 2,
   null, null, null, null, 'foreman'),
  ('29070000-0000-0000-0000-000000000f04', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000e04', '29070000-0000-0000-0000-000000000c01', 1, 'COT no owner', true,
   public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 10, 5, public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 2,
   null, null, null, null, null),
  ('29070000-0000-0000-0000-000000000f05', '29070000-0000-0000-0000-000000000a01', '29070000-0000-0000-0000-000000000e05', '29070000-0000-0000-0000-000000000c01', 1, 'COT done item', true,
   public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 10, 5, public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 2,
   public.native_org_today('29070000-0000-0000-0000-000000000a01'::uuid) - 1, '29070000-0000-0000-0000-000000000d01',
   '29070000-0000-0000-0000-000000000b02', '29070000-0000-0000-0000-000000000b02', 'project_control_manager'),
  ('29070000-0000-0000-0000-000000000f08', '29070000-0000-0000-0000-000000000a02', '29070000-0000-0000-0000-000000000e08', '29070000-0000-0000-0000-000000000c02', 1, 'COT B item', true,
   public.native_org_today('29070000-0000-0000-0000-000000000a02'::uuid) - 10, 5, public.native_org_today('29070000-0000-0000-0000-000000000a02'::uuid) - 2,
   null, null, null, null, 'project_control_manager');

create function pg_temp.as_job() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.notes(p_owner text, p_title text default null) returns int language sql as $$
  select count(*)::int from notifications n
   where n.owner_id = ('29070000-0000-0000-0000-000000000' || p_owner)::uuid
     and (p_title is null or n.title = p_title) $$;
create function pg_temp.org_notes(p_org text, p_title text) returns int language sql as $$
  select count(*)::int from notifications n
   where n.org_id = ('29070000-0000-0000-0000-000000000' || p_org)::uuid and n.title = p_title $$;

-- ── nothing has run yet ─────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from notifications where title = 'Close-out item is overdue'), 0,
  'no close-out overdue notice exists before the daily run');

-- ── AC-2907-001..005: one run notifies every overdue item once, to the issuer/Admins as before and the owner role now ──
select pg_temp.as_job();
select is(notify_overdue_billing_stages(), 5,
  'AC-2907-002 the one daily run processes the five overdue close-out items (billing and clearance scan nobody here)');
select is(pg_temp.org_notes('a01', 'Close-out item is overdue'), 6,
  'AC-2907-002 the four overdue items of this organisation reach six people: holders included, done and ownerless as before');
select is(pg_temp.org_notes('a02', 'Close-out item is overdue'), 1,
  'AC-2907-002 the other organisation''s own overdue item is notified inside it');
select is(pg_temp.notes('b05', 'Close-out item is overdue'), 2,
  'AC-2907-001 the holder of the owner job role is told for both of their open items (never the done one)');
select is(pg_temp.notes('b02', 'Close-out item is overdue'), 3,
  'AC-2907-004 the active issuer is still told for their three items with and without an owner role');
select is(pg_temp.notes('b01', 'Close-out item is overdue'), 1,
  'AC-2907-004 a disabled issuer still falls back to this organisation''s active Admin, once');
select is(pg_temp.notes('b04'), 0, 'AC-2907-004 a disabled issuer is never told');
select is(pg_temp.notes('b07', 'Close-out item is overdue'), 0,
  'AC-2907-003 a light (field) account holding a light job role is never told — it cannot open the item');
select is(pg_temp.notes('b06', 'Close-out item is overdue'), 1,
  'AC-2907-001 the other organisation''s holder is told once inside their own organisation (issuer and holder are one person)');
select is((select count(*)::int from audit_events where action = 'closeout_item.overdue'), 5,
  'AC-2907-002 each processed item still writes its one audit line');
-- ── the once-only stamp is unchanged ───────────────────────────────────────────────────────────────────────────────────
select is(notify_overdue_billing_stages(), 0, 'AC-2907-005 a second run notifies nobody');
select is(pg_temp.notes('b05', 'Close-out item is overdue'), 2,
  'AC-2907-005 the holder is not told twice for the same item');

-- ── AC-2907-006: the waiting read answers the holder, as authenticated (the invoker read's privilege boundary) ──────────
select set_config('request.jwt.claims', json_build_object('sub', '29070000-0000-0000-0000-000000000b05')::text, true);
set local role authenticated;
select is((select count(*)::int from public.my_waiting_closeout_items()), 2,
  'AC-2907-006 the holder reads both of their open items through the waiting read, as authenticated');
select set_config('request.jwt.claims', json_build_object('sub', '29070000-0000-0000-0000-000000000b07')::text, true);
select is((select count(*)::int from public.my_waiting_closeout_items()), 0,
  'AC-2907-006 a light (field) account reads nothing from the waiting read — it cannot open the item');
select set_config('request.jwt.claims', json_build_object('sub', '29070000-0000-0000-0000-000000000b06')::text, true);
select is((select count(*)::int from public.my_waiting_closeout_items()), 1,
  'AC-2907-006 the other organisation''s holder reads only their own organisation''s item');
select set_config('request.jwt.claims', json_build_object('sub', '29070000-0000-0000-0000-000000000b02')::text, true);
select is((select count(*)::int from public.my_waiting_closeout_items()), 0,
  'AC-2907-006 a light job-role key is never a match: the foreman-owned item points at nobody (the helper answers false for field accounts)');
reset role;

select * from finish();
rollback;
