-- 1569_invoice_approval_route.test.sql — fix-waiting item 3 (FR-WAIT-006) for a PMO-native Draft customer invoice.
-- Migration under test: 1569_invoice_approval_route.sql.
--
-- Each case projects the CURRENT write authority, not a new rule:
--   transition_native_sales_invoice (0275:316 / 0534:306) gates the decision on role in ('Admin','Finance') and,
--   per 1530, refuses a field (light) account; assert_sales_invoice_approver (0275:139) refuses the primary author
--   AND every sales_invoice_authors body writer, and refuses an invoice with no recorded author.
-- The route is SECURITY INVOKER, so the invoice and author-set RLS policies are the visibility boundary: a foreign
-- organisation's invoice, a same-organisation invoice the caller may not read, a non-PMO-native row, a row that is
-- not Draft and an absent id all return the SAME non-leaking shape.
--
-- The write equivalence is asserted the only way it means anything: each named person is set as the real caller and
-- transition_native_sales_invoice is asked (must succeed), and each excluded person (primary author, co-author,
-- disabled, light, wrong role) is set as the caller and asked (must be refused).
begin;
create extension if not exists pgtap;
select plan(41);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15690000-0000-0000-0000-0000000000a0', 'Invoice Route Org A',     'IDR', 'Asia/Jakarta'),
  ('15690000-0000-0000-0000-0000000000b0', 'Invoice Route Org B',     'IDR', 'Asia/Jakarta'),
  ('15690000-0000-0000-0000-0000000000c0', 'Invoice Route Org C',     'IDR', 'Asia/Jakarta'),
  ('15690000-0000-0000-0000-0000000000d0', 'Invoice Route Org D',     'IDR', 'Asia/Jakarta'),
  ('15690000-0000-0000-0000-0000000000e0', 'Invoice Route Org E',     'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('15690000-0000-0000-0000-0000000000a1', 'inv-route-author@example.com'),
  ('15690000-0000-0000-0000-0000000000a2', 'inv-route-coauthor@example.com'),
  ('15690000-0000-0000-0000-0000000000a3', 'inv-route-finance@example.com'),
  ('15690000-0000-0000-0000-0000000000a4', 'inv-route-admin@example.com'),
  ('15690000-0000-0000-0000-0000000000a5', 'inv-route-pm@example.com'),
  ('15690000-0000-0000-0000-0000000000a6', 'inv-route-engineer@example.com'),
  ('15690000-0000-0000-0000-0000000000a7', 'inv-route-disabled@example.com'),
  ('15690000-0000-0000-0000-0000000000a8', 'inv-route-light@example.com'),
  ('15690000-0000-0000-0000-0000000000b1', 'inv-route-foreign@example.com'),
  ('15690000-0000-0000-0000-0000000000c1', 'inv-route-c-author@example.com'),
  ('15690000-0000-0000-0000-0000000000c2', 'inv-route-c-disabled@example.com'),
  ('15690000-0000-0000-0000-0000000000d1', 'inv-route-d-author@example.com'),
  ('15690000-0000-0000-0000-0000000000d2', 'inv-route-d-light@example.com'),
  ('15690000-0000-0000-0000-0000000000e1', 'inv-route-e-finance@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-0000000000a0', 'Admin Author',   'inv-route-author@example.com',   'Admin',           'active'),
  ('15690000-0000-0000-0000-0000000000a2', '15690000-0000-0000-0000-0000000000a0', 'Finance Coauthor','inv-route-coauthor@example.com', 'Finance',         'active'),
  ('15690000-0000-0000-0000-0000000000a3', '15690000-0000-0000-0000-0000000000a0', 'Finance Three',  'inv-route-finance@example.com',  'Finance',         'active'),
  ('15690000-0000-0000-0000-0000000000a4', '15690000-0000-0000-0000-0000000000a0', 'Admin Four',     'inv-route-admin@example.com',    'Admin',           'active'),
  ('15690000-0000-0000-0000-0000000000a5', '15690000-0000-0000-0000-0000000000a0', 'PM Five',        'inv-route-pm@example.com',       'Project Manager', 'active'),
  ('15690000-0000-0000-0000-0000000000a6', '15690000-0000-0000-0000-0000000000a0', 'Engineer Six',   'inv-route-engineer@example.com', 'Engineer',        'active'),
  ('15690000-0000-0000-0000-0000000000a7', '15690000-0000-0000-0000-0000000000a0', 'Disabled Seven', 'inv-route-disabled@example.com', 'Finance',         'disabled'),
  ('15690000-0000-0000-0000-0000000000b1', '15690000-0000-0000-0000-0000000000b0', 'Foreign Nine',   'inv-route-foreign@example.com',  'Finance',         'active'),
  ('15690000-0000-0000-0000-0000000000c1', '15690000-0000-0000-0000-0000000000c0', 'C Author',       'inv-route-c-author@example.com', 'Admin',           'active'),
  ('15690000-0000-0000-0000-0000000000c2', '15690000-0000-0000-0000-0000000000c0', 'C Disabled',     'inv-route-c-disabled@example.com','Finance',        'disabled'),
  ('15690000-0000-0000-0000-0000000000d1', '15690000-0000-0000-0000-0000000000d0', 'D Author',       'inv-route-d-author@example.com', 'Admin',           'active'),
  ('15690000-0000-0000-0000-0000000000e1', '15690000-0000-0000-0000-0000000000e0', 'E Finance',      'inv-route-e-finance@example.com','Finance',         'active');

-- Light (field) accounts (1205). The 1202 sync trigger forces role = key base level, and every light key is Engineer;
-- the fixtures that need a light person with a Finance role build that state with the trigger off (the whole
-- transaction rolls back). The route and the write both refuse a light account, so that person is never a decider.
alter table public.profiles disable trigger profiles_zz_built_in_role_sync;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('15690000-0000-0000-0000-0000000000a8', '15690000-0000-0000-0000-0000000000a0', 'Light Eight', 'inv-route-light@example.com', 'Finance', 'active', 'foreman'),
  ('15690000-0000-0000-0000-0000000000d2', '15690000-0000-0000-0000-0000000000d0', 'D Light',     'inv-route-d-light@example.com','Finance', 'active', 'foreman');
alter table public.profiles enable trigger profiles_zz_built_in_role_sync;

insert into sales_invoices (id, org_id, amount, currency, tax_treatment, tax_amount, status, pmo_native, author_user_id, native_lines) values
  -- Org A: the named route (primary author a1, co-author a2, eligible a3 Finance + a4 Admin)
  ('15690000-0000-0000-0000-000000000101', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  -- Org A: no recorded author and no author rows -> missing_author
  ('15690000-0000-0000-0000-000000000102', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  null, '[]'::jsonb),
  -- Org A: not waiting (already approved)
  ('15690000-0000-0000-0000-000000000103', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Unpaid',  true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  -- Org A: an ERP-path row, never a PMO approval route
  ('15690000-0000-0000-0000-000000000104', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   false, '15690000-0000-0000-0000-0000000000a1', null),
  -- Org B: another organisation's invoice
  ('15690000-0000-0000-0000-000000000105', '15690000-0000-0000-0000-0000000000b0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000b1', '[]'::jsonb),
  -- Org C: only a disabled Finance besides the author -> nobody
  ('15690000-0000-0000-0000-000000000106', '15690000-0000-0000-0000-0000000000c0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000c1', '[]'::jsonb),
  -- Org D: only a light Finance besides the author -> nobody
  ('15690000-0000-0000-0000-000000000107', '15690000-0000-0000-0000-0000000000d0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000d1', '[]'::jsonb),
  -- Org E: no recorded author, for the write-refusal half
  ('15690000-0000-0000-0000-000000000108', '15690000-0000-0000-0000-0000000000e0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  null, '[]'::jsonb),
  -- Org A write-equivalence invoices (one per caller, so no reset is needed between cases)
  ('15690000-0000-0000-0000-000000000111', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  ('15690000-0000-0000-0000-000000000112', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  ('15690000-0000-0000-0000-000000000113', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  ('15690000-0000-0000-0000-000000000114', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  ('15690000-0000-0000-0000-000000000115', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  ('15690000-0000-0000-0000-000000000116', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb),
  ('15690000-0000-0000-0000-000000000117', '15690000-0000-0000-0000-0000000000a0', 1000, 'IDR', 'exclusive', 0, 'Draft',   true,  '15690000-0000-0000-0000-0000000000a1', '[]'::jsonb);

insert into sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000101', '15690000-0000-0000-0000-0000000000a1'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000101', '15690000-0000-0000-0000-0000000000a2'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000111', '15690000-0000-0000-0000-0000000000a1'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000112', '15690000-0000-0000-0000-0000000000a1'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000113', '15690000-0000-0000-0000-0000000000a1'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000114', '15690000-0000-0000-0000-0000000000a1'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000114', '15690000-0000-0000-0000-0000000000a2'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000115', '15690000-0000-0000-0000-0000000000a1'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000116', '15690000-0000-0000-0000-0000000000a1'),
  ('15690000-0000-0000-0000-0000000000a0', '15690000-0000-0000-0000-000000000117', '15690000-0000-0000-0000-0000000000a1');

-- Route read as a chosen caller. The caller role is authenticated; the invoice id is the only argument.
create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp._route(p_uid uuid, p_invoice uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp._as(p_uid);
  return public.get_invoice_approval_route(p_invoice);
end $$;
create or replace function pg_temp._ids(p jsonb) returns uuid[] language sql immutable as $$
  select coalesce(array_agg((a->>'id')::uuid order by (a->>'id')::uuid), '{}'::uuid[])
    from jsonb_array_elements(p->'approvers') a;
$$;
create or replace function pg_temp._roles(p jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(a->>'role' order by (a->>'id')::uuid), '{}'::text[])
    from jsonb_array_elements(p->'approvers') a;
$$;
create or replace function pg_temp._has(p jsonb, p_uid uuid) returns boolean language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(p->'approvers') a where (a->>'id')::uuid = p_uid);
$$;
grant execute on function pg_temp._as(uuid), pg_temp._route(uuid, uuid), pg_temp._ids(jsonb),
  pg_temp._roles(jsonb), pg_temp._has(jsonb, uuid) to authenticated;

-- ── Function shape, grants and the invoker helper manifest ───────────────────────────────────────
select is((select p.prosecdef from pg_proc p where p.oid = 'public.get_invoice_approval_route(uuid)'::regprocedure), false,
  '1569: the route read runs as the caller, so the invoice''s own row-level policy decides what it can see');
select ok((select p.provolatile = 's' from pg_proc p where p.oid = 'public.get_invoice_approval_route(uuid)'::regprocedure),
  '1569: the route read is STABLE (a read, no write)');
select ok((select exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                            where c like 'search_path=%' and c ~* 'pg_catalog' and c ~* 'public' and c !~* 'pg_temp')
             from pg_proc p where p.oid = 'public.get_invoice_approval_route(uuid)'::regprocedure),
  '1569: and pins a search_path that reaches pg_catalog and public and no temp schema');
select ok(has_function_privilege('authenticated', 'public.get_invoice_approval_route(uuid)', 'execute'),
  '1569: a signed-in account may call it');
select ok(not has_function_privilege('anon', 'public.get_invoice_approval_route(uuid)', 'execute'),
  '1569: an anonymous caller may not');
select ok(has_function_privilege('authenticated', 'public.is_active_member()', 'execute'),
  '1569: the invoker body''s active-caller helper is executable by authenticated');
select ok(has_function_privilege('authenticated', 'public.actor_is_light()', 'execute'),
  '1569: the invoker body''s field-account helper is executable by authenticated');
select ok(has_function_privilege('authenticated', 'public.is_light_role_key(text)', 'execute'),
  '1569: the invoker body''s light-key helper is executable by authenticated');

-- ── Anonymous has no execute privilege ──────────────────────────────────────────────────────────
set local role anon;
select throws_ok(
  $$ select public.get_invoice_approval_route('15690000-0000-0000-0000-000000000101') $$,
  '42501', null, '1569: an anonymous call is refused by the missing grant');
reset role;
set local role authenticated;

-- ── The named route: the eligible Finance/Admin people, minus the author and every co-author ─────
select is((pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101'))->>'route_kind',
  'named', '1569: a native Draft invoice with eligible people reads as the named route');
select is(pg_temp._ids(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101')),
  array['15690000-0000-0000-0000-0000000000a3', '15690000-0000-0000-0000-0000000000a4']::uuid[],
  '1569: the named route is exactly the eligible non-author Finance and Admin people');
select is(pg_temp._roles(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101')),
  array['Finance', 'Admin']::text[], '1569: each named person carries their real current role');
select ok(not pg_temp._has(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101'),
    '15690000-0000-0000-0000-0000000000a1'), '1569: the primary author is never named (SoD)');
select ok(not pg_temp._has(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101'),
    '15690000-0000-0000-0000-0000000000a2'), '1569: a recorded co-author is never named (all author history)');
select ok(not pg_temp._has(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101'),
    '15690000-0000-0000-0000-0000000000a7'), '1569: a disabled Finance profile is never named');
select ok(not pg_temp._has(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101'),
    '15690000-0000-0000-0000-0000000000a8'), '1569: a light (field) Finance profile is never named');
select ok(not pg_temp._has(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000101'),
    '15690000-0000-0000-0000-0000000000a5'), '1569: a Project Manager is never named (the transition''s role gate)');

-- The route is the invoice's fact, not the caller's: a co-author and a non-author eligible person read the same set.
select is(pg_temp._ids(pg_temp._route('15690000-0000-0000-0000-0000000000a2', '15690000-0000-0000-0000-000000000101')),
  array['15690000-0000-0000-0000-0000000000a3', '15690000-0000-0000-0000-0000000000a4']::uuid[],
  '1569: the co-author caller reads the same named route, still without themselves');
select is(pg_temp._ids(pg_temp._route('15690000-0000-0000-0000-0000000000a3', '15690000-0000-0000-0000-000000000101')),
  array['15690000-0000-0000-0000-0000000000a3', '15690000-0000-0000-0000-0000000000a4']::uuid[],
  '1569: a non-author eligible caller reads the same named route');
select is(pg_temp._ids(pg_temp._route('15690000-0000-0000-0000-0000000000a5', '15690000-0000-0000-0000-000000000101')),
  array['15690000-0000-0000-0000-0000000000a3', '15690000-0000-0000-0000-0000000000a4']::uuid[],
  '1569: a role that may read but not approve still reads the same named route');

-- ── Row visibility is the boundary: same-organisation hidden and foreign ids share one empty shape ─
select is(pg_temp._route('15690000-0000-0000-0000-0000000000a6', '15690000-0000-0000-0000-000000000101'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1569: a same-organisation Engineer who cannot read the invoice gets the non-leaking empty shape');
select is(pg_temp._route('15690000-0000-0000-0000-0000000000b1', '15690000-0000-0000-0000-000000000101'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1569: a cross-organisation caller gets the same non-leaking empty shape');

-- ── No recorded author: an honest missing state, never an invented approver ──────────────────────
select is((pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000102'))->>'route_kind',
  'missing_author', '1569: an invoice with no recorded author reports missing_author');
select is(jsonb_array_length(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000102')->'approvers'),
  0, '1569: the missing-author route names nobody');

-- ── Not waiting: an approved row and an ERP-path row share the empty shape ────────────────────────
select is(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000103'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1569: an already-approved (Unpaid) invoice is not a waiting route');
select is(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-000000000104'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1569: an ERP-path (not PMO-native) row has no PMO approval route');

-- ── Nobody: a governed route whose only other candidates are not eligible ─────────────────────────
select is((pg_temp._route('15690000-0000-0000-0000-0000000000c1', '15690000-0000-0000-0000-000000000106'))->>'route_kind',
  'nobody', '1569: a sole disabled Finance candidate leaves nobody able to approve');
select is(jsonb_array_length(pg_temp._route('15690000-0000-0000-0000-0000000000c1', '15690000-0000-0000-0000-000000000106')->'approvers'),
  0, '1569: the nobody route names no person');
select is((pg_temp._route('15690000-0000-0000-0000-0000000000d1', '15690000-0000-0000-0000-000000000107'))->>'route_kind',
  'nobody', '1569: a sole light Finance candidate leaves nobody able to approve');
select is(jsonb_array_length(pg_temp._route('15690000-0000-0000-0000-0000000000d1', '15690000-0000-0000-0000-000000000107')->'approvers'),
  0, '1569: the light-only route names no person');

-- ── An absent id is the same non-leaking shape ────────────────────────────────────────────────────
select is(pg_temp._route('15690000-0000-0000-0000-0000000000a1', '15690000-0000-0000-0000-00000000dead'),
  '{"approvers":[],"route_kind":"unavailable"}'::jsonb,
  '1569: an absent id is the same empty shape');

-- ── A disabled caller and a light caller are refused before any row is read ───────────────────────
select pg_temp._as('15690000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.get_invoice_approval_route('15690000-0000-0000-0000-000000000101') $$,
  '42501', null, '1569: a disabled caller is refused by the active-caller assert');
select pg_temp._as('15690000-0000-0000-0000-0000000000a8');
select throws_ok(
  $$ select public.get_invoice_approval_route('15690000-0000-0000-0000-000000000101') $$,
  '42501', null, '1569: a light caller is refused, matching the 1530 write guard');

-- ── Write equivalence: the named people can approve; the excluded people are refused ──────────────
select pg_temp._as('15690000-0000-0000-0000-0000000000a3');
select lives_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000111', 'Unpaid') $$,
  '1569: the named Finance person can actually approve the invoice');
select pg_temp._as('15690000-0000-0000-0000-0000000000a4');
select lives_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000112', 'Unpaid') $$,
  '1569: the named Admin person can actually approve the invoice');
select pg_temp._as('15690000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000113', 'Unpaid') $$,
  '42501', 'approver must differ from author (SoD)',
  '1569: the primary author is refused, matching their absence from the route');
select pg_temp._as('15690000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000114', 'Unpaid') $$,
  '42501', 'approver must differ from author (SoD)',
  '1569: a co-author is refused, matching their absence from the route (all author history)');
select pg_temp._as('15690000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000115', 'Unpaid') $$,
  '42501', null, '1569: a disabled Finance person is refused, matching their absence');
select pg_temp._as('15690000-0000-0000-0000-0000000000a8');
select throws_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000116', 'Unpaid') $$,
  '42501', null, '1569: a light Finance person is refused by the 1530 write guard, matching their absence');
select pg_temp._as('15690000-0000-0000-0000-0000000000a5');
select throws_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000117', 'Unpaid') $$,
  '42501', null, '1569: a Project Manager is refused by the role gate, matching their absence');
select pg_temp._as('15690000-0000-0000-0000-0000000000e1');
select throws_ok(
  $$ select public.transition_native_sales_invoice('15690000-0000-0000-0000-000000000108', 'Unpaid') $$,
  '42501', null, '1569: an authorless invoice is refused, matching the missing_author route');

reset role;
select * from finish();
rollback;
