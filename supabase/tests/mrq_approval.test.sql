-- mrq_approval.test.sql — #2524 material requests: ordered approval, SoD, stand-ins, snapshots, queue, tenancy.
-- Spec docs/specs/material-requests.spec.md. Migrations under test: 1000_material_requests.sql, 1001_material_request_rpcs.sql.
-- AC-MRQ-002 steps decide in order · AC-MRQ-003 the requester never decides · AC-MRQ-004 one person, one step ·
-- AC-MRQ-005 a stand-in acts only inside the window, both identities stored · AC-MRQ-006 a stand-in who raised the
-- request is refused · AC-MRQ-010 a return restarts at step 1 with a fresh snapshot · AC-MRQ-011 chain edits leave
-- in-flight requests alone · AC-MRQ-013 "waiting for me" (database half) · AC-MRQ-014 another org reads and does nothing.
-- Every denial asserts the errcode AND the message, so a different gate moving in front cannot pass it.
begin;
create extension if not exists pgtap;
select plan(51);

-- ── Fixtures (written as the table owner) ─────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('25240000-0000-0000-0000-00000000000a', 'MRQ Org',       'IDR', 'Asia/Jakarta'),
  ('25240000-0000-0000-0000-00000000000b', 'MRQ Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25240000-0000-0000-0000-0000000000a1', 'mrq-admin@example.com'),
  ('25240000-0000-0000-0000-0000000000a2', 'mrq-req@example.com'),
  ('25240000-0000-0000-0000-0000000000a3', 'mrq-pm@example.com'),
  ('25240000-0000-0000-0000-0000000000a4', 'mrq-eng@example.com'),
  ('25240000-0000-0000-0000-0000000000a5', 'mrq-fin@example.com'),
  ('25240000-0000-0000-0000-0000000000a6', 'mrq-fin2@example.com'),
  ('25240000-0000-0000-0000-0000000000a7', 'mrq-exec@example.com'),
  ('25240000-0000-0000-0000-0000000000a8', 'mrq-exec2@example.com'),
  ('25240000-0000-0000-0000-0000000000b1', 'mrq-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25240000-0000-0000-0000-0000000000a1', '25240000-0000-0000-0000-00000000000a', 'MRQ Admin', 'mrq-admin@example.com', 'Admin', 'active'),
  ('25240000-0000-0000-0000-0000000000a2', '25240000-0000-0000-0000-00000000000a', 'MRQ Req',   'mrq-req@example.com',   'Engineer', 'active'),
  ('25240000-0000-0000-0000-0000000000a3', '25240000-0000-0000-0000-00000000000a', 'MRQ PM',    'mrq-pm@example.com',    'Project Manager', 'active'),
  ('25240000-0000-0000-0000-0000000000a4', '25240000-0000-0000-0000-00000000000a', 'MRQ Eng',   'mrq-eng@example.com',   'Engineer', 'active'),
  ('25240000-0000-0000-0000-0000000000a5', '25240000-0000-0000-0000-00000000000a', 'MRQ Fin',   'mrq-fin@example.com',   'Finance', 'active'),
  ('25240000-0000-0000-0000-0000000000a6', '25240000-0000-0000-0000-00000000000a', 'MRQ Fin2',  'mrq-fin2@example.com',  'Finance', 'active'),
  ('25240000-0000-0000-0000-0000000000a7', '25240000-0000-0000-0000-00000000000a', 'MRQ Exec',  'mrq-exec@example.com',  'Executive', 'active'),
  ('25240000-0000-0000-0000-0000000000a8', '25240000-0000-0000-0000-00000000000a', 'MRQ Exec2', 'mrq-exec2@example.com', 'Executive', 'active'),
  ('25240000-0000-0000-0000-0000000000b1', '25240000-0000-0000-0000-00000000000b', 'MRQ XOrg',  'mrq-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25240000-0000-0000-0000-0000000000d1', '25240000-0000-0000-0000-00000000000a', 'MRQ Site', 'Ongoing Project', '25240000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25240000-0000-0000-0000-000000000401', '25240000-0000-0000-0000-00000000000a', '25240000-0000-0000-0000-0000000000d1', 'MRQ WO', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25240000-0000-0000-0000-000000000301', '25240000-0000-0000-0000-00000000000a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25240000-0000-0000-0000-000000000311', '25240000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '25240000-0000-0000-0000-000000000301');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25240000-0000-0000-0000-000000000801', '25240000-0000-0000-0000-00000000000a', 'MRQ-C', 'Central',  'central', null),
  ('25240000-0000-0000-0000-000000000802', '25240000-0000-0000-0000-00000000000a', 'MRQ-S', 'Site one', 'site',    '25240000-0000-0000-0000-0000000000d1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('25240000-0000-0000-0000-00000000000a', '25240000-0000-0000-0000-000000000801', '25240000-0000-0000-0000-0000000000a5'),
  ('25240000-0000-0000-0000-00000000000a', '25240000-0000-0000-0000-000000000801', '25240000-0000-0000-0000-0000000000a6');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- Raise a draft as the requester and submit it; returns the request id.
create or replace function pg_temp._raise(p_qty numeric, p_reason text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp._as('25240000-0000-0000-0000-0000000000a2');
  v := public.mrq_save_draft(null,
         jsonb_build_object('work_order_id', '25240000-0000-0000-0000-000000000401', 'needed_by', current_date + 5),
         jsonb_build_array(jsonb_build_object('item_id', '25240000-0000-0000-0000-000000000311', 'quantity', p_qty,
                                              'over_plan_reason', p_reason)));
  perform public.mrq_submit(v);
  return v;
end $$;
grant execute on function pg_temp._raise(numeric, text) to authenticated;

set local role authenticated;

-- The Admin sets the default chain (OD-MRQ-2): engineer when over plan, project manager, finance (stock).
select pg_temp._as('25240000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Engineer","label":"Plan check","only_over_plan":true},
                                                  {"role":"Project Manager","label":"Billable change"},
                                                  {"role":"Finance","label":"Stock"}]'::jsonb) $$,
  'FR-MRQ-005 an Admin sets the ordered chain');
select pg_temp._as('25240000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.mrq_set_chain('[]'::jsonb) $$, '42501',
  'MRQ_ADMIN_ONLY: only an Admin can change the approval chain', 'FR-MRQ-005 a non-Admin cannot change the chain');

-- No allowance on this work order → plan 0 → every request is over plan, so all three steps apply.
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
insert into t_ids values ('r1', pg_temp._raise(10, 'urgent pour'));

select is((select count(*)::int from material_request_steps where request_id = (select v from t_ids where k = 'r1')), 3,
  'FR-MRQ-006 the three applicable steps are snapshotted on submit');

-- AC-MRQ-002: the PM (step 2) cannot act before step 1.
select pg_temp._as('25240000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 2, 'approve') $$, 'P0001',
  'MRQ_OUT_OF_ORDER: step 2 is not the open step; steps are decided in order', 'AC-MRQ-002 step 2 before step 1 is refused');
-- …and the PM cannot take step 1 either: not their role.
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'approve') $$, '42501',
  'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today',
  'FR-MRQ-007 a step is decided only by its role');

