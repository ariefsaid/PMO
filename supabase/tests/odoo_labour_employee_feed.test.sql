-- #1510 L2 (migration 0860): the Odoo employee feed. `apply_odoo_employees` upserts one `hr.employee` page into
-- `erp_employees` and PROPOSES a link on an exact match against exactly one active PMO profile; it never confirms, never
-- re-points a `confirmed`/`rejected` row and never writes an older `write_date` over a newer one.
-- `finish_odoo_employee_census` tombstones an employee the census no longer sees, never deletes it, never touches the link.
-- AC-OLH-010, AC-OLH-011, AC-OLH-012 (the confirm path is the shipped `confirm_erp_employee_link`, amended here so a second
-- confirm for one profile REPLACES the first — AC-OLH-012's last clause — instead of colliding on the 0136 partial index).
begin;
select plan(43);

insert into organizations (id, name) values
 ('15100000-0000-0000-0000-000000000001','Labour Feed A'),
 ('15100000-0000-0000-0000-000000000002','Labour Feed B');
insert into auth.users (id, email) values
 ('15100000-0000-0000-0000-0000000000a1','one@example.com'),
 ('15100000-0000-0000-0000-0000000000e2','two@example.com'),
 ('15100000-0000-0000-0000-0000000000e4','four@example.com'),
 ('15100000-0000-0000-0000-0000000000e5','five@example.com'),
 ('15100000-0000-0000-0000-0000000000e6','FIVE@example.com'),
 ('15100000-0000-0000-0000-0000000000b1','1510-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('15100000-0000-0000-0000-0000000000a1','15100000-0000-0000-0000-000000000001','Example One','one@example.com','Admin','active'),
 ('15100000-0000-0000-0000-0000000000e2','15100000-0000-0000-0000-000000000001','Example Two','two@example.com','Engineer','disabled'),
 ('15100000-0000-0000-0000-0000000000e4','15100000-0000-0000-0000-000000000001','Example Four','four@example.com','Project Manager','active'),
 -- Two ACTIVE profiles sharing one email: the proposal must refuse to guess (AC-OLH-011's "exactly one" clause).
 ('15100000-0000-0000-0000-0000000000e5','15100000-0000-0000-0000-000000000001','Five A','five@example.com','Engineer','active'),
 ('15100000-0000-0000-0000-0000000000e6','15100000-0000-0000-0000-000000000001','Five B','FIVE@example.com','Engineer','active'),
 ('15100000-0000-0000-0000-0000000000b1','15100000-0000-0000-0000-000000000002','B Admin','1510-b-admin@example.com','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('15100000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','1510_a','active','{"odoo_company_id":1}', now());

-- An existing CONFIRMED link (the shipped ERPNext-era shape) for employee 9: the feed must leave it byte-identical.
insert into erp_employees (id, org_id, employee_number, employee_name, work_email, erp_status, erp_modified,
                           profile_id, link_state, linked_by, linked_at) values
 ('15100000-0000-0000-0000-0000000000e9','15100000-0000-0000-0000-000000000001','9','Example Four','four@example.com',
  'active','2026-11-01 08:00:00','15100000-0000-0000-0000-0000000000e4','confirmed',
  '15100000-0000-0000-0000-0000000000a1', now());
-- Another organisation's live employee with the SAME number: the census must never cross the tenant boundary.
insert into erp_employees (id, org_id, employee_number, employee_name, work_email, erp_status, erp_modified, link_state) values
 ('15100000-0000-0000-0000-0000000000f9','15100000-0000-0000-0000-000000000002','9','Other Org Nine','nine@example.com',
  'active','2026-11-01 08:00:00','unlinked');

-- ── A) One page applies, and a unique active-profile email PROPOSES the link (AC-OLH-010, AC-OLH-011) ───────────────
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"3","name":"Example One","work_email":"one@example.com","active":true,"write_date":"2026-11-09 08:00:00"}]'::jsonb),
  1, 'AC-OLH-010 a page applies one employee');
reset role;
select is((select employee_number from erp_employees where org_id = '15100000-0000-0000-0000-000000000001' and employee_number = '3'),
  '3', 'AC-OLH-010 the row is keyed by the Odoo id');
select is((select link_state from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  'proposed', 'AC-OLH-011 an exact active-profile email match PROPOSES the link');
select is((select link_proposed_reason from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  'work-email-exact-match', 'AC-OLH-011 the proposal records its auditable reason');
select is((select profile_id from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  '15100000-0000-0000-0000-0000000000a1'::uuid, 'AC-OLH-011 the proposal names the matched profile (never confirmed)');
select is((select count(*)::int from erp_employees where org_id = '15100000-0000-0000-0000-000000000001' and link_state = 'confirmed'),
  1, 'AC-OLH-011 the feed itself never confirms anything');

-- ── B) A newer page wins; an older one changes nothing (AC-OLH-010) ─────────────────────────────────────────────────
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"3","name":"Example One Renamed","work_email":"one@example.com","active":true,"write_date":"2026-11-10 09:00:00"}]'::jsonb),
  1, 'AC-OLH-010 a newer page applies');
