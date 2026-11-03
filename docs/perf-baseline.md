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

## Row counts for virtual scrolling (#1741 part B)

Measured 2026-11-03 against the same local rich seed (the standard `supabase/seed.sql`, one `db reset`,
`pg_stat_user_tables.n_live_tup`). The question was which list actually renders **hundreds** of rows:

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

