# Large organisation: lists and pickers (#2480)

Status: tooling and analysis only. **No timings were taken**: the cloud session had no Docker, so the local
stack could not start. Nothing below is a measurement; the "before" and "after" columns are empty on purpose.

## What exists (read from `pmo-portal/src/lib/db/projects.ts` at origin/dev)
- `listProjects`, `listProjectPickerOptions`, `listProjectIdentity` read the whole table through `fetchAllPages`
  (#1774): complete past the 1,000-row cap, ordered by `id`. At 500 projects each is one request; at 2,500 it is three.
- Pickers read the whole active set and filter in the browser; the list does the same.
- Indexes on `projects`: `(org_id)`, `(org_id,status)`, `(project_manager_id)`, `(client_id)`, partial `(org_id) where archived_at is null`.
  `procurements` has `(project_id)`. Nothing indexes `name`.

## Tooling added
- `scripts/perf/large-org-seed.sql`: 500 projects (~10% archived) and 5,000 purchases. Invoices (5,000) and timesheet lines
  (20,000) are not generated yet.
- `scripts/perf/large-org-explain.sql`: EXPLAIN ANALYZE of the picker page read, a name search, and one project's purchases.

## Measurements (to fill in)
| Path | Before | After |
|---|---|---|
| Picker page-1 SQL (ms) | | |
| Name search SQL (ms) | | |
| Projects list, request count / bytes | | |
| Home, Reports | | |

## Decision rule for fixes (no migration filed: 1022-1023 unused)
Add an index or server-side search only where the explain above shows a sequential scan that costs time at 500 rows.
The likely candidates, unproven: a trigram index for name search, and server-side search for pickers once a picker
needs more than one page. Do not add them without the numbers.

## Next steps
1. Run the seed and explain on a machine with Docker; record the numbers above and in `docs/perf-baseline.md`.
2. File one ticket per screen that stalls or drops rows.
3. Add the journey: find a project by name from the list and from a picker on the large org.
