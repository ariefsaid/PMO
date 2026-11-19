-- mrq_submit_transfer.test.sql — #2524 material requests: over-plan reason, cut-off, idempotency, transfer draft.
-- Spec docs/specs/material-requests.spec.md. Migrations under test: 1000_material_requests.sql, 1001_material_request_rpcs.sql.
-- AC-MRQ-001 an over-plan line needs a reason · AC-MRQ-007 the final approval makes exactly one transfer draft on the
-- work order, nothing posted · AC-MRQ-008 a failed transfer leaves the request at its last step, no partial transfer ·
-- AC-MRQ-009 the cut-off at exact times, and on the server clock · AC-MRQ-012 the posted transfer fulfils the request ·
-- FR-MRQ-004 create and submit replay on a client request id · FR-MRQ-013 a cancelled draft flags the request.
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25240000-0000-0000-0000-00000000010a', 'MRQ Submit Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25240000-0000-0000-0000-0000000001a1', 'mrqs-admin@example.com'),
  ('25240000-0000-0000-0000-0000000001a2', 'mrqs-req@example.com'),
  ('25240000-0000-0000-0000-0000000001a3', 'mrqs-pm@example.com'),
  ('25240000-0000-0000-0000-0000000001a4', 'mrqs-eng@example.com'),
  ('25240000-0000-0000-0000-0000000001a5', 'mrqs-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25240000-0000-0000-0000-0000000001a1', '25240000-0000-0000-0000-00000000010a', 'MRQS Admin', 'mrqs-admin@example.com', 'Admin', 'active'),
  ('25240000-0000-0000-0000-0000000001a2', '25240000-0000-0000-0000-00000000010a', 'MRQS Req',   'mrqs-req@example.com',   'Engineer', 'active'),
  ('25240000-0000-0000-0000-0000000001a3', '25240000-0000-0000-0000-00000000010a', 'MRQS PM',    'mrqs-pm@example.com',    'Project Manager', 'active'),
  ('25240000-0000-0000-0000-0000000001a4', '25240000-0000-0000-0000-00000000010a', 'MRQS Eng',   'mrqs-eng@example.com',   'Engineer', 'active'),
  ('25240000-0000-0000-0000-0000000001a5', '25240000-0000-0000-0000-00000000010a', 'MRQS Fin',   'mrqs-fin@example.com',   'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25240000-0000-0000-0000-0000000001d1', '25240000-0000-0000-0000-00000000010a', 'MRQS Site', 'Ongoing Project', '25240000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25240000-0000-0000-0000-000000001401', '25240000-0000-0000-0000-00000000010a', '25240000-0000-0000-0000-0000000001d1', 'MRQS WO', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25240000-0000-0000-0000-000000001201', '25240000-0000-0000-0000-00000000010a', '25240000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25240000-0000-0000-0000-00000000010a', '25240000-0000-0000-0000-000000001401', '25240000-0000-0000-0000-000000001201', 10);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25240000-0000-0000-0000-000000001301', '25240000-0000-0000-0000-00000000010a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25240000-0000-0000-0000-000000001311', '25240000-0000-0000-0000-00000000010a', 'CEM', 'Cement', '25240000-0000-0000-0000-000000001301');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('25240000-0000-0000-0000-00000000010a', '25240000-0000-0000-0000-000000001201', '25240000-0000-0000-0000-000000001311', 100);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25240000-0000-0000-0000-000000001801', '25240000-0000-0000-0000-00000000010a', 'MRQS-C',  'Central',     'central', null),
  ('25240000-0000-0000-0000-000000001803', '25240000-0000-0000-0000-00000000010a', 'MRQS-C2', 'Central two', 'central', null),
  ('25240000-0000-0000-0000-000000001802', '25240000-0000-0000-0000-00000000010a', 'MRQS-S',  'Site',        'site',    '25240000-0000-0000-0000-0000000001d1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('25240000-0000-0000-0000-00000000010a', '25240000-0000-0000-0000-000000001801', '25240000-0000-0000-0000-0000000001a5');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._draft(p_qty numeric, p_reason text, p_needed date, p_crid uuid default null) returns uuid
  language sql as $$
  select public.mrq_save_draft(null,
    jsonb_build_object('work_order_id', '25240000-0000-0000-0000-000000001401', 'needed_by', p_needed),
    jsonb_build_array(jsonb_build_object('item_id', '25240000-0000-0000-0000-000000001311', 'quantity', p_qty, 'over_plan_reason', p_reason)),
    p_crid) $$;
grant execute on function pg_temp._draft(numeric, text, date, uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

-- ── AC-MRQ-009: the cut-off rule at exact instants (Asia/Jakarta = UTC+7; 11:59 local = 04:59 UTC) ──────────────
select is(public.mrq_cutoff_earliest('12:00', 'Asia/Jakarta', '2026-11-20', '2026-11-19 04:59:00+00'), null::date,
  'AC-MRQ-009 a next-day request at 11:59 project time is accepted');
select is(public.mrq_cutoff_earliest('12:00', 'Asia/Jakarta', '2026-11-20', '2026-11-19 05:01:00+00'), '2026-11-21'::date,
  'AC-MRQ-009 at 12:01 it is refused, naming the earliest date');
select is(public.mrq_cutoff_earliest('12:00', 'Asia/Jakarta', '2026-11-21', '2026-11-19 05:01:00+00'), null::date,
  'AC-MRQ-009 a request for two days ahead at 12:01 is accepted');
select is(public.mrq_cutoff_earliest(null, 'Asia/Jakarta', '2026-11-20', '2026-11-19 16:30:00+00'), null::date,
  'AC-MRQ-009 with no cut-off a next-day request is never refused');
select is(public.mrq_cutoff_earliest(null, 'Asia/Jakarta', '2026-11-19', '2026-11-19 01:00:00+00'), '2026-11-20'::date,
  'FR-MRQ-014 a request needed today or earlier is refused');

set local role authenticated;
select pg_temp._as('25240000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Engineer","label":"Plan check","only_over_plan":true},
                                                  {"role":"Project Manager","label":"Billable change"},
                                                  {"role":"Finance","label":"Stock"}]'::jsonb) $$, 'the default chain');

-- ── AC-MRQ-009 on the server clock: a 00:00 cut-off has always passed, so tomorrow is refused ─────────────────────
select lives_ok($$ select public.mrq_set_cutoff('00:00') $$, 'FR-MRQ-014 an Admin sets the cut-off');
select pg_temp._as('25240000-0000-0000-0000-0000000001a2');
insert into t_ids values ('cut', pg_temp._draft(5, null, ((now() at time zone 'Asia/Jakarta')::date + 1)));
select throws_like($$ select public.mrq_submit((select v from t_ids where k = 'cut')) $$,
  'MRQ_CUTOFF: requests for tomorrow close at 00:00; the earliest date you can request is %',
  'AC-MRQ-009 the server refuses a next-day request after the cut-off, naming it and the earliest date');
select pg_temp._as('25240000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_cutoff(null) $$, 'the cut-off is cleared');
select pg_temp._as('25240000-0000-0000-0000-0000000001a2');
select lives_ok($$ select public.mrq_cancel((select v from t_ids where k = 'cut')) $$, 'the author withdraws the draft');

-- ── FR-MRQ-004: create and submit replay on a client request id ────────────────────────────────────────────────
insert into t_ids values ('idem', pg_temp._draft(50, null, current_date + 5, '25240000-0000-0000-0000-00000000c001'));
select is(pg_temp._draft(50, null, current_date + 5, '25240000-0000-0000-0000-00000000c001'), (select v from t_ids where k = 'idem'),
  'FR-MRQ-004 a replayed create returns the first request');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'idem'), '25240000-0000-0000-0000-00000000c002') $$,
  'FR-MRQ-004 submit');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'idem'), '25240000-0000-0000-0000-00000000c002') $$,
  'FR-MRQ-004 a replayed submit is a no-op');
