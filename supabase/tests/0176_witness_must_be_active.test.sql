-- 0176_witness_must_be_active.test.sql — the offboarded-witness money-SoD bypass, proven closed.
-- Migration under test: supabase/migrations/0183_transition_project_witness_must_be_active.sql
--
-- THE EXPLOIT (reproduced end-to-end on this DB by the Director, AFTER 0181). 0181 closed the
-- SELF-approval hole, but `may_approve_work_of`'s line-management limb is `(author.manager_id =
-- p_approver_id)` and never checks the APPROVER's current standing. So the money SoD's required
-- "second person" can be an OFFBOARDED account:
--   1. Manager D (active, PM) is W's `manager_id`. D calls set_project_contract_value(project,
--      77000000) — the witness trigger stamps contract_value_set_by = D.
--   2. D is offboarded (profiles.status='disabled').
--   3. W alone walks Leads -> PQ Submitted -> Quotation Submitted -> 'Won, Pending KoM'.
--   RESULT: Won, Pending KoM, contract_value 77,000,000 — booked on an OFFBOARDED witness. 0181 does
--   NOT cover this: D != W (self-backstop never fires) and may_approve_work_of(D, W) is TRUE (D is
--   W's manager_id), so the "senior" limb passes too.
--
-- 0183 closes it in the WIN-GATE ONLY: transition_project now additionally refuses when the value's
-- witness is not a CURRENTLY ACTIVE member, via the uuid overload public.is_active_member(p_user_id)
-- (0180) — which carries the WHOLE rule (profiles.status AND auth.users.banned_until). The refusal
-- message is its OWN, distinguishable from the existing "not set by anyone senior to you" text
-- (FR-AMG-004): an offboarded witness is a different diagnosis (the setter HAD authority but is no
-- longer active) and the operator must be able to tell them apart.
--
-- FOUR behaviours, each pinned by persisted state (a denial is the value/status UNCHANGED, never
-- errcode alone):
--   §A  the exploit — offboarded witness, PM winner -> REFUSED with the new message, deal does not move
--   §B  positive control — an ACTIVE manager witnesses -> the report still WINS (no over-block)
--   §C  banned witness — banned_until in the future (status still 'active') -> REFUSED (proves the
--       uuid overload carries 0095's banned_until check, the half a status-only lookup would miss)
--   §D  no over-block — a Finance winner WINS despite the offboarded witness (the check is inside the
--       `not holds_won_value_authority` guard, so an accountable winner needs nobody)

begin;
create extension if not exists pgtap;
select plan(19);

-- ── Fixtures (inserted as table owner, RLS bypassed) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('01760000-0000-0000-0000-000000000001','WMA Org');

insert into auth.users (id, email) values
  ('01760000-0000-0000-0000-0000000000d1','wma-d@example.com'),   -- manager/witness (§A,§B,§D)
  ('01760000-0000-0000-0000-0000000000a1','wma-w@example.com'),   -- PM winner (§A,§B)
  ('01760000-0000-0000-0000-0000000000e1','wma-m@example.com'),   -- manager/witness (§C banned)
  ('01760000-0000-0000-0000-0000000000c1','wma-wm@example.com'),  -- PM winner (§C)
  ('01760000-0000-0000-0000-0000000000f1','wma-f@example.com');   -- Finance winner (§D)

insert into profiles (id, org_id, full_name, email, role, status, manager_id) values
  ('01760000-0000-0000-0000-0000000000d1','01760000-0000-0000-0000-000000000001','WMA D','wma-d@example.com','Project Manager','active',null),
  ('01760000-0000-0000-0000-0000000000a1','01760000-0000-0000-0000-000000000001','WMA W','wma-w@example.com','Project Manager','active','01760000-0000-0000-0000-0000000000d1'),
  ('01760000-0000-0000-0000-0000000000e1','01760000-0000-0000-0000-000000000001','WMA M','wma-m@example.com','Project Manager','active',null),
  ('01760000-0000-0000-0000-0000000000c1','01760000-0000-0000-0000-000000000001','WMA Wc','wma-wm@example.com','Project Manager','active','01760000-0000-0000-0000-0000000000e1'),
  ('01760000-0000-0000-0000-0000000000f1','01760000-0000-0000-0000-000000000001','WMA F','wma-f@example.com','Finance','active',null);

-- b1 = the exploit deal (offboarded witness); b2 = positive control (active witness); b3 = banned
-- witness; b4 = no-over-block (Finance winner). b1 starts at Leads so the FULL exploit pipeline is
-- walked (faithful to the Director's reproduction); the others sit one legal step from Won.
insert into projects (id, org_id, name, status, contract_value) values
  ('01760000-0000-0000-0000-0000000000b1','01760000-0000-0000-0000-000000000001','WMA Exploit Deal','Leads',0),
  ('01760000-0000-0000-0000-0000000000b2','01760000-0000-0000-0000-000000000001','WMA Legit Deal','Quotation Submitted',0),
  ('01760000-0000-0000-0000-0000000000b3','01760000-0000-0000-0000-000000000001','WMA Banned-Witness Deal','Quotation Submitted',0),
  ('01760000-0000-0000-0000-0000000000b4','01760000-0000-0000-0000-000000000001','WMA Finance-Winner Deal','Quotation Submitted',0);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §B — POSITIVE CONTROL (run first, while D is still active). An ACTIVE manager witnesses the value
-- and the report wins. This MUST still work — 0183's new conjunct must not over-block the sanctioned
-- line-management path. (D is W's manager_id, so may_approve_work_of(D, W) is TRUE, and D is active,
-- so the witness-active conjunct passes too.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01760000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01760000-0000-0000-0000-0000000000b2'::uuid, 5000000) $$,
  'AC-WMA-010 the active manager (D) sets the value on the report''s deal — witnessed as the manager');
set local request.jwt.claims = '{"sub":"01760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01760000-0000-0000-0000-0000000000b2'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-WMA-2', '2026-03-02'::date) $$,
  'AC-WMA-011 …and the report (W) WINS it — an active-manager-witnessed win is not an over-block (MANDATORY control)');
reset role;
select is(
  (select status::text from public.projects where id = '01760000-0000-0000-0000-0000000000b2'),
  'Won, Pending KoM',
  'AC-WMA-012 the active-manager-witnessed win really landed — status is Won');
select is(
  (select contract_value::text from public.projects where id = '01760000-0000-0000-0000-0000000000b2'),
  '5000000.00',
  'AC-WMA-013 …and the witnessed value persisted unchanged through the win');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Witness setup for §A and §D (D still active here). b1 and b4 are witnessed by D while D is active;
-- §A then offboards D, and §D later lets a Finance winner win b4 despite that offboarded witness.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01760000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01760000-0000-0000-0000-0000000000b1'::uuid, 77000000) $$,
  'AC-WMA-020 the (still-active) manager D sets the value on the exploit deal — the witness trigger stamps v_set_by = D');
select lives_ok(
  $$ select set_project_contract_value('01760000-0000-0000-0000-0000000000b4'::uuid, 3000000) $$,
  'AC-WMA-021 the (still-active) manager D sets the value on the Finance-winner deal — witnessed for §D');
reset role;
select is(
  (select contract_value_set_by::text from public.projects where id = '01760000-0000-0000-0000-0000000000b1'),
  '01760000-0000-0000-0000-0000000000d1',
  'AC-WMA-022 fixture: the exploit deal''s witness really is D (the about-to-be-offboarded manager)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A — THE EXPLOIT, REFUSED. D is offboarded; W alone walks the full pipeline to Won. Before 0183
-- this SUCCEEDED (Won on an offboarded witness, 77M booked). Now it is REFUSED with the NEW message,
-- and the deal does not move.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.profiles set status = 'disabled' where id = '01760000-0000-0000-0000-0000000000d1';
select is(
  (select status::text from public.profiles where id = '01760000-0000-0000-0000-0000000000d1'),
  'disabled',
  'AC-WMA-030 fixture: the witness D is now offboarded (the pre-0183 exploit condition)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01760000-0000-0000-0000-0000000000b1'::uuid,'PQ Submitted'::project_status) $$,
  'AC-WMA-031 W walks the exploit deal Leads -> PQ Submitted (W is active, this stage is unaffected)');
select lives_ok(
  $$ select transition_project('01760000-0000-0000-0000-0000000000b1'::uuid,'Quotation Submitted'::project_status) $$,
  'AC-WMA-032 …PQ Submitted -> Quotation Submitted');
-- ⚑ pgTAP matches errmsg EXACTLY. This is 0183's NEW offboarded-witness message — deliberately
-- distinguishable from 0181's "not set by anyone senior to you" (FR-AMG-004): it fires because the
-- witness HAD authority (D is W's manager) but is no longer active, not because the witness lacks rank.
select throws_ok(
  $$ select transition_project('01760000-0000-0000-0000-0000000000b1'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-WMA-1', '2026-03-02'::date) $$,
  '42501', 'this deal''s contract value was set by someone who is no longer an active member of this organisation, so you cannot win it: the value must be re-set by your supervisor or by someone who outranks you who is currently active, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-WMA-033 …and W alone CANNOT win it — the offboarded-witness win is refused at the transition with the NEW message (the 77M exploit, closed)');
reset role;
select is(
  (select status::text from public.projects where id = '01760000-0000-0000-0000-0000000000b1'),
  'Quotation Submitted',
  'AC-WMA-034 the exploit deal did NOT move to Won — status is unchanged (the goal-oracle: no 77M deal was booked on an offboarded witness)');
select is(
  (select contract_value::text from public.projects where id = '01760000-0000-0000-0000-0000000000b1'),
  '77000000.00',
  'AC-WMA-035 the refused transition left the witnessed value untouched');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §C — BANNED WITNESS (banned_until in the future, status STILL 'active'). This proves 0183 used the
-- uuid overload (0180) and so carries 0095's banned_until check — the half a bare profiles.status
-- lookup would miss. The witness M is Wc's manager and is "active" by status, but banned by token, so
-- is_active_member(M) is FALSE and the win is refused with the SAME new message.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01760000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01760000-0000-0000-0000-0000000000b3'::uuid, 8000000) $$,
  'AC-WMA-040 the (still-active, not-yet-banned) manager M sets the value on the banned-witness deal');
reset role;
-- Ban M at the auth layer (out-of-band, the path admin_set_user_status does not own) while leaving
-- profiles.status='active', so a status-only check would pass.
update auth.users set banned_until = now() + interval '1 hour' where id = '01760000-0000-0000-0000-0000000000e1';
select is(
  (select (status='active') and (banned_until > now()) from public.profiles p join auth.users u on u.id=p.id where p.id='01760000-0000-0000-0000-0000000000e1'),
  true,
  'AC-WMA-041 fixture: M is status=active BUT banned_until is in the future (the gap a status-only check would miss)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01760000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok(
  $$ select transition_project('01760000-0000-0000-0000-0000000000b3'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-WMA-3', '2026-03-02'::date) $$,
  '42501', 'this deal''s contract value was set by someone who is no longer an active member of this organisation, so you cannot win it: the value must be re-set by your supervisor or by someone who outranks you who is currently active, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-WMA-042 …and Wc CANNOT win it — the banned witness is refused with the new message (banned_until is carried by the uuid overload, not just status)');
reset role;
select is(
  (select status::text from public.projects where id = '01760000-0000-0000-0000-0000000000b3'),
  'Quotation Submitted',
  'AC-WMA-043 the banned-witness deal did NOT move to Won — status is unchanged');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §D — NO OVER-BLOCK. b4's witness is D (offboarded in §A), but the winner is Finance, which HOLDS
-- won-value authority — so the whole refusal block is skipped and the win SUCCEEDS. Proves 0183's new
-- conjunct sits inside the `not holds_won_value_authority` guard and does not gate an accountable
-- winner (ADR-0019 §1: a Finance/Executive/Admin winner needs nobody).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01760000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01760000-0000-0000-0000-0000000000b4'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-WMA-4', '2026-03-02'::date) $$,
  'AC-WMA-050 a Finance winner WINS despite the offboarded witness — the check is inside the won-authority guard (no over-block)');
reset role;
select is(
  (select status::text from public.projects where id = '01760000-0000-0000-0000-0000000000b4'),
  'Won, Pending KoM',
  'AC-WMA-051 the Finance-winner deal really landed — status is Won (an accountable winner is not gated by the witness)');

select * from finish();
rollback;
