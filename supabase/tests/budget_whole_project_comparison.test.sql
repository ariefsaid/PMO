-- budget_whole_project_comparison.test.sql — OWNS AC-014 (budget-whole-project FR-017/018).
-- get_budget_comparison(project, fiscal_year default null): the all-years / per-year COMPARISON read
-- (0580). SECURITY INVOKER — visibility is RLS authority, no caller org_id. Server aggregates the
-- Active source lines once (all years), the saved whole-project year rows (selected year, whole_project
-- mode) or the canonical legacy phased total (selected year, per_year mode), and joins
-- project_mapped_actuals (recorded source: current generation, attribution included) once per category.
--
-- ⚑ THE MONEY-HONESTY INVARIANT (same class as budget_projection_rpc.test.sql): `0` is a CLAIM.
--   budget_total  NULL = no Active budget attribution for this category/scope (absent version, absent
--                 year row, not-on-record legacy year, stale-span suppression). 0 = a KNOWN zero
--                 (explicit zero source line, explicit zero distribution year).
--   recorded      NULL = category unmapped OR the ledger has never been read for this scope. 0 = mapped,
--                 looked at, nothing there. Known-zero stays distinct from absent/unmapped/no-ledger.
--   remaining     only when BOTH budget and recorded are known (budget − recorded, never EAC).
--   percent_used  NULL on unknown budget, known-zero budget, or unknown recorded (never an invented
--                 percentage); otherwise recorded / budget_total as a fraction (0.7 = 70%), the
--                 projection domain's convention.
--
-- ⚑ LEGACY NULL-YEAR LINES ARE NEVER GIVEN A YEAR. The per_year branch reproduces get_budget_projection's
-- canonical clauses (0293 §3a, byte-for-byte in spirit): F-C (lines name the year) ∨ F-A (a push that
-- SUCCEEDED for it) is the only on-record authority — a `failed` mirror row is an attempt, not an
-- allocation; an un-phased line attributes only through a pushed row whose span witness matches the
-- current project dates (or a pre-issue NULL witness), NEVER from dates or calendar-year substrings; a
-- partly-suppressed category withholds its amount (F-D conjunction), it does not print a partial total.
--
-- Mutation commitments (each must turn this file red, then be restored):
--   M1 aggregation — drop the selected-year gate on the whole-project year rows (or the legacy year
--      filter): FY2026/FY2027 assertions report the wrong year's amounts → red.
--   M2 tenant — remove the visible-project guard (or the org filters): the foreign-org assertions
--      return rows → red.
--   M3 money honesty — coalesce an absent budget_total to 0 (or compute remaining/percent on an
--      unknown input): the absent-vs-zero and unknown-denominator assertions → red.
--
-- Fixtures are hand-inserted as the table owner (the established pgTAP idiom, no production bypass):
-- Active states are built as Draft then flipped, snapshot generations share one snapshot_id per org
-- (HIGH-1), and mirror rows are written directly — no ERP call, no push, deployment fence untouched.
begin;
create extension if not exists pgtap;
select to_regprocedure('public.get_budget_comparison(uuid,text)') is not null as comparison_rpc_present \gset
\if :comparison_rpc_present
select plan(41);

set timezone = 'UTC';

-- ── Tenancy ──────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('1472a000-0000-0000-0000-000000000001','Comparison Org A'),
  ('1472a000-0000-0000-0000-000000000002','Comparison Org B');
