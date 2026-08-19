# Issue #488 — Reports navigation reconciliation plan

## Disposition

The requested production change is already present on the supplied `fix/488-reports-nav` worktree, which is at `origin/dev` (`97577952`). `git blame` attributes the removal of the Reports rail item and its regression test to `688d1256` (2026-06-09). Do **not** remove the `/reports` route, `PlaceholderPage`, `PLACEHOLDER_TITLES['/reports']`, analytics mapping, or the unused `ReportsIcon`; those are deliberate compatibility/supporting code, not navigation entries.

The only code change warranted by this issue is a narrow route-table regression test that proves a directly entered `/reports` resolves to its concrete route rather than the `*` catch-all. The existing rail regression test already owns the absent-navigation behavior.

## Design

- **Navigation data flow:** authenticated shell → `Rail` → private `ALL_ITEMS`; Reports is deliberately absent. The command palette reads `MODULES`, which likewise has no Reports entry, so it cannot re-expose the stub through the alternate navigation surface.
- **Direct-link flow:** `AppRoutes` renders `appRouteConfig`; its concrete `/reports` entry renders `<PlaceholderPage title="Reports" />`. The proposed unit test will use that exported, production route table with React Router `matchRoutes`, rather than inventing a separate router or mounting the placeholder component alone.
- **Scope:** no API, schema, RLS, authorization, feature-flag, performance, or design-token change; no ADR is warranted.
- **Survey result:** no other navigation entry reaches `PlaceholderPage`. The sole application route rendering `PlaceholderPage` is `/reports`, and it is absent from both the Rail and the command-palette `MODULES` list. `Administration` appears in `PLACEHOLDER_TITLES` only for breadcrumb compatibility but its actual route renders `AdminUsersPage`, not `PlaceholderPage`.

## Acceptance traceability

| Requirement | Owning proof | File |
|---|---|---|
| Reports is absent from navigation | Existing `AC-IXD-DASH-004` Rail tests | `pmo-portal/src/components/shell/__tests__/Rail.reports.test.tsx` |
| A typed `/reports` does not fall through to 404 | New `AC-W2-IA-005` route-table test | `pmo-portal/App.routes.test.tsx` |
| Other placeholder-backed navigation entries are reported, not altered | Final builder report: `none found` | No code file |

## Implementation plan

### Task 1 — Add direct-route regression proof (test-only; AC-W2-IA-005)

**Files:** create `pmo-portal/App.routes.test.tsx`.

1. Before changing production code, add a Vitest test named `AC-W2-IA-005: /reports matches the concrete Reports placeholder route`.
2. Import `matchRoutes` from `react-router` and `appRouteConfig` from `./App` (the exact route data rendered by `AppRoutes`). Match `/reports`, take the leaf match, and assert its `path` is exactly `/reports`, not `*`.
3. Assert the matched route element is a valid React element and its props contain `title: 'Reports'`, proving the direct URL resolves to the Reports placeholder rather than merely any concrete route.
4. Run `cd pmo-portal && npm test -- App.routes.test.tsx src/components/shell/__tests__/Rail.reports.test.tsx`.

**Important:** this new regression test is expected to pass immediately because the production route is already correct. Do **not** manufacture a red phase by deleting or changing working route/navigation code; there is no production behavior left to implement. Do not modify `pmo-portal/App.tsx` or `pmo-portal/src/components/shell/Rail.tsx` in this task.

### Task 2 — Reconcile scope, survey, and run the required full gate

**Files:** no additional file changes.

1. Confirm the existing `pmo-portal/src/components/shell/__tests__/Rail.reports.test.tsx` still proves Reports is absent for the formerly eligible Executive and Finance rail views; retain it unchanged.
2. Survey all navigation surfaces and placeholder routes with:
   ```sh
   rg -n "<PlaceholderPage|PlaceholderPage title" pmo-portal/App.tsx pmo-portal/pages
   rg -n "to: '/|text: '|path: '/|label: '" pmo-portal/src/components/shell/Rail.tsx pmo-portal/src/components/shell/routeMatch.ts
   ```
   Record `no other placeholder-backed navigation entries found` in the builder’s final handoff/report. Do not remove, rename, or re-link any other nav entry.
3. From `pmo-portal/`, run the shared-machine full gate exactly:
   ```sh
   npm run verify:locked
   ```
4. Confirm the worktree diff is limited to `pmo-portal/App.routes.test.tsx` (plus this plan’s docs-only artifacts):
   ```sh
   git diff --check
   git status --short
   ```

## Final constraints

- Stay on `fix/488-reports-nav`; do not push, open a PR, or change the route/stub supporting code.
- The route test must use `appRouteConfig`; a standalone `MemoryRouter` with a hand-authored `/reports` route would not prove the deployed app route resolves.
- Report the survey result to the Director/builder handoff; do not make unrelated navigation decisions.
