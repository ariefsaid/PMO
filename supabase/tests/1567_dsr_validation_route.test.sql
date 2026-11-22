-- 1567_dsr_validation_route.test.sql — fix-waiting item 3 (FR-WAIT-006).
-- Migration under test: 1567_dsr_validation_route.sql.
-- Each case projects the CURRENT write authority (1041 dsr_may_validate + dsr_validate, plus the 1530/1461
-- light-account guard): the author is excluded for every role; the assigned project manager is named only
-- when the profile is a REAL Project Manager, active, not light and not the author; Admin/Finance remain
-- true role-level alternatives; nobody else can validate is reported as 'nobody'. The route is SECURITY
-- INVOKER, so daily_site_reports_select, projects_select and profiles_select are the visibility boundary
-- and an invisible / foreign / non-Submitted report is the same non-leaking empty shape.
begin;
select plan(39);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15670000-0000-0000-0000-00000000000a', 'Dsr Route Org A', 'IDR', 'Asia/Jakarta'),
  ('15670000-0000-0000-0000-00000000000b', 'Dsr Route Org B', 'IDR', 'Asia/Jakarta'),
  ('15670000-0000-0000-0000-00000000000c', 'Dsr Route Org C', 'IDR', 'Asia/Jakarta'),
  ('15670000-0000-0000-0000-00000000000d', 'Dsr Route Org D', 'IDR', 'Asia/Jakarta'),
  ('15670000-0000-0000-0000-00000000000e', 'Dsr Route Org E', 'IDR', 'Asia/Jakarta'),
  ('15670000-0000-0000-0000-00000000000f', 'Dsr Route Org F', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('15670000-0000-0000-0000-0000000000a1', 'dsr-route-author@example.com'),
  ('15670000-0000-0000-0000-0000000000a2', 'dsr-route-pm@example.com'),
  ('15670000-0000-0000-0000-0000000000a3', 'dsr-route-finance@example.com'),
  ('15670000-0000-0000-0000-0000000000a4', 'dsr-route-admin@example.com'),
  ('15670000-0000-0000-0000-0000000000a5', 'dsr-route-bystander@example.com'),
  ('15670000-0000-0000-0000-0000000000a6', 'dsr-route-exec@example.com'),
  ('15670000-0000-0000-0000-0000000000a7', 'dsr-route-pm-disabled@example.com'),
  ('15670000-0000-0000-0000-0000000000a8', 'dsr-route-pm-author@example.com'),
  ('15670000-0000-0000-0000-0000000000a9', 'dsr-route-pm-wrong-role@example.com'),
  ('15670000-0000-0000-0000-0000000000aa', 'dsr-route-pm-light@example.com'),
  ('15670000-0000-0000-0000-0000000000b1', 'dsr-route-foreign@example.com'),
  ('15670000-0000-0000-0000-0000000000c1', 'dsr-route-fin-org-author@example.com'),
  ('15670000-0000-0000-0000-0000000000c2', 'dsr-route-fin-org-finance@example.com'),
  ('15670000-0000-0000-0000-0000000000d1', 'dsr-route-light-org-author@example.com'),
  ('15670000-0000-0000-0000-0000000000d2', 'dsr-route-light-org-finance@example.com'),
  ('15670000-0000-0000-0000-0000000000e1', 'dsr-route-admin-author@example.com'),
  ('15670000-0000-0000-0000-0000000000f1', 'dsr-route-light-pm-org-author@example.com'),
  ('15670000-0000-0000-0000-0000000000f2', 'dsr-route-light-pm@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-00000000000a', 'Author One', 'dsr-route-author@example.com', 'Engineer', 'active'),
  ('15670000-0000-0000-0000-0000000000a2', '15670000-0000-0000-0000-00000000000a', 'PM Two', 'dsr-route-pm@example.com', 'Project Manager', 'active'),
  ('15670000-0000-0000-0000-0000000000a3', '15670000-0000-0000-0000-00000000000a', 'Finance Three', 'dsr-route-finance@example.com', 'Finance', 'active'),
  ('15670000-0000-0000-0000-0000000000a4', '15670000-0000-0000-0000-00000000000a', 'Admin Four', 'dsr-route-admin@example.com', 'Admin', 'active'),
  ('15670000-0000-0000-0000-0000000000a5', '15670000-0000-0000-0000-00000000000a', 'Bystander Five', 'dsr-route-bystander@example.com', 'Engineer', 'active'),
  ('15670000-0000-0000-0000-0000000000a6', '15670000-0000-0000-0000-00000000000a', 'Executive Six', 'dsr-route-exec@example.com', 'Executive', 'active'),
  ('15670000-0000-0000-0000-0000000000a7', '15670000-0000-0000-0000-00000000000a', 'PM Disabled', 'dsr-route-pm-disabled@example.com', 'Project Manager', 'disabled'),
  ('15670000-0000-0000-0000-0000000000a8', '15670000-0000-0000-0000-00000000000a', 'PM Author', 'dsr-route-pm-author@example.com', 'Project Manager', 'active'),
  ('15670000-0000-0000-0000-0000000000a9', '15670000-0000-0000-0000-00000000000a', 'Engineer Assigned', 'dsr-route-pm-wrong-role@example.com', 'Engineer', 'active'),
  ('15670000-0000-0000-0000-0000000000b1', '15670000-0000-0000-0000-00000000000b', 'Foreign Finance', 'dsr-route-foreign@example.com', 'Finance', 'active'),
  ('15670000-0000-0000-0000-0000000000c1', '15670000-0000-0000-0000-00000000000c', 'Finance Org Author', 'dsr-route-fin-org-author@example.com', 'Engineer', 'active'),
  ('15670000-0000-0000-0000-0000000000c2', '15670000-0000-0000-0000-00000000000c', 'Finance Org Finance', 'dsr-route-fin-org-finance@example.com', 'Finance', 'active'),
  ('15670000-0000-0000-0000-0000000000d1', '15670000-0000-0000-0000-00000000000d', 'Light Org Author', 'dsr-route-light-org-author@example.com', 'Engineer', 'active'),
  ('15670000-0000-0000-0000-0000000000e1', '15670000-0000-0000-0000-00000000000e', 'Admin Author', 'dsr-route-admin-author@example.com', 'Admin', 'active'),
  ('15670000-0000-0000-0000-0000000000f1', '15670000-0000-0000-0000-00000000000f', 'Light PM Org Author', 'dsr-route-light-pm-org-author@example.com', 'Engineer', 'active');

-- Light accounts (1205). The 1202 sync trigger forces a keyed profile's access level to the key's base
-- level, and every light key (foreman, field_user) is Engineer — so a light Finance or light Project
-- Manager cannot be created by the normal path. The route's light exclusion is defence in depth for
-- exactly that state, so the fixture builds it with the sync trigger off; the whole transaction rolls
-- back. `delta` is the seat key only, never an access level.
alter table public.profiles disable trigger profiles_zz_built_in_role_sync;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('15670000-0000-0000-0000-0000000000aa', '15670000-0000-0000-0000-00000000000a', 'PM Light', 'dsr-route-pm-light@example.com', 'Project Manager', 'active', 'foreman'),
  ('15670000-0000-0000-0000-0000000000d2', '15670000-0000-0000-0000-00000000000d', 'Light Org Finance', 'dsr-route-light-org-finance@example.com', 'Finance', 'active', 'foreman'),
  ('15670000-0000-0000-0000-0000000000f2', '15670000-0000-0000-0000-00000000000f', 'Light PM', 'dsr-route-light-pm@example.com', 'Project Manager', 'active', 'foreman');
alter table public.profiles enable trigger profiles_zz_built_in_role_sync;

insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('15670000-0000-0000-0000-000000000101', '15670000-0000-0000-0000-00000000000a', 'PM assigned', 'Ongoing Project', 'IDR', '15670000-0000-0000-0000-0000000000a2'),
  ('15670000-0000-0000-0000-000000000102', '15670000-0000-0000-0000-00000000000a', 'No PM', 'Ongoing Project', 'IDR', null),
  ('15670000-0000-0000-0000-000000000103', '15670000-0000-0000-0000-00000000000a', 'Inactive PM', 'Ongoing Project', 'IDR', '15670000-0000-0000-0000-0000000000a7'),
  ('15670000-0000-0000-0000-000000000104', '15670000-0000-0000-0000-00000000000a', 'Light PM', 'Ongoing Project', 'IDR', '15670000-0000-0000-0000-0000000000aa'),
  ('15670000-0000-0000-0000-000000000105', '15670000-0000-0000-0000-00000000000a', 'Wrong-role PM', 'Ongoing Project', 'IDR', '15670000-0000-0000-0000-0000000000a9'),
  ('15670000-0000-0000-0000-000000000106', '15670000-0000-0000-0000-00000000000a', 'PM is author', 'Ongoing Project', 'IDR', '15670000-0000-0000-0000-0000000000a8'),
  ('15670000-0000-0000-0000-000000000107', '15670000-0000-0000-0000-00000000000a', 'Cross-org PM', 'Ongoing Project', 'IDR', '15670000-0000-0000-0000-0000000000b1'),
  ('15670000-0000-0000-0000-000000000108', '15670000-0000-0000-0000-00000000000a', 'Draft report project', 'Ongoing Project', 'IDR', null),
  ('15670000-0000-0000-0000-000000000109', '15670000-0000-0000-0000-00000000000b', 'Foreign project', 'Ongoing Project', 'IDR', null),
  ('15670000-0000-0000-0000-00000000010a', '15670000-0000-0000-0000-00000000000c', 'Finance-only org project', 'Ongoing Project', 'IDR', null),
  ('15670000-0000-0000-0000-00000000010b', '15670000-0000-0000-0000-00000000000d', 'Light-finance org project', 'Ongoing Project', 'IDR', null),
  ('15670000-0000-0000-0000-00000000010c', '15670000-0000-0000-0000-00000000000e', 'Admin-author org project', 'Ongoing Project', 'IDR', null),
  ('15670000-0000-0000-0000-00000000010d', '15670000-0000-0000-0000-00000000000f', 'Light-PM org project', 'Ongoing Project', 'IDR', '15670000-0000-0000-0000-0000000000f2');

insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15670000-0000-0000-0000-000000000201', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000101', 'WO PM assigned', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000202', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000102', 'WO no PM', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000203', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000103', 'WO inactive PM', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000204', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000104', 'WO light PM', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000205', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000105', 'WO wrong-role PM', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000206', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000106', 'WO PM author', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000207', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000107', 'WO cross-org PM', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000208', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000108', 'WO draft report', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-000000000209', '15670000-0000-0000-0000-00000000000b', '15670000-0000-0000-0000-000000000109', 'WO foreign', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-00000000020a', '15670000-0000-0000-0000-00000000000c', '15670000-0000-0000-0000-00000000010a', 'WO finance-only org', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-00000000020b', '15670000-0000-0000-0000-00000000000d', '15670000-0000-0000-0000-00000000010b', 'WO light-finance org', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-00000000020c', '15670000-0000-0000-0000-00000000000e', '15670000-0000-0000-0000-00000000010c', 'WO admin author', 'Issued', 1000, 'exclusive', 0),
  ('15670000-0000-0000-0000-00000000020d', '15670000-0000-0000-0000-00000000000f', '15670000-0000-0000-0000-00000000010d', 'WO light PM org', 'Issued', 1000, 'exclusive', 0);

insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, submitted_at) values
  ('15670000-0000-0000-0000-000000000301', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000101', '15670000-0000-0000-0000-000000000201', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000a1', now()),
  ('15670000-0000-0000-0000-000000000302', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000102', '15670000-0000-0000-0000-000000000202', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000a1', now()),
  ('15670000-0000-0000-0000-000000000303', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000103', '15670000-0000-0000-0000-000000000203', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000a1', now()),
  ('15670000-0000-0000-0000-000000000304', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000104', '15670000-0000-0000-0000-000000000204', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000a1', now()),
  ('15670000-0000-0000-0000-000000000305', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000105', '15670000-0000-0000-0000-000000000205', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000a1', now()),
  ('15670000-0000-0000-0000-000000000306', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000106', '15670000-0000-0000-0000-000000000206', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000a8', now()),
  ('15670000-0000-0000-0000-000000000307', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000107', '15670000-0000-0000-0000-000000000207', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000a1', now()),
  ('15670000-0000-0000-0000-000000000308', '15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000108', '15670000-0000-0000-0000-000000000208', '2026-06-01', 'draft', '15670000-0000-0000-0000-0000000000a1', null),
  ('15670000-0000-0000-0000-000000000309', '15670000-0000-0000-0000-00000000000b', '15670000-0000-0000-0000-000000000109', '15670000-0000-0000-0000-000000000209', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000b1', now()),
  ('15670000-0000-0000-0000-00000000030a', '15670000-0000-0000-0000-00000000000c', '15670000-0000-0000-0000-00000000010a', '15670000-0000-0000-0000-00000000020a', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000c1', now()),
  ('15670000-0000-0000-0000-00000000030b', '15670000-0000-0000-0000-00000000000d', '15670000-0000-0000-0000-00000000010b', '15670000-0000-0000-0000-00000000020b', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000d1', now()),
  ('15670000-0000-0000-0000-00000000030c', '15670000-0000-0000-0000-00000000000e', '15670000-0000-0000-0000-00000000010c', '15670000-0000-0000-0000-00000000020c', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000e1', now()),
  ('15670000-0000-0000-0000-00000000030d', '15670000-0000-0000-0000-00000000000f', '15670000-0000-0000-0000-00000000010d', '15670000-0000-0000-0000-00000000020d', '2026-06-01', 'submitted', '15670000-0000-0000-0000-0000000000f1', now());

-- The paper-form photo stands in for the upload (OD-DSR-4): the bucket row + the metadata row.
insert into storage.objects (bucket_id, name, owner) values
  ('site-report-photos', '15670000-0000-0000-0000-00000000000a/15670000-0000-0000-0000-000000000301/15670000-0000-0000-0000-000000000401/form.jpg', '15670000-0000-0000-0000-0000000000a1'),
  ('site-report-photos', '15670000-0000-0000-0000-00000000000c/15670000-0000-0000-0000-00000000030a/15670000-0000-0000-0000-000000000401/form.jpg', '15670000-0000-0000-0000-0000000000c1');
insert into dsr_photos (org_id, report_id, kind, file_path) values
  ('15670000-0000-0000-0000-00000000000a', '15670000-0000-0000-0000-000000000301', 'paper_form', '15670000-0000-0000-0000-00000000000a/15670000-0000-0000-0000-000000000301/15670000-0000-0000-0000-000000000401/form.jpg'),
  ('15670000-0000-0000-0000-00000000000c', '15670000-0000-0000-0000-00000000030a', 'paper_form', '15670000-0000-0000-0000-00000000000c/15670000-0000-0000-0000-00000000030a/15670000-0000-0000-0000-000000000401/form.jpg');

-- Route read as a chosen caller. The caller role is authenticated; the report id is the only argument.
create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp._route(p_uid uuid, p_report uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp._as(p_uid);
  return public.get_dsr_validation_route(p_report);
end $$;
create or replace function pg_temp._has(p_route jsonb, p_uid uuid, p_role text) returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(p_route->'approvers') a
     where (a->>'id')::uuid = p_uid
       and (p_role is null or a->>'role' = p_role)
  );
$$;

-- ── Grant surface (checked as the session owner, before switching role) ─────────────────────────
select ok(has_function_privilege('authenticated', 'public.get_dsr_validation_route(uuid)', 'EXECUTE'),
  '1567: authenticated may execute the route read');
select ok(not has_function_privilege('anon', 'public.get_dsr_validation_route(uuid)', 'EXECUTE'),
  '1567: anon may not execute the route read');

set local role anon;
select throws_ok(
  $$ select public.get_dsr_validation_route('15670000-0000-0000-0000-000000000301') $$,
  '42501', null, '1567: anon has no execute privilege');
reset role;

set local role authenticated;

-- ── The assigned PM is a real Project Manager, active, not light, not the author: named ──────────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000301'))->>'route_kind',
  'project_manager', '1567: an eligible assigned PM reads as the project-manager route');
select is(jsonb_array_length(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000301')->'approvers'),
  1, '1567: the project-manager route names exactly the PM (Admin/Finance stay role words)');
select is(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000301')->'approvers'->0,
  '{"id":"15670000-0000-0000-0000-0000000000a2","name":"PM Two","role":"Project Manager"}'::jsonb,
  '1567: the named PM carries the real profile id, name and Project Manager role');
select ok(not pg_temp._has(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000301'),
    '15670000-0000-0000-0000-0000000000a1', null),
  '1567: the author is excluded from their own report route (SoD)');

-- ── No assigned PM: the truthful Admin/Finance role fallback ────────────────────────────────────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000302'))->>'route_kind',
  'finance_admin', '1567: a project with no PM reads as the Finance/Admin role route');
select is(jsonb_array_length(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000302')->'approvers'),
  0, '1567: the Finance/Admin route names no person');

-- ── An assigned PM who is INACTIVE is not named, and no project approver is invented ────────────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000303'))->>'route_kind',
  'finance_admin', '1567: an inactive assigned PM falls back to the true role route');
select ok(not pg_temp._has(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000303'),
    '15670000-0000-0000-0000-0000000000a7', null),
  '1567: an inactive assigned PM is never named');

-- ── A LIGHT assigned PM is not named (1530/1461 refuses their decision) ────────────────────────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000304'))->>'route_kind',
  'finance_admin', '1567: a light assigned PM falls back to the true role route');
select ok(not pg_temp._has(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000304'),
    '15670000-0000-0000-0000-0000000000aa', null),
  '1567: a light assigned PM is never named');

-- ── An assigned id whose profile role is NOT Project Manager is not named ──────────────────────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000305'))->>'route_kind',
  'finance_admin', '1567: a wrong-role assignee falls back to the true role route');
select ok(not pg_temp._has(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000305'),
    '15670000-0000-0000-0000-0000000000a9', null),
  '1567: a non-Project-Manager assignee is never named as a project approver');

-- ── An assigned PM who IS the author is not named (SoD for every role) ─────────────────────────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000a8', '15670000-0000-0000-0000-000000000306'))->>'route_kind',
  'finance_admin', '1567: a PM who authored the report falls back to the true role route');
