# Budget tab: spend versus budget with no accounting system (#2325)

Money read path. Ships alone, three reviews. Migration **0897** (reserved). No ADR: this applies the existing
basis rule (no ledger read ⇒ PMO paid pre-tax, 0560/0700, ADR-0093 §2) to one more reader; nothing irreversible.

## What breaks today

Finance, a Project Manager, an Executive or an Admin in an organisation with no accounting system opens a project's
Budget tab with an Active budget. Budget 5,000 Labor, one purchase paid 1,000: the header, Overview and lists say
Spent 1,000; the comparison row says recorded blank, "No ledger account is mapped", remaining and "% recorded" blank.
Cause: `get_budget_comparison` (0580:191, never redefined) joins only `project_mapped_actuals` (0497:58), the
accounting-system snapshot. With no snapshot and no account map every category is `mapped = false`, `recorded = NULL`.

## Design

**One function changes: `get_budget_comparison(uuid, text)`**, same signature (`create or replace`), so no
`database.types.ts` change and no isolation-manifest change (security invoker, not a definer).

- **Basis switch:** `public.org_reads_erp_ledger()` (0765), the flag `project_finance_actuals` (0560) and every other
  PMO-basis reader use. True ⇒ the 0580 final select, byte-for-byte, as CTE `ledger_result` filtered
  `where public.org_reads_erp_ledger()`. False ⇒ new CTE `pmo_result` filtered `where not public.org_reads_erp_ledger()`.
  The budget-side CTEs (all-years, whole-project year, per-year legacy) are reused unchanged by both.
- **Source when no ledger:** new helper `public.project_pmo_paid_by_category(p_project_id uuid)
  returns table(category public.budget_category, amount numeric, n int, as_of timestamptz)`, security invoker, the
  same role/org/membership guard as `project_pmo_spent_position` (0700:40-48, returns no rows otherwise). Its body is
  the `paid_rows` and `charges` CTEs of `project_pmo_spent_position` (0700:49-64) grouped by
  `procurements.budget_category` (NULL kept as its own group) plus `equipment_charge_project_actuals(p_project_id, null)`
  grouped by its category. Per group: `amount` NULL when any member is NULL (unreadable or other-currency), else the sum.
  "Never a second definition" is held by a test, not by prose: AC-BCNL-002 pins Σ helper = `project_pmo_spent_position.amount`
  on a fixture with every term (categorised, uncategorised, hire charge). Refactoring `project_pmo_spent_position`
  itself to read the helper is left out (it feeds every dashboard; separate change, see Left out).
- **How a purchase line's category is known:** `procurements.budget_category` (0243:45, nullable; one category per
  purchase, not per line). A paid purchase with none goes to a row with `category = NULL`, labelled "Uncategorised"
  in the UI. It is never dropped and never spread.
- **`pmo_result`, all-years scope (`p_fiscal_year is null`):** rows = budget categories ∪ helper groups.
  `recorded` = helper amount; 0 for a budget category with no paid purchase (known zero: PMO reads its own purchases
  completely). `recorded_as_of` = helper `as_of`. `mapped = true`, `has_ledger = n > 0`. The uncategorised row has
  `budget_total = 0` (a budget line cannot be uncategorised: `budget_line_items.category` is not null), so the
  summary's budget total stays the Σ of real categories and its recorded total equals the header.
  `remaining` / `percent_used` from the same 0580 expressions (percent NULL on a zero budget).
- **`pmo_result`, a fiscal-year scope:** budget side unchanged; `recorded = NULL`, `mapped = true`,
  `has_ledger = false`; no uncategorised row. Reason: without an accounting system there is no fiscal calendar
  (`external-items` answers `binding-unavailable`), and year labels are opaque, never parsed into dates
  (`src/lib/budget/budgetProjection.ts:364`). See the product question.
- **Currency:** match the header: a purchase in another currency than the project is NULL (0700:54), its group's
  `recorded` is NULL, other categories stay known; the hire charge is NULL when the project currency is not the org
  default (0700:62). Never converted. Budget-vs-spend currency comparison stays the FE `compatibleBasis` guard
  (`BudgetProjection.tsx:165`).
- **Forecast (`get_budget_projection`, 0293:696): unchanged.** The forecast table takes recorded from the
  comparison, not from the projection (`BudgetProjection.tsx:166-187`: `recorded: comparison?.recorded`, L177); it reads
  only `pmoEtc` and `attributionKnown` from the projection. So the forecast year inherits this source by construction.
  AC-BCNL-007 pins that the projection's `actuals_to_date` for a no-ledger year is NULL, the same as the comparison's.
- **UI (minimum):** `ProjectBudget.tsx:1005` passes `ledgerBasis={position.ledgerBasis}` to `BudgetProjection`.
  In `BudgetProjection.tsx`, when `ledgerBasis === 'pmo'`: (1) the default scope is All years; (2) the recorded source
  tooltip/drawer copy says paid purchases before tax instead of "mapped ERP ledger" (L330-332, L511, L531-533, L452
  empty-state sub); (3) a NULL recorded in a year scope reads "Spending by year needs an accounting system. See All
  years." instead of `unavailableRecordedText`; (4) a `category === null` row: label `Uncategorised`, rowKey
  `'uncategorised'`, no row menu or drawer action. `BudgetComparisonRow.category` becomes `BudgetCategory | null`.
  New keys in `public/locales/en/finance.json` and `public/locales/id/finance.json`.
