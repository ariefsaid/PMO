-- 2600_wo_shared_claim_evidence.test.sql — work-order quality documents filed once are reused by every later claim (DD-R1124-17, AC-WQE-001..004).
-- Proves:
--   AC-WQE-001: Quality Inspector files a quality document once on their work-order billing step; Claim 1 and Claim 2
--               created on that work order both receive it in progress_claim_evidence and pass the invoice evidence gate.
--   AC-WQE-002: An open (un-invoiced, un-withdrawn) claim receives a newly attached work-order step document; a withdrawn claim does not.
--   AC-WQE-003: Replacing a slot document (rev A -> rev B) or superseding a document keeps earlier claims pointing at what they
--               were submitted with; later claims receive the new revision and skip Superseded rows.
--   AC-WQE-004: The step mark defaults false, is Admin-only (refuses Finance, PM, QI, field),
--               is audited, and disables automatic reuse when switched off.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(29);
select dblink_connect('wqe_race', format('dbname=%s user=%s password=postgres host=%s port=%s', current_database(), current_user, coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(),5432)));


create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;

insert into organizations (id, name, down_payment_item) values
  ('26000000-0000-0000-0000-000000000001', 'WQE Org A', 'DP-ITEM'),
  ('26000000-0000-0000-0000-000000000002', 'WQE Org B', 'DP-ITEM');

insert into auth.users (id, email) values
  ('26000000-0000-0000-0000-0000000000a1', 'wqe-admin@example.com'),
  ('26000000-0000-0000-0000-0000000000a2', 'wqe-fin@example.com'),
  ('26000000-0000-0000-0000-0000000000a3', 'wqe-pm@example.com'),
  ('26000000-0000-0000-0000-0000000000a4', 'wqe-qi@example.com'),
  ('26000000-0000-0000-0000-0000000000a5', 'wqe-field@example.com'),
  ('26000000-0000-0000-0000-0000000000b1', 'wqe-b-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, built_in_role, status) values
  ('26000000-0000-0000-0000-0000000000a1', '26000000-0000-0000-0000-000000000001', 'WQE Admin', 'wqe-admin@example.com', 'Admin', 'administrator', 'active'),
  ('26000000-0000-0000-0000-0000000000a2', '26000000-0000-0000-0000-000000000001', 'WQE Finance', 'wqe-fin@example.com', 'Finance', 'finance_officer', 'active'),
  ('26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001', 'WQE PM', 'wqe-pm@example.com', 'Project Manager', 'project_manager', 'active'),
  ('26000000-0000-0000-0000-0000000000a4', '26000000-0000-0000-0000-000000000001', 'WQE QI', 'wqe-qi@example.com', 'Engineer', 'quality_inspector', 'active'),
  ('26000000-0000-0000-0000-0000000000a5', '26000000-0000-0000-0000-000000000001', 'WQE Field', 'wqe-field@example.com', 'Engineer', 'foreman', 'active'),
  ('26000000-0000-0000-0000-0000000000b1', '26000000-0000-0000-0000-000000000002', 'WQE B Admin', 'wqe-b-admin@example.com', 'Admin', 'administrator', 'active');

insert into companies (id, org_id, name, type) values
  ('26000000-0000-0000-0000-0000000000f1', '26000000-0000-0000-0000-000000000001', 'WQE Client', 'Client');

insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id, currency, subject_to_vat) values
  ('26000000-0000-0000-0000-0000000000c1', '26000000-0000-0000-0000-000000000001', 'WQE Project', 'Ongoing Project', 1000000, 'exclusive', 0,
   '26000000-0000-0000-0000-0000000000f1', '26000000-0000-0000-0000-0000000000a3', 'IDR', false);

insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26000000-0000-0000-0000-0000000000e1', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'QC-01', 'Piping weld', 'm', 100, 1000);

insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, currency, issued_at, tax_treatment, tax_amount) values
  ('26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'WO-WQE-1', 'Work order 1', 'Issued', 50000, 'IDR', now(), 'exclusive', 0),
  ('26000000-0000-0000-0000-000000000012', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'WO-WQE-2', 'Work order 2', 'Issued', 50000, 'IDR', now(), 'exclusive', 0);

insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-0000000000e1', 50),
  ('26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000012', '26000000-0000-0000-0000-0000000000e1', 50);

-- Quality step + required slot on WO 1, and a quality step with no slots on WO 2.
insert into work_order_billing_steps (id, org_id, work_order_id, project_id, position, name, owner_role_key, started_on) values
  ('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-0000000000c1', 1, 'Quality evidence', 'quality_inspector', current_date),
  ('26000000-0000-0000-0000-000000000022', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000012', '26000000-0000-0000-0000-0000000000c1', 1, 'Quality evidence', 'quality_inspector', current_date);

insert into work_order_billing_step_documents (id, org_id, step_id, work_order_id, position, name, required) values
  ('26000000-0000-0000-0000-000000000031', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000011', 1, 'QC Report', true);

insert into project_documents (id, org_id, project_id, category, title, status, revision, author_id, file_path) values
  ('26000000-0000-0000-0000-00000000d001', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'QC Report Rev A', 'Approved', 'A',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d001/qc-a.pdf'),
  ('26000000-0000-0000-0000-00000000d002', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'QC Report Rev B', 'Approved', 'B',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d002/qc-b.pdf'),
  ('26000000-0000-0000-0000-00000000d003', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'Extra QC Doc Rev A', 'Approved', 'A',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d003/extra-a.pdf'),
  ('26000000-0000-0000-0000-00000000d004', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'Extra QC Doc Rev B', 'Issued', 'B',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d004/extra-b.pdf');

update project_documents set parent_document_id = '26000000-0000-0000-0000-00000000d003'
 where id = '26000000-0000-0000-0000-00000000d004';

-- ── AC-WQE-004: default and Admin-only step designation ──────────────────────────────────────
select is((select claim_evidence_enabled from work_order_billing_steps where id = '26000000-0000-0000-0000-000000000021'), false,
  'AC-WQE-004 work-order step is unmarked by default');
select is(has_function_privilege('anon', 'public.set_work_order_step_claim_evidence(uuid,boolean)', 'execute'), false,
  'AC-WQE-004 anon cannot mark a step');
select is(has_function_privilege('authenticated', 'public.copy_work_order_evidence_to_claim(uuid,uuid)', 'execute'), false,
  'AC-WQE-004 authenticated cannot call the internal copy helper');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',false)$q$), '42501 WBS_EVIDENCE_MARK',
  'AC-WQE-004 Finance cannot change a mark');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',false)$q$), '42501 WBS_EVIDENCE_MARK',
  'AC-WQE-004 Quality Inspector cannot change a mark');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',false)$q$), '42501 LIGHT_ACCOUNT',
  'AC-WQE-004 field account is refused');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',null)$q$), '22023 WBS_EVIDENCE_MARK',
  'AC-WQE-004 null is refused');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',true)$q$), 'P0002 WBS_NOT_FOUND',
  'AC-WQE-004 another organisation cannot mark the step');
reset role;
select is((select claim_evidence_enabled from work_order_billing_steps where id = '26000000-0000-0000-0000-000000000021'), false,
  'AC-WQE-004 another organisation leaves the step unmarked');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- Fixture setup is direct so the attachment must acquire its own billing lock;
-- Admin's guarded marking is proved independently in 2601.
reset role;
update public.work_order_billing_steps set claim_evidence_enabled=true
 where id in ('26000000-0000-0000-0000-000000000021','26000000-0000-0000-0000-000000000022');
set local role authenticated;

-- ── AC-WQE-001: QI files once on WO 1 -> Claim 1 and Claim 2 both get it & pass evidence gate ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000031', '26000000-0000-0000-0000-00000000d001') $$,
  'AC-WQE-001 Quality Inspector attaches rev A once to WO 1 quality step');

reset role;
select is((select acquired from dblink('wqe_race', $$select pg_try_advisory_xact_lock(hashtextextended('work_order_billing:26000000-0000-0000-0000-000000000011', 0))$$) as t(acquired boolean)), false,
  'AC-WQE-001 attachment excludes concurrent work-order billing until its evidence is linked');
set local role authenticated;                                                    -- 10

set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('wqe.c1', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000011',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":10}]'::jsonb)::text, true);
  perform set_config('wqe.c2', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000011',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":10}]'::jsonb)::text, true);
end $$;

select is((select document_id::text || '/' || document_status || '/' || document_revision || '/' || attached_by::text
             from progress_claim_evidence where claim_id = current_setting('wqe.c1')::uuid),
  '26000000-0000-0000-0000-00000000d001/Approved/A/26000000-0000-0000-0000-0000000000a4',
  'AC-WQE-001 Claim 1 automatically inherits rev A filed by QI');                                                                -- 11

select is((select document_id::text || '/' || document_status || '/' || document_revision || '/' || attached_by::text
             from progress_claim_evidence where claim_id = current_setting('wqe.c2')::uuid),
  '26000000-0000-0000-0000-00000000d001/Approved/A/26000000-0000-0000-0000-0000000000a4',
  'AC-WQE-001 Claim 2 automatically inherits rev A without re-upload');                                                        -- 12

select lives_ok($$ select public.create_native_progress_claim_invoice(current_setting('wqe.c1')::uuid) $$,
  'AC-WQE-001 Claim 1 satisfies the invoice evidence gate automatically');                                                     -- 13
select lives_ok($$ select public.create_native_progress_claim_invoice(current_setting('wqe.c2')::uuid) $$,
  'AC-WQE-001 Claim 2 satisfies the invoice evidence gate automatically');                                                     -- 14

