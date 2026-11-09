-- imprest_positions_batch.test.sql — #2106 (AC-PERF-2106-1): the /imprest list reads every float's position in ONE
-- batched request instead of one per float. This file proves the read's contract: one row per requested float the
-- caller may see, values identical to the single-float read (get_imprest_position), tenant isolation through RLS
-- (another org's float ids return nothing), the role read contract, request-order + dedupe, the 200-id bound, and
-- the ACL shape (SECURITY INVOKER, no anon/PUBLIC execute).
-- Namespaced UUIDs (2106…): fixtures never collide with another file.
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name, default_currency, default_timezone) values
  ('21060000-0000-0000-0000-00000000000a', 'BATCH Org',       'IDR', 'Asia/Jakarta'),
  ('21060000-0000-0000-0000-00000000000b', 'BATCH Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('21060000-0000-0000-0000-0000000000a1', 'batch-fin@example.com'),
  ('21060000-0000-0000-0000-0000000000a2', 'batch-pm@example.com'),
  ('21060000-0000-0000-0000-0000000000a3', 'batch-eng@example.com'),
  ('21060000-0000-0000-0000-0000000000a4', 'batch-admin@example.com'),
  ('21060000-0000-0000-0000-0000000000b1', 'batch-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21060000-0000-0000-0000-0000000000a1', '21060000-0000-0000-0000-00000000000a', 'BATCH Fin',   'batch-fin@example.com',   'Finance',         'active'),
  ('21060000-0000-0000-0000-0000000000a2', '21060000-0000-0000-0000-00000000000a', 'BATCH PM',    'batch-pm@example.com',    'Project Manager', 'active'),
  ('21060000-0000-0000-0000-0000000000a3', '21060000-0000-0000-0000-00000000000a', 'BATCH Eng',   'batch-eng@example.com',   'Engineer',        'active'),
  ('21060000-0000-0000-0000-0000000000a4', '21060000-0000-0000-0000-00000000000a', 'BATCH Admin', 'batch-admin@example.com', 'Admin',           'active'),
  ('21060000-0000-0000-0000-0000000000b1', '21060000-0000-0000-0000-00000000000b', 'BATCH XOrg',  'batch-xorg@example.com',  'Admin',           'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('21060000-0000-0000-0000-0000000000c1', '21060000-0000-0000-0000-00000000000a', 'BATCH Site One', 'Ongoing Project', '21060000-0000-0000-0000-0000000000a2'),
  ('21060000-0000-0000-0000-0000000000c2', '21060000-0000-0000-0000-00000000000a', 'BATCH Site Two', 'Ongoing Project', '21060000-0000-0000-0000-0000000000a2');
-- Org A: float F1 (Site One, custodian Finance) and F2 (Site Two, custodian the project's PM). Org B: float FB.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('21060000-0000-0000-0000-0000000000d1', '21060000-0000-0000-0000-00000000000a', '21060000-0000-0000-0000-0000000000c1',
   '21060000-0000-0000-0000-0000000000a1', 10000000, 'IDR', '21060000-0000-0000-0000-0000000000a4'),
  ('21060000-0000-0000-0000-0000000000d2', '21060000-0000-0000-0000-00000000000a', '21060000-0000-0000-0000-0000000000c2',
   '21060000-0000-0000-0000-0000000000a2', 5000000, 'IDR', '21060000-0000-0000-0000-0000000000a4');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('21060000-0000-0000-0000-0000000000c9', '21060000-0000-0000-0000-00000000000b', 'BATCH Other Site', 'Ongoing Project', '21060000-0000-0000-0000-0000000000b1');
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('21060000-0000-0000-0000-0000000000d9', '21060000-0000-0000-0000-00000000000b', '21060000-0000-0000-0000-0000000000c9',
   '21060000-0000-0000-0000-0000000000b1', 7000000, 'IDR', '21060000-0000-0000-0000-0000000000b1');
-- A paid funding on F1 so its position carries a funded total and non-zero cash.
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('21060000-0000-0000-0000-0000000000e1', '21060000-0000-0000-0000-00000000000a', '21060000-0000-0000-0000-0000000000d1',
   'funding', 'REP-BATCH-F1', 'Paid', 10000000, '21060000-0000-0000-0000-0000000000a1', '21060000-0000-0000-0000-0000000000a4',
   '21060000-0000-0000-0000-0000000000a4', now(), now(), now(), current_date);

-- helper: act as a member (jwt claims are transaction-local)
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- ── the batched read's contract, as the caller (RLS applies) ─────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('21060000-0000-0000-0000-0000000000a1');  -- Finance, custodian of F1
select is((select count(*)::int from get_imprest_positions(array['21060000-0000-0000-0000-0000000000d1',
                                                              '21060000-0000-0000-0000-0000000000d2']::uuid[])), 2,
  'AC-PERF-2106-1 the batched read returns one position per requested float');
select is((select array_agg(float_id)::text from get_imprest_positions(array[
             '21060000-0000-0000-0000-0000000000d2', '21060000-0000-0000-0000-0000000000d1']::uuid[])),
  array['21060000-0000-0000-0000-0000000000d2', '21060000-0000-0000-0000-0000000000d1']::text,
  'AC-PERF-2106-1 rows come back in the order the ids were asked for');
select is((select row(float_amount, cash_book, advances_out, receipts_waiting, replenishment_in_flight, gap,
                      last_count_at, last_count_variance, month, plan_lines, funded_total)::text
             from get_imprest_positions(array['21060000-0000-0000-0000-0000000000d1']::uuid[])),
          (select row(float_amount, cash_book, advances_out, receipts_waiting, replenishment_in_flight, gap,
                      last_count_at, last_count_variance, month, plan_lines, funded_total)::text
             from get_imprest_position('21060000-0000-0000-0000-0000000000d1')),
  'AC-PERF-2106-1 a batched row is the single-float position, value for value (no drift between the two reads)');
select is((select funded_total from get_imprest_positions(array['21060000-0000-0000-0000-0000000000d1']::uuid[])), 10000000.00,
  'AC-PERF-2106-1 the batched row carries the float''s funded total');
select is((select count(*)::int from get_imprest_positions(array[
             '21060000-0000-0000-0000-0000000000d1', '21060000-0000-0000-0000-0000000000d1']::uuid[])), 1,
  'AC-PERF-2106-1 a repeated id yields one row, never a duplicated money cell');
select is((select count(*)::int from get_imprest_positions(array[]::uuid[])), 0,
  'AC-PERF-2106-1 an empty id array is no rows, not an error');
select is((select count(*)::int from get_imprest_positions(null::uuid[])), 0,
  'AC-PERF-2106-1 a null id array is no rows, not an error');
select throws_ok($$ select count(*) from get_imprest_positions(array(select gen_random_uuid() from generate_series(1, 201))) $$,
  'P0001', null, 'AC-PERF-2106-1 more than 200 ids is refused: the list is bounded at 200 floats');

-- Role read contract: the Project Manager who holds spend-approval authority also reads positions.
select pg_temp.act_as('21060000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from get_imprest_positions(array['21060000-0000-0000-0000-0000000000d1',
                                                              '21060000-0000-0000-0000-0000000000d2']::uuid[])), 2,
  'AC-PERF-2106-1 a Project Manager reads both floats'' positions');