reset role;
select is((select employee_name from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  'Example One Renamed', 'AC-OLH-010 the newer page renames the employee');
select is((select erp_modified from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  '2026-11-10 09:00:00', 'AC-OLH-010 the newer page moves the stored write_date forward');
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"3","name":"Stale Name","work_email":"one@example.com","active":true,"write_date":"2026-11-08 07:00:00"}]'::jsonb),
  0, 'AC-OLH-010 an older page applies no row');
reset role;
select is((select employee_name from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  'Example One Renamed', 'AC-OLH-010 an older page changes nothing');

-- ── C) A disabled profile never gets a proposal (AC-OLH-011) ────────────────────────────────────────────────────────
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"4","name":"Example Two","work_email":"two@example.com","active":true,"write_date":"2026-11-09 08:00:00"}]'::jsonb),
  1, 'AC-OLH-011 a second employee applies');
reset role;
select is((select link_state from erp_employees where employee_number = '4' and org_id = '15100000-0000-0000-0000-000000000001'),
  'unlinked', 'AC-OLH-011 an email matching only a DISABLED profile stays unlinked');
select is((select profile_id from erp_employees where employee_number = '4' and org_id = '15100000-0000-0000-0000-000000000001'),
  null::uuid, 'AC-OLH-011 no profile is named for the disabled match');

-- An email matching TWO active profiles proposes nothing: "exactly one active profile" is the whole guard.
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"8","name":"Example Five","work_email":"five@example.com","active":true,"write_date":"2026-11-09 08:00:00"}]'::jsonb),
  1, 'AC-OLH-011 an employee whose email matches two active profiles still mirrors');
reset role;
select is((select link_state from erp_employees where employee_number = '8' and org_id = '15100000-0000-0000-0000-000000000001'),
  'unlinked', 'AC-OLH-011 an AMBIGUOUS email is never proposed (exactly one active profile, or nothing)');
select is((select profile_id from erp_employees where employee_number = '8' and org_id = '15100000-0000-0000-0000-000000000001'),
  null::uuid, 'AC-OLH-011 the ambiguous match names no profile');

-- ── D) A confirmed row is left byte-identical by a page that changes its email (AC-OLH-011) ─────────────────────────
create temp table confirmed_before as
  select to_jsonb(t) as row from (select profile_id, link_state, linked_by, linked_at, work_email, employee_name, erp_modified
    from erp_employees where employee_number = '9' and org_id = '15100000-0000-0000-0000-000000000001') t;
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"9","name":"Renamed Nine","work_email":"nine-new@example.com","active":false,"write_date":"2026-11-11 09:00:00"}]'::jsonb),
  0, 'AC-OLH-011 a page touching a confirmed employee applies no row');
reset role;
select is((select to_jsonb(t) from (select profile_id, link_state, linked_by, linked_at, work_email, employee_name, erp_modified
    from erp_employees where employee_number = '9' and org_id = '15100000-0000-0000-0000-000000000001') t),
  (select row from confirmed_before),
  'AC-OLH-011 a confirmed link is byte-identical after a feed page changes its email');

-- ── E) `active` drives erp_status (FR-OLH-003) ──────────────────────────────────────────────────────────────────────
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"5","name":"Example Five","work_email":null,"active":false,"write_date":"2026-11-09 08:00:00"}]'::jsonb),
  1, 'AC-OLH-010 an employee without an email still mirrors');
reset role;
select is((select erp_status from erp_employees where employee_number = '5' and org_id = '15100000-0000-0000-0000-000000000001'),
  'inactive', 'FR-OLH-003 an inactive Odoo employee mirrors as inactive');

-- ── F) The census tombstones what it no longer sees, never deletes, never touches the link (AC-OLH-010) ─────────────
set local role service_role;
select is(public.finish_odoo_employee_census('15100000-0000-0000-0000-000000000001', '2026-11-10T00:00:00Z',
  '["3","4","5","8"]'::jsonb),
  1, 'AC-OLH-010 the census tombstones exactly the employee it no longer sees');
reset role;
select ok((select erp_cancelled_at is not null from erp_employees
            where employee_number = '9' and org_id = '15100000-0000-0000-0000-000000000001'),
  'AC-OLH-010 an employee absent from the census is tombstoned');
select is((select count(*)::int from erp_employees
            where employee_number = '9' and org_id = '15100000-0000-0000-0000-000000000001'),
  1, 'AC-OLH-010 the tombstoned row is never deleted');
select is((select link_state from erp_employees
            where employee_number = '9' and org_id = '15100000-0000-0000-0000-000000000001'),
  'confirmed', 'AC-OLH-010 the tombstone never touches the link state');
select ok((select erp_cancelled_at is null from erp_employees
            where employee_number = '9' and org_id = '15100000-0000-0000-0000-000000000002'),
  'AC-OLH-010 the census never crosses the tenant boundary (the same number in another org stays live)');

