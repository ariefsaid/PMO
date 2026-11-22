-- 1564_timesheet_approval_route.test.sql — fix-waiting item 3 (FR-WAIT-006).
-- Migration under test: 1564_timesheet_approval_route.sql.
-- Each case projects transition_timesheet's CURRENT approve/reject authority (0855 + the 1461
-- light-account guard): owner SoD for every role; the raw assigned manager; Admin break-glass always;
-- Executive ONLY on a raw null manager. The route is SECURITY INVOKER, so timesheets_select and
-- profiles_select are the visibility boundary and an invisible/foreign/non-Submitted sheet is the same
-- empty shape.
begin;
select plan(35);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15640000-0000-0000-0000-00000000000a', 'Route Org A', 'IDR', 'Asia/Jakarta'),
  ('15640000-0000-0000-0000-00000000000b', 'Route Org B', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('15640000-0000-0000-0000-0000000000a1', 'route-owner@example.com'),
  ('15640000-0000-0000-0000-0000000000a2', 'route-manager@example.com'),
  ('15640000-0000-0000-0000-0000000000a3', 'route-admin-1@example.com'),
  ('15640000-0000-0000-0000-0000000000a4', 'route-exec@example.com'),
  ('15640000-0000-0000-0000-0000000000a5', 'route-owner-nomgr@example.com'),
  ('15640000-0000-0000-0000-0000000000a6', 'route-owner-inactive@example.com'),
  ('15640000-0000-0000-0000-0000000000a7', 'route-manager-disabled@example.com'),
  ('15640000-0000-0000-0000-0000000000a8', 'route-admin-2@example.com'),
  ('15640000-0000-0000-0000-0000000000a9', 'route-admin-author@example.com'),
  ('15640000-0000-0000-0000-0000000000aa', 'route-admin-3@example.com'),
  ('15640000-0000-0000-0000-0000000000ac', 'route-owner-foreign@example.com'),
  ('15640000-0000-0000-0000-0000000000ad', 'route-light-manager@example.com'),
  ('15640000-0000-0000-0000-0000000000ae', 'route-owner-light@example.com'),
  ('15640000-0000-0000-0000-0000000000b1', 'route-other-org@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-00000000000a', 'Owner One', 'route-owner@example.com', 'Engineer', 'active'),
  ('15640000-0000-0000-0000-0000000000a2', '15640000-0000-0000-0000-00000000000a', 'Manager Two', 'route-manager@example.com', 'Engineer', 'active'),
  ('15640000-0000-0000-0000-0000000000a3', '15640000-0000-0000-0000-00000000000a', 'Admin Three', 'route-admin-1@example.com', 'Admin', 'active'),
  ('15640000-0000-0000-0000-0000000000a4', '15640000-0000-0000-0000-00000000000a', 'Exec Four', 'route-exec@example.com', 'Executive', 'active'),
  ('15640000-0000-0000-0000-0000000000a5', '15640000-0000-0000-0000-00000000000a', 'Owner Five', 'route-owner-nomgr@example.com', 'Engineer', 'active'),
  ('15640000-0000-0000-0000-0000000000a6', '15640000-0000-0000-0000-00000000000a', 'Owner Six', 'route-owner-inactive@example.com', 'Engineer', 'active'),
  ('15640000-0000-0000-0000-0000000000a7', '15640000-0000-0000-0000-00000000000a', 'Manager Disabled', 'route-manager-disabled@example.com', 'Engineer', 'disabled'),
  ('15640000-0000-0000-0000-0000000000a8', '15640000-0000-0000-0000-00000000000a', 'Admin Eight', 'route-admin-2@example.com', 'Admin', 'active'),
  ('15640000-0000-0000-0000-0000000000a9', '15640000-0000-0000-0000-00000000000a', 'Admin Author', 'route-admin-author@example.com', 'Admin', 'active'),
  ('15640000-0000-0000-0000-0000000000aa', '15640000-0000-0000-0000-00000000000a', 'Admin Ten', 'route-admin-3@example.com', 'Admin', 'active'),
  ('15640000-0000-0000-0000-0000000000ac', '15640000-0000-0000-0000-00000000000a', 'Owner Foreign', 'route-owner-foreign@example.com', 'Engineer', 'active'),
  ('15640000-0000-0000-0000-0000000000ae', '15640000-0000-0000-0000-00000000000a', 'Owner Light Manager', 'route-owner-light@example.com', 'Engineer', 'active'),
  ('15640000-0000-0000-0000-0000000000b1', '15640000-0000-0000-0000-00000000000b', 'Other Org B', 'route-other-org@example.com', 'Engineer', 'active');

-- A light account (built-in role foreman, 1205) cannot decide — the 1461 guard on transition_timesheet.
-- Turn the org's built-in roles on only so the fixture row can hold the key; no route rule reads the switch.
update organizations set built_in_roles_enabled = true where id = '15640000-0000-0000-0000-00000000000a';
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('15640000-0000-0000-0000-0000000000ad', '15640000-0000-0000-0000-00000000000a', 'Light Manager', 'route-light-manager@example.com', 'Engineer', 'active', 'foreman');

-- The RAW manager assignments the authority compares against. Manager Two is active; Manager Disabled
-- keeps a non-null manager_id; Other Org B is a cross-organisation manager row.
update profiles set manager_id = '15640000-0000-0000-0000-0000000000a2' where id = '15640000-0000-0000-0000-0000000000a1';
update profiles set manager_id = '15640000-0000-0000-0000-0000000000a7' where id = '15640000-0000-0000-0000-0000000000a6';
update profiles set manager_id = '15640000-0000-0000-0000-0000000000b1' where id = '15640000-0000-0000-0000-0000000000ac';
update profiles set manager_id = '15640000-0000-0000-0000-0000000000ad' where id = '15640000-0000-0000-0000-0000000000ae';

insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('15640000-0000-0000-0000-000000000101', '15640000-0000-0000-0000-00000000000a', '15640000-0000-0000-0000-0000000000a1', '2026-06-01', 'Submitted'),
  ('15640000-0000-0000-0000-000000000102', '15640000-0000-0000-0000-00000000000a', '15640000-0000-0000-0000-0000000000a5', '2026-06-01', 'Submitted'),
  ('15640000-0000-0000-0000-000000000103', '15640000-0000-0000-0000-00000000000a', '15640000-0000-0000-0000-0000000000a6', '2026-06-01', 'Submitted'),
  ('15640000-0000-0000-0000-000000000104', '15640000-0000-0000-0000-00000000000a', '15640000-0000-0000-0000-0000000000ac', '2026-06-01', 'Submitted'),
  ('15640000-0000-0000-0000-000000000105', '15640000-0000-0000-0000-00000000000a', '15640000-0000-0000-0000-0000000000a9', '2026-06-01', 'Submitted'),
  ('15640000-0000-0000-0000-000000000106', '15640000-0000-0000-0000-00000000000b', '15640000-0000-0000-0000-0000000000b1', '2026-06-01', 'Submitted'),
  ('15640000-0000-0000-0000-000000000107', '15640000-0000-0000-0000-00000000000a', '15640000-0000-0000-0000-0000000000a1', '2026-06-08', 'Draft'),
  ('15640000-0000-0000-0000-000000000108', '15640000-0000-0000-0000-00000000000a', '15640000-0000-0000-0000-0000000000ae', '2026-06-01', 'Submitted');

-- Route read as a chosen caller. The caller role is authenticated; the id is the only function argument.
create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp._route(p_uid uuid, p_sheet uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp._as(p_uid);
  return public.get_timesheet_approval_route(p_sheet);
end $$;
create or replace function pg_temp._has(p_route jsonb, p_uid uuid, p_role text) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(p_route->'approvers') a
     where (a->>'id')::uuid = p_uid
       and (p_role is null or a->>'role' = p_role)
  );
$$;

-- ── Grant surface (checked as the session owner, before switching role) ─────────────────────────
select ok(has_function_privilege('authenticated', 'public.get_timesheet_approval_route(uuid)', 'EXECUTE'),
  '1564: authenticated may execute the route read');
select ok(not has_function_privilege('anon', 'public.get_timesheet_approval_route(uuid)', 'EXECUTE'),
  '1564: anon may not execute the route read');

set local role authenticated;

-- ── An assigned manager + Admin break-glass (Admin is never filtered out) ──────────────────────
select is((pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000101'))->>'route_kind',
  'line_manager', '1564: a raw manager_id reads as the line-manager route');
select is(jsonb_array_length(pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000101')->'approvers'),
  5, '1564: manager + every active Admin (four) are the exact candidates');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000101'), '15640000-0000-0000-0000-0000000000a2', 'line_manager'),
  '1564: the assigned manager is named with the line_manager role token');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000101'), '15640000-0000-0000-0000-0000000000a3', 'Admin'),
  '1564: Admin break-glass stays eligible while a manager is assigned');
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000101'), '15640000-0000-0000-0000-0000000000a4', 'Executive'),
  '1564: Executive is not added when the raw manager_id is non-null');
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000101'), '15640000-0000-0000-0000-0000000000a1', null),
  '1564: the owner is excluded from every role (SoD)');

