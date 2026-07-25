-- bfy_column_nullable.test.sql (BFY T6) — the ADDITIVE shape of migration 0153 §1 + §4.
--
-- Two additive, nullable dimensions and NOTHING else:
--   §1  budget_line_items.fiscal_year            text  — NULL = un-phased (FR-BFY-001, AC-BFY-001/016)
--   §4  budget_version_erp_mirror.pushed_project_start_date / …_end_date  date — the PUSH-TIME SPAN
--       WITNESS (FR-BFY-080, finding 9), the input FR-BFY-053's drift check needs.
--
-- ⚑ WHY NULLABLE, NO DEFAULT, NO CHECK, NO FK (spec §4). `fiscal_year` stores an ERPNext `Fiscal Year`
-- NAME — another system's calendar. Postgres cannot enumerate it (no enum), cannot reference it (no FK
-- table), and must not invent one (a default would BACKFILL a fabricated year onto every existing line,
-- a false claim on a money figure — spec §2 non-goals). Validation is PUSH-TIME, against the live
-- doctype (budgetGate.ts), never schema-time.
--
-- ⚑ WHY `date` AND NOT `timestamptz` for the witness. `projects.start_date`/`end_date` are `date`
-- (0001:80-81) and the drift predicate compares the witness to them with `is not distinct from`. An
-- implicit timestamptz↔date comparison is a silent-TZ bug on the input to a MONEY attribution decision
-- (review finding 9's "do not compare timestamptz to date implicitly").
--
-- ⚑ NO NEW POLICY. `budget_line_items` already carries force-RLS + its select/write policies (0002/0004)
-- and a new column is covered by them verbatim; `budget_version_erp_mirror` is machine-only (0137 §4 —
-- force RLS + exactly ONE select policy, so every user-JWT write is 42501). Adding a policy to either
-- while adding a column is how a machine-only mirror quietly becomes user-writable, so the policy SETS
-- are pinned here by NAME.
--
-- No predicate is tested by this file: it asserts the SHAPE only. The facts (F-A/F-B/F-C/F-D) are
-- exercised by bfy_projection_*, bfy_on_record_excludes_failed and bfy_attribution_known.
begin;
select plan(13);

-- ── §1 the dimension ────────────────────────────────────────────────────────────────────────────
select has_column('public', 'budget_line_items', 'fiscal_year',
  'AC-BFY-001/016 (partial) budget_line_items.fiscal_year exists');
select col_type_is('public', 'budget_line_items', 'fiscal_year', 'text',
  'AC-BFY-001/016 (partial) fiscal_year is text — it holds the CLIENT''S ERPNext Fiscal Year NAME, not an enum');
select col_is_null('public', 'budget_line_items', 'fiscal_year',
  'AC-BFY-001/016 (partial) fiscal_year is NULLABLE — NULL is the un-phased state, and every pre-existing row keeps it');
select col_hasnt_default('public', 'budget_line_items', 'fiscal_year',
  'AC-BFY-001 fiscal_year has NO default — a defaulted year would fabricate a fiscal year for every existing line');

-- No CHECK constraint may narrow the column: PMO does not own the client's calendar grammar, so any
-- schema-time validation would refuse a legitimate client year name.
select is(
  (select count(*)::int
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'budget_line_items' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%fiscal_year%'),
  0,
  'AC-BFY-001 no CHECK constraint on fiscal_year — validation is push-time against the live doctype, never schema-time');

-- ── §4 the push-time span witness ───────────────────────────────────────────────────────────────
select has_column('public', 'budget_version_erp_mirror', 'pushed_project_start_date',
  'AC-BFY-001 (partial) the mirror carries a push-time project START witness');
select has_column('public', 'budget_version_erp_mirror', 'pushed_project_end_date',
  'AC-BFY-001 (partial) the mirror carries a push-time project END witness');
select col_type_is('public', 'budget_version_erp_mirror', 'pushed_project_start_date', 'date',
  'AC-BFY-001 the start witness is `date` — the same type as projects.start_date (never timestamptz)');
select col_type_is('public', 'budget_version_erp_mirror', 'pushed_project_end_date', 'date',
  'AC-BFY-001 the end witness is `date` — the same type as projects.end_date (never timestamptz)');
select col_is_null('public', 'budget_version_erp_mirror', 'pushed_project_start_date',
  'AC-BFY-001 the start witness is nullable — a pre-this-issue push has none and none is invented');
select col_is_null('public', 'budget_version_erp_mirror', 'pushed_project_end_date',
  'AC-BFY-001 the end witness is nullable — a project with no end_date has none and none is invented');

-- ── no new RLS policy on either table ───────────────────────────────────────────────────────────
select policies_are('public', 'budget_version_erp_mirror',
  array['budget_version_erp_mirror_select'],
  'AC-BFY-017 (partial) the mirror stays MACHINE-ONLY — the witness columns add no write policy');
select policies_are('public', 'budget_line_items',
  array['budget_line_items_select', 'budget_line_items_write'],
  'AC-BFY-017 (partial) budget_line_items'' policy set is unchanged — the new column inherits it');

select finish();
rollback;