insert into auth.users (id, email) values
  ('1472b000-0000-0000-0000-0000000000a1','bwc-admin-a@example.com'),
  ('1472b000-0000-0000-0000-0000000000b1','bwc-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('1472b000-0000-0000-0000-0000000000a1','1472a000-0000-0000-0000-000000000001','A Admin','bwc-admin-a@example.com','Admin','active'),
  ('1472b000-0000-0000-0000-0000000000b1','1472a000-0000-0000-0000-000000000002','B PM','bwc-pm-b@example.com','Project Manager','active');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('1472c100-0000-0000-0000-000000000001','1472a000-0000-0000-0000-000000000001','BWC Whole Project','Ongoing Project',date '2026-01-01',date '2027-12-31'),
  ('1472c100-0000-0000-0000-000000000002','1472a000-0000-0000-0000-000000000001','BWC Legacy Annual','Ongoing Project',date '2025-08-01',date '2027-03-31'),
  ('1472c100-0000-0000-0000-000000000003','1472a000-0000-0000-0000-000000000001','BWC Draft Only','Ongoing Project',date '2026-01-01',date '2026-12-31'),
  ('1472c100-0000-0000-0000-000000000004','1472a000-0000-0000-0000-000000000001','BWC Bulk Inputs','Ongoing Project',date '2026-01-01',date '2026-12-31'),
  ('1472c100-0000-0000-0000-000000000005','1472a000-0000-0000-0000-000000000001','BWC Unknown Actual','Ongoing Project',date '2026-01-01',date '2026-12-31'),
  ('1472c200-0000-0000-0000-000000000001','1472a000-0000-0000-0000-000000000002','BWC Other Org','Ongoing Project',date '2026-01-01',date '2026-12-31');

-- Category → ERP account map (org-wide, FR-BUD-111 shape). Subcontractors is deliberately UNMAPPED.
insert into budget_category_account_map (org_id, category, erp_account) values
  ('1472a000-0000-0000-0000-000000000001','Labor','5100 - Direct Costs - PSC'),
  ('1472a000-0000-0000-0000-000000000001','Materials','5200 - Materials - PSC');

-- ── P1: Active whole_project version with a saved two-year distribution ─────────────────────────
-- An Archived predecessor whose lines must NOT count (Active is the budget authority, counted once).
-- Lines are authored while Draft (the shipped guard), then the status is flipped.
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('1472d100-0000-0000-0000-000000000000','1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000001',1,'BWC Archived Annual','Draft','1472b000-0000-0000-0000-0000000000a1','per_year');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000000','Labor','Archived annual crew',777.00,0,'2026');
update budget_versions set status = 'Archived', activated_at = now()
 where id = '1472d100-0000-0000-0000-000000000000';

insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('1472d100-0000-0000-0000-000000000001','1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000001',2,'BWC Active Whole','Draft','1472b000-0000-0000-0000-0000000000a1','whole_project');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Labor','Whole-project crew',300.00,0),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Materials','Explicit zero total',0.00,0),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Subcontractors','Unmapped category',120.00,0);
insert into budget_distribution_plans (org_id, budget_version_id, method, inputs, basis, updated_by) values
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','amount_by_year','{}'::jsonb,
   '{"projectStart":"2026-01-01","projectEnd":"2027-12-31","years":[{"name":"FY2026","start":"2026-01-01","end":"2026-12-31"},{"name":"FY2027","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,
   '1472b000-0000-0000-0000-0000000000a1');
insert into budget_year_distributions (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override) values
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Labor','FY2026',0,100.00,'amount_by_year',false),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Labor','FY2027',1,200.00,'amount_by_year',false),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Materials','FY2026',0,0.00,'amount_by_year',false),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Materials','FY2027',1,0.00,'amount_by_year',false),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Subcontractors','FY2026',0,0.00,'amount_by_year',false),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000001','Subcontractors','FY2027',1,120.00,'amount_by_year',false);
update budget_versions set status = 'Active', activated_at = now()
 where id = '1472d100-0000-0000-0000-000000000001';

-- ── P2: Active per_year (legacy) version — canonical phased + un-phased attribution ─────────────
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('1472d100-0000-0000-0000-000000000002','1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000002',1,'BWC Active Annual','Draft','1472b000-0000-0000-0000-0000000000a1','per_year');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','Labor','Phased crew',100.00,0,'FY2026'),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','Materials','Phased steel',25.00,0,'FY2026'),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','Materials','UN-PHASED steel',50.00,0,null),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','Subcontractors','Phased unlinked category',30.00,0,'FY2026'),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','Subcontractors','UN-PHASED unlinked category',20.00,0,null),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','Equipment','Phased only to next year',10.00,0,'FY2027');
update budget_versions set status = 'Active', activated_at = now()
 where id = '1472d100-0000-0000-0000-000000000002';
-- F-A: one pre-issue push that SUCCEEDED for FY2026 with the legacy NULL span witness (backward
-- compatibility attributes the un-phased line), one account-grained success for FY2027 through the
-- canonical budget_push_mirror_rows view, and one FAILED attempt for FY2028 (not an allocation).
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, pushed_at,
                                       pushed_project_start_date, pushed_project_end_date) values
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','FY2026','pushed',now(),
   null, null),
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','FY2028','failed',now(),
   date '2025-08-01', date '2027-03-31');