-- AC-MRQ-003: the requester holds the Engineer role but never decides their own request.
select pg_temp._as('25240000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'approve') $$, '42501',
  'MRQ_SOD_AUTHOR: you cannot decide a request you raised', 'AC-MRQ-003 the requester cannot approve a step of their own request');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'reject', 'no') $$, '42501',
  'MRQ_SOD_AUTHOR: you cannot decide a request you raised', 'AC-MRQ-003 nor reject it');

-- Step 1 by another engineer; then step 2 opens and the PM may act.
select pg_temp._as('25240000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'approve') $$,
  'AC-MRQ-002 step 1 by its role is accepted');
select is((select status from material_request_steps where request_id = (select v from t_ids where k = 'r1') and position = 2), 'open',
  'AC-MRQ-002 step 2 opens only after step 1 is approved');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 2, 'return', '  ') $$, '42501',
  'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today',
  'FR-MRQ-008 the step-1 engineer has no authority over step 2');
select pg_temp._as('25240000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 2, 'return', '  ') $$, 'P0001',
  'MRQ_REASON_REQUIRED: a return or rejection needs a reason (1 to 500 characters)', 'FR-MRQ-008 a return needs a reason');

-- AC-MRQ-011: the chain changes while r1 is in flight; r1 keeps its three steps.
select pg_temp._as('25240000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Finance","label":"Stock only"}]'::jsonb) $$, 'AC-MRQ-011 the chain is edited');
select pg_temp._as('25240000-0000-0000-0000-0000000000a3');
select is((select array_agg(role::text || ':' || label order by position) from material_request_steps
            where request_id = (select v from t_ids where k = 'r1')),
  array['Engineer:Plan check', 'Project Manager:Billable change', 'Finance:Stock'],
  'AC-MRQ-011 the in-flight request keeps its snapshot');