-- Within plan (50 of 100): the over-plan-only engineer step is not snapshotted.
select is((select array_agg(role::text order by position) from material_request_steps where request_id = (select v from t_ids where k = 'idem')),
  array['Project Manager', 'Finance'], 'OD-MRQ-2 a within-plan request skips the over-plan-only step, once');
select is((select plan_qty::text || '/' || prior_qty::text from material_request_lines where request_id = (select v from t_ids where k = 'idem')),
  '100.000/0.000', 'FR-MRQ-002 the plan and prior quantities are snapshotted at submission');

select is((select plan_qty::text || '/' || prior_qty::text from public.mrq_plan_for('25240000-0000-0000-0000-000000001401',
            array['25240000-0000-0000-0000-000000001311']::uuid[])),
  '100.000/50.000', 'FR-MRQ-002 the form reads the same plan and already-requested figures the server snapshots');

-- ── AC-MRQ-001: 50 already requested + 60 = 110 > 100 → a reason is required ──────────────────────────────────
insert into t_ids values ('over', pg_temp._draft(60, null, current_date + 5));
select throws_ok($$ select public.mrq_submit((select v from t_ids where k = 'over')) $$, '23514',
  'MRQ_OVER_PLAN_REASON: line 1 is over plan and needs a reason (1 to 500 characters)',
  'AC-MRQ-001 an over-plan line without a reason is refused');
select lives_ok($$ select public.mrq_save_draft((select v from t_ids where k = 'over'),
    jsonb_build_object('work_order_id', '25240000-0000-0000-0000-000000001401', 'needed_by', current_date + 5),
    '[{"item_id":"25240000-0000-0000-0000-000000001311","quantity":60,"over_plan_reason":"second slab pour"}]'::jsonb) $$,
  'AC-MRQ-001 the author adds a reason');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'over')) $$, 'AC-MRQ-001 with a reason it is accepted');
select is((select count(*)::int from material_request_steps where request_id = (select v from t_ids where k = 'over')), 3,
  'OD-MRQ-2 an over-plan request takes the over-plan-only step too');

