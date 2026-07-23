-- bfy_list_fiscal_years.test.sql (BFY T9) — OWNS AC-BFY-015 (FR-BFY-051).
--
-- ⚑ THE FACTS UNDER TEST, and they are DIFFERENT ones:
--   • `observed` (which years may be ASKED for) unions **F-B** — EVERY mirror year, failed and held
--     included — plus actuals years, ETC years, and now every phased line's year (**F-C**, any
--     version). A failed push is legitimately inspectable: refusing to OFFER the year would hide the
--     GL actuals that posted against it. F-B is the right fact for an OFFER; it is never the right
--     fact for a money attribution.
--   • `is_active_push` (the FLAG on the offer) is **F-C ∨ F-A** and must be BYTE-FOR-BYTE
--     `get_budget_projection.budget_year.on_record`. 0149's own comment demands they be one question:
--     the selector may offer a year whose budget is unknowable, but it must be able to SAY so rather
--     than leave the operator with a bare dash and no explanation.
--
-- ⚑ THE INDEPENDENT ORACLE. Two predicates that are "the same question" can both be changed to the
-- same WRONG question and still agree with each other — so this file re-derives the flag FROM FIRST
-- PRINCIPLES in SQL (its own `exists(phased Active line) or exists('pushed' Active mirror)` over the
-- base tables) and asserts the RPC equals THAT, row for row, not that two RPCs equal each other.
--
-- Mutations: revert `is_active_push` to bare mirror existence → the failed-only year flags true → red;
-- drop the phased-line union from `observed` → the refused project's FY2026 is not offered at all → red.
begin;
select plan(7);

insert into organizations (id, name) values
  ('0bfd0000-0000-0000-0000-000000000001','BFY fiscal-years Org A');
insert into auth.users (id, email) values
  ('0bfd0000-0000-0000-0000-0000000000a1','bfy-fy-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfd0000-0000-0000-0000-0000000000a1','0bfd0000-0000-0000-0000-000000000001','A Finance','bfy-fy-finance@example.com','Finance','active');

-- P1 — the phased-but-REFUSED project of AC-BFY-013: lines phased to FY2026 (F-C), and the shipped
-- refusal writer's `failed` FY2026 mirror row. ERP holds nothing; PMO holds a budget.
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfd1111-0000-0000-0000-000000000001','0bfd0000-0000-0000-0000-000000000001','BFY Refused Phased','Ongoing Project',date '2025-08-01',date '2027-03-31'),
  ('0bfd1111-0000-0000-0000-000000000002','0bfd0000-0000-0000-0000-000000000001','BFY Failed Only','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfd2222-0000-0000-0000-000000000001','0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000001',1,'Phased v1','Draft'),
  -- P2's version is entirely UN-PHASED, so nothing but the mirror can speak for it.
  ('0bfd2222-0000-0000-0000-000000000002','0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000002',1,'Un-phased v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000001','Labor','Y1 crew',90000.00,0,'2026'),
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000001','Labor','Y2 crew',40000.00,0,'2027'),
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000002','Labor','Crew',30000.00,0,null);
update budget_versions set status='Active', activated_at=now()
 where id in ('0bfd2222-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000002');

insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000001','2026','failed','budget-multi-fiscal-year-unphased'),
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000002','2026','failed','external-unreachable');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── P1: both phased years are OFFERED, and both are flagged on-record via F-C alone ──────────────
select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000001') order by fiscal_year$$,
  $$values ('2026'::text, true), ('2027'::text, true)$$,
  'AC-BFY-015 [F-C] BOTH phased years are offered and flagged on-record — even though the push was REFUSED and FY2027 has no mirror row at all');

-- ⚑ THE INDEPENDENT RE-DERIVATION — the flag is recomputed from the base tables, not from a sibling RPC.
select results_eq(
  $$select fy.fiscal_year, fy.is_active_push
      from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000001') fy order by fy.fiscal_year$$,
  $$select o.fiscal_year,
           ( exists (select 1 from public.budget_versions v
                       join public.budget_line_items li on li.budget_version_id = v.id
                      where v.project_id = '0bfd1111-0000-0000-0000-000000000001' and v.status = 'Active'
                        and li.fiscal_year = o.fiscal_year)
             or exists (select 1 from public.budget_version_erp_mirror em
                          join public.budget_versions v on v.id = em.budget_version_id
                         where v.project_id = '0bfd1111-0000-0000-0000-000000000001' and v.status = 'Active'
                           and em.fiscal_year = o.fiscal_year and em.push_state = 'pushed') )
      from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000001') o order by o.fiscal_year$$,
  'AC-BFY-015 is_active_push equals an INDEPENDENT first-principles re-derivation of F-C ∨ F-A (not a comparison of two RPCs)');

-- ── P2: a year with ONLY a `failed` row is OFFERED (F-B) but NOT flagged (F-A absent) ────────────
select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000002')$$,
  $$values ('2026'::text, false)$$,
  'AC-BFY-015 [F-B offers, F-A flags] a failed-only year is still OFFERED — hiding it would hide its GL actuals — but is NOT flagged on-record');

-- …and the flag agrees with the projection's own behaviour on that year: no budget is stated there.
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000002','2026') where category='Labor'),
  null,
  'AC-BFY-015 the flag does not disagree with the grid — an un-flagged year states no budget (one question, two surfaces)');

-- ── A `pushed` row flips the SAME year's flag: F-A on its own is sufficient ──────────────────────
set local role postgres;
update budget_version_erp_mirror set push_state='pushed', push_error=null, erp_budget_name='BUDGET-2026-0009'
 where budget_version_id='0bfd2222-0000-0000-0000-000000000002' and fiscal_year='2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000002')$$,
  $$values ('2026'::text, true)$$,
  'AC-BFY-015 [F-A] a SUCCESSFUL push flags the year on its own — the un-phased backward-compat path (FR-BFY-070)');

-- ── A phased year on a NON-Active version is offered but never flagged ──────────────────────────
-- (`observed` unions every version's phased years — a prior version's year is legitimately
-- inspectable — while the FLAG is about the ACTIVE version, exactly like `on_record`.)
set local role postgres;
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfd2222-0000-0000-0000-000000000003','0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000002',2,'Archived phased','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000003','Labor','Old plan',10000.00,0,'2024');
update budget_versions set status='Archived' where id='0bfd2222-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000002') order by fiscal_year$$,
  $$values ('2024'::text, false), ('2026'::text, true)$$,
  'AC-BFY-015 an ARCHIVED version''s phased year is OFFERED (inspectable) but never flagged — the flag is about the ACTIVE version');

-- Cross-org: RLS is the boundary, not a hand-rolled filter (the function stays SECURITY INVOKER).
set local role postgres;
insert into organizations (id, name) values ('0bfd0000-0000-0000-0000-000000000002','BFY fiscal-years Org B');
insert into auth.users (id, email) values ('0bfd0000-0000-0000-0000-0000000000b1','bfy-fy-finance-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfd0000-0000-0000-0000-0000000000b1','0bfd0000-0000-0000-0000-000000000002','B Finance','bfy-fy-finance-b@example.com','Finance','active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000001')),
  0,
  'AC-BFY-015 cross-org: another org''s phased years are not offered — the new line-item union is under RLS like every other read');

select finish();
rollback;
