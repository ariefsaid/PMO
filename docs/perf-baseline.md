# Performance baseline (#1741 part A)

Measured 2026-11-03 on the local stack with the seed data (17 projects, 21 procurements), dev server,
Chromium headless, desktop viewport. Tool: `node scripts/perf/measure.mjs [--lh] /route` (counts requests
to the API and sums response body bytes after the page is idle).
Baseline commit: `abfd61d0f` (origin/dev). Counts include React StrictMode double-fires of the dev server.

| Page | Role | Requests | Response bytes |
|---|---|---|---|
| `/` dashboard | Executive | 29 | 67,896 |
| `/` dashboard | Project Manager | **45** | **122,455** |
| `/projects/:id` project detail | Executive | 37 | 49,015 |
| `/procurement` | Executive | 17 | 45,698 |
| `/finance/receivables` | Executive | 19 | 66,882 |
| `/finance/payables` | Executive | 17 | 43,579 |

## Lighthouse (4x CPU, desktop, production build)

Measured 2026-11-06 with `scripts/perf/lighthouse-flow.mjs`: Lighthouse user flow, signs in through the real
login form, one navigation step per page, desktop preset, 4x CPU slowdown, `vite build` + `vite preview`
on the local stack with the seed data. Median-score run of 3 (scores swing 5-10 points run to run on a shared Mac).
Baseline commit: origin/dev at `bbdfadb7d`.

| Page | Role | LCP | TBT | CLS | Perf score | Largest JS chunk loaded (gzip) |
|---|---|---|---|---|---|---|
| `/` dashboard | Executive | 2.0 s | 1,330 ms | 0.267 | 47 | `repositories` 105.2 kB |
| `/` dashboard | Project Manager | 1.9 s | 1,210 ms | 0.102 | 58 | `repositories` 105.2 kB |
| `/projects/:id` | Executive | 2.1 s | 1,920 ms | 0.009 | 52 | `repositories` 105.2 kB |
| `/procurement` | Executive | 1.7 s | 1,880 ms | 0.058 | 56 | `repositories` 105.2 kB |
| `/finance/receivables` | Executive | 1.8 s | 1,710 ms | 0.005 | 58 | `repositories` 105.2 kB |

Chunk size is the gzip of the built file (the preview server does not compress; Cloudflare Pages does).

**How to re-run:** `cd pmo-portal && npx vite build --mode lh && npx vite preview --port 4199`, then from the
repo root `scripts/with-db-lock.sh node scripts/perf/lighthouse-flow.mjs [baseUrl]` (`LH_RUNS=n` sets the run count; default 3).
`--mode lh` loads `.env.local` and not `.env.production` (which holds only two feature flags), so the build points at the local stack with those flags unset. The script refuses a non-localhost `baseUrl` unless `--allow-remote` is passed, and reads chunk sizes from the default `pmo-portal/dist`.

## Audit result

- **Project Manager dashboard: N+1 found and fixed.** It read the full task list once per project
  (18 task requests for 9 projects) only to count overdue tasks. Now one batched, narrow read
  (`id, project_id, status, end_date`, `.in(project_id)`, chunked at 100, paged).
  After: **29 requests (-16), 92,605 bytes (-29,850)**; task requests 18 -> 2 (one is My Tasks).
  Counts per project unchanged: `useNeedsYou.pmTasks.test.tsx` asserts the per-project overdue numbers
  and one call (was one per project).
- Executive dashboard, project detail, procurement list, finance receivables/payables: no per-row
  requests (every endpoint repeats at most 3x, from shell/session reads and dev double-fires).
  Nothing worth fixing; numbers above.
- Font: `index.html` preloads the Latin variable file (covers all weights); `latin-ext` loads only when needed.

## Row counts for virtual scrolling (#1741 part B)

Measured 2026-11-03 against the local rich seed with exact `COUNT(*)` queries under the shared DB lock.
The question was which list actually renders **hundreds** of rows:

