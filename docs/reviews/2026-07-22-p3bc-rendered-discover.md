# P3b/P3c rendered Discover pass — 2026-07-22 (`855e22d8`)

ADR-0030 Discover: the rendered unknown-unknown net. 5 surfaces, ~1,740 lines of UI, **never
rendered-verified before this pass**. Driven with the **`agent-browser` CLI** (owner-binding: never the
Playwright MCP). Screenshots + DOM/`getComputedStyle` measurements, not code reads.

**Verdict: REWORK on Budget projection. Fix-then-ship on the other four.**

> ⚑ Unit tests passed on every one of these surfaces the whole time. This program has now had four
> audit rounds, an e2e pass and a rendered pass each find real defects the others missed.

---

## The through-line: the money-honesty class survived at a smaller scope

`f9b48500` fixed "Actuals to date is structurally 0.00" at **project** scope. The rendered pass found
the identical class alive at **category** scope, and worse:

- **C-1** — a genuine zero, "no GL rows", and "no ERP account mapped at all" **all render `$0`**,
  byte-identical. `get_budget_projection`'s `coalesce(a.actuals_to_date, 0)` (mig 0141) erases the
  distinction before the FE can see it. Return NULL for "no mapped actuals"; render `—`. Reserve
  `$0.00` for a real zero.
- **C-2** — a category the banner *itself* flags as UNMAPPED still prints a confident `$0` actual, a
  full-budget variance and `0%` utilization, two inches below the warning. **The screen knows the
  figure is unobtainable and states it anyway.**
- **C-3** — with "No fiscal year on record" the table still renders a complete, plausible, **fabricated**
  money grid ($4.7M budget, $0 spent, 0% utilized) for a project with no ERP linkage. The
  `rows.length === 0` empty state is unreachable because `pmo_budget` in the RPC is not year-scoped.
- **C-5** — `pending`, `pushing` and `pushed` render **nothing at all**, indistinguishable from each
  other and from "this org has no ERP". `erp_budget_name` is stored and never shown. The timesheet
  `PushStateBadge` does the opposite in the same product.

**Rule to record:** *a state that renders nothing is a defect, not a default — silence is
indistinguishable from absence.*

## The other Critical: an identity decision with the identity withheld

- **C-6** — the employee-link confirm dialog says it will attribute hours "to **the matched PMO user**"
  and **never names that user**, on the card or in the dialog. `profile_id` is on the row, unused for
  display. The component's own docstring calls this too consequential to auto-confirm; it is then
  presented with the destination identity hidden.
- **C-7** — `Confirm` is offered on a row that identifies nobody (`Unknown employee` / `No email`), while
  `employee_number` — the one stable identifier — is fetched and never displayed. An Admin can
  re-point a week of hours with zero identifying facts on screen.

## Also notable
- **C-4** — two contradicting "Actual" columns ~100px apart on the same tab (version grid `$1,200,000`
  vs projection `$1,150,000`), with nothing saying which governs.
- **I-13/I-14** — the timesheet Retry gives **zero** feedback (no toast, no state change, no console
  error) and is offered for `erpnext-activity-type-missing`, which retry can never fix. The budget
  surface got this contract right for `unstamped-activation`; the timesheet surface does the opposite
  for a structurally identical case.
- **I-16/I-17** — 3 of the badge's 5 states are unreachable in the running app, and the timesheet OWNER
  can never see that their own hours failed to reach ERP (`getPushState` has zero consumers, though
  RLS deliberately grants the owner that read).
- **I-1** — money cells lost `tabular-nums`; the table stacked directly above them has it
  (`DESIGN.md` §3 calls it mandatory on every comparable figure).
- **I-3/I-4** — focus dumped to `<body>` on ETC open/cancel/save; the validation error has no
  `aria-invalid`/`aria-describedby` because it is a hand-rolled input instead of the mandated
  `TextField`/`FieldError` primitives.
- **I-9** — at 390px money is silently truncated mid-figure (`$450,00`) with no scroll cue. A truncated
  currency figure that still looks like a currency figure is a money-legibility defect.

## What was genuinely GOOD (rendered, not assumed)
- All 7 push states honour the retry contract: `unstamped-activation` explains the real route and
  offers **no** Retry; `held`/`never-pushed`/`failed` all offer it.
- `unmapped_categories` renders as a real accessible `<ul>` naming the categories — the
  `aria-labelledby` override bug did NOT ship.
- The account map's bijection-conflict error is the best-executed error state in the slice, and that
  page is **axe-clean**.
- No page-level horizontal overflow at 390px (`AC-MOBILE-OVERFLOW-001` holds).

## `DESIGN.md` drift found
The app's REAL table tokens are 68px rows / 13.5px cells / 11.5px 0.03em headers (measured on
`/projects`). `DESIGN.md` §"Data Table" states 54px/38px/11px/0.06em and is **stale** — reconcile it or
the drift is unarbitrable.

## Graduation list
Every finding above graduates to a test + a `routes × oracles` cell; the full table is in the agent
report. Highest-value cells: `budget-tab × money-honesty` (C-1/C-2), `budget-tab × no-fiscal-year`
(C-3), `budget-tab × push-state` (C-5), `approvals × employee-link` (C-6/C-7),
`global × error-copy` (no raw `kebab-case:` adapter token may reach the DOM).
