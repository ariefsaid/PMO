# Blocked plan: Projects, Sales, and Procurement list working-set adoption (#682)

**Spec:** `docs/specs/list-working-set-return.spec.md`  
**Requested implementation:** Child B steps 7–12; Projects/Sales/Procurement portion of step 16; browser proofs AC-LRC-003, AC-LRC-004, AC-LRC-005, and AC-LRC-009.  
**Shared seam read first:** `pmo-portal/src/lib/listWorkingSet.ts`, `pmo-portal/src/hooks/useListWorkingSet.ts`, `pmo-portal/src/lib/listReturnContext.ts`, `pmo-portal/src/hooks/useListReturn.ts`, and `pmo-portal/src/hooks/useListSearchWorkingSet.ts`.  
**Director ruling read:** `docs/plans/2026-09-29-list-return-b67e18e2.md`, “Director ruling (2026-09-29)”.  
**Status:** blocked before an executable build plan. The ruling permits changes to exactly the listed six navigation assertions; two additional existing strict assertions must change for the requested Procurement BackBar adoption.

## Confirmed design boundary

The established client-only seam is the correct architecture; no schema, repository, RLS, API, cache, dependency, or ADR change is involved.

* The three list pages must use the typed URL working set and local URL-search adapter, retaining the existing session-view writers and passing settled `contentReady` into `useListReturn`.
* `openRecord()` is the only permitted record-open path: it accepts only canonical `/module/:id` paths and records the source list URL and `main-scroll` position in validated history state.
* `returnToList('procurement')` is the required Procurement detail BackBar route. It resolves direct/detail fallback to `/procurement` and **always** passes clean validated router state. With no incoming state, `listReturnNavigation(undefined, 'procurement')` returns `{ path: '/procurement', state: {} }`; `useListReturn.returnToList()` therefore calls `navigate('/procurement', { state: {} })`, not the old one-argument call.
* This preserves the record route, the Procurement inline preview, own-scope filtering, and all existing role guards. It is not optional: omitting the shared return hook from the Procurement detail violates FR-LRC-004/005 and AC-LRC-005/009.

## Stop condition: unapproved strict navigation assertions

The Director ruling authorizes only the exact assertions enumerated in the 2026-09-29 plan (Projects open, two Sales opens, ProjectDetail return, Procurement row open, and Procurement tab switches). The following current assertions are outside that list and conflict with the required `returnToList('procurement')` behavior:

| Existing assertion | Why it must fail under the required seam | Required goal-preserving update, not authorized |
|---|---|---|
| `pmo-portal/pages/ProcurementDetails.test.tsx:412` — `expect(navigate).toHaveBeenCalledWith('/procurement')` in `AC-NAV-007: "Back to Procurement" navigates to the Procurement module index (no tab)` | The page’s loading-state BackBar invokes the shared direct-record fallback. The destination remains `/procurement`, but the hook supplies the mandatory clean router-state options object. | Keep `/procurement` as the exact first argument and assert `{ state: {} }` (or an equally exact validated clean-state assertion). |
| `pmo-portal/pages/__tests__/ProcurementDetails.s6mobile.test.tsx:246` — `expect(navigate).toHaveBeenCalledWith('/procurement')` in `AC-S6-3: clicking the mobile BackBar navigates to /procurement` | The successful mobile BackBar invokes the same shared fallback. The destination remains `/procurement`, but it likewise receives validated clean router state. | Keep `/procurement` as the exact first argument and assert `{ state: {} }` (or an equally exact validated clean-state assertion). |

These cannot remain unchanged: Vitest exact mock-call matching distinguishes the one-argument call from `navigate('/procurement', { state: {} })`. Reverting this call to the old bare navigation, or adding a special bypass, would re-implement/widen the shared seam and violate the binding brief to use it. Loosening either assertion to `expect.anything()` is also prohibited.

## Required Director resolution

Authorize updates to **these two additional, explicitly named assertions only**, retaining the exact `/procurement` destination and adding an exact clean validated-state check. After that written authorization, execute the already-ratified steps 1–9 in `docs/plans/2026-09-29-list-return-b67e18e2.md`, including only the six previously authorized assertion updates plus these two newly authorized Procurement BackBar assertions.

Until then, do not modify production code, tests, e2e specs, dependencies, or `package-lock.json`; do not substitute a bare Procurement return navigation; and do not change any other existing assertion.

## Deferred traceability after resolution

| Acceptance criterion | Owning proof |
|---|---|
| AC-LRC-001 / AC-LRC-002 | AC-tag-leading component integration titles in `pmo-portal/pages/Projects.test.tsx`, `pmo-portal/pages/__tests__/Projects.atRiskFilter.test.tsx`, `pmo-portal/pages/SalesPipeline.test.tsx`, `pmo-portal/pages/__tests__/SalesPipeline.funnel.test.tsx`, `pmo-portal/pages/Procurement.test.tsx`, and `pmo-portal/pages/__tests__/Procurement.urlParam.test.tsx` |
| AC-LRC-003 | `pmo-portal/e2e/AC-LRC-003-projects-return.spec.ts` |
| AC-LRC-004 | `pmo-portal/e2e/AC-LRC-004-sales-return.spec.ts` |
| AC-LRC-005 | `pmo-portal/e2e/AC-LRC-005-procurement-return.spec.ts` |
| AC-LRC-009 | `pmo-portal/e2e/AC-LRC-009-browser-back.spec.ts` |
| AC-LRC-011 | `pmo-portal/pages/project-detail/__tests__/ProjectDetail.lens.test.tsx` |
| AC-LRC-012 | Projects, Sales, and Procurement cases in `pmo-portal/pages/__tests__/listWorkingSet.emptyStates.test.tsx` |

No gate is run while the acceptance-contract conflict is unresolved. Once resolved, use the exact focused RED/GREEN commands in the 2026-09-29 plan, then `cd pmo-portal && npm run typecheck && npm run lint:ci && npm test` and `cd pmo-portal && npm run verify:locked`; run each read-only browser proof with `scripts/e2e-local.sh <spec-path>` from the repository root.
