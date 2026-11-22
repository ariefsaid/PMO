# Plan: work order missing list (spec `docs/specs/work-order-missing-list.spec.md`)

No migration. Test first for each file, in this order. All paths under `pmo-portal/`.

1. `src/lib/workOrderMissing.ts` (+ `.test.ts`, AC-WML-001..004): pure `deriveWorkOrderMissing({ closeoutItems, steps, scope, reconciliation, status })` returning `MissingRow[]` (`id, kind, name, blocks: 'billing'|'closing', reasonKey, reasonParams, whoKey|ownerRole, source, ref`); `StepSource` type = the `steps` argument (rows `{claimId, stepName, ownerRole, completedOn, skippedOn, documents[]}`), the plug-in seam; plus `toMissingExport(rows, labels): ExportTable` (AC-WML-005).
2. `src/lib/db/workOrderClaimSteps.ts` (+ test): `listWorkOrderClaimSteps(workOrderId)`: `claim_billing_stages` embedding `claim_billing_stage_documents` and `progress_claims!inner(work_order_id,withdrawn_at)`, filtered by work order, withdrawn excluded, `limit` bounded; typed via generated types, no casts. Invoiced claims excluded in the derivation from the claim's invoice presence if the read exposes it, else kept (steps are done by then).
3. `src/lib/repositories/contracts/workOrderMissing.ts`, `src/lib/repositories/workOrderMissing.ts`, register in `src/lib/repositories/index.ts` and `types.ts` (ADR-0017 seam); `src/hooks/useWorkOrderMissing.ts` (key carries `org_id`).
4. `pages/work-order-detail/MissingSection.tsx` (+ `.test.tsx`, AC-WML-006): `RecordSection`, `ListState`, `StatusPill`, `Button`; reuses `useWorkOrderCloseoutItems`, `useBillingReconciliation`, and the page's already-loaded `progress`; Export via `useExport().exportTable`. Mounted in `pages/WorkOrderDetail.tsx` after `CloseoutSection`.
5. Locale strings: `public/locales/en/workOrders.json` and `public/locales/id/workOrders.json` under `missing.*`.
6. `e2e/AC-WML-007-missing-list.spec.ts` per `docs/e2e-parallel-conventions.md` (tag `@e2e-isolation`), written for the orchestrator's run.
7. Glossary: "Missing list" in `docs/glossary.md`.

Gates (in `pmo-portal/`): `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed sources>`.
Screenshots for the orchestrator: `/work-orders/:id` with gaps (desktop 1440, phone 390), empty state, Closed state, error state.