-- An earlier claim without an invoice must keep its own snapshot too.
do $$ begin
  perform set_config('wqe.c_open', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000011',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
end $$;

-- ── AC-WQE-003a: Replacing slot doc (rev A -> rev B) keeps Claim 1 & 2 pointing at rev A; Claim 3 gets rev B ───────────────
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000031', '26000000-0000-0000-0000-00000000d002') $$,
  'AC-WQE-003 QI replaces slot document with rev B');                                                                          -- 15

set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('wqe.c3', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000011',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
end $$;

select is((select string_agg(document_id::text || ':' || document_revision, ',' order by document_id)
             from progress_claim_evidence where claim_id = current_setting('wqe.c1')::uuid),
  '26000000-0000-0000-0000-00000000d001:A',
  'AC-WQE-003 Claim 1 still points only at rev A it was submitted with');                                                      -- 16

select is((select string_agg(document_id::text || ':' || document_revision, ',' order by document_id)
             from progress_claim_evidence where claim_id = current_setting('wqe.c_open')::uuid),
  '26000000-0000-0000-0000-00000000d001:A',
  'AC-WQE-003 replacement leaves an earlier open claim with its original evidence');

select is((select string_agg(document_id::text || ':' || document_revision, ',' order by document_id)
             from progress_claim_evidence where claim_id = current_setting('wqe.c3')::uuid),
  '26000000-0000-0000-0000-00000000d002:B',
  'AC-WQE-003 Claim 3 created after replacement points at rev B');                                                             -- 17

-- ── AC-WQE-002 & AC-WQE-003b: Open claim populated on WO attach; withdrawn ignored; superseded doc not copied to later claim ─
do $$ begin
  perform set_config('wqe.w2_open', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000012',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
  perform set_config('wqe.w2_wd', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000012',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
  perform public.withdraw_progress_claim(current_setting('wqe.w2_wd')::uuid);
end $$;

select is((select count(*)::int from progress_claim_evidence where claim_id = current_setting('wqe.w2_open')::uuid), 0,
  'AC-WQE-002 WO 2 open claim starts with no evidence');                                                                       -- 18

set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000022', null, '26000000-0000-0000-0000-00000000d003') $$,
  'AC-WQE-002 QI attaches extra doc rev A to WO 2');                                                                           -- 19

set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from progress_claim_evidence where claim_id = current_setting('wqe.w2_open')::uuid and document_id = '26000000-0000-0000-0000-00000000d003'), 1,
  'AC-WQE-002 open claim on WO 2 automatically receives the attached doc');                                                    -- 20
select is((select count(*)::int from progress_claim_evidence where claim_id = current_setting('wqe.w2_wd')::uuid), 0,
  'AC-WQE-002 withdrawn claim on WO 2 does not receive the attached doc');                                                     -- 21

-- Invoice WO 2 open claim, then supersede d003 by approving d004, attach d004 to WO 2, create next claim
select lives_ok($$ select public.create_native_progress_claim_invoice(current_setting('wqe.w2_open')::uuid) $$,
  'AC-WQE-002 open claim on WO 2 raises invoice with inherited evidence');                                                     -- 22
select lives_ok($$ select public.transition_document_status('26000000-0000-0000-0000-00000000d004', 'Approved') $$,
  'AC-WQE-003 approving rev B supersedes rev A');                                                                              -- 23

set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000022', null, '26000000-0000-0000-0000-00000000d004') $$,
  'AC-WQE-003 QI attaches rev B to WO 2');                                                                                     -- 24

set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('wqe.w2_next', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000012',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
end $$;

select is((select string_agg(document_id::text || ':' || document_status::text, ',' order by document_id)
             from progress_claim_evidence where claim_id = current_setting('wqe.w2_open')::uuid),
  '26000000-0000-0000-0000-00000000d003:Approved',
  'AC-WQE-003 invoiced claim keeps only superseded rev A as Approved snapshot');                                               -- 25

select is((select string_agg(document_id::text || ':' || document_revision, ',' order by document_id)
             from progress_claim_evidence where claim_id = current_setting('wqe.w2_next')::uuid),
  '26000000-0000-0000-0000-00000000d004:B',
  'AC-WQE-003 later claim gets rev B and skips Superseded rev A');                                                             -- 26

-- ── AC-WQE-004: Switching off stops automatic reuse ────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',false);
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('wqe.c_off', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1', 'progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000011',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
end $$;
select is((select count(*)::int from progress_claim_evidence where claim_id = current_setting('wqe.c_off')::uuid), 0,
  'AC-WQE-004 when the step is unmarked, a new claim does not auto-copy work-order evidence');                                           -- 27

select dblink_disconnect('wqe_race');
select * from finish();
rollback;