-- ── No manager: Admin + Executive fallback ───────────────────────────────────────────────────
select is((pg_temp._route('15640000-0000-0000-0000-0000000000a5', '15640000-0000-0000-0000-000000000102'))->>'route_kind',
  'admin_executive', '1564: a null raw manager_id reads as the Admin/Executive fallback');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a5', '15640000-0000-0000-0000-000000000102'), '15640000-0000-0000-0000-0000000000a4', 'Executive'),
  '1564: Executive fallback applies when the raw manager_id is null');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a5', '15640000-0000-0000-0000-000000000102'), '15640000-0000-0000-0000-0000000000a3', 'Admin'),
  '1564: Admin is also eligible on the null-manager fallback');

-- ── A non-null but DISABLED manager must not open the Executive fallback ─────────────────────
select is((pg_temp._route('15640000-0000-0000-0000-0000000000a6', '15640000-0000-0000-0000-000000000103'))->>'route_kind',
  'line_manager', '1564: a disabled manager keeps the raw line-manager route');
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a6', '15640000-0000-0000-0000-000000000103'), '15640000-0000-0000-0000-0000000000a7', null),
  '1564: an inactive manager is not named as an eligible candidate');
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a6', '15640000-0000-0000-0000-000000000103'), '15640000-0000-0000-0000-0000000000a4', 'Executive'),
  '1564: a non-null inactive manager does NOT add Executive (raw null is the only fallback trigger)');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a6', '15640000-0000-0000-0000-000000000103'), '15640000-0000-0000-0000-0000000000a3', 'Admin'),
  '1564: Admin break-glass remains when the manager is inactive');

