# Budget split from the CLI and loader — implementation plan (#1423)

> For agentic workers: run through supervised Orca workers with TDD. Paths are repo-relative. This is a
> money-adjacent but not money-path change (writes Draft planning rows only); one PR, ships alone.

**Goal:** `pmo load` and a new `pmo budgets split` create or update a whole-project Draft with a proposed
split by duration (or percentages/amounts), with a dry-run grid.
**Spec:** `docs/specs/budget-split-cli.spec.md`. **Migrations:** none. If the owner answers Q1 "yes, new RPC",
the number is **0000 — number on request**.
**Architecture:** the CLI computes with the shipped pure functions and writes through existing RPCs only.

## Grounding (read at planning time)

- `scripts/lib/pmo-load.mjs`: `LOAD_BUDGET_MODE` (line 80), `LINE_FIELDS` (90), `validate` budget block (211–226),
  `resolveBudget` (385–402, skips whole-project), `applyBudget` (593–630).
- `scripts/pmo.mjs`: `LOAD_RPCS` (113), `assertRpc` (287), `budgets()` (1538), `--help` text (~806–840), `BOOL_FLAGS` (702).
- `pmo-portal/src/lib/budget/budgetDistribution.ts` (`byDays`, `fromPercents`, `fromAmounts`, `yearsInSpan`) and
  `savedDistribution.ts` (`planFor`, `categoryTotals`) are `.ts`; the CLI is `.mjs`. Task 1 decides the bridge.
- Calendar: `external-items` with `{ purpose: 'budget-project-calendar', projectId }` (repository
  `pmo-portal/src/lib/repositories/budgetProjection.ts:198`). Save RPC: `supabase/migrations/0577_budget_distribution_rpc.sql`.

## Tasks

### T1 — bridge the pure code to the CLI (AC-002)
- [ ] Check how `scripts/lib/*.mjs` already import portal TS (`grep -rn "pmo-portal/src" scripts/lib`). If a pattern exists, reuse it; else add `scripts/lib/budget-distribution.mjs` that imports the TS via the same loader the repo's `.mjs` tests use (node 22 `--experimental-strip-types`, or a thin built copy guarded by a parity test).
- [ ] Failing test `scripts/lib/budget-distribution.parity.test.mjs`: `byDays('300.00','2027-12-31','2028-01-02', calendarYears)` equals the TS result; a leap-day case.
- [ ] Run `node --test scripts/lib/budget-distribution.parity.test.mjs`; implement; green.

### T2 — file shape and validation (AC-004, AC-010)
- [ ] In `pmo-load.mjs` add `budget_mode` (`per_year` default | `whole_project`) and `budget_split` to the project field set; reject `fiscal_year` on lines when whole-project; validate method, `years` keys, value text.
- [ ] Failing tests in `scripts/lib/pmo-load.split.test.mjs`: each refusal names project/category/year; a file without `budget_mode` validates as before.
- [ ] `node --test scripts/lib/pmo-load.split.test.mjs scripts/pmo-load.test.mjs`.

### T3 — plan the grid (AC-001, 003, 005, 006)
- [ ] Add `planSplit(entry, calendar)` using `yearsInSpan` + `planFor`; categories from summed line totals (exact cents); return rows plus issues. No end date → start-year only.
- [ ] Calendar fetch helper calling `external-items` `budget-project-calendar`; unavailable → refusal text, no fallback.
- [ ] Tests: 3 categories × 2 years sum; 0/40/60 with kept zero; override; unavailable calendar.

### T4 — dry-run output (AC-001, FR-008)
- [ ] `formatSplitGrid(plan)` → fixed-width table (years across, categories down, totals row). Wire into `pmo load --dry-run` and apply output. Snapshot-free: assert cells and sums.

### T5 — apply (AC-007, AC-008)
- [ ] In `resolveBudget` replace the whole-project skip with: compare saved snapshot (`get_budget_distribution_snapshot`) to plan → `unchanged` / `refuse (differs)` / `apply`.
- [ ] In `applyBudget`: create the version with `budget_mode: 'whole_project'`, lines without `fiscal_year` (check `import_budget_line_v2` accepts null year; the app import already sends null), then `save_budget_distribution` once with the printed rows.
- [ ] Add `save_budget_distribution` and `get_budget_distribution_snapshot` to the loader's RPC allowance only (`LOAD_RPCS`; keep them out of `ALLOWED_RPCS`). Test the allowlist.

### T6 — `pmo budgets split` (AC-009)
- [ ] Extend `budgets()` with `split`; flags `--split by-duration`, `--percent`, `--amount`, `--category`, `--dry-run`; update `--help` and the header comment. Reads the version's lines and project dates through existing reads. Per-year/Active → surface the server refusal.
- [ ] Tests with mocked `authed`.

### T7 — journey and docs (AC-011)
- [ ] One local-stack check (`scripts/e2e-local.sh`) or a scripted run: load a fictional two-year project, open `/projects/<id>/budget` in the app, confirm the grid equals the dry-run. Record under `pmo-portal/e2e/` only if the repo's CLI-journey convention allows; otherwise a documented manual check in the PR.
- [ ] Update `docs/runbooks/pmo-cli.md` (new file fields, command, safety) and the `budget-whole-project.spec.md` CLI note; replace the "legacy imports retain annual meaning" row with the new behaviour.

## Gate (builder, before the PR)
`npm run check:guards`; `npm run typecheck`; `npx eslint --max-warnings=0 <touched>`; `node --test scripts/lib/pmo-load.split.test.mjs scripts/pmo-load.test.mjs scripts/lib/budget-distribution.parity.test.mjs`; no pgTAP unless a gap is found (then `scripts/with-db-lock.sh supabase test db <file>`).

## Traceability (ADR-0010)

| AC | Layer | Owning test |
|---|---|---|
| 001–008, 010 | unit | `scripts/lib/pmo-load.split.test.mjs`, `scripts/lib/budget-distribution.parity.test.mjs` |
| 009 | unit | `scripts/pmo-budgets-split.test.mjs` |
| 011 | e2e / documented journey | T7 |
| 012 | pgTAP | `supabase/tests/budget_whole_project_roles.test.sql` (existing) |

## Owner questions
1. Should the loader file take the split inside the project entry (as specced) rather than a separate `--split` flag? Recommend: inside the entry (reviewable, per-project), plus `--split` only on `pmo budgets split`.
2. Should re-running `pmo load` with a different split overwrite an unactivated Draft's saved split? Recommend: no — refuse and point to `pmo budgets split`, which is the explicit overwrite.
3. Does the app's spreadsheet import wizard also need a split option? Recommend: no — its rows stay per-year, and the app grid already splits whole-project Drafts; revisit if operators ask.
