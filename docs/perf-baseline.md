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

### Re-baseline 2026-11-08 (origin/dev `44a0c0f8c`)

Same method as above (median-score run of 3, 4x CPU, desktop, production build, rich seed, run under `scripts/with-db-lock.sh`).
The Mac was busy (load average 17-20, other workers building), so absolute numbers carry noise; the 11-06 figures were taken on a quieter machine.

| Page | Role | LCP 11-06 -> 11-08 | TBT 11-06 -> 11-08 | CLS 11-06 -> 11-08 | Score 11-06 -> 11-08 | Largest JS chunk (gzip) |
|---|---|---|---|---|---|---|
| `/` dashboard | Executive | 2.0 s -> 1.7 s | 1,330 -> **900 ms** | 0.267 -> 0.010 | 47 -> 65 | `repositories` 105.2 -> 107.0 kB |
| `/` dashboard | Project Manager | 1.9 s -> 1.8 s | 1,210 -> **620 ms** | 0.102 -> 0.012 | 58 -> 68 | same |
| `/projects/:id` | Executive | 2.1 s -> 1.9 s | 1,920 -> **1,240 ms** | 0.009 -> 0.030 | 52 -> 60 | same |
| `/procurement` | Executive | 1.7 s -> 1.6 s | 1,880 -> **1,280 ms** | 0.058 -> 0.061 | 56 -> 63 | same |
| `/finance/receivables` | Executive | 1.8 s -> 1.7 s | 1,710 -> **1,240 ms** | 0.005 -> 0.007 | 58 -> 63 | same |

TBT is still 0.6-1.3 s on every page. The two worst are project detail and procurement (receivables ties project detail).
Run-to-run spread on the same build: project detail 1,300-1,390 ms, procurement 1,090-1,160 ms, dashboard 860-1,500 ms (two partial runs).
`repositories` grew 1.8 kB gzip since 11-06.

**Script fixes needed to get these numbers** (`scripts/perf/lighthouse-flow.mjs`; on the unfixed script every metric came back `undefined`):
- Root cause of "login hangs / undefined metrics": the Mac's display was asleep, so headless Chrome produced no frames (`requestAnimationFrame` never fired, no first paint, Lighthouse `NO_FCP`, `page.waitForFunction` hung). `caffeinate -u -d -t 7200 &` before the run fixes it. Check with a 5-line probe: `requestAnimationFrame` resolves and `performance.getEntriesByType('paint')` is non-empty.
- Project row: rows have no anchor and a handle click hung; the script now reads the first `tbody tr[id]` and opens `/projects/<id>` before the flow starts (no page interaction between Lighthouse steps).
- Login/route waits poll `page.url()` from Node; `protocolTimeout` raised to 600 s; `LH_ARTIFACTS=<dir>` saves each run's traces. Use your own preview port (another worker may own 4199).

### Where the 4x main-thread time goes (CPU profile, 2026-11-08)

`scripts/perf/cpu-profile.mjs`: CDP CPU profiler (200 us sampling) at 4x CPU on a sourcemapped production build, one page load plus 8 s settle,
Executive, rich seed. Times are wall ms at 4x. Also counts React commits (via a stub DevTools hook, no product code change) and `Intl` constructions.
Not under the DB lock (read-only; machine load 17-20), so use for attribution, not as a benchmark.
Re-run: `cd pmo-portal && npx vite build --mode lh --sourcemap --outDir /tmp/sm --emptyOutDir && npx vite preview --outDir /tmp/sm --port 4298`, then
`node scripts/perf/cpu-profile.mjs http://localhost:4298 /tmp/sm exec@acme.test / /projects/:id /procurement /finance/receivables`.