-- ── A light account cannot decide (the 1461 write guard) ─────────────────────────────────────
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000ae', '15640000-0000-0000-0000-000000000108'), '15640000-0000-0000-0000-0000000000ad', null),
  '1564: a light-account manager is not named (1461 refuses its decision)');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000ae', '15640000-0000-0000-0000-000000000108'), '15640000-0000-0000-0000-0000000000a3', 'Admin'),
  '1564: Admin break-glass remains when the assigned manager is a light account');
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000ae', '15640000-0000-0000-0000-000000000108'), '15640000-0000-0000-0000-0000000000a4', 'Executive'),
  '1564: a non-null light manager does not open the Executive fallback');

-- ── A cross-organisation manager row is never named ──────────────────────────────────────────
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000ac', '15640000-0000-0000-0000-000000000104'), '15640000-0000-0000-0000-0000000000b1', null),
  '1564: a cross-organisation manager row is not named');
select is((pg_temp._route('15640000-0000-0000-0000-0000000000ac', '15640000-0000-0000-0000-000000000104'))->>'route_kind',
  'line_manager', '1564: the raw cross-org assignment still reads as configured (no Exec fallback)');

-- ── An Admin author is excluded by SoD, but other Admins/Exec still read ─────────────────────
select ok(not pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a9', '15640000-0000-0000-0000-000000000105'), '15640000-0000-0000-0000-0000000000a9', null),
  '1564: an Admin author is excluded from their own route (SoD every role)');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a9', '15640000-0000-0000-0000-000000000105'), '15640000-0000-0000-0000-0000000000a4', 'Executive'),
  '1564: the Admin author''s null-manager week still offers Executive');
