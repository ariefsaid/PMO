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

Lighthouse (4x CPU throttle): **not recorded.** The CLI could not drive the logged-in tab through the
remote-debugging port (navigation target closed / hang, three attempts, dev and production build). Needs
its own slice: a Lighthouse user-flow script that signs in itself.

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
