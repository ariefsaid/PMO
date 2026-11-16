-- spend_approval_project_lock.test.sql — the whole-project test (exceeds_project) is decided under a project lock.
-- Migration: 0925_spend_approval_project_lock.sql. AC-APR-056 (the project lock), same idiom as
-- spend_approval_line_lock.test.sql (a second dblink session holds a lock; the approval must WAIT, 55P03 under
-- lock_timeout). password=postgres is the Supabase LOCAL default; this file only runs under `supabase test db`.
--
-- Why the project lock: exceeds_project reads what EVERY line of the project has reserved and committed, but the
-- line lock covers one line, so two approvals on different lines could both read the project before either had
-- committed, and both pass. Each of the four deciding functions now takes the project lock, then the line lock.
--   (1) the other session holds the PROJECT lock → each of the four waits (delete the project lock: red);
--   (2) the other session holds the LINE lock → each of the four still waits (delete the line lock: red);
--   (3) the lock order is project then line in each body (an inverted order could deadlock);
--   (4) the second approval reads the first one's figures and goes to the senior set (sequential, the read half of the
--       property the lock serializes).
begin;
select plan(20);
create extension if not exists dblink;

insert into organizations (id, name, default_currency) values ('a0925000-0000-0000-0000-00000000000a', 'Project Lock Org', 'USD');
insert into auth.users (id, email) values
  ('a0925000-0000-0000-0000-0000000000a1', 'spl-eng@example.test'),
  ('a0925000-0000-0000-0000-0000000000a2', 'spl-pm@example.test'),
  ('a0925000-0000-0000-0000-0000000000a3', 'spl-exec@example.test'),
  ('a0925000-0000-0000-0000-0000000000a4', 'spl-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a0925000-0000-0000-0000-0000000000a1', 'a0925000-0000-0000-0000-00000000000a', 'SPL Eng',   'spl-eng@example.test',   'Engineer',        'active'),
  ('a0925000-0000-0000-0000-0000000000a2', 'a0925000-0000-0000-0000-00000000000a', 'SPL PM',    'spl-pm@example.test',    'Project Manager', 'active'),
  ('a0925000-0000-0000-0000-0000000000a3', 'a0925000-0000-0000-0000-00000000000a', 'SPL Exec',  'spl-exec@example.test',  'Executive',       'active'),
  ('a0925000-0000-0000-0000-0000000000a4', 'a0925000-0000-0000-0000-00000000000a', 'SPL Admin', 'spl-admin@example.test', 'Admin',           'active');
insert into projects (id, org_id, name, status, currency) values
  ('a0925000-0000-0000-0000-0000000000d1', 'a0925000-0000-0000-0000-00000000000a', 'SPL locked project',     'Ongoing Project', 'USD'),
  ('a0925000-0000-0000-0000-0000000000d2', 'a0925000-0000-0000-0000-00000000000a', 'SPL sequential project', 'Ongoing Project', 'USD');
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('a0925000-0000-0000-0000-000000000201', 'a0925000-0000-0000-0000-00000000000a', 'a0925000-0000-0000-0000-0000000000d1', 1, 'v1', 'Draft', 'USD'),
  ('a0925000-0000-0000-0000-000000000202', 'a0925000-0000-0000-0000-00000000000a', 'a0925000-0000-0000-0000-0000000000d2', 1, 'v1', 'Draft', 'USD');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
select 'a0925000-0000-0000-0000-00000000000a', v.id, c.category, c.amount
  from budget_versions v cross join (values ('Labor'::budget_category, 400::numeric), ('Materials', 600)) c(category, amount)
 where v.id::text like 'a0925000-%';
update budget_versions set status = 'Active' where id::text like 'a0925000-%';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('a0925000-0000-0000-0000-00000000000a', 'a0925000-0000-0000-0000-0000000000d2', 'a0925000-0000-0000-0000-0000000000a2'),
  ('a0925000-0000-0000-0000-00000000000a', null,                                   'a0925000-0000-0000-0000-0000000000a3');