insert into budget_version_account_erp_mirror (org_id, budget_version_id, fiscal_year, erp_account,
                                               budget_intent, push_state, erp_docstatus, pushed_at,
                                               pushed_project_start_date, pushed_project_end_date) values
  ('1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000002','FY2027',
   '5200 - Materials - PSC','ensure','pushed',1,now(),date '2025-08-01',date '2027-03-31');

-- ── P3: Draft version only — no Active budget authority ─────────────────────────────────────────
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('1472d100-0000-0000-0000-000000000003','1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000003',1,'BWC Draft','Draft','1472b000-0000-0000-0000-0000000000a1','whole_project');

-- ── P4: >1000 phased source lines + >1000 ledger rows (no truncation, one row/category) ─────────
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('1472d100-0000-0000-0000-000000000004','1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000004',1,'BWC Bulk','Draft','1472b000-0000-0000-0000-0000000000a1','per_year');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
select '1472a000-0000-0000-0000-000000000001','1472d100-0000-0000-0000-000000000004','Labor','Bulk line ' || g,1.00,0,'FY2026'
  from generate_series(1,1100) g;
update budget_versions set status = 'Active', activated_at = now()
 where id = '1472d100-0000-0000-0000-000000000004';

-- ── Ledger: ONE current generation per org (HIGH-1) + one superseded generation ─────────────────
-- Old generation (superseded): a Labor FY2026 reading that must NOT reach any figure.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id, created_at, as_of) values
  ('1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','FY2026',999.00,0,999.00,
   '1472e000-0000-0000-0000-000000000001', now() - interval '2 hours', timestamptz '2026-11-02 07:00:00+00');
-- Current generation: P1's two-year readings (tagged) and P4's 1100 rows, one snapshot_id, one org.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id, created_at, as_of) values
  ('1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','FY2026',40.00,0,40.00,
   '1472e000-0000-0000-0000-000000000002', now() - interval '1 hour', timestamptz '2026-11-02 08:00:00+00'),
  ('1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','FY2027',250.00,0,250.00,
   '1472e000-0000-0000-0000-000000000002', now() - interval '1 hour', timestamptz '2026-11-02 08:00:00+00'),
  ('1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000001','5200 - Materials - PSC','FY2026',5.00,0,5.00,
   '1472e000-0000-0000-0000-000000000002', now() - interval '1 hour', timestamptz '2026-11-02 08:00:00+00');
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id, created_at, as_of)
select '1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000004','5100 - Direct Costs - PSC','FY2026',1.00,0,1.00,
       '1472e000-0000-0000-0000-000000000002', now() - interval '1 hour', timestamptz '2026-11-02 08:00:00+00'
  from generate_series(1,1100);

-- One canonical current-generation reading with a nullable net is a valid source state (0101), and
-- 0497 deliberately reports its amount as unknown while retaining row presence and provenance.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id, created_at, as_of) values
  ('1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000005','5100 - Direct Costs - PSC','FY2026',null,null,null,
   '1472e000-0000-0000-0000-000000000002', now() - interval '30 minutes', timestamptz '2026-11-02 10:00:00+00');

-- Attribution (#1271): one UNTAGGED GL line on the mapped Labor account, rule-attributed to P1 at
-- 100%. Its as_of is deliberately the newest so recorded_as_of proves the attribution joins the read.
insert into erp_gl_entry_mirror (org_id, erp_name, account, fiscal_year, project, posting_date, debit, credit, as_of, erp_modified) values
  ('1472a000-0000-0000-0000-000000000001','BWC-GL-ATTR-1','5100 - Direct Costs - PSC','FY2026','',date '2026-06-15',30.00,0,
   timestamptz '2026-11-02 09:00:00+00','probe');
insert into cost_attribution_rules (org_id, rule_key, version, is_current, name, match_account, effective_from, specificity) values
  ('1472a000-0000-0000-0000-000000000001','1472f000-0000-0000-0000-000000000001',1,true,'BWC labor attribution','5100 - Direct Costs - PSC',date '2026-01-01',10);
insert into cost_attribution_rule_targets (rule_id, org_id, position, project_id, percent)
select id, '1472a000-0000-0000-0000-000000000001', 0, '1472c100-0000-0000-0000-000000000001', 100
  from cost_attribution_rules
 where org_id = '1472a000-0000-0000-0000-000000000001' and rule_key = '1472f000-0000-0000-0000-000000000001';

-- ══════════════════════════════ All-years (project to date) — P1 ═════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"1472b000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select results_eq(
  $$select budget_total, recorded, recorded_as_of, mapped, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000005', null)
     where category = 'Labor'$$,
  $$values (null::numeric, null::numeric, timestamptz '2026-11-02 10:00:00+00', true, true, null::numeric, null::numeric)$$,
  'AC-015 a canonical actual-only row with an unknown amount remains visible with ledger provenance'
);