- **Stale comment** `pmo-portal/src/lib/db/procurements.ts:72-80`: say that with no ledger the open commitment is the
  order total minus what is paid pre-tax (0560 `procurement_open_commitment`), and Recorded spending is paid purchases
  before tax plus the internal hire charge (`project_pmo_spent_position`, 0700), not the committed basis.

## Readers swept

| Caller (file:line) | What it shows | Effect |
|---|---|---|
| `pmo-portal/src/lib/repositories/budgetProjection.ts:278` `fetchBudgetComparison` | seam for the two below | type: `category` nullable |
| `pmo-portal/pages/BudgetProjection.tsx:138` comparison query → all-years table L461, summary strip L421-428, drawer L531-543 | budget, recorded, remaining, % recorded | figures appear (no ledger) |
| `pmo-portal/pages/BudgetProjection.tsx:166-187` forecast year rows | recorded column, final cost | year scope: unchanged NULL, new reason |
| CSV export via `onExport` (`ProjectBudget.tsx:1005`) | same rows | uncategorised row exported, label from `budgetCategoryLabel` fallback |
| `scripts/isolation-probe.sh:360` | cross-org probe | signature unchanged; no change |
| `get_budget_projection` caller `budgetProjection.ts:247` | `pmoEtc`, `attributionKnown` | none (function unchanged) |
| Edge functions (`adapter-dispatch`, `erpnext-sweep`) | comments only, no call | none |

## Acceptance criteria (pgTAP owns all SQL ACs; `supabase/tests/0897_budget_comparison_no_ledger.test.sql`)

Fixture: org with no `external_org_bindings` row, Finance caller, project in the org currency, Active all-years budget
Labor 5,000 + Materials 2,000; purchases: Labor paid 1,000; Labor Ordered 2,000 (unpaid); uncategorised paid 300.

- **AC-BCNL-001** Given no accounting system and a Labor purchase paid 1,000 against Labor 5,000, when
  `get_budget_comparison(project, null)` runs, then Labor recorded = 1000, remaining = 4000, percent_used = 0.2, mapped true.
- **AC-BCNL-002** Given the fixture plus a hire charge, when the comparison runs, then Σ recorded over all rows =
  `project_pmo_spent_position(project).amount`, and Σ helper amount = the same figure.
- **AC-BCNL-003** Given an uncategorised paid purchase of 300, then one row has category NULL, budget_total 0,
  recorded 300; Labor and Materials stay known.
- **AC-BCNL-004** Given a budget category with no paid purchase (Materials) and an unpaid Ordered purchase, then
  Materials recorded = 0 and the Ordered 2,000 adds nothing to recorded.
- **AC-BCNL-005** Given a paid Labor purchase in another currency, then Labor recorded is NULL, Materials and the
  uncategorised row stay known, and no amount is converted.
- **AC-BCNL-006** Given an active ERPNext binding with a snapshot mapping Labor = 700 and a PMO paid purchase of
  1,000, then Labor recorded = 700 (ledger only; the PMO purchase is not added). Plus the existing
  `budget_whole_project_comparison.test.sql` runs unchanged and green.
- **AC-BCNL-007** Given no accounting system and a per-year budget with Labor phased to `FY-A`, when the comparison
  runs for `FY-A`, then Labor budget_total = the phased amount, recorded NULL, has_ledger false, no NULL-category row;
  and `get_budget_projection(project, 'FY-A')` Labor `actuals_to_date` is NULL.
- **AC-BCNL-008** Given a caller whose role is outside Admin/Finance/Executive/Project Manager, then the helper
  returns no rows and the comparison shows no recorded figure.
- **AC-BCNL-009** Given a caller in another organisation, then the comparison returns no rows for this project.
- **AC-BCNL-010** (Vitest, `pmo-portal/pages/BudgetProjection.test.tsx`) Given ledger basis `pmo` and a
  NULL-category row, then the table shows "Uncategorised", the source copy names paid purchases, and the default
  scope is All years.

| AC | Owning test |
|---|---|
| AC-BCNL-001…009 | `supabase/tests/0897_budget_comparison_no_ledger.test.sql` (description starts with the AC id) |
| AC-BCNL-010 | `pmo-portal/pages/BudgetProjection.test.tsx` `it('AC-BCNL-010 …')` |

## Tasks (Sonnet builder; failing tests first)

1. Read 0580, 0700:34-72, 0560:38-140, `supabase/tests/0700_pmo_spend_split.test.sql` (fixture shape, binding insert at L27).
2. Write `supabase/tests/0897_budget_comparison_no_ledger.test.sql`, `plan(n)` for AC-BCNL-001…009. Run:
   `scripts/with-db-lock.sh supabase test db supabase/tests/0897_budget_comparison_no_ledger.test.sql` → red (helper missing).
