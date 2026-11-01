-- imprest_floats.test.sql — #1515 site imprest S1: establishing a float, custodian eligibility, the org procurement
-- limit and float-amount changes. AC-IMP-001, AC-IMP-002 (spec docs/specs/site-imprest.spec.md; plan S1.1/S1.7).
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15150000-0000-0000-0000-00000000000a', 'IMP Org',       'IDR', 'Asia/Jakarta'),
  ('15150000-0000-0000-0000-00000000000b', 'IMP Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15150000-0000-0000-0000-0000000000a1', 'imp-admin@example.com'),
  ('15150000-0000-0000-0000-0000000000a2', 'imp-fin1@example.com'),   -- Finance, custodian of float F (project P1)
  ('15150000-0000-0000-0000-0000000000a3', 'imp-fin2@example.com'),   -- Finance, not a custodian
  ('15150000-0000-0000-0000-0000000000a4', 'imp-pm1@example.com'),    -- PM, manages P1
  ('15150000-0000-0000-0000-0000000000a5', 'imp-pm2@example.com'),    -- PM, manages P2; custodian of float G
  ('15150000-0000-0000-0000-0000000000a6', 'imp-eng1@example.com'),   -- Engineer, claimant
  ('15150000-0000-0000-0000-0000000000a7', 'imp-exec@example.com'),   -- Executive, senior approver
  ('15150000-0000-0000-0000-0000000000b1', 'imp-xorg@example.com');   -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15150000-0000-0000-0000-0000000000a1', '15150000-0000-0000-0000-00000000000a', 'IMP Admin', 'imp-admin@example.com', 'Admin', 'active'),
  ('15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-00000000000a', 'IMP Fin1',  'imp-fin1@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a3', '15150000-0000-0000-0000-00000000000a', 'IMP Fin2',  'imp-fin2@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a4', '15150000-0000-0000-0000-00000000000a', 'IMP PM1',   'imp-pm1@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-00000000000a', 'IMP PM2',   'imp-pm2@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a6', '15150000-0000-0000-0000-00000000000a', 'IMP Eng1',  'imp-eng1@example.com',  'Engineer', 'active'),
  ('15150000-0000-0000-0000-0000000000a7', '15150000-0000-0000-0000-00000000000a', 'IMP Exec',  'imp-exec@example.com',  'Executive', 'active'),
  ('15150000-0000-0000-0000-0000000000b1', '15150000-0000-0000-0000-00000000000b', 'IMP XOrg',  'imp-xorg@example.com',  'Admin', 'active');
-- P1 managed by PM1 (float F), P2 managed by PM2 (float G), P3 managed by PM1 (no float; establishment tests)
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-00000000000a', 'IMP Site One',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-0000000000c2', '15150000-0000-0000-0000-00000000000a', 'IMP Site Two',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a5'),
  ('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-00000000000a', 'IMP Site Three', 'Ongoing Project', '15150000-0000-0000-0000-0000000000a4');
