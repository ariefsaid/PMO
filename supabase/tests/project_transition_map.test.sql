-- project_transition_map.test.sql — AC-1000 (re-homed from the deleted isLegalProjectTransition
-- TS helper, #1710). The transition map is ENFORCED by the shipped security-definer RPC
-- transition_project (0461 body, map literal carried verbatim from 0236), so its owning test is
-- pgTAP: legal pairs accepted (the move lands), illegal jumps / terminal exits / no-ops refused
-- with P0001 "illegal transition".
-- Mutation-check: edit 0461's v_legal map (e.g. drop 'Internal Project' from Leads, add 'Leads'
-- to 'Ongoing Project') and the matching cases here go red.
-- (FR-PR-001/003; win-path capture and the money SoD are owned by 0029/0177 — the win pair here
-- runs on a value-less project exactly like 0029 so only the MAP is under test.)
-- Isolated org; UUID prefix 17100000-… (issue #1710).
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name) values
  ('17100000-0000-0000-0000-000000000001','Project Map Org (1710)');

insert into auth.users (id, email) values
  ('17100000-0000-0000-0000-0000000000a1','pm-map1710@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('17100000-0000-0000-0000-0000000000a1','17100000-0000-0000-0000-000000000001',
   'PM Map 1710','pm-map1710@example.com','Project Manager');

-- One project per (from) leg of the map under test.
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('17100000-0000-0000-0000-000000000010','17100000-0000-0000-0000-000000000001','M10','Leads→PQ','Leads','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000011','17100000-0000-0000-0000-000000000001','M11','Neg→Won','Negotiation','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000012','17100000-0000-0000-0000-000000000001','M12','Tender→Loss','Tender Submitted','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000013','17100000-0000-0000-0000-000000000001','M13','WonKoM→Ongoing','Won, Pending KoM','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000014','17100000-0000-0000-0000-000000000001','M14','OnHold→Ongoing','On Hold','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000015','17100000-0000-0000-0000-000000000001','M15','CloseOut→Ongoing','Close Out','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000016','17100000-0000-0000-0000-000000000001','M16','Loss→Neg','Loss Tender','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000017','17100000-0000-0000-0000-000000000001','M17','Leads→Internal','Leads','17100000-0000-0000-0000-0000000000a1'),
  -- illegal / no-op legs
  ('17100000-0000-0000-0000-000000000018','17100000-0000-0000-0000-000000000001','M18','Leads jump','Leads','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000019','17100000-0000-0000-0000-000000000001','M19','Internal terminal','Internal Project','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000020','17100000-0000-0000-0000-000000000001','M20','Ongoing→Leads','Ongoing Project','17100000-0000-0000-0000-0000000000a1'),
  ('17100000-0000-0000-0000-000000000021','17100000-0000-0000-0000-000000000001','M21','No-op','Leads','17100000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"17100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── AC-1000: legal pairs are accepted ────────────────────────────────────────
select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000010','PQ Submitted') $$,
  'AC-1000: Leads → PQ Submitted is legal (FR-PR-001)');

-- The win leg runs on a value-less project (0029 shape): only the MAP leg is under test here.
select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000011','Won, Pending KoM','CPO-1710','2026-03-15') $$,
  'AC-1000: Negotiation → Won, Pending KoM is legal (FR-PR-001)');

-- 0461 (FR-LR-002): a lost deal must say why — the legal Loss Tender leg carries its reason.
select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000012','Loss Tender',null,null,'price',null) $$,
  'AC-1000: Tender Submitted → Loss Tender is legal (FR-PR-001)');

select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000013','Ongoing Project') $$,
  'AC-1000: Won, Pending KoM → Ongoing Project is legal (FR-PR-001)');

select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000014','Ongoing Project') $$,
  'AC-1000: On Hold → Ongoing Project is legal (FR-PR-003)');

select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000015','Ongoing Project') $$,
  'AC-1000: Close Out → Ongoing Project is legal (FR-PR-003)');

select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000016','Negotiation') $$,
  'AC-1000: Loss Tender → Negotiation is legal (FR-PR-003)');

select lives_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000017','Internal Project') $$,
  'AC-1000: Leads → Internal Project is legal (FR-PR-003)');

-- ── AC-1000: illegal jumps, terminal exits and no-ops are rejected ──────────
select throws_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000018','Won, Pending KoM','CPO-X','2026-03-15') $$,
  'P0001', null,
  'AC-1000: Leads → Won, Pending KoM (illegal jump) is rejected (FR-PR-003)');

select throws_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000019','Leads') $$,
  'P0001', null,
  'AC-1000: Internal Project → Leads (terminal) is rejected (FR-PR-003)');

select throws_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000020','Leads') $$,
  'P0001', null,
  'AC-1000: Ongoing Project → Leads (no on-hand → pipeline) is rejected (FR-PR-003)');

select throws_ok(
  $$ select transition_project('17100000-0000-0000-0000-000000000021','Leads') $$,
  'P0001', null,
  'AC-1000: Leads → Leads (no-op) is rejected (FR-PR-003)');

-- ── AC-1000: the eight legal legs actually LANDED in their target status ────
select is(
  (select count(*) from projects where
       (id = '17100000-0000-0000-0000-000000000010' and status::text = 'PQ Submitted') or
       (id = '17100000-0000-0000-0000-000000000011' and status::text = 'Won, Pending KoM') or
       (id = '17100000-0000-0000-0000-000000000012' and status::text = 'Loss Tender') or
       (id = '17100000-0000-0000-0000-000000000013' and status::text = 'Ongoing Project') or
       (id = '17100000-0000-0000-0000-000000000014' and status::text = 'Ongoing Project') or
       (id = '17100000-0000-0000-0000-000000000015' and status::text = 'Ongoing Project') or
       (id = '17100000-0000-0000-0000-000000000016' and status::text = 'Negotiation') or
       (id = '17100000-0000-0000-0000-000000000017' and status::text = 'Internal Project')),
  8::bigint,
  'AC-1000: every accepted legal pair landed in its target status (FR-PR-001/003)');

reset role;
select * from finish();
rollback;