| Page | React commits | Tasks over 50 ms (4x) | Sum of those tasks | JS self time | `Intl.DateTimeFormat` constructions |
|---|---|---|---|---|---|
| `/` dashboard | 43 | 17 | 1,747 ms | 2,268 ms | not measured |
| `/projects/:id` | 33-39 | 7-9 | 1,233-1,517 ms | 1,708-2,161 ms | 5 = 73 ms |
| `/procurement` | 24 | 9-11 | 1,377-1,566 ms | 1,751-1,900 ms | 2 = 68 ms |
| `/finance/receivables` | 29 | 8 | 1,159 ms | 1,729 ms | not measured |

Top long tasks, project detail (4 profiles agree within about 10%):
- 540-567 ms task: `src/components/ui/Tabs.tsx:59` (the scroll-active-tab effect) **270 ms self**; it only reads two rects and one computed style.
- 388-478 ms task: `src/lib/format.ts:45` `dateFormatterFor` **71-84 ms self** (two to five `new Intl.DateTimeFormat`, about 34 ms each at 4x), plus `appendChild` and the agent runtime (`pmoNativeRuntime.ts:76`) 14 ms.
- 309-456 ms task: mostly native style/layout/paint (`(program)` 72-77 ms), `AssistantPanel`/`Transcript.tsx:78`/redux-toolkit work 14-45 ms, i18next init.

Top long tasks, procurement:
- 569 ms task: `format.ts:45` 73 ms, `appendChild` 27 ms, react-router single-fetch 22 ms, native layout 150 ms.
- 488 ms task: `src/components/ui/DataTableDesktop.tsx:64` (`measure()` inside a `useLayoutEffect`) **220 ms self**, TanStack table 16 ms.
- 87 ms task: `Tabs.tsx:59` 35 ms.

Receivables repeats the table pattern (`DataTableDesktop.tsx:64` 141 ms self in a 397 ms task; `Transcript.tsx:78` 46 ms; `Rail.tsx:184` 23 ms).
Dashboard has no single hotspot: 17 tasks of 50-200 ms, i18next lookups (`translate`, `extractFromKey`, about 100-150 ms across tasks),
react-router `hooks.js` 83 ms, `react-dom` commit 98 ms, `format.ts` 79 ms.

The two biggest self-time items (`Tabs.tsx:59`, `DataTableDesktop.tsx:64`) only read layout (`getBoundingClientRect`, `scrollWidth`) inside an effect:
the profiler bills them with the **first forced style+layout of the whole page**. The cost is real layout work, not the two lines; moving the read
moves the work to the next frame, which splits the task (about 50 ms of TBT per split) but does not remove it. Only shrinking what must be laid out removes it.

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
## Next slices (2026-11-08)

Ranked by expected TBT saving per page at 4x (from the profiles above). "Verify" = the saving is an estimate to confirm with Lighthouse median of 3 before and after.

1. **Cut the first-frame layout the page pays inside effects (project detail 270 ms, procurement 220 ms, receivables 141 ms).**
   What: (a) `DataTableDesktop` `useOverflowMeasure`: drop the synchronous `measure()` in `useLayoutEffect`
   (`ResizeObserver` already delivers an initial entry after layout) and give the table `table-layout: fixed` (column widths are already inline);
   (b) `Tabs.tsx:59`: run the scroll effect only when `value` changes after mount, not on first mount; (c) `content-visibility: auto` plus
   `contain-intrinsic-size` on below-the-fold project-detail blocks so they are not laid out in the first frame.
   Expected: (a)+(b) split the task (about 50 ms each); (c) removes real layout (the part worth 100-250 ms on project detail). Verify (c) first, it is the only part that removes work.
   Evidence: `DataTableDesktop.tsx:64` 220 ms self (procurement), `Tabs.tsx:59` 273 ms self (project detail), native `(program)` 150 ms in the largest procurement task.
   **Result (2026-11-08, `perf/first-frame-layout`).** Lighthouse TBT swings 300+ ms run to run on this Mac (project detail 920 / 1,230 / 1,140 ms for base / (c) / all), so it cannot resolve a 50-100 ms change; used Chrome's own `Performance.getMetrics` (LayoutDuration, TaskDuration) at 4x CPU instead, median of 7, same page DOM (591 vs 590 nodes, same h1).
   - (b) `Tabs` skips its first-mount scroll when the first tab is active (a deep link to a later tab still scrolls): project detail Layout 306 -> 88 ms, Task 2,141 -> 1,919 ms.
   - (c) `content-visibility:auto` on the overview Delivery block: Layout 302 -> 258 ms and 306 -> 294 ms in two runs (noisy), Task 2,209 -> 1,955 ms and 2,141 -> 2,015 ms. Kept.
   - (a) `DataTableDesktop` without the synchronous measure: procurement Layout 238 -> 242 ms, receivables 217 -> 261 ms. No gain, reverted. The measure is not the cost; the layout it forces is needed anyway.
   - Procurement and receivables unchanged by this slice.

