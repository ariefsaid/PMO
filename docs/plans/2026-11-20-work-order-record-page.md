# Plan: work-order record page (#2518)

Spec: `docs/specs/work-order-record-page.spec.md`. Depends on #2517 (cost-line read). No migration expected.
Executor: Orca worker, UI lane (machine gates + one rendered review; `docs/qa-portfolio.md`). Skills: `restructure`.

## Files
- `pmo-portal/pages/WorkOrderDetail.tsx` (page) + `pmo-portal/pages/work-order-detail/{ScopeSection,CostSection,BillingSection,DocumentsSection,IssuesTasksSection}.tsx`
- `pmo-portal/src/lib/repositories/workOrders.ts` (extend: `getWorkOrder(id)`), reuse `workOrderBilling`, `workOrderAcceptances`, and the #2517 cost-lines function.
- `pmo-portal/App.tsx` (route), `src/components/shell/routeMatch.ts` (title/rail match), `public/locales/{en,id}/workOrders.json`.
- Link wiring: `pages/project-detail/tabs/WorkOrdersTab.tsx`, sales-invoice and acceptance rows, cost-line rows.

## Tasks (test first; each 2-5 min)
1. Route + shell match + not-found. Test: AC-WORP-001/002 in `WorkOrderDetail.test.tsx`. Run `npx vitest run pages/WorkOrderDetail.test.tsx`.
2. Header block from `getWorkOrder`. AC-WORP-001.
3. ScopeSection from `work_order_lines` + acceptance lines; derivation in `src/lib/workOrderProgress.ts` (pure, unit-tested). AC-WORP-005.
4. CostSection: group by source then discipline over the #2517 function; restricted handling per source. AC-WORP-006/007. Layer-1: a money test that the sum of displayed groups equals the sum of source rows.
5. BillingSection from existing derivations. AC-WORP-008.
6. DocumentsSection, IssuesTasksSection (read-only; render empty until #2531/#2521 columns exist, behind the column's presence in generated types).
7. Per-section error/empty/restricted states. AC-WORP-009.
8. Entry links (list row, invoice, acceptance, cost row). AC-WORP-003/004; one e2e `e2e/AC-WORP-003-open-work-order-page.spec.ts` (tag `@e2e-isolation`; read `docs/e2e-parallel-conventions.md`).
9. Locale strings en/id + parity. AC-WORP-011.
10. `scripts/ux-proof.sh` on `/work-orders/:id`, 375 and 1280. AC-WORP-010. Delete any look-pinning test met.

## Gates
`npm run check:guards`, `npm run typecheck`, eslint on touched files, touched vitest files, `scripts/e2e-local.sh AC-WORP-003`, `node scripts/affected-e2e.mjs`.

## Review
Spec, code-quality and security reviewers (security: confirm the page adds no read beyond RLS). Design-reviewer on rich seed. Ships in a UI batch, not with money.