select is(
  (select array_agg(category::text order by category) from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null)),
  array['Labor','Materials','Subcontractors'],
  'AC-014 all-years returns one row per category with a known fact — nothing invented for the silent four'
);

select is_empty(
  $$select 1 from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category = 'Permits & Fees'$$,
  'AC-015 an entirely silent category remains absent'
);

select is(
  (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category = 'Labor'),
  300.00::numeric,
  'AC-014 all-years budget is the ACTIVE version''s source lines counted once — the Archived predecessor''s 777.00 never joins'
);

select is(
  (select recorded from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category = 'Labor'),
  320.00::numeric,
  'AC-014 all-years recorded = FY2026 40 + FY2027 250 + attributed 30, each counted once — the superseded generation''s 999 is excluded'
);

select is(
  (select recorded_as_of from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category = 'Labor'),
  timestamptz '2026-11-02 09:00:00+00',
  'AC-014 recorded_as_of is the newest contributing reading''s as_of (the attributed GL line''s)'
);

select ok(
  (select mapped and has_ledger from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category = 'Labor'),
  'AC-014 a mapped category with ledger rows reports mapped and has_ledger'
);

select is(
  (select remaining from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category = 'Labor'),
  (-20.00)::numeric,
  'AC-014 remaining is budget − recorded (project-to-date), never an EAC figure'
);

select is(
  (select percent_used from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category = 'Labor'),
  320.00::numeric / 300.00::numeric,
  'AC-014 percent_used is recorded / budget as a fraction, not an invented percentage'
);

select results_eq(
  $$select budget_total, recorded, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null)
     where category = 'Materials'$$,
  $$values (0.00::numeric, 5.00::numeric, (-5.00)::numeric, null::numeric)$$,
  'AC-015 an explicit zero total is a KNOWN zero budget: remaining computed, percent withheld on the zero denominator'
);

select results_eq(
  $$select budget_total, recorded, recorded_as_of, mapped, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null)
     where category = 'Subcontractors'$$,
  $$values (120.00::numeric, null::numeric, null::timestamptz, false, false, null::numeric, null::numeric)$$,
  'AC-015 an UNMAPPED category states its budget but honest nulls for the ledger — never a fabricated 0'
);

