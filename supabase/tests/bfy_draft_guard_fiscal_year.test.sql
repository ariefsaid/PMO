-- bfy_draft_guard_fiscal_year.test.sql (BFY T12) — OWNS AC-BFY-016 (FR-BFY-060, 061).
--
-- ⚑ WHY THIS IS ASSERTED RATHER THAN ASSUMED. `enforce_draft_line_item` (0005) is column-AGNOSTIC: it
-- fires `before insert or update or delete` and checks only the owning version's status, so the new
-- `fiscal_year` column is covered the moment it exists — no trigger change is needed. But "no change
-- needed" is a CLAIM about a money-affecting write path, and this dimension is a money-affecting one:
-- re-phasing a line on an ACTIVE version would move budget between fiscal years AFTER the version was
-- activated and (possibly) pushed, silently desynchronising PMO from the ERP `Budget` documents that
-- were filed from it — with no new version, no re-activation and no push to notice it. The immutability
-- must therefore be a TESTED fact, not an inherited assumption.
--
-- The authoring route is the ordinary one: phase while Draft, then activate. Re-phasing means a new
-- Draft (via `clone_budget_version`, which carries the years across — AC-BFY-003).
--
-- Mutation: exempt `fiscal_year` from the guard (e.g. a column-list condition on the trigger) and
-- assertions 3/4 stop raising → red.
begin;
select plan(5);

insert into organizations (id, name) values
  ('0bc00000-0000-0000-0000-000000000001','BFY draft-guard Org A');
insert into auth.users (id, email) values
  ('0bc00000-0000-0000-0000-0000000000a1','bfy-dg-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bc00000-0000-0000-0000-0000000000a1','0bc00000-0000-0000-0000-000000000001','A PM','bfy-dg-pm@example.com','Project Manager','active');
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bc01111-0000-0000-0000-000000000001','0bc00000-0000-0000-0000-000000000001','BFY Draft Guard','Ongoing Project',date '2025-08-01',date '2027-03-31');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bc02222-0000-0000-0000-000000000001','0bc00000-0000-0000-0000-000000000001','0bc01111-0000-0000-0000-000000000001',1,'v1','Draft');

-- The whole test runs as a REAL authorized author, not as owner: the guard is a trigger, but the write
-- must also pass budget_line_items_write, and both are part of "can the operator phase this line?".
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bc00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── While DRAFT: phasing is authorable, both at INSERT and by UPDATE ─────────────────────────────
select lives_ok(
  $$insert into public.budget_line_items (id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
    values ('0bc03333-0000-0000-0000-000000000001','0bc02222-0000-0000-0000-000000000001','Labor','Y1 crew',90000.00,0,'2026')$$,
  'AC-BFY-016 a line may be PHASED at insert while the owning version is Draft');

select lives_ok(
  $$update public.budget_line_items set fiscal_year = '2027' where id = '0bc03333-0000-0000-0000-000000000001'$$,
  'AC-BFY-016 …and re-phased by update while it is still Draft (the operator can correct a mistake)');

-- ── Once ACTIVE: the year is immutable, in both directions ──────────────────────────────────────
set local role postgres;
update budget_versions set status='Active', activated_at=now() where id='0bc02222-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bc00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$update public.budget_line_items set fiscal_year = '2028' where id = '0bc03333-0000-0000-0000-000000000001'$$,
  'P0001',
  'line-items can only change while the owning version is Draft',
  'AC-BFY-016 re-phasing an ACTIVE line is REFUSED — it would move money between fiscal years behind an already-filed budget');

select throws_ok(
  $$update public.budget_line_items set fiscal_year = null where id = '0bc03333-0000-0000-0000-000000000001'$$,
  'P0001',
  'line-items can only change while the owning version is Draft',
  'AC-BFY-016 …and UN-phasing an Active line is refused too — the guard is column-agnostic, in both directions');

-- The value the version was activated with is exactly what it still holds.
set local role postgres;
select is(
  (select fiscal_year from public.budget_line_items where id = '0bc03333-0000-0000-0000-000000000001'),
  '2027',
  'AC-BFY-016 the refused writes changed NOTHING — the Active version''s phasing is what it was activated with');

select finish();
rollback;