-- senior approver set: the Executive only (PQ-5 route 'org')
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15150000-0000-0000-0000-00000000000a', null, '15150000-0000-0000-0000-0000000000a7');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15150000-0000-0000-0000-00000000000a', 2000000, '15150000-0000-0000-0000-0000000000a1');
-- Float F: P1, custodian Fin1, 10,000,000. Float G: P2, custodian PM2 (the project's own PM), 5,000,000.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1'),
  ('15150000-0000-0000-0000-0000000000d2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c2',
   '15150000-0000-0000-0000-0000000000a5', 5000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');

-- helper: act as a member (jwt claims are transaction-local)
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- extensions for this file (superuser): F's first funding (PQ-2), an other-org project and Finance member, an inactive
-- Finance member, and a project managed by an Engineer (each isolates one clause of imprest_custodian_eligible).
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15150000-0000-0000-0000-0000000000e1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'funding', 'REP-2611010001', 'Paid', 10000000, '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
insert into auth.users (id, email) values
  ('15150000-0000-0000-0000-0000000000a8', 'imp-fin-off@example.com'),
  ('15150000-0000-0000-0000-0000000000b2', 'imp-xfin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15150000-0000-0000-0000-0000000000a8', '15150000-0000-0000-0000-00000000000a', 'IMP FinOff', 'imp-fin-off@example.com', 'Finance', 'disabled'),
  ('15150000-0000-0000-0000-0000000000b2', '15150000-0000-0000-0000-00000000000b', 'IMP XFin',   'imp-xfin@example.com',    'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15150000-0000-0000-0000-0000000000c4', '15150000-0000-0000-0000-00000000000a', 'IMP Site Four', 'Ongoing Project', '15150000-0000-0000-0000-0000000000a6'),
  ('15150000-0000-0000-0000-0000000000c9', '15150000-0000-0000-0000-00000000000b', 'IMP Other Site', 'Ongoing Project', null);

-- ── S1.1 AC-IMP-001 establishment and custodian eligibility ────────────────────────────────────────────────────
delete from org_imprest_settings where org_id = '15150000-0000-0000-0000-00000000000a';  -- still superuser
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_like($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a3', 10000000) $$,
  '%procurement limit%', 'AC-IMP-001 no procurement limit: establishing a float is refused naming the limit');
select lives_ok($$ select set_imprest_procurement_limit(2000000) $$, 'AC-IMP-001 an Admin sets the procurement limit');
select isnt((select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a3', 10000000)), null,
  'AC-IMP-001 a Finance custodian: the float is established');
select is((select org_id from imprest_floats where project_id = '15150000-0000-0000-0000-0000000000c3'
             and custodian_id = '15150000-0000-0000-0000-0000000000a3'),
  '15150000-0000-0000-0000-00000000000a'::uuid, 'AC-IMP-001 org_id is stamped from the caller');
select is((select float_amount from imprest_floats where project_id = '15150000-0000-0000-0000-0000000000c3'
             and custodian_id = '15150000-0000-0000-0000-0000000000a3'), 0::numeric,
  'AC-IMP-001 the amount is 0 until its first change is approved (FR-IMP-002)');
select isnt((select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a4', 5000000)), null,
  'AC-IMP-001 OQ-IMP-2: the project''s own PM may be the custodian');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a5', 5000000) $$,
  '23514', null, 'AC-IMP-001 OQ-IMP-2: a PM who does not manage the project cannot be its custodian');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a6', 5000000) $$,
  '23514', null, 'AC-IMP-001 an Engineer cannot be a custodian');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a2', 5000000) $$,
  '42501', null, 'AC-IMP-001 only Admin or Finance establishes a float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ select set_imprest_procurement_limit(1) $$, '42501', null, 'AC-IMP-001 only an Admin sets the limit');
-- eligibility clauses, one each (OQ-IMP-2 / DD-IMP-7.5)
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a8', 5000000) $$,
  '23514', null, 'AC-IMP-001 an inactive Finance member cannot be a custodian');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000b2', 5000000) $$,
  '23514', null, 'AC-IMP-001 another org''s Finance member cannot be a custodian');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c4', '15150000-0000-0000-0000-0000000000a6', 5000000) $$,
  '23514', null, 'AC-IMP-001 managing the project without approval rank is not enough');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c9', '15150000-0000-0000-0000-0000000000a3', 5000000) $$,
  'P0002', null, 'AC-IMP-001 another org''s project is not found');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-0000000000a3', 5000000) $$,
  '42501', null, 'AC-IMP-001 an Engineer cannot establish a float');

-- ── S1.7 AC-IMP-002 float-amount SoD ───────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');  -- Admin establishes; its change row is proposed by Admin
select establish_imprest_float('15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-0000000000a3', 10000000);
select throws_like($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c join imprest_floats f on f.id = c.float_id
      where f.project_id = '15150000-0000-0000-0000-0000000000c1' and f.custodian_id = '15150000-0000-0000-0000-0000000000a3'
        and c.status = 'Proposed'), true) $$,
  '%separation of duties%', 'AC-IMP-002 the proposer cannot approve their own float amount');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');  -- a PM is not in the senior set
select throws_ok($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c join imprest_floats f on f.id = c.float_id
      where f.project_id = '15150000-0000-0000-0000-0000000000c1' and f.custodian_id = '15150000-0000-0000-0000-0000000000a3'
        and c.status = 'Proposed'), true) $$,
  '42501', null, 'AC-IMP-002 a non-senior approver cannot decide a float amount');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');  -- the Executive is the senior set
select lives_ok($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c join imprest_floats f on f.id = c.float_id
      where f.project_id = '15150000-0000-0000-0000-0000000000c1' and f.custodian_id = '15150000-0000-0000-0000-0000000000a3'
        and c.status = 'Proposed'), true) $$,
  'AC-IMP-002 a different senior approver approves');
select is((select float_amount from imprest_floats where project_id = '15150000-0000-0000-0000-0000000000c1'
             and custodian_id = '15150000-0000-0000-0000-0000000000a3'), 10000000::numeric, 'AC-IMP-002 the float amount is set only by the approved change');
-- PQ-2 and the propose/decide gates on float F (funded 10,000,000 above)
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select throws_like($$ select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d1', 5000000) $$,
  '%wind-down%', 'AC-IMP-002 PQ-2: a float cannot be lowered below the cash already funded');