-- The four deciding functions on project d1, line Materials.
insert into procurements (id, org_id, title, status, total_value, approved_total_value, approved_by_id, project_id, currency, budget_category, requested_by_id, is_subcontract) values
  ('a0925000-0000-0000-0000-000000000401', 'a0925000-0000-0000-0000-00000000000a', 'purchase request', 'Requested',       100, null, null, 'a0925000-0000-0000-0000-0000000000d1', 'USD', 'Materials', 'a0925000-0000-0000-0000-0000000000a1', false),
  ('a0925000-0000-0000-0000-000000000402', 'a0925000-0000-0000-0000-00000000000a', 'billed purchase',  'Vendor Invoiced', 100, 100,  'a0925000-0000-0000-0000-0000000000a3', 'a0925000-0000-0000-0000-0000000000d1', 'USD', 'Materials', 'a0925000-0000-0000-0000-0000000000a1', false),
  ('a0925000-0000-0000-0000-000000000403', 'a0925000-0000-0000-0000-00000000000a', 'subcontract',      'Ordered',         100, 100,  'a0925000-0000-0000-0000-0000000000a3', 'a0925000-0000-0000-0000-0000000000d1', 'USD', 'Materials', 'a0925000-0000-0000-0000-0000000000a1', true);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, currency, status, claim_number, submitted_at) values
  ('a0925000-0000-0000-0000-000000000501', 'a0925000-0000-0000-0000-00000000000a', 'claim', 'a0925000-0000-0000-0000-0000000000a1', 'a0925000-0000-0000-0000-0000000000d1', 'Materials', 'claim', 50, 'USD', 'Submitted', 'EXP-SPL-0001', now());
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('a0925000-0000-0000-0000-000000000601', 'a0925000-0000-0000-0000-00000000000a', 'a0925000-0000-0000-0000-0000000000d1', 'L1', 'Work', 'ls', 10, 10);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('a0925000-0000-0000-0000-000000000701', 'a0925000-0000-0000-0000-00000000000a', 'a0925000-0000-0000-0000-000000000403', 'PO-SPL-1', 'Issued', current_date, 'USD');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('a0925000-0000-0000-0000-000000000701', 1, 'a0925000-0000-0000-0000-000000000601', 10, 10, 'ls');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('a0925000-0000-0000-0000-000000000701', 'a0925000-0000-0000-0000-000000000403', 1, 'Issued', 100, 'a0925000-0000-0000-0000-0000000000a1', 'standard');
-- A pre-work variation, requested by the Engineer who raised the purchase.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0925000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select request_po_variation('a0925000-0000-0000-0000-000000000701', 'pre_work',
  '[{"boq_item_id":"a0925000-0000-0000-0000-000000000601","additional_quantity":1}]', 'SPL variation');
reset role;

-- The sequential property, on d2: 800 recorded against no category, so the project is at 800 of 1000.
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  ('a0925000-0000-0000-0000-000000000411', 'a0925000-0000-0000-0000-00000000000a', 'uncategorized paid', 'Paid',      800, 'a0925000-0000-0000-0000-0000000000d2', 'USD', null,        'a0925000-0000-0000-0000-0000000000a1'),
  ('a0925000-0000-0000-0000-000000000412', 'a0925000-0000-0000-0000-00000000000a', 'request A',          'Requested', 150, 'a0925000-0000-0000-0000-0000000000d2', 'USD', 'Labor',     'a0925000-0000-0000-0000-0000000000a1'),
  ('a0925000-0000-0000-0000-000000000413', 'a0925000-0000-0000-0000-00000000000a', 'request B',          'Requested', 100, 'a0925000-0000-0000-0000-0000000000d2', 'USD', 'Materials', 'a0925000-0000-0000-0000-0000000000a1');
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('a0925000-0000-0000-0000-000000000511', 'a0925000-0000-0000-0000-00000000000a', 'a0925000-0000-0000-0000-000000000411', 'Paid', '2026-10-10', 800, 'USD');

create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.vid() returns uuid language sql as $$ select id from po_variations where reason = 'SPL variation' $$;
create function pg_temp.route_of(p_id uuid) returns text language sql stable as $$
  select route || '/' || reason from get_procurement_approval_routes(array[p_id]::uuid[]) $$;

select dblink_connect('spl', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));

-- ── (1) another session holds the PROJECT lock: each of the four must wait for it ─────────────────────────────────
select dblink_exec('spl', 'begin');
select ok((select bool_and(a) from dblink('spl', format($q$select pg_try_advisory_xact_lock(%s)$q$,
     hashtextextended('spend-project:a0925000-0000-0000-0000-0000000000d1', 0))) as t(a boolean)),
  'AC-APR-056: a second session holds the project lock');
