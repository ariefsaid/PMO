# Vendor TanStack Table → `DataTable` — assessment trial (QA portfolio, ADR-0030 §F Layer-0)

**Date:** 2026-06-16 · **Mode:** ADR-0030 `portfolio`, Layer-0 (vendor-to-shrink) feasibility spike
**Orchestrator:** acting-Director subagent, GLM-only routing (gpt-5.4/openai-codex unavailable)
**Repo @** `d7447dd` (main) · **Branch:** none created (assessment stopped at gate — no build)

## Verdict (one line)

**ASSESSED → RECOMMEND DEFER.** Do **not** swap `@tanstack/react-table` into `DataTable`. The premise
("replace the internal state engine") is **misframed**: `DataTable` is a **controlled presentational
component with no internal table-state engine to replace**. The swap is net-negative — new dependency +
render-rewrite for byte-identical markup + regression risk on 4 tightly-coupled a11y/markup test files +
breaks the raw-`Row` contract — for **zero functional gain**. A clean "don't do this swap" is the result.

## The loop that ran

- **Phase 1 — feasibility assessment (pi `glm-5.1`, READ-ONLY):** dispatched a self-contained brief to read
  `DataTable.tsx` + its 4 test files + the reference consumer (`Companies.tsx`) and grep all consumers; answer
  the API surface, internal-vs-controlled ownership per concern, what `useReactTable` actually manages, and a
  build/rescope/defer recommendation. Ran ~150s, ended on `ASSESS-DONE` sentinel (`/tmp/tanstack-assess.log`,
  87 lines). Dispatch pattern: subagent-blocking-foreground poll-the-log per `pi-delegation.md` §3c-bis.
- **Director verification (me):** independently read `DataTable.tsx` + `DataTable.test.tsx` + `Companies.tsx`
  BEFORE the dispatch, then verified every load-bearing pi claim against the actual files (below). Smoke-tested
  both `glm-5.2` and `glm-5.1` first (both `OK`).
- **Decision gate → DEFER → STOP.** No worktree, no install, no Phase-2 build. (Per brief: assessed-and-defer
  is a SUCCESS outcome.)

## Why DEFER — the load-bearing finding (verified against source, not just pi's word)

`DataTable` owns **no** tabular state. Every "table engine" concern is either parent-controlled or absent:

| Concern | Ownership in `DataTable` | Evidence (verified by Director) |
|---|---|---|
| **Sorting** | **Controlled prop / parent-owned** | `sort?: SortState` + `onSort?` (`DataTable.tsx:58-59`); component only paints `aria-sort` (L183) and forwards `onSort?.(col.sortKey!)` (L193). **Never reorders `rows`.** Sole sort consumer `FinanceDashboard.tsx:220` does `sorted.sort(...)` in parent state. |
| **Filtering** | **Not present** | No filter prop. `Companies.tsx:94` filters in a parent `useMemo`, passes pre-filtered array as `rows={filtered}` (L303). |
| **Pagination** | **Not present** | No page props/state; `rows.map(...)` renders the whole array (`DataTable.tsx:218`). |
| **Row selection** | **Single controlled highlight** | `selectedKey?: string` (L57) — one-row tint only; no multi-select Set, no `onRowSelectionChange`. |
| **Mobile `<768px` card view** | **Internal — but NOT table state** | `useIsDesktop()` viewport switch (L135) → `<ul>`/`<li>`/`<dl>` card branch (L301-399). TanStack has no card concept. Stays bespoke regardless. |
| **`rowMenu` kebab popover** | **Internal — but NOT table state** | `RowMenu` owns `open`/`active`/`pos` (L428-433): portal-to-body, fixed flip-up positioning, roving tabindex, focus return, `stopPropagation` that stops menu clicks firing `onActivate`. TanStack has zero popover primitives. |
| **empty/loading/error** | **Controlled prop** | `state?` → delegates to `ListState` (L140-160). |

**Net internal state in the entire file:** `RowMenu.{open,active,pos}` + the `useIsDesktop()` flag. **Neither is
tabular state**, so `useReactTable` (whose whole value is a stateful sorting/filtering/pagination/selection model)
would take over **nothing**. It would be a passthrough: parent → already-sorted/filtered `rows` → `getRowModel()`
→ same rows → existing `cell(row)`/`rowKey(row)` mapping. Pure indirection.