select ok(pg_temp._has(pg_temp._route('15640000-0000-0000-0000-0000000000a9', '15640000-0000-0000-0000-000000000105'), '15640000-0000-0000-0000-0000000000a3', 'Admin'),
  '1564: other Admins remain eligible for the Admin author''s week');

-- ── Record visibility: invisible / foreign / other-org / non-waiting share ONE empty shape ───
select is(pg_temp._route('15640000-0000-0000-0000-0000000000a5', '15640000-0000-0000-0000-000000000101'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1564: a bystander who cannot see the sheet gets the non-leaking empty shape');
select is(pg_temp._route('15640000-0000-0000-0000-0000000000b1', '15640000-0000-0000-0000-000000000101'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1564: a cross-tenant caller gets the same empty shape');
select is(pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000106'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1564: another organisation''s sheet id is the same empty shape');
select is(pg_temp._route('15640000-0000-0000-0000-0000000000a1', '15640000-0000-0000-0000-000000000107'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1564: a visible Draft (not waiting) is the same empty shape');

-- ── Disabled caller is refused; anon cannot even reach the function ─────────────────────────
reset role;
set local role anon;
select throws_ok(
  $$ select public.get_timesheet_approval_route('15640000-0000-0000-0000-000000000101') $$,
  '42501', null, '1564: anon has no execute privilege');
reset role;
set local role authenticated;
select pg_temp._as('15640000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.get_timesheet_approval_route('15640000-0000-0000-0000-000000000101') $$,
  '42501', null, '1564: a disabled caller is refused by the active-caller assert');

-- ── Equivalence with the real write authority on valid fixtures ─────────────────────────────
-- Manager Two is in the route and can approve Owner One's Submitted week.
select pg_temp._as('15640000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ select public.transition_timesheet('15640000-0000-0000-0000-000000000101', 'Approved') $$,
  '1564: the route''s line manager can actually approve');
reset role;
update public.timesheets set status = 'Submitted', approved_by = null, approved_at = null
 where id = '15640000-0000-0000-0000-000000000101';
set local role authenticated;

-- Admin Three is in the same route (break-glass) and can approve.
select pg_temp._as('15640000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ select public.transition_timesheet('15640000-0000-0000-0000-000000000101', 'Approved') $$,
  '1564: an Admin named as break-glass can actually approve');
reset role;
update public.timesheets set status = 'Submitted', approved_by = null, approved_at = null
 where id = '15640000-0000-0000-0000-000000000101';
set local role authenticated;

-- Executive is NOT in the manager-assigned route and the write authority refuses it too.
select pg_temp._as('15640000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.transition_timesheet('15640000-0000-0000-0000-000000000101', 'Approved') $$,
  '42501', null, '1564: an Executive absent from the route is refused by the write authority');

-- A bystander Engineer is absent and refused.
select pg_temp._as('15640000-0000-0000-0000-0000000000a5');
select throws_ok(
  $$ select public.transition_timesheet('15640000-0000-0000-0000-000000000101', 'Approved') $$,
  '42501', null, '1564: a bystander absent from the route is refused');

-- The owner is absent (SoD) and refused even though they can read the sheet.
select pg_temp._as('15640000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.transition_timesheet('15640000-0000-0000-0000-000000000101', 'Approved') $$,
  '42501', null, '1564: the owner is refused (SoD), matching their absence from the route');

-- On the null-manager fixture the route names the Executive, and the authority lets them approve.
select pg_temp._as('15640000-0000-0000-0000-0000000000a4');
select lives_ok(
  $$ select public.transition_timesheet('15640000-0000-0000-0000-000000000102', 'Approved') $$,
  '1564: the Executive named on the null-manager route can actually approve');

reset role;
select * from finish();
rollback;
