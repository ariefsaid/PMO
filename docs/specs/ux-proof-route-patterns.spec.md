# UX proof: baselines keyed by route pattern (#2549)

## Context
`scripts/ux-proof.mjs` compares each captured screen against a shrink-only words/small-text baseline in
`docs/ux/word-budget.json`. A record screen reached by an id in the URL (work order, asset, project, ...) never
matched a fixed-URL key, so it had no baseline and the check failed. #2548 added uuid-segment normalisation; this
spec resolves ids against the app's own route table instead, so ids that are not uuids work too.

## Requirements (EARS)
- **FR-001** The proof tool shall read the route paths of `appRouteConfig` in `pmo-portal/App.tsx` as the only route list.
- **FR-002** When a captured route matches a route-table path, the baseline key shall use that route's pattern, with each record-id parameter (a parameter named `...Id`) written as `:id`.
- **FR-003** Where a literal route and a parameter route both match (for example `/projects/new` and `/projects/:projectId`), the literal route shall win.
- **FR-004** The query string shall stay in the key; the hash and a trailing slash shall not.
- **FR-005** Where a non-id parameter (`:tab`, `:kind`, `:section`) matches, its concrete value shall stay in the key, because each value is a different screen.
- **FR-006** If a route is not in the route table, the tool shall fall back to replacing uuid segments with `:id`.
- **FR-007** While an exact-URL key already exists in the baseline, the tool shall use it before the pattern key.
- **FR-008** The `--rules-only` mode shall continue to read no baseline settings.

## Acceptance criteria
- **AC-001** Given the table has `/work-orders/:workOrderId`, when the route is `/work-orders/WO-1042/`, then the key is `/work-orders/:id@<w>@<login>`.
- **AC-002** Given `/projects/p-1/tasks?view=board#x`, then the pattern is `/projects/:id/tasks?view=board`.
- **AC-003** Given `/projects/new` and `/procurement/new?have=need`, then neither is rewritten.
- **AC-004** Given `/master-data/units`, then the key keeps `units`.
- **AC-005** Given a route absent from the table with a uuid segment, then the uuid becomes `:id`; a non-uuid segment stays.
- **AC-006** Given both an exact key and a pattern key exist, when the route matches the exact key, then the exact key is used; for another id the pattern key is used.
- **AC-007** Given a pattern key with baseline N words, when another record id measures more than N, then the shrink-only check fails; when it measures N or fewer, it passes.
- **AC-008** Given the shipped `App.tsx`, then the parsed table yields `/projects/:id/budget` and `/equipment/assets/:id` patterns.

Owning layer: node:test in `scripts/ux-proof-settings.test.mjs` (run in CI's verify job beside `scripts/ux-proof.test.mjs`).