### Confirming facts (verified)
- `@tanstack/react-table` is **NOT installed** — `package.json` has only `@tanstack/react-query@^5.101.0`.
  `useReactTable`/`flexRender`/`getRowModel` appear **nowhere** in `src`/`pages`. (So no half-done prior attempt.)
- Supply-chain note moot (nothing installed): the May-2026 worm hit other `@tanstack` pkgs, not
  `@tanstack/table`; `qa-portfolio.md` already records it as "confirmed not hit by CVE-2026-45321." Pin-exact +
  lockfile-integrity guidance would apply **only if** a future RESCOPE actually adopts it.

## Costs the swap would incur (why it's net-negative, not neutral)

1. **Render rewrite for byte-identical output** — to keep markup byte-for-byte you'd hand-write the *same*
   `<th>/<td>` JSX through `getHeaderGroups()`/`flexRender` that the code already writes with `columns.map`. Churn.
2. **Breaks the raw-`Row` contract** — consumers' `cell: (c: CompanyRow) => …` receive the raw typed row today;
   TanStack wraps each in `Row<Row>` (`row.original`). Keeping `Column<Row>`/`cell(row)` byte-identical needs an
   unwrap adapter everywhere — friction for zero benefit, and a place for subtle drift.
3. **Regression risk: M** — 4 test files are tightly coupled to exact DOM/ARIA: `aria-sort`,
   `getByRole('row')` count keeping `<tr>` implicit `role="row"`, the in-cell activation button's
   `focus-visible:outline-offset-2` + `stopPropagation`, the card branch `<dd>` `min-w-0`/`break-words` clipping
   guards, the portaled-menu-not-in-`dt-table-branch` assertion. These exist precisely to catch the kind of node/
   class/role drift an instance indirection introduces. High surface, zero new capability.

## When to RESCOPE (the only future trigger)

Revisit **only** if a concrete driver appears that `DataTable`'s controlled model can't cheaply serve:
**server-side or client pagination across many tables, multi-row selection, column pinning/resizing, or
client-side multi-sort**. Then adopt TanStack **behind the current public API**, driving only the desktop
`<table>` branch's sort/pagination — leaving `RowMenu`, the mobile card branch, `ListState`, and the
`cell(row)`/`Column<Row>` contract exactly as-is (pin exact + lockfile integrity + Dependabot at that point).
Until that driver exists: **leave it custom.**

## Recommended action for the vendoring backlog

Update `docs/qa-portfolio.md` Layer-0 table: change the **Tables / data-grid** row from
`backfill-on-touch` to **"DEFER — DataTable is controlled/presentational; no engine to replace. RESCOPE only on
a real pagination/selection/multi-sort/pinning driver (2026-06-16 assessment)."** (Doc edit only — Director to
apply; I did not touch tracked files per the orchestrate-only constraint.)

## Process notes

- **Doc sufficiency:** ran the loop from the docs alone with no gaps. `qa-portfolio.md` §Layer-0 + ADR-0030 §F
  framed the spike; `pi-delegation.md` §3c-bis gave the correct subagent dispatch pattern (blocking-foreground +
  poll-the-log — the `&`-launched pi was auto-backgrounded by the harness exactly as §2 warns, and the in-turn
  sentinel poll handled it). One framing gap *in the issue brief itself* (not the repo docs): it assumed an
  internal state engine that doesn't exist — the assessment-first gate caught it, which is the gate working.
- **GLM perf (`glm-5.1`, assessment):** excellent. Read all files, correctly classified every concern as
  controlled/internal/absent with accurate line citations, independently found the FinanceDashboard-is-the-only-
  sorter fact and the raw-`Row`-vs-`row.original` contract break, and reached the same DEFER verdict I reached
  independently. No hallucinated APIs, no scope drift. Same-family-only (no cross-family reviewer) was acceptable
  here — read-only assessment, no code shipped.

## Bottom line

**ASSESSED → RECOMMEND DEFER, because `DataTable` is a controlled presentational component with no internal
sort/filter/pagination/selection engine for `@tanstack/react-table` to replace** — the swap adds a dependency +
render indirection + regression risk on heavily-tested a11y/markup and breaks the raw-`Row` contract, for zero
functional gain; the only genuinely internal state (the `RowMenu` popover and the mobile card view) is state
TanStack categorically does not own. No branch created; no gates to run (nothing built). One follow-up doc edit
recommended (the backlog-row status flip above) for the Director to apply.