select pg_temp.act_as('21060000-0000-0000-0000-0000000000a3');  -- Engineer: no spend-approval authority
select is((select count(*)::int from get_imprest_positions(array['21060000-0000-0000-0000-0000000000d1']::uuid[])), 0,
  'AC-PERF-2106-1 an Engineer who sees no float gets no row');

-- Tenant isolation: another org's float ids are not readable, and that org's own ids still resolve.
select pg_temp.act_as('21060000-0000-0000-0000-0000000000b1');  -- other-org Admin
select is((select count(*)::int from get_imprest_positions(array['21060000-0000-0000-0000-0000000000d1',
                                                              '21060000-0000-0000-0000-0000000000d2']::uuid[])), 0,
  'AC-PERF-2106-1 another org''s float ids return no rows (RLS, not a filter the caller controls)');
select is((select count(*)::int from get_imprest_positions(array['21060000-0000-0000-0000-0000000000d9']::uuid[])), 1,
  'AC-PERF-2106-1 and that org still reads its own float');
reset role;
set local role authenticated;
select pg_temp.act_as('21060000-0000-0000-0000-0000000000a1');
select is((select array_agg(float_id)::text from get_imprest_positions(array[
             '21060000-0000-0000-0000-0000000000d1', '21060000-0000-0000-0000-0000000000d9']::uuid[])),
  array['21060000-0000-0000-0000-0000000000d1']::text,
  'AC-PERF-2106-1 a foreign id mixed into the request is simply absent, never a leaked row');
select is((select count(*)::int from get_imprest_positions(array['21060000-0000-0000-0000-000000000000']::uuid[])), 0,
  'AC-PERF-2106-1 an id that matches no float yields no row');
reset role;

-- ── ACL shape: invoker (RLS is the authority), authenticated-only ────────────────────────────────────────────────
select ok(not (select p.prosecdef from pg_proc p where p.oid = 'public.get_imprest_positions(uuid[])'::regprocedure),
  'AC-PERF-2106-1 the batched read is SECURITY INVOKER: it can never widen a caller''s read');
select ok(has_function_privilege('authenticated', 'public.get_imprest_positions(uuid[])', 'EXECUTE'),
  'AC-PERF-2106-1 an authenticated member may execute the batched read');
select ok(not has_function_privilege('anon', 'public.get_imprest_positions(uuid[])', 'EXECUTE'),
  'AC-PERF-2106-1 anon may not execute the batched read');
select ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = 'public.get_imprest_positions(uuid[])'::regprocedure and a.grantee = 0),
  'AC-PERF-2106-1 PUBLIC holds no EXECUTE on the batched read');

select * from finish();
rollback;
