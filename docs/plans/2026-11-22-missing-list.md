# Plan: work order missing list (spec `docs/specs/work-order-missing-list.spec.md`)

No migration, no new DAL read. Paths under `pmo-portal/`.

1. `src/lib/workOrderMissing.ts` + `.test.ts` (AC-WML-001..005): pure `deriveWorkOrderMissing` with the typed step seam, `toMissingExport`.
2. `pages/work-order-detail/MissingSection.tsx` + `.test.tsx` (AC-WML-006): reads `useBillingReconciliation`, takes `steps` and `scopeLines` as props, exports via `useExport`.
3. `pages/WorkOrderDetail.tsx`: mounts the section after the close-out section; passes the scope lines; passes no steps yet.
4. `public/locales/{en,id}/workOrders.json`: `missing.*`.
5. `e2e/AC-WML-007-missing-list.spec.ts`; glossary entry "Missing list".
6. Later (on resume, after billing-steps lands): add the step data hook for the new step list, map it to `MissingStep`, pass it from the page, add an e2e that exports rows.

Gates: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`.
Screenshots for the orchestrator: `/work-orders/:id` desktop 1440 and phone 390 with quantity rows, empty, Closed.
