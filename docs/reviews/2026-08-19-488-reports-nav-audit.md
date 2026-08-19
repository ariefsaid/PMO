# Reports navigation audit

Issue #488’s worktree already has the Reports rail item removed; this change adds regression coverage without changing the route or placeholder. `/reports` remains in the production route table and still renders `PlaceholderPage` with the `Reports` title, while the route test proves it matches the concrete route rather than the catch-all 404 route.

## Where it lives

- `pmo-portal/App.routes.test.tsx` matches `/reports` against the exported `appRouteConfig` and checks the route path, React element, and `Reports` title.
- `docs/plans/2026-08-19-reports-nav-audit-126286e9.md` records the scope, acceptance traceability, implementation plan, and navigation survey.

The survey recorded no other placeholder-backed navigation entries. Reports is absent from both the Rail and command-palette module list; the `/administration` route uses `AdminUsersPage`, despite `Administration` appearing in placeholder-title compatibility data.

## Verification

From `pmo-portal/`, run the focused route and Rail tests, then the required shared-machine full suite:

```sh
npm test -- App.routes.test.tsx src/components/shell/__tests__/Rail.reports.test.tsx
npm run verify:locked
```

The route test is the direct-link proof; the existing Rail regression tests prove Reports is not shown for Executive or Finance views.