-- AC-MRQ-010: the PM returns r1; it goes back to draft, the author amends and resubmits; it restarts at step 1 with
-- the CURRENT chain (one Finance step).
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 2, 'return', 'split the delivery') $$,
  'FR-MRQ-012 the PM returns the request');
select is((select status from material_requests where id = (select v from t_ids where k = 'r1')), 'draft',
  'AC-MRQ-010 a returned request is a draft again');
select is((select status from material_request_steps where request_id = (select v from t_ids where k = 'r1') and round = 1 and position = 3),
  'superseded', 'AC-MRQ-010 the remaining steps of the returned round are superseded');
select pg_temp._as('25240000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.mrq_save_draft((select v from t_ids where k = 'r1'),
     jsonb_build_object('work_order_id', '25240000-0000-0000-0000-000000000401', 'needed_by', current_date + 6),
     '[{"item_id":"25240000-0000-0000-0000-000000000311","quantity":6,"over_plan_reason":"split pour"}]'::jsonb) $$,
  'AC-MRQ-010 the author amends the returned draft');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r1')) $$, 'AC-MRQ-010 and resubmits');
select is((select array_agg(position::text || ':' || role::text || ':' || status order by position) from material_request_steps
            where request_id = (select v from t_ids where k = 'r1') and round = 2),
  array['1:Finance:open'], 'AC-MRQ-010 the resubmission restarts at step 1 with a fresh snapshot of the chain');

-- Restore the three-step chain for the remaining cases.
select pg_temp._as('25240000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Engineer","label":"Plan check","only_over_plan":true},
                                                  {"role":"Project Manager","label":"Billable change"},
                                                  {"role":"Finance","label":"Stock"}]'::jsonb) $$, 'the three-step chain is back');

-- AC-MRQ-004: a chain whose two steps share a role — one person cannot take both.
select lives_ok($$ select public.mrq_set_chain('[{"role":"Finance","label":"Cost"},{"role":"Finance","label":"Stock"}]'::jsonb) $$,
  'AC-MRQ-004 a chain with two Finance steps');
insert into t_ids values ('r2', pg_temp._raise(2, 'top-up'));
select pg_temp._as('25240000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 1, 'approve') $$, 'AC-MRQ-004 step 1 by Finance');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 2, 'approve',
                                                 null, '25240000-0000-0000-0000-000000000801') $$, '42501',
  'MRQ_SOD_TWICE: you already decided another step of this request', 'AC-MRQ-004 the same person cannot take step 2');
select is((select status from material_requests where id = (select v from t_ids where k = 'r2')), 'pending',
  'AC-MRQ-004 the request is still pending at step 2');

