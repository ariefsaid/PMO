-- 0111_agent_automation_bounds.test.sql
-- AUDIT-M1 (2026-07-04 seven-dimension audit) — automation cost-amplification bounds.
-- Migration 0059: prompt ≤ 4000 chars, timeout_s in [10,900], max 25 active automations per owner.
--
-- Proofs:
--   1. A >4000-char prompt is DENIED (23514).
--   2. timeout_s below the floor (5) is DENIED (23514).
--   3. timeout_s above the ceiling (901) is DENIED (23514).
--   4. 25 active automations insert cleanly; the 26th is DENIED (P0001 owner cap).
--   5. Archived automations do NOT count toward the cap (archive one => insert succeeds).
begin;
select plan(5);

insert into organizations (id, name) values
  ('01110000-0000-0000-0000-000000000001','Automation Bounds Org');

insert into auth.users (id, email) values
  ('01110000-0000-0000-0000-0000000000a1','auto-cap@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01110000-0000-0000-0000-0000000000a1','01110000-0000-0000-0000-000000000001','Auto Cap','auto-cap@example.com','Project Manager');

-- 1. Prompt bomb.
select throws_ok(
  $$insert into agent_automations (org_id, owner_id, kind, prompt, schedule)
    values ('01110000-0000-0000-0000-000000000001','01110000-0000-0000-0000-0000000000a1',
            'schedule', repeat('x', 4001), '0 9 * * *')$$,
  '23514',
  null,
  'AUDIT-M1: >4000-char automation prompt is rejected');

-- 2/3. timeout_s bounds.
select throws_ok(
  $$insert into agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
    values ('01110000-0000-0000-0000-000000000001','01110000-0000-0000-0000-0000000000a1',
            'schedule', 'p', '0 9 * * *', 5)$$,
  '23514',
  null,
  'AUDIT-M1: timeout_s below 10 is rejected');

select throws_ok(
  $$insert into agent_automations (org_id, owner_id, kind, prompt, schedule, timeout_s)
    values ('01110000-0000-0000-0000-000000000001','01110000-0000-0000-0000-0000000000a1',
            'schedule', 'p', '0 9 * * *', 901)$$,
  '23514',
  null,
  'AUDIT-M1: timeout_s above 900 is rejected');

-- 4. 25 active automations fill the cap; the 26th trips it.
insert into agent_automations (org_id, owner_id, kind, prompt, schedule)
select '01110000-0000-0000-0000-000000000001','01110000-0000-0000-0000-0000000000a1',
       'schedule', 'p' || i, '0 9 * * *'
from generate_series(1, 25) as i;

select throws_ok(
  $$insert into agent_automations (org_id, owner_id, kind, prompt, schedule)
    values ('01110000-0000-0000-0000-000000000001','01110000-0000-0000-0000-0000000000a1',
            'schedule', 'over-cap', '0 9 * * *')$$,
  'P0001',
  null,
  'AUDIT-M1: the 26th active automation for one owner is rejected');

-- 5. Archiving frees a slot (cap counts ACTIVE only).
update agent_automations set archived_at = now()
 where owner_id = '01110000-0000-0000-0000-0000000000a1' and prompt = 'p1';

select lives_ok(
  $$insert into agent_automations (org_id, owner_id, kind, prompt, schedule)
    values ('01110000-0000-0000-0000-000000000001','01110000-0000-0000-0000-0000000000a1',
            'schedule', 'after-archive', '0 9 * * *')$$,
  'AUDIT-M1: archived automations do not count toward the owner cap');

select * from finish();
rollback;