-- ══════════════════════════════ Selected year FY2026 — whole_project mode ════════════════════════
select is(
  (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2026') where category = 'Labor'),
  100.00::numeric,
  'AC-014/FR-017 the selected year reads the SAVED distribution row (100), not the whole-project source total (300)'
);

select results_eq(
  $$select budget_total, recorded, recorded_as_of, mapped, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2026')
     where category = 'Labor'$$,
  $$values (100.00::numeric, 70.00::numeric, timestamptz '2026-11-02 09:00:00+00', true, true, 30.00::numeric, 0.70::numeric)$$,
  'AC-014 FY2026 recorded = tagged 40 + attributed 30 counted once, with provenance as_of and a clean remaining/percent'
);

select is(
  (select recorded from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2026') where category = 'Materials'),
  5.00::numeric,
  'AC-014 the year filter scopes the ledger read: Materials'' FY2027 rows never leak into FY2026'
);

select results_eq(
  $$select budget_total, recorded, mapped, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2026')
     where category = 'Subcontractors'$$,
  $$values (0.00::numeric, null::numeric, false, null::numeric)$$,
  'FR-018 an explicit zero distribution YEAR survives as a known 0 — distinct from absent attribution'
);

-- ══════════════════════════════ Selected year FY2027 ═════════════════════════════════════════════
select results_eq(
  $$select budget_total, recorded, recorded_as_of, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2027')
     where category = 'Labor'$$,
  $$values (200.00::numeric, 250.00::numeric, timestamptz '2026-11-02 08:00:00+00', (-50.00)::numeric, 1.25::numeric)$$,
  'AC-014 an over-spent year states its negative remaining and >1 fraction from recorded, not EAC'
);

select results_eq(
  $$select budget_total, recorded, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2027')
     where category = 'Materials'$$,
  $$values (0.00::numeric, 0.00::numeric, false, 0.00::numeric, null::numeric)$$,
  'AC-015 mapped-and-looked-with-no-rows is a KNOWN zero spend (0, has_ledger false) — distinct from unmapped nulls'
);

select is(
  (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2027') where category = 'Subcontractors'),
  120.00::numeric,
  'FR-017 the whole-project year grid carries each category''s own saved year amount'
);

select is(
  (select (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001','FY2026') where category='Labor')
        + (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001','FY2027') where category='Labor')
        = (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null) where category='Labor')),
  true,
  'AC-014 the year amounts partition the total exactly — no double-count across years or generations'
);

-- ════════════════════ Legacy per_year mode — canonical projection semantics ══════════════════════
select results_eq(
  $$select budget_total, recorded, mapped, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2026')
     where category = 'Labor'$$,
  $$values (100.00::numeric, null::numeric, true, false, null::numeric, null::numeric)$$,
  'FR-017/018 a legacy phased total remains known when its mapped ledger has never been read'
);

select results_eq(
  $$select budget_total, recorded, mapped, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2027')
     where category = 'Materials'$$,
  $$values (50.00::numeric, null::numeric, true, false, null::numeric, null::numeric)$$,
  'FR-017 a pushed account-grained row in the canonical mirror view attributes the un-phased line to FY2027'
);

select is(
  (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2026') where category = 'Materials'),
  75.00::numeric,
  'FR-017 the phased 25 plus un-phased 50 attributes through F-A + a pre-issue NULL span witness'
);

-- ⚑ STALE SPAN: the witness drifts (project dates changed after the push) ⇒ attribution stops. The
-- category's whole 75 is WITHHELD (null), not partially printed as the remaining phased 25.
reset role;
update budget_version_erp_mirror
   set pushed_project_start_date = date '2025-08-01',
       pushed_project_end_date = date '2026-12-31'
 where org_id = '1472a000-0000-0000-0000-000000000001'
   and budget_version_id = '1472d100-0000-0000-0000-000000000002'
   and fiscal_year = 'FY2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"1472b000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select results_eq(
  $$select budget_total, recorded, recorded_as_of, mapped, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2026')
     where category = 'Materials'$$,
  $$values (null::numeric, null::numeric, null::timestamptz, true, false, null::numeric, null::numeric)$$,
  'FR-022 a stale suppressed category remains visible as unknown before any ledger reading'
);

select results_eq(
  $$select budget_total, recorded, recorded_as_of, mapped, has_ledger, remaining, percent_used
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2026')
     where category = 'Subcontractors'$$,
  $$values (null::numeric, null::numeric, null::timestamptz, false, false, null::numeric, null::numeric)$$,
  'FR-022 a stale suppressed unmapped category without ledger rows remains visible only as unknown'
);

-- The stale category facts above must survive independently of any ledger refresh; this later read
-- preserves the original zero-vs-unknown regression case for the mapped category.
reset role;
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id, created_at, as_of) values
  ('1472a000-0000-0000-0000-000000000001','1472c100-0000-0000-0000-000000000002','5100 - Direct Costs - PSC','FY2026',10.00,0,10.00,
   '1472e000-0000-0000-0000-000000000002', now() - interval '1 hour', timestamptz '2026-11-02 08:00:00+00');
set local role authenticated;
set local request.jwt.claims = '{"sub":"1472b000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select results_eq(
  $$select category::text, budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2026')
     where category in ('Labor','Materials') order by category$$,
  $$values ('Labor'::text, 100.00::numeric), ('Materials'::text, null::numeric)$$,
  'FR-022 a stale span suppresses the entire partially-phased Materials total (F-D); phased Labor stays 100'
);

select is_empty(
  $$select 1 from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2026') where category = 'Equipment'$$,
  'FR-018 a category phased only to another year remains absent from this selected year'
);

-- ⚑ A FAILED push is an attempt, not an allocation: FY2028 is not on record, nothing sweeps there.
select is_empty(
  $$select 1 from public.get_budget_comparison('1472c100-0000-0000-0000-000000000002', 'FY2028')$$,
  'FR-018 a failed mirror row is not an on-record year — the comparison returns no budget facts for it'
);

-- ════════════════════ >1000 source inputs — server aggregation, one row/category ════════════════
select is(
  (select count(*)::int from public.get_budget_comparison('1472c100-0000-0000-0000-000000000004', 'FY2026') where category = 'Labor'),
  1,
  'NFR-005 >1000 inputs aggregate server-side: exactly ONE row for the category'
);

select results_eq(
  $$select budget_total, recorded
      from public.get_budget_comparison('1472c100-0000-0000-0000-000000000004', 'FY2026')
     where category = 'Labor'$$,
  $$values (1100.00::numeric, 1100.00::numeric)$$,
  'NFR-005 1100 phased lines and 1100 ledger rows sum in full — no PostgREST-style truncation at 1000'
);

select is(
  (select budget_total from public.get_budget_comparison('1472c100-0000-0000-0000-000000000004', 'FY2026') where category = 'Materials'),
  null::numeric,
  'AC-015 a mapped ledger zero with no Active category budget stays absent, never coalesced to known zero'
);

-- ════════════════════ No Active budget authority ═════════════════════════════════════════════════
select is_empty(
  $$select 1 from public.get_budget_comparison('1472c100-0000-0000-0000-000000000003', null)$$,
  'AC-015 a Draft-only project has no budget authority and no ledger reading — no rows are invented'
);

select is_empty(
  $$select 1 from public.get_budget_comparison('1472c100-0000-0000-0000-000000000003', 'FY2026')$$,
  'AC-015 a year scope on a project without an Active version is equally silent'
);

select is_empty(
  $$select 1 from public.get_budget_comparison('00000000-0000-0000-0000-000000000000', null)$$,
  'AC-015 an unknown project id yields no rows'
);

-- ════════════════════ Tenant isolation — the caller''s RLS is the authority ══════════════════════
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"1472b000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is_empty(
  $$select 1 from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null)$$,
  'AC-008/AC-014 a foreign-org member receives NO rows for another org''s project (all-years)'
);