-- A return restarts review: the original decider may revisit their own step, but cannot take a different step in a later round.
select pg_temp._as('25240000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 2, 'return', 'revise') $$, 'AC-MRQ-004 the second approver returns the request');
select pg_temp._as('25240000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r2'), '25240000-0000-0000-0000-00000000d001') $$, 'AC-MRQ-004 the author resubmits');
select pg_temp._as('25240000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 1, 'approve') $$, 'AC-MRQ-004 the same person may review the same step again');
select pg_temp._as('25240000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 2, 'return', 'revise again') $$, 'AC-MRQ-004 the same returner may revisit their step');
select pg_temp._as('25240000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r2'), '25240000-0000-0000-0000-00000000d001') $$, 'FR-MRQ-004 a delayed replay after a return succeeds');
select is((select status from material_requests where id = (select v from t_ids where k = 'r2')), 'draft', 'FR-MRQ-004 replay does not resubmit the returned draft');
select pg_temp._as('25240000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Finance","label":"Stock"}]'::jsonb) $$, 'AC-MRQ-004 the chain changes after return');
select pg_temp._as('25240000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r2'), '25240000-0000-0000-0000-00000000d002') $$, 'AC-MRQ-004 the author resubmits after the chain change');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r2'), '25240000-0000-0000-0000-00000000d001') $$, 'FR-MRQ-004 a replay from an earlier round remains a no-op');
select pg_temp._as('25240000-0000-0000-0000-0000000000a5');
select ok(not exists (select 1 from public.mrq_waiting_for_me() where request_id = (select v from t_ids where k = 'r2')),
  'AC-MRQ-013 the queue excludes a different step decided in a prior round');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 1, 'approve', null, '25240000-0000-0000-0000-000000000801') $$,
  '42501', 'MRQ_SOD_TWICE: you already decided another step of this request', 'AC-MRQ-004 a different step is refused even when moved to the original position');

-- AC-MRQ-005 / 006: stand-ins on the three-step chain.
select pg_temp._as('25240000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Engineer","label":"Plan check","only_over_plan":true},
                                                  {"role":"Project Manager","label":"Billable change"},
                                                  {"role":"Finance","label":"Stock"}]'::jsonb) $$, 'the three-step chain again');
-- The PM names the first executive for today; an Admin names the second executive for a window that has passed —
-- written as the owner, since the RPC refuses an ended range.
select pg_temp._as('25240000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.mrq_set_stand_in('25240000-0000-0000-0000-0000000000a3', '25240000-0000-0000-0000-0000000000a7',
                                                  current_date - 1, current_date + 1) $$, 'FR-MRQ-009 the PM names a stand-in for today');
select throws_ok($$ select public.mrq_set_stand_in('25240000-0000-0000-0000-0000000000a4', '25240000-0000-0000-0000-0000000000a7',
                                                  current_date, current_date + 1) $$, '42501',
  'MRQ_STAND_IN: only the person away, or an Admin, names their stand-in', 'FR-MRQ-009 nobody names a stand-in for someone else');
reset role;
insert into approval_stand_ins (org_id, delegator_id, stand_in_id, starts_on, ends_on, created_by) values
  ('25240000-0000-0000-0000-00000000000a', '25240000-0000-0000-0000-0000000000a3', '25240000-0000-0000-0000-0000000000a8',
   current_date - 10, current_date - 3, '25240000-0000-0000-0000-0000000000a1'),
  ('25240000-0000-0000-0000-00000000000a', '25240000-0000-0000-0000-0000000000a3', '25240000-0000-0000-0000-0000000000a2',
   current_date - 1, current_date + 1, '25240000-0000-0000-0000-0000000000a1');
set local role authenticated;

insert into t_ids values ('r3', pg_temp._raise(3, 'extra'));
select pg_temp._as('25240000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r3'), 1, 'approve') $$, 'step 1 of r3');

