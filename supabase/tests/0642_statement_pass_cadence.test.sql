-- 0642_statement_pass_cadence.test.sql
-- AC-SPC-012 [pgTAP]: the native statement pass has its own per-org marker, stamped/deferred ONLY by
--   the tick holding that org's sweep lock — a tick without the lease (a concurrent duplicate, or a
--   killed worker's lapsed 15-minute lease) can neither mark the pass complete nor defer it, so the org
--   stays due. A published pass is due again an hour later; a deferred one only after p_due_in_seconds.
-- AC-SPC-013 [pgTAP]: the marker is service-role only (no anon/authenticated read or write) and carries
--   the org seam (org_id FK to organizations).
--
-- Every side-effecting RPC is called in its OWN statement, never inside an `ok(a and b)` expression:
-- SQL gives no evaluation order to AND operands, so a subquery read beside a writer can observe the
-- pre-write row and silently invert the assertion (found by running this file: the zero-deferral case
-- read the previous five-minute deferral).
begin;
select plan(20);

insert into organizations (id, name) values
  ('06420000-0000-0000-0000-000000000001','0642 Org A'),
  ('06420000-0000-0000-0000-000000000002','0642 Org B');

-- ── AC-SPC-012: the lease fence ─────────────────────────────────────────────────────────────────
select ok(not public.mark_erp_statement_pass_done('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111'),
  'AC-SPC-012 a tick without the org lock cannot mark a statement pass complete');
select ok(not public.defer_erp_statement_pass('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', 300),
  'AC-SPC-012 a tick without the org lock cannot defer a statement pass');
select is((select count(*)::int from public.erp_statement_pass_run where org_id = '06420000-0000-0000-0000-000000000001'), 0,
  'AC-SPC-012 so the org stays due');

select public.claim_erp_sweep_lock('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', interval '15 minutes');
select ok(public.mark_erp_statement_pass_done('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111'),
  'AC-SPC-012 the lock holder marks its published statement pass');
select ok((select completed_at from public.erp_statement_pass_run where org_id = '06420000-0000-0000-0000-000000000001') = now(),
  'AC-SPC-012 a published pass is stamped with the completion time');
select ok(not public.mark_erp_statement_pass_done('06420000-0000-0000-0000-000000000001', '22222222-2222-4222-8222-222222222222'),
  'AC-SPC-012 another holder cannot mark this org''s pass complete');

-- A deferred pass is due again in p_due_in_seconds, measured against the same 55-minute interval the
-- edge function's `statementPassDue` applies: due_at = completed_at + 55 minutes.
select ok(public.defer_erp_statement_pass('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', 300),
  'AC-SPC-012 the lock holder defers an unfinished statement pass');
select ok(
  (select completed_at + interval '55 minutes' from public.erp_statement_pass_run where org_id = '06420000-0000-0000-0000-000000000001') =
    to_timestamp((floor(extract(epoch from now()) / 300) + 1) * 300),
  'AC-SPC-012 deferral makes the pass due at the next UTC five-minute boundary');
select public.defer_erp_statement_pass('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', 0);
select ok(
  (select completed_at from public.erp_statement_pass_run where org_id = '06420000-0000-0000-0000-000000000001') <= now() - interval '55 minutes',
  'AC-SPC-012 a zero deferral makes the pass due on the next eligible tick');
select public.defer_erp_statement_pass('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', -60);
select ok(
  (select completed_at from public.erp_statement_pass_run where org_id = '06420000-0000-0000-0000-000000000001') <= now() - interval '55 minutes',
  'AC-SPC-012 a negative deferral is clamped to now, never into the future');

-- The database anchors the retry to its own clock so request latency cannot miss a window.
select public.defer_erp_statement_pass(
  '06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111',
  300
);
select ok(
  (select completed_at + interval '55 minutes' from public.erp_statement_pass_run
    where org_id = '06420000-0000-0000-0000-000000000001') <=
      to_timestamp((floor(extract(epoch from now()) / 300) + 1) * 300),
  'AC-SPC-014 persisted marker is due by the next UTC window');
select ok(
  (select completed_at + interval '55 minutes' from public.erp_statement_pass_run
    where org_id = '06420000-0000-0000-0000-000000000001') >
      to_timestamp((floor(extract(epoch from now()) / 300) + 1) * 300) - interval '1 second',
  'AC-SPC-014 persisted marker is less than one second before that boundary');
select ok(
  (select completed_at + interval '55 minutes' from public.erp_statement_pass_run
    where org_id = '06420000-0000-0000-0000-000000000001') >
      to_timestamp(floor(extract(epoch from now()) / 300) * 300),
  'AC-SPC-014 persisted marker cannot retry in the current window');

-- A lapsed lease (a killed worker) cannot stamp or defer: the org stays due on the last written value.
update public.erp_sweep_lock set locked_until = now() - interval '1 second' where org_id = '06420000-0000-0000-0000-000000000001';
update public.erp_statement_pass_run set completed_at = now() - interval '2 hours' where org_id = '06420000-0000-0000-0000-000000000001';
select ok(not public.mark_erp_statement_pass_done('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111'),
  'AC-SPC-012 a holder whose lease ran out cannot mark the pass complete');
select ok((select completed_at from public.erp_statement_pass_run where org_id = '06420000-0000-0000-0000-000000000001') = now() - interval '2 hours',
  'AC-SPC-012 a refused stamp leaves the org on its last completed value');
select ok(not public.defer_erp_statement_pass('06420000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', 0),
  'AC-SPC-012 a holder whose lease ran out cannot defer the pass');
select ok((select completed_at from public.erp_statement_pass_run where org_id = '06420000-0000-0000-0000-000000000001') = now() - interval '2 hours',
  'AC-SPC-012 a refused deferral leaves the org on its last completed value');

-- ── AC-SPC-013: service-only, org-seamed ───────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.mark_erp_statement_pass_done(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mark_erp_statement_pass_done(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.defer_erp_statement_pass(uuid, uuid, int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.defer_erp_statement_pass(uuid, uuid, int)', 'EXECUTE'),
  'AC-SPC-013 the statement-pass marker RPCs are service-only');
select ok(not has_table_privilege('authenticated', 'public.erp_statement_pass_run', 'SELECT')
  and not has_table_privilege('authenticated', 'public.erp_statement_pass_run', 'INSERT')
  and not has_table_privilege('anon', 'public.erp_statement_pass_run', 'SELECT')
  and has_table_privilege('service_role', 'public.erp_statement_pass_run', 'SELECT,INSERT,UPDATE,DELETE'),
  'AC-SPC-013 the marker table is service-only');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.erp_statement_pass_run'::regclass)
    and exists (
      select 1 from pg_constraint
       where conrelid = 'public.erp_statement_pass_run'::regclass
         and contype = 'f'
         and confrelid = 'public.organizations'::regclass
    ),
  'AC-SPC-013 the marker is RLS-forced and seamed to the org');

select * from finish();
rollback;