set local lock_timeout = '200ms';
set local role authenticated;
select pg_temp.act_as('a0925000-0000-0000-0000-0000000000a4');
select throws_ok($$ select transition_procurement('a0925000-0000-0000-0000-000000000401', 'Approved') $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a purchase approval waits for the project lock');
select throws_ok($$ select transition_expense_claim('a0925000-0000-0000-0000-000000000501', 'Approved') $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a claim approval waits for the project lock');
select throws_ok($$ select approve_procurement_amount('a0925000-0000-0000-0000-000000000402', 150) $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a higher-amount approval waits for the project lock');
select throws_ok($$ select decide_po_variation(pg_temp.vid(), true, null) $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a variation decision waits for the project lock');
reset role;

-- ── (2) another session holds only the LINE lock: each of the four still waits for it ────────────────────────────
select dblink_exec('spl', 'rollback');
select dblink_exec('spl', 'begin');
select ok((select bool_and(a) from dblink('spl', format($q$select pg_try_advisory_xact_lock(%s)$q$,
     hashtextextended('spend-line:a0925000-0000-0000-0000-0000000000d1:Materials', 0))) as t(a boolean)),
  'AC-APR-056: a second session holds the Materials line lock and not the project lock');
set local role authenticated;
select pg_temp.act_as('a0925000-0000-0000-0000-0000000000a4');
select throws_ok($$ select transition_procurement('a0925000-0000-0000-0000-000000000401', 'Approved') $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a purchase approval still waits for the line lock');
select throws_ok($$ select transition_expense_claim('a0925000-0000-0000-0000-000000000501', 'Approved') $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a claim approval still waits for the line lock');
select throws_ok($$ select approve_procurement_amount('a0925000-0000-0000-0000-000000000402', 150) $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a higher-amount approval still waits for the line lock');
select throws_ok($$ select decide_po_variation(pg_temp.vid(), true, null) $$,
  '55P03', 'canceling statement due to lock timeout', 'AC-APR-056: a variation decision still waits for the line lock');
reset role;

-- ── With the other session gone, the same four go through (so the waits above were the locks, nothing else) ───────
select dblink_exec('spl', 'rollback');
select dblink_disconnect('spl');
set local lock_timeout = 0;
set local role authenticated;
select pg_temp.act_as('a0925000-0000-0000-0000-0000000000a4');
select lives_ok($$ select transition_procurement('a0925000-0000-0000-0000-000000000401', 'Approved') $$, 'AC-APR-056: the purchase approval goes through once the lock is free');
select lives_ok($$ select transition_expense_claim('a0925000-0000-0000-0000-000000000501', 'Approved') $$, 'AC-APR-056: the claim approval goes through once the lock is free');
select lives_ok($$ select approve_procurement_amount('a0925000-0000-0000-0000-000000000402', 150) $$, 'AC-APR-056: the higher-amount approval goes through once the lock is free');
select lives_ok($$ select decide_po_variation(pg_temp.vid(), true, null) $$, 'AC-APR-056: the variation decision goes through once the lock is free');
reset role;

-- ── (3) the lock order is project, then line, in each body ────────────────────────────────────────────────────────
select is((select array_agg(p.proname::text order by p.proname)
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('transition_procurement', 'transition_expense_claim', 'approve_procurement_amount', 'decide_po_variation')
              and position('spend-project:' in p.prosrc) > 0
              and position('spend-project:' in p.prosrc) < position('spend-line:' in p.prosrc)),
  array['approve_procurement_amount', 'decide_po_variation', 'transition_expense_claim', 'transition_procurement'],
  'AC-APR-056: each of the four takes the project lock before the line lock');

-- ── (4) the second approval reads the first one's figures: project d2 is at 800 of 1000 ───────────────────────────
set local role authenticated;
select pg_temp.act_as('a0925000-0000-0000-0000-0000000000a2');
select is(pg_temp.route_of('a0925000-0000-0000-0000-000000000413'), 'project/within_budget',
  'AC-APR-056: request B (100 on Materials) fits the project (800 + 100 of 1000), so the named approver may decide it');
select lives_ok($$ select transition_procurement('a0925000-0000-0000-0000-000000000412', 'Approved') $$,
  'AC-APR-056: the named approver approves request A (150 on Labor), which fits the project (950 of 1000)');
select is(pg_temp.route_of('a0925000-0000-0000-0000-000000000413'), 'org/exceeds_project',
  'AC-APR-056: with A reserved, request B takes the project over (800 + 150 + 100 > 1000) and goes to the senior set');
select throws_ok($$ select transition_procurement('a0925000-0000-0000-0000-000000000413', 'Approved') $$,
  '42501', null, 'AC-APR-056: so the named approver can no longer approve B');
select pg_temp.act_as('a0925000-0000-0000-0000-0000000000a3');
select lives_ok($$ select transition_procurement('a0925000-0000-0000-0000-000000000413', 'Approved') $$,
  'AC-APR-056: and the senior set can');
reset role;

select * from finish();
rollback;