2. **First `Intl.DateTimeFormat` costs about 34 ms each at 4x; every page builds 2-5 on first render (68-73 ms).**
   What: find which `dateFormatterFor` shapes run during first render (the ones that pass a `timeZone` are the first suspects; not yet confirmed); build the zoned ones
   from one shared formatter, or construct them in a post-paint idle callback after the first frame so first render uses a plain formatter.
   Expected: -60 to -70 ms per page on 4 of 5 pages (the cost is inside a 400-570 ms task). Verify with `Intl` construction counts from `cpu-profile.mjs` (count must drop, not just move).
   Evidence: `format.ts:45` 60-84 ms self on all pages, `Intl.DateTimeFormat` 2 constructions = 68 ms on procurement.
3. **Do not mount the assistant panel until first opened.**
   What: `Transcript.tsx`, `pmoNativeRuntime.ts`, `AssistantPanel` chunk and redux-toolkit show up on pages that never open it; mount lazily on first open (keep the shortcut and button).
   Expected: -40 to -80 ms per page (`Transcript.tsx:78` 14-46 ms, `pmoNativeRuntime.ts:76` 14 ms, redux-toolkit 15 ms, `AssistantPanel-*.js` 8-14 ms per page). Verify.
   Evidence: those frames in the 300-460 ms project-detail and receivables tasks.
4. **Dashboard: 43 React commits and 17 long tasks, no hotspot, so cut commits.**
   What: group the dashboard's queries so they settle together (one batched read for the tiles that arrive one by one), or `useDeferredValue`/`startTransition` the below-fold sections so the first tasks stay under 50 ms.
   Expected: dashboard TBT 900 -> 700 ms (each 50-200 ms task that drops under 50 ms removes its whole excess). Verify.
   Evidence: 17 tasks, sum 1,747 ms, no function above 100 ms self; commits 43 vs 24-33 elsewhere.
5. **Shell re-renders per load (24-43 commits on every page).**
   What: audit what re-renders on each query settle: `Rail.tsx:184` 18-23 ms, `ApprovalsNavCount.tsx` 8-11 ms, `AgentContextProvider.tsx:56` 8 ms, `I18nProvider.tsx:53` 10 ms; `memo` or narrow the selectors.
   Expected: -30 to -60 ms per page. Verify by commit count from `cpu-profile.mjs` (24-43 now).
6. **i18next lookup cost (dashboard 100-150 ms across tasks, receivables 161 ms task with `translate` 26 ms self).**
   What: stop re-resolving keys per render (hoist `t` results for static labels into `useMemo`), and check namespaces are loaded once; the `addResourceBundle`/`init` work (21 ms on project detail) should run before the first route renders, not inside it.
   Expected: -50 to -100 ms on dashboard and receivables. Verify.
7. **Low priority: CLS on procurement 0.061 (needs-you tabpanel) and project detail 0.030.** Both under the 0.1 line; reserve the panel's height. No TBT effect.

Not worth doing from this data: more vendor chunk splitting (`repositories` is 107 kB gzip and `vendor-react` script time is React running component code, not chunk evaluation; chunk evaluation shows as 12-20 ms per chunk); another table virtualization pass (row counts above are far under the trigger).
