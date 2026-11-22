# Plan: discipline-profit-check (verify only)

Spec: `docs/specs/discipline-profit-check.spec.md`. No product code, migration, string or screen changes.

1. Add one `it('AC-DPC-001 ...')` to `pmo-portal/src/lib/disciplineProfit.test.ts`, reusing its `wo`, `line`, `rollup`, `rev` helpers:
   two work orders, civil and electrical direct lines on each, one `source: 'timesheet_entry'` and one
   `source: 'equipment_usage'` line with `workOrderId: null`, revenue rows per discipline; assert per-discipline allocated
   amounts and that sum(marginAfter) + Not assigned equals total revenue minus `rollup.totals[...].total`.
2. Gates (in `pmo-portal/`): `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 src/lib/disciplineProfit.test.ts`,
   `npx vitest run src/lib/disciplineProfit.test.ts`.
3. Commit, push `feat/gap-billing-discipline-profit-check`. Docs: add the question in the orchestrator's questions file (not here).