-- ── G) Confirm is the shipped Admin-only RPC: server-resolved witness, one audit row (AC-OLH-012) ───────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.confirm_erp_employee_link(
  (select id from public.erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  '15100000-0000-0000-0000-0000000000a1'::uuid)$$,
  'AC-OLH-012 the org Admin confirms a proposed link');
reset role;
select is((select link_state from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  'confirmed', 'AC-OLH-012 the confirmed link authorizes a push');
select is((select linked_by from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  '15100000-0000-0000-0000-0000000000a1'::uuid, 'AC-OLH-012 linked_by is the server-resolved Admin');
select ok((select linked_at is not null from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'),
  'AC-OLH-012 linked_at is server-stamped');
select is((select count(*)::int from audit_events where action = 'confirm_erp_employee_link'
            and entity_id = (select id from erp_employees where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001')),
  1, 'AC-OLH-012 one audit row records the confirm');

-- A non-Admin cannot confirm, and a foreign org's Admin cannot confirm (the RPC re-asserts org + Admin internally).
set local role authenticated;
set local request.jwt.claims = '{"sub":"15100000-0000-0000-0000-0000000000e4","role":"authenticated"}';
select throws_ok($$select public.confirm_erp_employee_link(
  (select id from public.erp_employees where employee_number = '5' and org_id = '15100000-0000-0000-0000-000000000001'),
  '15100000-0000-0000-0000-0000000000e4'::uuid)$$,
  '42501', null, 'AC-OLH-012 a Project Manager cannot confirm');
reset role;
-- The employee's id, stashed for the cross-org attempt below: that caller is in another org, so its OWN read of
-- `erp_employees` is RLS-filtered to nothing (which would make the refusal a P0002 "not found" rather than the org
-- re-assertion this test is about).
do $$ begin perform set_config('test.emp3', (select id::text from public.erp_employees
  where employee_number = '3' and org_id = '15100000-0000-0000-0000-000000000001'), true); end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.confirm_erp_employee_link(current_setting('test.emp3')::uuid,
  '15100000-0000-0000-0000-0000000000b1'::uuid)$$,
  '42501', null, 'AC-OLH-012 another organisation''s Admin cannot confirm (the shipped refusal code)');
reset role;

-- A second confirm for a profile REPLACES the first (AC-OLH-012) instead of colliding on the 0136 partial index.
set local role authenticated;
set local request.jwt.claims = '{"sub":"15100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.confirm_erp_employee_link(
  (select id from public.erp_employees where employee_number = '4' and org_id = '15100000-0000-0000-0000-000000000001'),
  '15100000-0000-0000-0000-0000000000e4'::uuid)$$,
  'AC-OLH-012 a second confirm for one profile is accepted (it replaces the first)');
reset role;
select is((select count(*)::int from erp_employees
            where org_id = '15100000-0000-0000-0000-000000000001'
              and profile_id = '15100000-0000-0000-0000-0000000000e4' and link_state = 'confirmed'),
  1, 'AC-OLH-012 exactly one employee stays confirmed for that profile');
select is((select link_state from erp_employees
            where employee_number = '9' and org_id = '15100000-0000-0000-0000-000000000001'),
  'unlinked', 'AC-OLH-012 the replaced employee is demoted out of confirmed');

-- ── H) Both writers are service-role only (NFR-OLH-004) ────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.apply_odoo_employees('15100000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  '42501', null, 'NFR-OLH-004 apply_odoo_employees is not executable by a user JWT');
reset role;
select is(has_function_privilege('authenticated', 'public.apply_odoo_employees(uuid,jsonb,text)', 'execute'), false,
  'NFR-OLH-004 authenticated has no EXECUTE on apply_odoo_employees');
select is(has_function_privilege('authenticated', 'public.finish_odoo_employee_census(uuid,text,jsonb,text)', 'execute'), false,
  'NFR-OLH-004 authenticated has no EXECUTE on finish_odoo_employee_census');
select is(has_function_privilege('anon', 'public.apply_odoo_employees(uuid,jsonb,text)', 'execute'), false,
  'NFR-OLH-004 anon has no EXECUTE on apply_odoo_employees');
select is(has_function_privilege('service_role', 'public.apply_odoo_employees(uuid,jsonb,text)', 'execute'), true,
  'NFR-OLH-004 the sweep (service_role) can apply a page');

-- ── I) A malformed row is skipped whole, never partly written (FR-OLH-003) ─────────────────────────────────────────
set local role service_role;
select is(public.apply_odoo_employees('15100000-0000-0000-0000-000000000001',
  '[{"external_id":"6","name":"","work_email":"six@example.com","active":true,"write_date":"2026-11-09 08:00:00"},
    {"external_id":"7","name":"Example Seven","active":true,"write_date":"2026-11-09T08:00:00Z"}]'::jsonb),
  0, 'FR-OLH-003 two malformed rows apply nothing');
reset role;
select is((select count(*)::int from erp_employees
            where org_id = '15100000-0000-0000-0000-000000000001' and employee_number in ('6','7')),
  0, 'FR-OLH-003 a malformed row is never partly written');

select * from finish();
rollback;