select ok(not pg_temp._has(pg_temp._route('15670000-0000-0000-0000-0000000000a8', '15670000-0000-0000-0000-000000000306'),
    '15670000-0000-0000-0000-0000000000a8', null),
  '1567: the PM author is not named on their own report');

-- ── A cross-organisation assignee row is never named ───────────────────────────────────────────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000307'))->>'route_kind',
  'finance_admin', '1567: a cross-organisation assignee falls back to the true role route');
select ok(not pg_temp._has(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000307'),
    '15670000-0000-0000-0000-0000000000b1', null),
  '1567: a cross-organisation assignee row is never named');

-- ── Finance alone is a true alternative; a light Finance and an author-only Admin are not ───────
select is((pg_temp._route('15670000-0000-0000-0000-0000000000c1', '15670000-0000-0000-0000-00000000030a'))->>'route_kind',
  'finance_admin', '1567: a Finance profile (no Admin) is a true alternative');
select is((pg_temp._route('15670000-0000-0000-0000-0000000000d1', '15670000-0000-0000-0000-00000000030b'))->>'route_kind',
  'nobody', '1567: a light Finance account is not an alternative');
select is((pg_temp._route('15670000-0000-0000-0000-0000000000e1', '15670000-0000-0000-0000-00000000030c'))->>'route_kind',
  'nobody', '1567: an Admin who authored the report is not their own alternative');