select is_empty(
  $$select 1 from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', 'FY2026')$$,
  'AC-008/AC-014 a foreign-org member receives NO rows for another org''s project (year scope)'
);

-- ════════════════════ Contract: grants, invoker, stability, signature ════════════════════════════
reset role;

select ok(
  to_regprocedure('public.get_budget_comparison(uuid, text)') is not null
  and has_function_privilege('authenticated', 'public.get_budget_comparison(uuid, text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_budget_comparison(uuid, text)', 'EXECUTE'),
  'AC-008 authenticated members may execute the comparison RPC; service_role does not receive this client grant'
);

select ok(
  not coalesce(has_function_privilege('anon', 'public.get_budget_comparison(uuid, text)', 'EXECUTE'), false)
  and not coalesce(has_function_privilege('public', 'public.get_budget_comparison(uuid, text)', 'EXECUTE'), false),
  'AC-008 the comparison RPC is revoked from anon and public'
);

set local role anon;
select throws_ok(
  $$select * from public.get_budget_comparison('1472c100-0000-0000-0000-000000000001', null)$$,
  '42501', 'permission denied for function get_budget_comparison',
  'AC-008 an anonymous caller is refused at the function ACL, before any row is computed'
);
reset role;

select ok(
  (select prosecdef = false and provolatile = 's'
     from pg_proc where oid = 'public.get_budget_comparison(uuid, text)'::regprocedure),
  'AC-014 the comparison is SECURITY INVOKER (RLS is the authority) and STABLE'
);

select ok(
  (select proconfig @> array['search_path=public, pg_temp']
     from pg_proc where oid = 'public.get_budget_comparison(uuid, text)'::regprocedure),
  'AC-014 the comparison pins its search_path (public, pg_temp)'
);

select is(
  (select (proargnames)[1:2]::text from pg_proc where oid = 'public.get_budget_comparison(uuid, text)'::regprocedure),
  '{p_project_id,p_fiscal_year}',
  'AC-008 the signature carries no caller org/tenant argument — tenancy is never client-supplied'
);

\else
select plan(1);
select ok(false, 'AC-014 the comparison RPC is installed before its behavior contract is asserted');
\endif
select * from finish();
rollback;