-- AC-MRQ-013 (database half): the PM and their in-window stand-in see r3's step 2; Finance does not yet; the author
-- (also a named stand-in for the PM) never sees their own request.
select pg_temp._as('25240000-0000-0000-0000-0000000000a3');
select ok(exists (select 1 from public.mrq_waiting_for_me() w where w.request_id = (select v from t_ids where k = 'r3')
                   and w.step_position = 2 and w.acting_for is null), 'AC-MRQ-013 the PM sees the open step');
select pg_temp._as('25240000-0000-0000-0000-0000000000a7');
select ok(exists (select 1 from public.mrq_waiting_for_me() w where w.request_id = (select v from t_ids where k = 'r3')
                   and w.acting_for = '25240000-0000-0000-0000-0000000000a3'), 'AC-MRQ-013 the in-window stand-in sees it, acting for the PM');
select pg_temp._as('25240000-0000-0000-0000-0000000000a8');
select ok(not exists (select 1 from public.mrq_waiting_for_me() w where w.request_id = (select v from t_ids where k = 'r3')),
  'AC-MRQ-013 a stand-in whose window has passed does not');
select pg_temp._as('25240000-0000-0000-0000-0000000000a5');
select ok(not exists (select 1 from public.mrq_waiting_for_me() w where w.request_id = (select v from t_ids where k = 'r3')),
  'AC-MRQ-013 a later step''s approver does not see it before its turn');
select pg_temp._as('25240000-0000-0000-0000-0000000000a2');
select ok(not exists (select 1 from public.mrq_waiting_for_me() w where w.request_id = (select v from t_ids where k = 'r3')),
  'AC-MRQ-013 the author never sees their own request');

-- AC-MRQ-006: the author is a named in-window stand-in for the PM, and is still refused.
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r3'), 2, 'approve') $$, '42501',
  'MRQ_SOD_AUTHOR: you cannot decide a request you raised', 'AC-MRQ-006 a stand-in who raised the request is refused');
-- AC-MRQ-005: outside the window is refused; inside the window is accepted and both identities are stored.
select pg_temp._as('25240000-0000-0000-0000-0000000000a8');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r3'), 2, 'approve') $$, '42501',
  'MRQ_NOT_APPROVER: you do not hold this step''s role and stand in for no one who does today',
  'AC-MRQ-005 a stand-in outside their date range is refused');
select pg_temp._as('25240000-0000-0000-0000-0000000000a7');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r3'), 2, 'approve') $$,
  'AC-MRQ-005 the in-window stand-in approves');
select is((select decided_by::text || '/' || acted_for::text from material_request_steps
            where request_id = (select v from t_ids where k = 'r3') and position = 2),
  '25240000-0000-0000-0000-0000000000a7/25240000-0000-0000-0000-0000000000a3',
  'AC-MRQ-005 the stand-in and the person they stood in for are both stored');

-- AC-MRQ-014: another organisation reads nothing and changes nothing.
select pg_temp._as('25240000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from material_requests) + (select count(*)::int from material_request_steps)
          + (select count(*)::int from approval_chain_steps where org_id = '25240000-0000-0000-0000-00000000000a')
          + (select count(*)::int from approval_stand_ins), 0, 'AC-MRQ-014 another org reads no request, step, chain or stand-in');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r3'), 3, 'approve') $$, 'P0001',
  'MRQ_NOT_FOUND: the request is not in your organisation', 'AC-MRQ-014 another org cannot decide a step');
select throws_ok($$ select public.mrq_set_stand_in('25240000-0000-0000-0000-0000000000a3', '25240000-0000-0000-0000-0000000000b1',
                                                  current_date, current_date + 1) $$, 'P0001',
  'MRQ_STAND_IN: both people must be active members of your organisation', 'AC-MRQ-014 another org cannot name a stand-in here');

select * from finish();
rollback;