select is((pg_temp._route('15670000-0000-0000-0000-0000000000f1', '15670000-0000-0000-0000-00000000030d'))->>'route_kind',
  'nobody', '1567: a light PM with no Admin/Finance leaves nobody able to validate');
select is(jsonb_array_length(pg_temp._route('15670000-0000-0000-0000-0000000000f1', '15670000-0000-0000-0000-00000000030d')->'approvers'),
  0, '1567: the nobody route names no person');

-- ── Record visibility: invisible / foreign / non-Submitted / absent share ONE empty shape ───────
select is(pg_temp._route('15670000-0000-0000-0000-0000000000b1', '15670000-0000-0000-0000-000000000301'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1567: a cross-tenant caller gets the non-leaking empty shape');
select is(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000309'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1567: another organisation''s report id is the same empty shape');
select is(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-000000000308'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1567: a visible Draft (not waiting) is the same empty shape');
select is(pg_temp._route('15670000-0000-0000-0000-0000000000a1', '15670000-0000-0000-0000-00000000dead'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1567: an absent id is the same empty shape');

-- ── A disabled caller is refused before any read ────────────────────────────────────────────────
select pg_temp._as('15670000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.get_dsr_validation_route('15670000-0000-0000-0000-000000000301') $$,
  '42501', null, '1567: a disabled caller is refused by the active-caller assert');

-- ── Equivalence with the real write authority on valid fixtures ─────────────────────────────────
-- The named PM can actually validate the report (the smoke-visible positive).
select pg_temp._as('15670000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000301') $$,
  '1567: the named PM can actually validate the report');
reset role;
update public.daily_site_reports set status = 'submitted', validated_by = null, validated_at = null
 where id = '15670000-0000-0000-0000-000000000301';
set local role authenticated;

-- Finance is a true alternative and can validate.
select pg_temp._as('15670000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000301') $$,
  '1567: Finance (a named role alternative) can actually validate');
reset role;
update public.daily_site_reports set status = 'submitted', validated_by = null, validated_at = null
 where id = '15670000-0000-0000-0000-000000000301';
set local role authenticated;

-- Executive is NOT in the route and the write authority refuses it too.
select pg_temp._as('15670000-0000-0000-0000-0000000000a6');
select throws_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000301') $$,
  '42501', null, '1567: an Executive absent from the route is refused by the write authority');

-- A bystander Engineer is absent and refused.
select pg_temp._as('15670000-0000-0000-0000-0000000000a5');
select throws_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000301') $$,
  '42501', null, '1567: a bystander absent from the route is refused');