| Table / list surface | Rows |
|---|---|
| `tasks` (all projects; the project detail Tasks tab shows this project's subset) | 52 |
| `budget_line_items` (one budget version, not one flat table) | 41 |
| `stock_ledger` | 36 |
| `stock_document_lines` | 27 |
| `procurement_items` | 21 |
| `procurements` (procurement list) | 21 |
| `companies` (companies list) | 21 |
| `projects` (projects list) | 17 |
| `project_stage_entries` | 17 |
| `project_milestones` | 16 |
| `contacts` | 15 |
| `timesheet_entries` | 15 |
| `profiles` (admin user directory) | 11 |
| `stock_documents` | 8 |
| `project_documents` | 6 |

**Virtual scrolling: none qualified.** No list surface reaches even 100 rows on the rich seed, let alone the
hundreds that justify windowing (and every list above is already paged or capped in the repository layer).
TanStack Virtual was therefore **not** added — windowing a 17-row table would add a measurement surface and a
scroll-restoration edge case with no row removed from the DOM. Revisit when a real client's data crosses a few
hundred rows in one unpaged table; the row counts above are the trigger line.

## Load run (#1898)

`scripts/perf/load-run.mjs` replays, per route, the PostgREST/RPC calls a real page load makes (fixture
`scripts/perf/load-routes.json`, captured with a real browser by `scripts/perf/load-capture.mjs`). N virtual users
each load the page's whole call set in parallel (as the browser does), think about 1 s, and repeat for D seconds.
Latency is the whole page's call set, start of first call to end of last. Pages with any failed call are excluded
from the percentiles and counted under failed calls. Plain Node 22, no dependency; local stack only (refuses a
non-localhost `--url` unless `--allow-remote`).

**How to run** (one run at a time; the stack must be up and seeded):
`scripts/with-db-lock.sh node scripts/perf/load-run.mjs --users 50 --duration 60 [--routes project,procurement] [--think 1000] [--no-db-stats]`.
Routes: `dashboard-exec`, `dashboard-pm`, `project`, `procurement`, `receivables`. DB top statements come from
`pg_stat_statements` in the local DB container (skipped if unavailable). Re-capture the fixture after a page's
queries change: start `vite` on the local stack, then `scripts/with-db-lock.sh node scripts/perf/load-capture.mjs <baseUrl>`.
Fixture: user id, org id and date windows are placeholders resolved at run time (per signed-in user, from today);
virtual users on a route share one signed-in session; the project page uses the oldest project. The numbers below
were taken before the placeholders (same queries, same user).

First result, 2026-11-08, origin/dev at `44a0c0f8c` (+ this script), 50 users, 60 s per route, think 1 s,
Mac shared with other workers and a local Docker stack (not a dedicated host):

| Route | Calls/page | Pages | p50 ms | p95 ms | p99 ms | Failed calls | Failure statuses |
|---|---|---|---|---|---|---|---|
| dashboard (Executive) | 27 | 567 | 2482 | 7454 | 14163 | 176 | 502 x13, 504 x163 |
| dashboard (Project Manager) | 21 | 545 | 4442 | 7276 | 9361 | 15 | 502 x11, 504 x4 |
| `/projects/:id` | 21 | 1416 | 1027 | 1934 | 3602 | 23 | 502 x23 |
| `/procurement` | 16 | 1582 | 691 | 2297 | 3174 | 26 | 502 x26 |
| `/finance/receivables` | 18 | 2115 | 329 | 1122 | 1651 | 20 | 502 x20 |

Run-to-run spread is large on this host: an identical earlier run gave dashboard (Executive) p95 12.8 s, dashboard
(PM) p95 11.2 s, project p95 12.9 s (more 5xx). Compare before/after only from back-to-back runs, and read the
failure counts with the latencies. The 502/504 are the local PostgREST/gateway saturating at 50 concurrent users.

Heaviest statements by total DB time (both runs agree on the order): the Executive/PM dashboard RPCs
(`get_executive_dashboard`, `get_pm_dashboard_projects`, and the management-pack/delivery RPC family at 30 to 320 ms mean)
and the `procurements` list query (84 ms mean, 1,583 calls) with its project-embedded variant.

## `/procurement`: open commitment set-based (0723)

The list embedded `procurement_open_commitment(p)` per row (about 4.6 ms a row on a 1,021-row org, 2.2 to 2.5 s for the
list). `procurement_open_commitments(p_ids)` computes the same figures in one call (0 of 1,021 differ). The list now reads
them with one extra RPC per 1,000 rows. Back-to-back, 50 users x 60 s, same host:

| Run | Pages | p50 ms | p95 ms | p99 ms | 502 |
|---|---|---|---|---|---|
| before (`procurement`) | 1,116 | 1,524 | 4,343 | 6,408 | 21 |
| after (`procurement-set`) | 1,658 | 644 | 1,968 | 2,955 | 32 |

`procurements` list statement: 119.8 ms mean before, 20.3 ms after (plus 11.5 ms for the new RPC). Next heaviest on this
route: `get_procurement_approval_routes` (35 ms mean, 3 Requested rows).
