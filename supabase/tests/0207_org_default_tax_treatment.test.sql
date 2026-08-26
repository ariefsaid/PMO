-- 0207_org_default_tax_treatment.test.sql — the org-wide tax default (#548, OD-TAX-1).
-- Migration under test: supabase/migrations/0207_org_default_tax_treatment.sql.
--
-- ⚑ THE ORACLE THAT MATTERS IS AC-TAX-206. Everything else here is shape. The one thing this
-- column must never do is get consulted at READ time: flipping the org default must not
-- re-interpret a single stored row, because a money figure whose inclusive/exclusive status is
-- re-derived from a CURRENT setting is a figure that silently changes meaning every time an admin
-- edits a preference (#478 — unrecoverable after the fact).
-- ================================================================================================
begin;
select plan(11);

insert into organizations (id, name) values
  ('00d60000-0000-0000-0000-000000000001','TAX Org A'),
  ('00d60000-0000-0000-0000-000000000002','TAX Org B');
insert into auth.users (id, email) values
  ('00d60000-0000-0000-0000-0000000000a1','tax-admin@example.com'),
  ('00d60000-0000-0000-0000-0000000000f1','tax-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00d60000-0000-0000-0000-0000000000a1','00d60000-0000-0000-0000-000000000001','Tax Admin','tax-admin@example.com','Admin','active'),
  ('00d60000-0000-0000-0000-0000000000f1','00d60000-0000-0000-0000-000000000001','Tax PM','tax-pm@example.com','Project Manager','active');

insert into projects (id, org_id, code, name, status, contract_value, tax_treatment, tax_amount)
values ('00d60000-0000-0000-0000-000000000010','00d60000-0000-0000-0000-000000000001','TAX-P','Stored Exclusive','Ongoing Project',1000000,'exclusive',110000);

select has_column('public','organizations','default_tax_treatment',
  'AC-TAX-201 organizations.default_tax_treatment exists');

select is((select default_tax_treatment from organizations where id='00d60000-0000-0000-0000-000000000001'),
  'exclusive',
  'AC-TAX-202 it seeds ''exclusive'' — the common Indonesian B2B quoting shape, so an inclusive government contract is a visible choice');

select throws_ok($$
  update organizations set default_tax_treatment = 'sometimes'
   where id = '00d60000-0000-0000-0000-000000000001'
$$, '23514', null,
  'AC-TAX-203 the CHECK admits only the two-value domain, verbatim from the money tables'' own CHECK');

-- ── the write path: Admin only, and the column only ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00d60000-0000-0000-0000-0000000000f1","role":"authenticated"}';
with u as (
  update organizations set default_tax_treatment = 'inclusive'
   where id = '00d60000-0000-0000-0000-000000000001' returning 1)
select is((select count(*)::int from u), 0,
  'AC-TAX-204 a PM cannot flip the org tax posture — it is accounting configuration (0137''s precedent)');

set local request.jwt.claims = '{"sub":"00d60000-0000-0000-0000-0000000000a1","role":"authenticated"}';
with u as (
  update organizations set default_tax_treatment = 'inclusive'
   where id = '00d60000-0000-0000-0000-000000000001' returning 1)
select is((select count(*)::int from u), 1,
  'AC-TAX-205 an Admin can');

-- ⚑ THE LOAD-BEARING ONE. A project stored EXCLUSIVE stays exclusive after the org default flips
-- to inclusive. If this ever fails, every historical money figure in the org has silently changed
-- meaning — which is the failure #478 says cannot be undone.
update organizations set default_tax_treatment = 'inclusive' where id='00d60000-0000-0000-0000-000000000001';
select is((select tax_treatment from projects where id='00d60000-0000-0000-0000-000000000010'),
  'exclusive',
  'AC-TAX-206 ⛔ flipping the org default does NOT re-interpret a stored row — pre-selects only, never read at display time');

-- ── the column-grant half of "this policy permits only this column" ────────────────────────────
-- A HARD 42501, not a 0-row no-op: `name` carries no column grant at all, so the refusal fires at
-- the PRIVILEGE layer before RLS is consulted. Stronger than the policy alone, and worth asserting
-- as what it is — the grant is the control here, the policy only narrows who reaches it.
select throws_ok($$
  update organizations set name = 'Renamed by Admin'
   where id = '00d60000-0000-0000-0000-000000000001'
$$, '42501', null,
  'AC-TAX-207 …and the same Admin cannot rename the org through it — the grant is column-scoped');

-- ⚑ The columns that would actually MATTER if the scoping failed — `name` was the narrowest
-- possible probe (security review Low). `default_currency` re-denominates every org-level
-- aggregate; `lifecycle_state` is terminal and gates the destructive-write guard.
select throws_ok($$
  update organizations set default_currency = 'USD'
   where id = '00d60000-0000-0000-0000-000000000001'
$$, '42501', null,
  'AC-TAX-209 …nor default_currency — the column that would re-denominate every aggregate');

select throws_ok($$
  update organizations set lifecycle_state = 'demo'
   where id = '00d60000-0000-0000-0000-000000000001'
$$, '42501', null,
  'AC-TAX-210 …nor lifecycle_state — terminal, and what the destructive-write guard reads');

-- The flip is attributable: who, when, from what, to what (security review Medium).
select is(
  (select count(*)::int from audit_events
    where action = 'org.tax_default.change'
      and entity_id = '00d60000-0000-0000-0000-000000000001'
      and detail->>'from' = 'exclusive' and detail->>'to' = 'inclusive'),
  1,
  'AC-TAX-211 flipping the org tax posture writes an audit row naming both sides — a money-steering config write must be attributable');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='organizations'
      and grantee='authenticated' and privilege_type='UPDATE'),
  0,
  'AC-TAX-208 no TABLE-level UPDATE grant exists — without that, the column grant above would be a silent no-op (2026-07-30)');

select * from finish();
rollback;