3. Write `supabase/migrations/0897_budget_comparison_pmo_paid.sql`: header comment (basis rule, the equality pin,
   rollback path); `create function public.project_pmo_paid_by_category`; `revoke all … from public, anon;
   grant execute … to authenticated, service_role;`.
4. Same file: `create or replace function public.get_budget_comparison` = 0580 body with `ledger_result` /
   `pmo_result` split as designed; re-issue 0580's revoke/grant and update the `comment on function`.
5. Write `supabase/migrations/rollback/0897_budget_comparison_pmo_paid_down.sql`: re-create the 0580 function body
   verbatim (+ grants, comment), then `drop function if exists public.project_pmo_paid_by_category(uuid);`.
6. `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0897_budget_comparison_no_ledger.test.sql supabase/tests/budget_whole_project_comparison.test.sql'` → green.
7. Rollback round trip: apply the down file and the up file again in one transaction under the DB lock
   (`scripts/with-db-lock.sh psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'begin' -f <down> -f <up> -c 'rollback'`), output saved.
8. Mutation check: make `pmo_result` always select (drop the `not`) → AC-BCNL-006 red; restore. Make the helper drop
   NULL categories → AC-BCNL-002/003 red; restore. Save both outputs.
9. Write AC-BCNL-010 in `pmo-portal/pages/BudgetProjection.test.tsx` → red:
   `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/BudgetProjection.test.tsx`.
10. `budgetProjection.ts`: `BudgetComparisonRow.category: BudgetCategory | null`; fix the type fallout in
    `BudgetProjection.tsx` and `src/lib/budget/budgetProjection.ts` (`summarizeBudgetComparison` unchanged in logic).
11. `ProjectBudget.tsx:1005` pass `ledgerBasis`; `BudgetProjection.tsx` the four UI changes; en + id locale keys.
    Re-run task 9's command → green; also run `pages/ProjectBudget.test.tsx`, `src/lib/repositories/budgetProjection.test.ts`,
    `src/lib/budget/budgetProjection.test.ts`.
12. Correct the comment at `pmo-portal/src/lib/db/procurements.ts:72-80`.
13. Gates (touched files only, per lane rules): `npm run check:guards`, `npm run typecheck`,
    `npx eslint --max-warnings=0 <touched files>`, `node scripts/check-isolation-denominator.mjs --self-test && node scripts/check-isolation-denominator.mjs`,
    every test file naming `get_budget_comparison` or `project_pmo_spent_position` (grep `supabase/ pmo-portal/ scripts/`),
    then the WHOLE pgTAP suite on the merge with dev after a reset, one hold:
    `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
14. Captures (task below). Commit, push the branch only; READY to Fable.

## Review plan

Spec, quality and security reviewers on Opus, each on the diff, separately. Security focus: the helper's guard equals
`project_pmo_spent_position`'s; security invoker; no org argument; RLS on `payments`/`procurements` still applies;
the ledger branch unreachable for a no-binding org and vice versa. One review round, one fix round.

## Captures (visible change: blank becomes figures)

`scripts/ux-proof.sh /projects/<id>/budget` before (dev) and after (branch), on a local org where
`org_reads_erp_ledger()` is false for the signed-in Finance user, with the AC fixture's purchases. Each at 1440 and
390 wide, English and Bahasa Indonesia (16 shots per side):
1. All years, categorised paid spend only (figures, remaining, % recorded).
2. All years with an uncategorised paid purchase (the Uncategorised row, totals equal the header).
3. All years with one other-currency paid purchase (that category unknown, others known).
4. A fiscal year selected (budget per year, recorded with the "needs an accounting system" reason).
Plus one control at 1440 English: a ledger-connected org's Budget tab, before = after.
Evidence to `docs/private/drive-20261115/lane3/evidence/2325-captures/`.

## Product question (one)

Without an accounting system, how is paid spending placed in a fiscal year? Options: (a) year scopes show recorded
as unknown with the reason, and the tab opens on All years; (b) place payments by calendar year when a year label
looks like a year; (c) add a PMO fiscal calendar (org setting: first month) and place payments by date.
**Recommend (a)** now: (b) parses opaque labels (forbidden, `budgetProjection.ts:364`) and (c) is a feature. If the
owner wants per-year figures, (c) becomes its own issue.

## Left out, and why

- `project_finance_actuals` (0560) still makes every category unknown when an uncategorised paid purchase exists; the
  Budget tab's "Budget vs actual by category" view uses it. The comparison now shows an Uncategorised row instead, so
  the two views of one tab differ on that case. File an issue under #459 to move that view to the same rule.
- Refactoring `project_pmo_spent_position` to read the new helper: touches every dashboard; the equality test holds
  the two together until then.
- Odoo-ledger orgs (`org_reads_erp_ledger()` true via 0765): unchanged by ruling.
- `get_budget_projection`: unchanged, reasoned above.
