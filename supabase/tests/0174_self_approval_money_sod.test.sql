-- 0174_self_approval_money_sod.test.sql — the 0181 money-SoD bypass, proven closed layer by layer.
-- Migration under test: supabase/migrations/0181_close_self_approval_money_sod.sql
--
-- THE EXPLOIT (reproduced end-to-end on this DB by the Director, before 0181). A Project Manager
-- with no manager is correctly refused at the win. After ONE profile edit —
--     update profiles set manager_id = '<pm_id>' where id = '<pm_id>';
-- — the SAME PM, alone, runs set_project_contract_value(project, 99000000) then transitions
-- Leads -> PQ Submitted -> Quotation Submitted -> 'Won, Pending KoM' and it SUCCEEDS:
--     status='Won, Pending KoM'  contract_value=99000000.00
-- A 99M deal booked with one signature. Root cause: may_approve_work_of(X, X) was TRUE whenever
-- X.manager_id = X.id (the line-management limb had no approver<>author guard), and transition_project's
-- win-gate asked "did an authority over the winner set the value?" without ever asking "was that
-- authority THE WINNER?".
--
-- 0181 closes it in THREE independent layers. Each is proven here on its own:
--   §2  profiles_manager_not_self CHECK        -> the enabling profile edit itself is a 23514
--   §1  may_approve_work_of self-guard         -> may_approve_work_of(X, X) is FALSE even when X
--                                                 managers itself (and for any X, in fact)
--   §3  transition_project self-authored win   -> a winner who set their OWN value is refused at the
--                                                 transition, independent of may_approve_work_of
--
-- ⚑ WHY THE CHECK IS DROPPED MID-TEST. The exploit REQUIRES a self-managing profile (manager_id =
--   id), and §2's CHECK now forbids that state for every writer. To prove §1 and §3 against the
--   EXACT exploit condition, the test artificially recreates that state by dropping the constraint
--   WITHIN this transaction (it rolls back). This is defence-in-depth testing: each layer is proven
--   against the bad state the other layer prevents. The CHECK itself is proven first (§A), while it
--   is still in force.
--
-- ⚑ NO SOURCE-TEXT ASSERTIONS. Every oracle is a persisted row read back as the table owner (RLS
--   off), or a real RPC executed under a real JWT. A denial is asserted by PERSISTED STATE, never by
--   errcode alone — except where the denial is a column/CHECK privilege 42501/23514 (those DO raise),
--   which is asserted with throws_ok on the errcode AND a value-unchanged read-back.

begin;
create extension if not exists pgtap;
select plan(17);

-- ── Fixtures (inserted as table owner, RLS bypassed) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('01740000-0000-0000-0000-000000000001','MSB Org');

insert into auth.users (id, email) values
  ('01740000-0000-0000-0000-0000000000a1','msb-pm-mgr@example.com'),
  ('01740000-0000-0000-0000-0000000000a2','msb-exec@example.com'),
  ('01740000-0000-0000-0000-0000000000a3','msb-pm-lone@example.com'),
  ('01740000-0000-0000-0000-0000000000a4','msb-finance@example.com'),
  ('01740000-0000-0000-0000-0000000000a5','msb-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status, manager_id) values
  ('01740000-0000-0000-0000-0000000000a1','01740000-0000-0000-0000-000000000001','MSB PM w/ Mgr','msb-pm-mgr@example.com','Project Manager','active','01740000-0000-0000-0000-0000000000a2'),
  ('01740000-0000-0000-0000-0000000000a2','01740000-0000-0000-0000-000000000001','MSB Exec','msb-exec@example.com','Executive','active',null),
  ('01740000-0000-0000-0000-0000000000a3','01740000-0000-0000-0000-000000000001','MSB PM Lone','msb-pm-lone@example.com','Project Manager','active',null),
  ('01740000-0000-0000-0000-0000000000a4','01740000-0000-0000-0000-000000000001','MSB Finance','msb-finance@example.com','Finance','active',null),
  ('01740000-0000-0000-0000-0000000000a5','01740000-0000-0000-0000-000000000001','MSB Admin','msb-admin@example.com','Admin','active',null);

-- Two pipeline deals, both one legal step from Won. b1 is the EXPLOIT target (the lone PM); b2 is
-- the POSITIVE-CONTROL target (the PM whose manager will witness the value).
insert into projects (id, org_id, name, status, contract_value) values
  ('01740000-0000-0000-0000-0000000000b1','01740000-0000-0000-0000-000000000001','MSB Exploit Deal','Quotation Submitted',0),
  ('01740000-0000-0000-0000-0000000000b2','01740000-0000-0000-0000-000000000001','MSB Legit Deal','Quotation Submitted',0);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §A — the CHECK (fix §2). The exploit's enabling step — `set manager_id = id` — is itself a 23514.
-- A CHECK constraint is enforced on EVERY writer (owner and superuser included); RLS never sees it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ update public.profiles set manager_id = id where id = '01740000-0000-0000-0000-0000000000a3' $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_manager_not_self"',
  'AC-MSB-001 the exploit''s enabling step (set manager_id = id) is refused by profiles_manager_not_self, whatever role issues it — the CHECK is the first layer');
select ok((select manager_id is null from public.profiles where id = '01740000-0000-0000-0000-0000000000a3'),
  'AC-MSB-002 the lone PM''s manager_id is still NULL — the refused self-management changed nothing');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §B — POSITIVE CONTROL. A genuine manager sets the value; the report (PM) wins. This MUST still
