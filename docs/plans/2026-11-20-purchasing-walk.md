# Plan: purchasing walk fixes (migration 1580, branch fix/walk-purchasing)

Spec: `docs/specs/purchasing-walk.spec.md`.

| Item | Change | Owning test |
|---|---|---|
| 1 site cash limit | `pages/admin/OrgImprestLimit.tsx` inside `OrgProcurementGates`; `src/lib/imprestRefusal.ts`; message in `ImprestFloats.tsx` | `OrgProcurementGates.test.tsx`, `ImprestFloats.test.tsx`, journey JOB-PU20 |
| 2 attribution | migration `1580_purchase_carries_cost_attribution_and_supplier.sql` (columns, trigger, create RPC keys, request/order stamp); `ProcurementCreate.tsx`, `useSoleWorkOrder.ts`, `purchaseAttribution.ts`, `RecordCaptureForm` default | `supabase/tests/1580_purchase_attribution_supplier.test.sql`, `ProcurementCreate.test.tsx`, `purchaseAttribution.test.ts`, JOB-PU21 |
| 3 order not by accident | same migration (ORDER_NEEDS_SUPPLIER after every other check); `useProcurementDecision.tsx` confirm and supplier picker | pgTAP 1580 (with in-test mutation), `useProcurementDecision.test.tsx`, JOB-PU1 |
| 4 receipt value | `procurementLedger.ts` (`valueFromLines`), `ProcurementLedger.tsx`, `CostSection.tsx` | `procurementLedger.test.ts`, `ProcurementLedger.test.tsx`, `CostSection.commitment.test.tsx`, JOB-PU22 |
| 5 vendor bill | `NewVendorBillDialog.tsx`, `PayablesPage.tsx`, `BillHoldNotice.tsx` | `NewVendorBillDialog.test.tsx`, `BillHoldNotice.test.tsx`, JOB-PU23 |
| 6 not found | `ProcurementDetails.tsx` Timeline tab: payment channel, print order, who approves | `ProcurementDetails.test.tsx` (JOB-PU24) |

Existing pgTAP files that order a purchase now give their fixtures a supplier (nine files). Existing journeys that tap "Record order" confirm it (JOB-PU1, JOB-PU4, AC-816, AC-PR-020).
Run order: `db reset`, the pgTAP files, the full pgTAP suite, then the touched journeys in both lanes.