-- The author is absent (SoD) and refused.
select pg_temp._as('15670000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000301') $$,
  '42501', null, '1567: the author is refused (SoD), matching their absence from the route');

-- The inactive PM is absent and refused.
select pg_temp._as('15670000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000303') $$,
  '42501', null, '1567: the inactive assigned PM cannot validate, matching their absence');

-- The light PM is absent and refused by the light-account guard.
select pg_temp._as('15670000-0000-0000-0000-0000000000aa');
select throws_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000304') $$,
  '42501', null, '1567: the light assigned PM cannot validate, matching their absence');

-- The wrong-role assignee is absent and refused.
select pg_temp._as('15670000-0000-0000-0000-0000000000a9');
select throws_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-000000000305') $$,
  '42501', null, '1567: the non-Project-Manager assignee cannot validate');

-- The Finance-only organisation's Finance person is in the route and can validate.
select pg_temp._as('15670000-0000-0000-0000-0000000000c2');
select lives_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-00000000030a') $$,
  '1567: the Finance alternative in a Finance-only organisation can validate');

-- The Admin author cannot validate their own report (the nobody route is exact).
select pg_temp._as('15670000-0000-0000-0000-0000000000e1');
select throws_ok(
  $$ select public.dsr_validate('15670000-0000-0000-0000-00000000030c') $$,
  '42501', null, '1567: the Admin author cannot validate, matching the nobody route');

reset role;
select * from finish();
rollback;