-- work — fixes §1 and §3 must not over-block the sanctioned line-management path. Run with the
-- CHECK in force (a normal manager_id, no self-management).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select public.may_approve_work_of('01740000-0000-0000-0000-0000000000a2','01740000-0000-0000-0000-0000000000a1')),
  true,
  'AC-MSB-010 a genuine line manager (Exec) MAY approve their report''s (PM) work — the line-management limb survives §1''s self-guard (the two ids are distinct)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01740000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01740000-0000-0000-0000-0000000000b2'::uuid, 5000000) $$,
  'AC-MSB-011 the line manager (Exec) sets the value on the report''s deal — witnessed as the manager');
set local request.jwt.claims = '{"sub":"01740000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_project('01740000-0000-0000-0000-0000000000b2'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-MSB-2', '2026-03-02'::date) $$,
  'AC-MSB-012 …and the report (PM) WINS it — a manager-witnessed win is not an over-block (MANDATORY control)');
reset role;
select is(
  (select status::text from public.projects where id = '01740000-0000-0000-0000-0000000000b2'),
  'Won, Pending KoM',
  'AC-MSB-013 the manager-witnessed win really landed — status is Won, contract_value is the witnessed figure');
select is(
  (select contract_value::text from public.projects where id = '01740000-0000-0000-0000-0000000000b2'),
  '5000000.00',
  'AC-MSB-013b …and the witnessed value persisted unchanged through the win');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §C — THE EXPLOIT, REFUSED AT THE TRANSITION. To reproduce the exact pre-0181 condition the CHECK
-- now prevents, drop it within this transaction and create the self-managing fixture. Then run the
-- full chain (PM sets own value -> PM wins) and assert the win is REFUSED and the deal does not move.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.profiles drop constraint if exists profiles_manager_not_self;
update public.profiles set manager_id = '01740000-0000-0000-0000-0000000000a3'
 where id = '01740000-0000-0000-0000-0000000000a3';
select ok((select manager_id = id from public.profiles where id = '01740000-0000-0000-0000-0000000000a3'),
  'AC-MSB-020 fixture: the lone PM is now self-managing (the pre-0181 exploit state, recreated by dropping the CHECK inside this transaction)');

-- §1 — may_approve_work_of(self, self) is FALSE even with manager_id = id.
select is(
  (select public.may_approve_work_of('01740000-0000-0000-0000-0000000000a3','01740000-0000-0000-0000-0000000000a3')),
  false,
  'AC-MSB-021 may_approve_work_of(X, X) is FALSE even when X.manager_id = X.id — §1''s self-guard closes the identity hole (at 0178 this returned TRUE)');

-- §3 — the full exploit chain, refused at the transition.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01740000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$ select set_project_contract_value('01740000-0000-0000-0000-0000000000b1'::uuid, 99000000) $$,
  'AC-MSB-022 the self-managing PM sets their OWN value (PM holds pipeline-value authority) — the witness trigger stamps v_set_by = the PM');
-- ⚑ pgTAP matches errmsg EXACTLY (verified), so this is the verbatim message from transition_project's money-SoD 'senior' branch.
-- The 'senior' branch fires (not the 'no recorded author' branch) because set_project_contract_value stamped a non-NULL witness.
select throws_ok(
  $$ select transition_project('01740000-0000-0000-0000-0000000000b1'::uuid,
       'Won, Pending KoM'::project_status, 'CPO-MSB-1', '2026-03-02'::date) $$,
  '42501', 'this deal''s contract value was not set by anyone senior to you, so you cannot win it: it must be confirmed by your supervisor or by someone who outranks you, through set_project_contract_value (which records who set it) — or ask them to win the deal',
  'AC-MSB-023 …and the SAME PM, alone, CANNOT win it — the self-authored win is refused at the transition (the 99M exploit, closed)');
reset role;
select is(
  (select status::text from public.projects where id = '01740000-0000-0000-0000-0000000000b1'),
  'Quotation Submitted',
  'AC-MSB-024 the exploit deal did NOT move to Won — status is unchanged (the goal-oracle: no 99M deal was booked)');
select is(
  (select contract_value::text from public.projects where id = '01740000-0000-0000-0000-0000000000b1'),
  '99000000.00',
  'AC-MSB-025 the refused transition left the set value untouched — it sits on a pipeline deal, not booked as revenue');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §D — self-approval is FALSE for EVERY profile, and NULL args fail closed. §1''s self-guard makes
-- may_approve_work_of(X, X) false regardless of the graph; the NULL cases must still coalesce false.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select public.may_approve_work_of('01740000-0000-0000-0000-0000000000a1','01740000-0000-0000-0000-0000000000a1')),
  false,
  'AC-MSB-030 may_approve_work_of(X, X) is FALSE for a normal profile too — self can never approve self, whatever manager_id is');
select is(
  (select public.may_approve_work_of('01740000-0000-0000-0000-0000000000a2','01740000-0000-0000-0000-0000000000a2')),
  false,
  'AC-MSB-031 …and for the Executive — rank does not let you approve yourself');
select is(
  (select public.may_approve_work_of(null,'01740000-0000-0000-0000-0000000000a1')),
  false,
  'AC-MSB-040 may_approve_work_of(NULL, X) fails closed — a NULL approver matches no profile (carried from 0171)');
select is(
  (select public.may_approve_work_of('01740000-0000-0000-0000-0000000000a1',null)),
  false,
  'AC-MSB-041 may_approve_work_of(X, NULL) fails closed — a NULL author matches no profile (carried from 0171)');

select * from finish();
rollback;