select isnt((select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d1', 12000000)), null,
  'AC-IMP-002 Finance proposes a higher float amount');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_ok($$ select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d1', 12000000) $$,
  '42501', null, 'AC-IMP-002 only Admin or Finance proposes a float amount');
-- the other org cannot see the change, so stash its real id first: the RPC's own org check must refuse it
select set_config('imp.change_f', (select c.id::text from imprest_float_changes c
  where c.float_id = '15150000-0000-0000-0000-0000000000d1' and c.status = 'Proposed'), true);
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select throws_ok($$ select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d1', 12000000) $$,
  'P0002', null, 'AC-IMP-002 another org cannot propose on this float');
select throws_ok($$ select decide_imprest_float_change(current_setting('imp.change_f')::uuid, true) $$,
  'P0002', null, 'AC-IMP-002 another org cannot decide this float change');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');  -- Admin, outside the senior set: break-glass
select lives_ok($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c where c.float_id = '15150000-0000-0000-0000-0000000000d1' and c.status = 'Proposed'), true) $$,
  'AC-IMP-002 an Admin outside the senior set decides by break-glass');
select is((select (a.detail->>'break_glass')::boolean from audit_events a
            where a.action = 'imprest_float_change.decided' and a.detail->>'float_id' = '15150000-0000-0000-0000-0000000000d1'),
  true, 'AC-IMP-002 the break-glass decision is marked in the audit trail');
-- a proposal that was valid when made but sits below the funded total when decided is refused at approval
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d2', 6000000);
reset role;
insert into imprest_replenishments (org_id, float_id, kind, number, status, amount, requested_by, paid_on)
values ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2', 'funding', 'REP-2611010003', 'Paid',
        7000000, '15150000-0000-0000-0000-0000000000a5', current_date);
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select throws_like($$ select decide_imprest_float_change(
    (select c.id from imprest_float_changes c where c.float_id = '15150000-0000-0000-0000-0000000000d2' and c.status = 'Proposed'), true) $$,
  '%wind-down%', 'AC-IMP-002 PQ-2: approving a change below the funded total is refused');

-- a second proposal while one is open is refused by name, not by the unique index (d2 still has its 6,000,000 open)
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select throws_ok($$ select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d2', 8000000) $$,
  'P0001', 'a float change is already awaiting a decision', 'AC-IMP-002 a second open proposal is refused by name');
-- DD-IMP-7.3: a custodian never decides their own float amount — not via the senior set, not via Admin break-glass.
-- Fin1 (custodian of F) joins the senior set; float H on a project the Admin manages has the Admin as custodian.
reset role;
insert into spend_approvers (org_id, project_id, profile_id) values ('15150000-0000-0000-0000-00000000000a', null, '15150000-0000-0000-0000-0000000000a2');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15150000-0000-0000-0000-0000000000c5', '15150000-0000-0000-0000-00000000000a', 'IMP Site Five', 'Ongoing Project', '15150000-0000-0000-0000-0000000000a1');
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d3', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c5', '15150000-0000-0000-0000-0000000000a1', 0, 'IDR', '15150000-0000-0000-0000-0000000000a3');
insert into imprest_float_changes (id, org_id, float_id, proposed_amount, proposed_by) values
  ('15150000-0000-0000-0000-0000000000f3', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d3', 4000000, '15150000-0000-0000-0000-0000000000a3');
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select set_config('imp.change_f2', (select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d1', 13000000))::text, true);
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select throws_like($$ select decide_imprest_float_change(current_setting('imp.change_f2')::uuid, true) $$,
  '%custodian cannot decide%', 'AC-IMP-002 a custodian in the senior set cannot approve their own float amount');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_like($$ select decide_imprest_float_change('15150000-0000-0000-0000-0000000000f3', true) $$,
  '%custodian cannot decide%', 'AC-IMP-002 an Admin custodian cannot approve their own float amount by break-glass');
-- an archived float takes no further amount acts; an archived project takes no new float
reset role;
update imprest_floats set archived_at = now() where id = '15150000-0000-0000-0000-0000000000d1';
update projects set archived_at = now() where id = '15150000-0000-0000-0000-0000000000c4';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select throws_ok($$ select decide_imprest_float_change(current_setting('imp.change_f2')::uuid, true) $$,
  'P0002', null, 'AC-IMP-002 a change on an archived float cannot be decided');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select throws_ok($$ select propose_imprest_float_amount('15150000-0000-0000-0000-0000000000d1', 14000000) $$,
  'P0002', null, 'AC-IMP-002 an archived float takes no new proposal');
select throws_ok($$ select establish_imprest_float('15150000-0000-0000-0000-0000000000c4', '15150000-0000-0000-0000-0000000000a3', 5000000) $$,
  'P0002', null, 'AC-IMP-001 an archived project takes no new float');

select * from finish();
rollback;
