# Large organisation: lists and pickers (#2480)

Status: **measured on the local stack 2026-11-20.** One slow path was found and fixed; the picker needed no
change at 500 projects. Numbers are from this branch (`perf/2480-large-org-lists`) on a shared Mac (load average
~15, other agents' builds running), local Supabase stack, Vite dev server, Chromium headless, 1440×900.

## The organisation measured

`scripts/perf/large-org-seed.sql` (local only; never run by `seed.sql`, CI or any script) adds, on top of the
rich local seed:

- 500 projects — 308 live on the active Projects partition, ~40 archived, mixed stages incl. Leads/Negotiation
- 5,000 purchases spread over them

Inventory after the seed: 517 projects (467 live), 5,024 purchases. Invoices (5,000) and timesheet lines
(20,000) are still not generated — see "What is left".

Tooling: `scripts/perf/large-org-seed.sql` · `scripts/perf/large-org-explain.sql` (SQL timings run with the exec
member's JWT claims, so the batch RPCs pass their active-member gate) · `scripts/perf/large-org-measure.mjs`
(signs in, times first content and settled state per route, counts API requests/bytes and rendered rows/options).

## Measurements

### SQL (EXPLAIN ANALYZE, psql, warm stack)

| Read | Before (ms) | After — 1142 (ms) |
|---|---|---|
| Projects list page: full row + client/end_client/PM joins, active partition, 1,000-row page | 1.6 | 1.2 |
| Picker page 1 (active statuses, live, ordered by `id`, 1,000 rows) | 0.5 | 0.3 |
| Name search (`name ilike '%project 42%'`, 50 rows) | 0.6 | 0.5 |
| Project identity map (`id,name`, every stage, 1,000 rows) | 0.9 | 0.3 |
| **`get_projects_money_collection` for the 500 visible projects (page-load batch)** | **9,941** | **103** |
| `project_budget_positions` for the same 500 (page-load batch, unchanged code) | 156 | 91 |
| **`get_projects_delivery` for the same 500 (page-load batch)** | **1,983** | **8.3** |
| One project's purchases | 0.3 | 0.3 |

### End to end (`scripts/perf/large-org-measure.mjs`, dev server)

| Screen | Before | After — 1142 |
|---|---|---|
| `/projects` — first row on screen | 6,770 ms | 3,134 ms |
| `/projects` — settled (money/progress columns in) | **7,876 ms** | **4,136 ms** |
| `/projects` — rendered rows | 308 | 308 |
| `/meetings/new` — picker options on screen | 3,208 ms | 1,131 ms |
| `/meetings/new` — settled | 4,664 ms | 2,585 ms |
| `/meetings/new` — picker options | 309 | 309 |

Read these as directional only. The dev server compiles a route on first visit, the Mac was loaded (12+ agents),
and React StrictMode double-fires reads; the picker's improvement is that noise, not this change (its SQL and
bytes are identical before and after). The API request/byte totals are not comparable run to run for the same
reason (a duplicated 500-project money response is ~0.5 MB and StrictMode's second fire landed in the after run),
so the SQL table and the settled column carry the signal.

## The slow paths, and what changed

Both page-load batch reads looped over the project ids and called a per-project function for every row:

- `get_projects_money_collection` (0700 body): per project it called `get_project_finances` (ERP-ledger org — the
  local seed is one) or `project_pmo_spent_position` + `project_pmo_commitment_position`, plus five budget
  subqueries. 500 projects → **9.9 s**.
- `get_projects_delivery` (0396 body): per project it called `project_pmo_commitment_position`. 500 → **2.0 s**.

Migration **1142** (`supabase/migrations/1142_projects_collection_set_based.sql`) makes each one pass, reusing the
set-based forms that already exist for the same figures:

- ERP Actuals come from `project_mapped_actuals_all(null)` (0376, extended by 0497) — the org-wide form of the
  per-project read, proven row for row by its pgTAP — composed into exactly the JSON `get_project_finances` returns
  (including the tagged / attributed / equipment-charge split).
- PMO Actuals come from `project_pmo_positions(ids)` (0770) — the set-based spent/committed pair, proven equal to
  the per-project functions by `0770_dashboard_pmo_positions.test.sql`.
- The delivery commitment comes from `procurement_open_commitments(ids)` (0723) — the set-based open-commitment
  CASE, proven equal by `0651_committed_spend_equivalence.test.sql` — summed per project in the project currency.
- The budget columns keep the loop's three rules exactly (no Active version → NULL, an unreadable Active line →
  NULL, else the Active sum) in one aggregate.
- The ERP actuals pass is behind a lateral gate, so a PMO-basis org never pays for it.

Proof:
- `supabase/tests/0493_money_collection_single_read.test.sql` carries a copy of the old loop as an oracle and
  asserts row-for-row equality on both ledger bases for four roles, plus the role/validation errors. Its call-count
  assertions, which used to pin **one per-project call per project** (the defect), now pin **zero** per-project
  calls and one org-wide actuals read.
- New `supabase/tests/2480_collection_set_based.test.sql` (13 assertions) covers the delivery commitment beside
  the ERP and PMO bases — including that an ERP org's commitment follows the ledger basis while a PMO org's is the
  paid-basis remainder — plus foreign-currency withholding and the restricted role.
- Touched suites all pass unchanged: `0299`, `0700`, `0069`, `0075`, `project_commitment_currency`, `0770`,
  `0145`, `0308`, `0311`, `0651`, `equipment_project_actuals`, `cost_attribution`.

Red → green: on the pre-1142 schema the updated `0493` fails exactly its three new call-count assertions
(tests 11–13 of 21); after 1142 the same file passes, and the 14-file run is **402 tests, all pass**.

## Index decision

**No index or follow-up migration for this performance change.** The explain shows the list read as a 308-row sequential scan + sort
(1.2 ms), the picker page as 0.3 ms, and the name search as 0.5 ms over 517 rows. An index cannot improve a scan
that small, and none of the measured waits was on one.

## What is left

1. Generate the 5,000 invoices and 20,000 timesheet lines the issue asks for, then measure the home screen and
   Reports on the same organisation (both read invoices/timesheets, which the seed does not yet create).
2. File one ticket per screen that still stalls. Nothing is left unexplained on the two measured screens; home
   and Reports are unmeasured.
3. Add the large-organisation journey (find a project by name from the list and from a picker). It cannot ride the
   normal e2e seed: the 500-project organisation is a local perf fixture, so the spec must seed its own rows or
   stay a manual runbook step.

## Re-running

```bash
# one lock hold: reset, seed, explain
scripts/with-db-lock.sh bash -c 'supabase db reset --yes \
  && psql "$LOCAL_DB_URL" -f scripts/perf/large-org-seed.sql \
  && psql "$LOCAL_DB_URL" -f scripts/perf/large-org-explain.sql'
# app-level (dev server already running on 5190):
scripts/with-db-lock.sh node scripts/perf/large-org-measure.mjs http://localhost:5190
# undo
scripts/with-db-lock.sh supabase db reset --yes
```