-- Walk the within-plan request to its final step.
select pg_temp._as('25240000-0000-0000-0000-0000000001a3');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'idem'), 1, 'approve') $$, 'step 1 (PM)');

-- ── AC-MRQ-008: the transfer cannot be made (no source, then a warehouse Finance does not keep) ────────────────────
select pg_temp._as('25240000-0000-0000-0000-0000000001a5');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'idem'), 2, 'approve') $$, 'P0001',
  'MRQ_SOURCE_REQUIRED: choose the warehouse the material leaves from', 'FR-MRQ-011 the final step names the source warehouse');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'idem'), 2, 'approve', null,
                                                 '25240000-0000-0000-0000-000000001803') $$, 'P0001',
  'STK_NOT_KEEPER: you do not keep this warehouse', 'AC-MRQ-008 the transfer creation fails in the stock path');
select is((select r.status || '/' || s.status from material_requests r
             join material_request_steps s on s.request_id = r.id and s.round = r.round and s.position = 2
            where r.id = (select v from t_ids where k = 'idem')),
  'pending/open', 'AC-MRQ-008 the request is not approved; its last step is still open');
select is((select count(*)::int from stock_documents where work_order_id = '25240000-0000-0000-0000-000000001401'), 0,
  'AC-MRQ-008 no partial transfer exists');

-- ── AC-MRQ-007: the final approval makes exactly one transfer draft on the work order ──────────────────────────
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'idem'), 2, 'approve', null,
                                                '25240000-0000-0000-0000-000000001801') $$, 'AC-MRQ-007 the final step approves');
select is((select r.status || '/' || d.kind || '/' || d.status || '/' || d.warehouse_id::text || '/' || d.to_warehouse_id::text
                  || '/' || d.work_order_id::text
             from material_requests r join stock_documents d on d.id = r.transfer_document_id
            where r.id = (select v from t_ids where k = 'idem')),
  'approved/transfer/Draft/25240000-0000-0000-0000-000000001801/25240000-0000-0000-0000-000000001802/25240000-0000-0000-0000-000000001401',
  'AC-MRQ-007 the request is approved and linked to a transfer draft, central to the site, on the work order');
select is((select count(*)::int || ':' || string_agg(l.item_id::text || '=' || l.quantity::text, ',')
             from stock_document_lines l
            where l.document_id = (select transfer_document_id from material_requests where id = (select v from t_ids where k = 'idem'))),
  '1:25240000-0000-0000-0000-000000001311=50.000', 'AC-MRQ-007 the transfer carries the request''s lines');
select is((select count(*)::int from stock_documents where work_order_id = '25240000-0000-0000-0000-000000001401'), 1,
  'AC-MRQ-007 exactly one transfer exists, and nothing is posted');

-- ── AC-MRQ-012: the keeper posts the transfer; the request is fulfilled ─────────────────────────────────────────
select lives_ok($$ select public.create_stock_document(
    '{"kind":"receive","warehouse_id":"25240000-0000-0000-0000-000000001801"}'::jsonb,
    '[{"item_id":"25240000-0000-0000-0000-000000001311","quantity":500,"unit_cost":10}]'::jsonb, true) $$,
  'stock is received into the central warehouse');
select lives_ok($$ select public.post_stock_document((select transfer_document_id from material_requests
                                                       where id = (select v from t_ids where k = 'idem'))) $$, 'the keeper posts the transfer');
select is((select status from material_requests where id = (select v from t_ids where k = 'idem')), 'fulfilled',
  'AC-MRQ-012 a posted transfer shows the request as fulfilled');

-- ── FR-MRQ-013: a cancelled draft returns the request to approved with a flag; a keeper (not the author) remakes it ──
-- The over-plan request is approved step by step, each by its own role, then Finance cancels the transfer draft.
do $$
declare v uuid := (select t.v from t_ids t where t.k = 'over');
begin
  perform pg_temp._as('25240000-0000-0000-0000-0000000001a4'); perform public.mrq_decide_step(v, 1, 'approve');
  perform pg_temp._as('25240000-0000-0000-0000-0000000001a3'); perform public.mrq_decide_step(v, 2, 'approve');
  perform pg_temp._as('25240000-0000-0000-0000-0000000001a5');
  perform public.mrq_decide_step(v, 3, 'approve', null, '25240000-0000-0000-0000-000000001801');
  perform public.cancel_stock_document((select r.transfer_document_id from material_requests r where r.id = v));
end $$;
select is((select status || '/' || transfer_cancelled::text from material_requests where id = (select v from t_ids where k = 'over')),
  'approved/true', 'FR-MRQ-013 a cancelled transfer draft leaves the request approved, flagged');
select pg_temp._as('25240000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.mrq_retry_transfer((select v from t_ids where k = 'over'), '25240000-0000-0000-0000-000000001801') $$,
  '42501', 'MRQ_SOD_AUTHOR: you cannot move stock for a request you raised', 'FR-MRQ-013 the requester cannot remake the transfer');

select * from finish();
rollback;
